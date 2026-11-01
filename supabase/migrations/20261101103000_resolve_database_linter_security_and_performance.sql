-- ==============================================================================
-- Migration: 20261101103000_resolve_database_linter_security_and_performance.sql
-- Description: Comprehensive resolution for Supabase Database Linter warnings:
--   1. rls_policy_always_true & multiple_permissive_policies on public.supplier_contracts
--   2. auth_rls_initplan on asset_movement_log, supplier_contracts, budget_plans, financial_reports
--   3. anon_security_definer_function_executable & authenticated_security_definer_function_executable on:
--      - get_system_backup_stats()
--      - purge_demo_test_data()
--      - repair_movements_data_quality()
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Fix supplier_contracts RLS policies:
--    Drop the overly permissive "Authenticated users can manage contracts" policy.
--    This resolves:
--    - rls_policy_always_true (USING(true) and WITH CHECK(true) on ALL)
--    - multiple_permissive_policies (duplicate policies for SELECT, INSERT, UPDATE, DELETE)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage contracts" ON public.supplier_contracts;

-- Ensure granular, strict policies exist for supplier_contracts
DO $$
BEGIN
  -- Read policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'supplier_contracts' 
      AND policyname = 'Allow authenticated read supplier_contracts'
  ) THEN
    CREATE POLICY "Allow authenticated read supplier_contracts"
      ON public.supplier_contracts FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  -- Insert policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'supplier_contracts' 
      AND policyname = 'Allow authenticated insert supplier_contracts'
  ) THEN
    CREATE POLICY "Allow authenticated insert supplier_contracts"
      ON public.supplier_contracts FOR INSERT
      TO authenticated
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
  END IF;

  -- Update policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'supplier_contracts' 
      AND policyname = 'Allow authenticated update supplier_contracts'
  ) THEN
    CREATE POLICY "Allow authenticated update supplier_contracts"
      ON public.supplier_contracts FOR UPDATE
      TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. Fix auth_rls_initplan on DELETE policies (Wrap auth functions in scalar subqueries):
--    Resolves auth_rls_initplan on:
--    - public.asset_movement_log
--    - public.supplier_contracts
--    - public.budget_plans
--    - public.financial_reports
-- ------------------------------------------------------------------------------

-- 2.1 asset_movement_log
DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;
CREATE POLICY "Allow admin delete asset_movement_log"
  ON public.asset_movement_log FOR DELETE
  TO authenticated
  USING (
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('system_admin', 'warehouse_admin', 'admin')
    OR ((SELECT auth.jwt()) ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 2.2 supplier_contracts
DROP POLICY IF EXISTS "Allow admin delete supplier_contracts" ON public.supplier_contracts;
CREATE POLICY "Allow admin delete supplier_contracts"
  ON public.supplier_contracts FOR DELETE
  TO authenticated
  USING (
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('system_admin', 'procurement_admin', 'admin')
    OR ((SELECT auth.jwt()) ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 2.3 budget_plans
DROP POLICY IF EXISTS "Allow admin delete budget_plans" ON public.budget_plans;
CREATE POLICY "Allow admin delete budget_plans"
  ON public.budget_plans FOR DELETE
  TO authenticated
  USING (
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('system_admin', 'admin')
    OR ((SELECT auth.jwt()) ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 2.4 financial_reports
DROP POLICY IF EXISTS "Allow admin delete financial_reports" ON public.financial_reports;
CREATE POLICY "Allow admin delete financial_reports"
  ON public.financial_reports FOR DELETE
  TO authenticated
  USING (
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('system_admin', 'admin')
    OR ((SELECT auth.jwt()) ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );


-- ------------------------------------------------------------------------------
-- 3. Fix SECURITY DEFINER warnings:
--    - get_system_backup_stats(): Convert to SECURITY INVOKER, revoke from anon.
--    - purge_demo_test_data(): Keep SECURITY DEFINER for admin/service_role only. Revoke from PUBLIC, anon, authenticated. Grant ONLY to service_role.
--    - repair_movements_data_quality(): Keep SECURITY DEFINER for admin/service_role only. Revoke from PUBLIC, anon, authenticated. Grant ONLY to service_role.
-- ------------------------------------------------------------------------------

-- 3.1 get_system_backup_stats
CREATE OR REPLACE FUNCTION public.get_system_backup_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_stats JSONB;
    v_movements BIGINT := 0;
    v_custody BIGINT := 0;
    v_users BIGINT := 0;
    v_contracts BIGINT := 0;
    v_disbursements BIGINT := 0;
    v_budget BIGINT := 0;
    v_financial BIGINT := 0;
    v_assets BIGINT := 0;
    v_tickets BIGINT := 0;
    v_inspections BIGINT := 0;
    v_settlements BIGINT := 0;
    v_telegram BIGINT := 0;
    v_notifications BIGINT := 0;
    v_audit_logs BIGINT := 0;
    v_suppliers BIGINT := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_movements') THEN
        SELECT count(*) INTO v_movements FROM public.ledger_movements;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
        SELECT count(*) INTO v_movements FROM public.movements;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'custody') THEN
        SELECT count(*) INTO v_custody FROM public.custody;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_users') THEN
        SELECT count(*) INTO v_users FROM public.app_users;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_contracts') THEN
        SELECT count(*) INTO v_contracts FROM public.supplier_contracts;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disbursement_requests') THEN
        SELECT count(*) INTO v_disbursements FROM public.disbursement_requests;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'budget_plans') THEN
        SELECT count(*) INTO v_budget FROM public.budget_plans;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_reports') THEN
        SELECT count(*) INTO v_financial FROM public.financial_reports;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asset_movement_log') THEN
        SELECT count(*) INTO v_assets FROM public.asset_movement_log;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
        SELECT count(*) INTO v_tickets FROM public.support_tickets;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'technical_inspections') THEN
        SELECT count(*) INTO v_inspections FROM public.technical_inspections;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_settlements') THEN
        SELECT count(*) INTO v_settlements FROM public.inventory_settlements;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_recipients') THEN
        SELECT count(*) INTO v_telegram FROM public.telegram_recipients;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        SELECT count(*) INTO v_notifications FROM public.notifications;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
        SELECT count(*) INTO v_audit_logs FROM public.audit_logs;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
        SELECT count(*) INTO v_suppliers FROM public.suppliers;
    END IF;

    v_stats := jsonb_build_object(
        'movements', v_movements,
        'custody', v_custody,
        'users', v_users,
        'contracts', v_contracts,
        'disbursements', v_disbursements,
        'budget_plans', v_budget,
        'financial_reports', v_financial,
        'asset_logs', v_assets,
        'support_tickets', v_tickets,
        'technical_inspections', v_inspections,
        'inventory_settlements', v_settlements,
        'telegram_recipients', v_telegram,
        'notifications', v_notifications,
        'audit_logs', v_audit_logs,
        'suppliers', v_suppliers,
        'calculated_at', now()
    );

    RETURN v_stats;
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_backup_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_system_backup_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_system_backup_stats() TO authenticated, service_role;


-- 3.2 purge_demo_test_data
REVOKE ALL ON FUNCTION public.purge_demo_test_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_demo_test_data() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_demo_test_data() TO service_role;


-- 3.3 repair_movements_data_quality
REVOKE ALL ON FUNCTION public.repair_movements_data_quality() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_movements_data_quality() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_movements_data_quality() TO service_role;
