-- ==============================================================================
-- MedTrail Championship — Dynamic Championship Settings
-- Migration: 20260928_championship_settings.sql
-- Store registration_start, pulse_start, pulse_end, season_end as single source of truth
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.championship_settings (
  id text PRIMARY KEY DEFAULT 'singleton',
  registration_start timestamptz,
  pulse_start timestamptz,
  pulse_end timestamptz,
  season_end timestamptz,
  pulse_status text NOT NULL DEFAULT 'upcoming',
  results_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed singleton row if none exists
INSERT INTO public.championship_settings (
  id,
  registration_start,
  pulse_start,
  pulse_end,
  season_end,
  pulse_status,
  results_published
)
VALUES (
  'singleton',
  '2026-09-28T09:00:00+05:30'::timestamptz,
  '2026-09-28T19:00:00+05:30'::timestamptz,
  '2026-09-28T23:59:00+05:30'::timestamptz,
  '2026-10-17T23:59:00+05:30'::timestamptz,
  'upcoming',
  false
)
ON CONFLICT (id) DO UPDATE SET
  updated_at = now();

-- Enable RLS
ALTER TABLE public.championship_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read
DROP POLICY IF EXISTS "championship_settings_read_policy" ON public.championship_settings;
CREATE POLICY "championship_settings_read_policy"
  ON public.championship_settings FOR SELECT
  TO public
  USING (true);

-- Allow public write / admin update
DROP POLICY IF EXISTS "championship_settings_write_policy" ON public.championship_settings;
CREATE POLICY "championship_settings_write_policy"
  ON public.championship_settings FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.championship_settings TO anon, authenticated, service_role;

-- Realtime Publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'championship_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_settings;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
