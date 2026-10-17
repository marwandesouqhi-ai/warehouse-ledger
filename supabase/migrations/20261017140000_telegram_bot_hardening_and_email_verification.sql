-- Migration: 20261017140000_telegram_bot_hardening_and_email_verification.sql
-- Description: Session B Remediation - Technical tables for update deduplication, rate limiting, atomic verification, and state constraints
-- Safety: Additive, backward-compatible, zero deletion of business records.

-- 1. Table for Telegram Update Deduplication (Idempotency)
CREATE TABLE IF NOT EXISTS public.telegram_processed_updates (
    update_id BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_processed_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_processed_updates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_processed_updates TO service_role;
CREATE INDEX IF NOT EXISTS idx_tg_processed_updates_at ON public.telegram_processed_updates (processed_at);

-- 2. Table for Rate Limiting Events
CREATE TABLE IF NOT EXISTS public.telegram_rate_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type TEXT NOT NULL, -- 'register', 'verify', 'resend'
    identifier TEXT NOT NULL, -- normalized lowercase telegram_user_id or email
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_rate_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_rate_events TO service_role;
CREATE INDEX IF NOT EXISTS idx_tg_rate_events_type_id_at ON public.telegram_rate_events (event_type, identifier, created_at DESC);

-- 3. Additive Columns on registration_requests
ALTER TABLE IF EXISTS public.registration_requests
  ADD COLUMN IF NOT EXISTS resend_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resend_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_send_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

-- 4. State Vocabulary CHECK Constraints (NOT VALID then VALIDATE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reg_req_verification_status'
  ) THEN
    ALTER TABLE public.registration_requests
      ADD CONSTRAINT chk_reg_req_verification_status
      CHECK (verification_status IN ('pending', 'verified', 'expired', 'delivery_failed')) NOT VALID;
    ALTER TABLE public.registration_requests
      VALIDATE CONSTRAINT chk_reg_req_verification_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reg_req_approval_status'
  ) THEN
    ALTER TABLE public.registration_requests
      ADD CONSTRAINT chk_reg_req_approval_status
      CHECK (approval_status IN ('pending', 'approved', 'rejected', 'cancelled')) NOT VALID;
    ALTER TABLE public.registration_requests
      VALIDATE CONSTRAINT chk_reg_req_approval_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reg_req_department'
  ) THEN
    ALTER TABLE public.registration_requests
      ADD CONSTRAINT chk_reg_req_department
      CHECK (requested_department IN ('warehouse', 'procurement', 'المخازن', 'المشتريات')) NOT VALID;
    ALTER TABLE public.registration_requests
      VALIDATE CONSTRAINT chk_reg_req_department;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reg_req_role'
  ) THEN
    ALTER TABLE public.registration_requests
      ADD CONSTRAINT chk_reg_req_role
      CHECK (requested_role IN ('warehouse_employee', 'warehouse_admin', 'procurement_employee', 'procurement_admin')) NOT VALID;
    ALTER TABLE public.registration_requests
      VALIDATE CONSTRAINT chk_reg_req_role;
  END IF;
END $$;

-- 5. Atomic Verification Attempt Counter (guarantees race-condition-free attempt increments)
CREATE OR REPLACE FUNCTION public.record_verification_attempt(
  p_request_id UUID,
  p_telegram_user_id BIGINT
)
RETURNS TABLE(
  token_hash TEXT,
  attempts INT,
  is_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.registration_requests
  SET verification_attempts = verification_attempts + 1,
      updated_at = NOW()
  WHERE id = p_request_id
    AND telegram_user_id = p_telegram_user_id
    AND verification_status = 'pending'
    AND verification_attempts < 5
    AND verification_token_expires_at > NOW()
  RETURNING
    verification_token_hash AS token_hash,
    verification_attempts AS attempts,
    TRUE AS is_valid;
END;
$$;

REVOKE ALL ON FUNCTION public.record_verification_attempt(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verification_attempt(UUID, BIGINT) TO service_role;

-- 6. Atomic Successful Verification Marking (marks verified and clears sensitive hash)
CREATE OR REPLACE FUNCTION public.mark_verification_verified(
  p_request_id UUID,
  p_telegram_user_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.registration_requests
  SET verification_status = 'verified',
      verification_token_hash = NULL,
      updated_at = NOW()
  WHERE id = p_request_id
    AND telegram_user_id = p_telegram_user_id
    AND verification_status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_verification_verified(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_verification_verified(UUID, BIGINT) TO service_role;

-- 7. Age-bounded Technical Bookkeeping Cleanup Function
CREATE OR REPLACE FUNCTION public.cleanup_telegram_bookkeeping(p_retention_hours INT DEFAULT 48)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT := 0;
  v_threshold TIMESTAMPTZ;
BEGIN
  v_threshold := NOW() - (p_retention_hours || ' hours')::INTERVAL;

  DELETE FROM public.telegram_processed_updates
  WHERE processed_at < v_threshold;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.telegram_rate_events
  WHERE created_at < v_threshold;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_telegram_bookkeeping(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_telegram_bookkeeping(INT) TO service_role;

NOTIFY pgrst, 'reload schema';
