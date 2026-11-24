-- ==============================================================================
-- Migration: 20261118000001_championship_finale_schema.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Core Database Schema
--
-- Authoritative Competition Rules:
--   - Dates: November 24, 25, 26, 2026 (7:00 PM - 8:00 PM IST daily window)
--   - 10 Verified Finalists + 2 Verified Reserves (Sealed into 12 seats)
--   - Exactly 10 questions per day (30 questions total)
--   - Continuous 90.000s server countdown per daily session (zero per-question reset)
--   - +100 points for correct answer, 0 for incorrect/skipped/unanswered
--   - Daily max 1,000 pts; Cumulative max 3,000 pts
--   - Scoped partial unique index on live sessions (prevents concurrent double-starts,
--     enables clean admin voiding and replacement)
--   - Composite foreign keys preventing cross-day or cross-user misattribution
--   - Cryptographic hashes use deterministic PostgreSQL JSONB digest format (pg_jsonb_v1)
-- ==============================================================================

BEGIN;

-- ── 1. championship_finale_event ──────────────────────────────────────────────
-- Singleton configuration record governing tournament metadata and global bounds.
CREATE TABLE IF NOT EXISTS public.championship_finale_event (
  id TEXT PRIMARY KEY DEFAULT 'SEASON_1',
  title TEXT NOT NULL DEFAULT 'MedTrail Championship Season 1 Grand Finale',
  season_id TEXT NOT NULL DEFAULT 'S1',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'live', 'completed', 'cancelled')),
  total_days INTEGER NOT NULL DEFAULT 3
    CHECK (total_days = 3),
  questions_per_day INTEGER NOT NULL DEFAULT 10
    CHECK (questions_per_day = 10),
  session_time_limit_seconds NUMERIC(6,3) NOT NULL DEFAULT 90.000
    CHECK (session_time_limit_seconds = 90.000),
  points_per_correct INTEGER NOT NULL DEFAULT 100
    CHECK (points_per_correct = 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_finale_event_single_row CHECK (id = 'SEASON_1')
);

-- Seed singleton event configuration
INSERT INTO public.championship_finale_event (id, title, season_id, status)
VALUES ('SEASON_1', 'MedTrail Championship Season 1 Grand Finale', 'S1', 'draft')
ON CONFLICT (id) DO NOTHING;

-- ── 2. championship_finale_days ───────────────────────────────────────────────
-- Operational window and state machine for each of the 3 competition days.
CREATE TABLE IF NOT EXISTS public.championship_finale_days (
  day_number INTEGER PRIMARY KEY CHECK (day_number BETWEEN 1 AND 3),
  event_id TEXT NOT NULL DEFAULT 'SEASON_1' REFERENCES public.championship_finale_event(id) ON DELETE RESTRICT,
  competition_date DATE NOT NULL UNIQUE,
  window_opens_at TIMESTAMPTZ NOT NULL,
  window_closes_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'open', 'paused', 'closed', 'results_published')),
  paused_at TIMESTAMPTZ,
  results_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_finale_days_window CHECK (window_closes_at > window_opens_at)
);

CREATE INDEX IF NOT EXISTS idx_finale_days_status 
  ON public.championship_finale_days (status);

-- Seed standard dates for Season 1 Grand Finale: Nov 24, 25, 26, 2026 (7:00 PM - 8:00 PM IST)
-- Note: 7:00 PM IST is 13:30:00 UTC; 8:00 PM IST is 14:30:00 UTC.
INSERT INTO public.championship_finale_days (day_number, competition_date, window_opens_at, window_closes_at, status)
VALUES
  (1, '2026-11-24', '2026-11-24 13:30:00+00', '2026-11-24 14:30:00+00', 'draft'),
  (2, '2026-11-25', '2026-11-25 13:30:00+00', '2026-11-25 14:30:00+00', 'draft'),
  (3, '2026-11-26', '2026-11-26 13:30:00+00', '2026-11-26 14:30:00+00', 'draft')
ON CONFLICT (day_number) DO NOTHING;

-- ── 3. championship_finale_roster ─────────────────────────────────────────────
-- Authoritative seat assignment for the 10 verified finalists and 2 reserves.
CREATE TABLE IF NOT EXISTS public.championship_finale_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_type TEXT NOT NULL CHECK (seat_type IN ('finalist', 'reserve')),
  seat_number INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  qualifier_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  college TEXT NOT NULL,
  batch TEXT NOT NULL,
  qualification_rank INTEGER NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  attendance_confirmed BOOLEAN NOT NULL DEFAULT false,
  participation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (participation_status IN ('active', 'withdrawn', 'disqualified', 'promoted')),
  promoted_to_seat INTEGER CHECK (promoted_to_seat IS NULL OR (promoted_to_seat BETWEEN 1 AND 10)),
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_finale_roster_seat UNIQUE (seat_type, seat_number),
  CONSTRAINT uq_finale_roster_user UNIQUE (user_id),
  CONSTRAINT uq_finale_roster_qualifier UNIQUE (qualifier_id),
  CONSTRAINT uq_finale_roster_id_user UNIQUE (id, user_id),
  CONSTRAINT chk_finale_roster_seat_bounds CHECK (
    (seat_type = 'finalist' AND seat_number BETWEEN 1 AND 10) OR
    (seat_type = 'reserve' AND seat_number BETWEEN 1 AND 2)
  )
);

