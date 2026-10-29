-- ==============================================================================
-- Migration: 20261029190000_resolve_advanced_supabase_linter_issues.sql
-- Description: Complete resolution of all advanced Supabase Database Linter issues:
--   1. public_bucket_allows_listing (Drop broad listing on support-attachments)
--   2. authenticated_security_definer_function_executable (Switch to SECURITY INVOKER)
--   3. auth_rls_initplan (Wrap auth calls with (SELECT auth.uid()) / (SELECT auth.jwt()))
--   4. multiple_permissive_policies (Deduplicate and isolate SELECT vs WRITE policies)
--   5. rls_enabled_no_policy (Add explicit admin/service policies to 7 internal tables)
--   6. unindexed_foreign_keys (Add covering indexes on 9 foreign keys)
--   7. no_primary_key (Add composite primary key to organization_members)
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix public_bucket_allows_listing
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    DROP POLICY IF EXISTS "Public view for support attachments" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated view for support attachments" ON storage.objects;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix authenticated_security_definer_function_executable
-- Convert business logic RPCs to SECURITY INVOKER with explicit search_path
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'create_purchase_order') THEN
    ALTER FUNCTION public.create_purchase_order(UUID) SECURITY INVOKER;
    ALTER FUNCTION public.create_purchase_order(UUID) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'mark_po_invoiced') THEN
    ALTER FUNCTION public.mark_po_invoiced(UUID) SECURITY INVOKER;
    ALTER FUNCTION public.mark_po_invoiced(UUID) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'mark_po_received') THEN
    ALTER FUNCTION public.mark_po_received(UUID) SECURITY INVOKER;
    ALTER FUNCTION public.mark_po_received(UUID) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'record_approval') THEN
    ALTER FUNCTION public.record_approval(UUID, INT, TEXT, TEXT) SECURITY INVOKER;
    ALTER FUNCTION public.record_approval(UUID, INT, TEXT, TEXT) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'record_purchase') THEN
    ALTER FUNCTION public.record_purchase(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) SECURITY INVOKER;
    ALTER FUNCTION public.record_purchase(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'select_quote') THEN
    ALTER FUNCTION public.select_quote(UUID, UUID) SECURITY INVOKER;
    ALTER FUNCTION public.select_quote(UUID, UUID) SET search_path = public, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'submit_purchase_request') THEN
    ALTER FUNCTION public.submit_purchase_request(UUID) SECURITY INVOKER;
    ALTER FUNCTION public.submit_purchase_request(UUID) SET search_path = public, pg_temp;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix auth_rls_initplan & multiple_permissive_policies Across Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 app_settings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_settings') THEN
    DROP POLICY IF EXISTS "app_settings_modify_policy" ON public.app_settings;
    DROP POLICY IF EXISTS "app_settings_write_policy" ON public.app_settings;
    DROP POLICY IF EXISTS "app_settings_select_policy" ON public.app_settings;

    CREATE POLICY "app_settings_select_policy"
      ON public.app_settings FOR SELECT
      USING (true);

    CREATE POLICY "app_settings_admin_insert"
      ON public.app_settings FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    CREATE POLICY "app_settings_admin_update"
      ON public.app_settings FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    CREATE POLICY "app_settings_admin_delete"
      ON public.app_settings FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.2 app_users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_users') THEN
    DROP POLICY IF EXISTS "app_users_admin_write_policy" ON public.app_users;
    DROP POLICY IF EXISTS "app_users_select_policy" ON public.app_users;

    CREATE POLICY "app_users_select_policy"
      ON public.app_users FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        (auth_user_id IS NOT NULL AND auth_user_id = (SELECT auth.uid()))
      );

    CREATE POLICY "app_users_admin_insert"
      ON public.app_users FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    CREATE POLICY "app_users_admin_update"
      ON public.app_users FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
        OR (auth_user_id IS NOT NULL AND auth_user_id = (SELECT auth.uid()))
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
        OR (auth_user_id IS NOT NULL AND auth_user_id = (SELECT auth.uid()))
      );

    CREATE POLICY "app_users_admin_delete"
      ON public.app_users FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.3 audit_logs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    DROP POLICY IF EXISTS "Enable audit_logs select for all" ON public.audit_logs;
    DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;

    CREATE POLICY "audit_logs_select_policy"
      ON public.audit_logs FOR SELECT TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.4 custody_items
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custody_items') THEN
    DROP POLICY IF EXISTS "custody_items_modify_policy" ON public.custody_items;
    DROP POLICY IF EXISTS "custody_items_select_policy" ON public.custody_items;
    DROP POLICY IF EXISTS "custody_items_select" ON public.custody_items;
    DROP POLICY IF EXISTS "custody_items_write" ON public.custody_items;

    CREATE POLICY "custody_items_select_policy"
      ON public.custody_items FOR SELECT
      USING (true);

    CREATE POLICY "custody_items_insert_policy"
      ON public.custody_items FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

    CREATE POLICY "custody_items_update_policy"
      ON public.custody_items FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

    CREATE POLICY "custody_items_delete_policy"
      ON public.custody_items FOR DELETE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;

