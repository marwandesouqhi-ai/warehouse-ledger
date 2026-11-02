-- ==============================================================================
-- Rollback Migration: 20261102220000_harden_security_and_privilege_escalation.rollback.sql
-- ==============================================================================

-- Revert movements policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'movements') THEN
    DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;
    CREATE POLICY "movements_delete_policy" ON public.movements FOR DELETE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL);

    DROP POLICY IF EXISTS "movements_update_policy" ON public.movements;
    CREATE POLICY "movements_update_policy" ON public.movements FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;

-- Revert custody_items policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custody_items') THEN
    DROP POLICY IF EXISTS "custody_items_delete_policy" ON public.custody_items;
    CREATE POLICY "custody_items_delete_policy" ON public.custody_items FOR DELETE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL);

    DROP POLICY IF EXISTS "custody_items_update_policy" ON public.custody_items;
    CREATE POLICY "custody_items_update_policy" ON public.custody_items FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;

-- Revert disbursement_requests policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'disbursement_requests') THEN
    DROP POLICY IF EXISTS "disbursement_requests_update_policy" ON public.disbursement_requests;
    CREATE POLICY "disbursement_requests_update_policy" ON public.disbursement_requests FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Revert supplier_contracts policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'supplier_contracts') THEN
    DROP POLICY IF EXISTS "supplier_contracts_insert_policy" ON public.supplier_contracts;
    CREATE POLICY "supplier_contracts_insert_policy" ON public.supplier_contracts FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

    DROP POLICY IF EXISTS "supplier_contracts_update_policy" ON public.supplier_contracts;
    CREATE POLICY "supplier_contracts_update_policy" ON public.supplier_contracts FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;

-- Revert budget_plans policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'budget_plans') THEN
    DROP POLICY IF EXISTS "budget_plans_insert_policy" ON public.budget_plans;
    CREATE POLICY "budget_plans_insert_policy" ON public.budget_plans FOR INSERT TO authenticated
      WITH CHECK (true);

    DROP POLICY IF EXISTS "budget_plans_update_policy" ON public.budget_plans;
    CREATE POLICY "budget_plans_update_policy" ON public.budget_plans FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Revert financial_reports policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'financial_reports') THEN
    DROP POLICY IF EXISTS "financial_reports_insert_policy" ON public.financial_reports;
    CREATE POLICY "financial_reports_insert_policy" ON public.financial_reports FOR INSERT TO authenticated
      WITH CHECK (true);

    DROP POLICY IF EXISTS "financial_reports_update_policy" ON public.financial_reports;
    CREATE POLICY "financial_reports_update_policy" ON public.financial_reports FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

