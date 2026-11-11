-- ==============================================================================
-- Migration: 20261111162000_security_retention_and_cron_schedules.sql
-- Description:
-- 1. Helper function public.dispatch_security_webhook() to invoke Edge Functions
--    via pg_net securely with Authorization header.
-- 2. Sets up pg_cron schedules (if pg_cron and pg_net extensions are enabled):
--    - 'daily-security-report': Runs daily at 06:00 AM Cairo (04:00 AM UTC) -> calls daily-report
--    - 'critical-security-alerts': Runs every 5 minutes -> calls critical-alerts
--    - 'audit-log-retention-purge': Runs weekly -> calls purge_expired_audit_logs()
-- 3. Designed with safe conditional guards so migration succeeds in any environment.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper Function: Dispatch Edge Function HTTP Webhook
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_security_webhook(
  p_function_name TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_supabase_url TEXT;
  v_cron_secret TEXT;
  v_service_role_key TEXT;
  v_headers JSONB;
  v_endpoint TEXT;
  v_request_id BIGINT;
BEGIN
  -- Read project URL and optional secrets from Vault or database settings (never hardcoded in git)
  v_supabase_url := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://agfvwyycgqhzjbywyzqi.supabase.co'
  );

  v_cron_secret := NULLIF(current_setting('app.settings.cron_webhook_secret', true), '');
  v_service_role_key := NULLIF(current_setting('app.settings.service_role_key', true), '');

  -- Safely attempt to read secrets from Supabase Vault if vault extension is enabled
  BEGIN
    IF v_cron_secret IS NULL THEN
      SELECT decrypted_secret INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'security_cron_secret'
      LIMIT 1;
    END IF;

    IF v_service_role_key IS NULL THEN
      SELECT decrypted_secret INTO v_service_role_key
      FROM vault.decrypted_secrets
      WHERE name IN ('service_role_key', 'supabase_service_role_key')
      LIMIT 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- Vault extension or table may not be enabled yet; proceed with available headers
      NULL;
  END;

  v_endpoint := rtrim(v_supabase_url, '/') || '/functions/v1/' || p_function_name;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Client-Info', 'supabase-pg-cron-security'
  );

  IF v_cron_secret IS NOT NULL AND v_cron_secret <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-cron-secret', v_cron_secret);
  END IF;

  IF v_service_role_key IS NOT NULL AND v_service_role_key <> '' THEN
    v_headers := v_headers || jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_role_key,
      'apikey', v_service_role_key
    );
  END IF;

  -- If pg_net extension is installed, dispatch async HTTP request
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT net.http_post(
      url := v_endpoint,
      body := p_payload,
      headers := v_headers
    ) INTO v_request_id;

    RETURN jsonb_build_object(
      'success', true,
      'dispatched_via', 'pg_net',
      'request_id', v_request_id,
      'endpoint', v_endpoint
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'message', 'pg_net extension is not enabled in this database. Enable pg_net to automate Edge Function calls.',
    'endpoint', v_endpoint
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'endpoint', v_endpoint
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_security_webhook(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_security_webhook(TEXT, JSONB) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Schedule Automated Security Jobs with pg_cron
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Check if pg_cron is enabled in the database
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- A. Weekly 180-Day Audit Log Retention Purge (Runs every Sunday at 03:00 AM UTC)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-log-retention-purge') THEN
      PERFORM cron.unschedule('audit-log-retention-purge');
    END IF;
    PERFORM cron.schedule(
      'audit-log-retention-purge',
      '0 3 * * 0',
      'SELECT public.purge_expired_audit_logs();'
    );

    -- B. Daily Security Telegram Report (Runs daily at 04:00 AM UTC / 06:00 AM Cairo)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-security-report') THEN
      PERFORM cron.unschedule('daily-security-report');
    END IF;
    PERFORM cron.schedule(
      'daily-security-report',
      '0 4 * * *',
      'SELECT public.dispatch_security_webhook(''daily-report'', jsonb_build_object(''triggered_by'', ''pg_cron''));'
    );

    -- C. Instant Critical Alerts Job (Runs every 5 minutes)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'critical-security-alerts') THEN
      PERFORM cron.unschedule('critical-security-alerts');
    END IF;
    PERFORM cron.schedule(
      'critical-security-alerts',
      '*/5 * * * *',
      'SELECT public.dispatch_security_webhook(''critical-alerts'', jsonb_build_object(''triggered_by'', ''pg_cron''));'
    );

    RAISE NOTICE 'pg_cron security monitoring schedules registered successfully.';
  ELSE
    RAISE NOTICE 'pg_cron extension is not enabled in this instance. Enable it via Supabase Dashboard -> Database -> Extensions.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'pg_cron schedule setup notice: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

