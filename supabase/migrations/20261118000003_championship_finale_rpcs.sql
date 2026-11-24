-- ==============================================================================
-- Migration: 20261118000003_championship_finale_rpcs.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Core Stored Procedures & RPCs
--
-- Features & Remediations (Phase 2.4):
--   1. Transactional session lifecycle with fine-grained advisory locking.
--   2. Continuous 90.000s server-authoritative countdown (zero per-question reset).
--   3. 90-second session fairness with 90s start cutoff before window closes (ADV-08).
--   4. Strict sequential progression with robust idempotency payload verification:
--      - Exact retries return cached duplicate state.
--      - Conflicting retries return ERR_SLOT_ALREADY_COMMITTED_CONFLICT.
--   5. Cryptographic sealing using canonical PostgreSQL JSONB digests (pg_jsonb_v1) (ADV-12)
--      with explicit extensions.digest qualification and extensions in search_path (ADV-02).
--   6. Dual-approval TOCTOU hash binding: prospective roster and questions digests
--      are bound into approval payload in Step 1 and strictly verified in Step 2 (ADV-05).
--   7. Administrative approval rejection RPC (admin_reject_approval) (ADV-09).
--   8. Reserve promotion with seat vacancy protection.
--   9. Reissue workflow with atomic voiding and partial unique index compatibility.
--  10. Full-set scoring reconciliation cross-verifying student responses against
--      the master question bank (ADV-07) with admin-only authorization (ADV-06).
--  11. Publication race serialization: sweeps active sessions only when timers expire (ADV-08).
--  12. Two-person dual administrative approval consuming championship_finale_admin_approvals.
--  13. Deterministic 10-tier tie-breaking with strict 90.000s missing-day penalties
--      and multi-winner joint standing directly materialized into immutable results (ADV-11).
--  14. Audit trail caller authorization & execution privilege restriction (ADV-01).
-- ==============================================================================

BEGIN;

