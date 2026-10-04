-- ==============================================================================
-- Migration: 20261003_secure_pulse_attempts_least_privilege.sql
-- Description:
--   ENFORCE LEAST PRIVILEGE ON CHAMPIONSHIP PULSE ATTEMPTS (FORWARD-ONLY)
--
-- Security Fixes:
--   1. Revoke direct table-level INSERT, UPDATE, and DELETE on championship_pulse_attempts
--      from authenticated, anon, and public roles.
--   2. Drop verified permissive client insert policies ("Authenticated insert own pulse_attempt",
--      "Users insert own pulse attempt", "Public write pulse_attempts") that allowed authenticated
--      clients to bypass mandatory registration, spoof student scores, or insert forged user IDs.
--   3. Drop permissive public read policies ("Anon read pulse_attempts", "Public read pulse_attempts")
--      that exposed raw examination answers and student emails to unauthenticated web scrapers.
--   4. Implement strict SELECT policy: students can view only their own attempt records; verified
--      administrators and service_role retain full administrative query and audit access.
--   5. Maintain public leaderboard functionality via championship_leaderboard, which remains
--      safely readable without exposing raw answers or attempts tables.
--   6. Preserve atomic submission RPC (submit_pulse_attempt_atomic) with SECURITY DEFINER
--      and search_path = public, auth, pg_temp so authorized submissions remain fully operational.
-- ==============================================================================

BEGIN;

-- ── 1. REVOKE DIRECT TABLE-LEVEL MUTATION PRIVILEGES ───────────────────────────
-- Submissions must proceed EXCLUSIVELY through submit_pulse_attempt_atomic RPC.
REVOKE INSERT, UPDATE, DELETE ON public.championship_pulse_attempts FROM authenticated, anon, public;
GRANT ALL ON public.championship_pulse_attempts TO service_role;
GRANT SELECT ON public.championship_pulse_attempts TO authenticated;
REVOKE SELECT ON public.championship_pulse_attempts FROM anon, public;

-- ── 2. DROP PERMISSIVE POLICIES ON championship_pulse_attempts ──────────────────
DROP POLICY IF EXISTS "Authenticated insert own pulse_attempt" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Users insert own pulse attempt" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Public write pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Authenticated insert pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Anon read pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Public read pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Authenticated read own pulse_attempts" ON public.championship_pulse_attempts;
DROP POLICY IF EXISTS "Users view own pulse attempts" ON public.championship_pulse_attempts;

-- ── 3. CREATE STRICT LEAST-PRIVILEGE RLS POLICIES ─────────────────────────────
ALTER TABLE public.championship_pulse_attempts ENABLE ROW LEVEL SECURITY;

-- Students view ONLY their own attempt records; Admins and service_role view all.
-- Anonymous users have ZERO SELECT access to raw pulse attempts.
CREATE POLICY "Students and admins select pulse attempts"
  ON public.championship_pulse_attempts
  FOR SELECT
  TO authenticated, service_role
  USING (
    public.is_admin()
    OR (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role')
    OR (
      auth.role() = 'authenticated' AND (
        (user_id IS NOT NULL AND user_id = auth.uid()::text)
        OR (auth.jwt() ->> 'email' IS NOT NULL AND lower(user_email) = lower(auth.jwt() ->> 'email'))
      )
    )
  );

-- ── 4. ENSURE IMMUTABILITY TRIGGER IS ACTIVE ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_prevent_pulse_attempt_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Service role or administrative overrides if needed, otherwise attempts are 100% immutable
  IF (auth.role() = 'service_role' OR (auth.jwt() ->> 'role') = 'service_role') OR public.is_admin() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Unauthorized: Pulse attempt records are permanent and immutable.';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_pulse_attempts ON public.championship_pulse_attempts;
DROP TRIGGER IF EXISTS trg_prevent_pulse_attempt_tampering ON public.championship_pulse_attempts;
CREATE TRIGGER trg_prevent_pulse_attempt_tampering
  BEFORE UPDATE OR DELETE ON public.championship_pulse_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_prevent_pulse_attempt_tampering();

COMMIT;
