-- ==============================================================================
-- Migration: 20260930_pulse_publishing_persistence.sql
-- Description: Secure atomic publishing of Pulse sets and questions
-- Ensures championship_pulse_sets and championship_pulse_questions are persisted
-- in a single atomic transaction with proper admin authorization.
-- ==============================================================================

-- 1. Grant table-level permissions to authenticated role so RLS policies can be evaluated
GRANT SELECT, INSERT, UPDATE, DELETE ON public.championship_pulse_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.championship_pulse_questions TO authenticated;

-- 2. Create atomic publishing function
CREATE OR REPLACE FUNCTION public.publish_pulse_set_atomic(
  p_pulse_date text,
  p_questions jsonb,
  p_status text DEFAULT 'published',
  p_admin_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_authorized boolean := false;
  v_pulse_set_id uuid;
  v_q jsonb;
  v_slot int := 1;
  v_now timestamptz := now();
  v_questions_count int := 0;
  v_caller_email text;
  v_parsed_date date;
BEGIN
  -- 1. Check authorization
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR auth.role() = 'service_role' THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized AND public.is_admin() THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    v_caller_email := lower(coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email', ''));
    IF v_caller_email = 'samarthrautrao715@gmail.com' THEN
      v_is_authorized := true;
    ELSIF auth.uid() IS NOT NULL THEN
      IF exists (select 1 from auth.users where id = auth.uid() and lower(email) = 'samarthrautrao715@gmail.com') THEN
        v_is_authorized := true;
      END IF;
    ELSIF p_admin_email IS NOT NULL AND lower(trim(p_admin_email)) = 'samarthrautrao715@gmail.com' THEN
      IF auth.role() = 'service_role' OR current_setting('request.jwt.claim.role', true) IN ('admin', 'service_role') THEN
        v_is_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    IF ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean IS TRUE)
       OR ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean IS TRUE)
    THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin privileges required to publish pulse questions.'
    );
  END IF;

  -- 2. Validate inputs
  IF p_pulse_date IS NULL OR trim(p_pulse_date) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pulse_date.');
  END IF;

  BEGIN
    v_parsed_date := trim(p_pulse_date)::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pulse_date format. Expected YYYY-MM-DD.');
  END;

  IF p_questions IS NULL OR jsonb_array_length(p_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Questions list cannot be empty.');
  END IF;

  -- 3. Atomic UPSERT into championship_pulse_sets
  INSERT INTO public.championship_pulse_sets (
    pulse_date,
    status,
    questions,
    published_at,
    updated_at
  )
  VALUES (
    v_parsed_date,
    coalesce(nullif(trim(p_status), ''), 'published'),
    p_questions,
    v_now,
    v_now
  )
  ON CONFLICT (pulse_date) DO UPDATE SET
    status = EXCLUDED.status,
    questions = EXCLUDED.questions,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_pulse_set_id;

  -- 4. Delete old rows from championship_pulse_questions for this pulse_set_id
  DELETE FROM public.championship_pulse_questions
  WHERE pulse_set_id = v_pulse_set_id;

  -- 5. Insert new rows into championship_pulse_questions using the exact pulse_set_id
  v_slot := 1;
  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO public.championship_pulse_questions (
      pulse_set_id,
      pulse_date,
      slot,
      question,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer,
      explanation,
      subject,
      difficulty,
      xp_value
    )
    VALUES (
      v_pulse_set_id,
      v_parsed_date,
      coalesce((v_q->>'slot')::int, v_slot),
      coalesce(v_q->>'question', ''),
      coalesce(v_q->>'option_a', v_q->>'optionA', ''),
      coalesce(v_q->>'option_b', v_q->>'optionB', ''),
      coalesce(v_q->>'option_c', v_q->>'optionC', ''),
      coalesce(v_q->>'option_d', v_q->>'optionD', ''),
      upper(coalesce(v_q->>'correct_answer', v_q->>'correctAnswer', 'A')),
      coalesce(v_q->>'explanation', ''),
      CASE 
        WHEN coalesce(v_q->>'subject', '') IN ('Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'General')
        THEN v_q->>'subject'
        ELSE 'General'
      END,
      CASE
        WHEN coalesce(v_q->>'difficulty', '') IN ('Easy', 'Medium', 'Hard')
        THEN v_q->>'difficulty'
        ELSE 'Medium'
      END,
      coalesce((v_q->>'xp_value')::integer, (v_q->>'xp')::integer, 50)
    );
    v_slot := v_slot + 1;
    v_questions_count := v_questions_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'pulse_id', v_pulse_set_id,
    'pulse_date', v_parsed_date::text,
    'status', coalesce(nullif(trim(p_status), ''), 'published'),
    'published_at', v_now,
    'questions_count', v_questions_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_pulse_set_atomic TO anon, authenticated, service_role;
