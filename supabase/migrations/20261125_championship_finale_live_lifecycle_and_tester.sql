-- ================================================================================
-- MIGRATION: 20261125_championship_finale_live_lifecycle_and_tester.sql
--
-- PURPOSE:
--   Additive, non-destructive upgrade for MedTrailSR Season 1 Grand Finale (Format B):
--   1. Dedicated hardened admin helper public.is_finale_admin() (ignores client-
--      mutable user_metadata) applied across all Format B RLS & RPCs.
--   2. Strict lifecycle state machine: DRAFT -> PUBLISHED -> LIVE -> ENDED
--      with Waiting Room separation ('published') vs live arena ('live'),
--      non-blocking freeze trigger fix (questions immutable after LIVE/official
--      sessions, while permitting LIVE -> ENDED lifecycle closure).
--   3. Sanitized Realtime-capable table public.championship_finale_public_state
--      (never exposes question text, answer keys, explanations, or PII).
--   4. Official finalist single-device binding (bound_device_id).
--   5. Isolated Classic Crew tester access (dpsvsambbs@gmail.com) verified
--      dynamically against auth.users, never inserted into the 10-seat roster,
--      explicitly authorized test devices only, repeated test runs allowed with
--      is_test = true & seat_number = 0, excluded from official standings.
--   6. Zero changes to Daily Pulse tables, functions, or historical attempts.
-- ================================================================================

BEGIN;

-- Ensure we fail cleanly on lock contention rather than hanging
SET LOCAL lock_timeout = '10s';

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. DEDICATED HARDENED ADMIN HELPER: public.is_finale_admin()
--    Ignores client-mutable user_metadata. Trusts ONLY:
--      - PostgreSQL service_role context / service_role JWT
--      - Verified email 'samarthrautrao715@gmail.com' in auth.users
--      - Server-controlled raw_app_meta_data role/is_admin flags in auth.users
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_finale_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_jwt_role   TEXT := lower(trim(coalesce(auth.jwt() ->> 'role', '')));
  v_is_allowed BOOLEAN := false;
BEGIN
  IF current_setting('role', true) = 'service_role' OR v_jwt_role = 'service_role' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = v_uid
      AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
      AND (
        lower(trim(coalesce(u.email, ''))) = 'samarthrautrao715@gmail.com'
        OR lower(trim(coalesce(u.raw_app_meta_data ->> 'role', ''))) IN ('admin', 'super_admin')
        OR lower(trim(coalesce(u.raw_app_meta_data ->> 'is_admin', ''))) = 'true'
      )
  ) INTO v_is_allowed;

  RETURN coalesce(v_is_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_finale_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_finale_admin() TO authenticated, service_role;

-- Update Format B RLS policies to use public.is_finale_admin()
DROP POLICY IF EXISTS "Admin only: read finale roster" ON public.championship_finale_approved_roster;
CREATE POLICY "Admin only: read finale roster"
  ON public.championship_finale_approved_roster
  FOR SELECT TO authenticated
  USING (public.is_finale_admin());

DROP POLICY IF EXISTS "Admin read/write finale sets" ON public.championship_finale_sets;
CREATE POLICY "Admin read/write finale sets"
  ON public.championship_finale_sets
  FOR ALL TO authenticated
  USING (public.is_finale_admin())
  WITH CHECK (public.is_finale_admin());

DROP POLICY IF EXISTS "Finalists read own session" ON public.championship_finale_sessions;
CREATE POLICY "Finalists read own session"
  ON public.championship_finale_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_finale_admin());

DROP POLICY IF EXISTS "Finalist reads own attempt" ON public.championship_finale_attempts;
CREATE POLICY "Finalist reads own attempt"
  ON public.championship_finale_attempts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_finale_admin());

DROP POLICY IF EXISTS "Admin read finale leaderboard" ON public.championship_finale_leaderboard;
CREATE POLICY "Admin read finale leaderboard"
  ON public.championship_finale_leaderboard
  FOR SELECT TO authenticated
  USING (public.is_finale_admin());

-- Explicit Data API privilege hardening on all 5 existing Format B tables:
-- Strip any default PUBLIC/anon/authenticated write, TRUNCATE, REFERENCES, TRIGGER, or anon SELECT privileges,
-- preserving only RLS-gated SELECT for authenticated (admin/own rows) and full access for service_role.
REVOKE ALL ON TABLE public.championship_finale_approved_roster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_approved_roster TO authenticated;
GRANT ALL ON TABLE public.championship_finale_approved_roster TO service_role;

REVOKE ALL ON TABLE public.championship_finale_sets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_sets TO authenticated;
GRANT ALL ON TABLE public.championship_finale_sets TO service_role;

REVOKE ALL ON TABLE public.championship_finale_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_sessions TO authenticated;
GRANT ALL ON TABLE public.championship_finale_sessions TO service_role;

REVOKE ALL ON TABLE public.championship_finale_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_attempts TO authenticated;
GRANT ALL ON TABLE public.championship_finale_attempts TO service_role;

REVOKE ALL ON TABLE public.championship_finale_leaderboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_leaderboard TO authenticated;
GRANT ALL ON TABLE public.championship_finale_leaderboard TO service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. LIFECYCLE SCHEMA EVOLUTION: championship_finale_sets + public_state
-- ════════════════════════════════════════════════════════════════════════════════
DO $alter_sets$
DECLARE
  v_con_name TEXT;
BEGIN
  -- Drop any existing status CHECK constraint so we can expand it to include 'live' & 'ended'
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_sets'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_sets DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END;
$alter_sets$;

ALTER TABLE public.championship_finale_sets
  ADD COLUMN IF NOT EXISTS live_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_started_by  UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ended_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_by         UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS questions_frozen BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frozen_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS freeze_reason    TEXT;

ALTER TABLE public.championship_finale_sets
  DROP CONSTRAINT IF EXISTS chk_finale_sets_status,
  ADD CONSTRAINT chk_finale_sets_status
    CHECK (status IN ('draft', 'published', 'live', 'ended', 'closed'));

-- Sanitized public lifecycle state (safe for anonymous/student Realtime subscriptions)
CREATE TABLE IF NOT EXISTS public.championship_finale_public_state (
  finale_code      TEXT PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT 'MedTrail Championship Season 1 Grand Finale',
  status           TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'live', 'ended', 'closed')),
  question_count   INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 90,
  questions_frozen BOOLEAN NOT NULL DEFAULT false,
  published_at     TIMESTAMPTZ,
  live_started_at  TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.championship_finale_public_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read sanitized finale status" ON public.championship_finale_public_state;
CREATE POLICY "Public read sanitized finale status"
  ON public.championship_finale_public_state
  FOR SELECT TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.championship_finale_public_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_public_state TO anon, authenticated;
GRANT ALL ON TABLE public.championship_finale_public_state TO service_role;

