-- ==============================================================================
-- Migration: 20261007_safe_registration_self_link_pulse_submission.sql
-- Description:
--   Fix partial registration-gate rejection in submit_pulse_attempt_atomic(uuid, jsonb).
--
-- Background:
--   start_pulse_session_atomic verified students by auth.uid() OR verified JWT email.
--   Students who registered prior to login have championship_registrations.user_id = NULL.
--   submit_pulse_attempt_atomic previously queried ONLY user_id = v_session.user_id,
--   causing legitimate approved students to be rejected at final submission with:
--   "You must register for the MedTrailSR Championship before attempting Pulse."
--
-- Security Guarantees & Constraints:
--   1. Matches authenticated user_id FIRST.
--   2. Falls back to auth.jwt()->>'email' ONLY after authenticated session validation.
--   3. Never trusts client-supplied session metadata.
--   4. Validates strict 1-to-1 uniqueness: fails safely without linking if matching is ambiguous.
--   5. Self-heals orphaned user_id = NULL on the single matched registration safely.
--   6. Preserves approval status, session ownership, anti-cheat, scoring, XP, and rankings 100%.
--   7. Uses public.championship_registrations%ROWTYPE for PL/pgSQL tuple safety.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.submit_pulse_attempt_atomic(
  p_session_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid UUID;
  v_caller_email TEXT;
  v_email_matches INTEGER := 0;
  v_session RECORD;
  v_reg public.championship_registrations%ROWTYPE;
  v_existing_id UUID;
  v_new_attempt_id UUID;
  v_submitted_at TIMESTAMPTZ := now();
  v_effective_user_email TEXT;
  v_effective_student_name TEXT;
  v_canonical_college TEXT;
  v_canonical_batch TEXT;
  v_resolved_college_id UUID;
  v_time_taken_seconds NUMERIC;
  v_correct_count INTEGER := 0;
  v_speed_bonus INTEGER;
  v_score NUMERIC;
  v_accuracy NUMERIC;
  v_xp NUMERIC;
  v_risk_score NUMERIC := 0;
  v_review_status TEXT := 'unreviewed';
  v_explanations JSONB := '[]'::jsonb;
  v_user_ans INTEGER;
  v_correct_letter TEXT;
  v_correct_idx INTEGER;
  v_q RECORD;
  v_idx INTEGER := 0;
BEGIN
  -- 1. Anti-Spoofing & Authentication Check
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL AND NOT (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Authentication required.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.'
    );
  END IF;

  -- 2. Authoritative Exam Session Lookup
  SELECT s.*, ps.questions AS fallback_questions_json
  INTO v_session
  FROM public.championship_pulse_sessions s
  JOIN public.championship_pulse_sets ps ON ps.id = s.pulse_set_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Exam session not found or invalid.',
      'message', 'Active exam session not found. Please refresh and try again.'
    );
  END IF;

  -- Verify session ownership (caller must own the session)
  IF v_caller_uid IS NOT NULL AND v_session.user_id <> v_caller_uid AND NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Session ownership mismatch.',
      'message', 'Exam session does not belong to the current authenticated user.'
    );
  END IF;

  IF v_session.status = 'submitted' THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE session_id = v_session.id
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse. 1 attempt permitted.'
    );
  END IF;

  -- 3. Authoritative Championship Registration Lookup (Enforcing Approved Registration)
  -- 3.1 Primary Lookup: Match by Authenticated User ID
  SELECT *
  INTO v_reg
  FROM public.championship_registrations
  WHERE user_id IS NOT NULL AND user_id = v_session.user_id
  ORDER BY (approval_status = 'approved') DESC, created_at DESC
  LIMIT 1;

  -- 3.2 Secondary Fallback: Match by Verified JWT Email (Only if not matched by user_id)
  -- Strictly verified: only for authenticated callers where email maps to exactly ONE registration.
  IF v_reg.id IS NULL THEN
    v_caller_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));

    IF v_caller_email <> '' THEN
      -- Count matching registrations to prevent ambiguous or duplicate linking (Fail Safely)
      SELECT count(*) INTO v_email_matches
      FROM public.championship_registrations
      WHERE lower(trim(email)) = v_caller_email;

      -- Strictly require exactly ONE registration row for this email
      IF v_email_matches = 1 THEN
        SELECT *
        INTO v_reg
        FROM public.championship_registrations
        WHERE lower(trim(email)) = v_caller_email;

        -- Conflict Check: Reject if registration is already bound to a different user_id
        IF v_reg.user_id IS NOT NULL AND v_reg.user_id <> v_session.user_id THEN
          v_reg.id := NULL;
        -- Safe Self-Link: Registration has user_id NULL and caller is unlinked
        ELSIF v_reg.user_id IS NULL AND v_session.user_id IS NOT NULL THEN
          -- Verify caller UID is not already attached to another registration record
          IF NOT EXISTS (
            SELECT 1 FROM public.championship_registrations
            WHERE user_id = v_session.user_id AND id <> v_reg.id
          ) THEN
            UPDATE public.championship_registrations
            SET user_id = v_session.user_id,
                updated_at = v_submitted_at
            WHERE id = v_reg.id
              AND user_id IS NULL;

            v_reg.user_id := v_session.user_id;
          ELSE
            v_reg.id := NULL;
          END IF;
        END IF;
      ELSE
        -- Ambiguous email match: do not guess or link, fail safely
        v_reg.id := NULL;
      END IF;
    END IF;
  END IF;

  IF v_reg.id IS NULL OR v_reg.approval_status <> 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'not_registered', true,
      'error', 'Championship registration not approved.',
      'message', 'You must register for the MedTrailSR Championship before attempting Pulse.'
    );
  END IF;

  -- Bind canonical student metadata
  v_effective_user_email := COALESCE(v_reg.email, auth.jwt() ->> 'email');
  v_effective_student_name := COALESCE(v_reg.full_name, 'Doctor');
  v_canonical_college := v_reg.medical_college;
  v_canonical_batch := v_reg.batch;
  v_resolved_college_id := v_reg.medical_college_id;

  IF v_resolved_college_id IS NULL AND v_canonical_college IS NOT NULL THEN
    SELECT id INTO v_resolved_college_id
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(v_canonical_college))
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  END IF;

  -- 4. Check If Attempt Already Exists (Concurrency Guard)
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE pulse_id = v_session.pulse_id
    AND (
      user_id = v_session.user_id::text
      OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse.'
    );
  END IF;

  -- 5. Calculate Server-Authoritative Time Taken
  v_time_taken_seconds := ROUND(EXTRACT(EPOCH FROM (v_submitted_at - v_session.started_at)));
  -- Defensive boundaries: non-negative and capped at 300s competition max
  v_time_taken_seconds := GREATEST(0, LEAST(300, v_time_taken_seconds));

  -- 6. Evaluate Answers Authoritatively Against championship_pulse_questions
  FOR v_q IN
    SELECT slot, correct_answer, explanation
    FROM public.championship_pulse_questions
    WHERE pulse_set_id = v_session.pulse_set_id
    ORDER BY slot ASC
  LOOP
    -- User's answer index for this slot (0-indexed array: slot 1 -> index 0)
    IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'array' THEN
      v_user_ans := (p_answers->>v_idx)::integer;
    ELSE
      v_user_ans := -1;
    END IF;

    v_correct_letter := upper(trim(coalesce(v_q.correct_answer, 'A')));
    v_correct_idx := CASE v_correct_letter
      WHEN 'A' THEN 0
      WHEN 'B' THEN 1
      WHEN 'C' THEN 2
      WHEN 'D' THEN 3
      WHEN '0' THEN 0
      WHEN '1' THEN 1
      WHEN '2' THEN 2
      WHEN '3' THEN 3
      ELSE 0
    END;

    IF v_user_ans IS NOT NULL AND v_user_ans = v_correct_idx THEN
      v_correct_count := v_correct_count + 1;
    END IF;

    -- Store explanation for post-submission review modal
    v_explanations := v_explanations || jsonb_build_object(
      'slot', v_q.slot,
      'correct_answer', v_correct_letter,
      'explanation', coalesce(v_q.explanation, '')
    );

    v_idx := v_idx + 1;
  END LOOP;

  -- Fallback evaluation if questions table was populated via json only
  IF v_idx = 0 AND v_session.fallback_questions_json IS NOT NULL THEN
    FOR v_q IN
      SELECT
        ord AS slot,
        upper(coalesce(elem->>'correct_answer', elem->>'correctAnswer', 'A')) AS correct_answer,
        coalesce(elem->>'explanation', '') AS explanation
      FROM jsonb_array_elements(v_session.fallback_questions_json) WITH ORDINALITY arr(elem, ord)
    LOOP
      IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) = 'array' THEN
        v_user_ans := (p_answers->>v_idx)::integer;
      ELSE
        v_user_ans := -1;
      END IF;

      v_correct_letter := upper(trim(coalesce(v_q.correct_answer, 'A')));
      v_correct_idx := CASE v_correct_letter
        WHEN 'A' THEN 0
        WHEN 'B' THEN 1
        WHEN 'C' THEN 2
        WHEN 'D' THEN 3
        WHEN '0' THEN 0
        WHEN '1' THEN 1
        WHEN '2' THEN 2
        WHEN '3' THEN 3
        ELSE 0
      END;

      IF v_user_ans IS NOT NULL AND v_user_ans = v_correct_idx THEN
        v_correct_count := v_correct_count + 1;
      END IF;

      v_explanations := v_explanations || jsonb_build_object(
        'slot', v_q.slot,
        'correct_answer', v_correct_letter,
        'explanation', v_q.explanation
      );

      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- 7. Authoritative MedTrailSR Scoring Formula (EXACT SPECIFICATION)
  v_speed_bonus := GREATEST(
    0,
    20 - FLOOR(v_time_taken_seconds::numeric / 5.0)::integer
  );

  v_score := (v_correct_count * 20) + v_speed_bonus;

  v_accuracy := ROUND(
    (v_correct_count::numeric / 5.0) * 100.0
  );

  v_xp := (v_correct_count * 50) + 50;

  -- 8. Anti-Cheat Integrity Assessment (Passive review flag only — NEVER modifies score or ranking)
  v_risk_score := COALESCE(v_session.risk_score, 0);

  IF v_risk_score >= 50 THEN
    v_review_status := 'flagged';
  ELSE
    v_review_status := 'unreviewed';
  END IF;

  -- 9. Insert Immutable Pulse Attempt
  -- Types: user_id is TEXT (v_session.user_id::text), pulse_date is TEXT (v_session.pulse_date::text)
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
      medical_college_id,
      session_id,
      risk_score,
      risk_level,
      review_status
    ) VALUES (
      v_session.pulse_id,
      v_session.pulse_date::text,
      v_session.user_id::text,
      v_effective_user_email,
      v_effective_student_name,
      v_canonical_college,
      v_canonical_batch,
      v_score,
      v_accuracy,
      v_time_taken_seconds,
      v_time_taken_seconds,
      v_xp,
      p_answers,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at,
      v_resolved_college_id,
      v_session.id,
      v_risk_score,
      v_session.risk_level,
      v_review_status
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE pulse_id = v_session.pulse_id
      AND (
        user_id = v_session.user_id::text
        OR (v_effective_user_email IS NOT NULL AND lower(user_email) = lower(v_effective_user_email))
      )
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'attempt_id', v_existing_id,
      'message', 'You have already submitted this Pulse.'
    );
  END;

  -- 10. Update Exam Session State to 'submitted'
  UPDATE public.championship_pulse_sessions
  SET status = 'submitted',
      submitted_at = v_submitted_at,
      risk_score = v_risk_score,
      updated_at = v_submitted_at
  WHERE id = v_session.id;

  -- 11. Upsert into championship_leaderboard
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
    v_session.pulse_id,
    v_session.user_id::text,
    v_effective_user_email,
    v_effective_student_name,
    v_canonical_college,
    v_canonical_batch,
    v_score,
    v_accuracy,
    v_time_taken_seconds,
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

  -- 12. Re-rank Individual Leaderboard (Strict Existing Criteria: score DESC, accuracy DESC, time ASC, submitted_at ASC)
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC
    ) AS calculated_rank
    FROM public.championship_leaderboard
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_leaderboard l
  SET rank = r.calculated_rank
  FROM ranked r
  WHERE l.id = r.id;

  -- 13. Recalculate College Standings
  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    v_session.pulse_id,
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
    ) AS medical_college_id,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    (
      SELECT student_name FROM public.championship_leaderboard l2
      WHERE l2.pulse_id = v_session.pulse_id AND l2.college = l.college
      ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
    ) AS top_scorer,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_session.pulse_id
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
    ) AS calculated_rank
    FROM public.championship_college_standings
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

  -- 14. Recalculate Batch Standings
  INSERT INTO public.championship_batch_standings (
    pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
  )
  SELECT
    v_session.pulse_id,
    l.batch,
    SUM(l.score) AS total_score,
    ROUND(AVG(l.score), 0) AS avg_score,
    ROUND(AVG(l.accuracy), 1) AS avg_accuracy,
    COUNT(*) AS participants_count,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = v_session.pulse_id
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
    ) AS calculated_rank
    FROM public.championship_batch_standings
    WHERE pulse_id = v_session.pulse_id
  )
  UPDATE public.championship_batch_standings bs
  SET rank = rb.calculated_rank
  FROM ranked_batches rb
  WHERE bs.id = rb.id;

  -- 15. Return Final Authoritative Result
  RETURN jsonb_build_object(
    'success', true,
    'already_submitted', false,
    'attempt_id', v_new_attempt_id,
    'score', v_score,
    'accuracy', v_accuracy,
    'xp', v_xp,
    'time_taken_seconds', v_time_taken_seconds,
    'submitted_at', v_submitted_at,
    'explanations', v_explanations,
    'canonical_college', v_canonical_college,
    'message', 'Attempt submitted successfully.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_pulse_attempt_atomic(UUID, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic(UUID, JSONB) TO authenticated, service_role;
