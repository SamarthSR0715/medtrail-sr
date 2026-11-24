-- ==============================================================================
-- Migration: 20261124_championship_finale_hardening.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Hardening & Concurrency Fixes
--
-- TARGETED CORRECTIONS:
--   1. Permanent Question Freeze:
--      Unconditionally rejects question modifications once any contestant session
--      exists. Adds database trigger trg_finale_set_freeze_on_session to prevent
--      direct table updates or deletes while sessions exist.
--   2. Correct Server-Side Deadline Enforcement:
--      Resamples clock_timestamp() AFTER acquiring the exclusive session row lock
--      (SELECT FOR UPDATE), guaranteeing deadline checking and elapsed time
--      reflect post-lock execution time rather than function entry time.
--   3. Correct Session Start Timestamp:
--      Resamples clock_timestamp() AFTER acquiring the question-set row lock
--      (SELECT FOR SHARE), ensuring contestants receive their full 90 seconds
--      without latency penalty from identity linking or lock queueing.
--   4. Serialized Leaderboard Recalculation:
--      Uses pg_advisory_xact_lock scoped to finale_code to serialize concurrent
--      leaderboard insertions and window-function re-ranking, eliminating ranking
--      races and deadlocks between concurrent finishers.
--
-- STRICT CONSTRAINTS:
--   - All RPC signatures and return contracts remain 100% identical.
--   - Daily Pulse tables (championship_pulse_*) and qualification data are untouched.
--   - Idempotent and safe to apply on top of 20261124_championship_finale_format_b.sql.
-- ==============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. DATABASE TRIGGER: Permanent Question Freeze on championship_finale_sets
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_fn_finale_set_freeze_on_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- If any session row exists for this question set, block all UPDATE or DELETE operations
  IF EXISTS (
    SELECT 1
    FROM public.championship_finale_sessions
    WHERE finale_set_id = OLD.id OR finale_code = OLD.finale_code
  ) THEN
    RAISE EXCEPTION 'FINALE_SET_FROZEN: Grand Finale question sets are permanently immutable once contestant sessions have commenced.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_finale_set_freeze_on_session()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finale_set_freeze_on_session ON public.championship_finale_sets;
