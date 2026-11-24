-- ==============================================================================
-- Migration: 20261124_championship_finale_roster_seed.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Official 10 Finalist Seeding
--
-- TARGETED ACTION:
--   Populates public.championship_finale_approved_roster with the 10 verified
--   finalists from Season 1 Daily Pulse qualification standings.
--
-- QUALIFICATION INTEGRITY:
--   - Strictly excludes Shriyash Shinde's fallback attempt (pulse-default-2026-10-04, 111 pts).
--   - Shriyash Shinde authentic score across 10 official pulses: 570 pts (Rank 11 / Reserve 1).
--   - Trigun Repe (638 pts across 10 official pulses) qualifies as Seat 10 (Rank 10).
--   - Authentic UUIDs, emails, names, colleges, and batches mapped directly from
--     verified championship attempts. No synthetic or placeholder records.
--
-- IDEMPOTENT & SAFE:
--   - Uses ON CONFLICT (seat_number) DO UPDATE.
--   - Zero modification to Daily Pulse tables (championship_pulse_*) or existing leaderboard.
-- ==============================================================================

BEGIN;

INSERT INTO public.championship_finale_approved_roster (
  seat_number,
  user_id,
  email,
  student_name,
  college,
  batch
)
VALUES
  (
    1,
    '8616b327-c4db-4b07-84f3-75de5de9fd3c',
    'vedantmural@gmail.com',
    'Vedant mural',
    'Seth GS Medical College, Mumbai',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    2,
    '39467d1b-a7a6-4d85-9ee9-24ea0d86701f',
    'sarthraj452@gmail.com',
    'Sarthak garje',
    'Prakash Institute of Medical Sciences and Research, Urun-Islampur, Sangli',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    3,
    'd47c8e60-57b9-42f2-9c1c-09ce4e49d11c',
    'viraj.j.pawar16march@gmail.com',
    'Viraj Pawar',
    'MIMER Medical College, Talegaon Dabhade, Pune',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    4,
    '657e9818-b4a0-41ad-8b77-0b2dfefed3a6',
    'sakshigonte16@gmail.com',
    'Sakshi Gonte',
    'MIMER Medical College, Talegaon Dabhade, Pune',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    5,
    '51025d12-2a9d-421a-9c64-2da2296483c6',
    'shanky19feb@gmail.com',
    'Siddhant Sankpal',
    'Government Medical College, Miraj',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    6,
    '25eb2c0f-9af1-4a11-9fc9-badc90f9f114',
    'siddhi1826@gmail.com',
    'Siddhi Rote',
    'MIMER Medical College, Talegaon Dabhade, Pune',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    7,
    '004b6eb8-c1cc-4104-8108-9ae25fdba5df',
    'vaishnavi02115@gmail.com',
    'Vaishnavi Waghmode',
    'Government Medical College, Miraj',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    8,
    '09cc3e01-798a-4a62-88c7-46564302a9af',
    'athrvadadayashwant@gmail.com',
    'Athrva Yashwant',
    'MIMER Medical College, Talegaon Dabhade, Pune',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    9,
    'f70c8a0e-55a3-4a19-946f-2c0c20be9932',
    'urkudednyany1230@gmail.com',
    'DNYANESHWARI SUBHASH URKUDE',
    'Government Medical College, Miraj',
    '2024 Batch → 2nd Year MBBS'
  ),
  (
    10,
    'd6cf21e7-3e00-4e3f-b40c-fef429bf7599',
    'sasukefromteam07@gmail.com',
    'Trigun Repe',
    'MIMER Medical College, Talegaon Dabhade, Pune',
    '2024 Batch → 2nd Year MBBS'
  )
ON CONFLICT (seat_number) DO UPDATE SET
  user_id      = EXCLUDED.user_id,
  email        = EXCLUDED.email,
  student_name = EXCLUDED.student_name,
  college      = EXCLUDED.college,
  batch        = EXCLUDED.batch,
  updated_at   = now();

COMMIT;

