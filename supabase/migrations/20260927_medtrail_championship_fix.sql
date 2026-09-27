-- ==============================================================================
-- Migration: 20260927_medtrail_championship_fix.sql
-- Fix MedTrail Championship System:
--   - Dynamic pulse_settings singleton & public access
--   - Result history columns on championship_pulse_attempts
--   - Unique constraint on (user_id, pulse_id) to strictly enforce one attempt
--   - Immutability trigger for attempt history
--   - Dedicated leaderboard, college standings, and batch standings tables
--   - Atomic submit_pulse_attempt_atomic RPC function
--   - Realtime publication on all active tables
-- ==============================================================================

-- 1. Ensure pulse_settings table has all required columns and permissions
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS competition_end_date text;

-- Allow anon and authenticated to read pulse_settings
DROP POLICY IF EXISTS "Public read pulse_settings" ON public.pulse_settings;
DROP POLICY IF EXISTS "Authenticated users can view pulse settings" ON public.pulse_settings;
CREATE POLICY "Public read pulse_settings" ON public.pulse_settings FOR SELECT TO anon, authenticated USING (true);

-- Ensure default singleton row exists in pulse_settings
INSERT INTO public.pulse_settings (competition_date, competition_end_date, start_time, end_time, pulse_status, results_published)
SELECT '2026-09-27', '2026-10-17', '19:00:00', '23:59:00', 'upcoming', false
WHERE NOT EXISTS (SELECT 1 FROM public.pulse_settings);

-- 2. Ensure championship_pulse_attempts has all required columns
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS pulse_id text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS batch text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS completion_time numeric DEFAULT 0;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();

-- Backfill pulse_id, submitted_at, completion_time
UPDATE public.championship_pulse_attempts SET pulse_id = pulse_date WHERE pulse_id IS NULL;
UPDATE public.championship_pulse_attempts SET submitted_at = completed_at WHERE submitted_at IS NULL;
UPDATE public.championship_pulse_attempts SET completion_time = time_taken_seconds WHERE completion_time IS NULL OR completion_time = 0;

-- Deduplicate any existing duplicate attempts on (user_id, pulse_id) before adding unique constraint
DELETE FROM public.championship_pulse_attempts a
WHERE a.id NOT IN (
  SELECT min(id::text)::uuid
  FROM public.championship_pulse_attempts
  GROUP BY user_id, coalesce(pulse_id, pulse_date)
);

-- Add unique constraint on (user_id, pulse_id)
ALTER TABLE public.championship_pulse_attempts DROP CONSTRAINT IF EXISTS unique_user_pulse;
ALTER TABLE public.championship_pulse_attempts ADD CONSTRAINT unique_user_pulse UNIQUE (user_id, pulse_id);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pulse_attempts_user_pulse ON public.championship_pulse_attempts (user_id, pulse_id);

-- Update RLS on championship_pulse_attempts
DROP POLICY IF EXISTS "Public read pulse_attempts" ON public.championship_pulse_attempts;
CREATE POLICY "Public read pulse_attempts" ON public.championship_pulse_attempts FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Users insert own pulse attempt" ON public.championship_pulse_attempts;
CREATE POLICY "Users insert own pulse attempt" ON public.championship_pulse_attempts FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Immutability trigger: prevent UPDATE and DELETE on championship_pulse_attempts
CREATE OR REPLACE FUNCTION public.check_attempt_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    RAISE EXCEPTION 'Championship attempt history is immutable.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_pulse_attempts ON public.championship_pulse_attempts;
CREATE TRIGGER trg_immutable_pulse_attempts
  BEFORE UPDATE OR DELETE ON public.championship_pulse_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.check_attempt_immutability();

