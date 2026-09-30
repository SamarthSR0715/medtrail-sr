-- ==============================================================================
-- Migration: 20260929_medical_colleges_master.sql
-- Description:
--   1. Create medical_colleges master table with RLS and search indexes
--   2. Seed with all 80 recognized MBBS medical colleges in Maharashtra (NMC/DMER)
--   3. Add medical_college_id FK to:
--      - profiles
--      - championship_registrations
--      - championship_pulse_attempts
--      - championship_leaderboard
--      - championship_college_standings
--   4. Backfill existing records and map 28 variations to canonical college IDs
--   5. Update submit_pulse_attempt_atomic RPC to aggregate by canonical college
--   6. Enable Realtime publication on medical_colleges
-- ==============================================================================

BEGIN;

-- 1. Create master table for medical colleges
CREATE TABLE IF NOT EXISTS public.medical_colleges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_name TEXT NOT NULL UNIQUE,
    city TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'Maharashtra',
    college_type TEXT DEFAULT 'Government',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Search and active indexes
CREATE INDEX IF NOT EXISTS idx_medical_colleges_active ON public.medical_colleges (active);
CREATE INDEX IF NOT EXISTS idx_medical_colleges_search ON public.medical_colleges (lower(college_name), lower(city));

-- RLS
ALTER TABLE public.medical_colleges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active medical_colleges" ON public.medical_colleges;
CREATE POLICY "Public read active medical_colleges"
  ON public.medical_colleges
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "Admin manage medical_colleges" ON public.medical_colleges;
CREATE POLICY "Admin manage medical_colleges"
  ON public.medical_colleges
  FOR ALL
  TO authenticated, service_role
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.medical_colleges TO anon, authenticated;
GRANT ALL ON public.medical_colleges TO service_role;