-- ── 1. HELPER: AUDIT LOG EMITTER (ADV-01 & ADV-02) ────────────────────────────
-- Internal audit logging helper with cryptographic hash chaining.
CREATE OR REPLACE FUNCTION public.log_finale_audit_event(
  p_event_type TEXT,
  p_actor_role TEXT,
  p_target_entity TEXT,
  p_target_id TEXT,
  p_details JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_last_hash TEXT;
  v_new_hash TEXT;
  v_new_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Strict caller authorization (ADV-01):
  -- Disallow unauthenticated external direct calls.
  IF auth.role() NOT IN ('service_role', 'supabase_admin') AND auth.uid() IS NULL AND p_actor_role <> 'system' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Direct invocation of audit logging is restricted.';
  END IF;

  IF p_actor_role NOT IN ('admin', 'super_admin', 'participant', 'system') THEN
    RAISE EXCEPTION 'INVALID_ACTOR_ROLE: %', p_actor_role;
  END IF;

  v_actor_id := auth.uid();

  -- Get hash of latest audit entry or use genesis seed hash
  SELECT current_hash INTO v_last_hash
  FROM public.championship_finale_audit_log
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF v_last_hash IS NULL THEN
    v_last_hash := '0000000000000000000000000000000000000000000000000000000000000000';
  END IF;

  -- Compute deterministic SHA-256 hash using extensions.digest (ADV-02)
  v_new_hash := encode(extensions.digest(
    (v_last_hash || v_new_id::text || v_now::text || p_event_type || p_details::text)::bytea,
    'sha256'
  ), 'hex');

  INSERT INTO public.championship_finale_audit_log (
    id, occurred_at, event_type, actor_id, actor_role,
    target_entity, target_id, details, previous_hash, current_hash
  ) VALUES (
    v_new_id, v_now, p_event_type, v_actor_id, p_actor_role,
    p_target_entity, p_target_id, p_details, v_last_hash, v_new_hash
  );

  RETURN v_new_id;
END;
$$;

-- Revoke direct execution from public roles (ADV-01)
REVOKE EXECUTE ON FUNCTION public.log_finale_audit_event(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_finale_audit_event(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ── 2. ADMIN RPC: INITIATE DUAL APPROVAL REQUEST (ADV-02 & ADV-05) ─────────────
-- Step 1 of the two-person authorization protocol.
-- For SEAL_ROSTER, prospective roster and question digests are computed and bound into payload (ADV-05).
CREATE OR REPLACE FUNCTION public.admin_request_approval(
  p_action_name TEXT,
  p_target_day INTEGER DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval_id UUID := gen_random_uuid();
  v_payload_hash TEXT;
  v_bound_payload JSONB := p_payload;
  v_roster_hash TEXT;
  v_questions_hash TEXT;
  v_finalists_count INTEGER;
  v_reserves_count INTEGER;
  v_unverified_count INTEGER;
  v_unconfirmed_attendance INTEGER;
  v_q1_count INTEGER;
  v_q2_count INTEGER;
  v_q3_count INTEGER;
  v_invalid_q_count INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expires_at TIMESTAMPTZ := v_now + interval '30 minutes';
BEGIN
  IF NOT public.is_grand_finale_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  IF p_action_name NOT IN (
    'SEAL_ROSTER',
    'PROMOTE_RESERVE',
    'VOID_AND_REISSUE_SESSION',
    'PUBLISH_DAILY_RESULTS',
    'DECLARE_FINAL_WINNER'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_APPROVAL_ACTION');
  END IF;

  -- ADV-05: If requesting SEAL_ROSTER, pre-validate readiness and bind prospective hashes into payload
  IF p_action_name = 'SEAL_ROSTER' THEN
    SELECT count(*) INTO v_finalists_count FROM public.championship_finale_roster WHERE seat_type = 'finalist';
    SELECT count(*) INTO v_reserves_count FROM public.championship_finale_roster WHERE seat_type = 'reserve';

    IF v_finalists_count <> 10 OR v_reserves_count <> 2 THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_ROSTER_COUNTS', 'finalists', v_finalists_count, 'reserves', v_reserves_count);
    END IF;

    SELECT count(*) INTO v_unverified_count FROM public.championship_finale_roster WHERE verification_status <> 'verified';
    IF v_unverified_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'UNVERIFIED_CANDIDATES_PRESENT', 'count', v_unverified_count);
    END IF;

    SELECT count(*) INTO v_unconfirmed_attendance FROM public.championship_finale_roster WHERE attendance_confirmed IS NOT TRUE;
    IF v_unconfirmed_attendance > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'UNCONFIRMED_ATTENDANCE_PRESENT', 'count', v_unconfirmed_attendance);
    END IF;

    SELECT count(*) INTO v_q1_count FROM public.championship_finale_questions WHERE day_number = 1;
    SELECT count(*) INTO v_q2_count FROM public.championship_finale_questions WHERE day_number = 2;
    SELECT count(*) INTO v_q3_count FROM public.championship_finale_questions WHERE day_number = 3;

    IF v_q1_count <> 10 OR v_q2_count <> 10 OR v_q3_count <> 10 THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'QUESTION_BANK_INCOMPLETE', 'day1', v_q1_count, 'day2', v_q2_count, 'day3', v_q3_count);
    END IF;

    SELECT count(*) INTO v_invalid_q_count FROM public.championship_finale_questions
    WHERE correct_option NOT IN ('A', 'B', 'C', 'D')
       OR length(trim(question_text)) = 0
       OR length(trim(option_a)) = 0 OR length(trim(option_b)) = 0
       OR length(trim(option_c)) = 0 OR length(trim(option_d)) = 0;

    IF v_invalid_q_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_QUESTIONS_DETECTED', 'count', v_invalid_q_count);
    END IF;

    -- Compute prospective pg_jsonb_v1 digests
    SELECT 'v1:' || encode(extensions.digest(
      jsonb_agg(
        jsonb_build_object(
          'seat_type', r.seat_type,
          'seat_number', r.seat_number,
          'user_id', r.user_id,
          'qualifier_id', r.qualifier_id,
          'student_name', r.student_name,
          'college', r.college,
          'batch', r.batch,
          'qualification_rank', r.qualification_rank,
          'verification_status', r.verification_status,
          'attendance_confirmed', r.attendance_confirmed
        ) ORDER BY r.seat_type ASC, r.seat_number ASC
      )::text::bytea,
      'sha256'
    ), 'hex') INTO v_roster_hash
    FROM public.championship_finale_roster r;

    SELECT 'v1:' || encode(extensions.digest(
      jsonb_agg(
        jsonb_build_object(
          'day', q.day_number,
          'slot', q.slot_number,
          'prompt', q.question_text,
          'opt_a', q.option_a,
          'opt_b', q.option_b,
          'opt_c', q.option_c,
          'opt_d', q.option_d,
          'correct', q.correct_option,
          'explanation', q.explanation,
          'image', COALESCE(q.image_url, '')
        ) ORDER BY q.day_number ASC, q.slot_number ASC
      )::text::bytea,
      'sha256'
    ), 'hex') INTO v_questions_hash
    FROM public.championship_finale_questions q;

    -- Bind both prospective digests into the approval payload
    v_bound_payload := jsonb_build_object(
      'action', 'SEAL_ROSTER',
      'roster_hash', v_roster_hash,
      'questions_hash', v_questions_hash,
      'finalists_count', v_finalists_count,
      'reserves_count', v_reserves_count,
      'user_payload', p_payload
    );
  END IF;

  -- Compute deterministic payload hash covering action, day, and bound payload
  v_payload_hash := encode(extensions.digest(
    (p_action_name || ':' || COALESCE(p_target_day::text, 'ALL') || ':' || v_bound_payload::text)::bytea,
    'sha256'
  ), 'hex');

  INSERT INTO public.championship_finale_admin_approvals (
    id, action_name, target_day, payload_hash, payload,
    first_approver_id, first_approved_at, confirmation_phrase,
    status, expires_at
  ) VALUES (
    v_approval_id, p_action_name, p_target_day, v_payload_hash, v_bound_payload,
    v_admin_id, v_now, 'INITIATED:' || p_action_name,
    'pending', v_expires_at
  );

  PERFORM public.log_finale_audit_event(
    'APPROVAL_REQUESTED', 'admin', 'championship_finale_admin_approvals', v_approval_id::text,
    jsonb_build_object('action', p_action_name, 'target_day', p_target_day, 'payload_hash', v_payload_hash)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'approval_id', v_approval_id,
    'action_name', p_action_name,
    'target_day', p_target_day,
    'payload_hash', v_payload_hash,
    'bound_payload', v_bound_payload,
    'expires_at', v_expires_at
  );
END;
$$;

-- ── 3. ADMIN RPC: REJECT APPROVAL (ADV-09) ────────────────────────────────────
-- Allows either administrator (including initiator) to cancel/reject a pending approval.
CREATE OR REPLACE FUNCTION public.admin_reject_approval(
  p_approval_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.is_grand_finale_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DOCUMENTED_REASON_REQUIRED', 'message', 'Rejection reason must be at least 5 characters.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_approval_' || p_approval_id::text));

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_NOT_PENDING', 'status', v_approval.status);
  END IF;

  UPDATE public.championship_finale_admin_approvals
  SET status = 'rejected',
      second_approver_id = v_admin_id,
      second_approved_at = v_now,
      executed_at = v_now,
      confirmation_phrase = 'REJECTED: ' || trim(p_reason)
  WHERE id = p_approval_id;

  PERFORM public.log_finale_audit_event(
    'APPROVAL_REJECTED', 'admin', 'championship_finale_admin_approvals', p_approval_id::text,
    jsonb_build_object(
      'action_name', v_approval.action_name,
      'rejected_by', v_admin_id,
      'reason', trim(p_reason)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'approval_id', p_approval_id,
    'status', 'rejected',
    'rejection_reason', trim(p_reason),
    'rejected_at', v_now
  );
END;
$$;

-- ── 4. PARTICIPANT RPC: START OR RESUME FINALE SESSION (ADV-08) ───────────────
CREATE OR REPLACE FUNCTION public.start_or_resume_finale_session(
  p_day_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_roster RECORD;
  v_day RECORD;
  v_existing_session RECORD;
  v_new_session_id UUID;
  v_started_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_questions JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  -- 1. Validate Day status & timing window
  SELECT * INTO v_day
  FROM public.championship_finale_days
  WHERE day_number = p_day_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_DAY');
  END IF;

  IF v_day.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DAY_NOT_OPEN', 'status', v_day.status);
  END IF;

  IF v_now < v_day.window_opens_at OR v_now >= v_day.window_closes_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'OUTSIDE_EVENT_WINDOW');
  END IF;

  -- 2. Verify contestant is on the sealed roster as an active finalist
  SELECT * INTO v_roster
  FROM public.championship_finale_roster
  WHERE user_id = v_user_id AND seat_type = 'finalist' AND participation_status IN ('active', 'promoted');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'NOT_ELIGIBLE_FINALIST');
  END IF;

  -- 3. Acquire transaction lock scoped to (user, day) to prevent concurrent double-starts
  PERFORM pg_advisory_xact_lock(hashtext('finale_start_' || v_user_id::text || '_' || p_day_number::text));

  -- 4. Check for existing session in active, completed, or expired states
  SELECT * INTO v_existing_session
  FROM public.championship_finale_sessions
  WHERE day_number = p_day_number AND user_id = v_user_id AND status IN ('active', 'completed', 'expired')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_session.status = 'active' THEN
      -- If time has elapsed while disconnected, auto-expire session
      IF v_now > v_existing_session.expires_at THEN
        UPDATE public.championship_finale_sessions
        SET status = 'expired',
            completed_at = v_existing_session.expires_at,
            total_time_seconds = 90.000,
            updated_at = v_now
        WHERE id = v_existing_session.id;

        -- Auto-close remaining slots
        UPDATE public.championship_finale_question_states
        SET state = 'unanswered', points_awarded = 0
        WHERE session_id = v_existing_session.id AND state = 'pending';

        RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_EXPIRED', 'session_id', v_existing_session.id);
      END IF;

      -- Resume active session: fetch questions stripped of answers
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'slot_number', q.slot_number,
          'question_text', q.question_text,
          'option_a', q.option_a,
          'option_b', q.option_b,
          'option_c', q.option_c,
          'option_d', q.option_d,
          'image_url', q.image_url
        ) ORDER BY q.slot_number ASC
      ) INTO v_questions
      FROM public.championship_finale_questions q
      WHERE q.day_number = p_day_number;

      RETURN jsonb_build_object(
        'ok', true,
        'is_resume', true,
        'session_id', v_existing_session.id,
        'current_slot', v_existing_session.current_slot,
        'started_at', v_existing_session.started_at,
        'expires_at', v_existing_session.expires_at,
        'remaining_seconds', GREATEST(0.000, ROUND(EXTRACT(EPOCH FROM (v_existing_session.expires_at - v_now))::numeric, 3)),
        'questions', v_questions
      );
    ELSE
      -- Completed or Expired
      RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_ALREADY_COMPLETED', 'status', v_existing_session.status);
    END IF;
  END IF;

  -- 5. ADV-08: Enforce 90-second start cutoff before daily window closure for fresh sessions
  IF v_now > (v_day.window_closes_at - interval '90 seconds') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'INSUFFICIENT_TIME_REMAINING_TO_START',
      'message', 'A fresh session cannot be started with less than 90 seconds remaining in the event window.'
    );
  END IF;

  -- 6. Create new session (starts immediately in 'active' status)
  v_started_at := v_now;
  v_expires_at := v_started_at + interval '90 seconds';
  v_new_session_id := gen_random_uuid();

  INSERT INTO public.championship_finale_sessions (
    id, day_number, roster_id, user_id, status, current_slot,
    started_at, expires_at, total_time_seconds
  ) VALUES (
    v_new_session_id, p_day_number, v_roster.id, v_user_id, 'active', 1,
    v_started_at, v_expires_at, 0.000
  );

  -- 7. Initialize the 10 question slots in 'pending' state
  INSERT INTO public.championship_finale_question_states (
    session_id, day_number, user_id, question_id, slot_number,
    state, points_awarded, idempotency_key
  )
  SELECT 
    v_new_session_id, p_day_number, v_user_id, q.id, q.slot_number,
    'pending', 0, 'init_' || v_new_session_id::text || '_' || q.slot_number::text
  FROM public.championship_finale_questions q
  WHERE q.day_number = p_day_number
  ORDER BY q.slot_number ASC;

  -- 8. Audit log session start
  PERFORM public.log_finale_audit_event(
    'SESSION_STARTED', 'participant', 'championship_finale_sessions', v_new_session_id::text,
    jsonb_build_object('day_number', p_day_number, 'seat_number', v_roster.seat_number)
  );

  -- 9. Fetch questions stripped of correct answers and explanations
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'slot_number', q.slot_number,
      'question_text', q.question_text,
      'option_a', q.option_a,
      'option_b', q.option_b,
      'option_c', q.option_c,
      'option_d', q.option_d,
      'image_url', q.image_url
    ) ORDER BY q.slot_number ASC
  ) INTO v_questions
  FROM public.championship_finale_questions q
  WHERE q.day_number = p_day_number;

  RETURN jsonb_build_object(
    'ok', true,
    'is_resume', false,
    'session_id', v_new_session_id,
    'current_slot', 1,
    'started_at', v_started_at,
    'expires_at', v_expires_at,
    'total_seconds', 90.000,
    'questions', v_questions
  );