-- Trigger function to keep championship_finale_public_state synchronized automatically
CREATE OR REPLACE FUNCTION public.trg_fn_sync_finale_public_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.championship_finale_public_state (
    finale_code, title, status, question_count, duration_seconds,
    questions_frozen, published_at, live_started_at, ended_at, updated_at
  )
  VALUES (
    NEW.finale_code, NEW.title, NEW.status, NEW.question_count, NEW.duration_seconds,
    NEW.questions_frozen, NEW.published_at, NEW.live_started_at, NEW.ended_at, NEW.updated_at
  )
  ON CONFLICT (finale_code) DO UPDATE SET
    title            = EXCLUDED.title,
    status           = EXCLUDED.status,
    question_count   = EXCLUDED.question_count,
    duration_seconds = EXCLUDED.duration_seconds,
    questions_frozen = EXCLUDED.questions_frozen,
    published_at     = EXCLUDED.published_at,
    live_started_at  = EXCLUDED.live_started_at,
    ended_at         = EXCLUDED.ended_at,
    updated_at       = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_sync_finale_public_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_finale_public_state ON public.championship_finale_sets;
CREATE TRIGGER trg_sync_finale_public_state
  AFTER INSERT OR UPDATE ON public.championship_finale_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_sync_finale_public_state();

-- Seed/backfill public state from any existing finale set row
INSERT INTO public.championship_finale_public_state (
  finale_code, title, status, question_count, duration_seconds,
  questions_frozen, published_at, live_started_at, ended_at, updated_at
)
SELECT
  s.finale_code, s.title, s.status, s.question_count, s.duration_seconds,
  s.questions_frozen, s.published_at, s.live_started_at, s.ended_at, s.updated_at
FROM public.championship_finale_sets s
ON CONFLICT (finale_code) DO UPDATE SET
  title            = EXCLUDED.title,
  status           = EXCLUDED.status,
  question_count   = EXCLUDED.question_count,
  duration_seconds = EXCLUDED.duration_seconds,
  questions_frozen = EXCLUDED.questions_frozen,
  published_at     = EXCLUDED.published_at,
  live_started_at  = EXCLUDED.live_started_at,
  ended_at         = EXCLUDED.ended_at,
  updated_at       = EXCLUDED.updated_at;

-- Enable Realtime on the sanitized public state table ONLY (never on championship_finale_sets)
DO $realtime_pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'championship_finale_public_state'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_finale_public_state;
  END IF;
END;
$realtime_pub$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. CLASSIC CREW TESTER & TEST DEVICE TABLES + SESSIONS / ATTEMPTS ISOLATION
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_test_access (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  email          TEXT        NOT NULL UNIQUE,
  display_name   TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  allow_pre_live BOOLEAN     NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.championship_finale_test_devices (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_access_id UUID        NOT NULL REFERENCES public.championship_finale_test_access(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_id      TEXT        NOT NULL,
  device_label   TEXT,
  user_agent     TEXT,
  is_authorized  BOOLEAN     NOT NULL DEFAULT false,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at  TIMESTAMPTZ,
  authorized_by  UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
  revoked_at     TIMESTAMPTZ,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_finale_test_device_user UNIQUE (user_id, device_id),
  CONSTRAINT chk_finale_test_device_id_len CHECK (char_length(trim(device_id)) BETWEEN 8 AND 128)
);

ALTER TABLE public.championship_finale_test_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_test_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tester or admin reads test access" ON public.championship_finale_test_access;
CREATE POLICY "Tester or admin reads test access"
  ON public.championship_finale_test_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_finale_admin());

DROP POLICY IF EXISTS "Tester or admin reads test devices" ON public.championship_finale_test_devices;
CREATE POLICY "Tester or admin reads test devices"
  ON public.championship_finale_test_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_finale_admin());

REVOKE ALL ON TABLE public.championship_finale_test_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.championship_finale_test_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_test_access TO authenticated;
GRANT SELECT ON TABLE public.championship_finale_test_devices TO authenticated;
GRANT ALL ON TABLE public.championship_finale_test_access TO service_role;
GRANT ALL ON TABLE public.championship_finale_test_devices TO service_role;

-- Guard trigger: prevent any overlap between official approved finalists & tester table
CREATE OR REPLACE FUNCTION public.trg_fn_finale_prevent_tester_roster_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'championship_finale_test_access' THEN
    IF EXISTS (
      SELECT 1 FROM public.championship_finale_approved_roster r
      WHERE (r.user_id IS NOT NULL AND r.user_id = NEW.user_id)
         OR lower(trim(r.email)) = lower(trim(NEW.email))
    ) THEN
      RAISE EXCEPTION 'FINALE_IDENTITY_CONFLICT: Official approved finalist cannot hold tester access.';
    END IF;
  ELSIF TG_TABLE_NAME = 'championship_finale_approved_roster' THEN
    IF EXISTS (
      SELECT 1 FROM public.championship_finale_test_access t
      WHERE t.user_id = NEW.user_id
         OR lower(trim(t.email)) = lower(trim(NEW.email))
    ) THEN
      RAISE EXCEPTION 'FINALE_IDENTITY_CONFLICT: Tester account cannot be inserted into official finalist roster.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_prevent_tester_roster_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finale_no_overlap_test_access ON public.championship_finale_test_access;
CREATE TRIGGER trg_finale_no_overlap_test_access
  BEFORE INSERT OR UPDATE ON public.championship_finale_test_access
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_finale_prevent_tester_roster_overlap();

DROP TRIGGER IF EXISTS trg_finale_no_overlap_roster ON public.championship_finale_approved_roster;
CREATE TRIGGER trg_finale_no_overlap_roster
  BEFORE INSERT OR UPDATE ON public.championship_finale_approved_roster
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_finale_prevent_tester_roster_overlap();

-- Dynamically verify Classic crew (dpsvsambbs@gmail.com) exists in auth.users before seeding tester access
DO $seed_classic_crew$
DECLARE
  v_tester_uid         UUID;
  v_email_confirmed_at TIMESTAMPTZ;
  v_match_count        INTEGER;
  v_roster_count       INTEGER;
