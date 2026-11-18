DROP TRIGGER IF EXISTS dispatch_push_on_notification ON public.app_notifications;
DROP FUNCTION IF EXISTS public.trg_dispatch_push();
DROP FUNCTION IF EXISTS public.dispatch_push(uuid);
DROP TABLE IF EXISTS public.push_subscriptions;
