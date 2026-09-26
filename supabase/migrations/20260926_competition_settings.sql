-- =============================================================================
-- MedTrail Championship — Competition Settings (Dynamic Date Configuration)
-- Migration: 20260926_competition_settings.sql
-- Stores global configuration values like competition_date that can be
-- updated from the admin panel without code changes.
-- =============================================================================

-- Key-value store for championship global settings.
create table if not exists public.championship_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  value       text,
  label       text,
  updated_at  timestamp with time zone not null default now(),
  updated_by  text
);

-- Auto-update timestamp trigger
create or replace function public.update_championship_settings_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_championship_settings_updated_at on public.championship_settings;
create trigger trg_championship_settings_updated_at
  before update on public.championship_settings
  for each row execute function public.update_championship_settings_timestamp();

-- Seed default values
insert into public.championship_settings (key, value, label)
values
  ('competition_date',     '2026-09-27T13:30:00.000Z', 'Season Start Date and Time (UTC ISO 8601)'),
  ('competition_end_date', '2026-10-17T13:30:00.000Z', 'Season End Date and Time (UTC ISO 8601)')
on conflict (key) do nothing;

-- Row Level Security
alter table public.championship_settings enable row level security;

-- Public read (student-facing site can read competition dates)
create policy "championship_settings_public_read"
  on public.championship_settings
  for select
  using (true);

-- Only authenticated users can update/insert (further restricted to super admin in app layer)
create policy "championship_settings_admin_write"
  on public.championship_settings
  for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
