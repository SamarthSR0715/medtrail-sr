-- ==============================================================================
-- MEDTRAIL CHAMPIONSHIP - PULSE SETTINGS & DEVICE TOKENS MIGRATION
-- Single source of truth for Pulse Schedule, State & Push Notification Devices
-- ==============================================================================

-- 1. Create pulse_settings table
create table if not exists public.pulse_settings (
  id text primary key default 'singleton',
  competition_date text, -- Stored as YYYY-MM-DD or ISO string
  start_time text default '19:00', -- HH:mm (e.g. 19:00)
  end_time text default '23:59',   -- HH:mm (e.g. 23:59)
  pulse_status text not null default 'upcoming' check (pulse_status in ('upcoming', 'live', 'paused', 'ended')),
  results_published boolean not null default false,
  updated_at timestamp with time zone not null default now()
);

-- Insert singleton default row if not exists
insert into public.pulse_settings (id, competition_date, start_time, end_time, pulse_status, results_published)
values ('singleton', to_char(current_date, 'YYYY-MM-DD'), '19:00', '23:59', 'upcoming', false)
on conflict (id) do update set
  updated_at = now();

-- Enable RLS & Realtime
alter table public.pulse_settings enable row level security;

drop policy if exists "Allow public read access to pulse_settings" on public.pulse_settings;
create policy "Allow public read access to pulse_settings"
  on public.pulse_settings for select
  to public
  using (true);

drop policy if exists "Allow public all access on pulse_settings" on public.pulse_settings;
create policy "Allow public all access on pulse_settings"
  on public.pulse_settings for all
  to public
  using (true)
  with check (true);

grant all on public.pulse_settings to anon, authenticated, service_role;

-- 2. Create device_tokens table
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  token text not null unique,
  platform text not null default 'web',
  device_info jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_used_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Indexes for lightning fast lookups & broadcasts
create index if not exists idx_device_tokens_user on public.device_tokens(user_id);
create index if not exists idx_device_tokens_platform on public.device_tokens(platform);
create index if not exists idx_device_tokens_active on public.device_tokens(is_active);

alter table public.device_tokens enable row level security;

drop policy if exists "Allow public read access to device_tokens" on public.device_tokens;
create policy "Allow public read access to device_tokens"
  on public.device_tokens for select
  to public
  using (true);

drop policy if exists "Allow public all access on device_tokens" on public.device_tokens;
create policy "Allow public all access on device_tokens"
  on public.device_tokens for all
  to public
  using (true)
  with check (true);

grant all on public.device_tokens to anon, authenticated, service_role;

-- Add realtime publication support
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'pulse_settings'
  ) then
    alter publication supabase_realtime add table public.pulse_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'device_tokens'
  ) then
    alter publication supabase_realtime add table public.device_tokens;
  end if;
exception
  when others then null;
end $$;
