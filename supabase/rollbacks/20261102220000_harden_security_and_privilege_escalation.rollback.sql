-- ==============================================================================
-- Rollback Migration: 20261102220000_harden_security_and_privilege_escalation.rollback.sql
-- SECURITY QUARANTINE (MED-08): Refuses to restore permissive USING (true) or
-- bare auth.uid() IS NOT NULL policies on financial/disbursement/custody tables.
-- Author a scoped forward migration using public.app_effective_role() instead.
-- ==============================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Refusing to execute insecure rollback 20261102220000_harden_security_and_privilege_escalation.rollback.sql: restoring USING (true) policies is prohibited.';
END $$;