CREATE TRIGGER trg_finale_set_freeze_on_session
  BEFORE UPDATE OR DELETE ON public.championship_finale_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_finale_set_freeze_on_session();

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. HARDENED RPC 1: publish_finale_set_atomic
-- Permanent freeze check once any session exists, with exclusive row locking.
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
  v_caller_uid    UUID        := auth.uid();
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

  -- ── Concurrency Lock & Permanent Freeze Guard ────────────────────────────────
  -- Acquire an exclusive row lock on existing set before checking session state
  SELECT * INTO v_existing_set
  FROM public.championship_finale_sets
  WHERE finale_code = trim(p_finale_code)
  FOR UPDATE;

  -- PERMANENT QUESTION FREEZE:
  -- If any session exists for this set, reject modification regardless of status.
  IF v_existing_set.id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.championship_finale_sessions
      WHERE finale_set_id = v_existing_set.id OR finale_code = trim(p_finale_code)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot modify question set: examination sessions have already commenced for this Finale.'
      );
    END IF;
  END IF;

  -- Strictly enforce exactly 10 questions when publishing
  IF p_status = 'published' THEN
    IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) <> 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Finale must have exactly 10 questions to publish. Found: ' ||
                 coalesce(jsonb_array_length(p_questions)::text, '0')
      );
    END IF;
  END IF;

  -- Validate each question: required fields + correct_answer must be A/B/C/D
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
-- 3. HARDENED RPC 2: start_finale_pulse_session_atomic
-- Correct session start timestamp sampled AFTER acquiring question-set lock.
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

  -- Atomically link user_id if the seat was email-matched (user_id was NULL)
  IF v_finalist.user_id IS NULL THEN
    UPDATE public.championship_finale_approved_roster
    SET user_id = v_caller_uid, updated_at = v_now
    WHERE id = v_finalist.id
      AND user_id IS NULL; -- guard against concurrent links

    IF NOT FOUND THEN
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

  -- ── 2. Question Set Verification & Concurrency Lock ───────────────────────────
  -- Shared read lock: prevents concurrent publish_finale_set_atomic from modifying
  -- questions while a contestant session is being established.
  SELECT * INTO v_set
  FROM public.championship_finale_sets
  WHERE finale_code = trim(p_finale_code)
  FOR SHARE;

  IF v_set.id IS NULL OR v_set.status <> 'published' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The Grand Finale examination is not currently open.');
  END IF;

  -- Verify exactly 10 questions are present
  IF v_set.question_count <> 10 OR jsonb_array_length(v_set.questions) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition question set is incomplete. Contact the administrator.');
  END IF;

  -- FIX 3: Re-sample authoritative start timestamp AFTER acquiring question-set lock
  -- This guarantees the full 90-second duration without latency penalties from lock queueing.
  v_now := clock_timestamp();

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

  -- ── 4. Session Handshake (Atomic Upsert + Strict Re-read & Validation) ────────
  -- Atomically ensure session row exists without overwriting existing timestamps
  INSERT INTO public.championship_finale_sessions (
    finale_code, finale_set_id, user_id, status, started_at, expires_at, updated_at
  ) VALUES (
    trim(p_finale_code), v_set.id, v_caller_uid, 'active', v_now, v_now + interval '90 seconds', v_now
  )
  ON CONFLICT (user_id, finale_code) DO UPDATE
    SET updated_at = championship_finale_sessions.updated_at -- no-op: preserves original timestamps
  RETURNING id INTO v_session_id;

  -- Re-read the actual session row with row-level lock (FOR UPDATE)
  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE user_id = v_caller_uid AND finale_code = trim(p_finale_code)
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Failed to establish or retrieve examination session.');
  END IF;

  -- Re-sample clock_timestamp() post-lock
  v_now := clock_timestamp();

  -- 1. Submitted status: reject as already submitted
  IF v_session.status = 'submitted' THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already completed the Grand Finale. Only 1 attempt is permitted.'
    );
  END IF;

  -- 2. Expired status or expires_at <= clock_timestamp(): reject as expired
  IF v_session.status = 'expired' OR v_session.expires_at <= v_now THEN
    IF v_session.status <> 'expired' THEN
      UPDATE public.championship_finale_sessions
      SET status = 'expired', updated_at = v_now
      WHERE id = v_session.id;
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'session_expired', true,
      'error', 'Your 90-second examination window has expired.'
    );
  END IF;

  -- 3. Active status: resume only with original started_at and expires_at
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Examination session is not active (status: ' || coalesce(v_session.status, 'unknown') || ').'
    );
  END IF;

  -- Resume active session with original started_at and expires_at
  v_session_id := v_session.id;
  v_started_at := v_session.started_at;
  v_expires_at := v_session.expires_at;

  -- ── 5. Sanitize Questions — strip correct_answer and explanation ───────────────
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
-- 4. HARDENED RPC 3: submit_finale_pulse_attempt_atomic
-- Post-lock deadline check + advisory-lock serialized leaderboard recalculation.
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
  v_submitted_at   TIMESTAMPTZ;
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
  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Examination session not found.');
  END IF;

  -- FIX 2: Re-sample wall-clock time AFTER acquiring exclusive session lock
  -- Ensures deadline enforcement and elapsed time reflect actual post-lock time.
  v_submitted_at := clock_timestamp();

  IF v_session.user_id <> v_caller_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ownership mismatch.');
  END IF;

  -- Explicit check: session must be active
  IF v_session.status <> 'active' THEN
    IF v_session.status = 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'already_submitted', true, 'message', 'Session already submitted.');
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Submission rejected: examination session is not active (status: ' || v_session.status || ').'
    );
  END IF;

  -- ── 2. Immutability guard — if attempt row already exists, reject ──────────────
  SELECT id INTO v_existing_att
  FROM public.championship_finale_attempts
  WHERE user_id = v_caller_uid;

  IF v_existing_att.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_existing_att.id);
  END IF;

  -- ── 3. Double-verify finalist identity in submit ──────────────────────────────
  SELECT * INTO v_finalist
  FROM public.championship_finale_approved_roster
  WHERE user_id = v_caller_uid;

  IF v_finalist.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: not in approved finalist roster.');
  END IF;

  -- ── 4. Server-authoritative 90-second deadline enforcement ────────────────────
  -- Hard reject beyond expires_at + 2.0s network tolerance. Evaluated at post-lock time.
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

  -- Actual elapsed time (retaining 92.000s constraint to prevent float overflow)
  v_elapsed := ROUND(
    LEAST(92.000, GREATEST(0.001, EXTRACT(EPOCH FROM (v_submitted_at - v_session.started_at)))),
    3
  );

  -- ── 5. Answer array validation ────────────────────────────────────────────────
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

    IF v_user_ans IS NULL OR v_user_ans NOT IN (-1, 0, 1, 2, 3) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid answer value at index ' || v_idx ||
                 '. Must be -1 (skip), 0 (A), 1 (B), 2 (C), or 3 (D).'
      );
    END IF;

    v_correct_letter := upper(trim(coalesce(v_q->>'correct_answer', '')));
    IF v_correct_letter NOT IN ('A', 'B', 'C', 'D') THEN
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
    SELECT id INTO v_new_attempt_id FROM public.championship_finale_attempts WHERE user_id = v_caller_uid;
    RETURN jsonb_build_object('success', false, 'already_submitted', true, 'attempt_id', v_new_attempt_id);
  END IF;

  -- ── 9. Update Session to Submitted ────────────────────────────────────────────
  UPDATE public.championship_finale_sessions
  SET status = 'submitted', submitted_at = v_submitted_at, updated_at = v_submitted_at
  WHERE id = v_session.id;

  -- ── 10. FIX 4: Serialized Leaderboard Recalculation ───────────────────────────
  -- Acquire an advisory transaction lock scoped to this finale_code.
  -- This serializes concurrent attempt submissions during leaderboard upsert and
  -- window-function re-ranking, preventing ranking races and deadlocks.
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

  -- Deterministic Re-ranking: score DESC, accuracy DESC, elapsed_seconds ASC, submitted_at ASC
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

COMMIT;