END;
$$;

-- ── 5. PARTICIPANT RPC: SUBMIT SLOT ACTION (ANSWER OR SKIP) ───────────────────
CREATE OR REPLACE FUNCTION public.submit_finale_slot_action(
  p_session_id UUID,
  p_slot_number INTEGER,
  p_action_type TEXT,
  p_selected_option TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_client_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_session RECORD;
  v_question RECORD;
  v_qstate RECORD;
  v_day_status TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_correct BOOLEAN := false;
  v_points INTEGER := 0;
  v_new_slot INTEGER;
  v_final_elapsed NUMERIC(6,3);
  v_total_score INTEGER;
  v_correct_count INTEGER;
  v_attempted_count INTEGER;
  v_skipped_count INTEGER;
  v_unanswered_count INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  -- 1. Acquire fine-grained transaction-scoped advisory lock on this session
  PERFORM pg_advisory_xact_lock(hashtext('finale_session_' || p_session_id::text));

  -- 2. Verify session exists and belongs to caller
  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  END IF;

  -- 3. Check for already completed or expired session
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_ACTIVE', 'status', v_session.status);
  END IF;

  -- 4. Publication Synchronization: Verify day status has not closed or published
  SELECT status INTO v_day_status
  FROM public.championship_finale_days
  WHERE day_number = v_session.day_number;

  IF v_day_status IN ('closed', 'results_published') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'COMPETITION_DAY_CLOSED', 'day_status', v_day_status);
  END IF;

  -- 5. Strict 90.000s Deadline Evaluation
  IF v_now > v_session.expires_at THEN
    -- Deadline exceeded: mark current slot as timeout, auto-expire session
    UPDATE public.championship_finale_question_states
    SET state = 'timeout', points_awarded = 0, server_received_at = v_now
    WHERE session_id = p_session_id AND slot_number = p_slot_number AND state = 'pending';

    UPDATE public.championship_finale_question_states
    SET state = 'unanswered', points_awarded = 0, server_received_at = v_now
    WHERE session_id = p_session_id AND state = 'pending';

    -- Cache final session aggregates
    SELECT 
      COALESCE(SUM(points_awarded), 0),
      COUNT(*) FILTER (WHERE state = 'answered' AND is_correct = true),
      COUNT(*) FILTER (WHERE state = 'answered'),
      COUNT(*) FILTER (WHERE state = 'skipped'),
      COUNT(*) FILTER (WHERE state IN ('timeout', 'unanswered'))
    INTO v_total_score, v_correct_count, v_attempted_count, v_skipped_count, v_unanswered_count
    FROM public.championship_finale_question_states
    WHERE session_id = p_session_id;

    UPDATE public.championship_finale_sessions
    SET status = 'expired',
        completed_at = v_session.expires_at,
        total_time_seconds = 90.000,
        total_score = v_total_score,
        correct_count = v_correct_count,
        attempted_count = v_attempted_count,
        skipped_count = v_skipped_count,
        unanswered_count = v_unanswered_count,
        updated_at = v_now
    WHERE id = p_session_id;

    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_EXPIRED', 'status', 'expired');
  END IF;

  -- 6. Sequential Progression & Robust Idempotency Conflict Check
  IF p_slot_number < v_session.current_slot THEN
    SELECT * INTO v_qstate
    FROM public.championship_finale_question_states
    WHERE session_id = p_session_id AND slot_number = p_slot_number;

    -- Verify whether the retried request matches the recorded commitment
    IF v_qstate.state = 'skipped' THEN
      IF p_action_type = 'skip' THEN
        RETURN jsonb_build_object(
          'ok', true,
          'is_duplicate', true,
          'slot_number', p_slot_number,
          'state', 'skipped',
          'next_slot', v_session.current_slot,
          'session_status', v_session.status
        );
      ELSE
        RETURN jsonb_build_object(
          'ok', false,
          'error_code', 'ERR_SLOT_ALREADY_COMMITTED_CONFLICT',
          'slot_number', p_slot_number,
          'committed_state', 'skipped',
          'attempted_action', p_action_type
        );
      END IF;
    ELSIF v_qstate.state = 'answered' THEN
      IF p_action_type = 'answer' AND upper(trim(coalesce(p_selected_option, ''))) = v_qstate.selected_option THEN
        RETURN jsonb_build_object(
          'ok', true,
          'is_duplicate', true,
          'slot_number', p_slot_number,
          'state', 'answered',
          'selected_option', v_qstate.selected_option,
          'next_slot', v_session.current_slot,
          'session_status', v_session.status
        );
      ELSE
        RETURN jsonb_build_object(
          'ok', false,
          'error_code', 'ERR_SLOT_ALREADY_COMMITTED_CONFLICT',
          'slot_number', p_slot_number,
          'committed_state', 'answered',
          'committed_option', v_qstate.selected_option,
          'attempted_action', p_action_type,
          'attempted_option', p_selected_option
        );
      END IF;
    ELSE
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'ERR_SLOT_CLOSED',
        'slot_number', p_slot_number,
        'committed_state', v_qstate.state
      );
    END IF;
  END IF;

  IF p_slot_number > v_session.current_slot THEN
    -- Out of order request: reject without mutating state
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'ERR_SLOT_OUT_OF_ORDER',
      'expected_slot', v_session.current_slot,
      'received_slot', p_slot_number
    );
  END IF;

  -- 7. Evaluate correctness against master question bank
  SELECT * INTO v_question
  FROM public.championship_finale_questions
  WHERE day_number = v_session.day_number AND slot_number = p_slot_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'QUESTION_NOT_FOUND');
  END IF;

  IF p_action_type = 'answer' THEN
    IF p_selected_option IS NULL OR upper(trim(p_selected_option)) NOT IN ('A', 'B', 'C', 'D') THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_OPTION');
    END IF;
    v_is_correct := (upper(trim(p_selected_option)) = v_question.correct_option);
    v_points := CASE WHEN v_is_correct THEN 100 ELSE 0 END;
  ELSIF p_action_type = 'skip' THEN
    v_is_correct := false;
    v_points := 0;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_ACTION_TYPE');
  END IF;

  -- 8. Update question state row
  UPDATE public.championship_finale_question_states
  SET state = CASE WHEN p_action_type = 'answer' THEN 'answered' ELSE 'skipped' END,
      selected_option = CASE WHEN p_action_type = 'answer' THEN upper(trim(p_selected_option)) ELSE NULL END,
      is_correct = v_is_correct,
      points_awarded = v_points,
      elapsed_slot_seconds = ROUND(EXTRACT(EPOCH FROM (v_now - v_session.started_at))::numeric, 3),
      idempotency_key = coalesce(p_idempotency_key, 'auto_' || p_session_id::text || '_' || p_slot_number::text),
      client_timestamp = p_client_timestamp,
      server_received_at = v_now
  WHERE session_id = p_session_id AND slot_number = p_slot_number;

  -- 9. Record raw ingress attempt
  INSERT INTO public.championship_finale_attempts (
    session_id, day_number, user_id, slot_number, action_type,
    payload, client_timestamp, server_received_at, idempotency_key, was_accepted
  ) VALUES (
    p_session_id, v_session.day_number, v_user_id, p_slot_number, p_action_type,
    jsonb_build_object('option', p_selected_option), coalesce(p_client_timestamp, v_now),
    v_now, coalesce(p_idempotency_key, 'key_' || p_slot_number::text), true
  );

  -- 10. Advance pointer or finalize if slot 10 completed
  IF p_slot_number < 10 THEN
    v_new_slot := p_slot_number + 1;
    UPDATE public.championship_finale_sessions
    SET current_slot = v_new_slot,
        total_time_seconds = LEAST(90.000, ROUND(EXTRACT(EPOCH FROM (v_now - v_session.started_at))::numeric, 3)),
        updated_at = v_now
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok', true,
      'slot_number', p_slot_number,
      'next_slot', v_new_slot,
      'session_status', 'active'
    );
  ELSE
    -- Slot 10 completed: finalize session as 'completed'
    v_final_elapsed := LEAST(90.000, ROUND(EXTRACT(EPOCH FROM (v_now - v_session.started_at))::numeric, 3));

    SELECT 
      COALESCE(SUM(points_awarded), 0),
      COUNT(*) FILTER (WHERE state = 'answered' AND is_correct = true),
      COUNT(*) FILTER (WHERE state = 'answered'),
      COUNT(*) FILTER (WHERE state = 'skipped'),
      COUNT(*) FILTER (WHERE state IN ('timeout', 'unanswered'))
    INTO v_total_score, v_correct_count, v_attempted_count, v_skipped_count, v_unanswered_count
    FROM public.championship_finale_question_states
    WHERE session_id = p_session_id;

    UPDATE public.championship_finale_sessions
    SET status = 'completed',
        completed_at = v_now,
        total_time_seconds = v_final_elapsed,
        total_score = v_total_score,
        correct_count = v_correct_count,
        attempted_count = v_attempted_count,
        skipped_count = v_skipped_count,
        unanswered_count = v_unanswered_count,
        updated_at = v_now
    WHERE id = p_session_id;

    PERFORM public.log_finale_audit_event(
      'SESSION_COMPLETED', 'participant', 'championship_finale_sessions', p_session_id::text,
      jsonb_build_object('total_score', v_total_score, 'total_time', v_final_elapsed)
    );

    RETURN jsonb_build_object(
      'ok', true,
      'slot_number', 10,
      'session_status', 'completed',
      'total_score', v_total_score,
      'total_time_seconds', v_final_elapsed
    );
  END IF;
