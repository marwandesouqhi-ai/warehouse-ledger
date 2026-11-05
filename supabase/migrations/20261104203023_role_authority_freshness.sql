-- Use the current protected profile for authorization, including a former
-- system administrator with an unexpired, stale JWT. The active system
-- administrator keeps the same full permissions.
CREATE OR REPLACE FUNCTION public.app_effective_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE((
  SELECT u.role FROM public.app_users u
  WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='active'
  ORDER BY u.created_at LIMIT 1
 ), '');
$$;
REVOKE ALL ON public.app_users FROM anon;
REVOKE ALL ON FUNCTION public.app_effective_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_effective_role() TO authenticated, service_role;