-- 3. Leaderboard Aggregates Table
CREATE TABLE IF NOT EXISTS public.championship_leaderboard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id text NOT NULL DEFAULT 'S1',
  pulse_id text NOT NULL,
  user_id text NOT NULL,
  user_email text,
  student_name text NOT NULL,
  college text NOT NULL,
  batch text NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  accuracy numeric NOT NULL DEFAULT 0,
  time_taken_seconds numeric NOT NULL DEFAULT 0,
  rank integer DEFAULT 0,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_leaderboard_user_pulse UNIQUE (user_id, pulse_id)
);

CREATE INDEX IF NOT EXISTS idx_champ_leaderboard_pulse ON public.championship_leaderboard (pulse_id, score DESC, accuracy DESC, time_taken_seconds ASC);

-- 4. College Standings Table
CREATE TABLE IF NOT EXISTS public.championship_college_standings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id text NOT NULL DEFAULT 'S1',
  pulse_id text NOT NULL,
  college text NOT NULL,
  total_score numeric NOT NULL DEFAULT 0,
  avg_score numeric NOT NULL DEFAULT 0,
  avg_accuracy numeric NOT NULL DEFAULT 0,
  participants_count integer NOT NULL DEFAULT 0,
  top_scorer text,
  rank integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_college_pulse UNIQUE (college, pulse_id)
);

-- 5. Batch Standings Table
CREATE TABLE IF NOT EXISTS public.championship_batch_standings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id text NOT NULL DEFAULT 'S1',
  pulse_id text NOT NULL,
  batch text NOT NULL,
  total_score numeric NOT NULL DEFAULT 0,
  avg_score numeric NOT NULL DEFAULT 0,
  avg_accuracy numeric NOT NULL DEFAULT 0,
  participants_count integer NOT NULL DEFAULT 0,
  rank integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_batch_pulse UNIQUE (batch, pulse_id)
);

-- Enable RLS on standings tables
ALTER TABLE public.championship_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_college_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_batch_standings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read championship_leaderboard" ON public.championship_leaderboard;
CREATE POLICY "Public read championship_leaderboard" ON public.championship_leaderboard FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read championship_college_standings" ON public.championship_college_standings;
CREATE POLICY "Public read championship_college_standings" ON public.championship_college_standings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read championship_batch_standings" ON public.championship_batch_standings;
CREATE POLICY "Public read championship_batch_standings" ON public.championship_batch_standings FOR SELECT TO anon, authenticated USING (true);

-- 6. Atomic Submission and Leaderboard Aggregation Function
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
  p_answers jsonb
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
BEGIN
  -- Normalize batch
  v_clean_batch := coalesce(nullif(trim(p_batch), ''), '2026 Batch → Freshers');

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
      answers, completed_at, submitted_at, created_at
    ) VALUES (
      p_pulse_id, p_pulse_date, p_user_id, p_user_email, p_student_name, p_college,
      v_clean_batch, p_score, p_accuracy, p_time_taken_seconds, p_time_taken_seconds, p_xp,
      p_answers, v_submitted_at, v_submitted_at, v_submitted_at
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: another device submitted simultaneously
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
    score, accuracy, time_taken_seconds, submitted_at, updated_at
  ) VALUES (
    p_pulse_id, p_user_id, p_user_email, p_student_name, p_college, v_clean_batch,
    p_score, p_accuracy, p_time_taken_seconds, v_submitted_at, v_submitted_at
  )
  ON CONFLICT (user_id, pulse_id) DO UPDATE SET
    score = EXCLUDED.score,
    accuracy = EXCLUDED.accuracy,
    time_taken_seconds = EXCLUDED.time_taken_seconds,
    updated_at = v_submitted_at;

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

  -- 5. Recalculate College Standings
  INSERT INTO public.championship_college_standings (
    pulse_id, college, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    p_pulse_id,
    l.college,
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
    'accuracy', p_accuracy
  );
END;
$$;

-- Grant permissions to execute function
GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic TO anon, authenticated, service_role;

-- 7. Add tables to Supabase Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_pulse_attempts;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_leaderboard;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_college_standings;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_batch_standings;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pulse_settings;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_live_ops;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
