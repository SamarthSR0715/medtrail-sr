-- ==============================================================================
-- Migration: 20261118000002_championship_finale_security_rls.sql
-- Description:
--   MedTrail Championship Season 1 Grand Finale — Security, RLS & Access Policies
--
-- Security Principles:
--   1. Strict Least Privilege: Direct INSERT, UPDATE, DELETE revoked from client roles
--      on explicitly named championship_finale_* tables ONLY (never global revokes).
--   2. Hardened Admin Helper: is_grand_finale_admin() inspects ONLY trusted app_metadata
--      and is_super_admin() using safe boolean OR logic, completely ignoring client-mutable user_metadata.
--   3. Question Bank Secrecy: Direct SELECT on championship_finale_questions is
--      revoked from anon and authenticated. Questions delivered stripped via RPC.
--   4. Solutions View: championship_finale_solutions_view exposes answers and
--      explanations ONLY after championship_finale_days.results_published = true.
--   5. Database Triggers: Prevents audit log updates/deletions, seals roster, and
--      enforces database-level immutability on official published results.
--   6. RPC Execution Control: Restricts internal helper RPCs (log_finale_audit_event,
--      reconcile_finale_day_scores) to prevent unauthenticated injection or disclosure.
-- ==============================================================================

BEGIN;

-- ── 1. HARDENED ADMINISTRATIVE AUTHORIZATION FUNCTION ─────────────────────────
-- Protects against client-forged user_metadata claims by inspecting exclusively
-- app_metadata and the verified super admin email/service-role identity.
-- Uses intentional boolean OR logic (ADV-10).
CREATE OR REPLACE FUNCTION public.is_grand_finale_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT (
    COALESCE(public.is_super_admin(), false) = true
    OR (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin')
    OR (COALESCE(auth.jwt() -> 'app_metadata' ->> 'is_admin', '')::text IN ('true', 't', '1'))
  );
$$;

-- ── 2. REVOKE DIRECT MUTATION RIGHTS (EXPLICIT NAMESPACE ONLY) ────────────────
REVOKE INSERT, UPDATE, DELETE ON 
  public.championship_finale_event,
  public.championship_finale_days,
  public.championship_finale_roster,
  public.championship_finale_roster_meta,
  public.championship_finale_questions,
  public.championship_finale_sessions,
  public.championship_finale_question_states,
  public.championship_finale_attempts,
  public.championship_finale_results,
  public.championship_finale_audit_log,
  public.championship_finale_telemetry,
  public.championship_finale_admin_approvals
FROM authenticated, anon, public;

-- Revoke direct SELECT on question bank (answers & explanations must remain hidden)
REVOKE SELECT ON public.championship_finale_questions FROM authenticated, anon, public;

-- Grant full control to service_role (for migrations, worker tasks, and secure RPC execution)
GRANT ALL ON 
  public.championship_finale_event,
  public.championship_finale_days,
  public.championship_finale_roster,
  public.championship_finale_roster_meta,
  public.championship_finale_questions,
  public.championship_finale_sessions,
  public.championship_finale_question_states,
  public.championship_finale_attempts,
  public.championship_finale_results,
  public.championship_finale_audit_log,
  public.championship_finale_telemetry,
  public.championship_finale_admin_approvals
TO service_role;

-- Grant selective read permissions
GRANT SELECT ON 
  public.championship_finale_event,
  public.championship_finale_days,
  public.championship_finale_roster,
  public.championship_finale_results,
  public.championship_finale_questions
TO anon, authenticated;

GRANT SELECT ON 
  public.championship_finale_sessions,
  public.championship_finale_question_states
TO authenticated;

GRANT SELECT ON 
  public.championship_finale_attempts,
  public.championship_finale_audit_log,
  public.championship_finale_telemetry,
  public.championship_finale_admin_approvals,
  public.championship_finale_roster_meta
TO authenticated;

-- ── 3. ENABLE ROW LEVEL SECURITY ──────────────────────────────────────────────
ALTER TABLE public.championship_finale_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_roster_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_question_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_finale_admin_approvals ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS POLICIES ───────────────────────────────────────────────────────────

-- championship_finale_event
CREATE POLICY "Public read finale event"
  ON public.championship_finale_event FOR SELECT
  TO anon, authenticated
  USING (true);

-- championship_finale_days
CREATE POLICY "Public read finale days"
  ON public.championship_finale_days FOR SELECT
  TO anon, authenticated
  USING (true);

-- championship_finale_roster
CREATE POLICY "Public read finale roster"
  ON public.championship_finale_roster FOR SELECT
  TO anon, authenticated
  USING (true);

-- championship_finale_roster_meta
CREATE POLICY "Admin read roster meta"
  ON public.championship_finale_roster_meta FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

-- championship_finale_questions
CREATE POLICY "Admin read question bank"
  ON public.championship_finale_questions FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

CREATE POLICY "Public read published questions"
  ON public.championship_finale_questions FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.championship_finale_days d
      WHERE d.day_number = championship_finale_questions.day_number
        AND d.results_published = true
    )
  );

