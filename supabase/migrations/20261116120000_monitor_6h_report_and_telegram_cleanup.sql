-- Security monitor: send the Telegram report every 6 hours and delete old monitor messages after 24 hours.
--
-- 1. telegram_monitor_messages: remembers every Telegram message sent by the monitor so it can be deleted later.
-- 2. audit_alert_deliveries.telegram_deleted_at: marks critical-alert messages already removed from the chat
--    (the delivery row itself is kept so the same alert is never re-sent).
-- 3. pg_cron: replace the daily report job with a 6-hourly one.

CREATE TABLE IF NOT EXISTS public.telegram_monitor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL,
  message_id bigint NOT NULL,
  kind text NOT NULL DEFAULT 'security-report',
  sent_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Service-role only: RLS on with no policies, and no grants for client roles.
ALTER TABLE public.telegram_monitor_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_monitor_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_monitor_messages TO service_role;

CREATE INDEX IF NOT EXISTS telegram_monitor_messages_pending_idx
  ON public.telegram_monitor_messages (sent_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.audit_alert_deliveries
  ADD COLUMN IF NOT EXISTS telegram_deleted_at timestamptz;

-- Replace the daily job with a 6-hourly job (00:00, 06:00, 12:00, 18:00 UTC).
DO $$
BEGIN
  PERFORM cron.unschedule('daily-security-report');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job may not exist
END $$;

SELECT cron.schedule(
  'security-report-6h',
  '0 */6 * * *',
  $$SELECT public.dispatch_security_webhook('daily-report', jsonb_build_object('triggered_by', 'pg_cron'));$$
);
