-- Rollback: 20261017130000_lockdown_privileged_functions_and_bootstrap.rollback.sql
-- Description: Reversal script for migration 20261017130000_lockdown_privileged_functions_and_bootstrap.sql
-- IMPORTANT SAFETY NOTICE:
-- Reversing this migration does NOT delete or alter any user accounts in public.app_users.
-- Reversing this migration will drop the public.system_bootstrap_state tracking table.
-- Do NOT execute this rollback if you wish to keep privileged functions restricted from PUBLIC/anon/authenticated.

-- 1. Drop the system_bootstrap_state table safely
DROP TABLE IF EXISTS public.system_bootstrap_state;

-- 2. Drop the hardened bootstrap function
DROP FUNCTION IF EXISTS public.bootstrap_system_admin(TEXT, TEXT, UUID);

-- 3. Note on function execution privileges:
-- Privileged functions (generate_employee_code, approve_employee_registration)
-- are NOT restored to PUBLIC execution by default in this rollback to prevent silent security degradation.
-- If legacy unauthenticated RPC access is strictly required for testing in an isolated local environment,
-- manual grants must be performed explicitly.

NOTIFY pgrst, 'reload schema';
