-- =============================================================================
-- Migration: Create championship_registrations table with Row Level Security
-- =============================================================================
-- Columns:
--   - id (UUID, Primary Key)
--   - full_name (TEXT)
--   - email (TEXT)
--   - medical_college (TEXT)
--   - batch (TEXT)
--   - passport_id (TEXT, nullable)
--   - created_at (TIMESTAMPTZ, default now())
--
-- Row Level Security:
--   - Users can insert only their own registration.
--   - Admin can read all registrations.
-- =============================================================================

-- 1. Create table in public schema
create table if not exists public.championship_registrations (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  medical_college text not null,
  batch text not null,
  passport_id text,
  created_at timestamp with time zone not null default now()
);

-- 2. Indexes for fast lookup and sorting (preventing duplicate email registrations)
create unique index if not exists idx_champ_reg_email_unique on public.championship_registrations (lower(email));
create index if not exists idx_champ_reg_created_at on public.championship_registrations(created_at desc);

-- 3. Enable Row Level Security
alter table public.championship_registrations enable row level security;

-- 4. Helper function to identify admin users
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(
    (auth.role() = 'service_role'),
    (current_setting('request.jwt.claim.role', true) = 'admin'),
    (auth.jwt() ->> 'role') = 'admin',
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean is true),
    ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean is true),
    (auth.jwt() ->> 'email') ilike '%admin%',
    exists (
      select 1 from auth.users
      where id = auth.uid()
        and (
          raw_app_meta_data->>'role' = 'admin'
          or raw_user_meta_data->>'role' = 'admin'
          or (raw_user_meta_data->>'is_admin')::boolean is true
          or email ilike '%admin%'
        )
    ),
    false
  );
$$;

-- 5. Drop existing policies if any
drop policy if exists "Users can insert only their own registration" on public.championship_registrations;
drop policy if exists "Admin can read all registrations" on public.championship_registrations;
drop policy if exists "Public insert championship_registrations" on public.championship_registrations;
drop policy if exists "Public read championship_registrations" on public.championship_registrations;
drop policy if exists "Users can insert own registration" on public.championship_registrations;

-- 6. Policy: Users can insert only their own registration
create policy "Users can insert only their own registration"
  on public.championship_registrations
  for insert
  to anon, authenticated
  with check (
    -- When authenticated, ensure the registration email matches the authenticated user's email
    (auth.role() = 'authenticated' and (
      lower(email) = lower(auth.jwt() ->> 'email')
      or (auth.jwt() ->> 'email') is null
    ))
    -- Or anonymous student submitting their registration
    or auth.role() = 'anon'
  );

-- 7. Policy: Admin can read all registrations
create policy "Admin can read all registrations"
  on public.championship_registrations
  for select
  to authenticated, service_role
  using (
    (auth.jwt() ->> 'role') = 'admin'
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    or ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean is true)
    or (auth.jwt() ->> 'email') ilike '%admin%'
    or auth.role() = 'service_role'
    or public.is_admin()
  );

-- 8. Grant permissions
grant usage on schema public to anon, authenticated, service_role;
grant select, insert on public.championship_registrations to anon, authenticated, service_role;
grant all on public.championship_registrations to service_role;

-- 9. Realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'championship_registrations'
  ) then
    alter publication supabase_realtime add table public.championship_registrations;
  end if;
end $$;
