-- Migration: 20260925_super_admin_security.sql
-- Description: Super Admin security policies for samarthrautrao715@gmail.com,
-- Hall of Fame persistence, registration management status, and notification center.

-- 1. Helper Function: is_super_admin() and updated is_admin()
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(
    (auth.role() = 'service_role'),
    (lower(coalesce(auth.jwt() ->> 'email', '')) = 'samarthrautrao715@gmail.com'),
    (lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'email', '')) = 'samarthrautrao715@gmail.com'),
    exists (
      select 1 from auth.users
      where id = auth.uid()
        and lower(email) = 'samarthrautrao715@gmail.com'
    ),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(
    public.is_super_admin(),
    (current_setting('request.jwt.claim.role', true) = 'admin'),
    (auth.jwt() ->> 'role') = 'admin',
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean is true),
    ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean is true),
    false
  );
$$;

-- 2. Alter championship_registrations to add approval_status if not present
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'championship_registrations' and column_name = 'approval_status'
  ) then
    alter table public.championship_registrations 
      add column approval_status text not null default 'approved' 
      check (approval_status in ('approved', 'pending', 'removed'));
  end if;
end $$;

-- Policies for championship_registrations
drop policy if exists "Admin can read all registrations" on public.championship_registrations;
drop policy if exists "Admin manage registrations" on public.championship_registrations;

create policy "Admin manage registrations"
  on public.championship_registrations
  for all
  to authenticated, service_role
  using (public.is_admin())
  with check (public.is_admin());

-- 3. Hall of Fame Table
create table if not exists public.championship_hall_of_fame (
  id text primary key default 'season_1',
  season_id text not null default 'S1',
  season_title text not null default 'MedTrail Championship: Season 1',
  champion_name text not null default 'Dr. XYZ',
  college text not null default 'To be crowned after Season 1',
  batch text not null default 'Season 1 Contender',
  trophy_id text not null default 'MT-S1-001',
  winner_photo text not null default '',
  status text not null default 'in_contention',
  final_score integer not null default 0,
  accuracy_pct numeric(5,2) not null default 0,
  streak_days integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

-- Seed initial row
insert into public.championship_hall_of_fame (
  id,
  season_id,
  season_title,
  champion_name,
  college,
  batch,
  trophy_id,
  winner_photo,
  status
) values (
  'season_1',
  'S1',
  'MedTrail Championship: Season 1',
  'Dr. XYZ',
  'To be crowned after Season 1',
  'Season 1 Contender',
  'MT-S1-001',
  '',
  'in_contention'
) on conflict (id) do nothing;

alter table public.championship_hall_of_fame enable row level security;

drop policy if exists "Public view hall of fame" on public.championship_hall_of_fame;
drop policy if exists "Admin manage hall of fame" on public.championship_hall_of_fame;

create policy "Public view hall of fame"
  on public.championship_hall_of_fame
  for select
  to anon, authenticated
  using (true);

create policy "Admin manage hall of fame"
  on public.championship_hall_of_fame
  for all
  to authenticated, service_role
  using (public.is_admin())
  with check (public.is_admin());

-- 4. Notification Center Table
create table if not exists public.championship_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  emoji text not null default '📢',
  audience_type text not null check (audience_type in ('all', 'championship', 'college', 'batch', 'individual')),
  audience_target text,
  status text not null default 'sent' check (status in ('sent', 'scheduled', 'cancelled')),
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone default now(),
  created_at timestamp with time zone not null default now(),
  created_by text
);

alter table public.championship_notifications enable row level security;

drop policy if exists "Public view sent notifications" on public.championship_notifications;
drop policy if exists "Admin manage notifications" on public.championship_notifications;

create policy "Public view sent notifications"
  on public.championship_notifications
  for select
  to anon, authenticated
  using (status = 'sent');

create policy "Admin manage notifications"
  on public.championship_notifications
  for all
  to authenticated, service_role
  using (public.is_admin())
  with check (public.is_admin());

-- 5. Realtime publications
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'championship_hall_of_fame'
  ) then
    alter publication supabase_realtime add table public.championship_hall_of_fame;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'championship_notifications'
  ) then
    alter publication supabase_realtime add table public.championship_notifications;
  end if;
end $$;

-- 6. Grants
grant usage on schema public to anon, authenticated, service_role;
grant select on public.championship_hall_of_fame to anon, authenticated, service_role;
grant select on public.championship_notifications to anon, authenticated, service_role;
grant all on public.championship_hall_of_fame to service_role;
grant all on public.championship_notifications to service_role;