-- 2. Populate official recognized MBBS colleges (80 institutions)
INSERT INTO public.medical_colleges (college_name, city, state, college_type, active)
VALUES
  ('Armed Forces Medical College (AFMC), Pune', 'Pune', 'Maharashtra', 'Central Government', true),
  ('All India Institute of Medical Sciences (AIIMS), Nagpur', 'Nagpur', 'Maharashtra', 'Central Government', true),
  ('All India Institute of Medical Sciences (AIIMS), New Delhi', 'New Delhi', 'Delhi', 'Central Government', true),
  ('B. J. Government Medical College, Pune', 'Pune', 'Maharashtra', 'Government', true),
  ('Grant Government Medical College and Sir J.J. Group of Hospitals, Mumbai', 'Mumbai', 'Maharashtra', 'Government', true),
  ('Government Medical College, Miraj', 'Miraj', 'Maharashtra', 'Government', true),
  ('Government Medical College, Nagpur', 'Nagpur', 'Maharashtra', 'Government', true),
  ('Indira Gandhi Government Medical College, Nagpur', 'Nagpur', 'Maharashtra', 'Government', true),
  ('Government Medical College, Chhatrapati Sambhajinagar', 'Chhatrapati Sambhajinagar', 'Maharashtra', 'Government', true),
  ('Dr. Vaishampayan Memorial Government Medical College (VMGMC), Solapur', 'Solapur', 'Maharashtra', 'Government', true),
  ('Dr. Shankarrao Chavan Government Medical College, Nanded', 'Nanded', 'Maharashtra', 'Government', true),
  ('Shri Vasantrao Naik Government Medical College, Yavatmal', 'Yavatmal', 'Maharashtra', 'Government', true),
  ('Shri Bhausaheb Hire Government Medical College, Dhule', 'Dhule', 'Maharashtra', 'Government', true),
  ('Government Medical College, Akola', 'Akola', 'Maharashtra', 'Government', true),
  ('R.C.S.M. Government Medical College and CPR Hospital, Kolhapur', 'Kolhapur', 'Maharashtra', 'Government', true),
  ('Swami Ramanand Teerth Rural Government Medical College, Ambajogai', 'Ambajogai', 'Maharashtra', 'Government', true),
  ('Vilasrao Deshmukh Government Medical College, Latur', 'Latur', 'Maharashtra', 'Government', true),
  ('Karmavir Dadasaheb Kannamwar Government Medical College, Chandrapur', 'Chandrapur', 'Maharashtra', 'Government', true),
  ('Government Medical College, Gondia', 'Gondia', 'Maharashtra', 'Government', true),
  ('Government Medical College, Jalgaon', 'Jalgaon', 'Maharashtra', 'Government', true),
  ('Punyashlok Ahilyadevi Holkar Government Medical College, Baramati', 'Baramati', 'Maharashtra', 'Government', true),
  ('Government Medical College and Hospital, Nandurbar', 'Nandurbar', 'Maharashtra', 'Government', true),
  ('Government Medical College, Satara', 'Satara', 'Maharashtra', 'Government', true),
  ('Government Medical College, Alibag', 'Alibag', 'Maharashtra', 'Government', true),
  ('Government Medical College, Sindhudurg', 'Sindhudurg', 'Maharashtra', 'Government', true),
  ('Government Medical College, Osmanabad (Dharashiv)', 'Dharashiv', 'Maharashtra', 'Government', true),
  ('Government Medical College, Ratnagiri', 'Ratnagiri', 'Maharashtra', 'Government', true),
  ('Government Medical College, Parbhani', 'Parbhani', 'Maharashtra', 'Government', true),
  ('Government Medical College, Gadchiroli', 'Gadchiroli', 'Maharashtra', 'Government', true),
  ('Government Medical College, Amravati', 'Amravati', 'Maharashtra', 'Government', true),
  ('Government Medical College, Washim', 'Washim', 'Maharashtra', 'Government', true),
  ('Government Medical College, Jalna', 'Jalna', 'Maharashtra', 'Government', true),
  ('Government Medical College, Buldhana', 'Buldhana', 'Maharashtra', 'Government', true),
  ('Government Medical College, Bhandara', 'Bhandara', 'Maharashtra', 'Government', true),
  ('Government Medical College, Hingoli', 'Hingoli', 'Maharashtra', 'Government', true),
  ('Government Medical College, Ambernath (Thane)', 'Ambernath', 'Maharashtra', 'Government', true),
  ('Government Medical College, G.T. Hospital Campus, Mumbai', 'Mumbai', 'Maharashtra', 'Government', true),
  ('MUHS Post Graduate Institute of Medical Education and Research, Nashik', 'Nashik', 'Maharashtra', 'Government', true),
  ('Seth GS Medical College, Mumbai', 'Mumbai', 'Maharashtra', 'Municipal', true),
  ('Topiwala National Medical College and BYL Nair Charitable Hospital, Mumbai', 'Mumbai', 'Maharashtra', 'Municipal', true),
  ('Lokmanya Tilak Municipal Medical College and Sion Hospital, Mumbai', 'Mumbai', 'Maharashtra', 'Municipal', true),
  ('HBT Medical College and Dr. R.N. Cooper Hospital, Juhu, Mumbai', 'Mumbai', 'Maharashtra', 'Municipal', true),
  ('Rajiv Gandhi Medical College and CSM Hospital, Kalwa, Thane', 'Thane', 'Maharashtra', 'Municipal', true),
  ('Bharatratna Atal Bihari Vajpayee Medical College, Pune', 'Pune', 'Maharashtra', 'Municipal', true),
  ('Post Graduate Institute of Yashwantrao Chavan Memorial Hospital, Pimpri-Chinchwad', 'Pimpri-Chinchwad', 'Maharashtra', 'Municipal', true),
  ('MIMER Medical College, Talegaon Dabhade, Pune', 'Talegaon Dabhade', 'Maharashtra', 'Private', true),
  ('R.K. Damani Medical College', 'Chhatrapati Sambhajinagar', 'Maharashtra', 'Private', true),
  ('K. J. Somaiya Medical College and Research Centre, Mumbai', 'Mumbai', 'Maharashtra', 'Private', true),
  ('Smt. Kashibai Navale Medical College and General Hospital, Pune', 'Pune', 'Maharashtra', 'Private', true),
  ('Terna Medical College, Nerul, Navi Mumbai', 'Navi Mumbai', 'Maharashtra', 'Private', true),
  ('Dr. Vasantrao Pawar Medical College Hospital and Research Centre, Nashik', 'Nashik', 'Maharashtra', 'Private', true),
  ('B.K.L. Walawalkar Rural Medical College, Dervan, Chiplun, Ratnagiri', 'Ratnagiri', 'Maharashtra', 'Private', true),
  ('ACPM Medical College, Dhule', 'Dhule', 'Maharashtra', 'Private', true),
  ('Ashwini Rural Medical College, Hospital and Research Centre, Solapur', 'Solapur', 'Maharashtra', 'Private', true),
  ('N.K.P. Salve Institute of Medical Sciences and Research Centre, Nagpur', 'Nagpur', 'Maharashtra', 'Private', true),
  ('Dr. Panjabrao Deshmukh Memorial Medical College, Amravati', 'Amravati', 'Maharashtra', 'Private', true),
  ('Dr. Ulhas Patil Medical College and Hospital, Jalgaon', 'Jalgaon', 'Maharashtra', 'Private', true),
  ('Dr. Vithalrao Vikhe Patil Foundations Medical College and Hospital, Ahmednagar', 'Ahmednagar', 'Maharashtra', 'Private', true),
  ('Maharashtra Institute of Medical Science and Research (MIMSR), Latur', 'Latur', 'Maharashtra', 'Private', true),
  ('Mahatma Gandhi Institute of Medical Sciences (MGIMS), Sevagram, Wardha', 'Sevagram', 'Maharashtra', 'Trust/Govt-Aided', true),
  ('Indian Institute of Medical Science and Research (IIMSR), Warudi, Jalna', 'Jalna', 'Maharashtra', 'Private', true),
  ('Prakash Institute of Medical Sciences and Research, Urun-Islampur, Sangli', 'Sangli', 'Maharashtra', 'Private', true),
  ('SMBT Institute of Medical Sciences and Research Centre, Nandi Hills, Nashik', 'Nashik', 'Maharashtra', 'Private', true),
  ('SSPM Medical College and Lifetime Hospital, Padave, Sindhudurg', 'Sindhudurg', 'Maharashtra', 'Private', true),
  ('Vedantaa Institute of Medical Sciences, Saswand, Dhundalwadi, Palghar', 'Palghar', 'Maharashtra', 'Private', true),
  ('Dr. N. Y. Tasgaonkar Institute of Medical Science, Karjat', 'Karjat', 'Maharashtra', 'Private', true),
  ('Dr. Rajendra Gode Medical College, Amravati', 'Amravati', 'Maharashtra', 'Private', true),
  ('Parbhani Medical College and Hospital, Parbhani', 'Parbhani', 'Maharashtra', 'Private', true),
  ('Dr. D. Y. Patil Medical College, Hospital and Research Centre, Pimpri, Pune', 'Pune', 'Maharashtra', 'Deemed', true),
  ('Dr. D. Y. Patil School of Medicine, Nerul, Navi Mumbai', 'Navi Mumbai', 'Maharashtra', 'Deemed', true),
  ('Dr. D. Y. Patil Medical College, Kasaba Bawada, Kolhapur', 'Kolhapur', 'Maharashtra', 'Deemed', true),
  ('Bharati Vidyapeeth University Medical College, Pune', 'Pune', 'Maharashtra', 'Deemed', true),
  ('Bharati Vidyapeeth Deemed University Medical College and Hospital, Sangli', 'Sangli', 'Maharashtra', 'Deemed', true),
  ('Krishna Institute of Medical Sciences (KIMS), Karad', 'Karad', 'Maharashtra', 'Deemed', true),
  ('Rural Medical College, Pravara Institute of Medical Sciences, Loni', 'Loni', 'Maharashtra', 'Deemed', true),
  ('MGM Medical College and Hospital, Kamothe, Navi Mumbai', 'Navi Mumbai', 'Maharashtra', 'Deemed', true),
  ('MGM Medical College and Hospital, Chhatrapati Sambhajinagar', 'Chhatrapati Sambhajinagar', 'Maharashtra', 'Deemed', true),
  ('Jawaharlal Nehru Medical College, Sawangi (Meghe), Wardha', 'Wardha', 'Maharashtra', 'Deemed', true),
  ('Datta Meghe Medical College, Wanadongri, Hingna, Nagpur', 'Nagpur', 'Maharashtra', 'Deemed', true),
  ('Symbiosis Medical College for Women (SMCW), Lavale, Pune', 'Pune', 'Maharashtra', 'Deemed', true)
