-- =============================================================================
-- MedTrail Championship Season 1 — Database Schema
-- Migration: 20260925_championship_season1.sql
-- Event timezone: Asia/Kolkata (IST, UTC+5:30)
-- Season start UTC: 2026-09-27 13:30:00Z  (7:00 PM IST)
-- Season end   UTC: 2026-10-17 13:30:00Z  (7:00 PM IST)
-- Rules version: S1-v1.0
-- =============================================================================

-- ── 1. championship_participants ─────────────────────────────────────────────
-- One row per authenticated user per season. Records consent, profile, and
-- eligibility confirmation with policy version and UTC timestamp.

create table if not exists public.championship_participants (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  season_id             text not null default 'S1',

  -- Public display
  display_name          text not null,
  display_name_type     text not null check (display_name_type in ('full_name','display_name','pseudonym')),

  -- Profile (stored privately, never exposed on leaderboard)
  full_name             text not null,
  student_id            text,
  institution           text not null,
  country               text not null default 'India',

  -- Public leaderboard permissions
  show_institution      boolean not null default false,
  show_country          boolean not null default false,
  show_score            boolean not null default true,

  -- Status
  status                text not null default 'active'
                          check (status in ('active','suspended','disqualified','withdrawn')),

  -- Consent (GDPR / competition rules)
  consent_policy_version  text not null default 'S1-v1.0',
  consent_given_at        timestamp with time zone not null default now(),
  rules_accepted          boolean not null default false,
  fair_play_accepted      boolean not null default false,
  privacy_accepted        boolean not null default false,
  eligibility_confirmed   boolean not null default false,
  info_accurate_confirmed boolean not null default false,
  parental_consent        boolean,           -- null = not a minor
  is_minor                boolean not null default false,

  -- Competition state
  total_score           integer not null default 0,
  total_pulses_done     integer not null default 0,
  total_accuracy_pct    numeric(5,2) not null default 0,
  current_streak        integer not null default 0,
  last_active_at        timestamp with time zone,

  -- Timestamps
  registered_at         timestamp with time zone not null default now(),
  created_at            timestamp with time zone not null default now(),
  updated_at            timestamp with time zone not null default now(),

  -- Uniqueness: one registration per user per season
  unique (user_id, season_id)
);

create index if not exists idx_champ_participants_user   on public.championship_participants(user_id);
create index if not exists idx_champ_participants_season on public.championship_participants(season_id);
create index if not exists idx_champ_participants_score  on public.championship_participants(total_score desc);
create index if not exists idx_champ_participants_status on public.championship_participants(status);

-- ── 2. championship_pulse_completions ────────────────────────────────────────
-- Server-authoritative record of every pulse attempt and result.
-- Idempotency key prevents duplicates from retries.

