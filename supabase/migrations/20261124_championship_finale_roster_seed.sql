-- =============================================================================
-- MedTrail Championship Season 1 — Grand Finale approved roster seed
-- File: 20261124_championship_finale_roster_seed.sql
--
-- IMPORTANT
--   This is a guarded, idempotent seed for the schema described in the supplied
--   Format B migration/report:
--     public.championship_finale_approved_roster(
--       seat_number, user_id, email, student_name, college, batch
--     )
--   It deliberately does NOT update existing rows.
--
--   Run only after reviewing the exact table DDL/constraints and the official
--   November 5 qualification audit. This script does not independently prove
--   the ranking: the source audit table/schema was not supplied.
--
-- SAFETY
--   * Verifies each UUID exists in auth.users and email matches (case-insensitive).
--   * Rejects duplicate UUIDs/emails in the proposed roster.
--   * Locks the roster table to serialize competing seed operations.
--   * Aborts if any target seat is occupied by a different identity or metadata.
--   * Inserts only missing seats; existing rows are never overwritten.
--   * Validates the complete 1..10 roster before COMMIT.
--   * Does not reference or modify the existing daily Pulse tables.
-- =============================================================================

BEGIN;

LOCK TABLE public.championship_finale_approved_roster IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE _finale_expected_roster (
  seat_number integer PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  student_name text NOT NULL,
  college text NOT NULL,
  batch text NOT NULL
) ON COMMIT DROP;

INSERT INTO _finale_expected_roster
  (seat_number, user_id, email, student_name, college, batch)
VALUES
  (1, '8616b327-c4db-4b07-84f3-75de5de9fd3c', 'vedantmural@gmail.com',
   'Vedant mural', 'Seth GS Medical College, Mumbai', '2024 Batch → 2nd Year MBBS'),
  (2, '39467d1b-a7a6-4d85-9ee9-24ea0d86701f', 'sarthraj452@gmail.com',
   'Sarthak garje', 'Prakash Institute of Medical Sciences and Research, Urun-Islampur, Sangli',
   '2024 Batch → 2nd Year MBBS'),
  (3, 'd47c8e60-57b9-42f2-9c1c-09ce4e49d11c', 'viraj.j.pawar16march@gmail.com',
   'Viraj Pawar', 'MIMER Medical College, Talegaon Dabhade, Pune', '2024 Batch → 2nd Year MBBS'),
  (4, '657e9818-b4a0-41ad-8b77-0b2dfefed3a6', 'sakshigonte16@gmail.com',
   'Sakshi Gonte', 'MIMER Medical College, Talegaon Dabhade, Pune', '2024 Batch → 2nd Year MBBS'),
  (5, '51025d12-2a9d-421a-9c64-2da2296483c6', 'shanky19feb@gmail.com',
   'Siddhant Sankpal', 'Government Medical College, Miraj', '2024 Batch → 2nd Year MBBS'),
  (6, '25eb2c0f-9af1-4a11-9fc9-badc90f9f114', 'siddhi1826@gmail.com',
   'Siddhi Rote', 'MIMER Medical College, Talegaon Dabhade, Pune', '2024 Batch → 2nd Year MBBS'),
  (7, '004b6eb8-c1cc-4104-8108-9ae25fdba5df', 'vaishnavi02115@gmail.com',
   'Vaishnavi Waghmode', 'Government Medical College, Miraj', '2024 Batch → 2nd Year MBBS'),
  (8, '09cc3e01-798a-4a62-88c7-46564302a9af', 'athrvadadayashwant@gmail.com',
   'Athrva Yashwant', 'MIMER Medical College, Talegaon Dabhade, Pune', '2024 Batch → 2nd Year MBBS'),
  (9, 'f70c8a0e-55a3-4a19-946f-2c0c20be9932', 'urkudednyany1230@gmail.com',
   'DNYANESHWARI SUBHASH URKUDE', 'Government Medical College, Miraj',
   '2024 Batch → 2nd Year MBBS'),
  (10, 'd6cf21e7-3e00-4e3f-b40c-fef429bf7599', 'sasukefromteam07@gmail.com',
   'Trigun Repe', 'MIMER Medical College, Talegaon Dabhade, Pune', '2024 Batch → 2nd Year MBBS');

DO $guard$
DECLARE
  v_expected_count integer;
  v_auth_mismatch_count integer;
  v_existing_conflict_count integer;
  v_existing_duplicate_identity_count integer;