ON CONFLICT (college_name) DO UPDATE SET
  city = EXCLUDED.city,
  college_type = EXCLUDED.college_type,
  state = EXCLUDED.state;

-- 3. Add medical_college_id foreign key columns to relevant tables
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

ALTER TABLE public.championship_registrations
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

ALTER TABLE public.championship_pulse_attempts
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

ALTER TABLE public.championship_leaderboard
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

ALTER TABLE public.championship_college_standings
  ADD COLUMN IF NOT EXISTS medical_college_id UUID REFERENCES public.medical_colleges(id);

-- Ensure UNIQUE (user_id, pulse_id) constraint exists on championship_pulse_attempts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'championship_pulse_attempts' AND c.conname = 'unique_user_pulse'
  ) THEN
    ALTER TABLE public.championship_pulse_attempts
      ADD CONSTRAINT unique_user_pulse UNIQUE (user_id, pulse_id);
  END IF;
END $$;

-- Ensure UNIQUE (college, pulse_id) constraint exists on championship_college_standings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'championship_college_standings' AND c.conname = 'unique_college_pulse'
  ) THEN
    ALTER TABLE public.championship_college_standings
      ADD CONSTRAINT unique_college_pulse UNIQUE (college, pulse_id);
  END IF;
END $$;

-- Indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_champ_reg_college_id ON public.championship_registrations (medical_college_id);
CREATE INDEX IF NOT EXISTS idx_champ_attempts_college_id ON public.championship_pulse_attempts (medical_college_id);
CREATE INDEX IF NOT EXISTS idx_champ_leaderboard_college_id ON public.championship_leaderboard (medical_college_id);
CREATE INDEX IF NOT EXISTS idx_champ_standings_college_id ON public.championship_college_standings (medical_college_id);

