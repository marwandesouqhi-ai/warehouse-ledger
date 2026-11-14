-- Applied to production on 2026-11-14.
-- pg_cron runs jobs as `postgres` with no JWT, so auth.role() is NULL and the guard
-- added in 20261112160000 rejected every scheduled call (security alerts and daily
-- report stopped on 2026-11-12 14:55 UTC). EXECUTE is already limited to
-- service_role/postgres, so allowing the postgres session user is safe.
DO $$
DECLARE def text; newdef text;
BEGIN
  def := pg_get_functiondef('public.dispatch_security_webhook(text,jsonb)'::regprocedure);
  newdef := replace(def,
    $a$IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN$a$,
    $b$IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN$b$);
  IF newdef <> def THEN EXECUTE newdef; END IF;
END $$;
