-- Rollback: 20261017153000_enforce_active_status_on_business_tables.rollback.sql
-- Description: Reversal script for pending proposal 20261017153000_enforce_active_status_on_business_tables.sql

DROP FUNCTION IF EXISTS public.is_current_user_active();

NOTIFY pgrst, 'reload schema';
