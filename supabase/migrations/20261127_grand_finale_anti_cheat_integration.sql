-- ================================================================================
-- MIGRATION: 20261127_grand_finale_anti_cheat_integration.sql
--
-- PURPOSE:
--   Integrates MedTrailSR Grand Finale (Format B) into the existing Daily Pulse
--   anti-cheat infrastructure (from 20261005_anti_cheat_production_system.sql)
--   WITHOUT creating any duplicate anti-cheat table, parallel scoring engine,
--   or separate surveillance dashboard:
--   1. Extends existing public.championship_anti_cheat_events with:
--      - competition_type ('daily_pulse' | 'grand_finale')
--      - pulse_session_id / finale_session_id scoped FKs + unified session_id
--      - finale_code & is_test isolation flag
--   2. Adds matching passive integrity & review columns to
--      public.championship_finale_sessions and public.championship_finale_attempts.
--   3. Upgrades log_anti_cheat_events_batch(UUID, JSONB) &
--      admin_review_pulse_attempt(UUID, TEXT, TEXT) to handle both Daily Pulse and
--      Grand Finale attempts with identical server-side heuristics and RBAC.
--   4. Upgrades trg_fn_finale_attempt_immutable() so ONLY verified admins /
--      service_role can transition review columns (review_status, reviewed_by,
--      reviewed_at, admin_notes) while keeping score, accuracy, answers,
--      elapsed_seconds, and user/seat identity 100% immutable.
--   5. Adds server-side integrity logging to start_finale_pulse_session_atomic &
--      submit_finale_pulse_attempt_atomic (resume tracking, device-mismatch audit,
--      zero-telemetry passive flag, automatic 'flagged' transition at risk >= 50).
--   6. Preserves 100% Daily Pulse behavior, Classic Crew test isolation, RLS, and
--      explicit Data API privilege boundaries.
-- ================================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. EXTEND EXISTING SESSIONS & ATTEMPTS TABLES FOR UNIFIED INTEGRITY TRACKING
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.championship_finale_sessions
  ADD COLUMN IF NOT EXISTS risk_score             NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level             TEXT        NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS telemetry_events_count INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconnect_count        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.championship_finale_sessions
  DROP CONSTRAINT IF EXISTS chk_finale_sessions_risk_level,
  ADD CONSTRAINT chk_finale_sessions_risk_level
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE public.championship_finale_attempts
  ADD COLUMN IF NOT EXISTS risk_score      NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level      TEXT        NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS integrity_flags JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status   TEXT        NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS reviewed_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes     TEXT;

ALTER TABLE public.championship_finale_attempts
  DROP CONSTRAINT IF EXISTS chk_finale_attempts_risk_level,
  ADD CONSTRAINT chk_finale_attempts_risk_level
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  DROP CONSTRAINT IF EXISTS chk_finale_attempts_review_status,
  ADD CONSTRAINT chk_finale_attempts_review_status
    CHECK (review_status IN ('unreviewed', 'flagged', 'cleared', 'disqualified'));

CREATE INDEX IF NOT EXISTS idx_finale_attempts_review_status
  ON public.championship_finale_attempts (review_status, is_test, submitted_at DESC);

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. EXTEND EXISTING championship_anti_cheat_events TABLE (NO PARALLEL TABLE)
-- ════════════════════════════════════════════════════════════════════════════════

-- Drop the pulse-only foreign key on session_id and replace with scoped FKs
-- while retaining unified session_id indexing for shared admin timeline queries.
DO $drop_ac_pulse_fk$
DECLARE
  v_fk_name TEXT;
BEGIN
  FOR v_fk_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_anti_cheat_events'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.championship_pulse_sessions'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.championship_anti_cheat_events DROP CONSTRAINT %I', v_fk_name);
  END LOOP;
END;
$drop_ac_pulse_fk$;

ALTER TABLE public.championship_anti_cheat_events
  ADD COLUMN IF NOT EXISTS competition_type  TEXT    NOT NULL DEFAULT 'daily_pulse',
  ADD COLUMN IF NOT EXISTS pulse_session_id  UUID    REFERENCES public.championship_pulse_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS finale_session_id UUID    REFERENCES public.championship_finale_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS finale_code       TEXT,
  ADD COLUMN IF NOT EXISTS is_test           BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing Daily Pulse telemetry rows safely
UPDATE public.championship_anti_cheat_events
SET pulse_session_id = session_id
WHERE competition_type = 'daily_pulse'
  AND pulse_session_id IS NULL;

