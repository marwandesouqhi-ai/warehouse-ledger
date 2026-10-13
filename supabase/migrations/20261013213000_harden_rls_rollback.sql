-- Migration Rollback: 20261013213000_harden_rls_rollback.sql
-- Description: Rollback script for RLS hardening. Restores previous permissive cloud-sync policies.

-- 1. Drop hardened policies
DROP POLICY IF EXISTS "app_users_select_policy" ON public.app_users;
DROP POLICY IF EXISTS "app_settings_select_policy" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_modify_policy" ON public.app_settings;
DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "custody_items_select_policy" ON public.custody_items;
DROP POLICY IF EXISTS "custody_items_modify_policy" ON public.custody_items;
DROP POLICY IF EXISTS "movements_select_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_insert_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_update_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;
DROP POLICY IF EXISTS "user_invitations_manage_policy" ON public.user_invitations;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tamper ON public.audit_logs;
DROP FUNCTION IF EXISTS public.prevent_audit_log_tamper();

-- 2. Restore grants to anon and authenticated
GRANT ALL ON public.app_users TO anon, authenticated;
GRANT ALL ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.audit_logs TO anon, authenticated;
GRANT ALL ON public.custody_items TO anon, authenticated;
GRANT ALL ON public.movements TO anon, authenticated;

-- 3. Re-create permissive legacy policies
CREATE POLICY "allow_all_app_users" ON public.app_users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_anon_app_settings" ON public.app_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_anon_audit_logs" ON public.audit_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_anon_custody_items" ON public.custody_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_anon_movements" ON public.movements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
