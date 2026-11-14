-- Defensive, idempotent: ensure anon has no access to sensitive tables/functions.
-- app_settings keeps anon SELECT (public brand info on login screen).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'telegram_bot_settings','custody_items','movements','app_users','audit_logs',
    'user_invitations','login_attempts','security_events','security_monitor_config'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
  IF to_regprocedure('public.import_custody_batch(text,text,jsonb,boolean,boolean)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.import_custody_batch(text,text,jsonb,boolean,boolean) FROM PUBLIC, anon;
  END IF;
END $$;

-- app_settings: anon may only read (public brand info on the login screen).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_settings FROM anon;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_alert_deliveries','audit_logs_archive'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