-- 4. Update attempt immutability check to support updates by service_role and postgres
CREATE OR REPLACE FUNCTION public.check_attempt_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    RAISE EXCEPTION 'Championship attempt history is immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Temporarily disable immutability trigger for pulse attempts backfill
ALTER TABLE public.championship_pulse_attempts DISABLE TRIGGER trg_immutable_pulse_attempts;

-- Helper block to map all existing student records and safely consolidate standings
DO $$
DECLARE
  v_mimer_id UUID;
  v_miraj_id UUID;
  v_damani_id UUID;
  v_seth_gs_id UUID;
  v_aiims_delhi_id UUID;
  v_dharashiv_id UUID;
  v_baramati_id UUID;

  v_dup RECORD;
  v_survivor_id UUID;
  v_canonical_name TEXT;
  v_total_score NUMERIC;
  v_avg_score NUMERIC;
  v_avg_acc NUMERIC;
  v_part_count INTEGER;
  v_top_scorer TEXT;
BEGIN
  SELECT id INTO v_mimer_id FROM public.medical_colleges WHERE college_name = 'MIMER Medical College, Talegaon Dabhade, Pune';
  SELECT id INTO v_miraj_id FROM public.medical_colleges WHERE college_name = 'Government Medical College, Miraj';
  SELECT id INTO v_damani_id FROM public.medical_colleges WHERE college_name = 'R.K. Damani Medical College';
  SELECT id INTO v_seth_gs_id FROM public.medical_colleges WHERE college_name = 'Seth GS Medical College, Mumbai';
  SELECT id INTO v_aiims_delhi_id FROM public.medical_colleges WHERE college_name = 'All India Institute of Medical Sciences (AIIMS), New Delhi';
  SELECT id INTO v_dharashiv_id FROM public.medical_colleges WHERE college_name = 'Government Medical College, Osmanabad (Dharashiv)';
  SELECT id INTO v_baramati_id FROM public.medical_colleges WHERE college_name = 'Punyashlok Ahilyadevi Holkar Government Medical College, Baramati';

  -- A. Backfill championship_registrations (Zero deletions)
  -- MIMER variations (matches all 16 variations, 25 students)
  UPDATE public.championship_registrations
  SET medical_college_id = v_mimer_id,
      medical_college = 'MIMER Medical College, Talegaon Dabhade, Pune'
  WHERE lower(medical_college) LIKE '%mimer%' OR lower(medical_college) LIKE '%maeer%';

  -- GMC Miraj variations (matches all 5 variations, 5 students)
  UPDATE public.championship_registrations
  SET medical_college_id = v_miraj_id,
      medical_college = 'Government Medical College, Miraj'
  WHERE lower(medical_college) LIKE '%miraj%';

  -- R.K. Damani variations (matches all 3 variations, 3 students)
  UPDATE public.championship_registrations
  SET medical_college_id = v_damani_id,
      medical_college = 'R.K. Damani Medical College'
  WHERE lower(medical_college) LIKE '%damani%' OR lower(medical_college) LIKE '%srims%';

  -- Seth GS variations (matches all 3 variations, 3 students)
  UPDATE public.championship_registrations
  SET medical_college_id = v_seth_gs_id,
      medical_college = 'Seth GS Medical College, Mumbai'
  WHERE lower(medical_college) LIKE '%seth%' OR lower(medical_college) LIKE '%gsmc%' OR (lower(medical_college) LIKE '%kem%' AND lower(medical_college) LIKE '%mumbai%');

  -- AIIMS Delhi (2 intentional test entries)
  UPDATE public.championship_registrations
  SET medical_college_id = v_aiims_delhi_id,
      medical_college = 'All India Institute of Medical Sciences (AIIMS), New Delhi'
  WHERE lower(medical_college) LIKE '%aiims%delhi%';

  -- GMC Dharashiv (matches 1 student)
  UPDATE public.championship_registrations
  SET medical_college_id = v_dharashiv_id,
      medical_college = 'Government Medical College, Osmanabad (Dharashiv)'
  WHERE lower(medical_college) LIKE '%dharashiv%';

  -- GMC Baramati
  UPDATE public.championship_registrations
  SET medical_college_id = v_baramati_id,
      medical_college = 'Punyashlok Ahilyadevi Holkar Government Medical College, Baramati'
  WHERE lower(medical_college) LIKE '%baramati%';

  -- Note: Any unrecognized raw entry (e.g. email string) is deliberately NOT modified or deleted,
  -- keeping medical_college_id as NULL until updated by the student via the dropdown.

  -- B. Backfill championship_pulse_attempts
  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_mimer_id,
      college = 'MIMER Medical College, Talegaon Dabhade, Pune'
  WHERE lower(college) LIKE '%mimer%' OR lower(college) LIKE '%maeer%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_miraj_id,
      college = 'Government Medical College, Miraj'
  WHERE lower(college) LIKE '%miraj%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_damani_id,
      college = 'R.K. Damani Medical College'
  WHERE lower(college) LIKE '%damani%' OR lower(college) LIKE '%srims%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_seth_gs_id,
      college = 'Seth GS Medical College, Mumbai'
  WHERE lower(college) LIKE '%seth%' OR lower(college) LIKE '%gsmc%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_aiims_delhi_id,
      college = 'All India Institute of Medical Sciences (AIIMS), New Delhi'
  WHERE lower(college) LIKE '%aiims%delhi%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_dharashiv_id,
      college = 'Government Medical College, Osmanabad (Dharashiv)'
  WHERE lower(college) LIKE '%dharashiv%';

  UPDATE public.championship_pulse_attempts
  SET medical_college_id = v_baramati_id,
      college = 'Punyashlok Ahilyadevi Holkar Government Medical College, Baramati'
  WHERE lower(college) LIKE '%baramati%';

  -- C. Backfill profiles.medical_college_id from championship_registrations
  UPDATE public.profiles p
  SET medical_college_id = r.medical_college_id
  FROM public.championship_registrations r
  WHERE lower(p.email) = lower(r.email)
    AND r.medical_college_id IS NOT NULL;

  -- D. Backfill championship_leaderboard
  UPDATE public.championship_leaderboard
  SET medical_college_id = v_mimer_id,
      college = 'MIMER Medical College, Talegaon Dabhade, Pune'
  WHERE lower(college) LIKE '%mimer%' OR lower(college) LIKE '%maeer%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_miraj_id,
      college = 'Government Medical College, Miraj'
  WHERE lower(college) LIKE '%miraj%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_damani_id,
      college = 'R.K. Damani Medical College'
  WHERE lower(college) LIKE '%damani%' OR lower(college) LIKE '%srims%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_seth_gs_id,
      college = 'Seth GS Medical College, Mumbai'
  WHERE lower(college) LIKE '%seth%' OR lower(college) LIKE '%gsmc%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_aiims_delhi_id,
      college = 'All India Institute of Medical Sciences (AIIMS), New Delhi'
  WHERE lower(college) LIKE '%aiims%delhi%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_dharashiv_id,
      college = 'Government Medical College, Osmanabad (Dharashiv)'
  WHERE lower(college) LIKE '%dharashiv%';

  UPDATE public.championship_leaderboard
  SET medical_college_id = v_baramati_id,
      college = 'Punyashlok Ahilyadevi Holkar Government Medical College, Baramati'
  WHERE lower(college) LIKE '%baramati%';

  -- E. Safe consolidation of duplicate entries in championship_college_standings
  -- Preserves all existing historical standings (Test College, DEBUG COLLEGE, etc.).
  -- Merges ONLY duplicate entries for the same canonical college in the same pulse.

  -- 1. Associate known medical_college_ids on existing standings rows
  UPDATE public.championship_college_standings
  SET medical_college_id = v_mimer_id
  WHERE lower(college) LIKE '%mimer%' OR lower(college) LIKE '%maeer%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_miraj_id
  WHERE lower(college) LIKE '%miraj%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_damani_id
  WHERE lower(college) LIKE '%damani%' OR lower(college) LIKE '%srims%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_seth_gs_id
  WHERE lower(college) LIKE '%seth%' OR lower(college) LIKE '%gsmc%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_aiims_delhi_id
  WHERE lower(college) LIKE '%aiims%delhi%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_dharashiv_id
  WHERE lower(college) LIKE '%dharashiv%';

  UPDATE public.championship_college_standings
  SET medical_college_id = v_baramati_id
  WHERE lower(college) LIKE '%baramati%';

  -- 2. Consolidate only the groups that have duplicate entries in the same pulse
  FOR v_dup IN (
    SELECT pulse_id, medical_college_id
    FROM public.championship_college_standings
    WHERE medical_college_id IS NOT NULL
    GROUP BY pulse_id, medical_college_id
    HAVING COUNT(*) > 1
  ) LOOP
    -- Select the primary survivor row (highest total_score or earliest id)
    SELECT id INTO v_survivor_id
    FROM public.championship_college_standings
    WHERE pulse_id = v_dup.pulse_id AND medical_college_id = v_dup.medical_college_id
    ORDER BY total_score DESC, participants_count DESC, id ASC
    LIMIT 1;

    -- Fetch canonical name for the college
    SELECT college_name INTO v_canonical_name
    FROM public.medical_colleges
    WHERE id = v_dup.medical_college_id;

    -- Aggregate stats from championship_leaderboard for this pulse & canonical college
    SELECT
      COALESCE(SUM(score), 0),
      COALESCE(ROUND(AVG(score), 0), 0),
      COALESCE(ROUND(AVG(accuracy), 1), 0),
      COUNT(*)
    INTO v_total_score, v_avg_score, v_avg_acc, v_part_count
    FROM public.championship_leaderboard
    WHERE pulse_id = v_dup.pulse_id AND medical_college_id = v_dup.medical_college_id;

    -- Find top scorer
    SELECT student_name INTO v_top_scorer
    FROM public.championship_leaderboard
    WHERE pulse_id = v_dup.pulse_id AND medical_college_id = v_dup.medical_college_id
    ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC
    LIMIT 1;

    -- Delete ONLY the duplicate splinter rows that merged into the survivor FIRST
    DELETE FROM public.championship_college_standings
    WHERE pulse_id = v_dup.pulse_id
      AND medical_college_id = v_dup.medical_college_id
      AND id != v_survivor_id;

    -- Update the survivor row with consolidated values and canonical name
    UPDATE public.championship_college_standings
    SET college = v_canonical_name,
        total_score = v_total_score,
        avg_score = v_avg_score,
        avg_accuracy = v_avg_acc,
        participants_count = v_part_count,
        top_scorer = COALESCE(v_top_scorer, top_scorer),
        updated_at = now()
    WHERE id = v_survivor_id;
  END LOOP;

  -- 3. Update single recognized college standings to their canonical spelling
  UPDATE public.championship_college_standings cs
  SET college = mc.college_name
  FROM public.medical_colleges mc
  WHERE cs.medical_college_id = mc.id
    AND cs.college != mc.college_name;

  -- 4. Re-rank college standings per pulse
  WITH ranked_colleges AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY total_score DESC, avg_accuracy DESC
    ) as calculated_rank
    FROM public.championship_college_standings
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

