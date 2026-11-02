-- ==============================================================================
-- Migration: 20261102220000_harden_security_and_privilege_escalation.sql
-- Security Hardening:
-- 1. Protect public.app_users from privilege escalation (forbid self-role/permission updates).
-- 2. Restrict public.movements UPDATE and DELETE to authorized roles / manage_records.
-- 3. Restrict public.custody_items UPDATE and DELETE to authorized roles / manage_records.
-- 4. Restrict public.disbursement_requests approval/status changes to warehouse/system admins.
-- 5. Restrict public.supplier_contracts INSERT and UPDATE to procurement/system admins.
-- 6. Restrict public.budget_plans INSERT and UPDATE to authorized department/system admins.
-- 7. Restrict public.financial_reports INSERT and UPDATE to authorized financial admins.
-- ==============================================================================

-- ─── 1. UPGRADE FUNCTION: protect_system_admin_row on public.app_users ────────
CREATE OR REPLACE FUNCTION public.protect_system_admin_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_user TEXT;
  v_auth_role TEXT;
  v_is_direct_dba BOOLEAN;
  v_caller_role TEXT;
  v_caller_email TEXT;
  v_caller_is_sysadmin BOOLEAN;
BEGIN
  v_session_user := session_user;
  v_auth_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    NULLIF(current_setting('role', true), '')
  );

  -- Only direct SQL Editor / psql session by postgres or supabase_admin is allowed emergency maintenance
  v_is_direct_dba := (v_session_user IN ('postgres', 'supabase_admin')) AND (v_auth_role IS DISTINCT FROM 'service_role');

  -- Extract caller app_metadata role and email from JWT
  v_caller_role := COALESCE(current_setting('request.jwt.claim.app_metadata.role', true), (auth.jwt()->'app_metadata'->>'role'));
  v_caller_email := LOWER(TRIM(COALESCE(current_setting('request.jwt.claim.email', true), auth.jwt()->>'email', '')));
  v_caller_is_sysadmin := (
    v_caller_role = 'system_admin'
    OR COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true
    OR v_caller_email IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
  );

  -- ─── BEFORE DELETE ──────────────────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب مدير النظام الرئيسي (marwan-desouky) محمي بشكل دائم ولا يمكن حذفه نهائياً من قاعدة البيانات.';
      END IF;
    END IF;

    IF LOWER(TRIM(OLD.username)) = 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب المشرف الرئيسي (admin) محمي ولا يمكن حذفه.';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  -- ─── BEFORE UPDATE ──────────────────────────────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    -- A. Protection for marwan-desouky
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        IF (OLD.username IS DISTINCT FROM NEW.username) OR
           (OLD.role IS DISTINCT FROM NEW.role) OR
           (OLD.status IS DISTINCT FROM NEW.status) OR
           (OLD.permissions IS DISTINCT FROM NEW.permissions) OR
           (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id AND OLD.auth_user_id IS NOT NULL) OR
           (OLD.password IS DISTINCT FROM NEW.password) THEN
          RAISE EXCEPTION 'غير مصرح: بيانات وهوية حساب مدير النظام الرئيسي (marwan-desouky) محمية بالكامل ولا يمكن تعديلها.';
        END IF;

        IF NEW.must_change_password IS TRUE AND OLD.must_change_password IS NOT TRUE THEN
          RAISE EXCEPTION 'غير مصرح: لا يمكن فرض تغيير كلمة المرور على حساب مدير النظام الرئيسي.';
        END IF;
      END IF;
    END IF;

    -- B. Protection for root admin
    IF LOWER(TRIM(OLD.username)) = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن تخفيض صلاحيات المشرف الرئيسي (admin).';
      END IF;
    END IF;

    -- C. UNIVERSAL PRIVILEGE ESCALATION PREVENTION:
    -- For ALL users: Any modification of role, permissions, status, or department
    -- MUST be performed by a verified system_admin or service_role / direct DBA.
    IF (OLD.role IS DISTINCT FROM NEW.role) OR
       (OLD.permissions IS DISTINCT FROM NEW.permissions) OR
       (OLD.status IS DISTINCT FROM NEW.status) OR
       (OLD.department IS DISTINCT FROM NEW.department) THEN
      IF NOT v_is_direct_dba AND (v_auth_role IS DISTINCT FROM 'service_role') THEN
        IF NOT v_caller_is_sysadmin THEN
          RAISE EXCEPTION 'غير مصرح: تعديل الأدوار الوظيفية والصلاحيات وحالة الحساب مقتصر حصرياً على مدير النظام الرئيسي.';
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- ─── BEFORE INSERT ──────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF public.is_protected_username(NEW.username) THEN
      IF EXISTS (
        SELECT 1 FROM public.app_users 
        WHERE public.is_protected_username(username)
      ) THEN
        RAISE EXCEPTION 'اسم المستخدم محجوز لحساب مدير النظام الرئيسي ولا يمكن إنشاء حساب مطابق أو مشابه.';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger is active on public.app_users