ALTER TABLE public.championship_anti_cheat_events
  DROP CONSTRAINT IF EXISTS chk_ac_events_competition_type,
  ADD CONSTRAINT chk_ac_events_competition_type
    CHECK (competition_type IN ('daily_pulse', 'grand_finale')),
  DROP CONSTRAINT IF EXISTS chk_ac_events_session_link,
  ADD CONSTRAINT chk_ac_events_session_link
    CHECK (
      (competition_type = 'daily_pulse' AND pulse_session_id = session_id AND finale_session_id IS NULL AND is_test = false)
      OR
      (competition_type = 'grand_finale' AND finale_session_id = session_id AND pulse_session_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_champ_ac_comp_type
  ON public.championship_anti_cheat_events (competition_type, is_test, server_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_champ_ac_finale_code
  ON public.championship_anti_cheat_events (finale_code, server_timestamp DESC)
  WHERE competition_type = 'grand_finale';

-- Allow both Daily Pulse admins and verified Finale admins to inspect telemetry
DROP POLICY IF EXISTS "Admins select anti cheat events" ON public.championship_anti_cheat_events;
CREATE POLICY "Admins select anti cheat events"
  ON public.championship_anti_cheat_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR public.is_finale_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- Also ensure is_finale_admin() can view Pulse sessions/attempts if inspecting mixed view,
-- without reducing protections for students or anon.
REVOKE ALL ON TABLE public.championship_anti_cheat_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_anti_cheat_events TO authenticated;
GRANT ALL ON TABLE public.championship_anti_cheat_events TO service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. UPGRADE FINALE ATTEMPT IMMUTABILITY TRIGGER FOR ADMIN REVIEW DECISIONS ONLY
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_finale_attempt_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FINALE_ATTEMPT_IMMUTABLE: Grand Finale attempts cannot be deleted.';
  END IF;

  -- Allow ONLY verified admins or service_role to update review metadata columns,
  -- while strictly forbidding any alteration to scores, answers, timing, or identity.
  IF (
    current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
    OR public.is_finale_admin()
    OR public.is_admin()
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.finale_code IS DISTINCT FROM OLD.finale_code
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.seat_number IS DISTINCT FROM OLD.seat_number
       OR NEW.student_name IS DISTINCT FROM OLD.student_name
       OR NEW.college IS DISTINCT FROM OLD.college
       OR NEW.batch IS DISTINCT FROM OLD.batch
       OR NEW.score IS DISTINCT FROM OLD.score
       OR NEW.accuracy IS DISTINCT FROM OLD.accuracy
       OR NEW.correct_count IS DISTINCT FROM OLD.correct_count
       OR NEW.elapsed_seconds IS DISTINCT FROM OLD.elapsed_seconds
       OR NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.is_test IS DISTINCT FROM OLD.is_test
       OR NEW.device_id IS DISTINCT FROM OLD.device_id
       OR NEW.risk_score IS DISTINCT FROM OLD.risk_score
       OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
       OR NEW.integrity_flags IS DISTINCT FROM OLD.integrity_flags
    THEN
      RAISE EXCEPTION 'FINALE_ATTEMPT_IMMUTABLE: Scores, answers, timing, risk score, and identity are permanently immutable.';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'FINALE_ATTEMPT_IMMUTABLE: Grand Finale attempts cannot be modified after submission.';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_attempt_immutable() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. UPGRADE EXISTING BATCH TELEMETRY RPC FOR BOTH DAILY PULSE & GRAND FINALE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_anti_cheat_events_batch(
  p_session_id UUID,
  p_events     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID;
  v_is_service     BOOLEAN;
  v_comp_type      TEXT;
  v_pulse_session  RECORD;
  v_finale_session RECORD;
  v_session_uid    UUID;
  v_session_status TEXT;
  v_cur_risk       NUMERIC := 0;
  v_cur_ev_count   INTEGER := 0;
  v_finale_code    TEXT    := NULL;
  v_is_test        BOOLEAN := false;
  v_event          JSONB;
  v_inserted_count INTEGER := 0;
  v_total_events   INTEGER;
  v_event_type     TEXT;
  v_duration_ms    NUMERIC;
  v_client_ts      TIMESTAMPTZ;
  v_risk_delta     NUMERIC := 0;
  v_new_risk       NUMERIC;
  v_new_risk_level TEXT;
BEGIN
  v_caller_uid := auth.uid();
  v_is_service := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');

  IF v_caller_uid IS NULL AND NOT v_is_service THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  -- 1A. Look up Daily Pulse session first
  SELECT id, user_id, status, risk_score, telemetry_events_count
  INTO v_pulse_session
  FROM public.championship_pulse_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_pulse_session.id IS NOT NULL THEN
    v_comp_type      := 'daily_pulse';
    v_session_uid    := v_pulse_session.user_id;
    v_session_status := v_pulse_session.status;
    v_cur_risk       := COALESCE(v_pulse_session.risk_score, 0);
    v_cur_ev_count   := COALESCE(v_pulse_session.telemetry_events_count, 0);

    IF v_caller_uid IS NOT NULL AND v_session_uid <> v_caller_uid AND NOT public.is_admin() THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
    END IF;
  ELSE
    -- 1B. Fall back to Grand Finale session
    SELECT id, user_id, finale_code, status, is_test, risk_score, telemetry_events_count
    INTO v_finale_session
    FROM public.championship_finale_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_finale_session.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'SESSION_NOT_FOUND');
    END IF;

    v_comp_type      := 'grand_finale';
    v_session_uid    := v_finale_session.user_id;
    v_session_status := v_finale_session.status;
    v_finale_code    := v_finale_session.finale_code;
    v_is_test        := COALESCE(v_finale_session.is_test, false);
    v_cur_risk       := COALESCE(v_finale_session.risk_score, 0);
    v_cur_ev_count   := COALESCE(v_finale_session.telemetry_events_count, 0);

    IF v_caller_uid IS NOT NULL
       AND v_session_uid <> v_caller_uid
       AND NOT public.is_finale_admin()
       AND NOT public.is_admin()
    THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
    END IF;
  END IF;

  IF v_session_status NOT IN ('active', 'submitted') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SESSION_INACTIVE');
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('success', true, 'logged_count', 0, 'competition_type', v_comp_type);
  END IF;

  v_total_events := jsonb_array_length(p_events);
  IF v_total_events = 0 THEN
    RETURN jsonb_build_object('success', true, 'logged_count', 0, 'competition_type', v_comp_type);
  END IF;

  IF v_total_events > 50 THEN
    v_total_events := 50;
  END IF;

  -- 2. Ingest telemetry & apply authoritative server-side heuristic weights
  --    (Client risk scores/deltas are NEVER accepted.)
  FOR i IN 0..(v_total_events - 1) LOOP
    v_event := p_events->i;
    v_event_type := upper(left(trim(coalesce(v_event->>'event_type', 'UNKNOWN')), 64));

    IF v_event_type = 'TAB_HIDDEN' OR v_event_type = 'TAB_SWITCH' OR v_event_type = 'FULLSCREEN_EXIT' THEN
      v_risk_delta := v_risk_delta + 10;
    ELSIF v_event_type = 'WINDOW_BLUR' OR v_event_type = 'PAGE_HIDDEN' THEN
      v_risk_delta := v_risk_delta + 5;
    ELSIF v_event_type IN ('COPY_ATTEMPT', 'PASTE_ATTEMPT') THEN
      v_risk_delta := v_risk_delta + 15;
    ELSIF v_event_type IN ('DEVTOOLS_OPENED', 'SCRIPT_INJECTION', 'EXTENSION_TAMPERING', 'DEBUGGER_HALTED') THEN
      v_risk_delta := v_risk_delta + 25;
    ELSIF v_event_type = 'HEARTBEAT_JITTER' THEN
      v_risk_delta := v_risk_delta + 5;
    END IF;

    v_duration_ms := NULL;
    BEGIN
      IF NULLIF(trim(coalesce(v_event->>'duration_ms', '')), '') IS NOT NULL THEN
        v_duration_ms := GREATEST(0, (v_event->>'duration_ms')::numeric);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_duration_ms := NULL;
    END;

    v_client_ts := NULL;
    BEGIN
      IF NULLIF(trim(coalesce(v_event->>'client_timestamp', '')), '') IS NOT NULL THEN
        v_client_ts := (v_event->>'client_timestamp')::timestamptz;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_client_ts := NULL;
    END;

    INSERT INTO public.championship_anti_cheat_events (
      session_id,
      pulse_session_id,
      finale_session_id,
      competition_type,
      finale_code,
      is_test,
      user_id,
      event_type,
      client_timestamp,
      duration_ms,
      metadata,
      server_timestamp
    ) VALUES (
      p_session_id,
      CASE WHEN v_comp_type = 'daily_pulse' THEN p_session_id ELSE NULL END,
      CASE WHEN v_comp_type = 'grand_finale' THEN p_session_id ELSE NULL END,
      v_comp_type,
      v_finale_code,
      v_is_test,
      v_session_uid,
      v_event_type,
      v_client_ts,
      v_duration_ms,
      COALESCE(v_event->'metadata', '{}'::jsonb) - 'risk_score' - 'risk_level',
      clock_timestamp()
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  -- 3. Accumulate passive risk cleanly on the authoritative session row
  v_new_risk := LEAST(100, v_cur_risk + v_risk_delta);
  v_new_risk_level := CASE
    WHEN v_new_risk >= 70 THEN 'critical'
    WHEN v_new_risk >= 45 THEN 'high'
    WHEN v_new_risk >= 20 THEN 'medium'
    ELSE 'low'
  END;

  IF v_comp_type = 'daily_pulse' THEN
    UPDATE public.championship_pulse_sessions
    SET telemetry_events_count = v_cur_ev_count + v_inserted_count,
        last_heartbeat_at      = clock_timestamp(),
        risk_score             = v_new_risk,
        risk_level             = v_new_risk_level,
        updated_at             = clock_timestamp()
    WHERE id = p_session_id;
  ELSE
    UPDATE public.championship_finale_sessions
    SET telemetry_events_count = v_cur_ev_count + v_inserted_count,
        last_heartbeat_at      = clock_timestamp(),
        risk_score             = v_new_risk,
        risk_level             = v_new_risk_level,
        updated_at             = clock_timestamp()
    WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object(
    'success',          true,
    'competition_type', v_comp_type,
    'logged_count',     v_inserted_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',    false,
    'error_code', 'LOG_ERROR',
    'message',    SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_anti_cheat_events_batch(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_anti_cheat_events_batch(UUID, JSONB) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. UPGRADE EXISTING ADMIN REVIEW RPC FOR BOTH DAILY PULSE & GRAND FINALE
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_review_pulse_attempt(
  p_attempt_id    UUID,
  p_review_status TEXT,
  p_admin_notes   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin      BOOLEAN;
  v_target_status TEXT;
  v_updated_rows  INTEGER := 0;
BEGIN
  v_is_admin := public.is_admin()
                OR public.is_finale_admin()
                OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Unauthorized: Admin privileges required to review competition attempts.'
    );
  END IF;

  v_target_status := lower(trim(coalesce(p_review_status, '')));
  IF v_target_status NOT IN ('unreviewed', 'flagged', 'cleared', 'disqualified') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Invalid review status. Allowed states: unreviewed, flagged, cleared, disqualified.'
    );
  END IF;

  -- 1. Update Daily Pulse attempt if found
  UPDATE public.championship_pulse_attempts
  SET review_status = v_target_status,
      reviewed_by   = auth.uid(),
      reviewed_at   = clock_timestamp(),
      admin_notes   = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_attempt_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows > 0 THEN
    RETURN jsonb_build_object(
      'success',          true,
      'competition_type', 'daily_pulse',
      'attempt_id',       p_attempt_id,
      'review_status',    v_target_status
    );
  END IF;

  -- 2. Otherwise update official Grand Finale attempt
  UPDATE public.championship_finale_attempts
  SET review_status = v_target_status,
      reviewed_by   = auth.uid(),
      reviewed_at   = clock_timestamp(),
      admin_notes   = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_attempt_id
    AND is_test = false;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows > 0 THEN
    RETURN jsonb_build_object(
      'success',          true,
      'competition_type', 'grand_finale',
      'attempt_id',       p_attempt_id,
      'review_status',    v_target_status
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'error',   'Attempt record not found (or is an isolated test run).'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_pulse_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_pulse_attempt(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. INTEGRATE SERVER-SIDE ANTI-CHEAT AUDITING INTO GRAND FINALE START & SUBMIT
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.start_finale_pulse_session_atomic(
  p_finale_code TEXT DEFAULT NULL,
  p_device_id   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_auth_user      RECORD;
  v_caller_email   TEXT;
  v_code           TEXT        := public.resolve_current_finale_code(p_finale_code);
  v_device_id      TEXT        := trim(coalesce(p_device_id, ''));
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_finalist       public.championship_finale_approved_roster%ROWTYPE;
  v_tester         public.championship_finale_test_access%ROWTYPE;
  v_test_device    public.championship_finale_test_devices%ROWTYPE;
  v_is_test        BOOLEAN     := false;
  v_set            public.championship_finale_sets%ROWTYPE;
  v_existing_att   RECORD;
  v_session        public.championship_finale_sessions%ROWTYPE;
  v_session_id     UUID;
  v_inserted_fresh BOOLEAN     := false;
  v_questions_safe JSONB       := '[]'::jsonb;
  v_q              JSONB;
  v_idx            INTEGER     := 0;
  v_q_points       INTEGER;
  v_max_score      INTEGER     := 0;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF char_length(v_device_id) < 8 OR char_length(v_device_id) > 128 THEN
    RETURN jsonb_build_object(
      'success', false,
      'device_required', true,
      'error', 'Valid device identifier is required for Grand Finale access.'
    );
  END IF;

  SELECT id, lower(trim(coalesce(email, ''))) AS email, email_confirmed_at, banned_until
  INTO v_auth_user
  FROM auth.users
  WHERE id = v_caller_uid;

  IF v_auth_user.id IS NULL OR v_auth_user.email_confirmed_at IS NULL
     OR (v_auth_user.banned_until IS NOT NULL AND v_auth_user.banned_until > v_now)
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verified active account required.');
  END IF;

  v_caller_email := v_auth_user.email;

  SELECT * INTO v_finalist
  FROM public.championship_finale_approved_roster
  WHERE seat_number BETWEEN 1 AND 10
    AND (
      (user_id IS NOT NULL AND user_id = v_caller_uid)
      OR
      (user_id IS NULL AND v_caller_email <> '' AND lower(trim(email)) = v_caller_email)
    )
  LIMIT 1;

  IF v_finalist.id IS NOT NULL THEN
    v_is_test := false;

    IF v_finalist.user_id IS NULL THEN
      UPDATE public.championship_finale_approved_roster
      SET user_id = v_caller_uid, updated_at = v_now
      WHERE id = v_finalist.id AND user_id IS NULL;

      IF NOT FOUND THEN
        SELECT * INTO v_finalist FROM public.championship_finale_approved_roster WHERE id = v_finalist.id;
        IF v_finalist.user_id IS DISTINCT FROM v_caller_uid THEN
          RETURN jsonb_build_object('success', false, 'error', 'Finalist seat was already claimed by another user ID.');
        END IF;
      ELSE
        v_finalist.user_id := v_caller_uid;
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_tester
    FROM public.championship_finale_test_access
    WHERE user_id = v_caller_uid
      AND is_active = true
      AND lower(trim(email)) = v_caller_email
    LIMIT 1;

    IF v_tester.id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'not_finalist', true,
        'error', 'Access restricted. Only the 10 approved Grand Finale finalists may participate.'
      );
    END IF;

    v_is_test := true;

    SELECT * INTO v_test_device
    FROM public.championship_finale_test_devices
    WHERE user_id = v_caller_uid
      AND device_id = v_device_id
    LIMIT 1;

    IF v_test_device.id IS NULL OR NOT v_test_device.is_authorized OR v_test_device.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'is_test', true,
        'test_device_unauthorized', true,
        'device_pending', (v_test_device.id IS NOT NULL AND NOT v_test_device.is_authorized AND v_test_device.revoked_at IS NULL),
        'error', CASE
          WHEN v_test_device.id IS NULL THEN 'This test device is not registered/authorized. Register this device and obtain admin approval.'
          WHEN v_test_device.revoked_at IS NOT NULL THEN 'Access for this test device has been revoked by the administrator.'
          ELSE 'This test device is awaiting admin authorization in Grand Finale Ops.'
        END
      );
    END IF;

    UPDATE public.championship_finale_test_devices
    SET last_seen_at = v_now
    WHERE id = v_test_device.id;
  END IF;

  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR SHARE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'is_test', v_is_test, 'error', 'Grand Finale question bank is not configured yet.');
  END IF;

  IF NOT v_is_test THEN
    IF v_set.status = 'published' THEN
      RETURN jsonb_build_object(
        'success',      false,
        'waiting_room', true,
        'event_status', 'published',
        'finale_code',  v_code,
        'seat_number',  v_finalist.seat_number,
        'student_name', v_finalist.student_name,
        'error',        'Your verified finalist seat #' || v_finalist.seat_number || ' is ready. Waiting for the administrator to Go Live.'
      );
    ELSIF v_set.status IN ('ended', 'archived', 'closed') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'event_ended',  true,
        'event_status', v_set.status,
        'finale_code',  v_code,
        'error',        'This Grand Finale session has ended.'
      );
    ELSIF v_set.status <> 'live' THEN
      RETURN jsonb_build_object(
        'success',      false,
        'event_status', v_set.status,
        'finale_code',  v_code,
        'error',        'The Grand Finale is not currently open.'
      );
    END IF;
  ELSE
    IF v_set.status IN ('ended', 'archived', 'closed') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'is_test',      true,
        'event_ended',  true,
        'event_status', v_set.status,
        'finale_code',  v_code,
        'error',        'This Grand Finale session has ended.'
      );
    ELSIF v_set.status IN ('draft', 'validated') OR (v_set.status = 'published' AND NOT v_tester.allow_pre_live) OR v_set.status NOT IN ('published', 'live') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'is_test',      true,
        'waiting_room', (v_set.status = 'published'),
        'event_status', v_set.status,
        'finale_code',  v_code,
        'error',        'Test access requires the 10-question Finale set to be published or live.'
      );
    END IF;
  END IF;

  IF v_set.question_count <> 10 OR jsonb_array_length(v_set.questions) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'is_test', v_is_test, 'error', 'Finale question bank is incomplete (10 questions required).');
  END IF;

  v_now := clock_timestamp();

  IF NOT v_is_test THEN
    SELECT id INTO v_existing_att
    FROM public.championship_finale_attempts
    WHERE user_id = v_caller_uid
      AND finale_code = v_code
      AND is_test = false;

    IF v_existing_att.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success',           false,
        'already_submitted', true,
        'finale_code',       v_code,
        'error',             'You have already completed this Grand Finale session. Only 1 attempt is permitted per session.'
      );
    END IF;

    INSERT INTO public.championship_finale_sessions (
      finale_code, finale_set_id, user_id, status, started_at, expires_at, updated_at, is_test, bound_device_id
    )
    VALUES (
      v_code, v_set.id, v_caller_uid, 'active', v_now, v_now + interval '90 seconds', v_now, false, v_device_id
    )
    ON CONFLICT (user_id, finale_code) WHERE is_test = false DO UPDATE
      SET updated_at = championship_finale_sessions.updated_at
    RETURNING id, (xmax = 0) INTO v_session_id, v_inserted_fresh;

    SELECT * INTO v_session
    FROM public.championship_finale_sessions
    WHERE user_id = v_caller_uid AND finale_code = v_code AND is_test = false
    FOR UPDATE;

    v_now := clock_timestamp();

    IF v_session.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Could not open examination session.');
    END IF;

    -- Server-side anti-cheat audit if device mismatch occurs (blocks bypass via 2nd browser/device)
    IF coalesce(v_session.bound_device_id, '') <> v_device_id THEN
      INSERT INTO public.championship_anti_cheat_events (
        session_id, pulse_session_id, finale_session_id, competition_type, finale_code, is_test,
        user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp
      )
      VALUES (
        v_session.id, NULL, v_session.id, 'grand_finale', v_code, false,
        v_caller_uid, 'DEVICE_MISMATCH_BLOCKED', v_now, NULL,
        jsonb_build_object('attempted_device_prefix', left(v_device_id, 12), 'phase', 'start_resume'),
        v_now
      );

      UPDATE public.championship_finale_sessions
      SET risk_score = LEAST(100, risk_score + 15),
          risk_level = CASE
            WHEN LEAST(100, risk_score + 15) >= 70 THEN 'critical'
            WHEN LEAST(100, risk_score + 15) >= 45 THEN 'high'
            WHEN LEAST(100, risk_score + 15) >= 20 THEN 'medium'
            ELSE 'low'
          END,
          telemetry_events_count = telemetry_events_count + 1,
          updated_at = v_now
      WHERE id = v_session.id;

      RETURN jsonb_build_object(
        'success',         false,
        'device_mismatch', true,
        'error',           'Device mismatch detected. Return to your original device to resume this examination.'
      );
    END IF;

    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'finale_code', v_code, 'error', 'You have already submitted this Grand Finale session.');
    END IF;

    IF v_session.status = 'expired' OR v_session.expires_at <= v_now THEN
      IF v_session.status <> 'expired' THEN
        UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_now WHERE id = v_session.id;
      END IF;
      RETURN jsonb_build_object('success', false, 'session_expired', true, 'error', 'Your 90-second examination window has expired.');
    END IF;

    IF v_session.status <> 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Examination session is not active.');
    END IF;

    -- Record server-side session start or reconnect event cleanly in unified telemetry table
    IF v_inserted_fresh THEN
      INSERT INTO public.championship_anti_cheat_events (
        session_id, pulse_session_id, finale_session_id, competition_type, finale_code, is_test,
        user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp
      )
      VALUES (
        v_session.id, NULL, v_session.id, 'grand_finale', v_code, false,
        v_caller_uid, 'SESSION_STARTED', v_now, NULL,
        jsonb_build_object('seat_number', v_finalist.seat_number, 'device_prefix', left(v_device_id, 12)),
        v_now
      );

      UPDATE public.championship_finale_sessions
      SET telemetry_events_count = telemetry_events_count + 1,
          last_heartbeat_at = v_now,
          updated_at = v_now
      WHERE id = v_session.id;
    ELSE
      UPDATE public.championship_finale_sessions
      SET reconnect_count = reconnect_count + 1,
          telemetry_events_count = telemetry_events_count + 1,
          last_heartbeat_at = v_now,
          updated_at = v_now
      WHERE id = v_session.id;

      INSERT INTO public.championship_anti_cheat_events (
        session_id, pulse_session_id, finale_session_id, competition_type, finale_code, is_test,
        user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp
      )
      VALUES (
        v_session.id, NULL, v_session.id, 'grand_finale', v_code, false,
        v_caller_uid, 'SESSION_RESUMED', v_now, NULL,
        jsonb_build_object('seat_number', v_finalist.seat_number, 'reconnect_number', v_session.reconnect_count + 1),
        v_now
      );
    END IF;
  ELSE
    INSERT INTO public.championship_finale_sessions (
      finale_code, finale_set_id, user_id, status, started_at, expires_at, updated_at, is_test, bound_device_id
    )
    VALUES (
      v_code, v_set.id, v_caller_uid, 'active', v_now, v_now + interval '90 seconds', v_now, true, v_device_id
    )
    ON CONFLICT (user_id, finale_code) WHERE is_test = true AND status = 'active' DO UPDATE
      SET updated_at = championship_finale_sessions.updated_at
    RETURNING id INTO v_session_id;

    SELECT * INTO v_session
    FROM public.championship_finale_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    v_now := clock_timestamp();

    IF v_session.id IS NULL THEN
      SELECT * INTO v_session
      FROM public.championship_finale_sessions
      WHERE user_id = v_caller_uid AND finale_code = v_code AND is_test = true AND status = 'active'
      FOR UPDATE;
    END IF;

    IF v_session.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'error', 'Could not start isolated test session.');
    END IF;

    IF v_session.expires_at <= v_now THEN
      UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_now WHERE id = v_session.id;
      RETURN jsonb_build_object(
        'success',         false,
        'is_test',         true,
        'session_expired', true,
        'error',           'Previous 90-second test window expired and has been closed. Click Retry Test Run to begin a fresh test session.'
      );
    END IF;

    IF coalesce(v_session.bound_device_id, '') <> v_device_id THEN
      RETURN jsonb_build_object(
        'success',         false,
        'is_test',         true,
        'device_mismatch', true,
        'error',           'Active test session is bound to another device. Complete or reset it from Grand Finale Ops.'
      );
    END IF;
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_idx := v_idx + 1;
    v_q_points := CASE WHEN coalesce(v_q->>'points', '') ~ '^\d+$' THEN (v_q->>'points')::integer ELSE 100 END;
    v_max_score := v_max_score + v_q_points;
    v_questions_safe := v_questions_safe || jsonb_build_object(
      'slot',       v_idx,
      'question',   coalesce(v_q->>'question', ''),
      'option_a',   coalesce(v_q->>'option_a', ''),
      'option_b',   coalesce(v_q->>'option_b', ''),
      'option_c',   coalesce(v_q->>'option_c', ''),
      'option_d',   coalesce(v_q->>'option_d', ''),
      'subject',    coalesce(v_q->>'subject', 'Clinical Medicine'),
      'difficulty', coalesce(v_q->>'difficulty', 'Medium'),
      'points',     v_q_points
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',          true,
    'is_test',          v_is_test,
    'finale_code',      v_code,
    'session_number',   v_set.session_number,
    'session_id',       v_session.id,
    'started_at',       v_session.started_at,
    'expires_at',       v_session.expires_at,
    'duration_seconds', 90,
    'max_score',        v_max_score,
    'seat_number',      CASE WHEN v_is_test THEN 0 ELSE v_finalist.seat_number END,
    'student_name',     CASE WHEN v_is_test THEN v_tester.display_name ELSE v_finalist.student_name END,
    'questions',        v_questions_safe
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.start_finale_pulse_session_atomic(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_finale_pulse_session_atomic(TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_finale_pulse_attempt_atomic(
  p_session_id UUID,
  p_answers    JSONB,
  p_device_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid      UUID        := auth.uid();
  v_device_id       TEXT        := trim(coalesce(p_device_id, ''));
  v_submitted_at    TIMESTAMPTZ;
  v_session         public.championship_finale_sessions%ROWTYPE;
  v_finalist        public.championship_finale_approved_roster%ROWTYPE;
  v_tester          public.championship_finale_test_access%ROWTYPE;
  v_test_device     public.championship_finale_test_devices%ROWTYPE;
  v_set             public.championship_finale_sets%ROWTYPE;
  v_elapsed         NUMERIC;
  v_q               JSONB;
  v_idx             INTEGER     := 0;
  v_user_ans        INTEGER;
  v_correct_letter  TEXT;
  v_correct_idx     INTEGER;
  v_correct_count   INTEGER     := 0;
  v_q_points        INTEGER;
  v_score           INTEGER     := 0;
  v_max_score       INTEGER     := 0;
  v_accuracy        NUMERIC;
  v_new_attempt_id  UUID;
  v_existing_att    RECORD;
  v_explanations    JSONB       := '[]'::jsonb;
  v_risk_score      NUMERIC     := 0;
  v_risk_level      TEXT        := 'low';
  v_review_status   TEXT        := 'unreviewed';
  v_integrity_flags JSONB       := '[]'::jsonb;
  v_client_ev_cnt   INTEGER     := 0;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF char_length(v_device_id) < 8 OR char_length(v_device_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'device_required', true, 'error', 'Valid device identifier is required.');
  END IF;

  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Examination session not found.');
  END IF;

  v_submitted_at := clock_timestamp();

  IF v_session.user_id <> v_caller_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ownership mismatch.');
  END IF;

  IF coalesce(v_session.bound_device_id, '') <> v_device_id THEN
    IF NOT v_session.is_test THEN
      INSERT INTO public.championship_anti_cheat_events (
        session_id, pulse_session_id, finale_session_id, competition_type, finale_code, is_test,
        user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp
      )
      VALUES (
        v_session.id, NULL, v_session.id, 'grand_finale', v_session.finale_code, false,
        v_caller_uid, 'DEVICE_MISMATCH_BLOCKED', v_submitted_at, NULL,
        jsonb_build_object('attempted_device_prefix', left(v_device_id, 12), 'phase', 'submit'),
        v_submitted_at
      );

      UPDATE public.championship_finale_sessions
      SET risk_score = LEAST(100, risk_score + 15),
          risk_level = CASE
            WHEN LEAST(100, risk_score + 15) >= 70 THEN 'critical'
            WHEN LEAST(100, risk_score + 15) >= 45 THEN 'high'
            WHEN LEAST(100, risk_score + 15) >= 20 THEN 'medium'
            ELSE 'low'
          END,
          telemetry_events_count = telemetry_events_count + 1,
          updated_at = v_submitted_at
      WHERE id = v_session.id;
    END IF;

    RETURN jsonb_build_object(
      'success',         false,
      'is_test',         v_session.is_test,
      'device_mismatch', true,
      'error',           'Device mismatch detected: submissions must originate from the locked session device.'
    );
  END IF;

  IF v_session.status <> 'active' THEN
    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'is_test', v_session.is_test, 'already_submitted', true, 'error', 'Session already submitted.');
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'is_test', v_session.is_test,
      'error',   'Submission rejected: examination session is not active (status: ' || v_session.status || ').'
    );
  END IF;

  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE id = v_session.finale_set_id
  FOR SHARE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question bank missing.');
  END IF;

  IF NOT v_session.is_test THEN
    IF v_set.status IN ('ended', 'archived', 'closed') THEN
      UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_submitted_at WHERE id = v_session.id;
      RETURN jsonb_build_object('success', false, 'event_ended', true, 'error', 'Submission rejected: Grand Finale session has already ended.');
    ELSIF v_set.status <> 'live' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Submission rejected: Grand Finale is not live.');
    END IF;
  ELSE
    IF v_set.status IN ('ended', 'archived', 'closed') THEN
      UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_submitted_at WHERE id = v_session.id;
      RETURN jsonb_build_object('success', false, 'is_test', true, 'event_ended', true, 'error', 'Submission rejected: Grand Finale session has ended.');
    ELSIF v_set.status NOT IN ('published', 'live') THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'error', 'Submission rejected: test set is unavailable.');
    END IF;
  END IF;

  IF NOT v_session.is_test THEN
    SELECT id INTO v_existing_att
    FROM public.championship_finale_attempts
    WHERE user_id = v_caller_uid
      AND finale_code = v_session.finale_code
      AND is_test = false;

    IF v_existing_att.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_existing_att.id);
    END IF;

    SELECT * INTO v_finalist
    FROM public.championship_finale_approved_roster
    WHERE user_id = v_caller_uid AND seat_number BETWEEN 1 AND 10;

    IF v_finalist.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: not in approved finalist roster.');
    END IF;
  ELSE
    SELECT * INTO v_tester
    FROM public.championship_finale_test_access
    WHERE user_id = v_caller_uid AND is_active = true;

    IF v_tester.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'error', 'Tester permission revoked.');
    END IF;

    SELECT * INTO v_test_device
    FROM public.championship_finale_test_devices
    WHERE user_id = v_caller_uid
      AND device_id = v_device_id
      AND is_authorized = true
      AND revoked_at IS NULL;

    IF v_test_device.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'test_device_unauthorized', true, 'error', 'Test device is no longer authorized.');
    END IF;
  END IF;

  IF v_submitted_at > (v_session.expires_at + interval '2.0 seconds') THEN
    IF NOT v_session.is_test THEN
      INSERT INTO public.championship_anti_cheat_events (
        session_id, pulse_session_id, finale_session_id, competition_type, finale_code, is_test,
        user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp
      )
      VALUES (
        v_session.id, NULL, v_session.id, 'grand_finale', v_session.finale_code, false,
        v_caller_uid, 'LATE_SUBMISSION_REJECTED', v_submitted_at, NULL,
        jsonb_build_object('seconds_overdue', ROUND(EXTRACT(EPOCH FROM (v_submitted_at - v_session.expires_at))::numeric, 2)),
        v_submitted_at
      );
    END IF;

    UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_submitted_at WHERE id = v_session.id;
    RETURN jsonb_build_object(
      'success',           false,
      'is_test',           v_session.is_test,
      'deadline_exceeded', true,
      'error',             'Submission rejected: 90-second server deadline has expired.'
    );
  END IF;

  v_elapsed := ROUND(
    LEAST(92.000, GREATEST(0.001, EXTRACT(EPOCH FROM (v_submitted_at - v_session.started_at)))),
    3
  );

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'is_test', v_session.is_test,
      'error',   'Malformed submission: exactly 10 answers required.'
    );
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_user_ans := (p_answers->>v_idx)::integer;
    IF v_user_ans IS NULL OR v_user_ans NOT IN (-1, 0, 1, 2, 3) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid answer value at slot ' || (v_idx + 1));
    END IF;

    v_correct_letter := upper(trim(coalesce(v_q->>'correct_answer', '')));
    IF v_correct_letter NOT IN ('A', 'B', 'C', 'D') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Question integrity error at slot ' || (v_idx + 1));
    END IF;

    v_q_points := CASE WHEN coalesce(v_q->>'points', '') ~ '^\d+$' THEN (v_q->>'points')::integer ELSE 100 END;
    v_max_score := v_max_score + v_q_points;

    v_correct_idx := CASE v_correct_letter WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3 END;
    IF v_user_ans = v_correct_idx THEN
      v_correct_count := v_correct_count + 1;
      v_score := v_score + v_q_points;
    END IF;

    v_explanations := v_explanations || jsonb_build_object(
      'slot',           v_idx + 1,
      'question',       coalesce(v_q->>'question', ''),
      'user_answer',    v_user_ans,
      'correct_answer', v_correct_letter,
      'explanation',    coalesce(v_q->>'explanation', ''),
      'points',         v_q_points
    );

    v_idx := v_idx + 1;
  END LOOP;

  v_accuracy := ROUND((v_correct_count::numeric / 10.0) * 100.0, 2);

  -- Passive Anti-Cheat Assessment (mirrors Daily Pulse; never alters score/accuracy/rank
  -- and never auto-disqualifies).
  v_risk_score := COALESCE(v_session.risk_score, 0);
  v_risk_level := COALESCE(v_session.risk_level, 'low');

  IF NOT v_session.is_test THEN
    SELECT count(*) INTO v_client_ev_cnt
    FROM public.championship_anti_cheat_events e
    WHERE e.session_id = v_session.id
      AND e.competition_type = 'grand_finale'
      AND e.event_type NOT IN ('SESSION_STARTED', 'SESSION_RESUMED', 'DEVICE_MISMATCH_BLOCKED', 'LATE_SUBMISSION_REJECTED');

    IF v_client_ev_cnt = 0 THEN
      v_integrity_flags := v_integrity_flags || to_jsonb('NO_CLIENT_TELEMETRY'::text);
    END IF;
    IF COALESCE(v_session.reconnect_count, 0) > 0 THEN
      v_integrity_flags := v_integrity_flags || to_jsonb('SESSION_RECONNECTED'::text);
    END IF;
    IF v_risk_score >= 50 THEN
      v_review_status := 'flagged';
      v_integrity_flags := v_integrity_flags || to_jsonb('AUTO_FLAGGED_HIGH_RISK'::text);
    END IF;
  END IF;

  IF NOT v_session.is_test THEN
    INSERT INTO public.championship_finale_attempts (
      session_id, finale_code, user_id, seat_number, student_name, college, batch,
      score, accuracy, correct_count, elapsed_seconds, answers, submitted_at, is_test, device_id,
      risk_score, risk_level, integrity_flags, review_status
    )
    VALUES (
      v_session.id, v_session.finale_code, v_caller_uid,
      v_finalist.seat_number, v_finalist.student_name, v_finalist.college, v_finalist.batch,
      v_score, v_accuracy, v_correct_count, v_elapsed, p_answers, v_submitted_at, false, v_device_id,
      v_risk_score, v_risk_level, v_integrity_flags, v_review_status
    )
    ON CONFLICT (user_id, finale_code) WHERE is_test = false DO NOTHING
    RETURNING id INTO v_new_attempt_id;

    IF v_new_attempt_id IS NULL THEN
      SELECT id INTO v_new_attempt_id
      FROM public.championship_finale_attempts
      WHERE user_id = v_caller_uid AND finale_code = v_session.finale_code AND is_test = false;
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_new_attempt_id);
    END IF;
  ELSE
    INSERT INTO public.championship_finale_attempts (
      session_id, finale_code, user_id, seat_number, student_name, college, batch,
      score, accuracy, correct_count, elapsed_seconds, answers, submitted_at, is_test, device_id,
      risk_score, risk_level, integrity_flags, review_status
    )
    VALUES (
      v_session.id, v_session.finale_code, v_caller_uid,
      0, v_tester.display_name || ' [TEST]', 'Isolated Test Environment', 'TEST',
      v_score, v_accuracy, v_correct_count, v_elapsed, p_answers, v_submitted_at, true, v_device_id,
      0, 'low', '["ISOLATED_TEST_RUN"]'::jsonb, 'unreviewed'
    )
    ON CONFLICT (session_id) DO NOTHING
    RETURNING id INTO v_new_attempt_id;

    IF v_new_attempt_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'already_submitted', true, 'error', 'Test session already submitted.');
    END IF;
  END IF;

  UPDATE public.championship_finale_sessions
  SET status = 'submitted', submitted_at = v_submitted_at, updated_at = v_submitted_at
  WHERE id = v_session.id;

  IF NOT v_session.is_test THEN
    PERFORM pg_advisory_xact_lock(hashtext('finale_leaderboard_' || v_session.finale_code));

    INSERT INTO public.championship_finale_leaderboard (
      finale_code, user_id, seat_number, student_name, college, batch,
      score, accuracy, elapsed_seconds, submitted_at
    )
    VALUES (
      v_session.finale_code, v_caller_uid,
      v_finalist.seat_number, v_finalist.student_name, v_finalist.college, v_finalist.batch,
      v_score, v_accuracy, v_elapsed, v_submitted_at
    )
    ON CONFLICT (finale_code, user_id) DO NOTHING;

    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               ORDER BY score DESC, accuracy DESC, elapsed_seconds ASC, submitted_at ASC
             )::integer AS calc_rank
      FROM public.championship_finale_leaderboard
      WHERE finale_code = v_session.finale_code
    )
    UPDATE public.championship_finale_leaderboard lb
    SET rank = r.calc_rank
    FROM ranked r
    WHERE lb.id = r.id;
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'is_test',         v_session.is_test,
    'finale_code',     v_session.finale_code,
    'attempt_id',      v_new_attempt_id,
    'score',           v_score,
    'max_score',       v_max_score,
    'accuracy',        v_accuracy,
    'correct_count',   v_correct_count,
    'elapsed_seconds', v_elapsed,
    'explanations',    v_explanations
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_finale_pulse_attempt_atomic(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_finale_pulse_attempt_atomic(UUID, JSONB, TEXT) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 7. UPDATE REALTIME PUBLICATION TO INCLUDE FINALE INTEGRITY TABLES IF MISSING
-- ════════════════════════════════════════════════════════════════════════════════
DO $realtime_ac_finale$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'championship_finale_sessions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_finale_sessions;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'championship_finale_attempts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_finale_attempts;
    END IF;
  END IF;
END;
$realtime_ac_finale$;

NOTIFY pgrst, 'reload schema';

COMMIT;

