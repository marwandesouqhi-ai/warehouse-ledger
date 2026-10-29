-- ==============================================================================
-- Migration: 20261029193000_resolve_final_linter_warnings.sql
-- Description:
--   1. multiple_permissive_policies on public.organizations:
--      Split organizations_admin_policy into distinct INSERT, UPDATE, DELETE policies
--      so action SELECT has only one permissive policy (organizations_select_policy).
--   2. duplicate_index on public.organization_members:
--      Drop the redundant organization_members_org_id_user_id_key constraint and index
--      which duplicates the PRIMARY KEY (org_id, user_id).
-- ==============================================================================

-- 1. Fix multiple_permissive_policies on organizations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations') THEN
    DROP POLICY IF EXISTS "organizations_admin_policy" ON public.organizations;
    DROP POLICY IF EXISTS "organizations_select_policy" ON public.organizations;
    DROP POLICY IF EXISTS "organizations_admin_insert" ON public.organizations;
    DROP POLICY IF EXISTS "organizations_admin_update" ON public.organizations;
    DROP POLICY IF EXISTS "organizations_admin_delete" ON public.organizations;

    -- Single SELECT policy for authenticated users
    CREATE POLICY "organizations_select_policy"
      ON public.organizations FOR SELECT TO authenticated
      USING (true);

    -- Admin-only INSERT
    CREATE POLICY "organizations_admin_insert"
      ON public.organizations FOR INSERT TO authenticated
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    -- Admin-only UPDATE
    CREATE POLICY "organizations_admin_update"
      ON public.organizations FOR UPDATE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      )
      WITH CHECK (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );

    -- Admin-only DELETE
    CREATE POLICY "organizations_admin_delete"
      ON public.organizations FOR DELETE TO authenticated
      USING (
        ((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin'
        OR ((SELECT auth.jwt())->>'email') IN ('marwandesowky2@gmail.com', 'marwandesouqhi@gmail.com')
      );
  END IF;
END $$;


-- 2. Fix duplicate_index on organization_members
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.organization_members'::regclass 
      AND conname = 'organization_members_org_id_user_id_key'
  ) THEN
    ALTER TABLE public.organization_members DROP CONSTRAINT organization_members_org_id_user_id_key;
  END IF;

  DROP INDEX IF EXISTS public.organization_members_org_id_user_id_key;
END $$;

NOTIFY pgrst, 'reload schema';

