-- ==============================================================================
-- Migration: 20261106101500_harden_modules_1_to_7_rls.sql
-- Description:
-- 1. Eliminates permissive RLS UPDATE policies (USING true WITH CHECK true) on
--    disbursement_requests, supplier_contracts, financial_reports, and budget_plans.
-- 2. Removes hardcoded administrator email ('marwandesowky2@gmail.com') from all DELETE policies.
-- 3. Enforces strict role checks aligned with public.app_effective_role() and department matrix.
-- ==============================================================================

-- 1. Hardening: disbursement_requests (طلبات الصرف الداخلي)
DROP POLICY IF EXISTS "Allow authenticated update disbursement_requests" ON public.disbursement_requests;
DROP POLICY IF EXISTS "Allow admin delete disbursement_requests" ON public.disbursement_requests;

CREATE POLICY "Allow authorized update disbursement_requests"
  ON public.disbursement_requests FOR UPDATE
  TO authenticated
  USING (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('warehouse_admin', 'system_admin')
    OR (
      -- Creators can only cancel their own pending requests
      created_by = auth.uid() AND status = 'pending'
    )
  )
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('warehouse_admin', 'system_admin')
    OR (
      created_by = auth.uid() AND status = 'rejected'
    )
  );

CREATE POLICY "Allow admin delete disbursement_requests"
  ON public.disbursement_requests FOR DELETE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  );

-- 2. Hardening: supplier_contracts (إدارة العقود مع الموردين)
DROP POLICY IF EXISTS "Allow authenticated insert supplier_contracts" ON public.supplier_contracts;
DROP POLICY IF EXISTS "Allow authenticated update supplier_contracts" ON public.supplier_contracts;
DROP POLICY IF EXISTS "Allow admin delete supplier_contracts" ON public.supplier_contracts;

CREATE POLICY "Allow authorized insert supplier_contracts"
  ON public.supplier_contracts FOR INSERT
  TO authenticated
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'procurement_employee', 'system_admin')
  );

CREATE POLICY "Allow authorized update supplier_contracts"
  ON public.supplier_contracts FOR UPDATE
  TO authenticated
  USING (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'system_admin')
  )
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'system_admin')
  );

CREATE POLICY "Allow admin delete supplier_contracts"
  ON public.supplier_contracts FOR DELETE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  );

-- 3. Hardening: financial_reports (التقارير المالية الدورية)
DROP POLICY IF EXISTS "Allow authenticated insert financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Allow authenticated update financial_reports" ON public.financial_reports;
DROP POLICY IF EXISTS "Allow admin delete financial_reports" ON public.financial_reports;

CREATE POLICY "Allow authorized insert financial_reports"
  ON public.financial_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() IN ('procurement_admin', 'warehouse_admin', 'system_admin')
  );

CREATE POLICY "Allow authorized update financial_reports"
  ON public.financial_reports FOR UPDATE
  TO authenticated
  USING (
    public.app_can_modify_records()
    OR public.app_effective_role() = 'system_admin'
  )
  WITH CHECK (
    public.app_can_modify_records()
    OR public.app_effective_role() = 'system_admin'
  );

CREATE POLICY "Allow admin delete financial_reports"
  ON public.financial_reports FOR DELETE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  );

-- 4. Hardening: budget_plans (الميزانية والتخطيط المالي)
DROP POLICY IF EXISTS "Allow authenticated insert budget_plans" ON public.budget_plans;
DROP POLICY IF EXISTS "Allow authenticated update budget_plans" ON public.budget_plans;
DROP POLICY IF EXISTS "Allow admin delete budget_plans" ON public.budget_plans;

CREATE POLICY "Allow authorized insert budget_plans"
  ON public.budget_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    public.app_effective_role() = 'system_admin'
  );

CREATE POLICY "Allow authorized update budget_plans"
  ON public.budget_plans FOR UPDATE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  )
  WITH CHECK (
    public.app_effective_role() = 'system_admin'
  );

CREATE POLICY "Allow admin delete budget_plans"
  ON public.budget_plans FOR DELETE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  );

-- 5. Hardening: asset_movement_log (سجل حركة الأصول)
DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;

CREATE POLICY "Allow admin delete asset_movement_log"
  ON public.asset_movement_log FOR DELETE
  TO authenticated
  USING (
    public.app_effective_role() = 'system_admin'
  );
