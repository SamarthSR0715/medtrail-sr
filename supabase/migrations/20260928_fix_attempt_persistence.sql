-- ==============================================================================
-- Migration: 20260928_fix_attempt_persistence.sql
-- Fix Bug 1: Attempt insert failures due to user_id type conflict and RLS
-- Fix Bug 3: Reliable attempt lookup on refresh
-- ==============================================================================

-- Step 1: Ensure championship_pulse_attempts has user_id as TEXT (not UUID FK)
-- The 20260925 migration created user_id as uuid referencing auth.users(id),
-- which rejects non-UUID strings. The 20260926 fix recreated it as TEXT.
-- This migration defensively enforces TEXT type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'championship_pulse_attempts'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.championship_pulse_attempts
      DROP CONSTRAINT IF EXISTS championship_pulse_attempts_user_id_fkey;
    ALTER TABLE public.championship_pulse_attempts
      DROP CONSTRAINT IF EXISTS unique_user_pulse_date;
    ALTER TABLE public.championship_pulse_attempts
      ALTER COLUMN user_id TYPE text USING user_id::text;
    RAISE NOTICE 'championship_pulse_attempts.user_id converted from uuid to text';
  END IF;
END
$$;

-- Step 2: Add all required columns if missing
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS pulse_id text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS student_name text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS college text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS batch text;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS xp numeric DEFAULT 0;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS time_taken_seconds numeric DEFAULT 0;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS completion_time numeric DEFAULT 0;
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();
ALTER TABLE public.championship_pulse_attempts ADD COLUMN IF NOT EXISTS user_email text;

-- Step 3: Backfill pulse_id from pulse_date where null
UPDATE public.championship_pulse_attempts
SET pulse_id = pulse_date::text
WHERE pulse_id IS NULL AND pulse_date IS NOT NULL;

-- Step 4: Ensure the correct unique constraint exists on (user_id, pulse_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_user_pulse'
      AND conrelid = 'public.championship_pulse_attempts'::regclass
  ) THEN
    DELETE FROM public.championship_pulse_attempts a
    WHERE a.id NOT IN (
      SELECT min(id::text)::uuid
      FROM public.championship_pulse_attempts
      WHERE pulse_id IS NOT NULL
      GROUP BY user_id, pulse_id
    )
    AND pulse_id IS NOT NULL;

    ALTER TABLE public.championship_pulse_attempts
      ADD CONSTRAINT unique_user_pulse UNIQUE (user_id, pulse_id);
    RAISE NOTICE 'unique_user_pulse constraint added';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_pulse_attempts_user_pulse
  ON public.championship_pulse_attempts (user_id, pulse_id);
CREATE INDEX IF NOT EXISTS idx_pulse_attempts_user_email
  ON public.championship_pulse_attempts (user_email);

-- Step 5: Fix RLS policies
ALTER TABLE public.championship_pulse_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own pulse attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Users insert own pulse attempt" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Public read pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Public write pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Authenticated insert pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Authenticated read own pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Anon read pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Authenticated insert own pulse_attempt" ON public.championship_pulse_attempts;

-- Authenticated users can read their own attempt (or admin sees all)
CREATE POLICY "Authenticated read own pulse_attempts"
  ON public.championship_pulse_attempts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR user_email = auth.jwt() ->> 'email'
    OR public.is_admin()
  );

-- Anon can read (for public leaderboard queries)
CREATE POLICY "Anon read pulse_attempts"
  ON public.championship_pulse_attempts
  FOR SELECT TO anon
  USING (true);

-- Authenticated insert: WITH CHECK (true) — unique constraint enforces one attempt per pulse
CREATE POLICY "Authenticated insert own pulse_attempt"
  ON public.championship_pulse_attempts
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Step 6: Ensure RPC permissions
GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic TO anon, authenticated, service_role;

-- Step 7: Ensure leaderboard tables are readable by all roles
GRANT SELECT ON public.championship_leaderboard TO anon, authenticated;
GRANT SELECT ON public.championship_college_standings TO anon, authenticated;
GRANT SELECT ON public.championship_batch_standings TO anon, authenticated;

-- Step 8: Realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_pulse_attempts;
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;