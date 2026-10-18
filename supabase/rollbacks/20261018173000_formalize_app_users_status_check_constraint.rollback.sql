-- Rollback Script for: 20261018173000_formalize_app_users_status_check_constraint.sql
-- Reverts formal CHECK constraint on public.app_users(status)

ALTER TABLE IF EXISTS public.app_users
  DROP CONSTRAINT IF EXISTS chk_app_users_status;

NOTIFY pgrst, 'reload schema';
