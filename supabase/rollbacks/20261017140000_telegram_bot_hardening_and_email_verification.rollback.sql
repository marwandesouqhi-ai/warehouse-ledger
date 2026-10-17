-- Rollback: 20261017140000_telegram_bot_hardening_and_email_verification.rollback.sql
-- Description: Reversal script for migration 20261017140000_telegram_bot_hardening_and_email_verification.sql
-- SAFETY NOTICE:
-- Reversing this script drops the technical rate-limiting and deduplication tables.
-- It does NOT delete or alter any genuine business or registration records.

-- 1. Drop technical functions
DROP FUNCTION IF EXISTS public.cleanup_telegram_bookkeeping(INT);
DROP FUNCTION IF EXISTS public.mark_verification_verified(UUID, BIGINT);
DROP FUNCTION IF EXISTS public.record_verification_attempt(UUID, BIGINT);

-- 2. Drop constraints added to registration_requests
ALTER TABLE IF EXISTS public.registration_requests
  DROP CONSTRAINT IF EXISTS chk_reg_req_role,
  DROP CONSTRAINT IF EXISTS chk_reg_req_department,
  DROP CONSTRAINT IF EXISTS chk_reg_req_approval_status,
  DROP CONSTRAINT IF EXISTS chk_reg_req_verification_status;

-- 3. Drop technical tables
DROP TABLE IF EXISTS public.telegram_rate_events;
DROP TABLE IF EXISTS public.telegram_processed_updates;

NOTIFY pgrst, 'reload schema';
