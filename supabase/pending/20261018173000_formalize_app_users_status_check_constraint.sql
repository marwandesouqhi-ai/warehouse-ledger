-- Proposed Migration (Pending Owner Approval): 20261018173000_formalize_app_users_status_check_constraint.sql
-- Description: Formalize explicit CHECK constraint on public.app_users(status)
-- Status: PENDING OWNER REVIEW (Placed in supabase/pending/ per Rule 1 to prevent altering pre-existing table constraints without owner approval)
--
-- Impact Analysis:
-- 1. Restricts valid values in public.app_users.status to strictly:
--    ('active', 'pending_activation', 'suspended', 'rejected')
-- 2. Added as NOT VALID first, then validated, ensuring zero downtime and no transaction table locking.
-- 3. Ensures no arbitrary status strings can be inserted in the future.
-- 4. Rollback script available at: supabase/rollbacks/20261018173000_formalize_app_users_status_check_constraint.rollback.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_app_users_status'
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT chk_app_users_status
      CHECK (status IN ('active', 'pending_activation', 'suspended', 'rejected')) NOT VALID;

    ALTER TABLE public.app_users
      VALIDATE CONSTRAINT chk_app_users_status;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
