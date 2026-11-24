-- ==============================================================================
-- Migration: 20261124_championship_finale_format_b.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Format B (90-Second Rapid Fire)
--
-- DESIGN PRINCIPLES:
--   1. FULLY ISOLATED from championship_pulse_* tables. No shared sessions,
--      attempts, or leaderboard rows. Existing daily Pulse is 100% untouched.
--   2. Server-authoritative 90-second deadline enforced at COMMIT time, not at
--      client request time. 2-second network tolerance. Hard reject beyond that.
--   3. Finalist access via whitelist roster. Email-match only permitted when
--      user_id IS NULL. Linked accounts are immutably bound.
--   4. Attempts are immutable. ON CONFLICT DO NOTHING with explicit error return.
--   5. Concurrent duplicate submissions blocked via FOR UPDATE row lock on session.
--   6. Leaderboard is served exclusively through sanitized SECURITY DEFINER RPC.
--      No public table access. Zero PII exposed.
--   7. All SECURITY DEFINER functions set explicit search_path.
--   8. Correct answers and explanations never exposed before submission.
--
-- DEPENDENCIES (must already exist in production):
--   - auth.users (Supabase Auth)
--   - public.is_admin() (from 20261002_editable_student_details_and_mandatory_registration.sql)
--
-- SAFE TO RERUN: All statements use IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
-- ==============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════════
-- TABLE 1: championship_finale_approved_roster
-- The authoritative whitelist of the 10 approved Grand Finale contestants.
-- PII is locked down. Zero public SELECT access on this table.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_approved_roster (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_number  INTEGER     NOT NULL UNIQUE CHECK (seat_number BETWEEN 1 AND 10),
  student_name TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  -- user_id is NULL until the contestant signs in and is linked.
  -- Once linked it is immutable; cannot be relinked to another seat.
  user_id      UUID        UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  college      TEXT        NOT NULL,
  batch        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.championship_finale_approved_roster ENABLE ROW LEVEL SECURITY;

-- Only admins can query this table directly (emails, user_ids etc. are PII).
DROP POLICY IF EXISTS "Admin only: read finale roster" ON public.championship_finale_approved_roster;
CREATE POLICY "Admin only: read finale roster"
  ON public.championship_finale_approved_roster
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Only service_role / admin may INSERT/UPDATE/DELETE (via RPC or admin console).
-- Contestants never write to this table directly.
REVOKE INSERT, UPDATE, DELETE
  ON public.championship_finale_approved_roster
  FROM authenticated, anon, public;

GRANT ALL
  ON public.championship_finale_approved_roster
  TO service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- TABLE 2: championship_finale_sets
-- Admin-managed question bank for the Finale.
-- Distinct from championship_pulse_sets; allows 10 slots with no slot CHECK conflict.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_sets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  finale_code    TEXT        NOT NULL UNIQUE DEFAULT 'FINALE_S1_20261124',
  title          TEXT        NOT NULL DEFAULT 'MedTrail Championship Season 1 Grand Finale',
  status         TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published', 'closed')),
  -- questions stores the full JSONB array including correct_answer & explanation.
  -- Never served directly to contestants; RPC strips sensitive keys on delivery.
  questions      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  question_count INTEGER     NOT NULL DEFAULT 0 CHECK (question_count BETWEEN 0 AND 10),
  duration_seconds INTEGER   NOT NULL DEFAULT 90 CHECK (duration_seconds = 90),
  published_at   TIMESTAMPTZ,
  published_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.championship_finale_sets ENABLE ROW LEVEL SECURITY;

-- Admins can read draft and published sets.
DROP POLICY IF EXISTS "Admin read/write finale sets" ON public.championship_finale_sets;
CREATE POLICY "Admin read/write finale sets"
  ON public.championship_finale_sets
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE INSERT, UPDATE, DELETE
  ON public.championship_finale_sets
  FROM authenticated, anon, public;

GRANT ALL ON public.championship_finale_sets TO service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- TABLE 3: championship_finale_sessions
-- One session per finalist per finale_code. Server-authoritative timestamps.
-- CORRECTION #1: Added finale_code and updated_at columns that were missing.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  finale_code     TEXT        NOT NULL DEFAULT 'FINALE_S1_20261124',
  finale_set_id   UUID        NOT NULL REFERENCES public.championship_finale_sets(id) ON DELETE RESTRICT,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'submitted', 'expired')),
  -- started_at uses clock_timestamp() (wall clock, not transaction start) for
  -- accurate deadline calculation even inside a long-running TX.
  started_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at      TIMESTAMPTZ NOT NULL,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CORRECTION #7: Prevents concurrent duplicate session creation for same user+finale.
  CONSTRAINT uq_finale_session_user_finale UNIQUE (user_id, finale_code)
);

