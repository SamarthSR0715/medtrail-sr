-- ==============================================================================
-- Migration: 20261005_anti_cheat_production_system.sql
-- Description:
--   PRODUCTION-SAFE ANTI-CHEAT SYSTEM & SECURE EXAM SESSION INFRASTRUCTURE (PHASE 1)
--
-- Core Architecture Principles:
--   1. Preserve EXACT MedTrailSR scoring formula (20 pts/correct + time bonus up to 20 pts,
--      XP = correct*50 + 50, Accuracy = (correct/5)*100).
--   2. Four review states ONLY: ('unreviewed', 'flagged', 'cleared', 'disqualified').
--      Default is 'unreviewed'. No automatic disqualification.
--   3. Strict type compatibility:
--      - auth.users.id: UUID
--      - championship_registrations.user_id: UUID
--      - championship_pulse_sessions.user_id: UUID
--      - championship_anti_cheat_events.user_id: UUID
--      - championship_pulse_attempts.user_id: TEXT (stored as v_session.user_id::text)
--      - championship_leaderboard.user_id: TEXT (stored as v_session.user_id::text)
--   4. Date compatibility:
--      - championship_pulse_sets.pulse_date: DATE
--      - championship_pulse_questions.pulse_date: DATE
--      - championship_pulse_sessions.pulse_date: DATE
--      - championship_pulse_attempts.pulse_date: TEXT (stored as pulse_date::text)
--      - Authoritative IST Date: (now() AT TIME ZONE 'Asia/Kolkata')::date
--   5. Two-Phase Zero-Downtime Deployment:
--      - DOES NOT DROP legacy 13-parameter submit_pulse_attempt_atomic RPC.
--      - Supports BOTH new 2-parameter (UUID session) and legacy 13-parameter signatures simultaneously.
--      - Eliminates client-tampered scoring vulnerability on legacy route by validating
--        authoritatively against published questions.
--   6. Live Leaderboard Preservation:
--      - Ranking strictly preserves: score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC.
--      - Risk score NEVER affects scores, XP, time, accuracy, or leaderboard rank.
--   7. Answer-Key Secrecy:
--      - start_pulse_session_atomic returns questions stripped of correct answers and explanations.
-- ==============================================================================

BEGIN;

-- ── 1. UPDATE IMMUTABILITY TRIGGER FUNCTION TO ALLOW ADMIN/SERVICE OVERRIDES ─────
-- Previous migration returned OLD in trigger, which blocked admin review updates and migrations.
-- We ensure updates by administrators and service_role return NEW, while unauthorized updates fail.

CREATE OR REPLACE FUNCTION public.trg_fn_prevent_pulse_attempt_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Service role, postgres superuser, or administrative overrides permitted for review/status transitions
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
     OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unauthorized: Pulse attempt records are permanent and immutable.';
END;
$$;

-- ── 2. SCHEMA EVOLUTION: ENHANCE championship_pulse_attempts ──────────────────

-- A. Add anti-cheat metadata columns if not present
ALTER TABLE public.championship_pulse_attempts
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS risk_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS integrity_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- B. Ensure championship_pulse_questions has time_limit_seconds column
ALTER TABLE public.championship_pulse_questions
  ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER NOT NULL DEFAULT 60;

-- B. Normalize review_status: Drop any legacy/incompatible constraints
ALTER TABLE public.championship_pulse_attempts
  DROP CONSTRAINT IF EXISTS chk_championship_pulse_attempts_review_status;
ALTER TABLE public.championship_pulse_attempts
  DROP CONSTRAINT IF EXISTS championship_pulse_attempts_review_status_check;

-- C. Migrate legacy non-compliant states (e.g. 'approved' -> 'cleared', NULL -> 'unreviewed')
UPDATE public.championship_pulse_attempts
  SET review_status = 'cleared'
  WHERE review_status = 'approved';

UPDATE public.championship_pulse_attempts
  SET review_status = 'unreviewed'
  WHERE review_status IS NULL OR review_status NOT IN ('unreviewed', 'flagged', 'cleared', 'disqualified');

-- D. Ensure default and NOT NULL constraint
ALTER TABLE public.championship_pulse_attempts
  ALTER COLUMN review_status SET DEFAULT 'unreviewed',
  ALTER COLUMN review_status SET NOT NULL;

-- E. Enforce strict 4-state check constraint
ALTER TABLE public.championship_pulse_attempts
  ADD CONSTRAINT chk_championship_pulse_attempts_review_status
  CHECK (review_status IN ('unreviewed', 'flagged', 'cleared', 'disqualified'));

-- ── 3. CREATE SESSION & TELEMETRY INFRASTRUCTURE TABLES ────────────────────────

-- Table 1: championship_pulse_sessions (Server-authoritative exam lifecycle)
CREATE TABLE IF NOT EXISTS public.championship_pulse_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pulse_set_id UUID NOT NULL REFERENCES public.championship_pulse_sets(id) ON DELETE CASCADE,
  pulse_id TEXT NOT NULL,
  pulse_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '360 seconds'),
  submitted_at TIMESTAMPTZ,
  risk_score NUMERIC NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  telemetry_events_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_champ_pulse_sessions_user_date UNIQUE (user_id, pulse_date)
);

-- Foreign key linking attempts back to pulse session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_champ_attempts_session'
      AND table_name = 'championship_pulse_attempts'
  ) THEN
    ALTER TABLE public.championship_pulse_attempts
      ADD CONSTRAINT fk_champ_attempts_session
      FOREIGN KEY (session_id) REFERENCES public.championship_pulse_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_champ_sessions_user_date ON public.championship_pulse_sessions(user_id, pulse_date);
CREATE INDEX IF NOT EXISTS idx_champ_sessions_pulse_set ON public.championship_pulse_sessions(pulse_set_id);
CREATE INDEX IF NOT EXISTS idx_champ_sessions_status ON public.championship_pulse_sessions(status);
CREATE INDEX IF NOT EXISTS idx_champ_pa_session ON public.championship_pulse_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_champ_pa_review_status ON public.championship_pulse_attempts(review_status);