-- 3.5 movements
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'movements') THEN
    DROP POLICY IF EXISTS "movements_select" ON public.movements;
    DROP POLICY IF EXISTS "movements_write" ON public.movements;
    DROP POLICY IF EXISTS "movements_select_policy" ON public.movements;
    DROP POLICY IF EXISTS "movements_insert_policy" ON public.movements;
    DROP POLICY IF EXISTS "movements_update_policy" ON public.movements;
    DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;

    CREATE POLICY "movements_select_policy"
      ON public.movements FOR SELECT
      USING (true);

    CREATE POLICY "movements_insert_policy"
      ON public.movements FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

    CREATE POLICY "movements_update_policy"
      ON public.movements FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL)
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

    CREATE POLICY "movements_delete_policy"
      ON public.movements FOR DELETE TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $$;

-- 3.6 profiles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    DROP POLICY IF EXISTS "Users can read profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;

    CREATE POLICY "profiles_select_policy"
      ON public.profiles FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (id = (SELECT auth.uid()))
      );

    CREATE POLICY "profiles_update_policy"
      ON public.profiles FOR UPDATE TO authenticated
      USING (id = (SELECT auth.uid()))
      WITH CHECK (id = (SELECT auth.uid()));
  END IF;
END $$;

-- 3.7 organization_members
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organization_members') THEN
    DROP POLICY IF EXISTS "Only system admin can modify organization members" ON public.organization_members;
    DROP POLICY IF EXISTS "org_members_select_policy" ON public.organization_members;
    DROP POLICY IF EXISTS "org_members_admin_modify_policy" ON public.organization_members;

    CREATE POLICY "org_members_select_policy"
      ON public.organization_members FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (user_id = (SELECT auth.uid()))
      );

    CREATE POLICY "org_members_admin_insert"
      ON public.organization_members FOR INSERT TO authenticated
      WITH CHECK (
        COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true
        OR (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin')
        OR (((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com'))
      );

    CREATE POLICY "org_members_admin_update"
      ON public.organization_members FOR UPDATE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true
        OR (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin')
        OR (((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com'))
      )
      WITH CHECK (
        COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true
        OR (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin')
        OR (((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com'))
      );

    CREATE POLICY "org_members_admin_delete"
      ON public.organization_members FOR DELETE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true
        OR (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin')
        OR (((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com'))
      );
  END IF;
END $$;

-- 3.8 user_invitations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_invitations') THEN
    DROP POLICY IF EXISTS "Only system admin can manage invitations" ON public.user_invitations;
    DROP POLICY IF EXISTS "user_invitations_manage_policy" ON public.user_invitations;
    DROP POLICY IF EXISTS "Users can read invitations" ON public.user_invitations;
    DROP POLICY IF EXISTS "Admins can manage invitations" ON public.user_invitations;

    CREATE POLICY "Users can read invitations"
      ON public.user_invitations FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        (email = (SELECT auth.jwt())->>'email')
      );

    CREATE POLICY "Admins can insert invitations"
      ON public.user_invitations FOR INSERT TO authenticated
      WITH CHECK (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );

    CREATE POLICY "Admins can update invitations"
      ON public.user_invitations FOR UPDATE TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      )
      WITH CHECK (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );

    CREATE POLICY "Admins can delete invitations"
      ON public.user_invitations FOR DELETE TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );
  END IF;
END $$;

-- 3.9 registration_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registration_requests') THEN
    DROP POLICY IF EXISTS "Allow select registration_requests" ON public.registration_requests;
  END IF;
END $$;

-- 3.10 telegram_bot_settings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'telegram_bot_settings') THEN
    DROP POLICY IF EXISTS "Allow write telegram bot settings for admins" ON public.telegram_bot_settings;

    CREATE POLICY "Allow write telegram bot settings for admins"
      ON public.telegram_bot_settings FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    CREATE POLICY "Allow update telegram bot settings for admins"
      ON public.telegram_bot_settings FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    CREATE POLICY "Allow delete telegram bot settings for admins"
      ON public.telegram_bot_settings FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.11 purchase_requests delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_requests') THEN
    DROP POLICY IF EXISTS "pr_delete_policy" ON public.purchase_requests;
    CREATE POLICY "pr_delete_policy"
      ON public.purchase_requests FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')
      );
  END IF;
END $$;

-- 3.12 support_tickets delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'support_tickets') THEN
    DROP POLICY IF EXISTS "System admins can delete tickets" ON public.support_tickets;
    CREATE POLICY "System admins can delete tickets"
      ON public.support_tickets FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')
      );
  END IF;
END $$;

-- 3.13 disbursement_requests delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'disbursement_requests') THEN
    DROP POLICY IF EXISTS "Allow admin delete disbursement_requests" ON public.disbursement_requests;
    CREATE POLICY "Allow admin delete disbursement_requests"
      ON public.disbursement_requests FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.14 notifications read & delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    DROP POLICY IF EXISTS "Allow authenticated read notifications" ON public.notifications;
    DROP POLICY IF EXISTS "Allow authenticated delete notifications" ON public.notifications;

    CREATE POLICY "Allow authenticated read notifications"
      ON public.notifications FOR SELECT TO authenticated
      USING (
        user_id IS NULL
        OR user_id = (SELECT auth.uid())
        OR ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
      );

    CREATE POLICY "Allow authenticated delete notifications"
      ON public.notifications FOR DELETE TO authenticated
      USING (
        user_id IS NULL
        OR user_id = (SELECT auth.uid())
        OR ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
      );
  END IF;
END $$;

-- 3.15 supplier_contracts delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'supplier_contracts') THEN
    DROP POLICY IF EXISTS "Allow admin delete supplier_contracts" ON public.supplier_contracts;
    CREATE POLICY "Allow admin delete supplier_contracts"
      ON public.supplier_contracts FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.16 asset_movement_log delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'asset_movement_log') THEN
    DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;
    CREATE POLICY "Allow admin delete asset_movement_log"
      ON public.asset_movement_log FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.17 financial_reports delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'financial_reports') THEN
    DROP POLICY IF EXISTS "Allow admin delete financial_reports" ON public.financial_reports;
    CREATE POLICY "Allow admin delete financial_reports"
      ON public.financial_reports FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;

-- 3.18 budget_plans delete policy initplan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'budget_plans') THEN
    DROP POLICY IF EXISTS "Allow admin delete budget_plans" ON public.budget_plans;
    CREATE POLICY "Allow admin delete budget_plans"
      ON public.budget_plans FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fix rls_enabled_no_policy for 7 Internal Tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 1. employee_code_registry
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'employee_code_registry') THEN
    DROP POLICY IF EXISTS "employee_code_registry_admin_policy" ON public.employee_code_registry;
    CREATE POLICY "employee_code_registry_admin_policy"
      ON public.employee_code_registry FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 2. login_attempts
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'login_attempts') THEN
    DROP POLICY IF EXISTS "login_attempts_admin_policy" ON public.login_attempts;
    CREATE POLICY "login_attempts_admin_policy"
      ON public.login_attempts FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 3. organizations
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations') THEN
    DROP POLICY IF EXISTS "organizations_select_policy" ON public.organizations;
    DROP POLICY IF EXISTS "organizations_admin_policy" ON public.organizations;

    CREATE POLICY "organizations_select_policy"
      ON public.organizations FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "organizations_admin_policy"
      ON public.organizations FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 4. registration_approval_settings
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registration_approval_settings') THEN
    DROP POLICY IF EXISTS "registration_approval_settings_admin_policy" ON public.registration_approval_settings;
    CREATE POLICY "registration_approval_settings_admin_policy"
      ON public.registration_approval_settings FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 5. system_bootstrap_state
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'system_bootstrap_state') THEN
    DROP POLICY IF EXISTS "system_bootstrap_state_admin_policy" ON public.system_bootstrap_state;
    CREATE POLICY "system_bootstrap_state_admin_policy"
      ON public.system_bootstrap_state FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 6. telegram_processed_updates
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'telegram_processed_updates') THEN
    DROP POLICY IF EXISTS "telegram_processed_updates_service_policy" ON public.telegram_processed_updates;
    CREATE POLICY "telegram_processed_updates_service_policy"
      ON public.telegram_processed_updates FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;

  -- 7. telegram_rate_events
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'telegram_rate_events') THEN
    DROP POLICY IF EXISTS "telegram_rate_events_service_policy" ON public.telegram_rate_events;
    CREATE POLICY "telegram_rate_events_service_policy"
      ON public.telegram_rate_events FOR ALL TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fix unindexed_foreign_keys on 9 Tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_asset_movement_log_created_by ON public.asset_movement_log(created_by);
CREATE INDEX IF NOT EXISTS idx_budget_plans_created_by ON public.budget_plans(created_by);
CREATE INDEX IF NOT EXISTS idx_employee_code_registry_request_id ON public.employee_code_registry(request_id);
CREATE INDEX IF NOT EXISTS idx_financial_reports_created_by ON public.financial_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_settlements_created_by ON public.inventory_settlements(created_by);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_created_by ON public.supplier_contracts(created_by);
CREATE INDEX IF NOT EXISTS idx_system_backup_snapshots_created_by ON public.system_backup_snapshots(created_by);
CREATE INDEX IF NOT EXISTS idx_technical_inspections_created_by ON public.technical_inspections(created_by);
CREATE INDEX IF NOT EXISTS idx_user_invitations_invited_by ON public.user_invitations(invited_by);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Fix no_primary_key on organization_members
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organization_members') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conrelid = 'public.organization_members'::regclass AND contype = 'p'
    ) THEN
      ALTER TABLE public.organization_members ADD PRIMARY KEY (org_id, user_id);
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

