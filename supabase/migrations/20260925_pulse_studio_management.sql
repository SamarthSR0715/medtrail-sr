-- =============================================================================
-- Migration: Pulse Question Management — Admin Control & Pulse Studio
-- =============================================================================
-- Tables:
--   1. championship_pulse_sets (Admin-curated daily Pulse sets)
--   2. championship_pulse_questions (Individual questions per slot)
--   3. championship_pulse_attempts (Student attempts tracking)
-- =============================================================================

-- 1. Create championship_pulse_sets
create table if not exists public.championship_pulse_sets (
  id uuid primary key default gen_random_uuid(),
  pulse_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  questions jsonb not null default '[]'::jsonb,
  published_at timestamp with time zone,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint unique_pulse_set_date unique (pulse_date)
);

-- Partial unique index: Only one published set per date
create unique index if not exists idx_champ_pulse_sets_published_unique 
  on public.championship_pulse_sets (pulse_date) 
  where status = 'published';

create index if not exists idx_champ_pulse_sets_date on public.championship_pulse_sets(pulse_date desc);
create index if not exists idx_champ_pulse_sets_status on public.championship_pulse_sets(status);

-- 2. Create championship_pulse_questions table
create table if not exists public.championship_pulse_questions (
  id uuid primary key default gen_random_uuid(),
  pulse_set_id uuid references public.championship_pulse_sets(id) on delete cascade,
  pulse_date date not null,
  slot integer not null check (slot between 1 and 5),
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer text not null check (correct_answer in ('A', 'B', 'C', 'D')),
  explanation text not null,
  subject text not null check (subject in ('Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'General')),
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  xp_value integer not null default 50,
  created_at timestamp with time zone not null default now(),
  constraint unique_pulse_set_slot unique (pulse_set_id, slot)
);

create index if not exists idx_pulse_q_date_slot on public.championship_pulse_questions(pulse_date, slot);

-- 3. Create championship_pulse_attempts table (Students can attempt only once per date)
create table if not exists public.championship_pulse_attempts (
  id uuid primary key default gen_random_uuid(),
  pulse_date date not null,
  user_id uuid references auth.users(id) on delete cascade,
  user_email text,
  participant_id uuid references public.championship_participants(id) on delete set null,
  score integer not null default 0,
  xp_earned integer not null default 0,
  accuracy numeric(5,2) not null default 0,
  answers jsonb not null default '[]'::jsonb,
  completed_at timestamp with time zone not null default now(),
  constraint unique_user_pulse_date unique (user_id, pulse_date)
);

create index if not exists idx_pulse_attempts_user on public.championship_pulse_attempts(user_id);
create index if not exists idx_pulse_attempts_date on public.championship_pulse_attempts(pulse_date);

-- 4. Enable Row Level Security (RLS)
alter table public.championship_pulse_sets enable row level security;
alter table public.championship_pulse_questions enable row level security;
alter table public.championship_pulse_attempts enable row level security;

-- Drop existing policies if any
drop policy if exists "Admin manage pulse sets" on public.championship_pulse_sets;
drop policy if exists "Public view published pulse sets" on public.championship_pulse_sets;
drop policy if exists "Admin manage pulse questions" on public.championship_pulse_questions;
drop policy if exists "Public view published pulse questions" on public.championship_pulse_questions;
drop policy if exists "Users view own pulse attempts" on public.championship_pulse_attempts;
drop policy if exists "Users insert own pulse attempt" on public.championship_pulse_attempts;

-- RLS: Pulse Sets
-- Admin can do everything
create policy "Admin manage pulse sets"
  on public.championship_pulse_sets
  for all
  to authenticated, service_role
  using (public.is_admin())
  with check (public.is_admin());

-- Students and public can view only published sets
create policy "Public view published pulse sets"
  on public.championship_pulse_sets
  for select
  to anon, authenticated
  using (status = 'published');

-- RLS: Pulse Questions
create policy "Admin manage pulse questions"
  on public.championship_pulse_questions
  for all
  to authenticated, service_role
  using (public.is_admin())
  with check (public.is_admin());

create policy "Public view published pulse questions"
  on public.championship_pulse_questions
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.championship_pulse_sets s
      where s.id = pulse_set_id and s.status = 'published'
    )
  );

-- RLS: Pulse Attempts
-- Students can only view their own attempts (or admin can view all)
create policy "Users view own pulse attempts"
  on public.championship_pulse_attempts
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Students can insert only their own attempt
create policy "Users insert own pulse attempt"
  on public.championship_pulse_attempts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Grants
grant usage on schema public to anon, authenticated, service_role;
grant select on public.championship_pulse_sets to anon, authenticated, service_role;
grant select on public.championship_pulse_questions to anon, authenticated, service_role;
grant select, insert on public.championship_pulse_attempts to authenticated, anon;
grant all on public.championship_pulse_sets to service_role;
grant all on public.championship_pulse_questions to service_role;
grant all on public.championship_pulse_attempts to service_role;
