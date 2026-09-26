-- =============================================================================
-- MedTrail Championship — Competition Settings v2 (Pulse Controls)
-- Migration: 20260926_competition_settings_v2.sql
-- Extends championship_settings with pulse_status, results_published,
-- leaderboard_reset_at, and also adds time_taken_seconds to pulse_attempts.
-- Run AFTER 20260926_competition_settings.sql
-- =============================================================================

-- Add extra control keys to championship_settings
insert into public.championship_settings (key, value, label)
values
  ('pulse_status',          'upcoming',  'Pulse Status: upcoming | live | paused | ended'),
  ('results_published',     'false',     'Whether final results are visible to students (true/false)'),
  ('leaderboard_reset_at',  null,        'UTC ISO timestamp of last leaderboard reset (null = never)')
on conflict (key) do nothing;

-- Add time_taken_seconds to championship_pulse_attempts if it exists
-- (idempotent: ignore if column already exists)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'championship_pulse_attempts'
  ) then
    begin
      alter table public.championship_pulse_attempts
        add column if not exists time_taken_seconds integer not null default 0,
        add column if not exists student_name text,
        add column if not exists college text,
        alter column user_id drop not null;
    exception when others then null;
    end;
  end if;
end
$$;