BEGIN
  SELECT count(*) INTO v_expected_count FROM _finale_expected_roster;
  IF v_expected_count <> 10 THEN
    RAISE EXCEPTION 'Expected exactly 10 proposed finalists; found %', v_expected_count;
  END IF;

  -- Check every supplied UUID exists and belongs to the supplied email.
  SELECT count(*)
    INTO v_auth_mismatch_count
  FROM _finale_expected_roster e
  LEFT JOIN auth.users u ON u.id = e.user_id
  WHERE u.id IS NULL
     OR lower(btrim(coalesce(u.email, ''))) <> lower(btrim(e.email));

  IF v_auth_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'Authentication preflight failed: % finalist UUID/email pair(s) missing or mismatched',
      v_auth_mismatch_count;
  END IF;

  -- Detect duplicate identities already present in the current roster.
  SELECT count(*)
    INTO v_existing_duplicate_identity_count
  FROM (
    SELECT user_id
    FROM public.championship_finale_approved_roster
    WHERE user_id IS NOT NULL
    GROUP BY user_id HAVING count(*) > 1
    UNION ALL
    SELECT lower(btrim(email)) AS email_key
    FROM public.championship_finale_approved_roster
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) duplicates;

  IF v_existing_duplicate_identity_count <> 0 THEN
    RAISE EXCEPTION
      'Existing roster contains duplicate user_id/email identities (% duplicate groups)',
      v_existing_duplicate_identity_count;
  END IF;

  -- A target seat may be empty or already contain the exact expected row.
  -- Any mismatch aborts; no existing row is overwritten.
  SELECT count(*)
    INTO v_existing_conflict_count
  FROM public.championship_finale_approved_roster r
  JOIN _finale_expected_roster e USING (seat_number)
  WHERE r.user_id IS DISTINCT FROM e.user_id
     OR lower(btrim(coalesce(r.email, ''))) <> lower(btrim(e.email))
     OR r.student_name IS DISTINCT FROM e.student_name
     OR r.college IS DISTINCT FROM e.college
     OR r.batch IS DISTINCT FROM e.batch;

  IF v_existing_conflict_count <> 0 THEN
    RAISE EXCEPTION
      'Roster seed aborted: % target seat(s) already contain conflicting identity or details',
      v_existing_conflict_count;
  END IF;

  -- Do not allow one expected finalist to occupy a different seat.
  SELECT count(*)
    INTO v_existing_conflict_count
  FROM public.championship_finale_approved_roster r
  JOIN _finale_expected_roster e
    ON r.user_id = e.user_id
    OR lower(btrim(coalesce(r.email, ''))) = lower(btrim(e.email))
  WHERE r.seat_number <> e.seat_number;

  IF v_existing_conflict_count <> 0 THEN
    RAISE EXCEPTION
      'Roster seed aborted: an expected finalist is already assigned to another seat';
  END IF;
END
$guard$;

-- Insert only missing seat numbers. Existing rows are never updated.
INSERT INTO public.championship_finale_approved_roster
  (seat_number, user_id, email, student_name, college, batch)
SELECT e.seat_number, e.user_id, e.email, e.student_name, e.college, e.batch
FROM _finale_expected_roster e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.championship_finale_approved_roster r
  WHERE r.seat_number = e.seat_number
);

-- Final transactional assertion: exact 10 seats, exact mapping, no extra seats,
-- and unique identities. Any failure rolls back the insert.
DO $verify$
DECLARE
  v_roster_count integer;
  v_expected_mismatch_count integer;
  v_out_of_range_count integer;
  v_duplicate_identity_count integer;
BEGIN
  SELECT count(*) INTO v_roster_count
  FROM public.championship_finale_approved_roster;

  IF v_roster_count <> 10 THEN
    RAISE EXCEPTION 'Post-seed validation failed: roster has % rows, expected 10',
      v_roster_count;
  END IF;

  SELECT count(*) INTO v_expected_mismatch_count
  FROM _finale_expected_roster e
  LEFT JOIN public.championship_finale_approved_roster r USING (seat_number)
  WHERE r.seat_number IS NULL
     OR r.user_id IS DISTINCT FROM e.user_id
     OR lower(btrim(coalesce(r.email, ''))) <> lower(btrim(e.email))
     OR r.student_name IS DISTINCT FROM e.student_name
     OR r.college IS DISTINCT FROM e.college
     OR r.batch IS DISTINCT FROM e.batch;

  IF v_expected_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Post-seed validation failed: % expected seat(s) missing or mismatched',
      v_expected_mismatch_count;
  END IF;

  SELECT count(*) INTO v_out_of_range_count
  FROM public.championship_finale_approved_roster
  WHERE seat_number < 1 OR seat_number > 10;

  IF v_out_of_range_count <> 0 THEN
    RAISE EXCEPTION 'Post-seed validation failed: unexpected seat number(s) exist';
  END IF;

  SELECT count(*) INTO v_duplicate_identity_count
  FROM (
    SELECT user_id
    FROM public.championship_finale_approved_roster
    GROUP BY user_id HAVING count(*) > 1
    UNION ALL
    SELECT lower(btrim(email))
    FROM public.championship_finale_approved_roster
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) d;

  IF v_duplicate_identity_count <> 0 THEN
    RAISE EXCEPTION 'Post-seed validation failed: duplicate finalist identities found';
  END IF;
