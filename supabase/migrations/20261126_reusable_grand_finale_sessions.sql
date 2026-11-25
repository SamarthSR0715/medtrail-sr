-- ================================================================================
-- MIGRATION: 20261126_reusable_grand_finale_sessions.sql
--
-- PURPOSE:
--   Upgrades MedTrailSR Grand Finale Format B into an unlimited Reusable Multi-Session
--   System (Session 1, Session 2, Session 3, ...) with zero deletion of historical
--   attempts, standings, or roster records:
--   1. Multi-session lifecycle:
--      DRAFT -> VALIDATED -> PUBLISHED (Waiting Room) -> LIVE (90s) -> ENDED -> ARCHIVED
--   2. Atomic active-session pointer (is_current + session_number) on
--      championship_finale_sets & championship_finale_public_state.
--   3. Per-session scoping of official attempts & leaderboard standings:
--      - Attempts unique per (user_id, finale_code) WHERE is_test = false
--      - Leaderboard unique per (finale_code, user_id) and (finale_code, seat_number)
--      - Configurable per-question points (default 100 pts)
--   4. Immutable archive table public.championship_finale_archives preserving
--      questions + standings before any reset or new session restart.
--   5. Admin session management RPCs:
--      - admin_get_finale_session_summary
--      - admin_unlock_finale_for_edit_atomic
--      - admin_create_new_finale_session_atomic
--      - admin_reset_finale_session_atomic
--      - get_public_finale_archives
--   6. Preserves all anti-cheat protections, approved 10-seat roster, Classic Crew
--      test isolation (is_test = true, seat_number = 0), Daily Pulse isolation,
--      SECURITY DEFINER search_path, explicit Data API REVOKE/GRANTs, and PostgREST reload.
-- ================================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. MULTI-SESSION COLUMNS & STATUS CONSTRAINTS ON sets AND public_state
-- ════════════════════════════════════════════════════════════════════════════════
DO $alter_sets_reusable$
DECLARE
  v_con_name TEXT;
BEGIN
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
$alter_sets_reusable$;

ALTER TABLE public.championship_finale_sets
  ADD COLUMN IF NOT EXISTS session_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by    UUID REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.championship_finale_sets
  DROP CONSTRAINT IF EXISTS chk_finale_sets_status,
  ADD CONSTRAINT chk_finale_sets_status
    CHECK (status IN ('draft', 'validated', 'published', 'live', 'ended', 'archived', 'closed'));

DO $alter_pub_reusable$
DECLARE
  v_con_name TEXT;
BEGIN
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_public_state'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_public_state DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END;
$alter_pub_reusable$;

ALTER TABLE public.championship_finale_public_state
  ADD COLUMN IF NOT EXISTS session_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ;

ALTER TABLE public.championship_finale_public_state
  DROP CONSTRAINT IF EXISTS chk_finale_public_state_status,
  ADD CONSTRAINT chk_finale_public_state_status
    CHECK (status IN ('draft', 'validated', 'published', 'live', 'ended', 'archived', 'closed'));

-- Ensure at most one current session pointer exists across sets and public_state
DO $backfill_current_set$
DECLARE
  v_cur_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.championship_finale_sets WHERE is_current = true) THEN
    SELECT id INTO v_cur_id
    FROM public.championship_finale_sets
    WHERE status <> 'archived'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;

    IF v_cur_id IS NULL THEN
      SELECT id INTO v_cur_id
      FROM public.championship_finale_sets
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;
    END IF;

    IF v_cur_id IS NOT NULL THEN
      UPDATE public.championship_finale_sets
      SET is_current = true
      WHERE id = v_cur_id;
    END IF;
  END IF;
END;
$backfill_current_set$;

DROP INDEX IF EXISTS public.uq_finale_sets_single_current;
CREATE UNIQUE INDEX uq_finale_sets_single_current
  ON public.championship_finale_sets (is_current)
  WHERE is_current = true;

-- Sync public_state rows cleanly from sets before adding public_state unique current index
INSERT INTO public.championship_finale_public_state (
  finale_code, title, status, question_count, duration_seconds,
  questions_frozen, published_at, live_started_at, ended_at, updated_at,
  session_number, is_current, archived_at
)
SELECT
  s.finale_code, s.title, s.status, s.question_count, s.duration_seconds,
  s.questions_frozen, s.published_at, s.live_started_at, s.ended_at, s.updated_at,
  s.session_number, s.is_current, s.archived_at
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
  updated_at       = EXCLUDED.updated_at,
  session_number   = EXCLUDED.session_number,
  is_current       = EXCLUDED.is_current,
  archived_at      = EXCLUDED.archived_at;

DROP INDEX IF EXISTS public.uq_finale_public_state_single_current;
CREATE UNIQUE INDEX uq_finale_public_state_single_current
  ON public.championship_finale_public_state (is_current)
  WHERE is_current = true;

