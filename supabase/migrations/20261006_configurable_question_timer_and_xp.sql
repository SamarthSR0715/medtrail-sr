-- ==============================================================================
-- Migration: 20261006_configurable_question_timer_and_xp.sql
-- Description:
--   CONFIGURABLE QUESTION TIMER & XP VALUES (SERVER-AUTHORITATIVE)
--
-- Core Architecture Principles:
--   1. Schema Evolution:
--      - Adds `time_limit_seconds INTEGER NOT NULL DEFAULT 60` to `championship_pulse_questions`.
--      - Ensures `xp_value` (already present) defaults to 50 and is non-negative.
--      - Enforces idempotent check constraints:
--          * time_limit_seconds > 0 (positive integer)
--          * xp_value >= 0 (non-negative integer)
--   2. Backward Compatibility:
--      - Existing questions without explicit timer default to 60 seconds.
--      - Existing questions without explicit XP default to 50 XP.
--      - Does NOT mutate existing live attempts, rankings, or scores.
--   3. Server-Authoritative Question Handshake:
--      - `start_pulse_session_atomic` reads per-question timer and XP from database.
--      - Computes total session duration dynamically (sum of question time limits).
--      - Dynamically sets session expiration window (total duration + 60s network/render buffer).
--      - Sanitizes question payload (strictly hides correct_answer and explanation).
--   4. Submission & Scoring Integrity:
--      - Preserves EXACT MedTrailSR scoring formula:
--          speed_bonus = GREATEST(0, 20 - FLOOR(time_taken_seconds / 5))
--          score = (correct_count * 20) + speed_bonus
--          accuracy = (correct_count / 5) * 100
--          xp = (correct_count * 50) + 50
--      - Client cannot submit or alter XP, timer, score, accuracy, or speed bonus.
--   5. Admin Publishing Persistence:
--      - `publish_pulse_set_atomic` atomically writes both `xp_value` and `time_limit_seconds`.
-- ==============================================================================

BEGIN;

-- ── 1. SCHEMA EVOLUTION: championship_pulse_questions ─────────────────────────

-- A. Add time_limit_seconds column with default 60
ALTER TABLE public.championship_pulse_questions
  ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER NOT NULL DEFAULT 60;

-- B. Ensure sensible check constraints idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pulse_question_time_limit'
  ) THEN
    ALTER TABLE public.championship_pulse_questions
      ADD CONSTRAINT chk_pulse_question_time_limit
      CHECK (time_limit_seconds > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pulse_question_xp_value'
  ) THEN
    ALTER TABLE public.championship_pulse_questions
      ADD CONSTRAINT chk_pulse_question_xp_value
      CHECK (xp_value >= 0);
  END IF;
END $$;

-- ── 2. ADMIN RPC: publish_pulse_set_atomic (WITH TIMER & XP PERSISTENCE) ──────

CREATE OR REPLACE FUNCTION public.publish_pulse_set_atomic(
  p_pulse_date text,
  p_questions jsonb,
  p_status text DEFAULT 'published',
  p_admin_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_authorized boolean := false;
  v_pulse_set_id uuid;
  v_q jsonb;
  v_slot int := 1;
  v_now timestamptz := now();
  v_questions_count int := 0;
  v_caller_email text;
  v_parsed_date date;
BEGIN
  -- 1. Check authorization
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR auth.role() = 'service_role' THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized AND public.is_admin() THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    v_caller_email := lower(coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email', ''));
    IF v_caller_email = 'samarthrautrao715@gmail.com' THEN
      v_is_authorized := true;
    ELSIF auth.uid() IS NOT NULL THEN
      IF exists (select 1 from auth.users where id = auth.uid() and lower(email) = 'samarthrautrao715@gmail.com') THEN
        v_is_authorized := true;
      END IF;
    ELSIF p_admin_email IS NOT NULL AND lower(trim(p_admin_email)) = 'samarthrautrao715@gmail.com' THEN
      IF auth.role() = 'service_role' OR current_setting('request.jwt.claim.role', true) IN ('admin', 'service_role') THEN
        v_is_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    IF ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS TRUE)
       OR ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean IS TRUE)
    THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin privileges required to publish pulse questions.'
    );
  END IF;

  -- 2. Validate inputs
  IF p_pulse_date IS NULL OR trim(p_pulse_date) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pulse_date.');
  END IF;

  BEGIN
    v_parsed_date := trim(p_pulse_date)::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pulse_date format. Expected YYYY-MM-DD.');
  END;

  IF p_questions IS NULL OR jsonb_array_length(p_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Questions list cannot be empty.');
  END IF;

  -- 3. Atomic UPSERT into championship_pulse_sets
  INSERT INTO public.championship_pulse_sets (
    pulse_date,
    status,
    questions,
    published_at,
    updated_at
  )
  VALUES (
    v_parsed_date,
    coalesce(nullif(trim(p_status), ''), 'published'),
    p_questions,
    v_now,
    v_now
  )
  ON CONFLICT (pulse_date) DO UPDATE SET
    status = EXCLUDED.status,
    questions = EXCLUDED.questions,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_pulse_set_id;

  -- 4. Delete old rows from championship_pulse_questions for this pulse_set_id
  DELETE FROM public.championship_pulse_questions
  WHERE pulse_set_id = v_pulse_set_id;

  -- 5. Insert new rows into championship_pulse_questions with xp_value and time_limit_seconds
  v_slot := 1;
  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO public.championship_pulse_questions (
      pulse_set_id,
      pulse_date,
      slot,
      question,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer,
      explanation,
      subject,
      difficulty,
      xp_value,
      time_limit_seconds
    )
    VALUES (
      v_pulse_set_id,
      v_parsed_date,
      coalesce((v_q->>'slot')::int, v_slot),
      coalesce(v_q->>'question', ''),
      coalesce(v_q->>'option_a', v_q->>'optionA', ''),
      coalesce(v_q->>'option_b', v_q->>'optionB', ''),
      coalesce(v_q->>'option_c', v_q->>'optionC', ''),
      coalesce(v_q->>'option_d', v_q->>'optionD', ''),
      upper(coalesce(v_q->>'correct_answer', v_q->>'correctAnswer', 'A')),
      coalesce(v_q->>'explanation', ''),
      CASE 
        WHEN coalesce(v_q->>'subject', '') IN ('Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'General')
        THEN v_q->>'subject'
        ELSE 'General'
      END,
      CASE
        WHEN coalesce(v_q->>'difficulty', '') IN ('Easy', 'Medium', 'Hard')
        THEN v_q->>'difficulty'
        ELSE 'Medium'
      END,
      GREATEST(0, coalesce((v_q->>'xp_value')::integer, (v_q->>'xp')::integer, 50)),
      GREATEST(1, coalesce((v_q->>'time_limit_seconds')::integer, (v_q->>'timeLimitSeconds')::integer, 60))
    );
    v_slot := v_slot + 1;
    v_questions_count := v_questions_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'pulse_id', v_pulse_set_id,
    'pulse_date', v_parsed_date::text,
    'status', coalesce(nullif(trim(p_status), ''), 'published'),
    'published_at', v_now,
    'questions_count', v_questions_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_pulse_set_atomic(TEXT, JSONB, TEXT, TEXT) TO anon, authenticated, service_role;

-- ── 3. STUDENT RPC: start_pulse_session_atomic (WITH DYNAMIC TIMER & XP) ───────

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

COMMIT;
