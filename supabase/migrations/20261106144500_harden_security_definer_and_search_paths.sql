-- ==============================================================================
-- Migration: 20261106144500_harden_security_definer_and_search_paths.sql
-- Description:
-- 1. Resolves function_search_path_mutable & anon/authenticated execution on trigger:
--    - public.protect_user_roles_trigger() is an internal trigger function.
--    - Pins search_path to 'public', 'pg_temp'.
--    - Revokes execute from PUBLIC, anon, authenticated (trigger is internal only).
-- 2. Resolves authenticated_security_definer_function_executable on create_purchase_order:
--    - Converts create_purchase_order(uuid) to SECURITY INVOKER with pinned search_path.
-- 3. Hardens search_path and revokes anon on critical SECURITY DEFINER RPCs:
--    - record_purchase, record_warehouse_issue, and app_effective_role.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger Function: protect_user_roles_trigger
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'protect_user_roles_trigger'
  ) THEN
    -- Fix function_search_path_mutable
    ALTER FUNCTION public.protect_user_roles_trigger() SET search_path = public, pg_temp;
    
    -- Fix anon_security_definer_function_executable & authenticated_security_definer_function_executable
    REVOKE ALL ON FUNCTION public.protect_user_roles_trigger() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.protect_user_roles_trigger() TO service_role;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Procurement RPC: create_purchase_order
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'create_purchase_order'
  ) THEN
    -- Convert to SECURITY INVOKER so it executes with calling user's RLS privileges
    ALTER FUNCTION public.create_purchase_order(uuid) SECURITY INVOKER;
    ALTER FUNCTION public.create_purchase_order(uuid) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.create_purchase_order(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid) TO authenticated, service_role;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Security Hardening on Remaining Business RPCs
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- record_purchase: Pin search_path and guarantee zero anon access
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'record_purchase'
  ) THEN
    ALTER FUNCTION public.record_purchase(text, text, numeric, numeric, text, text, text, text, text) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.record_purchase(text, text, numeric, numeric, text, text, text, text, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.record_purchase(text, text, numeric, numeric, text, text, text, text, text) TO authenticated, service_role;
  END IF;

  -- record_warehouse_issue: Pin search_path and guarantee zero anon access
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'record_warehouse_issue'
  ) THEN
    ALTER FUNCTION public.record_warehouse_issue(jsonb) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.record_warehouse_issue(jsonb) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.record_warehouse_issue(jsonb) TO authenticated, service_role;
  END IF;

  -- app_effective_role: Pin search_path and guarantee zero anon access
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'app_effective_role'
  ) THEN
    ALTER FUNCTION public.app_effective_role() SET search_path = public, auth, pg_temp;
    REVOKE ALL ON FUNCTION public.app_effective_role() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.app_effective_role() TO authenticated, service_role;
  END IF;
END $$;

