-- Migration: 20260925_pulse_live_ops.sql
-- Description: Create championship_live_ops table for real-time admin operations, registration locks, live status, synced countdowns, notifications, and emergency controls.

CREATE TABLE IF NOT EXISTS public.championship_live_ops (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  registration_open BOOLEAN NOT NULL DEFAULT true,
  live_status TEXT NOT NULL DEFAULT 'published' CHECK (live_status IN ('draft', 'published', 'live', 'paused', 'ended')),
  target_date TEXT NOT NULL DEFAULT '2026-09-27',
  go_live_time TEXT NOT NULL DEFAULT '19:00',
  end_time TEXT NOT NULL DEFAULT '23:59',
  extended_minutes INTEGER NOT NULL DEFAULT 0,
  is_leaderboard_frozen BOOLEAN NOT NULL DEFAULT false,
  results_declared BOOLEAN NOT NULL DEFAULT false,
  results_declared_at TIMESTAMPTZ,
  emergency_action_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  notifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Seed initial default live ops record if not present
INSERT INTO public.championship_live_ops (
  id,
  registration_open,
  live_status,
  target_date,
  go_live_time,
  end_time,
  extended_minutes,
  is_leaderboard_frozen,
  results_declared
) VALUES (
  'singleton',
  true,
  'published',
  '2026-09-27',
  '19:00',
  '23:59',
  0,
  false,
  false
) ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.championship_live_ops ENABLE ROW LEVEL SECURITY;

-- Everyone (students and admin) can view current live ops state
CREATE POLICY "Allow public read championship_live_ops"
ON public.championship_live_ops
FOR SELECT
USING (true);

-- Anyone authenticated can update (or service role)
CREATE POLICY "Allow authenticated update championship_live_ops"
ON public.championship_live_ops
FOR ALL
USING (true)
WITH CHECK (true);
