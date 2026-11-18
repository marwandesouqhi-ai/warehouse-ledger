-- In-app notifications for this system (the legacy public.notifications table belongs to another system).
-- Rows are created by SECURITY DEFINER triggers on real events; clients can only read their audience and mark as read.
-- Rollback: supabase/rollbacks/20261118100000_app_notifications.rollback.sql

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_roles text[] NOT NULL DEFAULT ARRAY['system_admin']::text[],
  user_id uuid,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error', 'request', 'ticket')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  action_url text,
  related_id text,
  related_type text,
  read_by uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_created_idx ON public.app_notifications (created_at DESC);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_notifications_read ON public.app_notifications;
CREATE POLICY app_notifications_read ON public.app_notifications FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (user_id IS NULL AND (SELECT public.app_effective_role()) = ANY (audience_roles))
    OR (SELECT public.app_effective_role()) = 'system_admin'
  );

DROP POLICY IF EXISTS app_notifications_admin_delete ON public.app_notifications;
CREATE POLICY app_notifications_admin_delete ON public.app_notifications FOR DELETE TO authenticated
  USING ((SELECT public.app_effective_role()) = 'system_admin');

REVOKE ALL ON public.app_notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.app_notifications TO authenticated;

-- Server-side creation helper (triggers only).
CREATE OR REPLACE FUNCTION public.notify_roles(
  p_roles text[], p_type text, p_title text, p_body text, p_url text DEFAULT NULL,
  p_related_id text DEFAULT NULL, p_related_type text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  INSERT INTO public.app_notifications (audience_roles, type, title, body, action_url, related_id, related_type)
  VALUES (p_roles, p_type, p_title, p_body, p_url, p_related_id, p_related_type);
$function$;
REVOKE ALL ON FUNCTION public.notify_roles(text[], text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- Read state per user.
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  UPDATE public.app_notifications n
  SET read_by = array_append(n.read_by, (SELECT auth.uid()))
  WHERE n.id = p_id
    AND NOT ((SELECT auth.uid()) = ANY (n.read_by))
    AND (n.user_id = (SELECT auth.uid())
         OR (n.user_id IS NULL AND (SELECT public.app_effective_role()) = ANY (n.audience_roles))
         OR (SELECT public.app_effective_role()) = 'system_admin');
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  UPDATE public.app_notifications n
  SET read_by = array_append(n.read_by, (SELECT auth.uid()))
  WHERE NOT ((SELECT auth.uid()) = ANY (n.read_by))
    AND (n.user_id = (SELECT auth.uid())
         OR (n.user_id IS NULL AND (SELECT public.app_effective_role()) = ANY (n.audience_roles))
         OR (SELECT public.app_effective_role()) = 'system_admin');
$function$;

REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- Event triggers -------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_registration_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.notify_roles(ARRAY['system_admin'], 'request', 'طلب تسجيل موظف جديد',
    NEW.full_name || ' (' || NEW.email || ') بانتظار الاعتماد', '/users', NEW.id::text, 'registration_request');
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS notify_registration_request ON public.registration_requests;
CREATE TRIGGER notify_registration_request AFTER INSERT ON public.registration_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_registration_request();

CREATE OR REPLACE FUNCTION public.trg_notify_disbursement_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.notify_roles(ARRAY['system_admin', 'warehouse_admin', 'admin'], 'request', 'طلب صرف جديد',
    COALESCE(NEW.requester_name, '') || ' — ' || COALESCE(NEW.item_name, '') || ' (' || COALESCE(NEW.quantity_requested::text, '') || ')',
    '/requests', NEW.id::text, 'disbursement_request');
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS notify_disbursement_request ON public.disbursement_requests;
CREATE TRIGGER notify_disbursement_request AFTER INSERT ON public.disbursement_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_disbursement_request();

CREATE OR REPLACE FUNCTION public.trg_notify_purchase_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM public.notify_roles(ARRAY['system_admin', 'procurement_admin', 'admin'], 'request', 'طلب شراء جديد',
    'رقم ' || COALESCE(NEW.request_no, '') || ' — ' || COALESCE(NEW.department, ''),
    '/purchases', NEW.id::text, 'purchase_request');
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS notify_purchase_request ON public.purchase_requests;
CREATE TRIGGER notify_purchase_request AFTER INSERT ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_purchase_request();

CREATE OR REPLACE FUNCTION public.trg_notify_security_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF NEW.severity = 'critical' THEN
    PERFORM public.notify_roles(ARRAY['system_admin'], 'error', 'تنبيه أمني حرج',
      COALESCE(NEW.event_type, 'حدث أمني'), '/audit', NEW.id::text, 'security_event');
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS notify_security_event ON public.security_events;
CREATE TRIGGER notify_security_event AFTER INSERT ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_security_event();
