-- =============================================================================
-- MedTrail — app_settings table
-- Migration: 20260926_app_settings.sql
-- Key-value table for global application settings (competition_date, etc.)
-- =============================================================================

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamp with time zone not null default now()
);

-- Enable Row Level Security
alter table public.app_settings enable row level security;

-- Policies: allow public read and write access
drop policy if exists "Allow public read on app_settings" on public.app_settings;
create policy "Allow public read on app_settings"
  on public.app_settings
  for select
  using (true);

drop policy if exists "Allow insert on app_settings" on public.app_settings;
create policy "Allow insert on app_settings"
  on public.app_settings
  for insert
  with check (true);

drop policy if exists "Allow update on app_settings" on public.app_settings;
create policy "Allow update on app_settings"
  on public.app_settings
  for update
  using (true)
  with check (true);

drop policy if exists "Allow delete on app_settings" on public.app_settings;
create policy "Allow delete on app_settings"
  on public.app_settings
  for delete
  using (true);

-- Enable Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
exception when others then null;
end
$$;
