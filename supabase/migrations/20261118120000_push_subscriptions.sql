-- Web Push: per-device subscriptions + dispatch of every new app_notifications row to the send-push edge function.
-- Rollback: supabase/rollbacks/20261118120000_push_subscriptions.rollback.sql

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

-- Async dispatch to the edge function (same secrets/pattern as dispatch_security_webhook).
CREATE OR REPLACE FUNCTION public.dispatch_push(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url text := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://agfvwyycgqhzjbywyzqi.supabase.co');
  v_cron_secret text := NULLIF(current_setting('app.settings.cron_webhook_secret', true), '');
  v_headers jsonb;
BEGIN
  BEGIN
    IF v_cron_secret IS NULL THEN
      SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE name = 'security_cron_secret' LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_headers := jsonb_build_object('Content-Type', 'application/json', 'X-Client-Info', 'supabase-push-dispatch');
  IF v_cron_secret IS NOT NULL AND v_cron_secret <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-cron-secret', v_cron_secret);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/send-push',
      body := jsonb_build_object('notification_id', p_notification_id),
      headers := v_headers
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Never block the originating insert because a push could not be dispatched.
  NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.dispatch_push(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_dispatch_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  PERFORM public.dispatch_push(NEW.id);
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.trg_dispatch_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dispatch_push_on_notification ON public.app_notifications;
CREATE TRIGGER dispatch_push_on_notification AFTER INSERT ON public.app_notifications
  FOR EACH ROW EXECUTE FUNCTION public.trg_dispatch_push();