CREATE INDEX IF NOT EXISTS idx_finale_sessions_user_code
  ON public.championship_finale_sessions (user_id, finale_code);

ALTER TABLE public.championship_finale_sessions ENABLE ROW LEVEL SECURITY;

-- A contestant can read their own session. Admins read all.
DROP POLICY IF EXISTS "Finalists read own session" ON public.championship_finale_sessions;
CREATE POLICY "Finalists read own session"
  ON public.championship_finale_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE
  ON public.championship_finale_sessions
  FROM authenticated, anon, public;

GRANT ALL ON public.championship_finale_sessions TO service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- TABLE 4: championship_finale_attempts
-- Immutable results record. One per finalist, ever. ON CONFLICT DO NOTHING enforced
-- both at DB level (UNIQUE index) and in RPC (explicit check before insert).
-- CORRECTION #4: Attempts are immutable; constraint prevents any overwrite.
-- CORRECTION #5: FK uses ON DELETE RESTRICT to preserve historical records.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_attempts (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID         NOT NULL REFERENCES public.championship_finale_sessions(id) ON DELETE RESTRICT,
  finale_code        TEXT         NOT NULL DEFAULT 'FINALE_S1_20261124',
  user_id            UUID         NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  seat_number        INTEGER      NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  student_name       TEXT         NOT NULL,
  college            TEXT         NOT NULL,
  batch              TEXT         NOT NULL,
  score              INTEGER      NOT NULL CHECK (score >= 0 AND score <= 1000),
  accuracy           NUMERIC(5,2) NOT NULL CHECK (accuracy >= 0.00 AND accuracy <= 100.00),
  correct_count      INTEGER      NOT NULL CHECK (correct_count BETWEEN 0 AND 10),
  -- CORRECTION #6: Actual elapsed_seconds stored for tie-breaking, not clamped.
  elapsed_seconds    NUMERIC(7,3) NOT NULL CHECK (elapsed_seconds >= 0.000 AND elapsed_seconds <= 92.000),
  -- Raw answer array: 10 integers, each in {-1,0,1,2,3}. Immutable after insert.
  answers            JSONB        NOT NULL,
  submitted_at       TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  -- CORRECTION #4: One attempt per user, ever. UNIQUE prevents any overwrite.
  CONSTRAINT uq_finale_attempt_user UNIQUE (user_id),
  CONSTRAINT uq_finale_attempt_session UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_finale_attempts_code_seat
  ON public.championship_finale_attempts (finale_code, seat_number);

ALTER TABLE public.championship_finale_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finalist reads own attempt" ON public.championship_finale_attempts;
CREATE POLICY "Finalist reads own attempt"
  ON public.championship_finale_attempts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE
  ON public.championship_finale_attempts
  FROM authenticated, anon, public;

GRANT ALL ON public.championship_finale_attempts TO service_role;

-- Immutability trigger: prevent any UPDATE or DELETE on submitted attempts.
CREATE OR REPLACE FUNCTION public.trg_fn_finale_attempt_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'FINALE_ATTEMPT_IMMUTABLE: Grand Finale attempts cannot be modified or deleted after submission.';
END;
$$;