CREATE INDEX IF NOT EXISTS idx_finale_roster_user 
  ON public.championship_finale_roster (user_id);
CREATE INDEX IF NOT EXISTS idx_finale_roster_status 
  ON public.championship_finale_roster (participation_status);

-- ── 4. championship_finale_roster_meta ────────────────────────────────────────
-- Atomic sealing lock and cryptographic verification digest.
-- Note: roster_hash and questions_hash use pg_jsonb_v1 deterministic SHA-256 digests.
CREATE TABLE IF NOT EXISTS public.championship_finale_roster_meta (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_sealed BOOLEAN NOT NULL DEFAULT false,
  sealed_at TIMESTAMPTZ,
  sealed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  roster_hash TEXT,
  questions_hash TEXT,
  total_finalists_count INTEGER NOT NULL DEFAULT 0,
  total_reserves_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed singleton roster lock row
INSERT INTO public.championship_finale_roster_meta (id, is_sealed)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- ── 5. championship_finale_questions ──────────────────────────────────────────
-- Master question bank containing prompts, choices, answer keys, and explanations.
CREATE TABLE IF NOT EXISTS public.championship_finale_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number INTEGER NOT NULL REFERENCES public.championship_finale_days(day_number) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  explanation TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_finale_questions_day_slot UNIQUE (day_number, slot_number),
  CONSTRAINT uq_finale_questions_composite_key UNIQUE (id, day_number, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_finale_questions_day 
  ON public.championship_finale_questions (day_number, slot_number);

-- ── 6. championship_finale_sessions ───────────────────────────────────────────
-- Server-authoritative examination lifecycle tracking for each finalist per day.
CREATE TABLE IF NOT EXISTS public.championship_finale_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number INTEGER NOT NULL REFERENCES public.championship_finale_days(day_number) ON DELETE RESTRICT,
  roster_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'expired', 'voided')),
  current_slot INTEGER NOT NULL DEFAULT 1
    CHECK (current_slot BETWEEN 1 AND 10),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  total_time_seconds NUMERIC(6,3) NOT NULL DEFAULT 0.000
    CHECK (total_time_seconds >= 0.000 AND total_time_seconds <= 90.000),
  total_score INTEGER NOT NULL DEFAULT 0
    CHECK (total_score BETWEEN 0 AND 1000),
  correct_count INTEGER NOT NULL DEFAULT 0
    CHECK (correct_count BETWEEN 0 AND 10),
  attempted_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempted_count BETWEEN 0 AND 10),
  skipped_count INTEGER NOT NULL DEFAULT 0
    CHECK (skipped_count BETWEEN 0 AND 10),
  unanswered_count INTEGER NOT NULL DEFAULT 10
    CHECK (unanswered_count BETWEEN 0 AND 10),
  is_reissued BOOLEAN NOT NULL DEFAULT false,
  reissue_count INTEGER NOT NULL DEFAULT 0 CHECK (reissue_count <= 1),
  reissue_reason TEXT,
  reissued_from_session_id UUID REFERENCES public.championship_finale_sessions(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  client_ip_hash TEXT,
  client_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_finale_sessions_roster_user FOREIGN KEY (roster_id, user_id)
    REFERENCES public.championship_finale_roster(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT uq_finale_sessions_composite_id UNIQUE (id, day_number, user_id),
  CONSTRAINT chk_finale_sessions_expiry CHECK (expires_at > started_at)
);

-- Crucial: Scoped Partial Unique Index allowing exactly one live session per (day, user).
-- Voided sessions fall outside this index, allowing clean administrative reissues without constraint violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finale_sessions_single_live_slot
  ON public.championship_finale_sessions (day_number, user_id)
  WHERE status IN ('active', 'completed', 'expired');

CREATE INDEX IF NOT EXISTS idx_finale_sessions_user_day 
  ON public.championship_finale_sessions (user_id, day_number);
CREATE INDEX IF NOT EXISTS idx_finale_sessions_status_expiry 
  ON public.championship_finale_sessions (status, expires_at);

-- ── 7. championship_finale_question_states ────────────────────────────────────
-- Fine-grained state tracking for each of the 10 slots in a session.
CREATE TABLE IF NOT EXISTS public.championship_finale_question_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  day_number INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  question_id UUID NOT NULL,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'answered', 'skipped', 'timeout', 'unanswered')),
  selected_option TEXT CHECK (selected_option IS NULL OR selected_option IN ('A', 'B', 'C', 'D')),
  is_correct BOOLEAN NOT NULL DEFAULT false,
  points_awarded INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded IN (0, 100)),
  elapsed_slot_seconds NUMERIC(6,3) NOT NULL DEFAULT 0.000,
  idempotency_key TEXT NOT NULL,
  client_timestamp TIMESTAMPTZ,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_finale_qstates_session FOREIGN KEY (session_id, day_number, user_id)
    REFERENCES public.championship_finale_sessions(id, day_number, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_finale_qstates_question FOREIGN KEY (question_id, day_number, slot_number)
    REFERENCES public.championship_finale_questions(id, day_number, slot_number) ON DELETE RESTRICT,
  CONSTRAINT uq_finale_qstates_session_slot UNIQUE (session_id, slot_number),
  CONSTRAINT uq_finale_qstates_idempotency UNIQUE (session_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_finale_qstates_session_slot 
  ON public.championship_finale_question_states (session_id, slot_number);

-- ── 8. championship_finale_attempts ───────────────────────────────────────────
-- Append-only raw ingress packet audit log.
CREATE TABLE IF NOT EXISTS public.championship_finale_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  day_number INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
  action_type TEXT NOT NULL CHECK (action_type IN ('answer', 'skip', 'timeout', 'auto_close')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key TEXT NOT NULL,
  was_accepted BOOLEAN NOT NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_finale_attempts_session FOREIGN KEY (session_id, day_number, user_id)
    REFERENCES public.championship_finale_sessions(id, day_number, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_finale_attempts_session_time 
  ON public.championship_finale_attempts (session_id, server_received_at ASC);

-- ── 9. championship_finale_results ────────────────────────────────────────────
-- Materialized, versioned official standings snapshots published by administrators.
CREATE TABLE IF NOT EXISTS public.championship_finale_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_type TEXT NOT NULL CHECK (result_type IN ('daily', 'cumulative')),
  day_number INTEGER CHECK (day_number IS NULL OR day_number BETWEEN 1 AND 3),
  roster_id UUID NOT NULL REFERENCES public.championship_finale_roster(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  student_name TEXT NOT NULL,
  college TEXT NOT NULL,
  batch TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 3000),
  elapsed_time_seconds NUMERIC(6,3) NOT NULL CHECK (elapsed_time_seconds >= 0.000 AND elapsed_time_seconds <= 270.000),
  correct_count INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND 30),
  attempted_count INTEGER NOT NULL CHECK (attempted_count BETWEEN 0 AND 30),
  skipped_count INTEGER NOT NULL CHECK (skipped_count BETWEEN 0 AND 30),
  unanswered_count INTEGER NOT NULL CHECK (unanswered_count BETWEEN 0 AND 30),
  day3_score INTEGER,
  day3_time_seconds NUMERIC(6,3),
  day2_score INTEGER,
  day2_time_seconds NUMERIC(6,3),
  day1_score INTEGER,
  day1_time_seconds NUMERIC(6,3),
  rank INTEGER NOT NULL CHECK (rank >= 1),
  is_winner BOOLEAN NOT NULL DEFAULT false,
  tie_status TEXT NOT NULL DEFAULT 'none'
    CHECK (tie_status IN ('none', 'resolved_by_rules', 'joint_standing', 'sudden_death_scheduled')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_finale_results_snapshot UNIQUE (result_type, day_number, user_id, snapshot_version)
);

CREATE INDEX IF NOT EXISTS idx_finale_results_leaderboard 
  ON public.championship_finale_results (result_type, day_number, rank ASC);

-- ── 10. championship_finale_audit_log ─────────────────────────────────────────
-- Tamper-resistant append-only audit trail with cryptographic hash chaining.
CREATE TABLE IF NOT EXISTS public.championship_finale_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'super_admin', 'participant', 'system')),
  target_entity TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finale_audit_occurred 
  ON public.championship_finale_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finale_audit_event 
  ON public.championship_finale_audit_log (event_type);

-- ── 11. championship_finale_telemetry ─────────────────────────────────────────
-- Ephemeral client-side telemetry events with 30-day retention.
CREATE TABLE IF NOT EXISTS public.championship_finale_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.championship_finale_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('window_blur', 'visibility_hidden', 'heartbeat', 'reconnect')),
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finale_telemetry_created 
  ON public.championship_finale_telemetry (created_at);
CREATE INDEX IF NOT EXISTS idx_finale_telemetry_session 
  ON public.championship_finale_telemetry (session_id, server_timestamp ASC);

-- ── 12. championship_finale_admin_approvals ───────────────────────────────────
-- Dual-control authorization records for irreversible high-stakes administrative operations.
CREATE TABLE IF NOT EXISTS public.championship_finale_admin_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name TEXT NOT NULL,
  target_day INTEGER CHECK (target_day IS NULL OR target_day BETWEEN 1 AND 3),
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_approver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  first_approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmation_phrase TEXT NOT NULL,
  second_approver_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  second_approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  executed_at TIMESTAMPTZ,
  CONSTRAINT chk_finale_approvals_distinct_actors CHECK (
    second_approver_id IS NULL OR second_approver_id <> first_approver_id
  )
);

CREATE INDEX IF NOT EXISTS idx_finale_approvals_action 
  ON public.championship_finale_admin_approvals (action_name, status);

COMMIT;
