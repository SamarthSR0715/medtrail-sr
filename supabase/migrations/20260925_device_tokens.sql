-- ==============================================================================
-- MEDTRAIL CHAMPIONSHIP - FCM PUSH NOTIFICATIONS & DEVICE TOKENS MIGRATION
-- ==============================================================================

-- 1. Create device_tokens table for Android, iOS, and Web PWA
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android', 'ios', 'web')),
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

-- Enable Row Level Security
alter table public.device_tokens enable row level security;

-- Drop any previous policies
drop policy if exists "Authenticated users can manage own device tokens" on public.device_tokens;
drop policy if exists "Admins can view all device tokens" on public.device_tokens;
drop policy if exists "Service role full access on device tokens" on public.device_tokens;

-- 1. Users can view, insert, update their own device tokens
create policy "Authenticated users can manage own device tokens"
  on public.device_tokens
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Super Admin can view all registered device tokens
create policy "Admins can view all device tokens"
  on public.device_tokens
  for select
  to authenticated
  using (
    exists (
      select 1 from auth.users
      where id = auth.uid() and email = 'samarthrautrao715@gmail.com'
    )
  );

-- 3. Service role has full permissions for edge functions
grant all on public.device_tokens to service_role;
grant select, insert, update, delete on public.device_tokens to authenticated;
grant select on public.device_tokens to anon;
