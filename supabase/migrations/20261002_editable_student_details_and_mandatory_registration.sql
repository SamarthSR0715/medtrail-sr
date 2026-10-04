-- ==============================================================================
-- Migration: 20261002_editable_student_details_and_mandatory_registration.sql
-- Description:
--   SECURITY HARDENED CHAMPIONSHIP REGISTRATION & SUBMISSION SYSTEM (FINAL)
--
--   SECURITY AUDIT & HARDENING ENHANCEMENTS:
--     1. Harden public.is_admin() and public.is_super_admin()
--        - Fixed the fatal COALESCE(bool, bool, ...) short-circuit bug.
--        - Implemented explicit branching in PL/pgSQL with robust exception handling.
--        - Strictly checks verified Super Admin email (samarthrautrao715@gmail.com)
--          tied to verified JWT claims and auth.users account ownership.
--        - Validates server-controlled app_metadata without unsafe boolean casts.
--        - Completely ignores client-editable user_metadata.
--        - Handles service_role securely via auth.role() / JWT role without impersonation.
--
--     2. Student-Facing Registration Details Update (update_student_registration)
--        - Only medical_college_id and batch can be updated.
--        - Validates against active entries in public.medical_colleges.
--        - Validates against standard batch conventions (2023, 2024, 2025, 2026).
--        - Authenticates caller using auth.uid(); prevents cross-student edits.
--        - Detects and prevents silent resolution of ambiguous duplicate rows.
--        - Allows pending registrations to correct college/batch; strictly forbids removed ones.
--        - Synchronizes profiles, active leaderboard, and standings without modifying
--          immutable historical attempts (championship_pulse_attempts).
--
--     3. Prevent Student & Anonymous Self-Approval
--        - Default approval_status set to 'pending'.
--        - BEFORE INSERT trigger (trg_enforce_registration_security) unconditionally
--          forces all student and anonymous registrations to 'pending'.
--        - Binds student user_id and email strictly to verified auth context.
--
--     4. Correct Table Privileges Without Breaking Admin Panel
--        - REVOKED UPDATE and DELETE on championship_registrations from authenticated,
--          anon, and public roles. Direct client table updates are completely blocked.
--        - Dedicated admin RPCs (admin_update_registration_status, admin_delete_registration)
--          provided with strict is_admin() checks so the admin panel continues working.
--        - BEFORE UPDATE trigger (trg_prevent_protected_registration_tampering) provides
--          defense-in-depth against unauthorized column modifications.
--
--     5. Strict Registration Approval Before Pulse (submit_pulse_attempt_atomic)
--        - Exact 13-parameter signature matching application call.
--        - Legacy overloads (12-param, 15-param) dropped.
--        - Identity derived strictly from auth.uid() and verified JWT email.
--        - Requires active registration with approval_status = 'approved'.
--        - Rejects anonymous, unregistered, pending, and removed registrations.
--        - Enforces one attempt per user per pulse; handles concurrency with unique violation.
--        - Atomically records attempt, updates active leaderboard, and re-ranks standings.
-- ==============================================================================

BEGIN;

-- ── 1. HARDEN ADMIN IDENTIFICATION FUNCTIONS ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_role text;
  v_jwt_role text;
  v_app_role text;
  v_app_is_admin text;
  v_is_admin_user boolean := false;