END
$verify$;

COMMIT;

-- =============================================================================
-- STANDALONE PREFLIGHT QUERY (read-only; run before the migration)
-- Recreate the expected CTE with the same 10 UUID/email pairs to inspect auth
-- identity status and existing-seat conflicts. This query intentionally omits
-- personal display metadata; the migration's in-transaction guard validates all
-- fields before writing.
-- =============================================================================
/*
WITH expected(seat_number, user_id, email) AS (
  VALUES
    (1, '8616b327-c4db-4b07-84f3-75de5de9fd3c'::uuid, 'vedantmural@gmail.com'),
    (2, '39467d1b-a7a6-4d85-9ee9-24ea0d86701f'::uuid, 'sarthraj452@gmail.com'),
    (3, 'd47c8e60-57b9-42f2-9c1c-09ce4e49d11c'::uuid, 'viraj.j.pawar16march@gmail.com'),
    (4, '657e9818-b4a0-41ad-8b77-0b2dfefed3a6'::uuid, 'sakshigonte16@gmail.com'),
    (5, '51025d12-2a9d-421a-9c64-2da2296483c6'::uuid, 'shanky19feb@gmail.com'),
    (6, '25eb2c0f-9af1-4a11-9fc9-badc90f9f114'::uuid, 'siddhi1826@gmail.com'),
    (7, '004b6eb8-c1cc-4104-8108-9ae25fdba5df'::uuid, 'vaishnavi02115@gmail.com'),
    (8, '09cc3e01-798a-4a62-88c7-46564302a9af'::uuid, 'athrvadadayashwant@gmail.com'),
    (9, 'f70c8a0e-55a3-4a19-946f-2c0c20be9932'::uuid, 'urkudednyany1230@gmail.com'),
    (10, 'd6cf21e7-3e00-4e3f-b40c-fef429bf7599'::uuid, 'sasukefromteam07@gmail.com')
)
SELECT
  e.seat_number,
  e.user_id,
  e.email AS expected_email,
  u.email AS auth_email,
  (u.id IS NOT NULL
   AND lower(btrim(coalesce(u.email,''))) = lower(btrim(e.email))) AS auth_identity_ok,
  r.seat_number AS occupied_seat,
  r.user_id AS existing_user_id,
  r.email AS existing_email,
  CASE
    WHEN r.seat_number IS NULL THEN 'EMPTY'
    WHEN r.user_id = e.user_id
     AND lower(btrim(coalesce(r.email,''))) = lower(btrim(e.email))
      THEN 'SAME_IDENTITY — compare name/college/batch before running'
    ELSE 'CONFLICT — DO NOT RUN'
  END AS roster_status
FROM expected e
LEFT JOIN auth.users u ON u.id = e.user_id
LEFT JOIN public.championship_finale_approved_roster r
  ON r.seat_number = e.seat_number
ORDER BY e.seat_number;
*/

-- =============================================================================
-- STANDALONE POST-SEED VERIFICATION QUERY (read-only)
-- Expected result: 10 rows, seats 1..10, each auth_identity_ok = true.
-- =============================================================================
/*
SELECT
  r.seat_number,
  r.student_name,
  r.college,
  r.batch,
  r.user_id,
  (u.id IS NOT NULL
   AND lower(btrim(coalesce(u.email,''))) = lower(btrim(r.email))) AS auth_identity_ok,
  r.email IS NOT NULL AS email_present
FROM public.championship_finale_approved_roster r
LEFT JOIN auth.users u ON u.id = r.user_id
ORDER BY r.seat_number;

-- Aggregate invariant check: should return exactly one row with all booleans true.
SELECT
  count(*) = 10 AS exactly_10_rows,
  count(DISTINCT seat_number) = 10 AS unique_seats,
  min(seat_number) = 1 AND max(seat_number) = 10 AS seat_range_1_to_10,
  count(DISTINCT user_id) = 10 AS unique_user_ids,
  count(DISTINCT lower(btrim(email))) = 10 AS unique_emails,
  bool_and(u.id IS NOT NULL
    AND lower(btrim(coalesce(u.email,''))) = lower(btrim(r.email))) AS all_auth_identities_match
FROM public.championship_finale_approved_roster r
LEFT JOIN auth.users u ON u.id = r.user_id;
*/
