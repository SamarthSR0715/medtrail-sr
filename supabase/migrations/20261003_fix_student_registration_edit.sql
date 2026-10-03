-- ==============================================================================
-- Migration: 20261003_fix_student_registration_edit.sql
-- Description:
--   Enables the existing student college and admission batch/year editing feature.
--
-- Scope & Guarantees:
--   1. Adds and safely backfills championship_registrations.user_id from auth.users
--      without overwriting ownership or creating duplicate links.
--   2. Installs public.update_student_registration(uuid, text, uuid) with SECURITY DEFINER
--      and safe search_path = public, auth, pg_temp.
--   3. Identifies students via auth.uid() with verified JWT email fallback, rejecting
--      ambiguous or conflicting matches.
--   4. Validates colleges against active records in public.medical_colleges.
--   5. Restricts updates to medical_college, medical_college_id, batch, user_id, updated_at.
--      Never modifies approval_status, full_name, email, or passport_id.
--   6. Updates profiles.medical_college_id strictly for the student's auth.users ID.
--   7. Synchronizes active championship_leaderboard and recalculates both college and batch
--      standings (previous and new groupings) across all affected pulses.
--   8. Preserves historical attempt records (championship_pulse_attempts) as 100% immutable.
--   9. Does NOT modify championship_pulse_attempts, submit_pulse_attempt_atomic, or RLS policies.
-- ==============================================================================

BEGIN;

-- ── 1. SCHEMA EXTENSION FOR championship_registrations (IDEMPOTENT) ───────────
ALTER TABLE public.championship_registrations 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.championship_registrations 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ── 2. SAFE BACKFILL OF user_id FROM auth.users ───────────────────────────────
-- Strictly 1-to-1 matches: only backfill where an auth user's email matches exactly
-- one registration, without overwriting any existing non-null user_id.
WITH auth_user_counts AS (
  SELECT lower(trim(email)) AS email, count(*) AS email_count
  FROM auth.users
  WHERE email IS NOT NULL AND trim(email) != ''
  GROUP BY lower(trim(email))
  HAVING count(*) = 1
),
unique_auth_users AS (
  SELECT u.id AS auth_user_id, lower(trim(u.email)) AS email
  FROM auth.users u
  JOIN auth_user_counts c ON lower(trim(u.email)) = c.email
),
reg_counts AS (
  SELECT lower(trim(email)) AS email, count(*) AS email_count
  FROM public.championship_registrations
  WHERE email IS NOT NULL AND trim(email) != ''
  GROUP BY lower(trim(email))
  HAVING count(*) = 1
),
unique_registrations AS (
  SELECT r.id AS reg_id, lower(trim(r.email)) AS email
  FROM public.championship_registrations r
  JOIN reg_counts rc ON lower(trim(r.email)) = rc.email
),
eligible_registrations AS (
  SELECT ur.reg_id, ua.auth_user_id
  FROM unique_registrations ur
  JOIN unique_auth_users ua ON ur.email = ua.email
  JOIN public.championship_registrations r ON r.id = ur.reg_id
  WHERE r.user_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.championship_registrations r2
      WHERE r2.user_id = ua.auth_user_id AND r2.id != ur.reg_id
    )
)
UPDATE public.championship_registrations r
SET user_id = e.auth_user_id,
    updated_at = now()
FROM eligible_registrations e
WHERE r.id = e.reg_id
  AND r.user_id IS NULL;

-- Enforce partial uniqueness: at most one registration per authenticated user_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_champ_reg_user_id 
  ON public.championship_registrations (user_id) 
  WHERE user_id IS NOT NULL;

-- ── 3. FUNCTION: public.update_student_registration ───────────────────────────
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
  
  -- Trusted admin authorization flags (never trusting user_metadata)
  v_is_service_role boolean := false;
  v_is_super_admin boolean := false;
  v_app_role text;
  v_app_is_admin text;
  v_is_trusted_admin boolean := false;
  
  v_reg_id uuid;
  v_reg_email text;
  v_reg_user_id uuid;
  v_reg_status text;
  v_effective_user_id uuid;
  
  v_target_auth_uid uuid;
  v_target_match_count integer := 0;
  
  v_match_count integer := 0;
  v_canonical_college text;
  v_normalized_batch text;
  
  v_pulse_rec RECORD;
  v_submitted_at timestamptz := now();
