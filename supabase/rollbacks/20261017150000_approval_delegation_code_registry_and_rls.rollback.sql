-- Rollback: 20261017150000_approval_delegation_code_registry_and_rls.rollback.sql
-- Description: Reversal script for migration 20261017150000_approval_delegation_code_registry_and_rls.sql
-- SAFETY NOTICE:
-- Reversing this script drops the delegation settings and the code registry.
-- It does NOT delete any genuine business or user records from public.app_users.

-- 1. Drop admin view
DROP VIEW IF EXISTS public.registration_requests_admin_view;

-- 2. Drop hardened approve function
DROP FUNCTION IF EXISTS public.approve_employee_registration(UUID, TEXT, UUID);

-- 3. Drop employee code registry trigger and table
DROP TRIGGER IF EXISTS trg_employee_code_registry_tamper ON public.employee_code_registry;
DROP FUNCTION IF EXISTS public.prevent_employee_code_registry_tamper();
DROP TABLE IF EXISTS public.employee_code_registry;

-- 4. Drop delegation settings table
DROP TABLE IF EXISTS public.registration_approval_settings;

NOTIFY pgrst, 'reload schema';