BEGIN
  SELECT count(*)
  INTO v_match_count
  FROM auth.users
  WHERE lower(trim(email)) = 'dpsvsambbs@gmail.com';

  IF v_match_count = 0 THEN
    RAISE EXCEPTION 'FINALE_TESTER_SEED_FAILED: auth.users account for dpsvsambbs@gmail.com was not found.';
  END IF;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'FINALE_TESTER_SEED_FAILED: Multiple auth.users rows matched dpsvsambbs@gmail.com (% rows).', v_match_count;
  END IF;

  SELECT id, email_confirmed_at
  INTO STRICT v_tester_uid, v_email_confirmed_at
  FROM auth.users
  WHERE lower(trim(email)) = 'dpsvsambbs@gmail.com';

  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'FINALE_TESTER_SEED_FAILED: auth.users account for dpsvsambbs@gmail.com is not email-confirmed.';
  END IF;

  SELECT count(*) INTO v_roster_count
  FROM public.championship_finale_approved_roster
  WHERE user_id = v_tester_uid OR lower(trim(email)) = 'dpsvsambbs@gmail.com';

  IF v_roster_count > 0 THEN
    RAISE EXCEPTION 'FINALE_TESTER_SEED_FAILED: Tester account must not exist inside championship_finale_approved_roster.';
  END IF;

  INSERT INTO public.championship_finale_test_access (
    user_id, email, display_name, is_active, allow_pre_live, notes
  )
  VALUES (
    v_tester_uid,
    'dpsvsambbs@gmail.com',
    'Classic crew',
    true,
    true,
    'Authorized pre-live & live isolated test participant (excluded from official roster and standings).'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email        = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    updated_at   = now();
END;
$seed_classic_crew$;

-- Sessions: support is_test + bound_device_id + partial unique indexes
ALTER TABLE public.championship_finale_sessions
  ADD COLUMN IF NOT EXISTS is_test         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bound_device_id TEXT;

ALTER TABLE public.championship_finale_sessions
  DROP CONSTRAINT IF EXISTS uq_finale_session_user_finale;

DROP INDEX IF EXISTS public.uq_finale_session_official_user_finale;
CREATE UNIQUE INDEX uq_finale_session_official_user_finale
  ON public.championship_finale_sessions (user_id, finale_code)
  WHERE is_test = false;

DROP INDEX IF EXISTS public.uq_finale_session_test_active;
CREATE UNIQUE INDEX uq_finale_session_test_active
  ON public.championship_finale_sessions (user_id, finale_code)
  WHERE is_test = true AND status = 'active';

-- Attempts: support is_test + device_id + seat_number=0 ONLY when is_test=true
ALTER TABLE public.championship_finale_attempts
  ADD COLUMN IF NOT EXISTS is_test   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS device_id TEXT;

DO $alter_attempts_seat$
DECLARE
  v_con_name TEXT;
BEGIN
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_attempts'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%seat_number%'
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_attempts DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END;
$alter_attempts_seat$;

ALTER TABLE public.championship_finale_attempts
  DROP CONSTRAINT IF EXISTS chk_finale_attempts_seat_number,
  ADD CONSTRAINT chk_finale_attempts_seat_number
    CHECK (
      (is_test = false AND seat_number BETWEEN 1 AND 10)
      OR
      (is_test = true AND seat_number = 0)
    );

ALTER TABLE public.championship_finale_attempts
  DROP CONSTRAINT IF EXISTS uq_finale_attempt_user;

DROP INDEX IF EXISTS public.uq_finale_attempt_official_user;
CREATE UNIQUE INDEX uq_finale_attempt_official_user
  ON public.championship_finale_attempts (user_id)
  WHERE is_test = false;

-- Safeguard leaderboard against any non-official seat or test user
ALTER TABLE public.championship_finale_leaderboard
  DROP CONSTRAINT IF EXISTS chk_finale_lb_official_seat,
  ADD CONSTRAINT chk_finale_lb_official_seat
    CHECK (seat_number BETWEEN 1 AND 10);

-- Now upgrade trg_fn_finale_set_freeze_on_session so:
--   - Official sessions (is_test = false), questions_frozen = true, or status IN ('live','ended','closed')
--     permanently freeze question content, title, code, duration, and timestamps.
--   - Administrative lifecycle closure LIVE -> ENDED/CLOSED remains allowed!
--   - Classic Crew pre-live test sessions (is_test = true) while status IN ('draft','published')
--     do NOT falsely brick admin question editing.
CREATE OR REPLACE FUNCTION public.trg_fn_finale_set_freeze_on_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_has_official_session BOOLEAN := false;
  v_is_frozen            BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.championship_finale_sessions s
    WHERE (s.finale_set_id = OLD.id OR s.finale_code = OLD.finale_code)
      AND s.is_test = false
  ) INTO v_has_official_session;

  v_is_frozen := OLD.questions_frozen
                 OR OLD.status IN ('live', 'ended', 'closed')
                 OR v_has_official_session;

  IF NOT v_is_frozen THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FINALE_SET_FROZEN: Frozen or started Grand Finale sets cannot be deleted.';
  END IF;

  -- Strictly forbid editing any question content or identity metadata after freeze
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.finale_code IS DISTINCT FROM OLD.finale_code
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.questions IS DISTINCT FROM OLD.questions
     OR NEW.question_count IS DISTINCT FROM OLD.question_count
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by
     OR NEW.live_started_at IS DISTINCT FROM OLD.live_started_at
     OR NEW.live_started_by IS DISTINCT FROM OLD.live_started_by
     OR NEW.questions_frozen IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'FINALE_SET_FROZEN: Questions and rules are permanently frozen once the Grand Finale goes live or official sessions begin.';
  END IF;

  -- Allow ONLY forward closure transition live -> ended/closed
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'live' AND NEW.status IN ('ended', 'closed')) THEN
      RAISE EXCEPTION 'FINALE_SET_FROZEN: Invalid lifecycle transition on frozen set (% -> %).', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_set_freeze_on_session() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. DROP LEGACY OVERLOADS SO NO UNGUARDED SIGNATURES REMAIN
-- ════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.start_finale_pulse_session_atomic(TEXT);
DROP FUNCTION IF EXISTS public.submit_finale_pulse_attempt_atomic(UUID, JSONB);

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. HARDENED RPCs
-- ════════════════════════════════════════════════════════════════════════════════