BEGIN
  -- 1. Check for trusted service_role caller
  BEGIN
    v_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  BEGIN
    v_jwt_role := auth.jwt() ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_role = 'service_role' OR v_jwt_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- 2. Check authenticated user context
  BEGIN
    v_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Check trusted server-controlled app_metadata in JWT (avoiding unsafe boolean casts)
  BEGIN
    v_app_role := auth.jwt() -> 'app_metadata' ->> 'role';
    v_app_is_admin := auth.jwt() -> 'app_metadata' ->> 'is_admin';
  EXCEPTION WHEN OTHERS THEN
    v_app_role := NULL;
    v_app_is_admin := NULL;
  END;

  IF v_app_role = 'admin' OR lower(trim(coalesce(v_app_is_admin, ''))) IN ('true', 't', '1') THEN
    RETURN true;
  END IF;

  -- 4. Check auth.users table for verified super-admin identity or server-set raw_app_meta_data
  -- Note: We NEVER check user_metadata because users can edit their own user_metadata.
  SELECT EXISTS (
    SELECT 1 
    FROM auth.users u
    WHERE u.id = v_uid
      AND (
        (
          lower(u.email) = 'samarthrautrao715@gmail.com'
          AND lower(coalesce(auth.jwt() ->> 'email', '')) = 'samarthrautrao715@gmail.com'
          AND (
            u.email_confirmed_at IS NOT NULL 
            OR lower(trim(coalesce(auth.jwt() ->> 'email_verified', ''))) IN ('true', 't', '1')
          )
        )
        OR (u.raw_app_meta_data ->> 'role') = 'admin'
        OR lower(trim(coalesce(u.raw_app_meta_data ->> 'is_admin', ''))) IN ('true', 't', '1')
      )
  ) INTO v_is_admin_user;

  RETURN coalesce(v_is_admin_user, false);
END;
$$;

-- Secure is_super_admin() to prevent any legacy policy bypass
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon, public;

-- ── 2. SCHEMA ENHANCEMENTS FOR CHAMPIONSHIP REGISTRATIONS & PROFILES ──────────

-- Add user_id foreign key to championship_registrations if not present
ALTER TABLE public.championship_registrations 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add updated_at to championship_registrations if not present
ALTER TABLE public.championship_registrations 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Default approval_status must be 'pending' so no insert can self-approve by default
ALTER TABLE public.championship_registrations 
  ALTER COLUMN approval_status SET DEFAULT 'pending';

-- Ensure profiles has medical_college_id, college, batch columns
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS college TEXT;

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS batch TEXT;

-- Backfill user_id on championship_registrations from auth.users based on email
UPDATE public.championship_registrations r
SET user_id = u.id
FROM auth.users u
WHERE lower(r.email) = lower(u.email)
  AND r.user_id IS NULL;

-- Indexes for fast identity lookup and status filtering
CREATE INDEX IF NOT EXISTS idx_champ_reg_user_id ON public.championship_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_champ_reg_email_lower ON public.championship_registrations (lower(email));
CREATE INDEX IF NOT EXISTS idx_champ_reg_status ON public.championship_registrations (approval_status);

-- ── 3. DATABASE TRIGGERS FOR REGISTRATION SECURITY & ANTI-TAMPERING ──────────

-- Trigger Function 1: Enforce security rules on INSERT
-- Requirement: Unconditionally force all student-created and anonymous registrations to 'pending'.
CREATE OR REPLACE FUNCTION public.trg_fn_enforce_registration_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  v_is_admin := public.is_admin();

  -- If caller is trusted administrator or service_role, preserve their explicit choice
  IF v_is_service_role OR v_is_admin THEN
    IF NEW.approval_status IS NULL OR NEW.approval_status = '' THEN
      NEW.approval_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  -- FOR ALL ORDINARY REGISTRATIONS (ANONYMOUS OR AUTHENTICATED STUDENTS):
  -- Unconditionally force approval_status to 'pending'. Ordinary users CANNOT self-approve.
  NEW.approval_status := 'pending';

  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
    IF auth.jwt() ->> 'email' IS NOT NULL THEN
      NEW.email := auth.jwt() ->> 'email';
    END IF;
  ELSE
    -- Anonymous caller: user_id must be NULL
    NEW.user_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_registration_security ON public.championship_registrations;
CREATE TRIGGER trg_enforce_registration_security
  BEFORE INSERT ON public.championship_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_enforce_registration_security();

