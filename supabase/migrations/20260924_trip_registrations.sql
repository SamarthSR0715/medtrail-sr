-- Migration: Create trip_registrations table for MedTrail Trips
create table if not exists public.trip_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  full_name text not null,
  whatsapp text not null,
  mbbs_year text not null,
  gender text not null,
  emergency_contact text not null,
  trip_id text not null default 'rajgad-001',
  status text not null default 'registered'
);

-- Index for fast lookup and seat count by trip
create index if not exists idx_trip_registrations_trip_id on public.trip_registrations(trip_id);
create index if not exists idx_trip_registrations_created_at on public.trip_registrations(created_at desc);

-- Enable Row Level Security
alter table public.trip_registrations enable row level security;

-- Drop existing policies if any
drop policy if exists "Allow public insert to trip_registrations" on public.trip_registrations;
drop policy if exists "Allow public select of trip_registrations" on public.trip_registrations;
drop policy if exists "Allow authenticated update to trip_registrations" on public.trip_registrations;
drop policy if exists "Allow authenticated delete from trip_registrations" on public.trip_registrations;

-- Allow anyone (public/students) to submit a registration
create policy "Allow public insert to trip_registrations"
  on public.trip_registrations
  for insert
  to anon, authenticated
  with check (true);

-- Allow read access so seat counter and registered list work
create policy "Allow public select of trip_registrations"
  on public.trip_registrations
  for select
  to anon, authenticated
  using (true);

-- Allow authenticated users (admins) to update registration status
create policy "Allow authenticated update to trip_registrations"
  on public.trip_registrations
  for update
  to authenticated
  using (true)
  with check (true);

-- Allow authenticated users (admins) to delete registrations
create policy "Allow authenticated delete from trip_registrations"
  on public.trip_registrations
  for delete
  to authenticated
  using (true);

-- Enable realtime updates for live seat counter
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_registrations'
  ) then
    alter publication supabase_realtime add table public.trip_registrations;
  end if;
end $$;