-- RPC A: publish_finale_set_atomic
-- Saves draft (partial allowed) or publishes validated 10-question Finale set.
-- Publishing transitions status to 'published' ONLY (does not start LIVE arena).
CREATE OR REPLACE FUNCTION public.publish_finale_set_atomic(
  p_finale_code  TEXT,
  p_questions    JSONB,
  p_status       TEXT DEFAULT 'published',
  p_title        TEXT DEFAULT 'MedTrail Championship Season 1 Grand Finale'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid           UUID        := auth.uid();
  v_now                  TIMESTAMPTZ := clock_timestamp();
  v_code                 TEXT        := trim(coalesce(p_finale_code, ''));
  v_title                TEXT        := coalesce(nullif(trim(p_title), ''), 'MedTrail Championship Season 1 Grand Finale');
  v_set_id               UUID;
  v_existing_set         public.championship_finale_sets%ROWTYPE;
  v_has_official_session BOOLEAN;
  v_q                    JSONB;
  v_slot                 INTEGER     := 0;
  v_answer               TEXT;
  v_difficulty           TEXT;
  v_normalized_questions JSONB       := '[]'::jsonb;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  IF v_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'finale_code is required.');
  END IF;

  IF p_status NOT IN ('draft', 'published') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid target status. Use Go Live Finale / End Finale controls for live/ended transitions.'
    );
  END IF;

  SELECT * INTO v_existing_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR UPDATE;

  IF v_existing_set.id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.championship_finale_sessions s
      WHERE (s.finale_set_id = v_existing_set.id OR s.finale_code = v_code)
        AND s.is_test = false
    ) INTO v_has_official_session;

    IF v_existing_set.questions_frozen
       OR v_existing_set.status IN ('live', 'ended', 'closed')
       OR v_has_official_session
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Questions are permanently frozen after the Finale starts or official sessions begin.'
      );
    END IF;
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_questions must be a JSON array.');
  END IF;

  IF jsonb_array_length(p_questions) > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Grand Finale supports at most 10 question slots.');
  END IF;

  IF p_status = 'published' AND jsonb_array_length(p_questions) <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Grand Finale must contain all 10 complete questions to publish. Found: ' || jsonb_array_length(p_questions)
    );
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_slot := v_slot + 1;
    v_answer := upper(trim(coalesce(v_q->>'correct_answer', '')));
    v_difficulty := initcap(lower(trim(coalesce(v_q->>'difficulty', ''))));

    IF p_status = 'published' THEN
      IF coalesce(trim(v_q->>'question'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': question text is required.');
      END IF;
      IF coalesce(trim(v_q->>'option_a'), '') = '' OR
         coalesce(trim(v_q->>'option_b'), '') = '' OR
         coalesce(trim(v_q->>'option_c'), '') = '' OR
         coalesce(trim(v_q->>'option_d'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': all 4 options (A, B, C, D) are required.');
      END IF;
      IF v_answer NOT IN ('A', 'B', 'C', 'D') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': correct answer must be A, B, C, or D.');
      END IF;
      IF coalesce(trim(v_q->>'explanation'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': faculty explanation is required.');
      END IF;
      IF coalesce(trim(v_q->>'subject'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': subject is required.');
      END IF;
      IF v_difficulty NOT IN ('Easy', 'Medium', 'Hard') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': difficulty must be Easy, Medium, or Hard.');
      END IF;
    ELSE
      IF v_answer = '' THEN v_answer := 'A'; END IF;
      IF v_answer NOT IN ('A', 'B', 'C', 'D') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': correct answer must be A, B, C, or D.');
      END IF;
      IF v_difficulty = '' THEN v_difficulty := 'Medium'; END IF;
      IF v_difficulty NOT IN ('Easy', 'Medium', 'Hard') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': difficulty must be Easy, Medium, or Hard.');
      END IF;
    END IF;

    v_normalized_questions := v_normalized_questions || jsonb_build_object(
      'slot',           v_slot,
      'question',       trim(coalesce(v_q->>'question', '')),
      'option_a',       trim(coalesce(v_q->>'option_a', '')),
      'option_b',       trim(coalesce(v_q->>'option_b', '')),
      'option_c',       trim(coalesce(v_q->>'option_c', '')),
      'option_d',       trim(coalesce(v_q->>'option_d', '')),
      'correct_answer', v_answer,
      'explanation',    trim(coalesce(v_q->>'explanation', '')),
      'subject',        coalesce(nullif(trim(v_q->>'subject'), ''), 'Clinical Medicine'),
      'difficulty',     v_difficulty
    );
  END LOOP;

  -- Expire any currently active pre-live test session so testers reload the updated bank
  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = v_now
  WHERE finale_code = v_code
    AND is_test = true
    AND status = 'active';

  INSERT INTO public.championship_finale_sets (
    finale_code, title, status, questions, question_count,
    duration_seconds, published_at, published_by, updated_at
  )
  VALUES (
    v_code,
    v_title,
    p_status,
    v_normalized_questions,
    jsonb_array_length(v_normalized_questions),
    90,
    CASE WHEN p_status = 'published' THEN v_now ELSE NULL END,
    CASE WHEN p_status = 'published' THEN v_caller_uid ELSE NULL END,
    v_now
  )
  ON CONFLICT (finale_code) DO UPDATE SET
    title          = EXCLUDED.title,
    status         = EXCLUDED.status,
    questions      = EXCLUDED.questions,
    question_count = EXCLUDED.question_count,
    published_at   = CASE WHEN EXCLUDED.status = 'published' THEN v_now ELSE championship_finale_sets.published_at END,
    published_by   = CASE WHEN EXCLUDED.status = 'published' THEN v_caller_uid ELSE championship_finale_sets.published_by END,
    updated_at     = v_now
  RETURNING id INTO v_set_id;

  RETURN jsonb_build_object(
    'success',        true,
    'set_id',         v_set_id,
    'finale_code',    v_code,
    'status',         p_status,
    'question_count', jsonb_array_length(v_normalized_questions),
    'published_at',   CASE WHEN p_status = 'published' THEN v_now ELSE NULL END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_finale_set_atomic(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_finale_set_atomic(TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;

-- RPC B: go_live_finale_atomic
-- Atomically verifies published 10-question bank + 10 verified roster seats,
-- freezes questions permanently, and transitions PUBLISHED -> LIVE.
CREATE OR REPLACE FUNCTION public.go_live_finale_atomic(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid   UUID        := auth.uid();
  v_now          TIMESTAMPTZ := clock_timestamp();
  v_code         TEXT        := trim(coalesce(p_finale_code, ''));
  v_set          public.championship_finale_sets%ROWTYPE;
  v_roster_count INTEGER;
  v_q            JSONB;
  v_slot         INTEGER     := 0;
  v_answer       TEXT;
  v_difficulty   TEXT;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR UPDATE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Finale question set has not been saved yet.');
  END IF;

  IF v_set.status = 'live' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Grand Finale is already LIVE.');
  END IF;

  IF v_set.status <> 'published' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot go live from status "' || v_set.status || '". Publish all 10 complete questions first.'
    );
  END IF;

  IF v_set.question_count <> 10 OR jsonb_typeof(v_set.questions) <> 'array' OR jsonb_array_length(v_set.questions) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Exactly 10 validated questions are required before going live.');
  END IF;

  -- Re-validate all 10 slots (guards against legacy published sets lacking explanation/difficulty)
  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_slot := v_slot + 1;
    v_answer := upper(trim(coalesce(v_q->>'correct_answer', '')));
    v_difficulty := initcap(lower(trim(coalesce(v_q->>'difficulty', ''))));
    IF coalesce(trim(v_q->>'question'), '') = ''
       OR coalesce(trim(v_q->>'option_a'), '') = ''
       OR coalesce(trim(v_q->>'option_b'), '') = ''
       OR coalesce(trim(v_q->>'option_c'), '') = ''
       OR coalesce(trim(v_q->>'option_d'), '') = ''
       OR v_answer NOT IN ('A', 'B', 'C', 'D')
       OR coalesce(trim(v_q->>'explanation'), '') = ''
       OR coalesce(trim(v_q->>'subject'), '') = ''
       OR v_difficulty NOT IN ('Easy', 'Medium', 'Hard')
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Slot ' || v_slot || ' is incomplete (requires question, 4 options, A-D key, explanation, subject, and difficulty). Re-publish before Go Live.'
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_roster_count
  FROM public.championship_finale_approved_roster
  WHERE is_active = true AND seat_number BETWEEN 1 AND 10;

  IF v_roster_count <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Expected 10 active finalists in approved roster before Go Live; found ' || v_roster_count
    );
  END IF;

  -- Expire any active pre-live test session before live start
  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = v_now
  WHERE finale_code = v_code
    AND is_test = true
    AND status = 'active';

  UPDATE public.championship_finale_sets
  SET status           = 'live',
      questions_frozen = true,
      frozen_at        = coalesce(frozen_at, v_now),
      freeze_reason    = coalesce(freeze_reason, 'Locked on Go Live Finale'),
      live_started_at  = v_now,
      live_started_by  = v_caller_uid,
      updated_at       = v_now
  WHERE id = v_set.id;

  RETURN jsonb_build_object(
    'success',         true,
    'finale_code',     v_code,
    'status',          'live',
    'live_started_at', v_now,
    'questions_frozen', true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.go_live_finale_atomic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.go_live_finale_atomic(TEXT) TO authenticated, service_role;

-- RPC C: end_finale_atomic
-- Atomically transitions LIVE -> ENDED, freezes questions, and expires any unsubmitted active sessions.
CREATE OR REPLACE FUNCTION public.end_finale_atomic(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_code           TEXT        := trim(coalesce(p_finale_code, ''));
  v_set            public.championship_finale_sets%ROWTYPE;
  v_expired_count  INTEGER     := 0;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR UPDATE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Finale set not found.');
  END IF;

  IF v_set.status IN ('ended', 'closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Grand Finale has already ended.');
  END IF;

  IF v_set.status <> 'live' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a LIVE Grand Finale can be ended (current status: ' || v_set.status || ').');
  END IF;

  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = v_now
  WHERE finale_code = v_code
    AND status = 'active';
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  UPDATE public.championship_finale_sets
  SET status     = 'ended',
      ended_at   = v_now,
      ended_by   = v_caller_uid,
      updated_at = v_now
  WHERE id = v_set.id;

  RETURN jsonb_build_object(
    'success',          true,
    'finale_code',      v_code,
    'status',           'ended',
    'ended_at',         v_now,
    'expired_sessions', v_expired_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.end_finale_atomic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_finale_atomic(TEXT) TO authenticated, service_role;

-- RPC D: start_finale_pulse_session_atomic(p_finale_code, p_device_id)
-- Server-authoritative session creation/resume with:
--   - auth.uid() verification against approved roster (official) OR test access (Classic crew)
--   - Waiting room gate (published != live for finalists)
--   - Strict device binding (official) and admin-authorized device gate (tester)
--   - Post-lock clock_timestamp() and concurrent ON CONFLICT re-read validation
CREATE OR REPLACE FUNCTION public.start_finale_pulse_session_atomic(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124',
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
  v_code           TEXT        := trim(coalesce(p_finale_code, ''));
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
  v_questions_safe JSONB       := '[]'::jsonb;
  v_q              JSONB;
  v_idx            INTEGER     := 0;
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

  -- 1. Check Official Finalist Roster first
  SELECT * INTO v_finalist
  FROM public.championship_finale_approved_roster
  WHERE is_active = true
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
    -- 2. Otherwise check Isolated Tester Permission (Classic crew)
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

    -- Explicitly authorized test device enforcement
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

  -- 3. Lock question set for shared read & enforce lifecycle gate
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
        'seat_number',  v_finalist.seat_number,
        'student_name', v_finalist.student_name,
        'error',        'Your verified finalist seat #' || v_finalist.seat_number || ' is ready. Waiting for the administrator to Go Live.'
      );
    ELSIF v_set.status IN ('ended', 'closed') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'event_ended',  true,
        'event_status', v_set.status,
        'error',        'The Grand Finale examination has ended.'
      );
    ELSIF v_set.status <> 'live' THEN
      RETURN jsonb_build_object(
        'success',      false,
        'event_status', v_set.status,
        'error',        'The Grand Finale is not currently open.'
      );
    END IF;
  ELSE
    -- Tester mode: allowed in 'live', or in 'published' when allow_pre_live = true
    IF v_set.status IN ('ended', 'closed') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'is_test',      true,
        'event_ended',  true,
        'event_status', v_set.status,
        'error',        'The Grand Finale has ended.'
      );
    ELSIF v_set.status = 'draft' OR (v_set.status = 'published' AND NOT v_tester.allow_pre_live) OR v_set.status NOT IN ('published', 'live') THEN
      RETURN jsonb_build_object(
        'success',      false,
        'is_test',      true,
        'waiting_room', (v_set.status = 'published'),
        'event_status', v_set.status,
        'error',        'Test access requires the 10-question Finale set to be published or live.'
      );
    END IF;
  END IF;

  IF v_set.question_count <> 10 OR jsonb_array_length(v_set.questions) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'is_test', v_is_test, 'error', 'Finale question bank is incomplete (10 questions required).');
  END IF;

  -- Post-lock wall clock sample
  v_now := clock_timestamp();

  IF NOT v_is_test THEN
    -- 4A. Official finalist: strictly 1 attempt & 1 session ever
    SELECT id INTO v_existing_att
    FROM public.championship_finale_attempts
    WHERE user_id = v_caller_uid AND is_test = false;

    IF v_existing_att.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success',           false,
        'already_submitted', true,
        'error',             'You have already completed the Grand Finale. Only 1 attempt is permitted.'
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
    RETURNING id INTO v_session_id;

    SELECT * INTO v_session
    FROM public.championship_finale_sessions
    WHERE user_id = v_caller_uid AND finale_code = v_code AND is_test = false
    FOR UPDATE;

    v_now := clock_timestamp();

    IF v_session.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Could not open examination session.');
    END IF;

    IF coalesce(v_session.bound_device_id, '') <> v_device_id THEN
      RETURN jsonb_build_object(
        'success',         false,
        'device_mismatch', true,
        'error',           'Device mismatch detected. Return to your original device to resume this examination.'
      );
    END IF;

    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'error', 'You have already submitted the Grand Finale.');
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
  ELSE
    -- 4B. Classic Crew isolated test session: 1 active test session at a time, repeatable runs
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

  -- 5. Build sanitized question payload (zero correct_answer, zero explanation)
  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_idx := v_idx + 1;
    v_questions_safe := v_questions_safe || jsonb_build_object(
      'slot',       v_idx,
      'question',   coalesce(v_q->>'question', ''),
      'option_a',   coalesce(v_q->>'option_a', ''),
      'option_b',   coalesce(v_q->>'option_b', ''),
      'option_c',   coalesce(v_q->>'option_c', ''),
      'option_d',   coalesce(v_q->>'option_d', ''),
      'subject',    coalesce(v_q->>'subject', 'Clinical Medicine'),
      'difficulty', coalesce(v_q->>'difficulty', 'Medium')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',          true,
    'is_test',          v_is_test,
    'session_id',       v_session.id,
    'started_at',       v_session.started_at,
    'expires_at',       v_session.expires_at,
    'duration_seconds', 90,
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

-- RPC E: submit_finale_pulse_attempt_atomic(p_session_id, p_answers, p_device_id)
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
  v_caller_uid     UUID        := auth.uid();
  v_device_id      TEXT        := trim(coalesce(p_device_id, ''));
  v_submitted_at   TIMESTAMPTZ;
  v_session        public.championship_finale_sessions%ROWTYPE;
  v_finalist       public.championship_finale_approved_roster%ROWTYPE;
  v_tester         public.championship_finale_test_access%ROWTYPE;
  v_test_device    public.championship_finale_test_devices%ROWTYPE;
  v_set            public.championship_finale_sets%ROWTYPE;
  v_elapsed        NUMERIC;
  v_q              JSONB;
  v_idx            INTEGER     := 0;
  v_user_ans       INTEGER;
  v_correct_letter TEXT;
  v_correct_idx    INTEGER;
  v_correct_count  INTEGER     := 0;
  v_score          INTEGER;
  v_accuracy       NUMERIC;
  v_new_attempt_id UUID;
  v_existing_att   RECORD;
  v_explanations   JSONB       := '[]'::jsonb;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF char_length(v_device_id) < 8 OR char_length(v_device_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'device_required', true, 'error', 'Valid device identifier is required.');
  END IF;

  -- 1. Lock session FOR UPDATE before sampling wall clock
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

  -- 2. Lock question set FOR SHARE & check event status
  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE id = v_session.finale_set_id
  FOR SHARE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question bank missing.');
  END IF;

  IF NOT v_session.is_test THEN
    IF v_set.status IN ('ended', 'closed') THEN
      UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_submitted_at WHERE id = v_session.id;
      RETURN jsonb_build_object('success', false, 'event_ended', true, 'error', 'Submission rejected: Grand Finale has already ended.');
    ELSIF v_set.status <> 'live' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Submission rejected: Grand Finale is not live.');
    END IF;
  ELSE
    IF v_set.status IN ('ended', 'closed') THEN
      UPDATE public.championship_finale_sessions SET status = 'expired', updated_at = v_submitted_at WHERE id = v_session.id;
      RETURN jsonb_build_object('success', false, 'is_test', true, 'event_ended', true, 'error', 'Submission rejected: Grand Finale has ended.');
    ELSIF v_set.status NOT IN ('published', 'live') THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'error', 'Submission rejected: test set is unavailable.');
    END IF;
  END IF;

  -- 3. Re-verify identity
  IF NOT v_session.is_test THEN
    SELECT id INTO v_existing_att
    FROM public.championship_finale_attempts
    WHERE user_id = v_caller_uid AND is_test = false;

    IF v_existing_att.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_existing_att.id);
    END IF;

    SELECT * INTO v_finalist
    FROM public.championship_finale_approved_roster
    WHERE user_id = v_caller_uid AND is_active = true;

    IF v_finalist.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: not in active approved finalist roster.');
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

  -- 4. Server-authoritative 90s + 2.0s tolerance enforcement
  IF v_submitted_at > (v_session.expires_at + interval '2.0 seconds') THEN
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

  -- 5. Validate 10 answers
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'is_test', v_session.is_test,
      'error',   'Malformed submission: exactly 10 answers required.'
    );
  END IF;

  -- 6. Authoritative Grading
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

    v_correct_idx := CASE v_correct_letter WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3 END;
    IF v_user_ans = v_correct_idx THEN
      v_correct_count := v_correct_count + 1;
    END IF;

    v_explanations := v_explanations || jsonb_build_object(
      'slot',           v_idx + 1,
      'question',       coalesce(v_q->>'question', ''),
      'user_answer',    v_user_ans,
      'correct_answer', v_correct_letter,
      'explanation',    coalesce(v_q->>'explanation', '')
    );

    v_idx := v_idx + 1;
  END LOOP;

  v_score    := v_correct_count * 100;
  v_accuracy := ROUND((v_correct_count::numeric / 10.0) * 100.0, 2);

  -- 7. Record Immutable Attempt
  IF NOT v_session.is_test THEN
    INSERT INTO public.championship_finale_attempts (
      session_id, finale_code, user_id, seat_number, student_name, college, batch,
      score, accuracy, correct_count, elapsed_seconds, answers, submitted_at, is_test, device_id
    )
    VALUES (
      v_session.id, v_session.finale_code, v_caller_uid,
      v_finalist.seat_number, v_finalist.student_name, v_finalist.college, v_finalist.batch,
      v_score, v_accuracy, v_correct_count, v_elapsed, p_answers, v_submitted_at, false, v_device_id
    )
    ON CONFLICT (user_id) WHERE is_test = false DO NOTHING
    RETURNING id INTO v_new_attempt_id;

    IF v_new_attempt_id IS NULL THEN
      SELECT id INTO v_new_attempt_id FROM public.championship_finale_attempts WHERE user_id = v_caller_uid AND is_test = false;
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_new_attempt_id);
    END IF;
  ELSE
    INSERT INTO public.championship_finale_attempts (
      session_id, finale_code, user_id, seat_number, student_name, college, batch,
      score, accuracy, correct_count, elapsed_seconds, answers, submitted_at, is_test, device_id
    )
    VALUES (
      v_session.id, v_session.finale_code, v_caller_uid,
      0, v_tester.display_name || ' [TEST]', 'Isolated Test Environment', 'TEST',
      v_score, v_accuracy, v_correct_count, v_elapsed, p_answers, v_submitted_at, true, v_device_id
    )
    ON CONFLICT (session_id) DO NOTHING
    RETURNING id INTO v_new_attempt_id;

    IF v_new_attempt_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'is_test', true, 'already_submitted', true, 'error', 'Test session already submitted.');
    END IF;
  END IF;

  -- 8. Mark Session Submitted
  UPDATE public.championship_finale_sessions
  SET status = 'submitted', submitted_at = v_submitted_at, updated_at = v_submitted_at
  WHERE id = v_session.id;

  -- 9. Official Leaderboard Update (STRICTLY skipped when is_test = true)
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
    ON CONFLICT (user_id) DO NOTHING;

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
    'attempt_id',      v_new_attempt_id,
    'score',           v_score,
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