-- Trigger Function 2: Prevent tampering with protected registration columns on UPDATE
CREATE OR REPLACE FUNCTION public.trg_fn_prevent_protected_registration_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  v_is_admin := public.is_admin();

  IF NOT v_is_service_role AND NOT v_is_admin THEN
    IF OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
      RAISE EXCEPTION 'Unauthorized: Students cannot modify registration approval_status.';
    END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      RAISE EXCEPTION 'Unauthorized: Students cannot modify registration email.';
    END IF;
    IF OLD.user_id IS NOT NULL AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Unauthorized: Students cannot modify registration user_id.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_protected_registration_tampering ON public.championship_registrations;
CREATE TRIGGER trg_prevent_protected_registration_tampering
  BEFORE UPDATE ON public.championship_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_prevent_protected_registration_tampering();

-- ── 4. ROW LEVEL SECURITY & TABLE PERMISSIONS ────────────────────────────────

ALTER TABLE public.championship_registrations ENABLE ROW LEVEL SECURITY;

-- Clean drop of previous overlapping policies
DROP POLICY IF EXISTS "Users can insert only their own registration" ON public.championship_registrations;
DROP POLICY IF EXISTS "Users can insert own registration" ON public.championship_registrations;
DROP POLICY IF EXISTS "Public insert championship_registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Public read championship_registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Admin can read all registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Admin manage registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Students and admins select registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Students insert own registration" ON public.championship_registrations;
DROP POLICY IF EXISTS "Students update own registration" ON public.championship_registrations;
DROP POLICY IF EXISTS "Admins update registrations" ON public.championship_registrations;
DROP POLICY IF EXISTS "Admins delete registrations" ON public.championship_registrations;