END;
$$;

-- ── 6. PARTICIPANT RPC: COMPLETE / TIMEOUT SESSION ────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_finale_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_session RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_final_elapsed NUMERIC(6,3);
  v_total_score INTEGER;
  v_correct_count INTEGER;
  v_attempted_count INTEGER;
  v_skipped_count INTEGER;
  v_unanswered_count INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_session_' || p_session_id::text));

  SELECT * INTO v_session
  FROM public.championship_finale_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_session.status, 'total_score', v_session.total_score);
  END IF;

  -- Auto-close any remaining pending slots as 'unanswered'
  UPDATE public.championship_finale_question_states
  SET state = 'unanswered', points_awarded = 0, server_received_at = v_now
  WHERE session_id = p_session_id AND state = 'pending';

  v_final_elapsed := LEAST(90.000, ROUND(EXTRACT(EPOCH FROM (v_now - v_session.started_at))::numeric, 3));

  SELECT 
    COALESCE(SUM(points_awarded), 0),
    COUNT(*) FILTER (WHERE state = 'answered' AND is_correct = true),
    COUNT(*) FILTER (WHERE state = 'answered'),
    COUNT(*) FILTER (WHERE state = 'skipped'),
    COUNT(*) FILTER (WHERE state IN ('timeout', 'unanswered'))
  INTO v_total_score, v_correct_count, v_attempted_count, v_skipped_count, v_unanswered_count
  FROM public.championship_finale_question_states
  WHERE session_id = p_session_id;

  UPDATE public.championship_finale_sessions
  SET status = CASE WHEN v_now > v_session.expires_at THEN 'expired' ELSE 'completed' END,
      completed_at = v_now,
      total_time_seconds = v_final_elapsed,
      total_score = v_total_score,
      correct_count = v_correct_count,
      attempted_count = v_attempted_count,
      skipped_count = v_skipped_count,
      unanswered_count = v_unanswered_count,
      updated_at = v_now
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN v_now > v_session.expires_at THEN 'expired' ELSE 'completed' END,
    'total_score', v_total_score,
    'total_time_seconds', v_final_elapsed
  );
END;
$$;

