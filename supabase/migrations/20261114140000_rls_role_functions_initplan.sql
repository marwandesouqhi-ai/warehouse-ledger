-- Applied to production on 2026-11-14.
-- Wrap app_effective_role() / app_can_modify_records() in (SELECT ...) inside RLS
-- policies so Postgres evaluates them once per query (InitPlan) instead of per row.
-- Semantics are unchanged (both functions are STABLE). Idempotent: already wrapped
-- calls are skipped by the negative lookbehind.
--
-- Rollback (unwrap):
--   replace '(SELECT app_effective_role())' with 'app_effective_role()' (same for
--   app_can_modify_records) using the same ALTER POLICY loop.
DO $$
DECLARE r record; nq text; nc text; stmt text;
BEGIN
  FOR r IN SELECT policyname, tablename, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    nq := regexp_replace(coalesce(r.qual, ''), '(?<!SELECT )((public\.)?app_(effective_role|can_modify_records)\(\))', '(SELECT \1)', 'g');
    nc := regexp_replace(coalesce(r.with_check, ''), '(?<!SELECT )((public\.)?app_(effective_role|can_modify_records)\(\))', '(SELECT \1)', 'g');
    IF nq IS DISTINCT FROM coalesce(r.qual, '') OR nc IS DISTINCT FROM coalesce(r.with_check, '') THEN
      stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
      IF r.qual IS NOT NULL THEN stmt := stmt || ' USING (' || nq || ')'; END IF;
      IF r.with_check IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || nc || ')'; END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END $$;