DROP TRIGGER IF EXISTS trg_protect_system_admin_row ON public.app_users;
CREATE TRIGGER trg_protect_system_admin_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_admin_row();


-- ─── 2. TABLE: public.movements (Ledger RLS Hardening) ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'movements') THEN
    DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;
    CREATE POLICY "movements_delete_policy"
      ON public.movements FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    DROP POLICY IF EXISTS "movements_update_policy" ON public.movements;
    CREATE POLICY "movements_update_policy"
      ON public.movements FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN (
          'system_admin', 'warehouse_admin', 'warehouse_employee',
          'procurement_admin', 'procurement_employee', 'admin', 'editor', 'warehouse_staff', 'purchasing_staff'
        )
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN (
          'system_admin', 'warehouse_admin', 'warehouse_employee',
          'procurement_admin', 'procurement_employee', 'admin', 'editor', 'warehouse_staff', 'purchasing_staff'
        )
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─── 3. TABLE: public.custody_items (Custody RLS Hardening) ───────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custody_items') THEN
    REVOKE ALL ON public.custody_items FROM anon;
    GRANT SELECT ON public.custody_items TO anon;

    DROP POLICY IF EXISTS "custody_items_delete_policy" ON public.custody_items;
    CREATE POLICY "custody_items_delete_policy"
      ON public.custody_items FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    DROP POLICY IF EXISTS "custody_items_update_policy" ON public.custody_items;
    CREATE POLICY "custody_items_update_policy"
      ON public.custody_items FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN (
          'system_admin', 'warehouse_admin', 'warehouse_employee', 'admin', 'editor', 'warehouse_staff'
        )
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN (
          'system_admin', 'warehouse_admin', 'warehouse_employee', 'admin', 'editor', 'warehouse_staff'
        )
        OR ((SELECT auth.jwt())->'app_metadata'->'permissions' ? 'manage_records')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─── 4. TABLE: public.disbursement_requests (Disbursement Approval Hardening) ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'disbursement_requests') THEN
    DROP POLICY IF EXISTS "Allow authenticated update disbursement_requests" ON public.disbursement_requests;
    DROP POLICY IF EXISTS "disbursement_requests_update_policy" ON public.disbursement_requests;

    CREATE POLICY "disbursement_requests_update_policy"
      ON public.disbursement_requests FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
        OR (
          (created_by = (SELECT auth.uid()) OR created_by_email = (SELECT auth.jwt()->>'email'))
          AND status = 'pending'
        )
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
        OR (
          (created_by = (SELECT auth.uid()) OR created_by_email = (SELECT auth.jwt()->>'email'))
          AND status = 'pending'
        )
      );
  END IF;
END $$;


-- ─── 5. TABLE: public.supplier_contracts (Supplier Contracts Hardening) ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'supplier_contracts') THEN
    DROP POLICY IF EXISTS "Allow authenticated insert supplier_contracts" ON public.supplier_contracts;
    DROP POLICY IF EXISTS "supplier_contracts_insert_policy" ON public.supplier_contracts;

    CREATE POLICY "supplier_contracts_insert_policy"
      ON public.supplier_contracts FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'procurement_employee', 'admin', 'purchasing_staff')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    DROP POLICY IF EXISTS "Allow authenticated update supplier_contracts" ON public.supplier_contracts;
    DROP POLICY IF EXISTS "supplier_contracts_update_policy" ON public.supplier_contracts;

    CREATE POLICY "supplier_contracts_update_policy"
      ON public.supplier_contracts FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─── 6. TABLE: public.budget_plans (Budget Management Hardening) ─────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'budget_plans') THEN
    DROP POLICY IF EXISTS "Allow authenticated insert budget_plans" ON public.budget_plans;
    DROP POLICY IF EXISTS "budget_plans_insert_policy" ON public.budget_plans;

    CREATE POLICY "budget_plans_insert_policy"
      ON public.budget_plans FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    DROP POLICY IF EXISTS "Allow authenticated update budget_plans" ON public.budget_plans;
    DROP POLICY IF EXISTS "budget_plans_update_policy" ON public.budget_plans;

    CREATE POLICY "budget_plans_update_policy"
      ON public.budget_plans FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─── 7. TABLE: public.financial_reports (Financial Reports Hardening) ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'financial_reports') THEN
    DROP POLICY IF EXISTS "Allow authenticated insert financial_reports" ON public.financial_reports;
    DROP POLICY IF EXISTS "financial_reports_insert_policy" ON public.financial_reports;

    CREATE POLICY "financial_reports_insert_policy"
      ON public.financial_reports FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'warehouse_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    DROP POLICY IF EXISTS "Allow authenticated update financial_reports" ON public.financial_reports;
    DROP POLICY IF EXISTS "financial_reports_update_policy" ON public.financial_reports;

    CREATE POLICY "financial_reports_update_policy"
      ON public.financial_reports FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'admin')
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

