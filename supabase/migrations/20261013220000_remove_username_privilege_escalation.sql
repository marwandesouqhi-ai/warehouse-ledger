-- Migration: 20261013220000_remove_username_privilege_escalation.sql
-- Description: Enforce server-verified app_metadata for System Admin privileges and remove any username/email-based escalation.
-- Non-destructive, additive, idempotent.

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sysadmin BOOLEAN;
  v_role TEXT;
BEGIN
  v_sysadmin := COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false);
  v_role := COALESCE(auth.jwt()->'app_metadata'->>'role', '');

  -- Privileges are strictly derived from cryptographically verified app_metadata signed by Supabase Auth server.
  -- No hardcoded usernames, emails, or client-tamperable user_metadata are ever trusted.
  IF v_sysadmin = true OR v_role = 'system_admin' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Ensure public.app_role() relies strictly on is_system_admin() or app_metadata.role
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.is_system_admin() THEN
    RETURN 'system_admin';
  END IF;

  RETURN COALESCE(auth.jwt()->'app_metadata'->>'role', 'viewer');
END;
$$;
