-- ==============================================================================
-- Migration: 20261106140500_resolve_supabase_linter_warnings.sql
-- Description:
-- 1. Resolves 0003_auth_rls_initplan:
--    Replaces auth.uid() with (SELECT auth.uid()) in disbursement_requests policy
--    to prevent per-row function re-evaluation at scale.
-- 2. Resolves 0006_multiple_permissive_policies:
--    Drops duplicate permissive policies across:
--    - disbursement_requests (UPDATE, DELETE)
--    - supplier_contracts (INSERT, UPDATE, DELETE)
--    - financial_reports (INSERT, UPDATE, DELETE)
--    - budget_plans (INSERT, UPDATE, DELETE)
--    - asset_movement_log (DELETE)
--    Consolidates them into single canonical role-based policies (role_insert, role_update, role_delete).
-- 3. Resolves 0001_unindexed_foreign_keys:
--    Adds covering indexes on automation_hub tables for owner_id and task_id.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table: disbursement_requests (Fix multiple_permissive_policies & auth_rls_initplan)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authorized update disbursement_requests" ON public.disbursement_requests;
DROP POLICY IF EXISTS "Allow admin delete disbursement_requests" ON public.disbursement_requests;
DROP POLICY IF EXISTS "role_update" ON public.disbursement_requests;
DROP POLICY IF EXISTS "role_delete" ON public.disbursement_requests;

CREATE POLICY "role_update" ON public.disbursement_requests
  FOR UPDATE TO authenticated
  USING (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('warehouse_admin', 'system_admin')
    OR (created_by = (SELECT auth.uid()) AND status = 'pending')
  )
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('warehouse_admin', 'system_admin')
    OR (created_by = (SELECT auth.uid()))
  );

CREATE POLICY "role_delete" ON public.disbursement_requests
  FOR DELETE TO authenticated
  USING (
    public.app_can_modify_records()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Table: supplier_contracts (Fix multiple_permissive_policies)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow admin delete supplier_contracts" ON public.supplier_contracts;
DROP POLICY IF EXISTS "Allow authorized insert supplier_contracts" ON public.supplier_contracts;
DROP POLICY IF EXISTS "Allow authorized update supplier_contracts" ON public.supplier_contracts;
DROP POLICY IF EXISTS "role_insert" ON public.supplier_contracts;
DROP POLICY IF EXISTS "role_update" ON public.supplier_contracts;
DROP POLICY IF EXISTS "role_delete" ON public.supplier_contracts;

CREATE POLICY "role_insert" ON public.supplier_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_can_add_department('procurement')
  );

CREATE POLICY "role_update" ON public.supplier_contracts
  FOR UPDATE TO authenticated
  USING (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'system_admin')
  )
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'system_admin')
  );

CREATE POLICY "role_delete" ON public.supplier_contracts
  FOR DELETE TO authenticated
  USING (
    public.app_can_modify_records()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table: financial_reports (Fix multiple_permissive_policies)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow admin delete financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Allow authorized insert financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Allow authorized update financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "role_insert" ON public.financial_reports;
DROP POLICY IF EXISTS "role_update" ON public.financial_reports;
DROP POLICY IF EXISTS "role_delete" ON public.financial_reports;

CREATE POLICY "role_insert" ON public.financial_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'warehouse_admin', 'system_admin')
  );

CREATE POLICY "role_update" ON public.financial_reports
  FOR UPDATE TO authenticated
  USING (
    public.app_can_modify_records()
  )
  WITH CHECK (
    public.app_can_modify_records()
  );

CREATE POLICY "role_delete" ON public.financial_reports
  FOR DELETE TO authenticated
  USING (
    public.app_can_modify_records()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Table: budget_plans (Fix multiple_permissive_policies)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow admin delete budget_plans" ON public.budget_plans;
DROP POLICY IF EXISTS "Allow authorized insert budget_plans" ON public.budget_plans;
DROP POLICY IF EXISTS "Allow authorized update budget_plans" ON public.budget_plans;
DROP POLICY IF EXISTS "role_insert" ON public.budget_plans;
DROP POLICY IF EXISTS "role_update" ON public.budget_plans;
DROP POLICY IF EXISTS "role_delete" ON public.budget_plans;

CREATE POLICY "role_insert" ON public.budget_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_can_modify_records()
  );

CREATE POLICY "role_update" ON public.budget_plans
  FOR UPDATE TO authenticated
  USING (
    public.app_can_modify_records()
  )
  WITH CHECK (
    public.app_can_modify_records()
  );

CREATE POLICY "role_delete" ON public.budget_plans
  FOR DELETE TO authenticated
  USING (
    public.app_can_modify_records()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Table: asset_movement_log (Fix multiple_permissive_policies)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;
DROP POLICY IF EXISTS "role_delete" ON public.asset_movement_log;

CREATE POLICY "role_delete" ON public.asset_movement_log
  FOR DELETE TO authenticated
  USING (
    public.app_can_modify_records()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Covering Indexes for Foreign Keys (Fix 0001_unindexed_foreign_keys)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.automation_hub_commands') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_automation_hub_commands_owner_id ON public.automation_hub_commands(owner_id);
  END IF;
  IF to_regclass('public.automation_hub_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_automation_hub_events_owner_id ON public.automation_hub_events(owner_id);
    CREATE INDEX IF NOT EXISTS idx_automation_hub_events_task_id ON public.automation_hub_events(task_id);
  END IF;
  IF to_regclass('public.automation_hub_tasks') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_automation_hub_tasks_owner_id ON public.automation_hub_tasks(owner_id);
  END IF;
END $$;

