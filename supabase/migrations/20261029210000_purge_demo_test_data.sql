-- Migration: 20261029210000_purge_demo_test_data.sql
-- Description: Purges all mock/demo test data across modules 1 to 7 and creates a secure purge RPC function

-- 1. Clean up demo records from asset_movement_log
DELETE FROM public.asset_movement_log
WHERE asset_code IN ('ZNU-IT-001', 'ZNU-MED-044')
   OR id::text LIKE 'ast-%'
   OR notes LIKE '%TKT-28589%'
   OR notes LIKE '%شركة التوريدات الطبية%';

-- 2. Clean up demo records from supplier_contracts
DELETE FROM public.supplier_contracts
WHERE contract_number IN ('CNT-2026-001', 'CNT-2026-002')
   OR id::text LIKE 'cnt-%';

-- 3. Clean up demo records from budget_plans
DELETE FROM public.budget_plans
WHERE id::text LIKE 'bg-%';

-- 4. Clean up demo records from financial_reports
DELETE FROM public.financial_reports
WHERE report_number IN ('RPT-FIN-2026-Q3', 'RPT-FIN-2026-M10')
   OR id::text LIKE 'fr-%';

-- 5. Clean up demo records from notifications
DELETE FROM public.notifications
WHERE id::text LIKE 'notif-%'
   OR title LIKE '%مرحباً بك في منظومة مخازن جامعة الزقازيق الأهلية%';

-- 6. Ensure RLS policies allow admin deletion on asset_movement_log
DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;
CREATE POLICY "Allow admin delete asset_movement_log"
  ON public.asset_movement_log FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('system_admin', 'warehouse_admin', 'admin')
    OR (auth.jwt() ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 7. Ensure RLS policies allow admin deletion on supplier_contracts
DROP POLICY IF EXISTS "Allow admin delete supplier_contracts" ON public.supplier_contracts;
CREATE POLICY "Allow admin delete supplier_contracts"
  ON public.supplier_contracts FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('system_admin', 'procurement_admin', 'admin')
    OR (auth.jwt() ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 8. Ensure RLS policies allow admin deletion on budget_plans
DROP POLICY IF EXISTS "Allow admin delete budget_plans" ON public.budget_plans;
CREATE POLICY "Allow admin delete budget_plans"
  ON public.budget_plans FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('system_admin', 'admin')
    OR (auth.jwt() ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 9. Ensure RLS policies allow admin deletion on financial_reports
DROP POLICY IF EXISTS "Allow admin delete financial_reports" ON public.financial_reports;
CREATE POLICY "Allow admin delete financial_reports"
  ON public.financial_reports FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('system_admin', 'admin')
    OR (auth.jwt() ->> 'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

-- 10. Secure callable RPC function to purge demo test data anytime
CREATE OR REPLACE FUNCTION public.purge_demo_test_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_assets INT := 0;
  deleted_contracts INT := 0;
  deleted_budgets INT := 0;
  deleted_reports INT := 0;
  deleted_notifs INT := 0;
BEGIN
  -- 1. Asset movement logs
  WITH d1 AS (
    DELETE FROM public.asset_movement_log
    WHERE asset_code IN ('ZNU-IT-001', 'ZNU-MED-044')
       OR id::text LIKE 'ast-%'
       OR notes LIKE '%TKT-28589%'
       OR notes LIKE '%شركة التوريدات الطبية%'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_assets FROM d1;

  -- 2. Contracts
  WITH d2 AS (
    DELETE FROM public.supplier_contracts
    WHERE contract_number IN ('CNT-2026-001', 'CNT-2026-002')
       OR id::text LIKE 'cnt-%'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_contracts FROM d2;

  -- 3. Budget plans
  WITH d3 AS (
    DELETE FROM public.budget_plans
    WHERE id::text LIKE 'bg-%'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_budgets FROM d3;

  -- 4. Financial reports
  WITH d4 AS (
    DELETE FROM public.financial_reports
    WHERE report_number IN ('RPT-FIN-2026-Q3', 'RPT-FIN-2026-M10')
       OR id::text LIKE 'fr-%'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_reports FROM d4;

  -- 5. Notifications
  WITH d5 AS (
    DELETE FROM public.notifications
    WHERE id::text LIKE 'notif-%'
       OR title LIKE '%مرحباً بك في منظومة مخازن جامعة الزقازيق الأهلية%'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_notifs FROM d5;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_asset_movements', deleted_assets,
    'deleted_contracts', deleted_contracts,
    'deleted_budgets', deleted_budgets,
    'deleted_financial_reports', deleted_reports,
    'deleted_notifications', deleted_notifs,
    'purged_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_demo_test_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_demo_test_data() TO authenticated, service_role;