END $$;

-- Re-enable immutability trigger
ALTER TABLE public.championship_pulse_attempts ENABLE TRIGGER trg_immutable_pulse_attempts;

-- 5. Atomic submit_pulse_attempt_atomic RPC updated to support canonical college ID
DROP FUNCTION IF EXISTS public.submit_pulse_attempt_atomic(
  text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, jsonb
);

CREATE OR REPLACE FUNCTION public.submit_pulse_attempt_atomic(
  p_pulse_id text,
  p_pulse_date text,
  p_user_id text,
  p_user_email text,
  p_student_name text,
  p_college text,
  p_batch text,
  p_score numeric,
  p_accuracy numeric,
  p_time_taken_seconds numeric,
  p_xp numeric,
  p_answers jsonb,
  p_college_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_attempt_id uuid;
  v_submitted_at timestamptz := now();
  v_clean_batch text;
  v_canonical_college text;
  v_resolved_college_id uuid;
BEGIN
  -- Normalize batch
  v_clean_batch := coalesce(nullif(trim(p_batch), ''), '2026 Batch → Freshers');

  -- Resolve canonical college name and ID
  IF p_college_id IS NOT NULL THEN
    SELECT id, college_name INTO v_resolved_college_id, v_canonical_college
    FROM public.medical_colleges
    WHERE id = p_college_id;
  END IF;

  IF v_canonical_college IS NULL AND p_college IS NOT NULL THEN
    SELECT id, college_name INTO v_resolved_college_id, v_canonical_college
    FROM public.medical_colleges
    WHERE lower(college_name) = lower(trim(p_college))
       OR lower(college_name) LIKE lower(trim(p_college)) || '%'
    LIMIT 1;
  END IF;

  -- Fallback to provided college string if not found
  IF v_canonical_college IS NULL THEN
    v_canonical_college := coalesce(nullif(trim(p_college), ''), 'Medical College');
  END IF;

  -- 1. Check if user already submitted for this pulse
  SELECT id INTO v_existing_id
  FROM public.championship_pulse_attempts
  WHERE user_id = p_user_id AND pulse_id = p_pulse_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END IF;

  -- 2. Insert immutable attempt record
  BEGIN
    INSERT INTO public.championship_pulse_attempts (
      pulse_id, pulse_date, user_id, user_email, student_name, college,
      batch, score, accuracy, time_taken_seconds, completion_time, xp,
      answers, completed_at, submitted_at, created_at, medical_college_id
    ) VALUES (
      p_pulse_id, p_pulse_date, p_user_id, p_user_email, p_student_name, v_canonical_college,
      v_clean_batch, p_score, p_accuracy, p_time_taken_seconds, p_time_taken_seconds, p_xp,
      p_answers, v_submitted_at, v_submitted_at, v_submitted_at, v_resolved_college_id
    )
    RETURNING id INTO v_new_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
    FROM public.championship_pulse_attempts
    WHERE user_id = p_user_id AND pulse_id = p_pulse_id;

    RETURN jsonb_build_object(
      'success', false,
      'already_submitted', true,
      'message', 'You have already submitted this Pulse.',
      'attempt_id', v_existing_id
    );
  END;

  -- 3. Upsert into championship_leaderboard
  INSERT INTO public.championship_leaderboard (
    pulse_id, user_id, user_email, student_name, college, batch,
    score, accuracy, time_taken_seconds, submitted_at, updated_at, medical_college_id
  ) VALUES (
    p_pulse_id, p_user_id, p_user_email, p_student_name, v_canonical_college, v_clean_batch,
    p_score, p_accuracy, p_time_taken_seconds, v_submitted_at, v_submitted_at, v_resolved_college_id
  )
  ON CONFLICT (user_id, pulse_id) DO UPDATE SET
    score = EXCLUDED.score,
    accuracy = EXCLUDED.accuracy,
    time_taken_seconds = EXCLUDED.time_taken_seconds,
    college = EXCLUDED.college,
    medical_college_id = EXCLUDED.medical_college_id,
    updated_at = v_submitted_at;

  -- 4. Re-rank individual leaderboard for this pulse_id
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY score DESC, accuracy DESC, time_taken_seconds ASC, submitted_at ASC
    ) as calculated_rank
    FROM public.championship_leaderboard
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_leaderboard l
  SET rank = r.calculated_rank
  FROM ranked r
  WHERE l.id = r.id;

  -- 5. Recalculate College Standings (Grouped by canonical college identity)
  INSERT INTO public.championship_college_standings (
    pulse_id, college, medical_college_id, total_score, avg_score, avg_accuracy, participants_count, top_scorer, updated_at
  )
  SELECT
    p_pulse_id,
    l.college,
    l.medical_college_id,
    SUM(l.score) as total_score,
    ROUND(AVG(l.score), 0) as avg_score,
    ROUND(AVG(l.accuracy), 1) as avg_accuracy,
    COUNT(*) as participants_count,
    (
      SELECT student_name FROM public.championship_leaderboard l2
      WHERE l2.pulse_id = p_pulse_id AND l2.college = l.college
      ORDER BY l2.score DESC, l2.accuracy DESC, l2.time_taken_seconds ASC LIMIT 1
    ) as top_scorer,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = p_pulse_id
  GROUP BY l.college, l.medical_college_id
  ON CONFLICT (college, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    top_scorer = EXCLUDED.top_scorer,
    medical_college_id = EXCLUDED.medical_college_id,
    updated_at = v_submitted_at;

  -- Re-rank college standings
  WITH ranked_colleges AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY total_score DESC, avg_accuracy DESC
    ) as calculated_rank
    FROM public.championship_college_standings
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_college_standings cs
  SET rank = rc.calculated_rank
  FROM ranked_colleges rc
  WHERE cs.id = rc.id;

  -- 6. Recalculate Batch Standings
  INSERT INTO public.championship_batch_standings (
    pulse_id, batch, total_score, avg_score, avg_accuracy, participants_count, updated_at
  )
  SELECT
    p_pulse_id,
    l.batch,
    SUM(l.score) as total_score,
    ROUND(AVG(l.score), 0) as avg_score,
    ROUND(AVG(l.accuracy), 1) as avg_accuracy,
    COUNT(*) as participants_count,
    v_submitted_at
  FROM public.championship_leaderboard l
  WHERE l.pulse_id = p_pulse_id
  GROUP BY l.batch
  ON CONFLICT (batch, pulse_id) DO UPDATE SET
    total_score = EXCLUDED.total_score,
    avg_score = EXCLUDED.avg_score,
    avg_accuracy = EXCLUDED.avg_accuracy,
    participants_count = EXCLUDED.participants_count,
    updated_at = v_submitted_at;

  -- Re-rank batch standings
  WITH ranked_batches AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY pulse_id
      ORDER BY total_score DESC, avg_score DESC
    ) as calculated_rank
    FROM public.championship_batch_standings
    WHERE pulse_id = p_pulse_id
  )
  UPDATE public.championship_batch_standings bs
  SET rank = rb.calculated_rank
  FROM ranked_batches rb
  WHERE bs.id = rb.id;

  RETURN jsonb_build_object(
    'success', true,
    'already_submitted', false,
    'attempt_id', v_new_attempt_id,
    'score', p_score,
    'accuracy', p_accuracy,
    'canonical_college', v_canonical_college
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_pulse_attempt_atomic TO anon, authenticated, service_role;

-- 7. Add medical_colleges to Realtime publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.medical_colleges;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;

