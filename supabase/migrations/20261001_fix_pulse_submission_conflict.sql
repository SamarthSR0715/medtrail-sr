-- ==============================================================================
-- Migration: 20261001_fix_pulse_submission_conflict.sql
-- Description: Fix "ON CONFLICT DO UPDATE command cannot affect row a second time"
--              in submit_pulse_attempt_atomic RPC by ensuring college standings
--              are grouped strictly by college, with deterministic canonical
--              ID resolution and conflict flagging.
-- ==============================================================================

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
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_attempt_id uuid;
  v_submitted_at timestamptz := now();
  v_clean_batch text;
  v_canonical_college text;
  v_resolved_college_id uuid;
  v_conflicting_college text;
BEGIN
  -- Normalize batch
  v_clean_batch := coalesce(nullif(trim(p_batch), ''), '2026 Batch → Freshers');

  -- Resolve canonical college name and ID using medical_colleges master
  IF p_college_id IS NOT NULL THEN
    SELECT id, college_name INTO v_resolved_college_id, v_canonical_college
    FROM public.medical_colleges
    WHERE id = p_college_id;
  END IF;

  IF v_canonical_college IS NULL AND p_college IS NOT NULL AND trim(p_college) != '' THEN
    SELECT id, college_name INTO v_resolved_college_id, v_canonical_college
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(p_college))
       OR lower(college_name) LIKE '%' || lower(trim(p_college)) || '%'
    ORDER BY
      CASE WHEN lower(college_name) = lower(trim(p_college)) THEN 0
           WHEN lower(college_name) LIKE lower(trim(p_college)) || '%' THEN 1
           ELSE 2 END,
      created_at ASC,
      id ASC
    LIMIT 1;
  END IF;

  -- Fallback to provided college string if not found
  IF v_canonical_college IS NULL THEN
    v_canonical_college := coalesce(nullif(trim(p_college), ''), 'Medical College');
  END IF;

  -- 1. Check if user already submitted for this pulse
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE user_id = p_user_id AND pulse_id = p_pulse_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END IF;

  -- 2. Insert immutable attempt record
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id, pulse_date, user_id, user_email, student_name, college,
      batch, score, accuracy, time_taken_seconds, completion_time, xp,
      answers, completed_at, submitted_at, created_at, medical_college_id
    ) VALUES (
      p_pulse_id, p_pulse_date, p_user_id, p_user_email, p_student_name, v_canonical_college,
      v_clean_batch, p_score, p_accuracy, p_time_taken_seconds, p_time_taken_seconds, p_xp,
      p_answers, v_submitted_at, v_submitted_at, v_submitted_at, v_resolved_college_id
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE user_id = p_user_id AND pulse_id = p_pulse_id;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END;

  -- 3. Upsert into championship_leaderboard
  INSERT INTO public.championship_leaderboard (
    pulse_id, user_id, user_email, student_name, college, batch,
    score, accuracy, time_taken_seconds, submitted_at, updated_at, medical_college_id
  ) VALUES (
    p_pulse_id, p_user_id, p_user_email, p_student_name, v_canonical_college, v_clean_batch,
    p_score, p_accuracy, p_time_taken_seconds, v_submitted_at, v_submitted_at, v_resolved_college_id
  )
  ON CONFLICT (user_id, pulse_id) DO UPDATE SET
    score = EXCLUDED.score,
    accuracy = EXCLUDED.accuracy,
    time_taken_seconds = EXCLUDED.time_taken_seconds,
    college = EXCLUDED.college,
    medical_college_id = EXCLUDED.medical_college_id,
    updated_at = v_submitted_at;

  -- 3b. Backfill missing medical_college_id only when canonical association is verified and unambiguous
  IF v_resolved_college_id IS NOT NULL THEN
    UPDATE public.championship_leaderboard
    SET medical_college_id = v_resolved_college_id
    WHERE pulse_id = p_pulse_id
      AND college = v_canonical_college
      AND medical_college_id IS NULL;
  END IF;

  -- 4. Re-rank individual leaderboard for this pulse_id
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

  -- 5. Recalculate College Standings (Strictly 1 row per (college, pulse_id))
  -- Detect and flag any conflicting non-NULL canonical IDs
  FOR v_conflicting_college IN
    SELECT l.college
    FROM public.championship_leaderboard l
    WHERE l.pulse_id = p_pulse_id
    GROUP BY l.college
    HAVING COUNT(DISTINCT l.medical_college_id) > 1
  LOOP
    RAISE WARNING 'Conflict detected in pulse % for college "%": multiple distinct medical_college_id entries exist', p_pulse_id, v_conflicting_college;
  END LOOP;

  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    p_pulse_id,
    l.college,
    -- Resolve canonical ID:
    -- 1. Exact match from master medical_colleges table
    -- 2. If no exact match and all non-NULL IDs in leaderboard are identical (COUNT DISTINCT = 1), use that single ID
    -- 3. If conflicting non-NULL IDs exist (COUNT DISTINCT > 1), do NOT pick an arbitrary ID (set NULL to flag/preserve existing)
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

  -- 6. Recalculate Batch Standings
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

GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic TO anon, authenticated, service_role;