-- RPC F: get_public_finale_status
-- Returns sanitized public event status + caller-specific server-verified role flags.
CREATE OR REPLACE FUNCTION public.get_public_finale_status(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124',
  p_device_id   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code              TEXT := trim(coalesce(p_finale_code, ''));
  v_device_id         TEXT := trim(coalesce(p_device_id, ''));
  v_caller_uid        UUID := auth.uid();
  v_caller_email      TEXT := '';
  v_pub               public.championship_finale_public_state%ROWTYPE;
  v_finalist          public.championship_finale_approved_roster%ROWTYPE;
  v_tester            public.championship_finale_test_access%ROWTYPE;
  v_test_device       public.championship_finale_test_devices%ROWTYPE;
  v_has_submitted     BOOLEAN := false;
  v_active_expires    TIMESTAMPTZ := NULL;
BEGIN
  SELECT * INTO v_pub
  FROM public.championship_finale_public_state
  WHERE finale_code = v_code;

  IF v_caller_uid IS NOT NULL THEN
    SELECT lower(trim(coalesce(email, ''))) INTO v_caller_email
    FROM auth.users WHERE id = v_caller_uid;

    SELECT * INTO v_finalist
    FROM public.championship_finale_approved_roster
    WHERE is_active = true
      AND (
        user_id = v_caller_uid
        OR (user_id IS NULL AND v_caller_email <> '' AND lower(trim(email)) = v_caller_email)
      )
    LIMIT 1;

    IF v_finalist.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.championship_finale_attempts
        WHERE user_id = v_caller_uid AND is_test = false
      ) INTO v_has_submitted;

      SELECT s.expires_at INTO v_active_expires
      FROM public.championship_finale_sessions s
      WHERE s.user_id = v_caller_uid AND s.finale_code = v_code AND s.is_test = false AND s.status = 'active'
        AND s.expires_at > clock_timestamp()
      LIMIT 1;
    ELSE
      SELECT * INTO v_tester
      FROM public.championship_finale_test_access
      WHERE user_id = v_caller_uid AND is_active = true AND lower(trim(email)) = coalesce(v_caller_email, '')
      LIMIT 1;

      IF v_tester.id IS NOT NULL AND v_device_id <> '' THEN
        SELECT * INTO v_test_device
        FROM public.championship_finale_test_devices
        WHERE user_id = v_caller_uid AND device_id = v_device_id
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'finale_code',                  v_code,
    'title',                        coalesce(v_pub.title, 'MedTrail Championship Season 1 Grand Finale'),
    'status',                       coalesce(v_pub.status, 'draft'),
    'question_count',               coalesce(v_pub.question_count, 0),
    'duration_seconds',             coalesce(v_pub.duration_seconds, 90),
    'questions_frozen',             coalesce(v_pub.questions_frozen, false),
    'published_at',                 v_pub.published_at,
    'live_started_at',              v_pub.live_started_at,
    'ended_at',                     v_pub.ended_at,
    'caller_is_admin',              CASE WHEN v_caller_uid IS NOT NULL THEN public.is_finale_admin() ELSE false END,
    'caller_is_finalist',           (v_finalist.id IS NOT NULL),
    'caller_seat_number',           CASE WHEN v_finalist.id IS NOT NULL THEN v_finalist.seat_number ELSE NULL END,
    'caller_student_name',          CASE WHEN v_finalist.id IS NOT NULL THEN v_finalist.student_name ELSE NULL END,
    'caller_has_submitted',         v_has_submitted,
    'caller_active_expires_at',     v_active_expires,
    'caller_is_tester',             (v_tester.id IS NOT NULL),
    'caller_tester_name',           CASE WHEN v_tester.id IS NOT NULL THEN v_tester.display_name ELSE NULL END,
    'caller_test_pre_live_allowed', CASE WHEN v_tester.id IS NOT NULL THEN v_tester.allow_pre_live ELSE false END,
    'caller_test_device_registered', (v_test_device.id IS NOT NULL),
    'caller_test_device_authorized', (v_test_device.id IS NOT NULL AND v_test_device.is_authorized AND v_test_device.revoked_at IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_status(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_finale_status(TEXT, TEXT) TO anon, authenticated, service_role;

-- RPC G: request_finale_test_device
-- Allows verified active tester (Classic crew) to register their browser device fingerprint as PENDING admin approval.
CREATE OR REPLACE FUNCTION public.request_finale_test_device(
  p_device_id    TEXT,
  p_device_label TEXT DEFAULT NULL,
  p_user_agent   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_device_id  TEXT := trim(coalesce(p_device_id, ''));
  v_tester     public.championship_finale_test_access%ROWTYPE;
  v_device     public.championship_finale_test_devices%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF char_length(v_device_id) < 8 OR char_length(v_device_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid device fingerprint.');
  END IF;

  SELECT t.* INTO v_tester
  FROM public.championship_finale_test_access t
  JOIN auth.users u ON u.id = t.user_id
  WHERE t.user_id = v_caller_uid
    AND t.is_active = true
    AND lower(trim(coalesce(u.email, ''))) = lower(trim(t.email));

  IF v_tester.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only authorized test participants may register test devices.');
  END IF;

  INSERT INTO public.championship_finale_test_devices (
    test_access_id, user_id, device_id, device_label, user_agent, is_authorized, requested_at, last_seen_at
  )
  VALUES (
    v_tester.id,
    v_caller_uid,
    v_device_id,
    left(coalesce(nullif(trim(p_device_label), ''), 'Browser Test Device'), 120),
    left(coalesce(trim(p_user_agent), ''), 240),
    false,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    device_label = COALESCE(NULLIF(trim(EXCLUDED.device_label), ''), championship_finale_test_devices.device_label),
    user_agent   = COALESCE(NULLIF(trim(EXCLUDED.user_agent), ''), championship_finale_test_devices.user_agent),
    last_seen_at = clock_timestamp()
  RETURNING * INTO v_device;

  RETURN jsonb_build_object(
    'success',       true,
    'device_id',     v_device.device_id,
    'is_authorized', (v_device.is_authorized AND v_device.revoked_at IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_finale_test_device(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_finale_test_device(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- RPC H: admin_manage_finale_test_device
CREATE OR REPLACE FUNCTION public.admin_manage_finale_test_device(
  p_device_id    TEXT,
  p_action       TEXT,
  p_device_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid UUID        := auth.uid();
  v_now        TIMESTAMPTZ := clock_timestamp();
  v_device_id  TEXT        := trim(coalesce(p_device_id, ''));
  v_action     TEXT        := lower(trim(coalesce(p_action, '')));
  v_tester     public.championship_finale_test_access%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  IF char_length(v_device_id) < 8 OR char_length(v_device_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Device ID must be between 8 and 128 characters.');
  END IF;

  IF v_action NOT IN ('approve', 'revoke') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Action must be approve or revoke.');
  END IF;

  SELECT * INTO v_tester
  FROM public.championship_finale_test_access
  WHERE lower(trim(email)) = 'dpsvsambbs@gmail.com'
  LIMIT 1;

  IF v_tester.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Classic crew tester profile not found.');
  END IF;

  IF v_action = 'approve' THEN
    INSERT INTO public.championship_finale_test_devices (
      test_access_id, user_id, device_id, device_label, is_authorized, authorized_at, authorized_by, revoked_at, last_seen_at
    )
    VALUES (
      v_tester.id,
      v_tester.user_id,
      v_device_id,
      left(coalesce(nullif(trim(p_device_label), ''), 'Admin-Approved Test Device'), 120),
      true,
      v_now,
      v_caller_uid,
      NULL,
      v_now
    )
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      device_label  = COALESCE(NULLIF(trim(EXCLUDED.device_label), ''), championship_finale_test_devices.device_label),
      is_authorized = true,
      authorized_at = v_now,
      authorized_by = v_caller_uid,
      revoked_at    = NULL,
      last_seen_at  = v_now;
  ELSE
    UPDATE public.championship_finale_test_devices
    SET is_authorized = false,
        revoked_at    = v_now,
        last_seen_at  = v_now
    WHERE user_id = v_tester.user_id
      AND device_id = v_device_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Test device record not found.');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'device_id', v_device_id, 'action', v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_finale_test_device(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_finale_test_device(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- RPC I: admin_reset_finale_test_sessions
-- Safely expires active Classic Crew test sessions without deleting/altering immutable attempt history.
CREATE OR REPLACE FUNCTION public.admin_reset_finale_test_sessions(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid    UUID := auth.uid();
  v_expired_count INTEGER := 0;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = clock_timestamp()
  WHERE finale_code = trim(coalesce(p_finale_code, ''))
    AND is_test = true
    AND status = 'active';
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'expired_test_sessions', v_expired_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_finale_test_sessions(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_finale_test_sessions(TEXT) TO authenticated, service_role;

-- RPC J: admin_get_finale_overview
-- Returns complete Finale Ops dashboard state exclusively to public.is_finale_admin().
CREATE OR REPLACE FUNCTION public.admin_get_finale_overview(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code          TEXT := trim(coalesce(p_finale_code, ''));
  v_set           public.championship_finale_sets%ROWTYPE;
  v_roster        JSONB;
  v_leaderboard   JSONB;
  v_tester        public.championship_finale_test_access%ROWTYPE;
  v_test_devices  JSONB;
  v_test_attempts JSONB;
  v_official_cnt  INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  SELECT * INTO v_set FROM public.championship_finale_sets WHERE finale_code = v_code;

  SELECT count(*) INTO v_official_cnt
  FROM public.championship_finale_sessions
  WHERE finale_code = v_code AND is_test = false;

  SELECT coalesce(jsonb_agg(row_to_json(r_data) ORDER BY r_data.seat_number ASC), '[]'::jsonb)
  INTO v_roster
  FROM (
    SELECT
      r.seat_number,
      r.student_name,
      r.college,
      r.batch,
      r.is_active,
      (r.user_id IS NOT NULL) AS account_linked,
      s.status AS session_status,
      s.started_at AS session_started_at,
      s.expires_at AS session_expires_at,
      (s.bound_device_id IS NOT NULL) AS device_bound,
      a.score AS attempt_score,
      a.accuracy AS attempt_accuracy,
      a.elapsed_seconds AS attempt_elapsed_seconds,
      a.submitted_at AS attempt_submitted_at
    FROM public.championship_finale_approved_roster r
    LEFT JOIN public.championship_finale_sessions s
      ON s.user_id = r.user_id AND s.finale_code = v_code AND s.is_test = false
    LEFT JOIN public.championship_finale_attempts a
      ON a.user_id = r.user_id AND a.finale_code = v_code AND a.is_test = false
  ) r_data;

  SELECT coalesce(jsonb_agg(row_to_json(lb_data) ORDER BY lb_data.rank ASC), '[]'::jsonb)
  INTO v_leaderboard
  FROM (
    SELECT rank, seat_number, student_name, college, batch, score, accuracy, elapsed_seconds, submitted_at
    FROM public.championship_finale_leaderboard
    WHERE finale_code = v_code
  ) lb_data;

  SELECT * INTO v_tester
  FROM public.championship_finale_test_access
  WHERE lower(trim(email)) = 'dpsvsambbs@gmail.com'
  LIMIT 1;

  SELECT coalesce(jsonb_agg(row_to_json(td) ORDER BY td.requested_at DESC), '[]'::jsonb)
  INTO v_test_devices
  FROM (
    SELECT device_id, device_label, user_agent, is_authorized, requested_at, authorized_at, revoked_at, last_seen_at
    FROM public.championship_finale_test_devices
    WHERE v_tester.id IS NOT NULL AND user_id = v_tester.user_id
  ) td;

  SELECT coalesce(jsonb_agg(row_to_json(ta) ORDER BY ta.submitted_at DESC), '[]'::jsonb)
  INTO v_test_attempts
  FROM (
    SELECT id, session_id, score, accuracy, correct_count, elapsed_seconds, is_test, device_id, submitted_at
    FROM public.championship_finale_attempts
    WHERE finale_code = v_code
      AND is_test = true
      AND v_tester.id IS NOT NULL
      AND user_id = v_tester.user_id
    ORDER BY submitted_at DESC
    LIMIT 25
  ) ta;

  RETURN jsonb_build_object(
    'success', true,
    'finale_code', v_code,
    'set', CASE WHEN v_set.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',                    v_set.id,
      'title',                 v_set.title,
      'status',                v_set.status,
      'questions',             v_set.questions,
      'question_count',        v_set.question_count,
      'duration_seconds',      v_set.duration_seconds,
      'questions_frozen',      v_set.questions_frozen OR v_set.status IN ('live', 'ended', 'closed') OR v_official_cnt > 0,
      'official_session_count', v_official_cnt,
      'published_at',          v_set.published_at,
      'live_started_at',       v_set.live_started_at,
      'ended_at',              v_set.ended_at,
      'updated_at',            v_set.updated_at
    ) END,
    'roster',        v_roster,
    'leaderboard',   v_leaderboard,
    'tester', CASE WHEN v_tester.id IS NULL THEN NULL ELSE jsonb_build_object(
      'display_name',   v_tester.display_name,
      'email',          v_tester.email,
      'is_active',      v_tester.is_active,
      'allow_pre_live', v_tester.allow_pre_live,
      'devices',        v_test_devices,
      'attempts',       v_test_attempts
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_finale_overview(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_finale_overview(TEXT) TO authenticated, service_role;

-- Harden get_public_finale_roster & get_public_finale_leaderboard to exclude inactive/test records explicitly
CREATE OR REPLACE FUNCTION public.get_public_finale_roster()
RETURNS TABLE (
  seat_number  INTEGER,
  student_name TEXT,
  college      TEXT,
  batch        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT r.seat_number, r.student_name, r.college, r.batch
  FROM public.championship_finale_approved_roster r
  WHERE r.is_active = true
    AND r.seat_number BETWEEN 1 AND 10
  ORDER BY r.seat_number ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_finale_roster() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_finale_leaderboard(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS TABLE (
  rank            INTEGER,
  seat_number     INTEGER,
  student_name    TEXT,
  college         TEXT,
  batch           TEXT,
  score           INTEGER,
  accuracy        NUMERIC,
  elapsed_seconds NUMERIC,
  submitted_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT lb.rank, lb.seat_number, lb.student_name, lb.college, lb.batch,
         lb.score, lb.accuracy, lb.elapsed_seconds, lb.submitted_at
  FROM public.championship_finale_leaderboard lb
  JOIN public.championship_finale_approved_roster r
    ON r.user_id = lb.user_id AND r.is_active = true
  WHERE lb.finale_code = trim(coalesce(p_finale_code, ''))
    AND lb.seat_number BETWEEN 1 AND 10
    AND NOT EXISTS (
      SELECT 1 FROM public.championship_finale_test_access t
      WHERE t.user_id = lb.user_id
    )
  ORDER BY lb.rank ASC NULLS LAST, lb.score DESC, lb.accuracy DESC, lb.elapsed_seconds ASC, lb.submitted_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_leaderboard(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_finale_leaderboard(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