-- ── 7. ADMIN RPC: SEAL ROSTER & QUESTION BANK (DUAL APPROVAL STEP 2) (ADV-02 & ADV-05)
CREATE OR REPLACE FUNCTION public.admin_seal_grand_finale_roster(
  p_approval_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_finalists_count INTEGER;
  v_reserves_count INTEGER;
  v_unverified_count INTEGER;
  v_unconfirmed_attendance INTEGER;
  v_q1_count INTEGER;
  v_q2_count INTEGER;
  v_q3_count INTEGER;
  v_invalid_q_count INTEGER;
  v_roster_hash TEXT;
  v_questions_hash TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Super Admin Authorization
  IF NOT (public.is_grand_finale_admin() AND public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_SUPER_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  -- 2. Lock and Validate Dual Approval Record
  PERFORM pg_advisory_xact_lock(hashtext('finale_roster_seal'));

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ALREADY_PROCESSED', 'status', v_approval.status);
  END IF;

  IF v_now > v_approval.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_EXPIRED');
  END IF;

  IF v_approval.action_name <> 'SEAL_ROSTER' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ACTION_MISMATCH', 'expected', 'SEAL_ROSTER');
  END IF;

  -- Strict Enforcement: Initiating Admin cannot be the Second Approving Admin
  IF v_approval.first_approver_id = v_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL');
  END IF;

  -- 3. Assert Roster Cardinality & Readiness
  SELECT count(*) INTO v_finalists_count FROM public.championship_finale_roster WHERE seat_type = 'finalist';
  SELECT count(*) INTO v_reserves_count FROM public.championship_finale_roster WHERE seat_type = 'reserve';

  IF v_finalists_count <> 10 OR v_reserves_count <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_ROSTER_COUNTS', 'finalists', v_finalists_count, 'reserves', v_reserves_count);
  END IF;

  SELECT count(*) INTO v_unverified_count FROM public.championship_finale_roster WHERE verification_status <> 'verified';
  IF v_unverified_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNVERIFIED_CANDIDATES_PRESENT', 'count', v_unverified_count);
  END IF;

  SELECT count(*) INTO v_unconfirmed_attendance FROM public.championship_finale_roster WHERE attendance_confirmed IS NOT TRUE;
  IF v_unconfirmed_attendance > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNCONFIRMED_ATTENDANCE_PRESENT', 'count', v_unconfirmed_attendance);
  END IF;

  -- 4. Assert Question Bank Completeness (10 per day, 30 total, valid options)
  SELECT count(*) INTO v_q1_count FROM public.championship_finale_questions WHERE day_number = 1;
  SELECT count(*) INTO v_q2_count FROM public.championship_finale_questions WHERE day_number = 2;
  SELECT count(*) INTO v_q3_count FROM public.championship_finale_questions WHERE day_number = 3;

  IF v_q1_count <> 10 OR v_q2_count <> 10 OR v_q3_count <> 10 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'QUESTION_BANK_INCOMPLETE', 'day1', v_q1_count, 'day2', v_q2_count, 'day3', v_q3_count);
  END IF;

  SELECT count(*) INTO v_invalid_q_count FROM public.championship_finale_questions
  WHERE correct_option NOT IN ('A', 'B', 'C', 'D')
     OR length(trim(question_text)) = 0
     OR length(trim(option_a)) = 0 OR length(trim(option_b)) = 0
     OR length(trim(option_c)) = 0 OR length(trim(option_d)) = 0;

  IF v_invalid_q_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_QUESTIONS_DETECTED', 'count', v_invalid_q_count);
  END IF;

  -- 5. Canonical Versioned Cryptographic Digests (pg_jsonb_v1 deterministic JSON digest)
  SELECT 'v1:' || encode(extensions.digest(
    jsonb_agg(
      jsonb_build_object(
        'seat_type', r.seat_type,
        'seat_number', r.seat_number,
        'user_id', r.user_id,
        'qualifier_id', r.qualifier_id,
        'student_name', r.student_name,
        'college', r.college,
        'batch', r.batch,
        'qualification_rank', r.qualification_rank,
        'verification_status', r.verification_status,
        'attendance_confirmed', r.attendance_confirmed
      ) ORDER BY r.seat_type ASC, r.seat_number ASC
    )::text::bytea,
    'sha256'
  ), 'hex') INTO v_roster_hash
  FROM public.championship_finale_roster r;

  SELECT 'v1:' || encode(extensions.digest(
    jsonb_agg(
      jsonb_build_object(
        'day', q.day_number,
        'slot', q.slot_number,
        'prompt', q.question_text,
        'opt_a', q.option_a,
        'opt_b', q.option_b,
        'opt_c', q.option_c,
        'opt_d', q.option_d,
        'correct', q.correct_option,
        'explanation', q.explanation,
        'image', COALESCE(q.image_url, '')
      ) ORDER BY q.day_number ASC, q.slot_number ASC
    )::text::bytea,
    'sha256'
  ), 'hex') INTO v_questions_hash
  FROM public.championship_finale_questions q;

  -- ADV-05: Strict Anti-TOCTOU Verification:
  -- Verify recomputed hashes against prospective digests bound during Step 1
  IF v_approval.payload ? 'roster_hash' AND v_approval.payload ? 'questions_hash' THEN
    IF v_roster_hash <> (v_approval.payload->>'roster_hash') OR
       v_questions_hash <> (v_approval.payload->>'questions_hash') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'PAYLOAD_DIGEST_MISMATCH_POST_REQUEST_TAMPERING',
        'message', 'Roster or questions were modified after approval was initiated.',
        'expected_roster_hash', (v_approval.payload->>'roster_hash'),
        'actual_roster_hash', v_roster_hash,
        'expected_questions_hash', (v_approval.payload->>'questions_hash'),
        'actual_questions_hash', v_questions_hash
      );
    END IF;
  END IF;

  -- 6. Consume Approval Record
  UPDATE public.championship_finale_admin_approvals
  SET status = 'executed',
      second_approver_id = v_admin_id,
      second_approved_at = v_now,
      executed_at = v_now
  WHERE id = p_approval_id;

  -- 7. Update Roster Meta & Event States
  UPDATE public.championship_finale_roster_meta
  SET is_sealed = true,
      sealed_at = v_now,
      sealed_by = v_admin_id,
      roster_hash = v_roster_hash,
      questions_hash = v_questions_hash,
      total_finalists_count = 10,
      total_reserves_count = 2,
      updated_at = v_now
  WHERE id = 1;

  UPDATE public.championship_finale_event
  SET status = 'scheduled', updated_at = v_now
  WHERE id = 'SEASON_1';

  UPDATE public.championship_finale_days
  SET status = 'scheduled', updated_at = v_now
  WHERE status = 'draft';

  -- 8. Audit Log
  PERFORM public.log_finale_audit_event(
    'ROSTER_SEALED', 'super_admin', 'championship_finale_roster_meta', '1',
    jsonb_build_object(
      'approval_id', p_approval_id,
      'first_approver', v_approval.first_approver_id,
      'second_approver', v_admin_id,
      'roster_hash', v_roster_hash,
      'questions_hash', v_questions_hash
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'is_sealed', true,
    'roster_hash', v_roster_hash,
    'questions_hash', v_questions_hash,
    'sealed_at', v_now
  );
END;
$$;

-- ── 8. ADMIN RPC: PROMOTE RESERVE (DUAL APPROVAL STEP 2) ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_promote_reserve(
  p_approval_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_reserve_seat INTEGER;
  v_withdrawing_finalist_seat INTEGER;
  v_reason TEXT;
  v_finalist RECORD;
  v_reserve RECORD;
  v_day1 RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_active_sessions_count INTEGER;
BEGIN
  IF NOT (public.is_grand_finale_admin() AND public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_SUPER_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_roster_mutation'));

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ALREADY_PROCESSED');
  END IF;

  IF v_now > v_approval.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_EXPIRED');
  END IF;

  IF v_approval.action_name <> 'PROMOTE_RESERVE' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ACTION_MISMATCH');
  END IF;

  IF v_approval.first_approver_id = v_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL');
  END IF;

  -- Extract bound payload
  v_reserve_seat := (v_approval.payload->>'reserve_seat')::integer;
  v_withdrawing_finalist_seat := (v_approval.payload->>'withdrawing_finalist_seat')::integer;
  v_reason := v_approval.payload->>'reason';

  IF v_reason IS NULL OR length(trim(v_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DOCUMENTED_REASON_REQUIRED');
  END IF;

  -- Enforce pre-tournament promotion cutoff: must be before Day 1 window opens
  SELECT * INTO v_day1 FROM public.championship_finale_days WHERE day_number = 1;
  IF v_now >= v_day1.window_opens_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'PROMOTION_CUTOFF_EXCEEDED');
  END IF;

  SELECT * INTO v_finalist
  FROM public.championship_finale_roster
  WHERE seat_type = 'finalist' AND seat_number = v_withdrawing_finalist_seat
  FOR UPDATE;

  IF NOT FOUND OR v_finalist.participation_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'FINALIST_NOT_ACTIVE');
  END IF;

  SELECT * INTO v_reserve
  FROM public.championship_finale_roster
  WHERE seat_type = 'reserve' AND seat_number = v_reserve_seat
  FOR UPDATE;

  IF NOT FOUND OR v_reserve.participation_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'RESERVE_NOT_ELIGIBLE');
  END IF;

  -- Ensure finalist has no active session
  SELECT count(*) INTO v_active_sessions_count
  FROM public.championship_finale_sessions
  WHERE roster_id = v_finalist.id AND status IN ('active', 'completed');

  IF v_active_sessions_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'FINALIST_ALREADY_COMMENCED_SESSION');
  END IF;

  -- Consume approval
  UPDATE public.championship_finale_admin_approvals
  SET status = 'executed', second_approver_id = v_admin_id, second_approved_at = v_now, executed_at = v_now
  WHERE id = p_approval_id;

  -- Execute promotion
  UPDATE public.championship_finale_roster
  SET participation_status = 'withdrawn', updated_at = v_now
  WHERE id = v_finalist.id;

  UPDATE public.championship_finale_roster
  SET participation_status = 'promoted',
      promoted_to_seat = v_withdrawing_finalist_seat,
      promoted_at = v_now,
      updated_at = v_now
  WHERE id = v_reserve.id;

  PERFORM public.log_finale_audit_event(
    'RESERVE_PROMOTED', 'super_admin', 'championship_finale_roster', v_reserve.id::text,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'first_approver', v_approval.first_approver_id,
      'second_approver', v_admin_id,
      'reserve_seat', v_reserve_seat,
      'vacated_finalist_seat', v_withdrawing_finalist_seat,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'promoted_user_id', v_reserve.user_id,
    'promoted_to_seat', v_withdrawing_finalist_seat
  );
END;
$$;

-- ── 9. ADMIN RPC: EMERGENCY PAUSE / RESUME ────────────────────────────────────
-- Fast single-admin operational toggle (rapid incident response).
CREATE OR REPLACE FUNCTION public.admin_toggle_emergency_pause(
  p_day_number INTEGER,
  p_pause BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_day RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.is_grand_finale_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_ADMIN_REQUIRED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_day_' || p_day_number::text));

  SELECT * INTO v_day
  FROM public.championship_finale_days
  WHERE day_number = p_day_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DAY_NOT_FOUND');
  END IF;

  IF p_pause THEN
    IF v_day.status <> 'open' THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'CANNOT_PAUSE_NON_OPEN_DAY');
    END IF;

    UPDATE public.championship_finale_days
    SET status = 'paused', paused_at = v_now, updated_at = v_now
    WHERE day_number = p_day_number;

    PERFORM public.log_finale_audit_event(
      'EMERGENCY_PAUSED', 'admin', 'championship_finale_days', p_day_number::text,
      jsonb_build_object('action', 'pause', 'paused_at', v_now)
    );
  ELSE
    IF v_day.status <> 'paused' THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'CANNOT_RESUME_NON_PAUSED_DAY');
    END IF;

    UPDATE public.championship_finale_days
    SET status = 'open', paused_at = NULL, updated_at = v_now
    WHERE day_number = p_day_number;

    PERFORM public.log_finale_audit_event(
      'EMERGENCY_RESUMED', 'admin', 'championship_finale_days', p_day_number::text,
      jsonb_build_object('action', 'resume', 'resumed_at', v_now)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_pause THEN 'paused' ELSE 'open' END);