-- Table 2: championship_anti_cheat_events (Passive client integrity telemetry logs)
CREATE TABLE IF NOT EXISTS public.championship_anti_cheat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.championship_pulse_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  client_timestamp TIMESTAMPTZ,
  duration_ms NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for telemetry audit
CREATE INDEX IF NOT EXISTS idx_champ_ac_session_time ON public.championship_anti_cheat_events(session_id, server_timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_champ_ac_user_created ON public.championship_anti_cheat_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_champ_ac_type ON public.championship_anti_cheat_events(event_type);

-- ── 4. ROW LEVEL SECURITY (LEAST PRIVILEGE) ───────────────────────────────────

ALTER TABLE public.championship_pulse_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_anti_cheat_events ENABLE ROW LEVEL SECURITY;

-- Revoke mutation rights from client roles (mutations happen STRICTLY via security definer RPCs)
REVOKE INSERT, UPDATE, DELETE ON public.championship_pulse_sessions FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.championship_anti_cheat_events FROM authenticated, anon, public;

GRANT ALL ON public.championship_pulse_sessions TO service_role;
GRANT ALL ON public.championship_anti_cheat_events TO service_role;

GRANT SELECT ON public.championship_pulse_sessions TO authenticated;
GRANT SELECT ON public.championship_anti_cheat_events TO authenticated;

-- Policies for sessions: students can view only their own sessions; admins can view all
DROP POLICY IF EXISTS "Students select own pulse sessions" ON public.championship_pulse_sessions;
CREATE POLICY "Students select own pulse sessions"
  ON public.championship_pulse_sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- Policies for telemetry events: Admins and service role read telemetry
DROP POLICY IF EXISTS "Admins select anti cheat events" ON public.championship_anti_cheat_events;
CREATE POLICY "Admins select anti cheat events"
  ON public.championship_anti_cheat_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- ── 5. RPC: BATCH LOG TELEMETRY (PASSIVE INTEGRITY MONITORING) ─────────────────

CREATE OR REPLACE FUNCTION public.log_anti_cheat_events_batch(
  p_session_id UUID,
  p_events JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_session RECORD;
  v_event JSONB;
  v_inserted_count INTEGER := 0;
  v_total_events INTEGER;
  v_event_type TEXT;
  v_risk_delta NUMERIC := 0;
  v_new_risk NUMERIC;
BEGIN
  -- 1. Authentication check
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL AND NOT (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  -- 2. Verify Session Existence & Ownership
  SELECT id, user_id, status, risk_score, telemetry_events_count
  INTO v_session
  FROM public.championship_pulse_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_caller_uid IS NOT NULL AND v_session.user_id <> v_caller_uid AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
  END IF;

  -- Allow logging only for active or recently completed sessions
  IF v_session.status NOT IN ('active', 'submitted') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SESSION_INACTIVE');
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('success', true, 'logged_count', 0);
  END IF;

  v_total_events := jsonb_array_length(p_events);
  IF v_total_events = 0 THEN
    RETURN jsonb_build_object('success', true, 'logged_count', 0);
  END IF;

  -- Cap at 50 events per batch to prevent denial-of-service / memory blowup
  IF v_total_events > 50 THEN
    v_total_events := 50;
  END IF;

  -- 3. Ingest Telemetry Events
  FOR i IN 0..(v_total_events - 1) LOOP
    v_event := p_events->i;
    v_event_type := left(trim(coalesce(v_event->>'event_type', 'UNKNOWN')), 64);

    -- Calculate passive risk heuristic (for admin review flag only — NEVER modifies quiz score)
    IF v_event_type = 'TAB_HIDDEN' THEN
      v_risk_delta := v_risk_delta + 10;
    ELSIF v_event_type = 'WINDOW_BLUR' THEN
      v_risk_delta := v_risk_delta + 5;
    ELSIF v_event_type IN ('COPY_ATTEMPT', 'PASTE_ATTEMPT') THEN
      v_risk_delta := v_risk_delta + 15;
    ELSIF v_event_type = 'DEVTOOLS_OPENED' THEN
      v_risk_delta := v_risk_delta + 25;
    ELSIF v_event_type = 'HEARTBEAT_JITTER' THEN
      v_risk_delta := v_risk_delta + 5;
    END IF;

    INSERT INTO public.championship_anti_cheat_events (
      session_id,
      user_id,
      event_type,
      client_timestamp,
      duration_ms,
      metadata,
      server_timestamp
    ) VALUES (
      p_session_id,
      v_session.user_id,
      v_event_type,
      NULLIF(v_event->>'client_timestamp', '')::timestamptz,
      (v_event->>'duration_ms')::numeric,
      COALESCE(v_event->'metadata', '{}'::jsonb),
      now()
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  -- 4. Update session telemetry counter & passive risk accumulation
  v_new_risk := LEAST(100, v_session.risk_score + v_risk_delta);

  UPDATE public.championship_pulse_sessions
  SET telemetry_events_count = v_session.telemetry_events_count + v_inserted_count,
      last_heartbeat_at = now(),
      risk_score = v_new_risk,
      risk_level = CASE
        WHEN v_new_risk >= 70 THEN 'critical'
        WHEN v_new_risk >= 45 THEN 'high'
        WHEN v_new_risk >= 20 THEN 'medium'
        ELSE 'low'
      END,
      updated_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'logged_count', v_inserted_count
  );
EXCEPTION WHEN OTHERS THEN
  -- Non-fatal: Telemetry failure must never disrupt student flow
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'LOG_ERROR',
    'message', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_anti_cheat_events_batch(UUID, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.log_anti_cheat_events_batch(UUID, JSONB) TO authenticated, service_role;

-- ── 6. RPC: START PULSE SESSION (SECRECY-PRESERVING QUESTION HANDSHAKE) ────────

CREATE OR REPLACE FUNCTION public.start_pulse_session_atomic(
  p_pulse_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_email TEXT;
  v_is_service_role BOOLEAN;
  v_today_ist DATE;
  v_pulse_set RECORD;
  v_registration RECORD;
  v_existing_session RECORD;
  v_existing_attempt RECORD;
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_sanitized_questions JSONB := '[]'::jsonb;
  v_q RECORD;
  v_question_count INTEGER := 0;
  v_total_duration INTEGER := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Anti-Spoofing & Authentication Check
  v_caller_uid := auth.uid();
  v_caller_email := auth.jwt() ->> 'email';
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');

  IF v_caller_uid IS NULL AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Authentication required to start an official Pulse exam session.',
      'message', 'Please sign in to take the official championship Pulse.'
    );
  END IF;

  -- 2. Authoritative Championship Registration Lookup
  SELECT id, user_id, email, full_name, medical_college, batch, approval_status
  INTO v_registration
  FROM public.championship_registrations
  WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
     OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email))
  ORDER BY (user_id = v_caller_uid) DESC, (approval_status = 'approved') DESC, created_at DESC
  LIMIT 1;

  IF v_registration.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Registration required.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.'
    );
  END IF;

  IF v_registration.approval_status <> 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Registration status: ' || v_registration.approval_status,
      'message', 'Your championship registration is ' || v_registration.approval_status || '. Only approved registrations can attempt Pulse.'
    );
  END IF;

  -- 3. Resolve Authoritative Pulse Set
  -- Current IST date: (now() AT TIME ZONE 'Asia/Kolkata')::date
  v_today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF p_pulse_id IS NOT NULL AND trim(p_pulse_id) <> '' THEN
    SELECT id, pulse_date, status, questions
    INTO v_pulse_set
    FROM public.championship_pulse_sets
    WHERE (id::text = trim(p_pulse_id) OR pulse_date::text = trim(p_pulse_id))
    LIMIT 1;
  ELSE
    SELECT id, pulse_date, status, questions
    INTO v_pulse_set
    FROM public.championship_pulse_sets
    WHERE pulse_date = v_today_ist
    LIMIT 1;
  END IF;

  IF v_pulse_set.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active Pulse set found for the requested date or ID.',
      'message', 'No Pulse set is available for this competition slot.'
    );
  END IF;

  IF v_pulse_set.status <> 'published' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Pulse set is not currently open for submission.',
      'message', 'This Pulse session is currently in draft or closed status.'
    );
  END IF;

  -- 4. Check If Student Already Submitted This Pulse (1 Attempt Rule)
  SELECT id, score, accuracy, xp
  INTO v_existing_attempt
  FROM public.championship_pulse_attempts
  WHERE (pulse_id = v_pulse_set.id::text OR pulse_date = v_pulse_set.pulse_date::text)
    AND (
      user_id = v_caller_uid::text
      OR (v_caller_email IS NOT NULL AND lower(user_email) = lower(v_caller_email))
    )
  LIMIT 1;

  IF v_existing_attempt.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_attempt.id,
      'message', 'You have already completed this Pulse. Only 1 attempt is permitted.'
    );
  END IF;

  -- 5. Calculate Server-Authoritative Total Exam Duration
  SELECT coalesce(sum(GREATEST(1, time_limit_seconds)), 0)
  INTO v_total_duration
  FROM public.championship_pulse_questions
  WHERE pulse_set_id = v_pulse_set.id;

  IF v_total_duration IS NULL OR v_total_duration <= 0 THEN
    IF v_pulse_set.questions IS NOT NULL AND jsonb_array_length(v_pulse_set.questions) > 0 THEN
      SELECT coalesce(sum(GREATEST(1, coalesce((elem->>'time_limit_seconds')::integer, (elem->>'timeLimitSeconds')::integer, 60))), 300)
      INTO v_total_duration
      FROM jsonb_array_elements(v_pulse_set.questions) AS elem;
    ELSE
      v_total_duration := 300;
    END IF;
  END IF;

  IF v_total_duration IS NULL OR v_total_duration <= 0 THEN
    v_total_duration := 300;
  END IF;

  -- 6. Session Handshake: Resume Active Session OR Create New One
  SELECT id, status, started_at, expires_at
  INTO v_existing_session
  FROM public.championship_pulse_sessions
  WHERE user_id = v_caller_uid
    AND pulse_date = v_pulse_set.pulse_date
  LIMIT 1;

  IF v_existing_session.id IS NOT NULL THEN
    IF v_existing_session.status = 'submitted' THEN
      RETURN jsonb_build_object(
        'success', false,
        'already_submitted', true,
        'message', 'You have already submitted this Pulse attempt.'
      );
    ELSIF v_existing_session.status = 'active' AND v_existing_session.expires_at > v_now THEN
      -- Active valid session: resume idempotently
      v_session_id := v_existing_session.id;
      v_expires_at := v_existing_session.expires_at;
    ELSE
      -- Expired or abandoned session for today
      v_session_id := v_existing_session.id;
      v_expires_at := v_existing_session.expires_at;
    END IF;
  ELSE
    -- Create new session with exam duration window (v_total_duration exam time + 60s network/rendering buffer)
    v_expires_at := v_now + ((v_total_duration + 60) || ' seconds')::interval;

    INSERT INTO public.championship_pulse_sessions (
      pulse_set_id,
      pulse_id,
      pulse_date,
      user_id,
      status,
      started_at,
      expires_at
    ) VALUES (
      v_pulse_set.id,
      v_pulse_set.id::text,
      v_pulse_set.pulse_date,
      v_caller_uid,
      'active',
      v_now,
      v_expires_at
    )
    RETURNING id INTO v_session_id;
  END IF;

  -- 7. Load & SANITIZE Questions (Answer-Key Secrecy: NO correct_answer or explanation)
  FOR v_q IN
    SELECT
      id,
      slot,
      question,
      option_a,
      option_b,
      option_c,
      option_d,
      subject,
      difficulty,
      xp_value,
      time_limit_seconds
    FROM public.championship_pulse_questions
    WHERE pulse_set_id = v_pulse_set.id
    ORDER BY slot ASC
  LOOP
    v_question_count := v_question_count + 1;
    v_sanitized_questions := v_sanitized_questions || jsonb_build_object(
      'question_id', v_q.id,
      'slot', v_q.slot - 1,
      'subject', coalesce(v_q.subject, 'General'),
      'category', coalesce(v_q.subject, 'General Pulse'),
      'question', v_q.question,
      'options', jsonb_build_array(v_q.option_a, v_q.option_b, v_q.option_c, v_q.option_d),
      'xp', GREATEST(0, coalesce(v_q.xp_value, 50)),
      'points', GREATEST(0, coalesce(v_q.xp_value, 50)),
      'time_limit_seconds', GREATEST(1, coalesce(v_q.time_limit_seconds, 60))
    );
  END LOOP;

  -- Fallback: If normalized table has 0 rows, sanitize from pulse_set.questions JSON
  IF v_question_count = 0 AND v_pulse_set.questions IS NOT NULL THEN
    FOR v_q IN
      SELECT
        coalesce(elem->>'id', 'q_' || ord) AS id,
        ord - 1 AS slot,
        coalesce(elem->>'question', '') AS question,
        elem->'options' AS options_arr,
        elem->>'option_a' AS option_a,
        elem->>'option_b' AS option_b,
        elem->>'option_c' AS option_c,
        elem->>'option_d' AS option_d,
        coalesce(elem->>'subject', 'General') AS subject,
        GREATEST(0, coalesce((elem->>'xp_value')::integer, (elem->>'xp')::integer, 50)) AS xp_value,
        GREATEST(1, coalesce((elem->>'time_limit_seconds')::integer, (elem->>'timeLimitSeconds')::integer, 60)) AS time_limit_seconds
      FROM jsonb_array_elements(v_pulse_set.questions) WITH ORDINALITY arr(elem, ord)
    LOOP
      v_question_count := v_question_count + 1;
      v_sanitized_questions := v_sanitized_questions || jsonb_build_object(
        'question_id', v_q.id,
        'slot', v_q.slot,
        'subject', v_q.subject,
        'category', v_q.subject,
        'question', v_q.question,
        'options', CASE
          WHEN v_q.options_arr IS NOT NULL THEN v_q.options_arr
          ELSE jsonb_build_array(coalesce(v_q.option_a, ''), coalesce(v_q.option_b, ''), coalesce(v_q.option_c, ''), coalesce(v_q.option_d, ''))
        END,
        'xp', v_q.xp_value,
        'points', v_q.xp_value,
        'time_limit_seconds', v_q.time_limit_seconds
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'pulse_id', v_pulse_set.id::text,
    'pulse_date', v_pulse_set.pulse_date::text,
    'question_count', v_question_count,
    'duration_seconds', v_total_duration,
    'expires_at', v_expires_at,
    'questions', v_sanitized_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_pulse_session_atomic(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.start_pulse_session_atomic(TEXT) TO authenticated, service_role;

-- ── 7. RPC: AUTHORITATIVE SUBMISSION VIA SESSION (NEW 2-PARAMETER SIGNATURE) ───

CREATE OR REPLACE FUNCTION public.submit_pulse_attempt_atomic(
  p_session_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_session RECORD;
  v_reg RECORD;
  v_existing_id UUID;
  v_new_attempt_id UUID;
  v_submitted_at TIMESTAMPTZ := now();
  v_effective_user_email TEXT;
  v_effective_student_name TEXT;
  v_canonical_college TEXT;
  v_canonical_batch TEXT;
  v_resolved_college_id UUID;
  v_time_taken_seconds NUMERIC;
  v_correct_count INTEGER := 0;
  v_speed_bonus INTEGER;
  v_score NUMERIC;
  v_accuracy NUMERIC;
  v_xp NUMERIC;
  v_risk_score NUMERIC := 0;
  v_review_status TEXT := 'unreviewed';
  v_explanations JSONB := '[]'::jsonb;
  v_user_ans INTEGER;
  v_correct_letter TEXT;
  v_correct_idx INTEGER;
  v_q RECORD;
  v_idx INTEGER := 0;
BEGIN
  -- 1. Anti-Spoofing & Authentication Check
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL AND NOT (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Authentication required.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.'
    );
  END IF;

  -- 2. Authoritative Exam Session Lookup
  SELECT s.*, ps.questions AS fallback_questions_json
  INTO v_session
  FROM public.championship_pulse_sessions s
  JOIN public.championship_pulse_sets ps ON ps.id = s.pulse_set_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Exam session not found or invalid.',
      'message', 'Active exam session not found. Please refresh and try again.'
    );
  END IF;

  -- Verify session ownership (caller must own the session)
  IF v_caller_uid IS NOT NULL AND v_session.user_id <> v_caller_uid AND NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Session ownership mismatch.',
      'message', 'Exam session does not belong to the current authenticated user.'
    );
  END IF;

  IF v_session.status = 'submitted' THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE session_id = v_session.id
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse. 1 attempt permitted.'
    );
  END IF;

  -- 3. Authoritative Championship Registration Lookup (Enforcing Approved Registration)
  SELECT id, user_id, email, full_name, medical_college, medical_college_id, batch, approval_status
  INTO v_reg
  FROM public.championship_registrations
  WHERE (user_id IS NOT NULL AND user_id = v_session.user_id)
     OR (v_session.user_id::text IS NOT NULL AND user_id::text = v_session.user_id::text)
  ORDER BY (approval_status = 'approved') DESC, created_at DESC
  LIMIT 1;

  IF v_reg.id IS NULL OR v_reg.approval_status <> 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Championship registration not approved.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.'
    );
  END IF;

  -- Bind canonical student metadata
  v_effective_user_email := COALESCE(v_reg.email, auth.jwt() ->> 'email');
  v_effective_student_name := COALESCE(v_reg.full_name, 'Doctor');
  v_canonical_college := v_reg.medical_college;
  v_canonical_batch := v_reg.batch;
  v_resolved_college_id := v_reg.medical_college_id;

  IF v_resolved_college_id IS NULL AND v_canonical_college IS NOT NULL THEN
    SELECT id INTO v_resolved_college_id
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(v_canonical_college))
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  END IF;

  -- 4. Check If Attempt Already Exists (Concurrency Guard)
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE pulse_id = v_session.pulse_id
    AND (
      user_id = v_session.user_id::text
      OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse.'
    );
  END IF;

  -- 5. Calculate Server-Authoritative Time Taken
  v_time_taken_seconds := ROUND(EXTRACT(EPOCH FROM (v_submitted_at - v_session.started_at)));
  -- Defensive boundaries: non-negative and capped at 300s competition max
  v_time_taken_seconds := GREATEST(0, LEAST(300, v_time_taken_seconds));

  -- 6. Evaluate Answers Authoritatively Against championship_pulse_questions
  FOR v_q IN
    SELECT slot, correct_answer, explanation
    FROM public.championship_pulse_questions
    WHERE pulse_set_id = v_session.pulse_set_id
    ORDER BY slot ASC
  LOOP
    -- User's answer index for this slot (0-indexed array: slot 1 -> index 0)
    IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'array' THEN
      v_user_ans := (p_answers->>v_idx)::integer;
    ELSE
      v_user_ans := -1;
    END IF;

    v_correct_letter := upper(trim(coalesce(v_q.correct_answer, 'A')));
    v_correct_idx := CASE v_correct_letter
      WHEN 'A' THEN 0
      WHEN 'B' THEN 1
      WHEN 'C' THEN 2
      WHEN 'D' THEN 3
      WHEN '0' THEN 0
      WHEN '1' THEN 1
      WHEN '2' THEN 2
      WHEN '3' THEN 3
      ELSE 0
    END;

    IF v_user_ans IS NOT NULL AND v_user_ans = v_correct_idx THEN
      v_correct_count := v_correct_count + 1;
    END IF;

    -- Store explanation for post-submission review modal
    v_explanations := v_explanations || jsonb_build_object(
      'slot', v_q.slot,
      'correct_answer', v_correct_letter,
      'explanation', coalesce(v_q.explanation, '')
    );

    v_idx := v_idx + 1;
  END LOOP;

  -- Fallback evaluation if questions table was populated via json only
  IF v_idx = 0 AND v_session.fallback_questions_json IS NOT NULL THEN
    FOR v_q IN
      SELECT
        ord AS slot,
        upper(coalesce(elem->>'correct_answer', elem->>'correctAnswer', 'A')) AS correct_answer,
        coalesce(elem->>'explanation', '') AS explanation
      FROM jsonb_array_elements(v_session.fallback_questions_json) WITH ORDINALITY arr(elem, ord)
    LOOP
      IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'array' THEN
        v_user_ans := (p_answers->>v_idx)::integer;
      ELSE
        v_user_ans := -1;
      END IF;

      v_correct_letter := upper(trim(coalesce(v_q.correct_answer, 'A')));
      v_correct_idx := CASE v_correct_letter
        WHEN 'A' THEN 0
        WHEN 'B' THEN 1
        WHEN 'C' THEN 2
        WHEN 'D' THEN 3
        WHEN '0' THEN 0
        WHEN '1' THEN 1
        WHEN '2' THEN 2
        WHEN '3' THEN 3
        ELSE 0
      END;

      IF v_user_ans IS NOT NULL AND v_user_ans = v_correct_idx THEN
        v_correct_count := v_correct_count + 1;
      END IF;

      v_explanations := v_explanations || jsonb_build_object(
        'slot', v_q.slot,
        'correct_answer', v_correct_letter,
        'explanation', v_q.explanation
      );

      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- 7. Authoritative MedTrailSR Scoring Formula (EXACT SPECIFICATION)
  v_speed_bonus := GREATEST(
    0,
    20 - FLOOR(v_time_taken_seconds::numeric / 5.0)::integer
  );

  v_score := (v_correct_count * 20) + v_speed_bonus;

  v_accuracy := ROUND(
    (v_correct_count::numeric / 5.0) * 100.0
  );

  v_xp := (v_correct_count * 50) + 50;

  -- 8. Anti-Cheat Integrity Assessment (Passive review flag only — NEVER modifies score or ranking)
  v_risk_score := COALESCE(v_session.risk_score, 0);

  IF v_risk_score >= 50 THEN
    v_review_status := 'flagged';
  ELSE
    v_review_status := 'unreviewed';
  END IF;

  -- 9. Insert Immutable Pulse Attempt
  -- Types: user_id is TEXT (v_session.user_id::text), pulse_date is TEXT (v_session.pulse_date::text)
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id,
      pulse_date,
      user_id,
      user_email,
      student_name,
      college,
      batch,
      score,
      accuracy,
      time_taken_seconds,
      completion_time,
      xp,
      answers,
      completed_at,
      submitted_at,
      created_at,
      medical_college_id,
      session_id,
      risk_score,
      risk_level,
      review_status
    ) VALUES (
      v_session.pulse_id,
      v_session.pulse_date::text,
      v_session.user_id::text,
      v_effective_user_email,
      v_effective_student_name,
      v_canonical_college,
      v_canonical_batch,
      v_score,
      v_accuracy,
      v_time_taken_seconds,
      v_time_taken_seconds,
      v_xp,
      p_answers,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at,
      v_resolved_college_id,
      v_session.id,
      v_risk_score,
      v_session.risk_level,
      v_review_status
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE pulse_id = v_session.pulse_id
      AND (
        user_id = v_session.user_id::text
        OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
      )
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse.'
    );
  END;

  -- 10. Update Exam Session State to 'submitted'
  UPDATE public.championship_pulse_sessions
  SET status = 'submitted',
      submitted_at = v_submitted_at,
      risk_score = v_risk_score,
      updated_at = v_submitted_at
  WHERE id = v_session.id;

  -- 11. Upsert into championship_leaderboard
  INSERT INTO public.championship_leaderboard (
    pulse_id,
    user_id,
    user_email,
    student_name,
    college,
    batch,
    score,
    accuracy,
    time_taken_seconds,
    submitted_at,
    updated_at,
    medical_college_id
  ) VALUES (
    v_session.pulse_id,
    v_session.user_id::text,
    v_effective_user_email,
    v_effective_student_name,
    v_canonical_college,
    v_canonical_batch,
    v_score,
    v_accuracy,
    v_time_taken_seconds,
    v_submitted_at,
    v_submitted_at,
    v_resolved_college_id
  )
  ON CONFLICT (user_id, pulse_id) DO UPDATE SET
    score = EXCLUDED.score,
    accuracy = EXCLUDED.accuracy,
    time_taken_seconds = EXCLUDED.time_taken_seconds,
    college = EXCLUDED.college,
    batch = EXCLUDED.batch,
    medical_college_id = EXCLUDED.medical_college_id,
    updated_at = v_submitted_at;

  -- 12. Re-rank Individual Leaderboard (Strict Existing Criteria: score DESC, accuracy DESC, time ASC, submitted_at ASC)
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC
    ) AS calculated_rank
    FROM public.championship_leaderboard
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_leaderboard l
  SET rank = r.calculated_rank
  FROM ranked r
  WHERE l.id = r.id;

  -- 13. Recalculate College Standings
  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    v_session.pulse_id,
    l.college,
    COALESCE(
      (
        SELECT mc.id FROM public.medical_colleges mc 
        WHERE lower(mc.college_name) = lower(trim(l.college))
        ORDER BY mc.created_at ASC, mc.id ASC
        LIMIT 1
      ),
      CASE 
        WHEN COUNT(DISTINCT l.medical_college_id) = 1 
        THEN (array_remove(array_agg(DISTINCT l.medical_college_id), NULL))[1]
        ELSE NULL
      END
    ) AS medical_college_id,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    (
      SELECT student_name FROM public.championship_leaderboard l2
      WHERE l2.pulse_id = v_session.pulse_id AND l2.college = l.college
      ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
    ) AS top_scorer,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_session.pulse_id
  GROUP BY l.college
  ON CONFLICT (college, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    top_scorer = EXCLUDED.top_scorer,
    medical_college_id = COALESCE(EXCLUDED.medical_college_id, championship_college_standings.medical_college_id),
    updated_at = v_submitted_at;

  -- Re-rank college standings
  WITH ranked_colleges AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id 
      ORDER BY total_score DESC, avg_accuracy DESC
    ) AS calculated_rank
    FROM public.championship_college_standings
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

  -- 14. Recalculate Batch Standings
  INSERT INTO public.championship_batch_standings (
    pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
  )
  SELECT
    v_session.pulse_id,
    l.batch,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_session.pulse_id
  GROUP BY l.batch
  ON CONFLICT (batch, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    updated_at = v_submitted_at;

  -- Re-rank batch standings
  WITH ranked_batches AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id 
      ORDER BY total_score DESC, avg_score DESC
    ) AS calculated_rank
    FROM public.championship_batch_standings
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_batch_standings bs
  SET rank = rb.calculated_rank
  FROM ranked_batches rb
  WHERE bs.id = rb.id;

  -- 15. Return Final Authoritative Result
  RETURN jsonb_build_object(
    'success', true,
    'already_submitted', false,
    'attempt_id', v_new_attempt_id,
    'score', v_score,
    'accuracy', v_accuracy,
    'xp', v_xp,
    'time_taken_seconds', v_time_taken_seconds,
    'submitted_at', v_submitted_at,
    'explanations', v_explanations,
    'canonical_college', v_canonical_college,
    'message', 'Attempt submitted successfully.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pulse_attempt_atomic(UUID, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic(UUID, JSONB) TO authenticated, service_role;

-- ── 8. RPC: PRESERVE LEGACY 13-PARAMETER SUBMISSION FUNCTION (PHASE 1 TRANSITION) ─
-- CRITICAL REQUIREMENT: DO NOT DROP the legacy 13-parameter signature in this migration.
-- Supporting both signatures guarantees zero disruption for active student tabs and cached frontends.
--
-- Security Hardening Rules Applied:
--   1. NEVER TRUST CLIENT SCORE/XP/ACCURACY: Values are derived exclusively from server questions.
--   2. NO SPEED BONUS: Legacy clients lack server-side session timestamps; v_speed_bonus := 0 (max score 100).
--   3. NO TIME MANIPULATION: v_effective_time is fixed to 300s to prevent forged 0s ranking advantages.
--   4. NO UNSAFE FALLBACK: Submissions fail if server questions cannot be authoritatively resolved.
--   5. ACTIVE PULSE VALIDATION: Rejects historical, draft, or inactive pulse IDs.
--   6. REVIEW STATUS FLAGGED: Legacy submissions are marked 'flagged' for review (not disqualified).

CREATE OR REPLACE FUNCTION public.submit_pulse_attempt_atomic(
  p_pulse_id TEXT,
  p_pulse_date TEXT,
  p_user_id TEXT,
  p_user_email TEXT,
  p_student_name TEXT,
  p_college TEXT,
  p_batch TEXT,
  p_score NUMERIC,
  p_accuracy NUMERIC,
  p_time_taken_seconds NUMERIC,
  p_xp NUMERIC,
  p_answers JSONB,
  p_college_id UUID DEFAULT NULL::uuid
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_email TEXT;
  v_is_service_role BOOLEAN;
  v_effective_user_id TEXT;
  v_effective_user_email TEXT;
  v_effective_student_name TEXT;
  v_canonical_college TEXT;
  v_canonical_batch TEXT;
  v_resolved_college_id UUID;
  v_registration_rec RECORD;
  v_existing_id UUID;
  v_new_attempt_id UUID;
  v_submitted_at TIMESTAMPTZ := now();
  v_today_ist DATE;
  v_pulse_set RECORD;
  v_questions_count INTEGER := 0;
  v_correct_count INTEGER := 0;
  v_speed_bonus INTEGER := 0;
  v_final_score NUMERIC;
  v_final_accuracy NUMERIC;
  v_final_xp NUMERIC;
  v_client_reported_time NUMERIC;
  v_effective_time NUMERIC;
  v_q RECORD;
  v_idx INTEGER := 0;
  v_user_ans INTEGER;
  v_correct_letter TEXT;
  v_correct_idx INTEGER;
BEGIN
  -- 1. Anti-Spoofing & Authentication Check
  v_caller_uid := auth.uid();
  v_caller_email := auth.jwt() ->> 'email';
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');

  IF v_caller_uid IS NULL AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'not_registered', true
    );
  END IF;

  -- 2. Authoritative Championship Registration Lookup
  -- SECURITY: Identity is resolved STRICTLY from verified auth context for authenticated users.
  -- Client-supplied p_user_id and p_user_email are NEVER trusted for authenticated callers.
  IF v_is_service_role AND v_caller_uid IS NULL THEN
    SELECT id, user_id, email, full_name, medical_college, medical_college_id, batch, approval_status
    INTO v_registration_rec
    FROM public.championship_registrations
    WHERE (p_user_id IS NOT NULL AND user_id::text = p_user_id)
       OR (p_user_email IS NOT NULL AND lower(email) = lower(trim(p_user_email)))
    ORDER BY (approval_status = 'approved') DESC, created_at DESC
    LIMIT 1;
  ELSE
    SELECT id, user_id, email, full_name, medical_college, medical_college_id, batch, approval_status
    INTO v_registration_rec
    FROM public.championship_registrations
    WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
       OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email))
    ORDER BY (user_id = v_caller_uid) DESC, (approval_status = 'approved') DESC, created_at DESC
    LIMIT 1;
  END IF;

  IF v_registration_rec.id IS NULL OR v_registration_rec.approval_status <> 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'not_registered', true
    );
  END IF;

  -- 3. Bind Verified Identity & Canonical Details
  IF v_is_service_role AND v_caller_uid IS NULL THEN
    v_effective_user_id := COALESCE(v_registration_rec.user_id::text, p_user_id, v_registration_rec.email);
    v_effective_user_email := COALESCE(v_registration_rec.email, lower(trim(p_user_email)));
    v_effective_student_name := COALESCE(v_registration_rec.full_name, trim(p_student_name), 'Doctor');
  ELSE
    v_effective_user_id := v_caller_uid::text;
    v_effective_user_email := COALESCE(v_registration_rec.email, v_caller_email);
    v_effective_student_name := COALESCE(v_registration_rec.full_name, trim(p_student_name), 'Doctor');
  END IF;

  v_canonical_college := v_registration_rec.medical_college;
  v_canonical_batch := v_registration_rec.batch;
  v_resolved_college_id := COALESCE(v_registration_rec.medical_college_id, p_college_id);

  IF v_resolved_college_id IS NULL AND v_canonical_college IS NOT NULL THEN
    SELECT id INTO v_resolved_college_id
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(v_canonical_college))
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  END IF;

  -- 4. Authoritative Pulse Validation (Active, Published, Current IST Competition Date)
  -- Resolves to the current IST date; historical/inactive pulse IDs are rejected.
  v_today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT id, pulse_date, status
  INTO v_pulse_set
  FROM public.championship_pulse_sets
  WHERE (id::text = trim(p_pulse_id) OR pulse_date::text = trim(p_pulse_date))
    AND pulse_date = v_today_ist
    AND status = 'published'
  LIMIT 1;

  IF v_pulse_set.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Pulse session is not currently active or published for today.',
      'message', 'This Pulse session is not currently open for submission. Please refresh the page.'
    );
  END IF;

  -- 5. Concurrency / 1-Attempt Check
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE (pulse_id = v_pulse_set.id::text OR pulse_date = v_pulse_set.pulse_date::text)
    AND (
      user_id = v_effective_user_id
      OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'error', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END IF;

  -- 6. Server-Side Question Verification (NO UNSAFE FALLBACK)
  -- If questions cannot be authoritatively verified, fail cleanly rather than trusting client points.
  SELECT COUNT(*)
  INTO v_questions_count
  FROM public.championship_pulse_questions
  WHERE pulse_set_id = v_pulse_set.id;

  IF v_questions_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unable to verify Pulse questions on the server.',
      'message', 'Submission could not be verified. Please refresh and try again.'
    );
  END IF;

  -- 7. Authoritative Answer Evaluation Against championship_pulse_questions
  FOR v_q IN
    SELECT slot, correct_answer
    FROM public.championship_pulse_questions
    WHERE pulse_set_id = v_pulse_set.id
    ORDER BY slot ASC
  LOOP
    IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'array' THEN
      v_user_ans := (p_answers->>v_idx)::integer;
    ELSE
      v_user_ans := -1;
    END IF;

    v_correct_letter := upper(trim(coalesce(v_q.correct_answer, 'A')));
    v_correct_idx := CASE v_correct_letter
      WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3
      WHEN '0' THEN 0 WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3
      ELSE 0
    END;

    IF v_user_ans IS NOT NULL AND v_user_ans = v_correct_idx THEN
      v_correct_count := v_correct_count + 1;
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  -- 8. Authoritative Scoring Logic for Legacy Submissions:
  -- NEVER trust client p_score, p_accuracy, or p_xp.
  -- DO NOT award speed bonus for legacy submissions (no server-side session start timestamp).
  -- Speed bonus is strictly 0. Max legacy score is 100, not 120.
  v_speed_bonus := 0;
  v_final_score := (v_correct_count * 20) + v_speed_bonus;
  v_final_accuracy := ROUND((v_correct_count::numeric / 5.0) * 100.0);
  v_final_xp := (v_correct_count * 50) + 50;

  -- Bounded client-reported time for audit record;
  -- v_effective_time is fixed to 300s (standard duration) to prevent forged 0s speed ranking advantage.
  v_client_reported_time := GREATEST(0, LEAST(300, COALESCE(p_time_taken_seconds, 300)));
  v_effective_time := 300;

  -- 9. Insert Attempt (review_status strictly 'flagged' for legacy audit, no disqualification)
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id,
      pulse_date,
      user_id,
      user_email,
      student_name,
      college,
      batch,
      score,
      accuracy,
      time_taken_seconds,
      completion_time,
      xp,
      answers,
      completed_at,
      submitted_at,
      created_at,
      medical_college_id,
      review_status,
      admin_notes
    ) VALUES (
      v_pulse_set.id::text,
      v_pulse_set.pulse_date::text,
      v_effective_user_id,
      v_effective_user_email,
      v_effective_student_name,
      v_canonical_college,
      v_canonical_batch,
      v_final_score,
      v_final_accuracy,
      v_effective_time,
      v_client_reported_time,
      v_final_xp,
      p_answers,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at,
      v_resolved_college_id,
      'flagged',
      'Legacy client submission during anti-cheat migration transition; server verified answers, speed bonus disabled.'
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE (pulse_id = v_pulse_set.id::text OR pulse_date = v_pulse_set.pulse_date::text)
      AND (
        user_id = v_effective_user_id
        OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
      )
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'error', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END;

  -- 10. Upsert into championship_leaderboard (using server-derived score/accuracy/XP only)
  INSERT INTO public.championship_leaderboard (
    pulse_id,
    user_id,
    user_email,
    student_name,
    college,
    batch,
    score,
    accuracy,
    time_taken_seconds,
    submitted_at,
    updated_at,
    medical_college_id
  ) VALUES (
    v_pulse_set.id::text,
    v_effective_user_id,
    v_effective_user_email,
    v_effective_student_name,
    v_canonical_college,
    v_canonical_batch,
    v_final_score,
    v_final_accuracy,
    v_effective_time,
    v_submitted_at,
    v_submitted_at,
    v_resolved_college_id
  )
  ON CONFLICT (user_id, pulse_id) DO UPDATE SET
    score = EXCLUDED.score,
    accuracy = EXCLUDED.accuracy,
    time_taken_seconds = EXCLUDED.time_taken_seconds,
    college = EXCLUDED.college,
    batch = EXCLUDED.batch,
    medical_college_id = EXCLUDED.medical_college_id,
    updated_at = v_submitted_at;

  -- 11. Re-rank Individual Leaderboard
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC
    ) AS calculated_rank
    FROM public.championship_leaderboard
    WHERE pulse_id = v_pulse_set.id::text
  )
  UPDATE public.championship_leaderboard l
  SET rank = r.calculated_rank
  FROM ranked r
  WHERE l.id = r.id;

  -- 12. Recalculate College Standings
  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    v_pulse_set.id::text,
    l.college,
    COALESCE(
      (
        SELECT mc.id FROM public.medical_colleges mc 
        WHERE lower(mc.college_name) = lower(trim(l.college))
        ORDER BY mc.created_at ASC, mc.id ASC
        LIMIT 1
      ),
      CASE 
        WHEN COUNT(DISTINCT l.medical_college_id) = 1 
        THEN (array_remove(array_agg(DISTINCT l.medical_college_id), NULL))[1]
        ELSE NULL
      END
    ) AS medical_college_id,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    (
      SELECT student_name FROM public.championship_leaderboard l2
      WHERE l2.pulse_id = v_pulse_set.id::text AND l2.college = l.college
      ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
    ) AS top_scorer,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_pulse_set.id::text
  GROUP BY l.college
  ON CONFLICT (college, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    top_scorer = EXCLUDED.top_scorer,
    medical_college_id = COALESCE(EXCLUDED.medical_college_id, championship_college_standings.medical_college_id),
    updated_at = v_submitted_at;

  -- Re-rank college standings
  WITH ranked_colleges AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id 
      ORDER BY total_score DESC, avg_accuracy DESC
    ) AS calculated_rank
    FROM public.championship_college_standings
    WHERE pulse_id = v_pulse_set.id::text
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

  -- 13. Recalculate Batch Standings
  INSERT INTO public.championship_batch_standings (
    pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
  )
  SELECT
    v_pulse_set.id::text,
    l.batch,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_pulse_set.id::text
  GROUP BY l.batch
  ON CONFLICT (batch, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    updated_at = v_submitted_at;

  -- Re-rank batch standings
  WITH ranked_batches AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id 
      ORDER BY total_score DESC, avg_score DESC
    ) AS calculated_rank
    FROM public.championship_batch_standings
    WHERE pulse_id = v_pulse_set.id::text
  )
  UPDATE public.championship_batch_standings bs
  SET rank = rb.calculated_rank
  FROM ranked_batches rb
  WHERE bs.id = rb.id;

  RETURN jsonb_build_object(
    'success', true,
    'already_submitted', false,
    'attempt_id', v_new_attempt_id,
    'score', v_final_score,
    'accuracy', v_final_accuracy,
    'canonical_college', v_canonical_college
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pulse_attempt_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, UUID
) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, UUID
) TO authenticated, service_role;

-- ── 9. RPC: ADMINISTRATIVE REVIEW OF PULSE ATTEMPT ─────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_review_pulse_attempt(
  p_attempt_id UUID,
  p_review_status TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_target_status TEXT;
  v_updated_rows INTEGER;
BEGIN
  -- 1. Authorization check
  v_is_admin := public.is_admin() OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin privileges required to review pulse attempts.'
    );
  END IF;

  v_target_status := lower(trim(coalesce(p_review_status, '')));

  -- 2. Validate status transition (ONLY the 4 valid states)
  IF v_target_status NOT IN ('unreviewed', 'flagged', 'cleared', 'disqualified') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid review status. Allowed states: unreviewed, flagged, cleared, disqualified.'
    );
  END IF;

  -- 3. Update attempt record
  UPDATE public.championship_pulse_attempts
  SET review_status = v_target_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      admin_notes = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_attempt_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Attempt record not found.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'attempt_id', p_attempt_id,
    'review_status', v_target_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_pulse_attempt(UUID, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_review_pulse_attempt(UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