DROP TRIGGER IF EXISTS trg_finale_attempt_immutable ON public.championship_finale_attempts;
CREATE TRIGGER trg_finale_attempt_immutable
  BEFORE UPDATE OR DELETE ON public.championship_finale_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_finale_attempt_immutable();

-- ════════════════════════════════════════════════════════════════════════════════
-- TABLE 5: championship_finale_leaderboard
-- Isolated standings table. Never touched by daily Pulse writes.
-- CORRECTION #11: Public access is ONLY via get_public_finale_leaderboard() RPC;
--                 direct table SELECT from anon/authenticated is intentionally revoked.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.championship_finale_leaderboard (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  finale_code        TEXT         NOT NULL DEFAULT 'FINALE_S1_20261124',
  user_id            UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  seat_number        INTEGER      NOT NULL UNIQUE CHECK (seat_number BETWEEN 1 AND 10),
  student_name       TEXT         NOT NULL,
  college            TEXT         NOT NULL,
  batch              TEXT         NOT NULL,
  score              INTEGER      NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  accuracy           NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  elapsed_seconds    NUMERIC(7,3) NOT NULL DEFAULT 0.000,
  rank               INTEGER      NOT NULL DEFAULT 0 CHECK (rank >= 0),
  submitted_at       TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_finale_lb_rank
  ON public.championship_finale_leaderboard (finale_code, rank ASC);

ALTER TABLE public.championship_finale_leaderboard ENABLE ROW LEVEL SECURITY;

-- Direct table writes revoked. Public reads go through RPC; admin direct read via RLS.
REVOKE INSERT, UPDATE, DELETE
  ON public.championship_finale_leaderboard
  FROM authenticated, anon, public;

GRANT ALL ON public.championship_finale_leaderboard TO service_role;

-- Admin-only direct read (for monitoring dashboards).
DROP POLICY IF EXISTS "Admin read finale leaderboard" ON public.championship_finale_leaderboard;
CREATE POLICY "Admin read finale leaderboard"
  ON public.championship_finale_leaderboard
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════════
-- RPC 1: publish_finale_set_atomic
-- Admin only. Validates exactly 10 complete questions. Strips nothing on save
-- (correct answers are stored server-side only). Idempotent UPSERT by finale_code.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.publish_finale_set_atomic(
  p_finale_code  TEXT,
  p_questions    JSONB,     -- Array of 10 question objects with correct_answer
  p_status       TEXT DEFAULT 'published',
  p_title        TEXT DEFAULT 'MedTrail Championship Season 1 Grand Finale'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid    UUID    := auth.uid();
  v_now           TIMESTAMPTZ := now();
  v_set_id        UUID;
  v_existing_set  public.championship_finale_sets%ROWTYPE;
  v_q             JSONB;
  v_slot          INTEGER := 0;
  v_answer        TEXT;
BEGIN
  -- Auth check
  IF v_caller_uid IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required.');
  END IF;

  -- Input validation
  IF p_finale_code IS NULL OR trim(p_finale_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'finale_code is required.');
  END IF;

  IF p_status NOT IN ('draft', 'published', 'closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status. Must be draft, published, or closed.');
  END IF;

  -- Freeze published questions: Prevent changing an already published set once any session has started
  SELECT * INTO v_existing_set
  FROM public.championship_finale_sets
  WHERE finale_code = trim(p_finale_code)
  FOR UPDATE;

  IF v_existing_set.id IS NOT NULL AND v_existing_set.status = 'published' THEN
    IF EXISTS (
      SELECT 1
      FROM public.championship_finale_sessions
      WHERE finale_set_id = v_existing_set.id OR finale_code = trim(p_finale_code)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot modify question set: examination sessions have already started for this Finale.'
      );
    END IF;
  END IF;

  -- CORRECTION #8: Strictly enforce exactly 10 questions when publishing.
  IF p_status = 'published' THEN
    IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Finale must have exactly 10 questions to publish. Found: ' ||
                 coalesce(jsonb_array_length(p_questions)::text, '0')
      );
    END IF;
  END IF;

  -- Validate each question: required fields + correct_answer must be A/B/C/D.
  IF p_questions IS NOT NULL AND jsonb_typeof(p_questions) = 'array' THEN
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
      v_slot := v_slot + 1;

      IF coalesce(trim(v_q->>'question'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Question ' || v_slot || ': question text is required.');
      END IF;
      IF coalesce(trim(v_q->>'option_a'), '') = '' OR
         coalesce(trim(v_q->>'option_b'), '') = '' OR
         coalesce(trim(v_q->>'option_c'), '') = '' OR
         coalesce(trim(v_q->>'option_d'), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Question ' || v_slot || ': all 4 options are required.');
      END IF;

      -- CORRECTION #9: Validate correct_answer strictly as A, B, C, or D.
      v_answer := upper(trim(coalesce(v_q->>'correct_answer', '')));
      IF v_answer NOT IN ('A', 'B', 'C', 'D') THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Question ' || v_slot || ': correct_answer must be A, B, C, or D (got: ' ||
                   coalesce(v_q->>'correct_answer', 'null') || ').'
        );
      END IF;
    END LOOP;
  END IF;

  -- Atomic UPSERT by finale_code
  INSERT INTO public.championship_finale_sets (
    finale_code, title, status, questions, question_count,
    duration_seconds, published_at, published_by, updated_at
  )
  VALUES (
    trim(p_finale_code),
    coalesce(nullif(trim(p_title), ''), 'MedTrail Championship Season 1 Grand Finale'),
    p_status,
    coalesce(p_questions, '[]'::jsonb),
    coalesce(jsonb_array_length(p_questions), 0),
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
    published_at   = CASE WHEN EXCLUDED.status = 'published' AND championship_finale_sets.published_at IS NULL
                          THEN EXCLUDED.published_at ELSE championship_finale_sets.published_at END,
    published_by   = CASE WHEN EXCLUDED.status = 'published' AND championship_finale_sets.published_by IS NULL
                          THEN EXCLUDED.published_by ELSE championship_finale_sets.published_by END,
    updated_at     = v_now
  RETURNING id INTO v_set_id;

  RETURN jsonb_build_object(
    'success', true,
    'set_id', v_set_id,
    'finale_code', trim(p_finale_code),
    'status', p_status,
    'question_count', coalesce(jsonb_array_length(p_questions), 0),
    'published_at', v_now
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_finale_set_atomic(TEXT, JSONB, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publish_finale_set_atomic(TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- RPC 2: start_finale_pulse_session_atomic
-- Validates finalist identity, opens/resumes a 90-second server-authoritative
-- session, and delivers sanitized questions (no correct_answer, no explanation).
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.start_finale_pulse_session_atomic(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_caller_email   TEXT        := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_finalist       public.championship_finale_approved_roster%ROWTYPE;
  v_set            public.championship_finale_sets%ROWTYPE;
  v_existing_att   RECORD;
  v_session        public.championship_finale_sessions%ROWTYPE;
  v_session_id     UUID;
  v_expires_at     TIMESTAMPTZ;
  v_started_at     TIMESTAMPTZ;
  v_questions_safe JSONB := '[]'::jsonb;
  v_q              JSONB;
  v_idx            INTEGER := 0;
BEGIN
  -- Auth check
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- ── 1. Finalist Identity Verification ────────────────────────────────────────
  -- CORRECTION #3a: If roster entry has a user_id, ONLY that user_id may access it.
  --                 Email matching is permitted ONLY when user_id IS NULL.
  SELECT * INTO v_finalist
  FROM public.championship_finale_approved_roster
  WHERE (
    (user_id IS NOT NULL AND user_id = v_caller_uid)
    OR
    (user_id IS NULL AND v_caller_email <> '' AND lower(trim(email)) = v_caller_email)
  )
  LIMIT 1;

  IF v_finalist.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_finalist', true,
      'error', 'Access restricted to the 10 approved Grand Finale contestants.'
    );
  END IF;

  -- CORRECTION #3b: Atomically link user_id if the seat was email-matched (user_id was NULL).
  -- CORRECTION #3c: Prevent one user linking to multiple seats (user_id UNIQUE enforces this at DB level).
  IF v_finalist.user_id IS NULL THEN
    UPDATE public.championship_finale_approved_roster
    SET user_id = v_caller_uid, updated_at = v_now
    WHERE id = v_finalist.id
      AND user_id IS NULL; -- guard against concurrent links

    IF NOT FOUND THEN
      -- Another concurrent call already linked this seat; re-read.
      SELECT * INTO v_finalist
      FROM public.championship_finale_approved_roster
      WHERE id = v_finalist.id;

      IF v_finalist.user_id <> v_caller_uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Finalist seat was already linked to a different account.');
      END IF;
    ELSE
      v_finalist.user_id := v_caller_uid;
    END IF;
  END IF;

  -- ── 2. Question Set Verification ─────────────────────────────────────────────
  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = trim(p_finale_code)
  FOR SHARE;

  IF v_set.id IS NULL OR v_set.status <> 'published' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The Grand Finale examination is not currently open.');
  END IF;

  -- CORRECTION #8: Verify exactly 10 questions are present.
  IF v_set.question_count <> 10 OR jsonb_array_length(v_set.questions) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition question set is incomplete. Contact the administrator.');
  END IF;

  -- ── 3. One-Attempt-Only Check ─────────────────────────────────────────────────
  SELECT id INTO v_existing_att
  FROM public.championship_finale_attempts
  WHERE user_id = v_caller_uid;

  IF v_existing_att.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already completed the Grand Finale. Only 1 attempt is permitted.'
    );
  END IF;

  -- ── 4. Session Handshake ──────────────────────────────────────────────────────
  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE user_id = v_caller_uid AND finale_code = trim(p_finale_code);

  IF v_session.id IS NOT NULL THEN
    -- Existing session found.
    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true);
    END IF;

    IF v_session.status = 'expired' OR v_session.expires_at <= v_now THEN
      -- Session definitively expired — mark it and reject.
      UPDATE public.championship_finale_sessions
      SET status = 'expired', updated_at = v_now
      WHERE id = v_session.id;
      RETURN jsonb_build_object(
        'success', false,
        'session_expired', true,
        'error', 'Your 90-second examination window has expired.'
      );
    END IF;

    -- CORRECTION #3 (timer): Resume with ORIGINAL started_at and expires_at.
    -- Client must calculate remaining time as (expires_at - client_now).
    v_session_id := v_session.id;
    v_started_at := v_session.started_at;
    v_expires_at := v_session.expires_at;
  ELSE
    -- Create new session.
    -- CORRECTION #7: UNIQUE(user_id, finale_code) on the table prevents concurrent
    -- duplicate inserts at DB level even if two requests race.
    v_started_at := v_now;
    v_expires_at := v_now + interval '90 seconds';

    INSERT INTO public.championship_finale_sessions (
      finale_code, finale_set_id, user_id, status, started_at, expires_at, updated_at
    ) VALUES (
      trim(p_finale_code), v_set.id, v_caller_uid, 'active', v_started_at, v_expires_at, v_now
    )
    ON CONFLICT (user_id, finale_code) DO UPDATE
      SET updated_at = v_now  -- no-op update; ensures RETURNING works
    RETURNING id, started_at, expires_at INTO v_session_id, v_started_at, v_expires_at;

    -- Handle the race: if ON CONFLICT fired, fetch real session.
    IF v_session_id IS NULL THEN
      SELECT id, started_at, expires_at INTO v_session_id, v_started_at, v_expires_at
      FROM public.championship_finale_sessions
      WHERE user_id = v_caller_uid AND finale_code = trim(p_finale_code);
    END IF;
  END IF;

  -- ── 5. Sanitize Questions — strip correct_answer and explanation ───────────────
  -- CORRECTION #10: Never expose correct_answer or explanation before submission.
  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_idx := v_idx + 1;
    v_questions_safe := v_questions_safe || jsonb_build_object(
      'slot',     v_idx,
      'question', coalesce(v_q->>'question', ''),
      'option_a', coalesce(v_q->>'option_a', ''),
      'option_b', coalesce(v_q->>'option_b', ''),
      'option_c', coalesce(v_q->>'option_c', ''),
      'option_d', coalesce(v_q->>'option_d', ''),
      'subject',  coalesce(v_q->>'subject', 'General')
      -- correct_answer and explanation deliberately excluded
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',          true,
    'session_id',       v_session_id,
    'started_at',       v_started_at,
    'expires_at',       v_expires_at,
    'duration_seconds', 90,
    'seat_number',      v_finalist.seat_number,
    'student_name',     v_finalist.student_name,
    'questions',        v_questions_safe
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.start_finale_pulse_session_atomic(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_finale_pulse_session_atomic(TEXT) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- RPC 3: submit_finale_pulse_attempt_atomic
-- Server-authoritative deadline enforcement + grading.
-- Immutable: once an attempt row exists, any further call returns already_submitted.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_finale_pulse_attempt_atomic(
  p_session_id UUID,
  p_answers    JSONB   -- Exactly 10 integers, each in {-1, 0, 1, 2, 3}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID        := auth.uid();
  v_submitted_at   TIMESTAMPTZ := clock_timestamp();
  v_session        public.championship_finale_sessions%ROWTYPE;
  v_finalist       public.championship_finale_approved_roster%ROWTYPE;
  v_set            public.championship_finale_sets%ROWTYPE;
  v_elapsed        NUMERIC;
  v_q              JSONB;
  v_idx            INTEGER := 0;
  v_user_ans       INTEGER;
  v_correct_letter TEXT;
  v_correct_idx    INTEGER;
  v_correct_count  INTEGER := 0;
  v_score          INTEGER;
  v_accuracy       NUMERIC;
  v_new_attempt_id UUID;
  v_existing_att   RECORD;
  v_explanations   JSONB := '[]'::jsonb;
BEGIN
  -- Auth check
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- ── 1. Session Lock — prevents concurrent duplicate submissions ───────────────
  -- CORRECTION #7: FOR UPDATE locks the row; second concurrent call waits then
  --                finds status = 'submitted' and returns already_submitted.
  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Examination session not found.');
  END IF;

  IF v_session.user_id <> v_caller_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ownership mismatch.');
  END IF;

  IF v_session.status <> 'active' THEN
    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'message', 'Session already submitted.');
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Submission rejected: examination session is not active (status: ' || v_session.status || ').'
    );
  END IF;

  -- ── 2. CORRECTION #4: Immutability guard — if attempt row already exists, reject ──
  SELECT id INTO v_existing_att
  FROM public.championship_finale_attempts
  WHERE user_id = v_caller_uid;

  IF v_existing_att.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_existing_att.id);
  END IF;

  -- ── 3. CORRECTION #7: Double-verify finalist identity in submit ───────────────
  SELECT * INTO v_finalist
  FROM public.championship_finale_approved_roster
  WHERE user_id = v_caller_uid;

  IF v_finalist.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: not in approved finalist roster.');
  END IF;

  -- ── 4. CORRECTION #2: Server-authoritative 90-second deadline enforcement ──────
  -- Hard reject beyond expires_at + 2.0s network tolerance. No clamping.
  IF v_submitted_at > (v_session.expires_at + interval '2.0 seconds') THEN
    UPDATE public.championship_finale_sessions
    SET status = 'expired', updated_at = v_submitted_at
    WHERE id = v_session.id;
    RETURN jsonb_build_object(
      'success', false,
      'deadline_exceeded', true,
      'error', 'Submission rejected: 90-second examination deadline has expired.'
    );
  END IF;

  -- Actual elapsed time (retaining 92.000s server-side deadline enforcement & DB constraint)
  v_elapsed := ROUND(
    LEAST(92.000, GREATEST(0.001, EXTRACT(EPOCH FROM (v_submitted_at - v_session.started_at)))),
    3
  );

  -- ── 5. CORRECTION #5: Answer array validation ──────────────────────────────────
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> 10 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Malformed submission: exactly 10 answers required. Received: ' ||
               coalesce(jsonb_array_length(p_answers)::text, 'null')
    );
  END IF;

  -- ── 6. Load Question Set for Authoritative Grading ────────────────────────────
  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE id = v_session.finale_set_id;

  -- ── 7. Grade All 10 Questions ─────────────────────────────────────────────────
  FOR v_q IN SELECT * FROM jsonb_array_elements(v_set.questions)
  LOOP
    v_user_ans := (p_answers->>v_idx)::integer;

    -- CORRECTION #5: Validate each answer value strictly.
    IF v_user_ans IS NULL OR v_user_ans NOT IN (-1, 0, 1, 2, 3) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid answer value at index ' || v_idx ||
                 '. Must be -1 (skip), 0 (A), 1 (B), 2 (C), or 3 (D).'
      );
    END IF;

    -- CORRECTION #9: correct_answer validated as A/B/C/D.
    v_correct_letter := upper(trim(coalesce(v_q->>'correct_answer', '')));
    IF v_correct_letter NOT IN ('A', 'B', 'C', 'D') THEN
      -- Should never happen if publish_finale_set_atomic ran correctly, but be defensive.
      RETURN jsonb_build_object('success', false, 'error', 'Question bank integrity error at slot ' || (v_idx + 1));
    END IF;

    v_correct_idx := CASE v_correct_letter
      WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3
    END;

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

  -- Format B Scoring: 100 pts per correct, 0 for skip/wrong, max 1000.
  v_score    := v_correct_count * 100;
  v_accuracy := ROUND((v_correct_count::numeric / 10.0) * 100.0, 2);

  -- ── 8. Record Immutable Attempt ───────────────────────────────────────────────
  -- CORRECTION #4: ON CONFLICT DO NOTHING ensures concurrent duplicate TXs
  --                do not silently overwrite the first commit.
  INSERT INTO public.championship_finale_attempts (
    session_id, finale_code, user_id, seat_number, student_name, college, batch,
    score, accuracy, correct_count, elapsed_seconds, answers, submitted_at
  )
  VALUES (
    v_session.id, v_session.finale_code, v_caller_uid,
    v_finalist.seat_number, v_finalist.student_name, v_finalist.college, v_finalist.batch,
    v_score, v_accuracy, v_correct_count, v_elapsed, p_answers, v_submitted_at
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_new_attempt_id;

  IF v_new_attempt_id IS NULL THEN
    -- Concurrent insert already committed; return already_submitted.
    SELECT id INTO v_new_attempt_id FROM public.championship_finale_attempts WHERE user_id = v_caller_uid;
    RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_new_attempt_id);
  END IF;

  -- ── 9. Update Session to Submitted ────────────────────────────────────────────
  UPDATE public.championship_finale_sessions
  SET status = 'submitted', submitted_at = v_submitted_at, updated_at = v_submitted_at
  WHERE id = v_session.id;

  -- ── 10. Upsert Isolated Finale Leaderboard ────────────────────────────────────
  -- CORRECTION #11: Written by SECURITY DEFINER RPC; never by client.
  INSERT INTO public.championship_finale_leaderboard (
    finale_code, user_id, seat_number, student_name, college, batch,
    score, accuracy, elapsed_seconds, submitted_at
  )
  VALUES (
    v_session.finale_code, v_caller_uid,
    v_finalist.seat_number, v_finalist.student_name, v_finalist.college, v_finalist.batch,
    v_score, v_accuracy, v_elapsed, v_submitted_at
  )
  ON CONFLICT (user_id) DO NOTHING;  -- CORRECTION #4: immutable; never overwrite

  -- Re-rank: score DESC, accuracy DESC, elapsed_seconds ASC, submitted_at ASC
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             ORDER BY score DESC, accuracy DESC, elapsed_seconds ASC, submitted_at ASC
           ) AS calc_rank
    FROM public.championship_finale_leaderboard
    WHERE finale_code = v_session.finale_code
  )
  UPDATE public.championship_finale_leaderboard lb
  SET rank = r.calc_rank
  FROM ranked r
  WHERE lb.id = r.id;

  RETURN jsonb_build_object(
    'success',           true,
    'attempt_id',        v_new_attempt_id,
    'score',             v_score,
    'accuracy',          v_accuracy,
    'correct_count',     v_correct_count,
    'elapsed_seconds',   v_elapsed,
    'explanations',      v_explanations
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_finale_pulse_attempt_atomic(UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_finale_pulse_attempt_atomic(UUID, JSONB) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- RPC 4: get_public_finale_roster
-- Returns ONLY public-safe fields: seat number, name, college, batch.
-- Zero PII, zero user_ids, zero emails.
-- CORRECTION #11: Replaces direct table SELECT for all non-admin callers.
-- ════════════════════════════════════════════════════════════════════════════════
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
SET search_path = public, pg_temp
AS $$
  SELECT seat_number, student_name, college, batch
  FROM public.championship_finale_approved_roster
  ORDER BY seat_number ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_roster() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_public_finale_roster() TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- RPC 5: get_public_finale_leaderboard
-- Returns public-safe standings: seat, name, college, batch, score, rank.
-- CORRECTION #11: Only access path for the leaderboard for non-admin clients.
--                 user_id, accuracy details, raw answers never exposed here.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_public_finale_leaderboard(
  p_finale_code TEXT DEFAULT 'FINALE_S1_20261124'
)
RETURNS TABLE (
  rank           INTEGER,
  seat_number    INTEGER,
  student_name   TEXT,
  college        TEXT,
  batch          TEXT,
  score          INTEGER,
  accuracy       NUMERIC,
  elapsed_seconds NUMERIC,
  submitted_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    rank,
    seat_number,
    student_name,
    college,
    batch,
    score,
    accuracy,
    elapsed_seconds,
    submitted_at
  FROM public.championship_finale_leaderboard
  WHERE finale_code = p_finale_code
  ORDER BY rank ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_finale_leaderboard(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_public_finale_leaderboard(TEXT) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- DATA API PERMISSIONS
-- Grant Supabase PostgREST SELECT on tables protected by Row Level Security.
-- Client access is governed strictly by the respective table RLS policies.
-- ════════════════════════════════════════════════════════════════════════════════

-- Allow PostgREST to read sessions (contestant reads own row via RLS; admin reads all).
GRANT SELECT ON public.championship_finale_sessions TO authenticated;
-- Allow PostgREST to read attempts (contestant reads own row via RLS; admin reads all).
GRANT SELECT ON public.championship_finale_attempts TO authenticated;
-- Sets: admin reads via RLS (is_admin); no anon access.
GRANT SELECT ON public.championship_finale_sets TO authenticated;
-- Leaderboard: admin reads via RLS (is_admin); non-admins read via get_public_finale_leaderboard() RPC.
GRANT SELECT ON public.championship_finale_leaderboard TO authenticated;
-- Approved roster: admin reads via RLS (is_admin); non-admins read via get_public_finale_roster() RPC.
GRANT SELECT ON public.championship_finale_approved_roster TO authenticated;

COMMIT;