END;
$$;

-- ── 10. ADMIN RPC: VOID & REISSUE SESSION (DUAL APPROVAL STEP 2) ──────────────
CREATE OR REPLACE FUNCTION public.admin_void_and_reissue_session(
  p_approval_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_session_id UUID;
  v_reason TEXT;
  v_old_session RECORD;
  v_new_session_id UUID;
  v_started_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT (public.is_grand_finale_admin() AND public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_SUPER_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ALREADY_PROCESSED');
  END IF;

  IF v_now > v_approval.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_EXPIRED');
  END IF;

  IF v_approval.action_name <> 'VOID_AND_REISSUE_SESSION' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ACTION_MISMATCH');
  END IF;

  IF v_approval.first_approver_id = v_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL');
  END IF;

  v_session_id := (v_approval.payload->>'session_id')::uuid;
  v_reason := v_approval.payload->>'reason';

  IF v_reason IS NULL OR length(trim(v_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DOCUMENTED_REASON_REQUIRED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_session_' || v_session_id::text));

  -- Lock old session row
  SELECT * INTO v_old_session
  FROM public.championship_finale_sessions
  WHERE id = v_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_old_session.status = 'voided' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'ALREADY_VOIDED');
  END IF;

  IF v_old_session.reissue_count >= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'MAX_REISSUE_LIMIT_REACHED');
  END IF;

  -- 1. Consume approval
  UPDATE public.championship_finale_admin_approvals
  SET status = 'executed', second_approver_id = v_admin_id, second_approved_at = v_now, executed_at = v_now
  WHERE id = p_approval_id;

  -- 2. Void old session
  UPDATE public.championship_finale_sessions
  SET status = 'voided',
      voided_at = v_now,
      voided_by = v_admin_id,
      void_reason = v_reason,
      updated_at = v_now
  WHERE id = v_session_id;

  -- 3. Issue replacement session (starts fresh 90s countdown)
  v_started_at := v_now;
  v_expires_at := v_started_at + interval '90 seconds';
  v_new_session_id := gen_random_uuid();

  INSERT INTO public.championship_finale_sessions (
    id, day_number, roster_id, user_id, status, current_slot,
    started_at, expires_at, total_time_seconds, is_reissued,
    reissue_count, reissue_reason, reissued_from_session_id
  ) VALUES (
    v_new_session_id, v_old_session.day_number, v_old_session.roster_id,
    v_old_session.user_id, 'active', 1, v_started_at, v_expires_at,
    0.000, true, v_old_session.reissue_count + 1, v_reason, v_session_id
  );

  -- 4. Seed fresh 10 question states for replacement session
  INSERT INTO public.championship_finale_question_states (
    session_id, day_number, user_id, question_id, slot_number,
    state, points_awarded, idempotency_key
  )
  SELECT 
    v_new_session_id, v_old_session.day_number, v_old_session.user_id,
    q.id, q.slot_number, 'pending', 0,
    'reissue_' || v_new_session_id::text || '_' || q.slot_number::text
  FROM public.championship_finale_questions q
  WHERE q.day_number = v_old_session.day_number
  ORDER BY q.slot_number ASC;

  PERFORM public.log_finale_audit_event(
    'SESSION_VOIDED_AND_REISSUED', 'super_admin', 'championship_finale_sessions', v_new_session_id::text,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'first_approver', v_approval.first_approver_id,
      'second_approver', v_admin_id,
      'voided_session_id', v_session_id,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'voided_session_id', v_session_id,
    'new_session_id', v_new_session_id,
    'started_at', v_started_at,
    'expires_at', v_expires_at
  );
END;
$$;

-- ── 11. SYSTEM RPC: FULL-SET SCORING RECONCILIATION (ADV-06 & ADV-07) ─────────
-- Cross-verifies student responses against the master question bank (ADV-07)
-- and restricts execution to authorized administrators (ADV-06).
CREATE OR REPLACE FUNCTION public.reconcile_finale_day_scores(
  p_day_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_discrepancies JSONB := '[]'::jsonb;
  v_rec RECORD;
BEGIN
  -- Strict authorization guard (ADV-06)
  IF NOT public.is_grand_finale_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_ADMIN_REQUIRED');
  END IF;

  FOR v_rec IN (
    SELECT 
      s.id AS session_id,
      s.user_id,
      s.total_score AS cached_score,
      s.correct_count AS cached_correct,
      s.attempted_count AS cached_attempted,
      s.skipped_count AS cached_skipped,
      s.unanswered_count AS cached_unanswered,
      s.total_time_seconds,
      count(q.id) AS raw_slots_count,
      -- Sum points as recorded in question_states
      COALESCE(SUM(q.points_awarded), 0) AS calculated_score,
      COUNT(q.id) FILTER (WHERE q.state = 'answered' AND q.is_correct = true) AS calculated_correct,
      COUNT(q.id) FILTER (WHERE q.state = 'answered') AS calculated_attempted,
      COUNT(q.id) FILTER (WHERE q.state = 'skipped') AS calculated_skipped,
      COUNT(q.id) FILTER (WHERE q.state IN ('timeout', 'unanswered')) AS calculated_unanswered,
      -- ADV-07: Independent cross-verification against master question bank
      COUNT(q.id) FILTER (
        WHERE q.state = 'answered' 
          AND upper(trim(coalesce(q.selected_option, ''))) = upper(trim(mq.correct_option))
      ) AS verified_correct,
      COALESCE(SUM(
        CASE 
          WHEN q.state = 'answered' AND upper(trim(coalesce(q.selected_option, ''))) = upper(trim(mq.correct_option)) THEN 100 
          ELSE 0 
        END
      ), 0) AS verified_score,
      COUNT(q.id) FILTER (
        WHERE q.state = 'answered' AND q.selected_option IS NULL
      ) AS invalid_null_answers_count,
      COUNT(q.id) FILTER (
        WHERE q.state = 'skipped' AND (q.points_awarded <> 0 OR q.selected_option IS NOT NULL)
      ) AS invalid_skipped_points_count,
      COUNT(q.id) FILTER (
        WHERE q.state IN ('timeout', 'unanswered') AND q.points_awarded <> 0
      ) AS invalid_unanswered_points_count
    FROM public.championship_finale_sessions s
    LEFT JOIN public.championship_finale_question_states q ON q.session_id = s.id
    LEFT JOIN public.championship_finale_questions mq ON mq.id = q.question_id
    WHERE s.day_number = p_day_number AND s.status IN ('completed', 'expired')
    GROUP BY s.id, s.user_id, s.total_score, s.correct_count, s.attempted_count,
             s.skipped_count, s.unanswered_count, s.total_time_seconds
  ) LOOP
    -- Check 1: Exactly 10 raw slot records must exist
    IF v_rec.raw_slots_count <> 10 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'INCOMPLETE_SLOTS',
        'expected', 10, 'actual', v_rec.raw_slots_count
      );
    END IF;

    -- Check 2: Score match against question states
    IF v_rec.cached_score <> v_rec.calculated_score THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'SCORE_MISMATCH',
        'cached', v_rec.cached_score, 'calculated', v_rec.calculated_score
      );
    END IF;

    -- Check 3 (ADV-07): Cross-verification against master question bank
    IF v_rec.cached_score <> v_rec.verified_score THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'MASTER_ANSWER_VERIFICATION_MISMATCH',
        'cached', v_rec.cached_score, 'verified_against_master', v_rec.verified_score
      );
    END IF;

    IF v_rec.cached_correct <> v_rec.verified_correct THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'CORRECT_COUNT_VERIFICATION_MISMATCH',
        'cached', v_rec.cached_correct, 'verified_against_master', v_rec.verified_correct
      );
    END IF;

    -- Check 4: State integrity violations
    IF v_rec.invalid_skipped_points_count > 0 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'SKIPPED_SLOT_POINT_VIOLATION'
      );
    END IF;

    IF v_rec.invalid_unanswered_points_count > 0 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'UNANSWERED_SLOT_POINT_VIOLATION'
      );
    END IF;

    -- Check 5: Mathematical integrity equations
    IF v_rec.cached_score <> (v_rec.verified_correct * 100) THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'POINT_FORMULA_VIOLATION'
      );
    END IF;

    IF (v_rec.calculated_attempted + v_rec.calculated_skipped + v_rec.calculated_unanswered) <> 10 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'SLOT_CATEGORY_SUM_VIOLATION'
      );
    END IF;

    -- Check 6: Timer bounds
    IF v_rec.total_time_seconds < 0.000 OR v_rec.total_time_seconds > 90.000 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'session_id', v_rec.session_id, 'issue', 'TIMER_BOUNDS_VIOLATION',
        'time', v_rec.total_time_seconds
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', (jsonb_array_length(v_discrepancies) = 0),
    'discrepancies_count', jsonb_array_length(v_discrepancies),
    'discrepancies', v_discrepancies
  );
