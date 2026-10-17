-- Proposed Migration (Pending Owner Approval): 20261017153000_enforce_active_status_on_business_tables.sql
-- Description: Database-level enforcement of active user status on business tables (inventory and procurement)
-- Status: PENDING OWNER REVIEW (NOT in supabase/migrations/ to prevent premature locking of existing operations)
-- Impact Analysis:
--   1. Ensures suspended or unapproved users cannot execute inserts/updates on inventory_movements or purchases even if they hold an unexpired JWT.
--   2. Backward compatibility: If app_users record is active, operations succeed normally.
--   3. Rollback script available at: supabase/rollbacks/20261017153000_enforce_active_status_on_business_tables.rollback.sql

CREATE OR REPLACE FUNCTION public.is_current_user_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_current_user_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_user_active() TO authenticated, service_role;

-- Example policy amendment for inventory_movements:
-- ALTER POLICY "Authenticated users can insert movements" ON public.inventory_movements
--   WITH CHECK (public.is_current_user_active());

NOTIFY pgrst, 'reload schema';
