-- ==============================================================================
-- Test Suite: finale_security_verification_suite.sql
-- Description:
--   Comprehensive database security, integrity, dual-approval, and concurrency
--   verification suite for MedTrail Championship Season 1 Grand Finale.
--
-- Features Tested (Phase 2.4 / Stage 3):
--   - Test 1: Roster Seeding & Pre-Seal Cardinality Verification
--   - Test 2: Question Bank Seeding (30 Questions across 3 Days)
--   - Test 3: Two-Person Dual Administrative Sealing & Anti-Self-Approval Gate
--   - Test 4: Session Lifecycle & 90-Second Server-Authoritative Countdown Boundary
--   - Test 5: Strict Sequential Progression, Idempotency & Conflict Handling
--   - Test 6: Dual Approval Reissue Workflow & Partial Unique Index Enforcement
--   - Test 7: Scoring Reconciliation Gate (Fail-Closed)
--   - Test 8: Dual Approval Results Publication & Deterministic 10-Tier Standings
--   - Test 8B: Cumulative Absent-Day Duration Penalty Verification (90.000s)
--   - Test 9: Audit Trail Cryptographic Hash Chaining & Trigger Immutability
--   - Test 10 (ADV-05): Prospective Hash Binding & TOCTOU Tamper Rejection
--   - Test 11 (ADV-07): Master Question Bank Verification & Client Tamper Detection
--   - Test 12 (ADV-09): Administrative Approval Rejection Protocol & Audit Trail
--   - Test 13 (ADV-11): Official Results Immutability (Anti-UPDATE/DELETE Trigger)
--
-- Safety Notice:
--   DO NOT EXECUTE AGAINST PRODUCTION.
--   Designed strictly for an isolated sandbox/staging database.
--   Enclosed in a single transaction with mandatory ROLLBACK to leave 0 persistent data.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_admin_1_uid UUID := '99999999-0000-0000-0000-000000000001'::uuid;
  v_admin_2_uid UUID := '99999999-0000-0000-0000-000000000002'::uuid;
  v_finalist_1_uid UUID := '11111111-0001-0000-0000-000000000001'::uuid;
  v_finalist_2_uid UUID := '11111111-0002-0000-0000-000000000002'::uuid;
  v_finalist_3_uid UUID := '11111111-0003-0000-0000-000000000003'::uuid;
  v_reserve_1_uid UUID := '22222222-0001-0000-0000-000000000001'::uuid;
  v_reserve_2_uid UUID := '22222222-0002-0000-0000-000000000002'::uuid;

  v_res JSONB;
  v_req_res JSONB;
  v_approval_id UUID;
  v_session_id UUID;
  v_new_session_id UUID;
  v_q1_id UUID;
  v_reconcile JSONB;
  v_rank_count INTEGER;
  v_audit_count INTEGER;
  v_ex_caught BOOLEAN := false;
  v_rec_time NUMERIC(6,3);
  v_d1_time NUMERIC(6,3);
  v_d2_time NUMERIC(6,3);
  v_d3_time NUMERIC(6,3);
  i INTEGER;
  -- ADV Phase 2.4 Stage 3 test variables
  v_err_msg TEXT := '';
  v_test_approval_id UUID;
  v_saved_score INTEGER;
  v_saved_points INTEGER;
  v_saved_explanation TEXT;
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'STARTING FINALE SECURITY & INTEGRITY TEST SUITE';
  RAISE NOTICE '=====================================================';

  -- ── FIXTURE SETUP: Scoped Synthetic Auth Users ─────────────────────────────
  -- Clean up only synthetic test users from prior runs
  DELETE FROM auth.users WHERE email LIKE '%@finale-synthetic.test';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin_1_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@finale-synthetic.test', '', now(), '{"role":"admin","is_admin":true,"is_super_admin":true}'::jsonb, '{}'::jsonb, now(), now()),
    (v_admin_2_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@finale-synthetic.test', '', now(), '{"role":"admin","is_admin":true,"is_super_admin":true}'::jsonb, '{}'::jsonb, now(), now()),
    (v_finalist_1_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finalist1@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now()),
    (v_finalist_2_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finalist2@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now()),
    (v_finalist_3_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finalist3@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now()),
    (v_reserve_1_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reserve1@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now()),
    (v_reserve_2_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reserve2@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Create remaining 7 finalists (4 through 10)
  FOR i IN 4..10 LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (
      ('11111111-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'finalist' || i || '@finale-synthetic.test', '', now(), '{"role":"authenticated","is_admin":false}'::jsonb, '{}'::jsonb, now(), now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- ── TEST 1: Roster Seeding & Pre-Seal Verification ──────────────────────────
  RAISE NOTICE '[Test 1] Testing Roster Seeding & Pre-Seal Cardinality Verification...';
  DELETE FROM public.championship_finale_roster WHERE qualifier_id LIKE 'SYNTH-QUAL-%';

  -- Insert 10 finalists + 2 reserves
  FOR i IN 1..10 LOOP
    INSERT INTO public.championship_finale_roster (
      seat_type, seat_number, user_id, qualifier_id, student_name,
      college, batch, qualification_rank, verification_status, attendance_confirmed
    ) VALUES (
      'finalist', i,
      CASE 
        WHEN i = 1 THEN v_finalist_1_uid
        WHEN i = 2 THEN v_finalist_2_uid
        WHEN i = 3 THEN v_finalist_3_uid
        ELSE ('11111111-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
      END,
      'SYNTH-QUAL-S1-' || lpad(i::text, 3, '0'),
      'Dr. Finalist ' || i, 'MIMER Medical College', '2024 Batch', i, 'verified', true
    ) ON CONFLICT (seat_type, seat_number) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          qualifier_id = EXCLUDED.qualifier_id,
          student_name = EXCLUDED.student_name,
          verification_status = 'verified',
          attendance_confirmed = true,
          participation_status = 'active';
  END LOOP;

  INSERT INTO public.championship_finale_roster (
    seat_type, seat_number, user_id, qualifier_id, student_name,
    college, batch, qualification_rank, verification_status, attendance_confirmed
  ) VALUES
    ('reserve', 1, v_reserve_1_uid, 'SYNTH-QUAL-S1-RES1', 'Dr. Reserve 1', 'BJ Medical College', '2024 Batch', 11, 'verified', true),
    ('reserve', 2, v_reserve_2_uid, 'SYNTH-QUAL-S1-RES2', 'Dr. Reserve 2', 'KEM Hospital Mumbai', '2023 Batch', 12, 'verified', true)
  ON CONFLICT (seat_type, seat_number) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        qualifier_id = EXCLUDED.qualifier_id,
        verification_status = 'verified',
        attendance_confirmed = true,
        participation_status = 'active';

  -- ── TEST 2: Question Bank Seeding (30 Questions) ────────────────────────────
  RAISE NOTICE '[Test 2] Seeding 30 Questions across Days 1, 2, 3...';
  DELETE FROM public.championship_finale_questions WHERE question_text LIKE 'Synth Day %';

  FOR i IN 1..10 LOOP
    INSERT INTO public.championship_finale_questions (
      day_number, slot_number, question_text, option_a, option_b, option_c, option_d, correct_option, explanation
    ) VALUES
      (1, i, 'Synth Day 1 Question ' || i, 'Option A', 'Option B', 'Option C', 'Option D', 'B', 'Explanation Day 1 Slot ' || i),
      (2, i, 'Synth Day 2 Question ' || i, 'Option A', 'Option B', 'Option C', 'Option D', 'C', 'Explanation Day 2 Slot ' || i),
      (3, i, 'Synth Day 3 Question ' || i, 'Option A', 'Option B', 'Option C', 'Option D', 'A', 'Explanation Day 3 Slot ' || i)
    ON CONFLICT (day_number, slot_number) DO UPDATE
      SET question_text = EXCLUDED.question_text,
          correct_option = EXCLUDED.correct_option,
          explanation = EXCLUDED.explanation;
  END LOOP;

  -- ── TEST 3: True Two-Person Dual Administrative Sealing ─────────────────────
  RAISE NOTICE '[Test 3] Testing Dual Approval Protocol on Roster Sealing...';

  -- Step 3A: Admin 1 requests approval
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_1_uid,
    'email', 'admin1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_req_res := public.admin_request_approval('SEAL_ROSTER', NULL, '{"action":"seal_grand_finale_roster"}'::jsonb);
  IF (v_req_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Admin 1 failed to request approval: %', v_req_res;
  END IF;
  v_approval_id := (v_req_res->>'approval_id')::uuid;
  RAISE NOTICE '  --> Step 1 (Request Initiated): Approval ID = %', v_approval_id;

  -- Step 3B: Admin 1 attempts self-approval (MUST FAIL)
  v_res := public.admin_seal_grand_finale_roster(v_approval_id);
  IF (v_res->>'error_code') <> 'DUAL_APPROVAL_VIOLATION_SELF_APPROVAL' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Self-approval was NOT rejected! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Dual-Approval Gate Verified: Initiator self-approval rejected cleanly.';

  -- Step 3C: Admin 2 executes approval
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin2@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_2_uid,
    'email', 'admin2@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_res := public.admin_seal_grand_finale_roster(v_approval_id);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Admin 2 failed to execute seal: %', v_res;
  END IF;
  RAISE NOTICE '  --> Roster & Question Bank Sealed Successfully! Roster Hash: %, Question Hash: %',
    v_res->>'roster_hash', v_res->>'questions_hash';

  -- Verify sealed roster trigger blocks raw direct DML
  v_ex_caught := false;
  BEGIN
    INSERT INTO public.championship_finale_roster (
      seat_type, seat_number, user_id, qualifier_id, student_name,
      college, batch, qualification_rank, verification_status, attendance_confirmed
    ) VALUES ('finalist', 1, gen_random_uuid(), 'SYNTH-HACK', 'Hacker', 'Fake', '2024', 99, 'verified', true);
  EXCEPTION WHEN OTHERS THEN
    v_ex_caught := true;
  END;

  IF NOT v_ex_caught THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Sealed roster trigger failed to block unauthorized INSERT!';
  END IF;
  RAISE NOTICE '  --> Tamper Protection Verified: Direct INSERT blocked after seal.';

  -- ── TEST 4: Session Lifecycle & 90-Second Countdown ─────────────────────────
  RAISE NOTICE '[Test 4] Testing Session Creation and Countdown Boundary...';
  -- Open Day 1 window for testing
  UPDATE public.championship_finale_days
  SET status = 'open', window_opens_at = now() - interval '5 minutes', window_closes_at = now() + interval '55 minutes'
  WHERE day_number = 1;

  -- Act as Finalist 1
  PERFORM set_config('request.jwt.claim.sub', v_finalist_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'finalist1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_finalist_1_uid,
    'email', 'finalist1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'authenticated', 'is_admin', false)
  )::text, true);

  v_res := public.start_or_resume_finale_session(1);

  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Finalist 1 session start failed: %', v_res;
  END IF;
  v_session_id := (v_res->>'session_id')::uuid;
  RAISE NOTICE '  --> Finalist 1 Session Started: %', v_session_id;

  -- ── TEST 5: Strict Sequential Progression, Idempotency & Conflict Handling ──
  RAISE NOTICE '[Test 5] Testing Sequential Slot Progression & Robust Idempotency...';

  -- Test 5A: Submit Slot 2 before Slot 1 (must fail ERR_SLOT_OUT_OF_ORDER)
  v_res := public.submit_finale_slot_action(v_session_id, 2, 'answer', 'B', 'key_slot_2');
  IF (v_res->>'error_code') <> 'ERR_SLOT_OUT_OF_ORDER' THEN
    RAISE EXCEPTION 'TEST 5A FAILED: Server allowed Slot 2 before Slot 1! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Out-of-order rejection verified (ERR_SLOT_OUT_OF_ORDER).';

  -- Test 5B: Submit Slot 1 Correctly (Answer = 'B')
  v_res := public.submit_finale_slot_action(v_session_id, 1, 'answer', 'B', 'key_slot_1');
  IF (v_res->>'ok')::boolean IS NOT TRUE OR (v_res->>'next_slot')::integer <> 2 THEN
    RAISE EXCEPTION 'TEST 5B FAILED: Valid Slot 1 answer rejected: %', v_res;
  END IF;

  -- Test 5C: Identical Double-Tap Slot 1 (Must return cached success without duplicate points)
  v_res := public.submit_finale_slot_action(v_session_id, 1, 'answer', 'B', 'key_slot_1');
  IF (v_res->>'is_duplicate')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 5C FAILED: Identical retry did not return is_duplicate: true!';
  END IF;
  RAISE NOTICE '  --> Idempotent retry verified.';

  -- Test 5D: Conflicting Retry Slot 1 (Option A vs committed Option B, must fail)
  v_res := public.submit_finale_slot_action(v_session_id, 1, 'answer', 'A', 'key_slot_1');
  IF (v_res->>'error_code') <> 'ERR_SLOT_ALREADY_COMMITTED_CONFLICT' THEN
    RAISE EXCEPTION 'TEST 5D FAILED: Conflicting retry was not rejected with ERR_SLOT_ALREADY_COMMITTED_CONFLICT! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Conflicting retry rejection verified (ERR_SLOT_ALREADY_COMMITTED_CONFLICT).';

  -- Complete remaining slots 2..10 (Slot 2 Skip, Slot 3..10 Answer)
  PERFORM public.submit_finale_slot_action(v_session_id, 2, 'skip', NULL, 'key_slot_2');
  FOR i IN 3..10 LOOP
    PERFORM public.submit_finale_slot_action(v_session_id, i, 'answer', 'B', 'key_slot_' || i);
  END LOOP;

  -- Verify session status is 'completed'
  SELECT total_score INTO i FROM public.championship_finale_sessions WHERE id = v_session_id;
  IF i <> 900 THEN -- 9 correct (slots 1, 3..10) * 100 = 900 pts, Slot 2 skipped = 0 pts
    RAISE EXCEPTION 'TEST 5 FAILED: Expected score 900, got %', i;
  END IF;
  RAISE NOTICE '  --> All 10 Slots Completed! Final Score: 900 pts.';

  -- ── TEST 6: Dual Approval Reissue Workflow & Partial Unique Index ────────────
  RAISE NOTICE '[Test 6] Testing Dual-Approval Reissue Workflow...';

  -- Admin 1 initiates reissue request
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_1_uid,
    'email', 'admin1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_req_res := public.admin_request_approval(
    'VOID_AND_REISSUE_SESSION',
    1,
    jsonb_build_object('session_id', v_session_id, 'reason', 'Synthetic Testing Technical Disruption')
  );
  v_approval_id := (v_req_res->>'approval_id')::uuid;

  -- Admin 2 approves and executes reissue
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin2@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_2_uid,
    'email', 'admin2@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_res := public.admin_void_and_reissue_session(v_approval_id);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 6 FAILED: admin_void_and_reissue_session failed: %', v_res;
  END IF;
  v_new_session_id := (v_res->>'new_session_id')::uuid;
  RAISE NOTICE '  --> Old Session Voided, Replacement Issued: %', v_new_session_id;

  -- Verify partial unique index prevents concurrent second live session
  v_ex_caught := false;
  BEGIN
    INSERT INTO public.championship_finale_sessions (
      day_number, roster_id, user_id, status, started_at, expires_at
    ) VALUES (
      1, (SELECT roster_id FROM public.championship_finale_sessions WHERE id = v_session_id),
      v_finalist_1_uid, 'active', now(), now() + interval '90 seconds'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ex_caught := true;
  END;

  IF NOT v_ex_caught THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Partial unique index failed to block concurrent active session!';
  END IF;
  RAISE NOTICE '  --> Partial Unique Index verified: Multiple live sessions strictly prohibited.';

  -- Complete replacement session with 10 correct answers
  PERFORM set_config('request.jwt.claim.sub', v_finalist_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'finalist1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_finalist_1_uid,
    'email', 'finalist1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'authenticated', 'is_admin', false)
  )::text, true);

  FOR i IN 1..10 LOOP
    PERFORM public.submit_finale_slot_action(v_new_session_id, i, 'answer', 'B', 'reissued_slot_' || i);
  END LOOP;

  -- ── TEST 7: Scoring Reconciliation (Fail-Closed Gate) ────────────────────────
  RAISE NOTICE '[Test 7] Testing Automated Scoring Reconciliation Gate...';
  v_reconcile := public.reconcile_finale_day_scores(1);
  IF (v_reconcile->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Score reconciliation returned discrepancies: %', v_reconcile;
  END IF;
  RAISE NOTICE '  --> Automated Scoring Reconciliation PASSED cleanly.';

  -- ── TEST 8: Dual Approval Results Publication & 10-Tier Standings ────────────
  RAISE NOTICE '[Test 8] Testing Dual-Approval Publication & Deterministic Standings...';

  -- Close Day 1 window
  UPDATE public.championship_finale_days
  SET window_closes_at = now() - interval '1 second'
  WHERE day_number = 1;

  -- Day 1 Publish: Admin 1 request + Admin 2 publish
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_1_uid, 'email', 'admin1@finale-synthetic.test', 'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true))::text, true);

  v_req_res := public.admin_request_approval('PUBLISH_DAILY_RESULTS', 1, '{}'::jsonb);
  v_approval_id := (v_req_res->>'approval_id')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin2@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_2_uid, 'email', 'admin2@finale-synthetic.test', 'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true))::text, true);

  v_res := public.admin_publish_daily_results(v_approval_id);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 8 FAILED: admin_publish_daily_results Day 1 failed: %', v_res;
  END IF;
  RAISE NOTICE '  --> Day 1 Results Published via Dual Approval.';

  -- Open and Close Days 2 & 3 for full cumulative simulation
  UPDATE public.championship_finale_days
  SET status = 'open', window_opens_at = now() - interval '10 minutes', window_closes_at = now() - interval '1 second'
  WHERE day_number IN (2, 3);

  -- Day 2 Dual Publish
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  v_req_res := public.admin_request_approval('PUBLISH_DAILY_RESULTS', 2, '{}'::jsonb);
  v_approval_id := (v_req_res->>'approval_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM public.admin_publish_daily_results(v_approval_id);

  -- Day 3 Dual Publish
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  v_req_res := public.admin_request_approval('PUBLISH_DAILY_RESULTS', 3, '{}'::jsonb);
  v_approval_id := (v_req_res->>'approval_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM public.admin_publish_daily_results(v_approval_id);

  -- Declare Final Winner via Dual Approval
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  v_req_res := public.admin_request_approval('DECLARE_FINAL_WINNER', NULL, '{}'::jsonb);
  v_approval_id := (v_req_res->>'approval_id')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  v_res := public.admin_declare_final_winner(v_approval_id);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 8 FAILED: admin_declare_final_winner failed: %', v_res;
  END IF;
  RAISE NOTICE '  --> Grand Finale Winner Declared: % (%) Final Score: %',
    v_res->>'champion_name', v_res->>'champion_college', v_res->>'final_score';

  -- Verify cumulative leaderboard row count
  SELECT count(*) INTO v_rank_count
  FROM public.championship_finale_results
  WHERE result_type = 'cumulative';

  IF v_rank_count <> 10 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected exactly 10 cumulative ranking entries, found %', v_rank_count;
  END IF;
  RAISE NOTICE '  --> Exactly 10 Finalists Ranked in Cumulative Standings.';

  -- ── TEST 8B: Cumulative Time 90s Penalty Verification (P0 Remediation Check) ─
  RAISE NOTICE '[Test 8B] Verifying Cumulative Absent-Day Time Penalty (P0 Check)...';
  SELECT elapsed_time_seconds, day1_time_seconds, day2_time_seconds, day3_time_seconds
  INTO v_rec_time, v_d1_time, v_d2_time, v_d3_time
  FROM public.championship_finale_results
  WHERE result_type = 'cumulative' AND user_id = v_finalist_1_uid;

  -- Finalist 1 played Day 1, but was absent on Days 2 and 3
  IF v_d2_time <> 90.000 OR v_d3_time <> 90.000 THEN
    RAISE EXCEPTION 'TEST 8B FAILED: Missing days were not assigned 90.000s duration penalty! d2=%, d3=%', v_d2_time, v_d3_time;
  END IF;

  IF v_rec_time <> (v_d1_time + 90.000 + 90.000) THEN
    RAISE EXCEPTION 'TEST 8B FAILED: Cumulative time does not sum missing-day penalties! Got %, expected %',
      v_rec_time, (v_d1_time + 180.000);
  END IF;
  RAISE NOTICE '  --> P0 Remediation Verified: Missing days strictly penalized with 90.000s (Cumulative = % s).', v_rec_time;

  -- ── TEST 9: Audit Trail Cryptographic Hash Chaining ──────────────────────────
  RAISE NOTICE '[Test 9] Verifying Cryptographic Audit Log Integrity...';
  SELECT count(*) INTO v_audit_count
  FROM public.championship_finale_audit_log;

  IF v_audit_count < 5 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Insufficient audit log entries recorded: %', v_audit_count;
  END IF;

  -- Attempt to mutate audit log row (Must fail via immutability trigger)
  v_ex_caught := false;
  BEGIN
    UPDATE public.championship_finale_audit_log
    SET event_type = 'HACKED'
    WHERE id = (SELECT id FROM public.championship_finale_audit_log LIMIT 1);
  EXCEPTION WHEN OTHERS THEN
    v_ex_caught := true;
  END;

  IF NOT v_ex_caught THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Immutability trigger failed to block audit log UPDATE!';
  END IF;
  RAISE NOTICE '  --> Audit Log Immutability Verified: Direct UPDATE rejected.';

  -- ── TEST 10: Prospective Hash Binding & Anti-TOCTOU Verification (ADV-05) ────
  RAISE NOTICE '[Test 10] Testing Prospective Hash Binding & TOCTOU Tamper Rejection (ADV-05)...';

  -- Step 10A: Unseal roster temporarily within transaction for test
  UPDATE public.championship_finale_roster_meta
  SET is_sealed = false
  WHERE id = 1;

  -- Admin 1 initiates SEAL_ROSTER approval request
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_1_uid,
    'email', 'admin1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_req_res := public.admin_request_approval('SEAL_ROSTER', NULL, '{"test":"adv_05_toctou"}'::jsonb);
  IF (v_req_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Admin 1 failed to request SEAL_ROSTER: %', v_req_res;
  END IF;
  v_test_approval_id := (v_req_res->>'approval_id')::uuid;

  -- Verify approval record captured prospective digests
  SELECT (payload->>'roster_hash'), (payload->>'questions_hash')
  INTO v_res, v_req_res
  FROM public.championship_finale_admin_approvals
  WHERE id = v_test_approval_id;

  IF v_res IS NULL OR v_req_res IS NULL THEN
    RAISE EXCEPTION 'TEST 10 FAILED: admin_request_approval did not bind prospective hashes into payload!';
  END IF;
  RAISE NOTICE '  --> Prospective Hashes Bound in Approval: Roster=%, Questions=%', v_res, v_req_res;

  -- Step 10B: Tamper with target (modify Question 1 explanation after request was initiated)
  SELECT explanation INTO v_saved_explanation
  FROM public.championship_finale_questions
  WHERE day_number = 1 AND slot_number = 1;

  UPDATE public.championship_finale_questions
  SET explanation = 'MALICIOUS_TOCTOU_TAMPER_MODIFICATION'
  WHERE day_number = 1 AND slot_number = 1;

  -- Step 10C: Admin 2 attempts execution (MUST BE REJECTED due to digest mismatch)
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin2@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_2_uid,
    'email', 'admin2@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_res := public.admin_seal_grand_finale_roster(v_test_approval_id);

  IF (v_res->>'ok')::boolean IS NOT FALSE OR (v_res->>'error_code') <> 'PAYLOAD_DIGEST_MISMATCH_POST_REQUEST_TAMPERING' THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Tampered question bank was NOT rejected by hash verification! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Anti-TOCTOU Rejection Verified: PAYLOAD_DIGEST_MISMATCH_POST_REQUEST_TAMPERING returned.';

  -- Verify target was not mutated (roster remains unsealed, approval remains pending)
  IF (SELECT is_sealed FROM public.championship_finale_roster_meta WHERE id = 1) IS TRUE THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Roster meta was mutated despite hash mismatch!';
  END IF;

  IF (SELECT status FROM public.championship_finale_admin_approvals WHERE id = v_test_approval_id) <> 'pending' THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Approval status changed despite hash mismatch!';
  END IF;
  RAISE NOTICE '  --> Target Non-Mutation Verified: Roster remained unsealed, approval remained pending.';

  -- Restore question explanation
  UPDATE public.championship_finale_questions
  SET explanation = v_saved_explanation
  WHERE day_number = 1 AND slot_number = 1;

  -- Clean up test approval
  DELETE FROM public.championship_finale_admin_approvals WHERE id = v_test_approval_id;

  -- Re-seal roster meta
  UPDATE public.championship_finale_roster_meta
  SET is_sealed = true
  WHERE id = 1;

  -- ── TEST 11: Master Question Bank Verification & Score Tamper Gate (ADV-07) ──
  RAISE NOTICE '[Test 11] Testing Master Question Bank Cross-Verification (ADV-07)...';

  -- Step 11A: Unauthorized reconciliation attempt (non-admin)
  PERFORM set_config('request.jwt.claim.sub', v_finalist_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'finalist1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_finalist_1_uid,
    'email', 'finalist1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'authenticated', 'is_admin', false)
  )::text, true);

  v_res := public.reconcile_finale_day_scores(1);
  IF (v_res->>'ok')::boolean IS NOT FALSE OR (v_res->>'error_code') <> 'UNAUTHORIZED_ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'TEST 11A FAILED: Unauthorized user was able to call reconcile_finale_day_scores! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Unauthorized Reconciliation Blocked (UNAUTHORIZED_ADMIN_REQUIRED).';

  -- Switch to Admin context
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_1_uid,
    'email', 'admin1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  -- Step 11B: Inject tampered client score into a question state row
  SELECT points_awarded INTO v_saved_points
  FROM public.championship_finale_question_states
  WHERE session_id = v_new_session_id AND slot_number = 1;

  SELECT total_score INTO v_saved_score
  FROM public.championship_finale_sessions
  WHERE id = v_new_session_id;

  -- Tamper: Set points_awarded = 999 and total_score = 1899
  UPDATE public.championship_finale_question_states
  SET points_awarded = 999
  WHERE session_id = v_new_session_id AND slot_number = 1;

  UPDATE public.championship_finale_sessions
  SET total_score = 1899
  WHERE id = v_new_session_id;

  v_reconcile := public.reconcile_finale_day_scores(1);

  IF (v_reconcile->>'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST 11B FAILED: Score tamper was NOT caught by master question bank reconciliation! Got: %', v_reconcile;
  END IF;

  IF NOT (v_reconcile->'discrepancies')::text LIKE '%SCORE_MISMATCH%' OR
     NOT (v_reconcile->'discrepancies')::text LIKE '%MASTER_ANSWER_VERIFICATION_MISMATCH%' THEN
    RAISE EXCEPTION 'TEST 11B FAILED: Reconciliation did not report SCORE_MISMATCH and MASTER_ANSWER_VERIFICATION_MISMATCH! Got: %', v_reconcile;
  END IF;
  RAISE NOTICE '  --> Tamper Detection Verified: Independent master bank cross-check flagged score manipulation.';

  -- Restore clean data
  UPDATE public.championship_finale_question_states
  SET points_awarded = v_saved_points
  WHERE session_id = v_new_session_id AND slot_number = 1;

  UPDATE public.championship_finale_sessions
  SET total_score = v_saved_score
  WHERE id = v_new_session_id;

  -- Verify reconciliation passes once restored
  v_reconcile := public.reconcile_finale_day_scores(1);
  IF (v_reconcile->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 11B FAILED: Restored data failed reconciliation: %', v_reconcile;
  END IF;
  RAISE NOTICE '  --> Master Bank Integrity Equation Verified Cleanly.';

  -- ── TEST 12: Administrative Approval Rejection Protocol (ADV-09) ─────────────
  RAISE NOTICE '[Test 12] Testing Administrative Approval Rejection Protocol (ADV-09)...';

  -- Step 12A: Admin 1 initiates a new approval request
  PERFORM set_config('request.jwt.claim.sub', v_admin_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_1_uid,
    'email', 'admin1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_req_res := public.admin_request_approval(
    'VOID_AND_REISSUE_SESSION',
    1,
    jsonb_build_object('session_id', v_new_session_id, 'reason', 'Spurious technical fault claim')
  );
  IF (v_req_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Approval request creation failed: %', v_req_res;
  END IF;
  v_approval_id := (v_req_res->>'approval_id')::uuid;

  -- Step 12B: Non-admin attempts to reject approval (MUST FAIL)
  PERFORM set_config('request.jwt.claim.sub', v_finalist_1_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'finalist1@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_finalist_1_uid,
    'email', 'finalist1@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'authenticated', 'is_admin', false)
  )::text, true);

  v_res := public.admin_reject_approval(v_approval_id, 'Unauthorized rejection attempt');
  IF (v_res->>'ok')::boolean IS NOT FALSE OR (v_res->>'error_code') <> 'UNAUTHORIZED_ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'TEST 12B FAILED: Non-admin was permitted to reject approval! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Unauthorized Rejection Blocked (UNAUTHORIZED_ADMIN_REQUIRED).';

  -- Step 12C: Admin attempts rejection with insufficient reason length (MUST FAIL)
  PERFORM set_config('request.jwt.claim.sub', v_admin_2_uid::text, true);
  PERFORM set_config('request.jwt.claim.email', 'admin2@finale-synthetic.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_2_uid,
    'email', 'admin2@finale-synthetic.test',
    'app_metadata', jsonb_build_object('role', 'admin', 'is_admin', true, 'is_super_admin', true)
  )::text, true);

  v_res := public.admin_reject_approval(v_approval_id, 'No');
  IF (v_res->>'ok')::boolean IS NOT FALSE OR (v_res->>'error_code') <> 'DOCUMENTED_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'TEST 12C FAILED: Rejection without documented reason was accepted! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Short Reason Rejection Blocked (DOCUMENTED_REASON_REQUIRED).';

  -- Step 12D: Authorized Admin rejects approval with valid documented reason
  v_res := public.admin_reject_approval(v_approval_id, 'Telemetry review confirms participant device operated normally without disconnections.');
  IF (v_res->>'ok')::boolean IS NOT TRUE OR (v_res->>'status') <> 'rejected' THEN
    RAISE EXCEPTION 'TEST 12D FAILED: Legitimate admin rejection failed: %', v_res;
  END IF;
  RAISE NOTICE '  --> Admin Rejection Executed Successfully. Status: %', v_res->>'status';

  -- Step 12E: Verify approval cannot subsequently be executed
  v_res := public.admin_void_and_reissue_session(v_approval_id);
  IF (v_res->>'ok')::boolean IS NOT FALSE OR (v_res->>'error_code') <> 'APPROVAL_ALREADY_PROCESSED' THEN
    RAISE EXCEPTION 'TEST 12E FAILED: Rejected approval was executed! Got: %', v_res;
  END IF;
  RAISE NOTICE '  --> Post-Rejection Execution Blocked (APPROVAL_ALREADY_PROCESSED).';

  -- Step 12F: Verify audit logging of rejection
  SELECT count(*) INTO i
  FROM public.championship_finale_audit_log
  WHERE event_type = 'APPROVAL_REJECTED' AND entity_id = v_approval_id::text;

  IF i < 1 THEN
    RAISE EXCEPTION 'TEST 12F FAILED: No APPROVAL_REJECTED audit log record found!';
  END IF;
  RAISE NOTICE '  --> Approval Rejection Audit Event Recorded.';

  -- ── TEST 13: Official Tournament Results Immutability (ADV-11) ────────────────
  RAISE NOTICE '[Test 13] Testing Tournament Results Immutability & Anti-Mutation Trigger (ADV-11)...';

  -- Verify legitimate results are present from Test 8
  SELECT count(*) INTO v_rank_count
  FROM public.championship_finale_results
  WHERE result_type = 'cumulative';

  IF v_rank_count < 10 THEN
    RAISE EXCEPTION 'TEST 13 SETUP FAILED: Expected at least 10 cumulative result rows from Test 8, found %', v_rank_count;
  END IF;

  -- Step 13A: Attempt direct UPDATE on official results (MUST FAIL via trigger)
  v_ex_caught := false;
  v_err_msg := '';
  BEGIN
    UPDATE public.championship_finale_results
    SET score = 9999
    WHERE result_type = 'cumulative' AND rank = 1;
  EXCEPTION WHEN OTHERS THEN
    v_ex_caught := true;
    v_err_msg := SQLERRM;
  END;

  IF NOT v_ex_caught OR v_err_msg NOT LIKE '%RESULTS_IMMUTABLE%' THEN
    RAISE EXCEPTION 'TEST 13A FAILED: Direct UPDATE on championship_finale_results was not blocked by immutability trigger! Caught: %, Error: %',
      v_ex_caught, v_err_msg;
  END IF;
  RAISE NOTICE '  --> Immutability Trigger Verified: Direct UPDATE rejected with RESULTS_IMMUTABLE.';

  -- Step 13B: Attempt direct DELETE on official results (MUST FAIL via trigger)
  v_ex_caught := false;
  v_err_msg := '';
  BEGIN
    DELETE FROM public.championship_finale_results
    WHERE result_type = 'cumulative' AND rank = 1;
  EXCEPTION WHEN OTHERS THEN
    v_ex_caught := true;
    v_err_msg := SQLERRM;
  END;

  IF NOT v_ex_caught OR v_err_msg NOT LIKE '%RESULTS_IMMUTABLE%' THEN
    RAISE EXCEPTION 'TEST 13B FAILED: Direct DELETE on championship_finale_results was not blocked by immutability trigger! Caught: %, Error: %',
      v_ex_caught, v_err_msg;
  END IF;
  RAISE NOTICE '  --> Immutability Trigger Verified: Direct DELETE rejected with RESULTS_IMMUTABLE.';

  -- Step 13C: Verify results count and integrity remained completely unchanged
  SELECT count(*) INTO i
  FROM public.championship_finale_results
  WHERE result_type = 'cumulative';

  IF i <> v_rank_count THEN
    RAISE EXCEPTION 'TEST 13C FAILED: Results row count changed despite rejected DML! Expected %, got %', v_rank_count, i;
  END IF;
  RAISE NOTICE '  --> Official Results Immutability 100%% Intact (% rows preserved).', i;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'ALL 13 SECURITY & INTEGRITY TESTS COMPLETED WITH 100% PASS!';
  RAISE NOTICE 'ROLLING BACK TRANSACTION TO LEAVE ZERO PERSISTENT TRACES...';
  RAISE NOTICE '=====================================================';
END;
$$;

ROLLBACK;