BEGIN
  -- 1. Identify caller context
  v_caller_uid := auth.uid();
  v_caller_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  
  -- Evaluate trusted server authorization (never trusting user_metadata)
  v_is_service_role := (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role');
  
  -- Evaluate project's existing trusted database-side admin check
  BEGIN
    v_is_super_admin := public.is_super_admin();
  EXCEPTION WHEN OTHERS THEN
    v_is_super_admin := false;
  END;

  BEGIN
    v_app_role := auth.jwt() -> 'app_metadata' ->> 'role';
    v_app_is_admin := auth.jwt() -> 'app_metadata' ->> 'is_admin';
  EXCEPTION WHEN OTHERS THEN
    v_app_role := NULL;
    v_app_is_admin := NULL;
  END;

  v_is_trusted_admin := v_is_service_role 
    OR v_is_super_admin 
    OR (v_app_role IN ('admin', 'super_admin')) 
    OR (v_app_is_admin = 'true');

  IF v_caller_uid IS NULL AND NOT v_is_trusted_admin THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required. Please sign in to update your registration.',
      'message', 'Authentication required. Please sign in to update your registration.'
    );
  END IF;

  -- 2. Validate medical college from master table
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

  -- 3. Normalize admission year / batch against established schema conventions
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

  -- 4. Locate registration record
  IF v_is_trusted_admin THEN
    -- Trusted admin or service_role caller
    IF p_target_registration_id IS NOT NULL THEN
      SELECT id, email, user_id, approval_status
      INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
      FROM public.championship_registrations
      WHERE id = p_target_registration_id;

      IF v_reg_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Target registration not found.',
          'message', 'Target registration not found.'
        );
      END IF;
    ELSE
      SELECT id, email, user_id, approval_status
      INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
      FROM public.championship_registrations
      WHERE (v_caller_uid IS NOT NULL AND user_id = v_caller_uid)
         OR (v_caller_email != '' AND lower(email) = v_caller_email)
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
  ELSE
    -- Ordinary student: lookup by auth.uid() first
    IF v_caller_uid IS NOT NULL THEN
      SELECT count(*) INTO v_match_count
      FROM public.championship_registrations
      WHERE user_id = v_caller_uid;

      IF v_match_count > 1 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Multiple registrations found linked to your account. Please contact support.',
          'message', 'Multiple registrations found linked to your account. Please contact support.'
        );
      ELSIF v_match_count = 1 THEN
        SELECT id, email, user_id, approval_status
        INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
        FROM public.championship_registrations
        WHERE user_id = v_caller_uid;
      END IF;
    END IF;

    -- Fallback: lookup by verified JWT email only if not found by user_id
    IF v_reg_id IS NULL THEN
      IF v_caller_email IS NULL OR v_caller_email = '' THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Unable to verify account email. Please sign in again.',
          'message', 'Unable to verify account email. Please sign in again.'
        );
      END IF;

      SELECT count(*) INTO v_match_count
      FROM public.championship_registrations
      WHERE lower(email) = v_caller_email;

      IF v_match_count = 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'No active championship registration found for your account.',
          'message', 'No active championship registration found for your account.'
        );
      ELSIF v_match_count > 1 THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Multiple registrations found for your email address. Please contact support.',
          'message', 'Multiple registrations found for your email address. Please contact support.'
        );
      ELSE
        SELECT id, email, user_id, approval_status
        INTO v_reg_id, v_reg_email, v_reg_user_id, v_reg_status
        FROM public.championship_registrations
        WHERE lower(email) = v_caller_email;

        -- Conflicting ownership guard: reject if registration belongs to a different auth account
        IF v_reg_user_id IS NOT NULL AND v_caller_uid IS NOT NULL AND v_reg_user_id != v_caller_uid THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: This registration belongs to a different account.',
            'message', 'Unauthorized: This registration belongs to a different account.'
          );
        END IF;
      END IF;
    END IF;

    -- Security Guard: Non-admin students can NEVER target another student's registration
    IF p_target_registration_id IS NOT NULL AND p_target_registration_id != v_reg_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Unauthorized: You are only permitted to edit your own registration.',
        'message', 'Unauthorized: You are only permitted to edit your own registration.'
      );
    END IF;
  END IF;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active championship registration found for your account.',
      'message', 'No active championship registration found for your account.'
    );
  END IF;

  -- 5. Status check: removed registrations cannot edit
  IF v_reg_status = 'removed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your championship registration has been removed or suspended. Please contact administration.',
      'message', 'Your championship registration has been removed or suspended. Please contact administration.'
    );
  END IF;

  -- 6. Resolve effective student user_id safely (NEVER assigning admin's UID to another student)
  IF v_reg_user_id IS NOT NULL THEN
    -- Registration already has a valid linked student account
    v_effective_user_id := v_reg_user_id;
  ELSIF NOT v_is_trusted_admin THEN
    -- Ordinary student updating their own verified registration: link to caller's UID
    v_effective_user_id := v_caller_uid;
  ELSIF p_target_registration_id IS NULL AND v_caller_uid IS NOT NULL AND v_caller_email != '' AND lower(v_reg_email) = v_caller_email THEN
    -- Administrator updating their own personal registration where email matches: link to admin UID
    v_effective_user_id := v_caller_uid;
  ELSE
    -- Administrator targeting another student's registration where user_id is currently NULL:
    -- Attempt safe, unambiguous resolution against auth.users by verified registration email.
    -- NEVER assign v_caller_uid (the admin's UID) to the student.
    IF v_reg_email IS NOT NULL AND trim(v_reg_email) != '' THEN
      SELECT count(*)
      INTO v_target_match_count
      FROM auth.users
      WHERE lower(trim(email)) = lower(trim(v_reg_email));

      IF v_target_match_count = 1 THEN
        SELECT id
        INTO v_target_auth_uid
        FROM auth.users
        WHERE lower(trim(email)) = lower(trim(v_reg_email));

        -- Ensure this auth user is not already linked to another registration
        IF NOT EXISTS (
          SELECT 1 FROM public.championship_registrations
          WHERE user_id = v_target_auth_uid AND id != v_reg_id
        ) THEN
          v_effective_user_id := v_target_auth_uid;
        ELSE
          v_effective_user_id := NULL;
        END IF;
      ELSE
        v_effective_user_id := NULL;
      END IF;
    ELSE
      v_effective_user_id := NULL;
    END IF;
  END IF;

  -- 7. Update championship_registrations (approval_status is strictly preserved)
  UPDATE public.championship_registrations
  SET medical_college = v_canonical_college,
      medical_college_id = p_medical_college_id,
      batch = v_normalized_batch,
      user_id = COALESCE(v_effective_user_id, user_id),
      updated_at = v_submitted_at
  WHERE id = v_reg_id;

  -- 8. Update profiles (matched strictly by profiles.id = student's auth.users.id)
  IF v_effective_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET medical_college_id = p_medical_college_id,
        updated_at = v_submitted_at
    WHERE id = v_effective_user_id;
  END IF;

  -- 9. Synchronize active championship_leaderboard (championship_pulse_attempts remains untouched)
  UPDATE public.championship_leaderboard
  SET college = v_canonical_college,
      medical_college_id = p_medical_college_id,
      batch = v_normalized_batch,
      updated_at = v_submitted_at
  WHERE (v_effective_user_id IS NOT NULL AND user_id = v_effective_user_id::text)
     OR (v_reg_email IS NOT NULL AND lower(user_email) = lower(v_reg_email));

  -- 10. Recalculate college & batch standings for all affected pulses (both previous and new groups)
  FOR v_pulse_rec IN (
    SELECT DISTINCT pulse_id, season_id
    FROM public.championship_leaderboard
    WHERE (v_effective_user_id IS NOT NULL AND user_id = v_effective_user_id::text)
       OR (v_reg_email IS NOT NULL AND lower(user_email) = lower(v_reg_email))
  ) LOOP
    -- Recalculate College Standings for all colleges participating in this pulse
    INSERT INTO public.championship_college_standings (
      pulse_id, season_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
    )
    SELECT
      v_pulse_rec.pulse_id,
      COALESCE(v_pulse_rec.season_id, 'S1'),
      l.college,
      COALESCE(
        (SELECT mc.id FROM public.medical_colleges mc WHERE lower(mc.college_name) = lower(trim(l.college)) ORDER BY mc.created_at ASC LIMIT 1),
        CASE WHEN COUNT(DISTINCT l.medical_college_id) = 1 THEN (array_remove(array_agg(DISTINCT l.medical_college_id), NULL))[1] ELSE NULL END
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
      season_id = EXCLUDED.season_id,
      total_score = EXCLUDED.total_score,
      avg_score = EXCLUDED.avg_score,
      avg_accuracy = EXCLUDED.avg_accuracy,
      participants_count = EXCLUDED.participants_count,
      top_scorer = EXCLUDED.top_scorer,
      medical_college_id = COALESCE(EXCLUDED.medical_college_id, championship_college_standings.medical_college_id),
      updated_at = v_submitted_at;

    -- Clean up colleges that have 0 remaining participants in this pulse
    DELETE FROM public.championship_college_standings
    WHERE pulse_id = v_pulse_rec.pulse_id
      AND college NOT IN (
        SELECT DISTINCT college FROM public.championship_leaderboard WHERE pulse_id = v_pulse_rec.pulse_id
      );

    -- Re-rank all colleges for this pulse
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

    -- Recalculate Batch Standings for all batches in this pulse
    INSERT INTO public.championship_batch_standings (
      pulse_id, season_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
    )
    SELECT
      v_pulse_rec.pulse_id,
      COALESCE(v_pulse_rec.season_id, 'S1'),
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
      season_id = EXCLUDED.season_id,
      total_score = EXCLUDED.total_score,
      avg_score = EXCLUDED.avg_score,
      avg_accuracy = EXCLUDED.avg_accuracy,
      participants_count = EXCLUDED.participants_count,
      updated_at = v_submitted_at;

    -- Clean up batches that have 0 remaining participants in this pulse
    DELETE FROM public.championship_batch_standings
    WHERE pulse_id = v_pulse_rec.pulse_id
      AND batch NOT IN (
        SELECT DISTINCT batch FROM public.championship_leaderboard WHERE pulse_id = v_pulse_rec.pulse_id
      );

    -- Re-rank all batches for this pulse
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

-- ── 4. GRANTS ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.update_student_registration(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_student_registration(uuid, text, uuid) TO authenticated, service_role;

COMMIT;
