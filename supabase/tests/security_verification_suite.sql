-- ==============================================================================
-- Test Suite: security_verification_suite.sql
-- Description:
--   Comprehensive database security verification suite covering:
--     1. Actual PostgreSQL Role Privileges (has_function_privilege & runtime 42501)
--     2. Genuine Row Level Security (RLS) isolation tested as non-superuser roles
--        on championship_registrations AND championship_pulse_attempts
--     3. Direct Table Mutation Lockdown on championship_pulse_attempts
--     4. Anti-Tampering Database Triggers
--     5. Application Authorization & Business Logic (The 20 Mandatory Scenarios)
--     6. Transaction Isolation with 100% ROLLBACK
--
-- Target Migrations:
--   - 20261002_editable_student_details_and_mandatory_registration.sql
--   - 20261003_secure_pulse_attempts_least_privilege.sql
--
-- Safety Notice:
--   DO NOT EXECUTE AGAINST PRODUCTION.
--   Run only against a clean, dedicated staging database.
--   Terminates with ROLLBACK to leave 0 persistent test data.
-- ==============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 0: PRIVILEGED FIXTURE SETUP (SUPERUSER / SERVICE_ROLE CONTEXT)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_active_college_1_id uuid;
  v_active_college_2_id uuid;
  v_inactive_college_id uuid;
  
  v_victim_user_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_attacker_user_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  v_unregistered_user_id uuid := '33333333-3333-3333-3333-333333333333'::uuid;
  v_pending_user_id uuid := '44444444-4444-4444-4444-444444444444'::uuid;
  v_removed_user_id uuid := '55555555-5555-5555-5555-555555555555'::uuid;
  v_admin_user_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  
  v_check_count integer;
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'INITIALIZING TEST FIXTURES IN ISOLATED TRANSACTION';
  RAISE NOTICE '=====================================================';

  -- 1. Pre-flight Overload Check: submit_pulse_attempt_atomic must have exactly 1 signature (13 parameters)
  SELECT count(*) INTO v_check_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'submit_pulse_attempt_atomic';

  IF v_check_count != 1 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: Expected exactly 1 active overload of submit_pulse_attempt_atomic, found %', v_check_count;
  END IF;

  -- 2. Seed auth.users with synthetic test accounts to satisfy foreign keys and admin checks
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_victim_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'victim@medtrail.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_attacker_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student@medtrail.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_unregistered_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unregistered@medtrail.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_pending_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending@medtrail.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_removed_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'removed@medtrail.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_admin_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'samarthrautrao715@gmail.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- 3. Seed Colleges
  SELECT id INTO v_active_college_1_id
  FROM public.medical_colleges
  WHERE active = true
  ORDER BY created_at ASC LIMIT 1;

  SELECT id INTO v_active_college_2_id
  FROM public.medical_colleges
  WHERE active = true AND id != v_active_college_1_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_active_college_1_id IS NULL THEN
    INSERT INTO public.medical_colleges (college_name, city, active)
    VALUES ('AIIMS New Delhi Test College', 'New Delhi', true)
    RETURNING id INTO v_active_college_1_id;
  END IF;

  IF v_active_college_2_id IS NULL THEN
    INSERT INTO public.medical_colleges (college_name, city, active)
    VALUES ('Grant Medical College Test', 'Mumbai', true)
    RETURNING id INTO v_active_college_2_id;
  END IF;

  INSERT INTO public.medical_colleges (college_name, city, active)
  VALUES ('Defunct Closed Medical Institute', 'Nowhere', false)
  RETURNING id INTO v_inactive_college_id;

  -- 4. Seed Published Pulse Set
  INSERT INTO public.championship_pulse_sets (id, pulse_date, status, questions)
  VALUES ('77777777-7777-7777-7777-777777777777'::uuid, '2026-10-02'::date, 'published', '[]'::jsonb)
  ON CONFLICT (pulse_date) DO UPDATE SET status = 'published';

  -- 5. Seed Baseline Registrations (as trusted service_role)
  INSERT INTO public.championship_registrations (
    id, user_id, full_name, email, medical_college, medical_college_id, batch, approval_status
  ) VALUES (
    '10000000-0000-0000-0000-000000000001'::uuid,
    v_victim_user_id, 'Dr. Victim Student', 'victim@medtrail.test',
    'AIIMS New Delhi Test College', v_active_college_1_id, '2026 Batch → Freshers', 'approved'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.championship_registrations (
    id, user_id, full_name, email, medical_college, medical_college_id, batch, approval_status
  ) VALUES (
    '10000000-0000-0000-0000-000000000002'::uuid,
    v_pending_user_id, 'Dr. Pending Student', 'pending@medtrail.test',
    'AIIMS New Delhi Test College', v_active_college_1_id, '2026 Batch → Freshers', 'pending'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.championship_registrations (
    id, user_id, full_name, email, medical_college, medical_college_id, batch, approval_status
  ) VALUES (
    '10000000-0000-0000-0000-000000000003'::uuid,
    v_removed_user_id, 'Dr. Removed Student', 'removed@medtrail.test',
    'AIIMS New Delhi Test College', v_active_college_1_id, '2026 Batch → Freshers', 'removed'
  ) ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE '✓ FIXTURES INITIALIZED SUCCESSFULLY';
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1: ACTUAL POSTGRESQL ROLE PRIVILEGE CHECKS (SQLSTATE 42501 ENFORCEMENT)
-- ══════════════════════════════════════════════════════════════════════════════
-- Static catalog grants & effective runtime checks using boolean flag isolation:
-- assertions happen OUTSIDE exception blocks so failure exceptions cannot be caught.

-- ── 1.1 Verification of anon role privilege restrictions ───────────────────────
SET LOCAL ROLE anon;

DO $$
DECLARE
  v_blocked boolean;
  v_caught_state text;
  v_caught_msg text;
BEGIN
  -- Test 1.1a-d: has_function_privilege checks on protected RPCs
  IF has_function_privilege('anon', 'public.admin_update_registration_status(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 1.1a FAILED: PostgreSQL catalogue grants EXECUTE on admin_update_registration_status to anon!';
  END IF;

  IF has_function_privilege('anon', 'public.admin_delete_registration(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 1.1b FAILED: PostgreSQL catalogue grants EXECUTE on admin_delete_registration to anon!';
  END IF;

  IF has_function_privilege('anon', 'public.update_student_registration(uuid, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 1.1c FAILED: PostgreSQL catalogue grants EXECUTE on update_student_registration to anon!';
  END IF;

  IF has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST 1.1d FAILED: PostgreSQL catalogue grants EXECUTE on is_admin to anon!';
  END IF;

  RAISE NOTICE '✓ TEST 1.1 PASSED: PostgreSQL catalogue confirms ZERO execute grants for anon on protected RPCs.';

  -- Runtime Test 1.1e: anon calling admin_update_registration_status MUST fail with 42501
  v_blocked := false;
  BEGIN
    PERFORM public.admin_update_registration_status(gen_random_uuid(), 'approved');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL SECURITY BREACH: anon role executed admin_update_registration_status without error!';
  ELSIF v_caught_state != '42501' THEN
    RAISE EXCEPTION 'TEST 1.1e FAILED: Expected SQLSTATE 42501, got % (%)', v_caught_state, v_caught_msg;
  ELSE
    RAISE NOTICE '✓ TEST 1.1e PASSED: PostgreSQL runtime blocked anon EXECUTE with SQLSTATE 42501 (insufficient_privilege).';
  END IF;

  -- Runtime Test 1.1f: anon calling update_student_registration MUST fail with 42501
  v_blocked := false;
  BEGIN
    PERFORM public.update_student_registration(gen_random_uuid(), '2026 Batch → Freshers');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL SECURITY BREACH: anon role executed update_student_registration without error!';
  ELSIF v_caught_state != '42501' THEN
    RAISE EXCEPTION 'TEST 1.1f FAILED: Expected SQLSTATE 42501, got % (%)', v_caught_state, v_caught_msg;
  ELSE
    RAISE NOTICE '✓ TEST 1.1f PASSED: PostgreSQL runtime blocked anon EXECUTE on student RPC with SQLSTATE 42501.';
  END IF;

  -- Test 1.1g: anon direct INSERT on championship_pulse_attempts MUST fail with 42501
  v_blocked := false;
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id, pulse_date, user_id, student_name, college, batch, score, accuracy, time_taken_seconds, xp
    ) VALUES (
      '77777777-7777-7777-7777-777777777777', '2026-10-02', 'anon_user', 'Anon Hacker', 'Fake', '2026', 100, 100, 10, 100
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL SECURITY BREACH: anon role performed direct INSERT into championship_pulse_attempts!';
  ELSIF v_caught_state != '42501' THEN
    RAISE EXCEPTION 'TEST 1.1g FAILED: Expected SQLSTATE 42501, got % (%)', v_caught_state, v_caught_msg;
  ELSE
    RAISE NOTICE '✓ TEST 1.1g PASSED: PostgreSQL runtime blocked anon direct INSERT on championship_pulse_attempts with SQLSTATE 42501.';
  END IF;
END;
$$;

RESET ROLE;

-- ── 1.2 Verification of table privileges for authenticated role ────────────────
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_blocked boolean;
  v_caught_state text;
  v_caught_msg text;
BEGIN
  -- Test 1.2a-b: has_table_privilege checks on championship_registrations
  IF has_table_privilege('authenticated', 'public.championship_registrations', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST 1.2a FAILED: PostgreSQL catalogue grants direct UPDATE on championship_registrations to authenticated!';
  END IF;

  IF has_table_privilege('authenticated', 'public.championship_registrations', 'DELETE') THEN
    RAISE EXCEPTION 'TEST 1.2b FAILED: PostgreSQL catalogue grants direct DELETE on championship_registrations to authenticated!';
  END IF;

  -- Runtime Test 1.2c: direct UPDATE on championship_registrations MUST fail with 42501
  v_blocked := false;
  BEGIN
    UPDATE public.championship_registrations 
    SET approval_status = 'approved'
    WHERE id = '10000000-0000-0000-0000-000000000001'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL SECURITY BREACH: authenticated role performed direct UPDATE on championship_registrations!';
  ELSIF v_caught_state != '42501' THEN
    RAISE EXCEPTION 'TEST 1.2c FAILED: Expected SQLSTATE 42501, got % (%)', v_caught_state, v_caught_msg;
  ELSE
    RAISE NOTICE '✓ TEST 1.2c PASSED: PostgreSQL runtime blocked direct UPDATE on championship_registrations with SQLSTATE 42501.';
  END IF;

  -- Runtime Test 1.2d: direct INSERT on championship_pulse_attempts MUST fail with 42501 (Least-Privilege Enforcement)
  v_blocked := false;
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id, pulse_date, user_id, student_name, college, batch, score, accuracy, time_taken_seconds, xp
    ) VALUES (
      '77777777-7777-7777-7777-777777777777', '2026-10-02', '11111111-1111-1111-1111-111111111111', 'Bypasser', 'Fake', '2026', 9999, 100, 10, 100
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL SECURITY BREACH: authenticated role performed direct INSERT into championship_pulse_attempts!';
  ELSIF v_caught_state != '42501' THEN
    RAISE EXCEPTION 'TEST 1.2d FAILED: Expected SQLSTATE 42501 on direct attempt insert, got % (%)', v_caught_state, v_caught_msg;
  ELSE
    RAISE NOTICE '✓ TEST 1.2d PASSED: PostgreSQL blocked direct INSERT on championship_pulse_attempts with SQLSTATE 42501 (bypasses eliminated).';
  END IF;
END;
$$;

RESET ROLE;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2: ROW LEVEL SECURITY (RLS) UNDER REAL NON-SUPERUSER ROLES
-- ══════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_visible_count integer;
  v_cross_student_count integer;
  v_victim_user_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_attacker_user_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  -- Authenticate as Student 1 (Victim)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_victim_user_id::text,
    'email', 'victim@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_victim_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'victim@medtrail.test', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test 2.1: Student 1 must see EXACTLY 1 row (their own) under RLS on championship_registrations
  SELECT count(*) INTO v_visible_count FROM public.championship_registrations;
  IF v_visible_count = 1 THEN
    RAISE NOTICE '✓ TEST 2.1 PASSED: Student 1 sees exactly their own registration under RLS (count = 1).';
  ELSE
    RAISE EXCEPTION 'TEST 2.1 FAILED: RLS leaked rows! Student 1 sees % rows (expected 1)', v_visible_count;
  END IF;

  -- Test 2.2: Student 1 cannot query other students registrations
  SELECT count(*) INTO v_cross_student_count 
  FROM public.championship_registrations 
  WHERE id IN ('10000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000003'::uuid);

  IF v_cross_student_count = 0 THEN
    RAISE NOTICE '✓ TEST 2.2 PASSED: Student 1 cannot read other students registrations under RLS (count = 0).';
  ELSE
    RAISE EXCEPTION 'TEST 2.2 FAILED: Cross-student registration data leak! Visible rows: %', v_cross_student_count;
  END IF;

  -- Switch context to Student 2 (Attacker) who has no registration
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_attacker_user_id::text,
    'email', 'student@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_attacker_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'student@medtrail.test', true);

  -- Test 2.3: Student 2 sees 0 rows under RLS
  SELECT count(*) INTO v_visible_count FROM public.championship_registrations;
  IF v_visible_count = 0 THEN
    RAISE NOTICE '✓ TEST 2.3 PASSED: Student 2 without registration sees 0 rows under RLS.';
  ELSE
    RAISE EXCEPTION 'TEST 2.3 FAILED: Student 2 saw rows under RLS! Count: %', v_visible_count;
  END IF;
END;
$$;

RESET ROLE;

SET LOCAL ROLE anon;

DO $$
DECLARE
  v_anon_reg_count integer;
  v_anon_att_count integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  -- Test 2.4a: Anonymous caller MUST see 0 rows from championship_registrations under RLS
  SELECT count(*) INTO v_anon_reg_count FROM public.championship_registrations;
  IF v_anon_reg_count = 0 THEN
    RAISE NOTICE '✓ TEST 2.4a PASSED: Anonymous caller sees 0 rows from championship_registrations under RLS.';
  ELSE
    RAISE EXCEPTION 'TEST 2.4a FAILED: Anonymous caller viewed % registration rows under RLS!', v_anon_reg_count;
  END IF;

  -- Test 2.4b: Anonymous caller MUST see 0 rows from championship_pulse_attempts (Raw Exam Data Shielded)
  -- If table grant is revoked, SELECT fails with 42501; if granted, RLS returns 0 rows.
  BEGIN
    SELECT count(*) INTO v_anon_att_count FROM public.championship_pulse_attempts;
    IF v_anon_att_count = 0 THEN
      RAISE NOTICE '✓ TEST 2.4b PASSED: Anonymous caller sees 0 raw pulse attempts under RLS.';
    ELSE
      RAISE EXCEPTION 'TEST 2.4b FAILED: Anonymous caller viewed % raw attempt rows!', v_anon_att_count;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '✓ TEST 2.4b PASSED: Anonymous caller blocked from championship_pulse_attempts with SQLSTATE 42501.';
  END;
END;
$$;

RESET ROLE;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_admin_count integer;
  v_admin_user_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
BEGIN
  -- Authenticate as Super Admin
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_admin_user_id::text,
    'email', 'samarthrautrao715@gmail.com',
    'role', 'authenticated',
    'email_verified', true
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'samarthrautrao715@gmail.com', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test 2.5: Admin MUST be able to view all rows under RLS
  SELECT count(*) INTO v_admin_count FROM public.championship_registrations;
  IF v_admin_count >= 3 THEN
    RAISE NOTICE '✓ TEST 2.5 PASSED: Admin correctly views all registrations under RLS (count = %).', v_admin_count;
  ELSE
    RAISE EXCEPTION 'TEST 2.5 FAILED: Admin was restricted by RLS! Count: %', v_admin_count;
  END IF;
END;
$$;

RESET ROLE;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3: APPLICATION AUTHORIZATION & RPC LOGIC (THE 20 MANDATORY TESTS)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_active_college_1_id uuid;
  v_active_college_2_id uuid;
  v_inactive_college_id uuid;
  
  v_victim_user_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_attacker_user_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  v_unregistered_user_id uuid := '33333333-3333-3333-3333-333333333333'::uuid;
  v_pending_user_id uuid := '44444444-4444-4444-4444-444444444444'::uuid;
  v_removed_user_id uuid := '55555555-5555-5555-5555-555555555555'::uuid;
  v_admin_user_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  
  v_victim_reg_id uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_pending_reg_id uuid := '10000000-0000-0000-0000-000000000002'::uuid;
  v_removed_reg_id uuid := '10000000-0000-0000-0000-000000000003'::uuid;
  v_attacker_reg_id uuid;
  
  v_res jsonb;
  v_status_check text;
  v_user_id_check uuid;
  v_historical_score numeric;
  v_historical_college text;
  v_leaderboard_college text;
  v_leaderboard_batch text;
  v_is_admin_result boolean;
  v_blocked boolean;
  v_caught_state text;
  v_caught_msg text;
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'EXECUTING 20 MANDATORY AUTHORIZATION & RPC LOGIC TESTS';
  RAISE NOTICE '=====================================================';

  SELECT id INTO v_active_college_1_id FROM public.medical_colleges WHERE active = true ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_active_college_2_id FROM public.medical_colleges WHERE active = true AND id != v_active_college_1_id ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_inactive_college_id FROM public.medical_colleges WHERE active = false LIMIT 1;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.1: Authenticated normal student calling admin RPCs is rejected with {success:false}
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_attacker_user_id::text,
    'email', 'student@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_attacker_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', 'student@medtrail.test', true);

  v_res := public.admin_update_registration_status(gen_random_uuid(), 'approved');
  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'error') LIKE '%Unauthorized%' THEN
    RAISE NOTICE '✓ TEST 3.1 PASSED: Normal student calling admin_update_registration_status strictly rejected with {success:false}.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.1 FAILED: Normal student was not blocked! Result: %', v_res;
  END IF;

  v_res := public.admin_delete_registration(gen_random_uuid());
  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'error') LIKE '%Unauthorized%' THEN
    RAISE NOTICE '✓ TEST 3.1b PASSED: Normal student calling admin_delete_registration strictly rejected with {success:false}.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.1b FAILED: Normal student was not blocked! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.2: Student cannot self-approve; trigger forces "pending" and binds auth.uid()
  -- ─────────────────────────────────────────────────────────────────────────────
  INSERT INTO public.championship_registrations (
    full_name, email, medical_college, medical_college_id, batch, approval_status
  ) VALUES (
    'Dr. Self Approver', 'student@medtrail.test', 'AIIMS Test College', v_active_college_1_id, '2026 Batch → Freshers', 'approved'
  ) RETURNING id INTO v_attacker_reg_id;

  SELECT approval_status, user_id INTO v_status_check, v_user_id_check
  FROM public.championship_registrations
  WHERE id = v_attacker_reg_id;

  IF v_status_check = 'pending' AND v_user_id_check = v_attacker_user_id THEN
    RAISE NOTICE '✓ TEST 3.2 PASSED: Student self-approval attempt defeated: status forced to "pending", user_id bound to auth.uid().';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.2 FAILED: Student was able to self-approve! status=%, user_id=%', v_status_check, v_user_id_check;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.3: Cross-student registration edit strictly rejected
  -- ─────────────────────────────────────────────────────────────────────────────
  v_res := public.update_student_registration(
    v_active_college_2_id,
    '2024 Batch → 2nd Year MBBS',
    v_victim_reg_id
  );

  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'message') LIKE '%Unauthorized%' THEN
    RAISE NOTICE '✓ TEST 3.3 PASSED: Cross-student registration edit strictly rejected with {success:false}.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.3 FAILED: Cross-student registration edit was not blocked! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.4: Permitted college/batch updates for self
  -- ─────────────────────────────────────────────────────────────────────────────
  -- 3.4a: Approved student updates own details
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_victim_user_id::text,
    'email', 'victim@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_victim_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'victim@medtrail.test', true);

  v_res := public.update_student_registration(
    v_active_college_2_id,
    '2025 Batch → 1st Year MBBS'
  );

  IF (v_res->>'success')::boolean IS TRUE AND (v_res->>'batch') = '2025 Batch → 1st Year MBBS' THEN
    RAISE NOTICE '✓ TEST 3.4a PASSED: Approved student successfully updated own college and batch.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.4a FAILED: Approved student could not update own details! Result: %', v_res;
  END IF;

  -- 3.4b: Pending student updates own details (permitted to fix typos before approval; status stays pending)
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_pending_user_id::text,
    'email', 'pending@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_pending_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'pending@medtrail.test', true);

  v_res := public.update_student_registration(
    v_active_college_2_id,
    '2024 Batch → 2nd Year MBBS'
  );

  SELECT approval_status INTO v_status_check
  FROM public.championship_registrations WHERE id = v_pending_reg_id;

  IF (v_res->>'success')::boolean IS TRUE AND v_status_check = 'pending' THEN
    RAISE NOTICE '✓ TEST 3.4b PASSED: Pending student updated own details without status changing from pending.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.4b FAILED: Pending student edit failed or status was altered! Result: %, status: %', v_res, v_status_check;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.5: Inactive and non-existent college IDs rejected
  -- ─────────────────────────────────────────────────────────────────────────────
  v_res := public.update_student_registration(v_inactive_college_id, '2026 Batch → Freshers');
  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'error') LIKE '%inactive%' THEN
    RAISE NOTICE '✓ TEST 3.5a PASSED: Inactive college ID strictly rejected.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.5a FAILED: Inactive college ID accepted! Result: %', v_res;
  END IF;

  v_res := public.update_student_registration('00000000-0000-0000-0000-000000000000'::uuid, '2026 Batch → Freshers');
  IF (v_res->>'success')::boolean IS FALSE THEN
    RAISE NOTICE '✓ TEST 3.5b PASSED: Non-existent college ID strictly rejected.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.5b FAILED: Non-existent college ID accepted! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.6: Invalid admission years/batches rejected
  -- ─────────────────────────────────────────────────────────────────────────────
  v_res := public.update_student_registration(v_active_college_1_id, '2018 Batch → Alumni');
  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'error') LIKE '%Invalid admission year%' THEN
    RAISE NOTICE '✓ TEST 3.6 PASSED: Invalid admission year/batch strictly rejected.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.6 FAILED: Invalid batch accepted! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.7: Pending registration cannot submit Pulse
  -- ─────────────────────────────────────────────────────────────────────────────
  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_pending_user_id::text, 'pending@medtrail.test', 'Dr. Pending',
    'AIIMS Test College', '2026 Batch → Freshers', 100, 100.0, 30, 150, '[]'::jsonb
  );

  IF (v_res->>'not_registered')::boolean IS TRUE AND (v_res->>'error') LIKE '%pending approval%' THEN
    RAISE NOTICE '✓ TEST 3.7 PASSED: Pending registration cannot submit Pulse.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.7 FAILED: Pending student was permitted to submit pulse! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.8: Removed registration cannot submit Pulse and cannot edit registration
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_removed_user_id::text,
    'email', 'removed@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_removed_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'removed@medtrail.test', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_removed_user_id::text, 'removed@medtrail.test', 'Dr. Removed',
    'AIIMS Test College', '2026 Batch → Freshers', 100, 100.0, 30, 150, '[]'::jsonb
  );

  IF (v_res->>'not_registered')::boolean IS TRUE AND (v_res->>'error') LIKE '%removed or suspended%' THEN
    RAISE NOTICE '✓ TEST 3.8a PASSED: Removed registration cannot submit Pulse.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.8a FAILED: Removed student was permitted to submit pulse! Result: %', v_res;
  END IF;

  v_res := public.update_student_registration(v_active_college_1_id, '2026 Batch → Freshers');
  IF (v_res->>'success')::boolean IS FALSE AND (v_res->>'error') LIKE '%removed or suspended%' THEN
    RAISE NOTICE '✓ TEST 3.8b PASSED: Removed registration cannot edit college or batch.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.8b FAILED: Removed student was permitted to edit registration! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.9: Unregistered authenticated user cannot submit Pulse
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_unregistered_user_id::text,
    'email', 'unregistered@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_unregistered_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'unregistered@medtrail.test', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_unregistered_user_id::text, 'unregistered@medtrail.test', 'Unregistered Doctor',
    'AIIMS Test College', '2026 Batch → Freshers', 100, 100.0, 30, 150, '[]'::jsonb
  );

  IF (v_res->>'not_registered')::boolean IS TRUE AND (v_res->>'error') LIKE '%You must register%' THEN
    RAISE NOTICE '✓ TEST 3.9 PASSED: Unregistered authenticated user cannot submit Pulse.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.9 FAILED: Unregistered user submitted pulse! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.10: Anonymous caller cannot submit Pulse
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    NULL, NULL, 'Anon Doctor', 'AIIMS Test College', '2026 Batch → Freshers', 100, 100.0, 30, 150, '[]'::jsonb
  );

  IF (v_res->>'not_registered')::boolean IS TRUE AND (v_res->>'error') LIKE '%You must register%' THEN
    RAISE NOTICE '✓ TEST 3.10 PASSED: Anonymous user cannot submit Pulse.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.10 FAILED: Anonymous user submitted pulse! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.11: Approved student can submit a valid attempt atomically
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_victim_user_id::text,
    'email', 'victim@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_victim_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'victim@medtrail.test', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_victim_user_id::text, 'victim@medtrail.test', 'Dr. Victim Student',
    'Grant Medical College Test', '2025 Batch → 1st Year MBBS', 90, 90.0, 45, 140, '[]'::jsonb
  );

  IF (v_res->>'success')::boolean IS TRUE AND (v_res->>'attempt_id') IS NOT NULL THEN
    RAISE NOTICE '✓ TEST 3.11 PASSED: Approved student successfully submitted a valid attempt.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.11 FAILED: Approved student attempt failed! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.12: Forged p_user_id and p_user_email parameters ignored; identity tied to auth context
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_attacker_user_id::text,
    'email', 'student@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_attacker_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'student@medtrail.test', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_victim_user_id::text, 'victim@medtrail.test', 'Impersonator',
    'AIIMS Test College', '2026 Batch → Freshers', 100, 100.0, 20, 200, '[]'::jsonb
  );

  IF (v_res->>'not_registered')::boolean IS TRUE AND (v_res->>'error') LIKE '%pending approval%' THEN
    RAISE NOTICE '✓ TEST 3.12 PASSED: Forged parameters ignored; identity strictly resolved from caller auth context.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.12 FAILED: Identity spoofing was not defeated! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.13: Duplicate attempt for same pulse blocked
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_victim_user_id::text,
    'email', 'victim@medtrail.test',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_victim_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'victim@medtrail.test', true);

  v_res := public.submit_pulse_attempt_atomic(
    '77777777-7777-7777-7777-777777777777', '2026-10-02',
    v_victim_user_id::text, 'victim@medtrail.test', 'Dr. Victim Student',
    'Grant Medical College Test', '2025 Batch → 1st Year MBBS', 100, 100.0, 20, 200, '[]'::jsonb
  );

  IF (v_res->>'already_submitted')::boolean IS TRUE THEN
    RAISE NOTICE '✓ TEST 3.13 PASSED: Duplicate attempt for same pulse correctly blocked.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.13 FAILED: Duplicate submission bypassed one-attempt rule! Result: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.14: Historical attempt in championship_pulse_attempts immutable
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT score, college INTO v_historical_score, v_historical_college
  FROM public.championship_pulse_attempts
  WHERE user_id = v_victim_user_id::text AND pulse_id = '77777777-7777-7777-7777-777777777777';

  -- Student changes college to College 1 and batch to 2026
  v_res := public.update_student_registration(v_active_college_1_id, '2026 Batch → Freshers');

  -- Verify historical attempt row remained unchanged
  SELECT score, college INTO v_status_check, v_leaderboard_college
  FROM public.championship_pulse_attempts
  WHERE user_id = v_victim_user_id::text AND pulse_id = '77777777-7777-7777-7777-777777777777';

  IF v_status_check::numeric = v_historical_score AND v_leaderboard_college = v_historical_college THEN
    RAISE NOTICE '✓ TEST 3.14 PASSED: Historical attempt in championship_pulse_attempts remained immutable.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.14 FAILED: Historical attempt was modified!';
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.15: Dedicated Admin RPCs work for verified administrator
  -- ─────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_admin_user_id::text,
    'email', 'samarthrautrao715@gmail.com',
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'samarthrautrao715@gmail.com', true);

  -- 3.15a: Admin approves pending registration
  v_res := public.admin_update_registration_status(v_pending_reg_id, 'approved');
  IF (v_res->>'success')::boolean IS TRUE THEN
    SELECT approval_status INTO v_status_check FROM public.championship_registrations WHERE id = v_pending_reg_id;
    IF v_status_check = 'approved' THEN
      RAISE NOTICE '✓ TEST 3.15a PASSED: Admin approved registration via admin RPC.';
    ELSE
      RAISE EXCEPTION '✗ TEST 3.15a FAILED: Status was not updated to approved! Status: %', v_status_check;
    END IF;
  ELSE
    RAISE EXCEPTION '✗ TEST 3.15a FAILED: Admin approval RPC failed: %', v_res;
  END IF;

  -- 3.15b: Admin removes registration
  v_res := public.admin_update_registration_status(v_pending_reg_id, 'removed');
  IF (v_res->>'success')::boolean IS TRUE THEN
    SELECT approval_status INTO v_status_check FROM public.championship_registrations WHERE id = v_pending_reg_id;
    IF v_status_check = 'removed' THEN
      RAISE NOTICE '✓ TEST 3.15b PASSED: Admin removed registration via admin RPC.';
    ELSE
      RAISE EXCEPTION '✗ TEST 3.15b FAILED: Status was not updated to removed!';
    END IF;
  ELSE
    RAISE EXCEPTION '✗ TEST 3.15b FAILED: Admin removal RPC failed: %', v_res;
  END IF;

  -- 3.15c: Admin deletes registration
  v_res := public.admin_delete_registration(v_attacker_reg_id);
  IF (v_res->>'success')::boolean IS TRUE THEN
    IF NOT EXISTS (SELECT 1 FROM public.championship_registrations WHERE id = v_attacker_reg_id) THEN
      RAISE NOTICE '✓ TEST 3.15c PASSED: Admin deleted registration via admin delete RPC.';
    ELSE
      RAISE EXCEPTION '✗ TEST 3.15c FAILED: Registration still exists after delete!';
    END IF;
  ELSE
    RAISE EXCEPTION '✗ TEST 3.15c FAILED: Admin delete RPC failed: %', v_res;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.16: Leaderboard & standings recalculation on registration update
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT college, batch INTO v_leaderboard_college, v_leaderboard_batch
  FROM public.championship_leaderboard
  WHERE user_id = v_victim_user_id::text AND pulse_id = '77777777-7777-7777-7777-777777777777';

  IF v_leaderboard_batch = '2026 Batch → Freshers' THEN
    RAISE NOTICE '✓ TEST 3.16a PASSED: Active leaderboard synchronized to new batch.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.16a FAILED: Active leaderboard not synchronized! batch=%', v_leaderboard_batch;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.championship_college_standings
    WHERE pulse_id = '77777777-7777-7777-7777-777777777777' AND college = v_leaderboard_college
  ) THEN
    RAISE NOTICE '✓ TEST 3.16b PASSED: College standings recalculated.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.16b FAILED: College standings not found!';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.championship_batch_standings
    WHERE pulse_id = '77777777-7777-7777-7777-777777777777' AND batch = '2026 Batch → Freshers'
  ) THEN
    RAISE NOTICE '✓ TEST 3.16c PASSED: Batch standings recalculated.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.16c FAILED: Batch standings not found!';
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.17: Anti-tampering trigger defense-in-depth on protected columns
  -- ─────────────────────────────────────────────────────────────────────────────
  v_blocked := false;
  v_caught_state := NULL;
  v_caught_msg := NULL;

  BEGIN
    UPDATE public.championship_registrations
    SET approval_status = 'approved',
        email = 'hacked@medtrail.test'
    WHERE id = v_victim_reg_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    v_caught_state := SQLSTATE;
    v_caught_msg := SQLERRM;
  END;

  SELECT email INTO v_status_check FROM public.championship_registrations WHERE id = v_victim_reg_id;
  IF v_status_check != 'victim@medtrail.test' THEN
    RAISE EXCEPTION '✗ TEST 3.17 FAILED: Protected column was modified to %!', v_status_check;
  END IF;

  IF NOT v_blocked THEN
    RAISE EXCEPTION '✗ TEST 3.17 FAILED: Direct UPDATE succeeded without error or trigger rejection!';
  END IF;

  RAISE NOTICE '✓ TEST 3.17 PASSED: Protected column modification strictly blocked with error: % (SQLSTATE: %)', v_caught_msg, v_caught_state;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.18: Administrator identification (is_admin) matrix
  -- ─────────────────────────────────────────────────────────────────────────────
  -- 3.18a: Genuine verified super admin email
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_admin_user_id::text,
    'email', 'samarthrautrao715@gmail.com',
    'email_verified', true,
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'samarthrautrao715@gmail.com', true);

  v_is_admin_result := public.is_admin();
  IF v_is_admin_result IS TRUE THEN
    RAISE NOTICE '✓ TEST 3.18a PASSED: is_admin() evaluated TRUE for verified super admin.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.18a FAILED: is_admin() evaluated FALSE for verified super admin!';
  END IF;

  -- 3.18b: Client-side user_metadata spoofing -> MUST BE FALSE
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_attacker_user_id::text,
    'email', 'attacker@medtrail.test',
    'role', 'authenticated',
    'user_metadata', json_build_object('is_admin', true, 'role', 'admin')
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_attacker_user_id::text, true);
  PERFORM set_config('request.jwt.claim.email', 'attacker@medtrail.test', true);

  v_is_admin_result := public.is_admin();
  IF v_is_admin_result IS FALSE THEN
    RAISE NOTICE '✓ TEST 3.18b PASSED: is_admin() evaluated FALSE when attacker attempted user_metadata spoofing.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.18b FAILED: Attacker gained admin privileges via user_metadata!';
  END IF;

  -- 3.18c: Anonymous user -> MUST BE FALSE
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  v_is_admin_result := public.is_admin();
  IF v_is_admin_result IS FALSE THEN
    RAISE NOTICE '✓ TEST 3.18c PASSED: is_admin() evaluated FALSE for anonymous caller.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.18c FAILED: Anonymous user identified as admin!';
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- TEST 3.19: service_role identification matrix
  -- ─────────────────────────────────────────────────────────────────────────────
  -- 3.19a: Genuine service_role caller
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_is_admin_result := public.is_admin();
  IF v_is_admin_result IS TRUE THEN
    RAISE NOTICE '✓ TEST 3.19a PASSED: is_admin() evaluated TRUE for service_role caller.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.19a FAILED: service_role caller not recognized!';
  END IF;

  -- 3.19b: Normal student claiming role = 'service_role' in user_metadata -> MUST BE FALSE
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_attacker_user_id::text,
    'email', 'attacker@medtrail.test',
    'role', 'authenticated',
    'user_metadata', json_build_object('role', 'service_role')
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_attacker_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_is_admin_result := public.is_admin();
  IF v_is_admin_result IS FALSE THEN
    RAISE NOTICE '✓ TEST 3.19b PASSED: Normal student attempting service_role impersonation in user_metadata was strictly rejected.';
  ELSE
    RAISE EXCEPTION '✗ TEST 3.19b FAILED: Ordinary user impersonated service_role!';
  END IF;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'ALL APPLICATION & RPC AUTHORIZATION TESTS COMPLETED!';
  RAISE NOTICE '=====================================================';
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- FINAL ROLLBACK: Ensures 100% database cleanliness after suite execution
-- ══════════════════════════════════════════════════════════════════════════════
ROLLBACK;
