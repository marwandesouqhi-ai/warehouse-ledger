-- Migration: 20261013213000_harden_rls.sql
-- Description: Isolated RLS security hardening reading strictly from app_metadata
-- IMPORTANT: Do NOT execute on production without manual verification and user confirmation.

-- 1. Revoke public/anon privileges on sensitive tables
REVOKE ALL ON public.app_users FROM anon;
REVOKE ALL ON public.custody_items FROM anon;
REVOKE ALL ON public.movements FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.user_invitations FROM anon;

-- Grant minimal necessary read to anon for public brand settings (logo & organization name on login screen)
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements TO authenticated;
GRANT SELECT ON public.app_users TO authenticated;

-- Enable RLS on all tables
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

-- ─── 2. TABLE: app_users ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "app_users_read_policy" ON public.app_users;
DROP POLICY IF EXISTS "app_users_write_policy" ON public.app_users;
DROP POLICY IF EXISTS "allow_anon_app_users" ON public.app_users;
DROP POLICY IF EXISTS "allow_all_app_users" ON public.app_users;

-- Read: System admin can read all users; authenticated user can read only their own row (linked by auth_user_id)
CREATE POLICY "app_users_select_policy" ON public.app_users
  FOR SELECT
  TO authenticated
  USING (
    public.is_system_admin() OR (auth_user_id IS NOT NULL AND auth_user_id = auth.uid())
  );

-- Direct client INSERT / UPDATE / DELETE is revoked; mutations must go through admin-users Edge Function (service role)
-- No INSERT/UPDATE/DELETE policies created for authenticated clients.

-- ─── 3. TABLE: app_settings ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "app_settings_read_policy" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_write_policy" ON public.app_settings;
DROP POLICY IF EXISTS "allow_anon_app_settings" ON public.app_settings;

CREATE POLICY "app_settings_select_policy" ON public.app_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "app_settings_modify_policy" ON public.app_settings
  FOR ALL
  TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

-- ─── 4. TABLE: audit_logs ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_logs_read_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "allow_anon_audit_logs" ON public.audit_logs;

-- Read: System admin or users granted view_audit permission
CREATE POLICY "audit_logs_select_policy" ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    public.is_system_admin() OR public.has_permission('view_audit')
  );

-- Insert: Authenticated users can insert only if user_email strictly matches their JWT identity
CREATE POLICY "audit_logs_insert_policy" ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    LOWER(COALESCE(user_email, '')) = LOWER(COALESCE(auth.jwt()->>'email', ''))
  );

-- Append-only trigger preventing UPDATE or DELETE even by administrative scripts
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'سجل العمليات والتدقيق (audit_logs) غير قابل للتعديل أو الحذف نهائياً.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tamper ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_tamper
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_tamper();

-- ─── 5. TABLE: custody_items ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "custody_items_read_policy" ON public.custody_items;
DROP POLICY IF EXISTS "custody_items_write_policy" ON public.custody_items;
DROP POLICY IF EXISTS "allow_anon_custody_items" ON public.custody_items;

-- Purchasing staff CANNOT view or modify custody_items directly
CREATE POLICY "custody_items_select_policy" ON public.custody_items
  FOR SELECT
  TO authenticated
  USING (
    public.app_role() IN ('system_admin', 'admin', 'warehouse_staff', 'editor', 'viewer')
  );

CREATE POLICY "custody_items_modify_policy" ON public.custody_items
  FOR ALL
  TO authenticated
  USING (
    public.app_role() IN ('system_admin', 'admin', 'warehouse_staff', 'editor')
  )
  WITH CHECK (
    public.app_role() IN ('system_admin', 'admin', 'warehouse_staff', 'editor')
  );

-- ─── 6. TABLE: movements ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "movements_read_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_insert_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_update_policy" ON public.movements;
DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;
DROP POLICY IF EXISTS "allow_anon_movements" ON public.movements;

-- Read:
-- - purchasing_staff: only sees purchase movements (unit-wide)
-- - warehouse_staff / editor: sees all transfers and purchases
-- - admin / system_admin: sees everything
CREATE POLICY "movements_select_policy" ON public.movements
  FOR SELECT
  TO authenticated
  USING (
    CASE 
      WHEN public.app_role() = 'purchasing_staff' THEN public.movement_kind(movements) = 'purchase'
      ELSE true
    END
  );

-- Insert:
-- - purchasing_staff: can only insert purchase movements
-- - warehouse_staff: can insert transfer movements
-- - admin / system_admin: can insert any movement
CREATE POLICY "movements_insert_policy" ON public.movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN public.app_role() = 'purchasing_staff' THEN (kind = 'purchase' OR public.movement_kind(movements) = 'purchase')
      WHEN public.app_role() IN ('warehouse_staff', 'editor') THEN (kind = 'transfer' OR public.movement_kind(movements) = 'transfer')
      WHEN public.app_role() IN ('system_admin', 'admin') THEN true
      ELSE false
    END
  );

-- Update / Delete:
-- Strictly reserved for system_admin or users with manage_records permission
CREATE POLICY "movements_update_policy" ON public.movements
  FOR UPDATE
  TO authenticated
  USING (
    public.is_system_admin() OR public.has_permission('manage_records')
  )
  WITH CHECK (
    public.is_system_admin() OR public.has_permission('manage_records')
  );

CREATE POLICY "movements_delete_policy" ON public.movements
  FOR DELETE
  TO authenticated
  USING (
    public.is_system_admin() OR public.has_permission('manage_records')
  );

-- ─── 7. TABLE: user_invitations ───────────────────────────────────────────────
DROP POLICY IF EXISTS "user_invitations_policy" ON public.user_invitations;

CREATE POLICY "user_invitations_manage_policy" ON public.user_invitations
  FOR ALL
  TO authenticated
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());