END;
$$;

-- Revoke public execution of reconciliation (ADV-06)
REVOKE EXECUTE ON FUNCTION public.reconcile_finale_day_scores(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_finale_day_scores(INTEGER) TO authenticated, service_role;

-- ── 12. ADMIN RPC: PUBLISH DAILY RESULTS (DUAL APPROVAL STEP 2) (ADV-08) ──────
CREATE OR REPLACE FUNCTION public.admin_publish_daily_results(
  p_approval_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_day_number INTEGER;
  v_day RECORD;
  v_reconciliation JSONB;
  v_lingering_session RECORD;
  v_swept_score INTEGER;
  v_swept_correct INTEGER;
  v_swept_attempted INTEGER;
  v_swept_skipped INTEGER;
  v_swept_unanswered INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT (public.is_grand_finale_admin() AND public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_SUPER_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ALREADY_PROCESSED');
  END IF;

  IF v_now > v_approval.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_EXPIRED');
  END IF;

  IF v_approval.action_name <> 'PUBLISH_DAILY_RESULTS' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ACTION_MISMATCH');
  END IF;

  IF v_approval.first_approver_id = v_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL');
  END IF;

  v_day_number := v_approval.target_day;
  IF v_day_number IS NULL OR v_day_number NOT BETWEEN 1 AND 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_TARGET_DAY');
  END IF;

  -- Acquire day advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('finale_day_' || v_day_number::text));

  -- 1. Lock day row and enforce event window cutoff
  SELECT * INTO v_day
  FROM public.championship_finale_days
  WHERE day_number = v_day_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DAY_NOT_FOUND');
  END IF;

  IF v_day.results_published IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'RESULTS_ALREADY_PUBLISHED');
  END IF;

  -- Ensure window has closed or status is already paused/closed
  IF v_now < v_day.window_closes_at AND v_day.status = 'open' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'EVENT_WINDOW_STILL_OPEN',
      'window_closes_at', v_day.window_closes_at
    );
  END IF;

  -- ADV-08: Ensure no active sessions are still counting down within their 90.000s duration
  IF EXISTS (
    SELECT 1 FROM public.championship_finale_sessions
    WHERE day_number = v_day_number AND status = 'active' AND expires_at > v_now
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'ACTIVE_SESSIONS_STILL_COUNTING_DOWN',
      'message', 'Cannot publish daily results while active contestant sessions have unexpired countdown timers.'
    );
  END IF;

  -- 2. Atomically transition day status to 'closed' to block concurrent slot submissions
  UPDATE public.championship_finale_days
  SET status = 'closed', updated_at = v_now
  WHERE day_number = v_day_number;

  -- 3. Sweep any lingering 'active' sessions whose countdown has elapsed to 'expired'
  FOR v_lingering_session IN (
    SELECT id, started_at, expires_at
    FROM public.championship_finale_sessions
    WHERE day_number = v_day_number AND status = 'active'
    FOR UPDATE
  ) LOOP
    UPDATE public.championship_finale_question_states
    SET state = 'unanswered', points_awarded = 0, server_received_at = v_now
    WHERE session_id = v_lingering_session.id AND state = 'pending';

    SELECT 
      COALESCE(SUM(points_awarded), 0),
      COUNT(*) FILTER (WHERE state = 'answered' AND is_correct = true),
      COUNT(*) FILTER (WHERE state = 'answered'),
      COUNT(*) FILTER (WHERE state = 'skipped'),
      COUNT(*) FILTER (WHERE state IN ('timeout', 'unanswered'))
    INTO v_swept_score, v_swept_correct, v_swept_attempted, v_swept_skipped, v_swept_unanswered
    FROM public.championship_finale_question_states
    WHERE session_id = v_lingering_session.id;

    UPDATE public.championship_finale_sessions
    SET status = 'expired',
        completed_at = v_lingering_session.expires_at,
        total_time_seconds = 90.000,
        total_score = v_swept_score,
        correct_count = v_swept_correct,
        attempted_count = v_swept_attempted,
        skipped_count = v_swept_skipped,
        unanswered_count = v_swept_unanswered,
        updated_at = v_now
    WHERE id = v_lingering_session.id;
  END LOOP;

  -- 4. Run Automated Score Reconciliation on stable dataset (cross-verifying question bank)
  v_reconciliation := public.reconcile_finale_day_scores(v_day_number);
  IF (v_reconciliation->>'ok')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'RECONCILIATION_FAILED',
      'details', v_reconciliation
    );
  END IF;

  -- 5. Consume approval
  UPDATE public.championship_finale_admin_approvals
  SET status = 'executed', second_approver_id = v_admin_id, second_approved_at = v_now, executed_at = v_now
  WHERE id = p_approval_id;

  -- 6. Materialize Daily Results Snapshot (Immutable via trigger)
  INSERT INTO public.championship_finale_results (
    result_type, day_number, roster_id, user_id, student_name,
    college, batch, seat_number, score, elapsed_time_seconds,
    correct_count, attempted_count, skipped_count, unanswered_count,
    rank, is_winner, tie_status, published_at, published_by, snapshot_version
  )
  SELECT 
    'daily',
    v_day_number,
    r.id,
    r.user_id,
    r.student_name,
    r.college,
    r.batch,
    r.seat_number,
    COALESCE(s.total_score, 0),
    COALESCE(s.total_time_seconds, 90.000),
    COALESCE(s.correct_count, 0),
    COALESCE(s.attempted_count, 0),
    COALESCE(s.skipped_count, 0),
    COALESCE(s.unanswered_count, 10),
    DENSE_RANK() OVER (
      ORDER BY 
        COALESCE(s.total_score, 0) DESC,
        COALESCE(s.total_time_seconds, 90.000) ASC,
        COALESCE(s.attempted_count, 0) DESC
    ),
    false,
    'none',
    v_now,
    v_admin_id,
    1
  FROM public.championship_finale_roster r
  LEFT JOIN public.championship_finale_sessions s
    ON s.roster_id = r.id AND s.day_number = v_day_number AND s.status IN ('completed', 'expired')
  WHERE r.seat_type = 'finalist' AND r.participation_status IN ('active', 'promoted')
  ON CONFLICT (result_type, day_number, user_id, snapshot_version) DO NOTHING;

  -- 7. Unlock solutions view and mark day results published
  UPDATE public.championship_finale_days
  SET results_published = true,
      published_at = v_now,
      published_by = v_admin_id,
      status = 'results_published',
      updated_at = v_now
  WHERE day_number = v_day_number;

  PERFORM public.log_finale_audit_event(
    'RESULTS_PUBLISHED', 'super_admin', 'championship_finale_days', v_day_number::text,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'first_approver', v_approval.first_approver_id,
      'second_approver', v_admin_id,
      'published_at', v_now
    )
  );

  RETURN jsonb_build_object('ok', true, 'day_number', v_day_number, 'published_at', v_now);
END;
$$;

