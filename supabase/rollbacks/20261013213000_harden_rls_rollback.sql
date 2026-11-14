-- Migration Rollback: 20261013213000_harden_rls_rollback.sql
-- SECURITY QUARANTINE (MED-08): Refuses to drop audit tamper triggers or restore
-- permissive `anon` / `USING (true)` policies in any environment.
-- Restore granular policies via a dedicated forward migration instead.

DO $$
BEGIN
  RAISE EXCEPTION
    'Refusing to execute legacy rollback 20261013213000_harden_rls_rollback.sql: restoring anon/USING(true) access or dropping trg_prevent_audit_log_tamper is disabled for security compliance.';
END $$;