-- Policy 1 (INSERT): Students insert own row; anon allowed with pending trigger override; admin full
CREATE POLICY "Students insert own registration"
  ON public.championship_registrations
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (
    (
      auth.role() = 'authenticated' AND (
        (user_id IS NOT NULL AND user_id = auth.uid())
        OR (auth.jwt() ->> 'email' IS NOT NULL AND lower(email) = lower(auth.jwt() ->> 'email'))
      )
    )
    OR auth.role() = 'anon'
    OR public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- Policy 2 (SELECT): Students view only their own registration; Admins view all
CREATE POLICY "Students and admins select registrations"
  ON public.championship_registrations
  FOR SELECT
  TO anon, authenticated, service_role
  USING (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
    OR (auth.role() = 'authenticated' AND (
      (user_id IS NOT NULL AND user_id = auth.uid())
      OR (auth.jwt() ->> 'email' IS NOT NULL AND lower(email) = lower(auth.jwt() ->> 'email'))
    ))
  );

-- Policy 3 (UPDATE): Preserved strictly for Admins and service_role
CREATE POLICY "Admins update registrations"
  ON public.championship_registrations
  FOR UPDATE
  TO authenticated, service_role
  USING (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  )
  WITH CHECK (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- Policy 4 (DELETE): Preserved strictly for Admins and service_role
CREATE POLICY "Admins delete registrations"
  ON public.championship_registrations
  FOR DELETE
  TO authenticated, service_role
  USING (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
  );

-- Grants on championship_registrations:
-- REVOKE table-level UPDATE and DELETE from authenticated, anon, and public.
-- Ordinary students have ZERO direct UPDATE privileges.
REVOKE UPDATE, DELETE ON public.championship_registrations FROM authenticated, anon, public;
GRANT SELECT, INSERT ON public.championship_registrations TO authenticated, anon;
GRANT ALL ON public.championship_registrations TO service_role;

-- ── 5. DEDICATED ADMIN MANAGEMENT RPCS ────────────────────────────────────────

-- Admin RPC 1: Update registration approval status
CREATE OR REPLACE FUNCTION public.admin_update_registration_status(
  p_registration_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_is_service_role boolean;
  v_clean_status text;
BEGIN
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  v_is_admin := public.is_admin();

  IF NOT v_is_admin AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Administrator privileges required.',
      'message', 'Unauthorized: Administrator privileges required.'
    );
  END IF;

  v_clean_status := lower(trim(coalesce(p_status, '')));
  IF v_clean_status NOT IN ('approved', 'pending', 'removed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid status. Status must be one of: approved, pending, removed.',
      'message', 'Invalid status. Status must be one of: approved, pending, removed.'
    );
  END IF;

  UPDATE public.championship_registrations
  SET approval_status = v_clean_status,
      updated_at = now()
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Registration record not found.',
      'message', 'Registration record not found.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Registration status updated to ' || v_clean_status || '.',
    'approval_status', v_clean_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_registration_status(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_update_registration_status(uuid, text) TO authenticated, service_role;

-- Admin RPC 2: Delete registration record
CREATE OR REPLACE FUNCTION public.admin_delete_registration(
  p_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  v_is_admin := public.is_admin();

  IF NOT v_is_admin AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Administrator privileges required.',
      'message', 'Unauthorized: Administrator privileges required.'
    );
  END IF;

  DELETE FROM public.championship_registrations
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Registration record not found.',
      'message', 'Registration record not found.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Registration record deleted successfully.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_registration(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration(uuid) TO authenticated, service_role;

-- ── 6. CLEAN UP OBSOLETE SUBMISSION OVERLOADS ──────────────────────────────────

DROP FUNCTION IF EXISTS public.submit_pulse_attempt_atomic(
  text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb
);

DROP FUNCTION IF EXISTS public.submit_pulse_attempt_atomic(
  text, text, text, text, text, integer, numeric, integer, integer, integer, integer, text, jsonb, jsonb, jsonb
);

-- ── 7. FEATURE A: ATOMIC REGISTRATION UPDATE RPC FUNCTION ────────────────────

CREATE OR REPLACE FUNCTION public.update_student_registration(
  p_medical_college_id uuid,
  p_batch text,
  p_target_registration_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid uuid;
  v_caller_email text;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_reg_id uuid;
  v_reg_email text;
  v_reg_user_id uuid;
  v_reg_status text;
  v_match_count integer := 0;
  v_canonical_college text;
  v_normalized_batch text;
  v_pulse_rec RECORD;
  v_submitted_at timestamptz := now();
BEGIN
  -- 1. Identify and authenticate caller
  v_caller_uid := auth.uid();
  v_caller_email := auth.jwt() ->> 'email';
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  v_is_admin := public.is_admin();

  IF v_caller_uid IS NULL AND NOT v_is_admin AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required. Please sign in to update your registration.',
      'message', 'Authentication required. Please sign in to update your registration.'
    );
  END IF;

  -- 2. Validate canonical medical college from master table
  IF p_medical_college_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Please select a valid medical college from the list.',
      'message', 'Please select a valid medical college from the list.'
    );
  END IF;

  SELECT college_name INTO v_canonical_college
  FROM public.medical_colleges
  WHERE id = p_medical_college_id AND active = true;

  IF v_canonical_college IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'The selected medical college is not recognized or is inactive.',
      'message', 'The selected medical college is not recognized or is inactive.'
    );
  END IF;

  -- 3. Validate and normalize admission year / batch against established schema conventions
  CASE trim(coalesce(p_batch, ''))
    WHEN '2026 Batch → Freshers', '2026' THEN
      v_normalized_batch := '2026 Batch → Freshers';
    WHEN '2025 Batch → 1st Year MBBS', '2025' THEN
      v_normalized_batch := '2025 Batch → 1st Year MBBS';
    WHEN '2024 Batch → 2nd Year MBBS', '2024' THEN
      v_normalized_batch := '2024 Batch → 2nd Year MBBS';
    WHEN '2023 Batch → 3rd Year MBBS', '2023' THEN
      v_normalized_batch := '2023 Batch → 3rd Year MBBS';
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid admission year / batch. Permitted batches are: 2023, 2024, 2025, 2026.',
        'message', 'Invalid admission year / batch. Permitted batches are: 2023, 2024, 2025, 2026.'
      );
  END CASE;

  -- 4. Authorize and locate target registration record
  IF v_is_admin OR v_is_service_role THEN
    IF p_target_registration_id IS NOT NULL THEN
      SELECT id, email, user_id, approval_status
      INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
      FROM public.championship_registrations
      WHERE id = p_target_registration_id;
    ELSE
      SELECT id, email, user_id, approval_status
      INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
      FROM public.championship_registrations
      WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
         OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email))
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
  ELSE
    -- Authenticated student caller: Check for duplicate/ambiguous records
    SELECT count(DISTINCT id) INTO v_match_count
    FROM public.championship_registrations
    WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
       OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email));

    IF v_match_count > 1 THEN
      IF p_target_registration_id IS NOT NULL THEN
        SELECT id, email, user_id, approval_status
        INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
        FROM public.championship_registrations
        WHERE id = p_target_registration_id
          AND (
            (user_id IS NOT NULL AND user_id = v_caller_uid)
            OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email))
          );

        IF v_reg_id IS NULL THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: The specified registration does not belong to your account.',
            'message', 'Unauthorized: The specified registration does not belong to your account.'
          );
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Multiple registrations found for your account. Please contact support.',
          'message', 'Multiple registrations found for your account. Please contact support.'
        );
      END IF;
    ELSE
      SELECT id, email, user_id, approval_status
      INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
      FROM public.championship_registrations
      WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
         OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email));

      IF p_target_registration_id IS NOT NULL AND p_target_registration_id != v_reg_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Unauthorized: You are only permitted to edit your own registration details.',
          'message', 'Unauthorized: You are only permitted to edit your own registration details.'
        );
      END IF;
    END IF;
  END IF;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active championship registration found for your account.',
      'message', 'No active championship registration found for your account.'
    );
  END IF;

  -- 5. Status check:
  -- Pending registrations MAY correct their college and batch before admin review.
  -- Removed registrations are strictly forbidden from editing or regaining access.
  IF v_reg_status = 'removed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your championship registration has been removed or suspended. Please contact administration.',
      'message', 'Your championship registration has been removed or suspended. Please contact administration.'
    );
  END IF;

  IF v_reg_status NOT IN ('approved', 'pending') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid championship registration status.',
      'message', 'Invalid championship registration status.'
    );
  END IF;

  -- 6. Update championship_registrations
  -- STRICTLY restrict edits to medical_college, medical_college_id, batch, user_id, updated_at
  -- Never modify email, approval_status, passport_id, or other protected fields.
  UPDATE public.championship_registrations
  SET medical_college = v_canonical_college,
      medical_college_id = p_medical_college_id,
      batch = v_normalized_batch,
      user_id = COALESCE(user_id, v_caller_uid),
      updated_at = v_submitted_at
  WHERE id = v_reg_id;

  -- 7. Update profiles record for current student
  IF v_caller_uid IS NOT NULL OR v_reg_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET medical_college_id = p_medical_college_id,
        college = v_canonical_college,
        batch = v_normalized_batch,
        updated_at = v_submitted_at
    WHERE user_id = COALESCE(v_caller_uid, v_reg_user_id) 
       OR id = COALESCE(v_caller_uid, v_reg_user_id);
  END IF;

  -- 8. Update championship_participants if row exists
  IF v_caller_uid IS NOT NULL OR v_reg_user_id IS NOT NULL THEN
    UPDATE public.championship_participants
    SET institution = v_canonical_college,
        updated_at = v_submitted_at
    WHERE user_id = COALESCE(v_caller_uid, v_reg_user_id)::text;
  END IF;

  -- 9. Update current-data championship_leaderboard (historical attempts remain untouched)
  UPDATE public.championship_leaderboard
  SET college = v_canonical_college,
      medical_college_id = p_medical_college_id,
      batch = v_normalized_batch,
      updated_at = v_submitted_at
  WHERE (v_caller_uid IS NOT NULL AND user_id = v_caller_uid::text)
     OR (v_reg_user_id IS NOT NULL AND user_id = v_reg_user_id::text)
     OR (v_reg_email IS NOT NULL AND lower(user_email) = lower(v_reg_email));

  -- 10. Recalculate college & batch standings for any pulses the student participated in
  FOR v_pulse_rec IN (
    SELECT DISTINCT pulse_id
    FROM public.championship_leaderboard
    WHERE (v_caller_uid IS NOT NULL AND user_id = v_caller_uid::text)
       OR (v_reg_user_id IS NOT NULL AND user_id = v_reg_user_id::text)
       OR (v_reg_email IS NOT NULL AND lower(user_email) = lower(v_reg_email))
  ) LOOP
    -- Recalculate College Standings for this pulse
    INSERT INTO public.championship_college_standings (
      pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
    )
    SELECT
      v_pulse_rec.pulse_id,
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
      ) as medical_college_id,
      SUM(l.score) as total_score,
      ROUND(AVG(l.score), 0) as avg_score,
      ROUND(AVG(l.accuracy), 1) as avg_accuracy,
      COUNT(*) as participants_count,
      (
        SELECT student_name FROM public.championship_leaderboard l2
        WHERE l2.pulse_id = v_pulse_rec.pulse_id AND l2.college = l.college
        ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
      ) as top_scorer,
      v_submitted_at
    FROM public.championship_leaderboard l
    WHERE l.pulse_id = v_pulse_rec.pulse_id
    GROUP BY l.college
    ON CONFLICT (college, pulse_id) DO UPDATE SET
      total_score = EXCLUDED.total_score,
      avg_score = EXCLUDED.avg_score,
      avg_accuracy = EXCLUDED.avg_accuracy,
      participants_count = EXCLUDED.participants_count,
      top_scorer = EXCLUDED.top_scorer,
      medical_college_id = COALESCE(EXCLUDED.medical_college_id, championship_college_standings.medical_college_id),
      updated_at = v_submitted_at;

    -- Clean up empty colleges with 0 participants in this pulse
    DELETE FROM public.championship_college_standings
    WHERE pulse_id = v_pulse_rec.pulse_id
      AND college NOT IN (
        SELECT DISTINCT college FROM public.championship_leaderboard WHERE pulse_id = v_pulse_rec.pulse_id
      );

    -- Re-rank college standings
    WITH ranked_colleges AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY pulse_id 
        ORDER BY total_score DESC, avg_accuracy DESC
      ) as calculated_rank
      FROM public.championship_college_standings
      WHERE pulse_id = v_pulse_rec.pulse_id
    )
    UPDATE public.championship_college_standings cs
    SET rank = rc.calculated_rank
    FROM ranked_colleges rc
    WHERE cs.id = rc.id;

    -- Recalculate Batch Standings for this pulse
    INSERT INTO public.championship_batch_standings (
      pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
    )
    SELECT
      v_pulse_rec.pulse_id,
      l.batch,
      SUM(l.score) as total_score,
      ROUND(AVG(l.score), 0) as avg_score,
      ROUND(AVG(l.accuracy), 1) as avg_accuracy,
      COUNT(*) as participants_count,
      v_submitted_at
    FROM public.championship_leaderboard l
    WHERE l.pulse_id = v_pulse_rec.pulse_id
    GROUP BY l.batch
    ON CONFLICT (batch, pulse_id) DO UPDATE SET
      total_score = EXCLUDED.total_score,
      avg_score = EXCLUDED.avg_score,
      avg_accuracy = EXCLUDED.avg_accuracy,
      participants_count = EXCLUDED.participants_count,
      updated_at = v_submitted_at;

    -- Clean up empty batches
    DELETE FROM public.championship_batch_standings
    WHERE pulse_id = v_pulse_rec.pulse_id
      AND batch NOT IN (
        SELECT DISTINCT batch FROM public.championship_leaderboard WHERE pulse_id = v_pulse_rec.pulse_id
      );

    -- Re-rank batch standings
    WITH ranked_batches AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY pulse_id 
        ORDER BY total_score DESC, avg_score DESC
      ) as calculated_rank
      FROM public.championship_batch_standings
      WHERE pulse_id = v_pulse_rec.pulse_id
    )
    UPDATE public.championship_batch_standings bs
    SET rank = rb.calculated_rank
    FROM ranked_batches rb
    WHERE bs.id = rb.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Registration details updated successfully.',
    'medical_college', v_canonical_college,
    'medical_college_id', p_medical_college_id,
    'batch', v_normalized_batch,
    'approval_status', v_reg_status,
    'updated_at', v_submitted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_student_registration(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_student_registration(uuid, text, uuid) TO authenticated, service_role;

-- ── 8. FEATURE B: ATOMIC PULSE ATTEMPT SUBMISSION WITH STRICT AUTH & REGISTRATION ──────

CREATE OR REPLACE FUNCTION public.submit_pulse_attempt_atomic(
  p_pulse_id text,
  p_pulse_date text,
  p_user_id text,
  p_user_email text,
  p_student_name text,
  p_college text,
  p_batch text,
  p_score numeric,
  p_accuracy numeric,
  p_time_taken_seconds numeric,
  p_xp numeric,
  p_answers jsonb,
  p_college_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_uid uuid;
  v_caller_email text;
  v_is_service_role boolean;
  v_effective_user_id text;
  v_effective_user_email text;
  v_effective_student_name text;
  v_canonical_college text;
  v_canonical_batch text;
  v_resolved_college_id uuid;
  v_registration_rec RECORD;
  v_existing_id uuid;
  v_new_attempt_id uuid;
  v_submitted_at timestamptz := now();
BEGIN
  -- 1. Anti-Spoofing & Authentication Check
  v_caller_uid := auth.uid();
  v_caller_email := auth.jwt() ->> 'email';
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');

  -- Reject anonymous callers completely. Anonymous users cannot submit pulse attempts.
  IF v_caller_uid IS NULL AND NOT v_is_service_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'not_registered', true
    );
  END IF;

  -- 2. Authoritative Championship Registration Lookup
  -- SECURITY: For authenticated callers, NEVER authorize using client-supplied p_user_id or p_user_email.
  -- Identity is resolved STRICTLY from the verified auth context.
  IF v_is_service_role AND v_caller_uid IS NULL THEN
    -- Trusted server-side caller with explicit identity arguments
    SELECT id, user_id, email, full_name, medical_college, medical_college_id, batch, approval_status
    INTO v_registration_rec
    FROM public.championship_registrations
    WHERE (p_user_id IS NOT NULL AND user_id::text = p_user_id)
       OR (p_user_email IS NOT NULL AND lower(email) = lower(trim(p_user_email)))
    ORDER BY (approval_status = 'approved') DESC, created_at DESC
    LIMIT 1;
  ELSE
    -- Authenticated student caller: identity derived SOLELY from auth context
    SELECT id, user_id, email, full_name, medical_college, medical_college_id, batch, approval_status
    INTO v_registration_rec
    FROM public.championship_registrations
    WHERE (user_id IS NOT NULL AND user_id = v_caller_uid)
       OR (v_caller_email IS NOT NULL AND lower(email) = lower(v_caller_email))
    ORDER BY (user_id = v_caller_uid) DESC, (approval_status = 'approved') DESC, created_at DESC
    LIMIT 1;
  END IF;

  -- 3. Registration Existence and Status Verification
  IF v_registration_rec.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'not_registered', true
    );
  END IF;

  IF v_registration_rec.approval_status = 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your championship registration is pending approval. You cannot attempt Pulse yet.',
      'message', 'Your championship registration is pending approval. You cannot attempt Pulse yet.',
      'not_registered', true
    );
  END IF;

  IF v_registration_rec.approval_status = 'removed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your championship registration has been removed or suspended. You cannot participate in Pulse.',
      'message', 'Your championship registration has been removed or suspended. You cannot participate in Pulse.',
      'not_registered', true
    );
  END IF;

  IF v_registration_rec.approval_status != 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.',
      'not_registered', true
    );
  END IF;

  -- Optional Competition Timing & Status Rule:
  -- If this pulse set exists in championship_pulse_sets, verify it is published (not draft).
  IF EXISTS (
    SELECT 1 FROM public.championship_pulse_sets
    WHERE (id::text = p_pulse_id OR pulse_date::text = p_pulse_date)
      AND status = 'draft'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.championship_pulse_sets
    WHERE (id::text = p_pulse_id OR pulse_date::text = p_pulse_date)
      AND status = 'published'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This Pulse session is not currently open for submission.',
      'message', 'This Pulse session is not currently open for submission.'
    );
  END IF;

  -- 4. Bind Verified Identity & Canonical Details
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
  v_resolved_college_id := v_registration_rec.medical_college_id;

  -- Fallback college ID lookup if missing on registration
  IF v_resolved_college_id IS NULL AND v_canonical_college IS NOT NULL THEN
    SELECT id INTO v_resolved_college_id
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(v_canonical_college))
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  END IF;

  -- 5. Check if user already submitted for this pulse (Concurrency / Idempotency guard)
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE pulse_id = p_pulse_id
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

  -- 6. Insert immutable attempt record
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
      medical_college_id
    ) VALUES (
      p_pulse_id,
      p_pulse_date,
      v_effective_user_id,
      v_effective_user_email,
      v_effective_student_name,
      v_canonical_college,
      v_canonical_batch,
      p_score,
      p_accuracy,
      p_time_taken_seconds,
      p_time_taken_seconds,
      p_xp,
      p_answers,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at,
      v_resolved_college_id
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE pulse_id = p_pulse_id
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

  -- 7. Upsert into championship_leaderboard
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
    p_pulse_id,
    v_effective_user_id,
    v_effective_user_email,
    v_effective_student_name,
    v_canonical_college,
    v_canonical_batch,
    p_score,
    p_accuracy,
    p_time_taken_seconds,
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

  -- 8. Re-rank individual leaderboard for this pulse
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC
    ) as calculated_rank
    FROM public.championship_leaderboard
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_leaderboard l
  SET rank = r.calculated_rank
  FROM ranked r
  WHERE l.id = r.id;

  -- 9. Recalculate College Standings (Strictly 1 row per (college, pulse_id))
  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    p_pulse_id,
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
    ) as medical_college_id,
    SUM(l.score) as total_score,
    ROUND(AVG(l.score), 0) as avg_score,
    ROUND(AVG(l.accuracy), 1) as avg_accuracy,
    COUNT(*) as participants_count,
    (
      SELECT student_name FROM public.championship_leaderboard l2
      WHERE l2.pulse_id = p_pulse_id AND l2.college = l.college
      ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
    ) as top_scorer,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = p_pulse_id
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
    ) as calculated_rank
    FROM public.championship_college_standings
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

  -- 10. Recalculate Batch Standings
  INSERT INTO public.championship_batch_standings (
    pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
  )
  SELECT
    p_pulse_id,
    l.batch,
    SUM(l.score) as total_score,
    ROUND(AVG(l.score), 0) as avg_score,
    ROUND(AVG(l.accuracy), 1) as avg_accuracy,
    COUNT(*) as participants_count,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = p_pulse_id
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
    ) as calculated_rank
    FROM public.championship_batch_standings
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_batch_standings bs
  SET rank = rb.calculated_rank
  FROM ranked_batches rb
  WHERE bs.id = rb.id;

  RETURN jsonb_build_object(
    'success', true,
    'already_submitted', false,
    'attempt_id', v_new_attempt_id,
    'score', p_score,
    'accuracy', p_accuracy,
    'canonical_college', v_canonical_college
  );
END;
$$;

-- Revoke execute from anon and public; grant strictly to authenticated and service_role
REVOKE ALL ON FUNCTION public.submit_pulse_attempt_atomic(
  text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb, uuid
) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic(
  text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb, uuid
) TO authenticated, service_role;

COMMIT;