-- Upgrade sync trigger so session_number, is_current, and archived_at stay synced in Realtime
CREATE OR REPLACE FUNCTION public.trg_fn_sync_finale_public_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.championship_finale_public_state (
    finale_code, title, status, question_count, duration_seconds,
    questions_frozen, published_at, live_started_at, ended_at, updated_at,
    session_number, is_current, archived_at
  )
  VALUES (
    NEW.finale_code, NEW.title, NEW.status, NEW.question_count, NEW.duration_seconds,
    NEW.questions_frozen, NEW.published_at, NEW.live_started_at, NEW.ended_at, NEW.updated_at,
    NEW.session_number, NEW.is_current, NEW.archived_at
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
    updated_at       = EXCLUDED.updated_at,
    session_number   = EXCLUDED.session_number,
    is_current       = EXCLUDED.is_current,
    archived_at      = EXCLUDED.archived_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_sync_finale_public_state() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. PER-SESSION ATTEMPTS, LEADERBOARD, AND CONFIGURABLE POINTS SCHEMA
-- ════════════════════════════════════════════════════════════════════════════════
-- Attempts: scope official attempt uniqueness to (user_id, finale_code)
DROP INDEX IF EXISTS public.uq_finale_attempt_official_user;
DROP INDEX IF EXISTS public.uq_finale_attempt_official_user_finale;
CREATE UNIQUE INDEX uq_finale_attempt_official_user_finale
  ON public.championship_finale_attempts (user_id, finale_code)
  WHERE is_test = false;

-- Relax score ceiling on attempts to support customizable per-question XP/points (up to 1000 per Q)
DO $alter_attempts_score$
DECLARE
  v_con_name TEXT;
BEGIN
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_attempts'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%score%'
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_attempts DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END;
$alter_attempts_score$;

ALTER TABLE public.championship_finale_attempts
  DROP CONSTRAINT IF EXISTS chk_finale_attempts_score_range,
  ADD CONSTRAINT chk_finale_attempts_score_range
    CHECK (score >= 0 AND score <= 10000);

-- Leaderboard: replace global user_id & seat_number UNIQUEs with per-session (finale_code, ...) UNIQUEs
DO $alter_leaderboard_uniques$
DECLARE
  v_con_name TEXT;
BEGIN
  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_leaderboard'::regclass
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_leaderboard DROP CONSTRAINT %I', v_con_name);
  END LOOP;

  FOR v_con_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.championship_finale_leaderboard'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%score%'
  LOOP
    EXECUTE format('ALTER TABLE public.championship_finale_leaderboard DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END;
$alter_leaderboard_uniques$;

ALTER TABLE public.championship_finale_leaderboard
  DROP CONSTRAINT IF EXISTS uq_finale_lb_code_user,
  ADD CONSTRAINT uq_finale_lb_code_user UNIQUE (finale_code, user_id),
  DROP CONSTRAINT IF EXISTS uq_finale_lb_code_seat,
  ADD CONSTRAINT uq_finale_lb_code_seat UNIQUE (finale_code, seat_number),
  DROP CONSTRAINT IF EXISTS chk_finale_lb_score_range,
  ADD CONSTRAINT chk_finale_lb_score_range CHECK (score >= 0 AND score <= 10000);

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. IMMUTABLE SESSION ARCHIVE TABLE: championship_finale_archives
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_archives (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  finale_code       TEXT        NOT NULL UNIQUE,
  session_number    INTEGER     NOT NULL,
  title             TEXT        NOT NULL,
  previous_status   TEXT        NOT NULL,
  questions         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  standings         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  participant_count INTEGER     NOT NULL DEFAULT 0,
  submission_count  INTEGER     NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ,
  live_started_at   TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_by       UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
  archive_reason    TEXT        NOT NULL DEFAULT 'Session archived'
);

ALTER TABLE public.championship_finale_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin only read finale archives" ON public.championship_finale_archives;
CREATE POLICY "Admin only read finale archives"
  ON public.championship_finale_archives
  FOR SELECT TO authenticated
  USING (public.is_finale_admin());

REVOKE ALL ON TABLE public.championship_finale_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.championship_finale_archives TO authenticated;
GRANT ALL ON TABLE public.championship_finale_archives TO service_role;

CREATE OR REPLACE FUNCTION public.trg_fn_finale_archive_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'FINALE_ARCHIVE_IMMUTABLE: Archived Finale session snapshots are permanently immutable.';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_archive_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finale_archive_immutable ON public.championship_finale_archives;
CREATE TRIGGER trg_finale_archive_immutable
  BEFORE UPDATE OR DELETE ON public.championship_finale_archives
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_finale_archive_immutable();

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. UPGRADE FREEZE TRIGGER TO PROTECT ARCHIVES WHILE ALLOWING FORWARD ARCHIVING
-- ════════════════════════════════════════════════════════════════════════════════
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
  IF OLD.status = 'archived' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'FINALE_ARCHIVE_IMMUTABLE: Archived Grand Finale sets cannot be deleted.';
    END IF;
    RAISE EXCEPTION 'FINALE_ARCHIVE_IMMUTABLE: Archived Grand Finale sets are permanently read-only.';
  END IF;

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

  -- Strictly forbid editing question bank or published/live start metadata once frozen
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.finale_code IS DISTINCT FROM OLD.finale_code
     OR NEW.session_number IS DISTINCT FROM OLD.session_number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.questions IS DISTINCT FROM OLD.questions
     OR NEW.question_count IS DISTINCT FROM OLD.question_count
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by
     OR NEW.live_started_at IS DISTINCT FROM OLD.live_started_at
     OR NEW.live_started_by IS DISTINCT FROM OLD.live_started_by
     OR NEW.questions_frozen IS DISTINCT FROM OLD.questions_frozen
  THEN
    RAISE EXCEPTION 'FINALE_SET_FROZEN: Questions are permanently frozen once the session starts; archive this session and start a new one to edit.';
  END IF;

  -- Allow forward closure/archiving transitions only
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'live' AND NEW.status IN ('ended', 'closed', 'archived'))
      OR
      (OLD.status IN ('draft', 'validated', 'published', 'ended', 'closed') AND NEW.status = 'archived')
    ) THEN
      RAISE EXCEPTION 'FINALE_SET_FROZEN: Invalid lifecycle transition on frozen set (% -> %).', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_set_freeze_on_session() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. INTERNAL ACTIVE SESSION RESOLVER HELPER
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_current_finale_code(
  p_requested_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req  TEXT := trim(coalesce(p_requested_code, ''));
  v_code TEXT;
BEGIN
  IF v_req <> '' AND upper(v_req) <> 'CURRENT' THEN
    RETURN v_req;
  END IF;

  SELECT s.finale_code INTO v_code
  FROM public.championship_finale_sets s
  WHERE s.is_current = true
  LIMIT 1;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  SELECT s.finale_code INTO v_code
  FROM public.championship_finale_sets s
  WHERE s.status <> 'archived'
  ORDER BY s.session_number DESC, s.updated_at DESC
  LIMIT 1;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  SELECT s.finale_code INTO v_code
  FROM public.championship_finale_sets s
  ORDER BY s.session_number DESC, s.updated_at DESC
  LIMIT 1;

  RETURN coalesce(v_code, 'FINALE_S1_20261124');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_current_finale_code(TEXT) FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. UPGRADED LIFECYCLE, EXAM, AND SESSION-MANAGEMENT RPCs
-- ════════════════════════════════════════════════════════════════════════════════

-- RPC 1: publish_finale_set_atomic (supports draft, validated, published + custom points)
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
  v_code                 TEXT        := public.resolve_current_finale_code(p_finale_code);
  v_title                TEXT        := coalesce(nullif(trim(p_title), ''), 'MedTrail Championship Season 1 Grand Finale');
  v_set_id               UUID;
  v_existing_set         public.championship_finale_sets%ROWTYPE;
  v_has_official_session BOOLEAN;
  v_q                    JSONB;
  v_slot                 INTEGER     := 0;
  v_answer               TEXT;
  v_difficulty           TEXT;
  v_points_str           TEXT;
  v_points               INTEGER;
  v_normalized_questions JSONB       := '[]'::jsonb;
  v_has_current          BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  IF v_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'finale_code is required.');
  END IF;

  IF p_status NOT IN ('draft', 'validated', 'published') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid target status. Use Go Live Finale / End Finale / Archive controls for live, ended, or archived transitions.'
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
       OR v_existing_set.status IN ('live', 'ended', 'archived', 'closed')
       OR v_has_official_session
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This Finale session is locked or archived. Start a New Finale Session or Reset Current Session to edit questions cleanly.'
      );
    END IF;
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_questions must be a JSON array.');
  END IF;

  IF jsonb_array_length(p_questions) > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Grand Finale supports at most 10 question slots.');
  END IF;

  IF p_status IN ('validated', 'published') AND jsonb_array_length(p_questions) <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Grand Finale must contain all 10 complete questions to validate or publish. Found: ' || jsonb_array_length(p_questions)
    );
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_slot := v_slot + 1;
    v_answer := upper(trim(coalesce(v_q->>'correct_answer', '')));
    v_difficulty := initcap(lower(trim(coalesce(v_q->>'difficulty', ''))));
    v_points_str := coalesce(nullif(trim(v_q->>'points'), ''), '100');

    IF v_points_str !~ '^\d+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': points must be an integer between 1 and 1000.');
    END IF;
    v_points := v_points_str::integer;
    IF v_points < 1 OR v_points > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Slot ' || v_slot || ': points must be between 1 and 1000.');
    END IF;

    IF p_status IN ('validated', 'published') THEN
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
      'difficulty',     v_difficulty,
      'points',         v_points
    );
  END LOOP;

  -- Expire any currently active pre-live test session so testers reload updated questions
  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = v_now
  WHERE finale_code = v_code
    AND is_test = true
    AND status = 'active';

  SELECT EXISTS (SELECT 1 FROM public.championship_finale_sets WHERE is_current = true) INTO v_has_current;

  INSERT INTO public.championship_finale_sets (
    finale_code, title, status, questions, question_count,
    duration_seconds, published_at, published_by, updated_at,
    session_number, is_current
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
    v_now,
    coalesce(v_existing_set.session_number, 1),
    CASE WHEN v_existing_set.id IS NOT NULL THEN v_existing_set.is_current ELSE NOT v_has_current END
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

-- RPC 2: go_live_finale_atomic
CREATE OR REPLACE FUNCTION public.go_live_finale_atomic(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid   UUID        := auth.uid();
  v_now          TIMESTAMPTZ := clock_timestamp();
  v_code         TEXT        := public.resolve_current_finale_code(p_finale_code);
  v_set          public.championship_finale_sets%ROWTYPE;
  v_roster_count INTEGER;
  v_q            JSONB;
  v_slot         INTEGER     := 0;
  v_answer       TEXT;
  v_difficulty   TEXT;
  v_points_str   TEXT;
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

  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_slot := v_slot + 1;
    v_answer := upper(trim(coalesce(v_q->>'correct_answer', '')));
    v_difficulty := initcap(lower(trim(coalesce(v_q->>'difficulty', ''))));
    v_points_str := coalesce(nullif(trim(v_q->>'points'), ''), '100');

    IF coalesce(trim(v_q->>'question'), '') = ''
       OR coalesce(trim(v_q->>'option_a'), '') = ''
       OR coalesce(trim(v_q->>'option_b'), '') = ''
       OR coalesce(trim(v_q->>'option_c'), '') = ''
       OR coalesce(trim(v_q->>'option_d'), '') = ''
       OR v_answer NOT IN ('A', 'B', 'C', 'D')
       OR coalesce(trim(v_q->>'explanation'), '') = ''
       OR coalesce(trim(v_q->>'subject'), '') = ''
       OR v_difficulty NOT IN ('Easy', 'Medium', 'Hard')
       OR v_points_str !~ '^\d+$'
       OR v_points_str::integer < 1
       OR v_points_str::integer > 1000
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Slot ' || v_slot || ' is incomplete. Re-publish all 10 questions before Go Live.'
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_roster_count
  FROM public.championship_finale_approved_roster
  WHERE seat_number BETWEEN 1 AND 10;

  IF v_roster_count <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Expected 10 approved finalists in roster before Go Live; found ' || v_roster_count
    );
  END IF;

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
    'success',          true,
    'finale_code',      v_code,
    'session_number',   v_set.session_number,
    'status',           'live',
    'live_started_at',  v_now,
    'questions_frozen', true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.go_live_finale_atomic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.go_live_finale_atomic(TEXT) TO authenticated, service_role;

-- RPC 3: end_finale_atomic
CREATE OR REPLACE FUNCTION public.end_finale_atomic(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_code           TEXT        := public.resolve_current_finale_code(p_finale_code);
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

  IF v_set.status IN ('ended', 'archived', 'closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Grand Finale session has already ended.');
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
    'session_number',   v_set.session_number,
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

-- RPC 4: admin_unlock_finale_for_edit_atomic
-- Allows editing in place ONLY when zero official sessions exist and not live/ended/archived.
CREATE OR REPLACE FUNCTION public.admin_unlock_finale_for_edit_atomic(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid           UUID        := auth.uid();
  v_now                  TIMESTAMPTZ := clock_timestamp();
  v_code                 TEXT        := public.resolve_current_finale_code(p_finale_code);
  v_set                  public.championship_finale_sets%ROWTYPE;
  v_has_official_session BOOLEAN     := false;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR UPDATE;

  IF v_set.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'finale_code', v_code, 'status', 'draft', 'unlocked_in_place', true);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.championship_finale_sessions s
    WHERE (s.finale_set_id = v_set.id OR s.finale_code = v_code)
      AND s.is_test = false
  ) INTO v_has_official_session;

  IF v_set.questions_frozen
     OR v_set.status IN ('live', 'ended', 'archived', 'closed')
     OR v_has_official_session
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'requires_new_session', true,
      'status', v_set.status,
      'error', 'Completed, live, or archived sessions cannot be unlocked in place. Use START NEW FINALE SESSION or RESET CURRENT SESSION to archive results and open a clean editable draft.'
    );
  END IF;

  -- Expire any active pre-live test sessions so testers pick up edits after unlock
  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = v_now
  WHERE finale_code = v_code
    AND is_test = true
    AND status = 'active';

  UPDATE public.championship_finale_sets
  SET status     = 'draft',
      updated_at = v_now
  WHERE id = v_set.id;

  RETURN jsonb_build_object(
    'success',          true,
    'finale_code',      v_code,
    'session_number',   v_set.session_number,
    'status',           'draft',
    'unlocked_in_place', true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlock_finale_for_edit_atomic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlock_finale_for_edit_atomic(TEXT) TO authenticated, service_role;

-- RPC 5: admin_get_finale_session_summary
-- Returns live participant & submission counts before destructive-looking confirmation prompts.
CREATE OR REPLACE FUNCTION public.admin_get_finale_session_summary(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code                      TEXT := public.resolve_current_finale_code(p_finale_code);
  v_set                       public.championship_finale_sets%ROWTYPE;
  v_official_participants     INTEGER := 0;
  v_official_submissions      INTEGER := 0;
  v_test_submissions          INTEGER := 0;
  v_leaderboard_entries       INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  SELECT * INTO v_set FROM public.championship_finale_sets WHERE finale_code = v_code;

  SELECT count(DISTINCT user_id) INTO v_official_participants
  FROM public.championship_finale_sessions
  WHERE finale_code = v_code AND is_test = false;

  SELECT count(*) INTO v_official_submissions
  FROM public.championship_finale_attempts
  WHERE finale_code = v_code AND is_test = false;

  SELECT count(*) INTO v_test_submissions
  FROM public.championship_finale_attempts
  WHERE finale_code = v_code AND is_test = true;

  SELECT count(*) INTO v_leaderboard_entries
  FROM public.championship_finale_leaderboard
  WHERE finale_code = v_code;

  RETURN jsonb_build_object(
    'success',                   true,
    'finale_code',               v_code,
    'session_number',            coalesce(v_set.session_number, 1),
    'title',                     coalesce(v_set.title, 'MedTrail Championship Season 1 Grand Finale'),
    'status',                    coalesce(v_set.status, 'draft'),
    'official_participant_count', v_official_participants,
    'official_submission_count',  v_official_submissions,
    'test_submission_count',      v_test_submissions,
    'leaderboard_count',          v_leaderboard_entries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_finale_session_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_finale_session_summary(TEXT) TO authenticated, service_role;

-- Internal helper to snapshot & archive any existing session cleanly without deleting rows
CREATE OR REPLACE FUNCTION public._archive_finale_set_internal(
  p_set         public.championship_finale_sets,
  p_actor_uid   UUID,
  p_reason      TEXT,
  p_now         TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_standings         JSONB   := '[]'::jsonb;
  v_participant_count INTEGER := 0;
  v_submission_count  INTEGER := 0;
  v_ended_at          TIMESTAMPTZ;
BEGIN
  IF p_set.id IS NULL THEN
    RETURN;
  END IF;

  -- Close any lingering active sessions on this code
  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = p_now
  WHERE finale_code = p_set.finale_code
    AND status = 'active';

  SELECT count(DISTINCT user_id) INTO v_participant_count
  FROM public.championship_finale_sessions
  WHERE finale_code = p_set.finale_code AND is_test = false;

  SELECT count(*) INTO v_submission_count
  FROM public.championship_finale_attempts
  WHERE finale_code = p_set.finale_code AND is_test = false;

  SELECT coalesce(jsonb_agg(row_to_json(lb_row) ORDER BY lb_row.rank ASC), '[]'::jsonb)
  INTO v_standings
  FROM (
    SELECT rank, seat_number, student_name, college, batch, score, accuracy, elapsed_seconds, submitted_at
    FROM public.championship_finale_leaderboard
    WHERE finale_code = p_set.finale_code
  ) lb_row;

  v_ended_at := coalesce(p_set.ended_at, CASE WHEN p_set.status = 'live' THEN p_now ELSE NULL END);

  INSERT INTO public.championship_finale_archives (
    finale_code, session_number, title, previous_status,
    questions, standings, participant_count, submission_count,
    published_at, live_started_at, ended_at, archived_at, archived_by, archive_reason
  )
  VALUES (
    p_set.finale_code,
    p_set.session_number,
    p_set.title,
    p_set.status,
    p_set.questions,
    v_standings,
    v_participant_count,
    v_submission_count,
    p_set.published_at,
    p_set.live_started_at,
    v_ended_at,
    p_now,
    p_actor_uid,
    coalesce(nullif(trim(p_reason), ''), 'Session archived')
  )
  ON CONFLICT (finale_code) DO NOTHING;

  IF p_set.status <> 'archived' OR p_set.is_current = true THEN
    UPDATE public.championship_finale_sets
    SET status      = 'archived',
        ended_at    = coalesce(ended_at, v_ended_at),
        ended_by    = coalesce(ended_by, CASE WHEN status = 'live' THEN p_actor_uid ELSE NULL END),
        archived_at = coalesce(archived_at, p_now),
        archived_by = coalesce(archived_by, p_actor_uid),
        is_current  = false,
        updated_at  = p_now
    WHERE id = p_set.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._archive_finale_set_internal(public.championship_finale_sets, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- RPC 6: admin_create_new_finale_session_atomic
-- Archives current session immutably and starts a fresh Session #N+1 with zero prior scores/attempts.
CREATE OR REPLACE FUNCTION public.admin_create_new_finale_session_atomic(
  p_copy_questions BOOLEAN DEFAULT true,
  p_title          TEXT    DEFAULT NULL,
  p_reason         TEXT    DEFAULT 'New Grand Finale session started by admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_cur_code       TEXT        := public.resolve_current_finale_code(NULL);
  v_cur_set        public.championship_finale_sets%ROWTYPE;
  v_next_num       INTEGER;
  v_new_code       TEXT;
  v_new_title      TEXT;
  v_new_questions  JSONB       := '[]'::jsonb;
  v_old_sub_count  INTEGER     := 0;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  -- Serialize concurrent session creations
  PERFORM pg_advisory_xact_lock(hashtext('finale_session_rotation_lock'));

  SELECT * INTO v_cur_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_cur_code
  FOR UPDATE;

  IF v_cur_set.id IS NOT NULL THEN
    SELECT count(*) INTO v_old_sub_count
    FROM public.championship_finale_attempts
    WHERE finale_code = v_cur_set.finale_code AND is_test = false;

    IF p_copy_questions AND v_cur_set.questions IS NOT NULL AND jsonb_typeof(v_cur_set.questions) = 'array' THEN
      v_new_questions := v_cur_set.questions;
    END IF;

    PERFORM public._archive_finale_set_internal(v_cur_set, v_caller_uid, p_reason, v_now);
  END IF;

  -- Clear any lingering is_current flag defensively
  UPDATE public.championship_finale_sets
  SET is_current = false, updated_at = v_now
  WHERE is_current = true;

  SELECT coalesce(max(session_number), 0) + 1 INTO v_next_num
  FROM public.championship_finale_sets;

  v_new_code := 'FINALE_S1_SESSION_' || v_next_num || '_' || to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');
  v_new_title := coalesce(nullif(trim(p_title), ''), 'MedTrail Championship Grand Finale — Session ' || v_next_num);

  INSERT INTO public.championship_finale_sets (
    finale_code, title, status, questions, question_count,
    duration_seconds, session_number, is_current, questions_frozen, updated_at
  )
  VALUES (
    v_new_code,
    v_new_title,
    'draft',
    v_new_questions,
    jsonb_array_length(v_new_questions),
    90,
    v_next_num,
    true,
    false,
    v_now
  );

  RETURN jsonb_build_object(
    'success',              true,
    'new_finale_code',      v_new_code,
    'session_number',       v_next_num,
    'title',                v_new_title,
    'copied_questions',     p_copy_questions,
    'archived_finale_code', v_cur_set.finale_code,
    'archived_submissions', v_old_sub_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_new_finale_session_atomic(BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_new_finale_session_atomic(BOOLEAN, TEXT, TEXT) TO authenticated, service_role;

-- RPC 7: admin_reset_finale_session_atomic
-- Powers RESET CURRENT SESSION and CLEAR SESSION STANDINGS:
--   - If the active session has zero official attempts/sessions/leaderboard entries (pre-live),
--     expires test runs and resets to draft cleanly in place (clearing questions if requested).
--   - If any official sessions/attempts/standings exist, archives them immutably FIRST and rotates
--     to a clean zero-standings replacement session without deleting historical records!
CREATE OR REPLACE FUNCTION public.admin_reset_finale_session_atomic(
  p_finale_code     TEXT    DEFAULT NULL,
  p_clear_questions BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid            UUID        := auth.uid();
  v_now                   TIMESTAMPTZ := clock_timestamp();
  v_code                  TEXT        := public.resolve_current_finale_code(p_finale_code);
  v_cur_set               public.championship_finale_sets%ROWTYPE;
  v_official_participants INTEGER     := 0;
  v_official_submissions  INTEGER     := 0;
  v_lb_count              INTEGER     := 0;
  v_next_num              INTEGER;
  v_new_code              TEXT;
  v_new_questions         JSONB       := '[]'::jsonb;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_session_rotation_lock'));

  SELECT * INTO v_cur_set
  FROM public.championship_finale_sets
  WHERE finale_code = v_code
  FOR UPDATE;

  IF v_cur_set.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'mode', 'no_active_set', 'finale_code', v_code, 'affected_submissions', 0);
  END IF;

  SELECT count(DISTINCT user_id) INTO v_official_participants
  FROM public.championship_finale_sessions
  WHERE finale_code = v_code AND is_test = false;

  SELECT count(*) INTO v_official_submissions
  FROM public.championship_finale_attempts
  WHERE finale_code = v_code AND is_test = false;

  SELECT count(*) INTO v_lb_count
  FROM public.championship_finale_leaderboard
  WHERE finale_code = v_code;

  IF NOT v_cur_set.questions_frozen
     AND v_cur_set.status IN ('draft', 'validated', 'published')
     AND v_official_participants = 0
     AND v_official_submissions = 0
     AND v_lb_count = 0
  THEN
    -- Safe pre-live reset in place (zero official data exists)
    UPDATE public.championship_finale_sessions
    SET status = 'expired', updated_at = v_now
    WHERE finale_code = v_code AND status = 'active';

    UPDATE public.championship_finale_sets
    SET status         = 'draft',
        questions      = CASE WHEN p_clear_questions THEN '[]'::jsonb ELSE questions END,
        question_count = CASE WHEN p_clear_questions THEN 0 ELSE question_count END,
        updated_at     = v_now
    WHERE id = v_cur_set.id;

    RETURN jsonb_build_object(
      'success',               true,
      'mode',                  'in_place_pre_live_reset',
      'finale_code',           v_code,
      'new_finale_code',       v_code,
      'session_number',        v_cur_set.session_number,
      'affected_participants', 0,
      'affected_submissions',  0,
      'archived',              false
    );
  END IF;

  -- Otherwise preserve official results in archive and rotate cleanly to zero-standings draft
  IF NOT p_clear_questions AND v_cur_set.questions IS NOT NULL AND jsonb_typeof(v_cur_set.questions) = 'array' THEN
    v_new_questions := v_cur_set.questions;
  END IF;

  PERFORM public._archive_finale_set_internal(
    v_cur_set,
    v_caller_uid,
    CASE WHEN p_clear_questions THEN 'Admin reset current session (archived)' ELSE 'Admin cleared session standings (archived)' END,
    v_now
  );

  UPDATE public.championship_finale_sets
  SET is_current = false, updated_at = v_now
  WHERE is_current = true;

  SELECT coalesce(max(session_number), 0) + 1 INTO v_next_num
  FROM public.championship_finale_sets;

  v_new_code := 'FINALE_S1_SESSION_' || v_next_num || '_' || to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');

  INSERT INTO public.championship_finale_sets (
    finale_code, title, status, questions, question_count,
    duration_seconds, session_number, is_current, questions_frozen, updated_at
  )
  VALUES (
    v_new_code,
    'MedTrail Championship Grand Finale — Session ' || v_next_num,
    'draft',
    v_new_questions,
    jsonb_array_length(v_new_questions),
    90,
    v_next_num,
    true,
    false,
    v_now
  );

  RETURN jsonb_build_object(
    'success',               true,
    'mode',                  'archived_and_reset_to_new_session',
    'previous_finale_code',  v_code,
    'new_finale_code',       v_new_code,
    'session_number',        v_next_num,
    'affected_participants', v_official_participants,
    'affected_submissions',  v_official_submissions,
    'archived',              true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_finale_session_atomic(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_finale_session_atomic(TEXT, BOOLEAN) TO authenticated, service_role;

-- RPC 8: start_finale_pulse_session_atomic
-- Resolves active session automatically when NULL/'CURRENT', enforces per-(user_id, finale_code)
-- official attempt limit so Session 1 participants can compete in Session 2+.
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

  -- 1. Check Official Finalist Roster first
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
    -- 4A. Official finalist: strictly 1 attempt per user PER FINALE_CODE
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
  ELSE
    -- 4B. Classic Crew isolated test session
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

-- RPC 9: submit_finale_pulse_attempt_atomic
-- Grades against per-question points (default 100), enforces per-session uniqueness,
-- and isolates leaderboard ranking cleanly per finale_code.
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
  v_q_points       INTEGER;
  v_score          INTEGER     := 0;
  v_max_score      INTEGER     := 0;
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

-- RPC 10: get_public_finale_status
CREATE OR REPLACE FUNCTION public.get_public_finale_status(
  p_finale_code TEXT DEFAULT NULL,
  p_device_id   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code              TEXT := public.resolve_current_finale_code(p_finale_code);
  v_device_id         TEXT := trim(coalesce(p_device_id, ''));
  v_caller_uid        UUID := auth.uid();
  v_caller_email      TEXT := '';
  v_pub               public.championship_finale_public_state%ROWTYPE;
  v_finalist          public.championship_finale_approved_roster%ROWTYPE;
  v_tester            public.championship_finale_test_access%ROWTYPE;
  v_test_device       public.championship_finale_test_devices%ROWTYPE;
  v_has_submitted     BOOLEAN := false;
  v_active_expires    TIMESTAMPTZ := NULL;
  v_archive_count     INTEGER := 0;
BEGIN
  SELECT * INTO v_pub
  FROM public.championship_finale_public_state
  WHERE finale_code = v_code;

  SELECT count(*) INTO v_archive_count
  FROM public.championship_finale_archives;

  IF v_caller_uid IS NOT NULL THEN
    SELECT lower(trim(coalesce(email, ''))) INTO v_caller_email
    FROM auth.users WHERE id = v_caller_uid;

    SELECT * INTO v_finalist
    FROM public.championship_finale_approved_roster
    WHERE seat_number BETWEEN 1 AND 10
      AND (
        user_id = v_caller_uid
        OR (user_id IS NULL AND v_caller_email <> '' AND lower(trim(email)) = v_caller_email)
      )
    LIMIT 1;

    IF v_finalist.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.championship_finale_attempts
        WHERE user_id = v_caller_uid AND finale_code = v_code AND is_test = false
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
    'session_number',               coalesce(v_pub.session_number, 1),
    'title',                        coalesce(v_pub.title, 'MedTrail Championship Season 1 Grand Finale'),
    'status',                       coalesce(v_pub.status, 'draft'),
    'question_count',               coalesce(v_pub.question_count, 0),
    'duration_seconds',             coalesce(v_pub.duration_seconds, 90),
    'questions_frozen',             coalesce(v_pub.questions_frozen, false),
    'published_at',                 v_pub.published_at,
    'live_started_at',              v_pub.live_started_at,
    'ended_at',                     v_pub.ended_at,
    'archived_at',                  v_pub.archived_at,
    'archive_count',                v_archive_count,
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

-- RPC 11: get_public_finale_leaderboard
CREATE OR REPLACE FUNCTION public.get_public_finale_leaderboard(
  p_finale_code TEXT DEFAULT NULL
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
    ON r.user_id = lb.user_id AND r.seat_number BETWEEN 1 AND 10
  WHERE lb.finale_code = public.resolve_current_finale_code(p_finale_code)
    AND lb.seat_number BETWEEN 1 AND 10
    AND NOT EXISTS (
      SELECT 1 FROM public.championship_finale_test_access t
      WHERE t.user_id = lb.user_id
    )
  ORDER BY lb.rank ASC NULLS LAST, lb.score DESC, lb.accuracy DESC, lb.elapsed_seconds ASC, lb.submitted_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_leaderboard(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_finale_leaderboard(TEXT) TO anon, authenticated, service_role;

-- RPC 12: get_public_finale_archives
-- Returns historical archived session standings cleanly (never exposes question keys or PII).
CREATE OR REPLACE FUNCTION public.get_public_finale_archives()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'finale_code',       a.finale_code,
        'session_number',    a.session_number,
        'title',             a.title,
        'previous_status',   a.previous_status,
        'participant_count', a.participant_count,
        'submission_count',  a.submission_count,
        'published_at',      a.published_at,
        'live_started_at',   a.live_started_at,
        'ended_at',          a.ended_at,
        'archived_at',       a.archived_at,
        'standings',         a.standings
      )
      ORDER BY a.session_number DESC, a.archived_at DESC
    ),
    '[]'::jsonb
  )
  FROM public.championship_finale_archives a;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_archives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_finale_archives() TO anon, authenticated, service_role;

-- RPC 13: admin_reset_finale_test_sessions (auto-resolves active session when NULL/'CURRENT')
CREATE OR REPLACE FUNCTION public.admin_reset_finale_test_sessions(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid    UUID := auth.uid();
  v_code          TEXT := public.resolve_current_finale_code(p_finale_code);
  v_expired_count INTEGER := 0;
BEGIN
  IF v_caller_uid IS NULL OR NOT public.is_finale_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Finale admin access required.');
  END IF;

  UPDATE public.championship_finale_sessions
  SET status = 'expired', updated_at = clock_timestamp()
  WHERE finale_code = v_code
    AND is_test = true
    AND status = 'active';
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'finale_code', v_code, 'expired_test_sessions', v_expired_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_finale_test_sessions(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_finale_test_sessions(TEXT) TO authenticated, service_role;

-- RPC 14: admin_get_finale_overview (resolves current session + returns immutable archives)
CREATE OR REPLACE FUNCTION public.admin_get_finale_overview(
  p_finale_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_code          TEXT := public.resolve_current_finale_code(p_finale_code);
  v_set           public.championship_finale_sets%ROWTYPE;
  v_roster        JSONB;
  v_leaderboard   JSONB;
  v_tester        public.championship_finale_test_access%ROWTYPE;
  v_test_devices  JSONB;
  v_test_attempts JSONB;
  v_archives      JSONB;
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
      (r.seat_number BETWEEN 1 AND 10) AS is_active,
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

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                a.id,
        'finale_code',       a.finale_code,
        'session_number',    a.session_number,
        'title',             a.title,
        'previous_status',   a.previous_status,
        'participant_count', a.participant_count,
        'submission_count',  a.submission_count,
        'published_at',      a.published_at,
        'live_started_at',   a.live_started_at,
        'ended_at',          a.ended_at,
        'archived_at',       a.archived_at,
        'archive_reason',    a.archive_reason,
        'standings',         a.standings,
        'questions',         a.questions
      )
      ORDER BY a.session_number DESC, a.archived_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_archives
  FROM public.championship_finale_archives a;

  RETURN jsonb_build_object(
    'success',        true,
    'finale_code',    v_code,
    'session_number', coalesce(v_set.session_number, 1),
    'set', CASE WHEN v_set.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',                    v_set.id,
      'finale_code',           v_set.finale_code,
      'session_number',        v_set.session_number,
      'is_current',            v_set.is_current,
      'title',                 v_set.title,
      'status',                v_set.status,
      'questions',             v_set.questions,
      'question_count',        v_set.question_count,
      'duration_seconds',      v_set.duration_seconds,
      'questions_frozen',      v_set.questions_frozen OR v_set.status IN ('live', 'ended', 'archived', 'closed') OR v_official_cnt > 0,
      'official_session_count', v_official_cnt,
      'published_at',          v_set.published_at,
      'live_started_at',       v_set.live_started_at,
      'ended_at',              v_set.ended_at,
      'archived_at',           v_set.archived_at,
      'updated_at',            v_set.updated_at
    ) END,
    'roster',      v_roster,
    'leaderboard', v_leaderboard,
    'archives',    v_archives,
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

NOTIFY pgrst, 'reload schema';

COMMIT;