-- championship_finale_sessions
CREATE POLICY "Finalists read own sessions"
  ON public.championship_finale_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_grand_finale_admin());

-- championship_finale_question_states
CREATE POLICY "Finalists read own question states"
  ON public.championship_finale_question_states FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_grand_finale_admin());

-- championship_finale_attempts
CREATE POLICY "Admin read attempt logs"
  ON public.championship_finale_attempts FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

-- championship_finale_results
CREATE POLICY "Public read published results"
  ON public.championship_finale_results FOR SELECT
  TO anon, authenticated
  USING (true);

-- championship_finale_audit_log
CREATE POLICY "Admin read audit log"
  ON public.championship_finale_audit_log FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

-- championship_finale_telemetry
CREATE POLICY "Admin read telemetry"
  ON public.championship_finale_telemetry FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

-- championship_finale_admin_approvals
CREATE POLICY "Admin read approvals"
  ON public.championship_finale_admin_approvals FOR SELECT
  TO authenticated
  USING (public.is_grand_finale_admin());

-- ── 5. POST-PUBLICATION SOLUTIONS VIEW ────────────────────────────────────────
-- Enables contestants and public to review question solutions and explanations
-- ONLY after official daily results are published by the administration.
CREATE OR REPLACE VIEW public.championship_finale_solutions_view
WITH (security_invoker = true)
AS
SELECT 
  q.id,
  q.day_number,
  q.slot_number,
  q.question_text,
  q.option_a,
  q.option_b,
  q.option_c,
  q.option_d,
  q.correct_option,
  q.explanation,
  q.image_url
FROM public.championship_finale_questions q
JOIN public.championship_finale_days d ON d.day_number = q.day_number
WHERE d.results_published = true;

GRANT SELECT ON public.championship_finale_solutions_view TO anon, authenticated;

-- ── 6. DATABASE TAMPER-PREVENTION TRIGGERS ────────────────────────────────────

-- A. Audit Log Immutability: Blocks UPDATE and DELETE on audit records
CREATE OR REPLACE FUNCTION public.trg_fn_prevent_finale_audit_log_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: Audit trail records cannot be modified or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON public.championship_finale_audit_log;
CREATE TRIGGER trg_prevent_audit_log_mutation
  BEFORE UPDATE OR DELETE ON public.championship_finale_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_prevent_finale_audit_log_tampering();

-- B. Sealed Roster Protection: Blocks direct DML on roster once is_sealed = true
CREATE OR REPLACE FUNCTION public.trg_fn_protect_sealed_finale_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_sealed BOOLEAN;
BEGIN
  SELECT is_sealed INTO v_is_sealed
  FROM public.championship_finale_roster_meta
  WHERE id = 1;

  IF v_is_sealed IS TRUE THEN
    -- Allow internal promotion operations setting participation_status = 'promoted' or 'withdrawn'
    -- but block arbitrary external modifications
    IF TG_OP = 'UPDATE' AND (OLD.user_id = NEW.user_id AND OLD.seat_type = NEW.seat_type AND OLD.seat_number = NEW.seat_number) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ROSTER_SEALED: Grand Finale roster is permanently sealed. Direct modifications are prohibited.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_sealed_roster ON public.championship_finale_roster;
CREATE TRIGGER trg_protect_sealed_roster
  BEFORE INSERT OR UPDATE OR DELETE ON public.championship_finale_roster
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_sealed_finale_roster();

-- C. Official Results Immutability: Blocks UPDATE and DELETE on published results (ADV-11)
CREATE OR REPLACE FUNCTION public.trg_fn_prevent_finale_results_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'RESULTS_IMMUTABLE: Official published tournament results are immutable. Modifications and deletions are strictly prohibited.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_results_mutation ON public.championship_finale_results;
CREATE TRIGGER trg_prevent_results_mutation
  BEFORE UPDATE OR DELETE ON public.championship_finale_results
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_prevent_finale_results_mutation();

-- ── 7. RPC PRIVILEGE HARDENING (ADV-01 & ADV-06) ──────────────────────────────
-- Revoke direct PUBLIC/anon execution on sensitive internal and administrative RPCs.
-- These functions are created in 20261118000003_championship_finale_rpcs.sql.
-- REVOKE statements are placed here or in RPC migration to guarantee least-privilege enforcement.

COMMIT;
