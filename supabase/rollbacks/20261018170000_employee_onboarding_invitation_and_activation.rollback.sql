-- Rollback: 20261018170000_employee_onboarding_invitation_and_activation.rollback.sql
-- Reverses the additive migration 20261018170000_employee_onboarding_invitation_and_activation.sql

-- 1. Drop atomic activation procedure and helpers
DROP FUNCTION IF EXISTS public.complete_employee_activation(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_identity_consistency_report();
DROP FUNCTION IF EXISTS public.verify_auth_user_has_password(UUID);

-- 2. Drop unique indexes added on app_users
DROP INDEX IF EXISTS public.idx_app_users_lower_username;
DROP INDEX IF EXISTS public.idx_app_users_lower_email;
DROP INDEX IF EXISTS public.idx_app_users_auth_user_id;
DROP INDEX IF EXISTS public.idx_reg_requests_invitation_status;

-- 3. Drop additive columns on registration_requests
ALTER TABLE IF EXISTS public.registration_requests
  DROP COLUMN IF EXISTS invitation_status,
  DROP COLUMN IF EXISTS invitation_sent_at,
  DROP COLUMN IF EXISTS invitation_sent_by;

-- 4. Recreate registration_requests_admin_view without invitation fields
CREATE OR REPLACE VIEW public.registration_requests_admin_view
WITH (security_invoker = true)
AS
SELECT
  id,
  full_name,
  email,
  telegram_user_id,
  telegram_username,
  requested_department,
  requested_role,
  verification_status,
  approval_status,
  approved_role,
  employee_id,
  reviewed_by,
  reviewed_at,
  rejection_reason,
  created_at,
  updated_at
FROM public.registration_requests;

GRANT SELECT ON public.registration_requests_admin_view TO authenticated;