-- ── 13. ADMIN RPC: DECLARE FINAL WINNER & 3-DAY STANDINGS (ADV-11) ────────────
CREATE OR REPLACE FUNCTION public.admin_declare_final_winner(
  p_approval_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_approval RECORD;
  v_unpublished_days_count INTEGER;
  v_winners_count INTEGER;
  v_champion_name TEXT;
  v_champion_score INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT (public.is_grand_finale_admin() AND public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHORIZED_SUPER_ADMIN_REQUIRED');
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finale_declare_winner'));

  SELECT * INTO v_approval
  FROM public.championship_finale_admin_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_RECORD_NOT_FOUND');
  END IF;

  IF v_approval.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ALREADY_PROCESSED');
  END IF;

  IF v_now > v_approval.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_EXPIRED');
  END IF;

  IF v_approval.action_name <> 'DECLARE_FINAL_WINNER' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'APPROVAL_ACTION_MISMATCH');
  END IF;

  IF v_approval.first_approver_id = v_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL');
  END IF;

  -- Guard against duplicate winner declaration
  IF EXISTS (SELECT 1 FROM public.championship_finale_results WHERE result_type = 'cumulative') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'WINNER_ALREADY_DECLARED');
  END IF;

  -- Verify all 3 days are published
  SELECT count(*) INTO v_unpublished_days_count
  FROM public.championship_finale_days
  WHERE results_published IS NOT TRUE;

  IF v_unpublished_days_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNPUBLISHED_DAYS_REMAINING', 'count', v_unpublished_days_count);
  END IF;

  -- Consume approval
  UPDATE public.championship_finale_admin_approvals
  SET status = 'executed', second_approver_id = v_admin_id, second_approved_at = v_now, executed_at = v_now
  WHERE id = p_approval_id;

  -- Materialize Final Cumulative Results with Deterministic 10-Tier Hierarchy.
  -- ADV-11: Directly compute tie_status during INSERT so championship_finale_results remains 100% immutable.
  INSERT INTO public.championship_finale_results (
    result_type, day_number, roster_id, user_id, student_name,
    college, batch, seat_number, score, elapsed_time_seconds,
    correct_count, attempted_count, skipped_count, unanswered_count,
    day3_score, day3_time_seconds, day2_score, day2_time_seconds,
    day1_score, day1_time_seconds, rank, is_winner, tie_status,
    published_at, published_by, snapshot_version
  )
  WITH contestant_aggregates AS (
    SELECT 
      r.id AS roster_id,
      r.user_id,
      r.student_name,
      r.college,
      r.batch,
      r.seat_number,
      COALESCE(SUM(s.total_score), 0)::integer AS cumulative_score,
      -- Strict sum of daily times where absent days are penalized with 90.000s duration penalty
      (COALESCE(MAX(CASE WHEN s.day_number = 1 THEN s.total_time_seconds END), 90.000) +
       COALESCE(MAX(CASE WHEN s.day_number = 2 THEN s.total_time_seconds END), 90.000) +
       COALESCE(MAX(CASE WHEN s.day_number = 3 THEN s.total_time_seconds END), 90.000))::numeric(6,3) AS cumulative_time,
      COALESCE(SUM(s.correct_count), 0)::integer AS cumulative_correct,
      COALESCE(SUM(s.attempted_count), 0)::integer AS cumulative_attempted,
      COALESCE(SUM(s.skipped_count), 0)::integer AS cumulative_skipped,
      -- Absent days contribute 10 unanswered questions each
      ((30) - (COALESCE(SUM(s.attempted_count), 0) + COALESCE(SUM(s.skipped_count), 0)))::integer AS cumulative_unanswered,
      -- Day 3 Deciders
      COALESCE(MAX(CASE WHEN s.day_number = 3 THEN s.total_score END), 0)::integer AS d3_score,
      COALESCE(MAX(CASE WHEN s.day_number = 3 THEN s.total_time_seconds END), 90.000)::numeric(6,3) AS d3_time,
      -- Day 2 Deciders
      COALESCE(MAX(CASE WHEN s.day_number = 2 THEN s.total_score END), 0)::integer AS d2_score,
      COALESCE(MAX(CASE WHEN s.day_number = 2 THEN s.total_time_seconds END), 90.000)::numeric(6,3) AS d2_time,
      -- Day 1 Deciders
      COALESCE(MAX(CASE WHEN s.day_number = 1 THEN s.total_score END), 0)::integer AS d1_score,
      COALESCE(MAX(CASE WHEN s.day_number = 1 THEN s.total_time_seconds END), 90.000)::numeric(6,3) AS d1_time
    FROM public.championship_finale_roster r
    LEFT JOIN public.championship_finale_sessions s
      ON s.roster_id = r.id AND s.status IN ('completed', 'expired')
    WHERE r.seat_type = 'finalist' AND r.participation_status IN ('active', 'promoted')
    GROUP BY r.id, r.user_id, r.student_name, r.college, r.batch, r.seat_number
  ),
  ranked_contestants AS (
    SELECT 
      *,
      DENSE_RANK() OVER (
        ORDER BY 
          cumulative_score DESC,
          cumulative_time ASC,
          cumulative_attempted DESC,
          d3_score DESC,
          d3_time ASC,
          d2_score DESC,
          d2_time ASC,
          d1_score DESC,
          d1_time ASC
      ) AS computed_rank
    FROM contestant_aggregates
  ),
  co_winners_count AS (
    SELECT count(*) AS winner_count
    FROM ranked_contestants
    WHERE computed_rank = 1
  )
  SELECT 
    'cumulative',
    NULL,
    rc.roster_id,
    rc.user_id,
    rc.student_name,
    rc.college,
    rc.batch,
    rc.seat_number,
    rc.cumulative_score,
    rc.cumulative_time,
    rc.cumulative_correct,
    rc.cumulative_attempted,
    rc.cumulative_skipped,
    rc.cumulative_unanswered,
    rc.d3_score, rc.d3_time,
    rc.d2_score, rc.d2_time,
    rc.d1_score, rc.d1_time,
    rc.computed_rank AS rank,
    (rc.computed_rank = 1) AS is_winner,
    CASE 
      WHEN rc.computed_rank = 1 AND cw.winner_count > 1 THEN 'joint_standing'
      WHEN rc.computed_rank = 1 THEN 'resolved_by_rules'
      ELSE 'none'
    END AS tie_status,
    v_now,
    v_admin_id,
    1
  FROM ranked_contestants rc
  CROSS JOIN co_winners_count cw
  ON CONFLICT (result_type, day_number, user_id, snapshot_version) DO NOTHING;

  -- Fetch crowned champions for audit event and return payload
  SELECT count(*), string_agg(student_name, ' & '), MAX(score)
  INTO v_winners_count, v_champion_name, v_champion_score
  FROM public.championship_finale_results
  WHERE result_type = 'cumulative' AND rank = 1;

  -- Complete tournament event
  UPDATE public.championship_finale_event
  SET status = 'completed', updated_at = v_now
  WHERE id = 'SEASON_1';

  PERFORM public.log_finale_audit_event(
    'CHAMPION_CROWNED', 'super_admin', 'championship_finale_event', 'SEASON_1',
    jsonb_build_object(
      'approval_id', p_approval_id,
      'first_approver', v_approval.first_approver_id,
      'second_approver', v_admin_id,
      'is_joint_standing', (v_winners_count > 1),
      'winners_count', v_winners_count,
      'champion_name', v_champion_name,
      'final_score', v_champion_score
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'is_joint_standing', (v_winners_count > 1),
    'co_champions_count', v_winners_count,
    'champion_name', v_champion_name,
    'final_score', v_champion_score,
    'declared_at', v_now
  );
END;
$$;

-- ── 14. MAINTENANCE RPC: TELEMETRY CLEANUP (30-DAY RETENTION) ─────────────────
CREATE OR REPLACE FUNCTION public.cleanup_finale_telemetry(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  IF NOT public.is_grand_finale_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Admin privileges required for maintenance cleanup.';
  END IF;

  DELETE FROM public.championship_finale_telemetry
  WHERE created_at < (clock_timestamp() - (p_retention_days || ' days')::interval);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  PERFORM public.log_finale_audit_event(
    'TELEMETRY_PRUNED', 'admin', 'championship_finale_telemetry', NULL,
    jsonb_build_object('retention_days', p_retention_days, 'deleted_rows', v_deleted_count)
  );

  RETURN v_deleted_count;
END;
$$;

COMMIT;