create table if not exists public.championship_pulse_completions (
  id                  uuid primary key default gen_random_uuid(),
  idempotency_key     text not null unique,   -- client-generated, prevents duplicate submissions
  participant_id      uuid not null references public.championship_participants(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  season_id           text not null default 'S1',

  -- Pulse identity
  pulse_date          date not null,          -- IST date (server-computed)
  pulse_slot          integer not null check (pulse_slot between 1 and 5),
  pulse_type          text not null check (pulse_type in ('mbbs','general')),  -- slot 5 = general
  pulse_category      text,                   -- e.g. 'anatomy','physiology','sports'

  -- Submission
  submitted_at        timestamp with time zone not null default now(),
  time_taken_seconds  integer,

  -- Validation
  validation_status   text not null default 'pending'
                        check (validation_status in ('pending','valid','rejected','flagged')),
  validated_at        timestamp with time zone,
  rejection_reason    text,

  -- Scoring (server-computed)
  score_awarded       integer not null default 0,
  max_score           integer not null default 100,
  accuracy_pct        numeric(5,2),
  answers_correct     integer,
  answers_total       integer,

  -- Anti-cheat signals
  is_suspicious       boolean not null default false,
  is_duplicate        boolean not null default false,

  created_at          timestamp with time zone not null default now(),

  -- One pulse per slot per day per participant
  unique (participant_id, pulse_date, pulse_slot)
);

create index if not exists idx_pulse_participant   on public.championship_pulse_completions(participant_id);
create index if not exists idx_pulse_user          on public.championship_pulse_completions(user_id);
create index if not exists idx_pulse_date          on public.championship_pulse_completions(pulse_date desc);
create index if not exists idx_pulse_validation    on public.championship_pulse_completions(validation_status);
create index if not exists idx_pulse_season        on public.championship_pulse_completions(season_id, pulse_date);

-- ── 3. championship_disputes ─────────────────────────────────────────────────

create table if not exists public.championship_disputes (
  id                  uuid primary key default gen_random_uuid(),
  reference_number    text not null unique default ('MT-S1-DIS-' || upper(substring(gen_random_uuid()::text, 1, 8))),
  participant_id      uuid not null references public.championship_participants(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- What is disputed
  dispute_type        text not null
                        check (dispute_type in (
                          'missing_submission','incorrect_score','incorrect_rank',
                          'duplicate_error','disqualification','privacy_display',
                          'pulse_allocation','technical_issue','other'
                        )),
  affected_event_id   uuid,    -- pulse_completion id or null
  description         text not null,
  evidence_notes      text,

  -- Status lifecycle
  status              text not null default 'submitted'
                        check (status in ('submitted','under_review','resolved','rejected','escalated')),
  submitted_at        timestamp with time zone not null default now(),
  deadline_at         timestamp with time zone not null
                        default (now() + interval '72 hours'),
  reviewed_at         timestamp with time zone,
  reviewer_notes      text,
  decision            text,
  correction_applied  boolean not null default false,

  created_at          timestamp with time zone not null default now(),
  updated_at          timestamp with time zone not null default now()
);

create index if not exists idx_disputes_participant on public.championship_disputes(participant_id);
create index if not exists idx_disputes_status      on public.championship_disputes(status);

-- ── 4. championship_audit_log ────────────────────────────────────────────────
-- Tamper-resistant append-only audit trail. No updates or deletes permitted.

create table if not exists public.championship_audit_log (
  id                  uuid primary key default gen_random_uuid(),
  occurred_at         timestamp with time zone not null default now(),
  event_type          text not null,
  participant_id      uuid,
  user_id             uuid,
  affected_record_id  uuid,
  season_id           text not null default 'S1',
  policy_version      text not null default 'S1-v1.0',
  actor               text,      -- 'participant', 'system', 'admin'
  result              text,
  reason              text,
  metadata            jsonb
);

create index if not exists idx_audit_participant   on public.championship_audit_log(participant_id);
create index if not exists idx_audit_occurred      on public.championship_audit_log(occurred_at desc);
create index if not exists idx_audit_event_type    on public.championship_audit_log(event_type);

-- ── 5. Row Level Security ─────────────────────────────────────────────────────

alter table public.championship_participants     enable row level security;
alter table public.championship_pulse_completions enable row level security;
alter table public.championship_disputes         enable row level security;
alter table public.championship_audit_log        enable row level security;

-- Drop old if re-running
drop policy if exists "participants_select_public"    on public.championship_participants;
drop policy if exists "participants_insert_own"       on public.championship_participants;
drop policy if exists "participants_update_own"       on public.championship_participants;
drop policy if exists "pulses_select_own"             on public.championship_pulse_completions;
drop policy if exists "pulses_insert_own"             on public.championship_pulse_completions;
drop policy if exists "disputes_select_own"           on public.championship_disputes;
drop policy if exists "disputes_insert_own"           on public.championship_disputes;
drop policy if exists "audit_select_own"              on public.championship_audit_log;

-- Participants: public leaderboard read (non-sensitive fields only via view)
create policy "participants_select_public"
  on public.championship_participants for select
  to anon, authenticated
  using (status = 'active');

-- Participants: authenticated users can insert their own row
create policy "participants_insert_own"
  on public.championship_participants for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Participants: authenticated users can update their own row
create policy "participants_update_own"
  on public.championship_participants for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Pulse completions: participant can see their own
create policy "pulses_select_own"
  on public.championship_pulse_completions for select
  to authenticated
  using (auth.uid() = user_id);

-- Pulse completions: participant can insert (server validates server-side via trigger/function)
create policy "pulses_insert_own"
  on public.championship_pulse_completions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Disputes: participant sees their own
create policy "disputes_select_own"
  on public.championship_disputes for select
  to authenticated
  using (auth.uid() = user_id);

-- Disputes: participant can file
create policy "disputes_insert_own"
  on public.championship_disputes for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Audit log: participant can see their own events
create policy "audit_select_own"
  on public.championship_audit_log for select
  to authenticated
  using (auth.uid() = user_id);

-- ── 6. Leaderboard view (no PII exposed) ────────────────────────────────────

create or replace view public.championship_leaderboard as
select
  p.id                                                          as participant_id,
  case when p.show_score        then p.display_name         else '—' end as display_name,
  case when p.show_institution  then p.institution          else null end as institution,
  case when p.show_country      then p.country              else null end as country,
  case when p.show_score        then p.total_score          else null end as total_score,
  case when p.show_score        then p.total_pulses_done    else null end as total_pulses_done,
  case when p.show_score        then p.total_accuracy_pct   else null end as total_accuracy_pct,
  p.current_streak,
  p.last_active_at,
  row_number() over (
    order by p.total_score desc,
             p.total_pulses_done desc,
             p.total_accuracy_pct desc,
             p.registered_at asc
  ) as rank,
  p.season_id
from public.championship_participants p
where p.status = 'active'
  and p.season_id = 'S1';

-- ── 7. Function: record_pulse_completion ────────────────────────────────────
-- Server-authoritative: validates season window, daily limit, idempotency,
-- updates participant totals, writes audit log.

create or replace function public.record_pulse_completion(
  p_idempotency_key   text,
  p_participant_id    uuid,
  p_pulse_slot        integer,
  p_pulse_type        text,
  p_pulse_category    text,
  p_time_taken_seconds integer,
  p_score_awarded     integer,
  p_answers_correct   integer,
  p_answers_total     integer
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id         uuid;
  v_season_start    timestamptz := '2026-09-27 13:30:00+00';
  v_season_end      timestamptz := '2026-10-17 13:30:00+00';
  v_now             timestamptz := now();
  v_pulse_date      date        := (v_now at time zone 'Asia/Kolkata')::date;
  v_daily_count     integer;
  v_accuracy        numeric;
  v_existing        uuid;
begin
  -- Verify championship window
  if v_now < v_season_start then
    return jsonb_build_object('ok', false, 'error', 'championship_not_started');
  end if;
  if v_now > v_season_end then
    return jsonb_build_object('ok', false, 'error', 'championship_ended');
  end if;

  -- Verify participant
  select user_id into v_user_id
  from public.championship_participants
  where id = p_participant_id and status = 'active' and season_id = 'S1';

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'participant_not_found');
  end if;

  -- Verify caller is the participant
  if v_user_id != auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  -- Check idempotency: already processed?
  select id into v_existing
  from public.championship_pulse_completions
  where idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_existing);
  end if;

  -- Daily limit: max 5 pulses
  select count(*) into v_daily_count
  from public.championship_pulse_completions
  where participant_id = p_participant_id
    and pulse_date = v_pulse_date
    and validation_status != 'rejected';

  if v_daily_count >= 5 then
    return jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
  end if;

  -- Calculate accuracy
  if p_answers_total > 0 then
    v_accuracy := round((p_answers_correct::numeric / p_answers_total) * 100, 2);
  else
    v_accuracy := 0;
  end if;

  -- Insert completion
  insert into public.championship_pulse_completions (
    idempotency_key, participant_id, user_id, season_id,
    pulse_date, pulse_slot, pulse_type, pulse_category,
    submitted_at, time_taken_seconds,
    validation_status, validated_at,
    score_awarded, max_score, accuracy_pct,
    answers_correct, answers_total
  ) values (
    p_idempotency_key, p_participant_id, v_user_id, 'S1',
    v_pulse_date, p_pulse_slot, p_pulse_type, p_pulse_category,
    v_now, p_time_taken_seconds,
    'valid', v_now,
    p_score_awarded, 100, v_accuracy,
    p_answers_correct, p_answers_total
  );

  -- Update participant totals
  update public.championship_participants
  set
    total_score        = total_score + p_score_awarded,
    total_pulses_done  = total_pulses_done + 1,
    total_accuracy_pct = (
      (total_accuracy_pct * total_pulses_done + v_accuracy) / (total_pulses_done + 1)
    ),
    current_streak     = current_streak + 1,
    last_active_at     = v_now,
    updated_at         = v_now
  where id = p_participant_id;

  -- Audit log
  insert into public.championship_audit_log (
    event_type, participant_id, user_id, season_id, actor, result, metadata
  ) values (
    'pulse_completion', p_participant_id, v_user_id, 'S1', 'participant', 'valid',
    jsonb_build_object(
      'slot', p_pulse_slot, 'type', p_pulse_type, 'score', p_score_awarded,
      'accuracy', v_accuracy, 'idempotency_key', p_idempotency_key
    )
  );

  return jsonb_build_object('ok', true, 'score_awarded', p_score_awarded, 'accuracy', v_accuracy);
end;
$$;

-- ── 8. Enable Realtime ────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'championship_participants'
  ) then
    alter publication supabase_realtime add table public.championship_participants;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'championship_pulse_completions'
  ) then
    alter publication supabase_realtime add table public.championship_pulse_completions;
  end if;
end $$;

-- ── 9. Updated_at trigger ─────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_participants_updated_at on public.championship_participants;
create trigger trg_participants_updated_at
  before update on public.championship_participants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_disputes_updated_at on public.championship_disputes;
create trigger trg_disputes_updated_at
  before update on public.championship_disputes
  for each row execute function public.set_updated_at();

-- ── 10. Championship Registrations (Public Season 1 Registration) ─────────────
create table if not exists public.championship_registrations (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  medical_college text not null,
  batch text not null,
  passport_id text,
  email text not null,
  created_at timestamp with time zone default now()
);

alter table public.championship_registrations enable row level security;

create policy "Public insert championship_registrations"
  on public.championship_registrations
  for insert
  with check (true);

create policy "Public read championship_registrations"
  on public.championship_registrations
  for select
  using (true);

