-- ==============================================================================
-- Migration: 20261027204500_fix_supabase_linter_security_and_rls_initplan.sql
-- Description: إصلاح تحذيرات فحص Supabase (Security Definer Views & Auth RLS InitPlan)
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. إصلاح تحذيرات الأمان الحرجة (CRITICAL: Security Definer View)
-- تحويل الـ Views لتعمل بصلاحيات المستعلم (security_invoker = true) بدلاً من صلاحيات السوبر أدمن
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- إصلاح safe_app_users view
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'safe_app_users') THEN
    ALTER VIEW public.safe_app_users SET (security_invoker = true);
  END IF;

  -- إصلاح supplier_stats view
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'supplier_stats') THEN
    ALTER VIEW public.supplier_stats SET (security_invoker = true);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. تحسين أداء استعلامات RLS (Auth RLS Initialization Plan)
-- تغليف استدعاءات auth.uid() و auth.jwt() داخل (SELECT auth.uid())
-- لتنفيذها مرة واحدة كـ InitPlan بدلاً من تكرار استدعائها مع كل صف
-- ─────────────────────────────────────────────────────────────────────────────

-- جدول: public.support_tickets
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'support_tickets') THEN
    DROP POLICY IF EXISTS "Admins can view all tickets, employees view their own" ON public.support_tickets;
    CREATE POLICY "Admins can view all tickets, employees view their own"
      ON public.support_tickets FOR SELECT
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        ((SELECT auth.uid()) = user_id) OR
        ((SELECT auth.uid()) IS NOT NULL AND employee_email = (SELECT auth.jwt())->>'email')
      );

    DROP POLICY IF EXISTS "Admins can update tickets" ON public.support_tickets;
    CREATE POLICY "Admins can update tickets"
      ON public.support_tickets FOR UPDATE
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );
  END IF;
END $$;


-- جدول: public.user_invitations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_invitations') THEN
    DROP POLICY IF EXISTS "Users can read invitations" ON public.user_invitations;
    DROP POLICY IF EXISTS "Admins can manage invitations" ON public.user_invitations;
    
    CREATE POLICY "Users can read invitations"
      ON public.user_invitations FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        (email = (SELECT auth.jwt())->>'email')
      );

    CREATE POLICY "Admins can manage invitations"
      ON public.user_invitations FOR ALL TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );
  END IF;
END $$;


-- جدول: public.app_users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_users') THEN
    DROP POLICY IF EXISTS "Users can read own record" ON public.app_users;
    DROP POLICY IF EXISTS "app_users_select_policy" ON public.app_users;

    CREATE POLICY "app_users_select_policy"
      ON public.app_users FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        (auth_user_id IS NOT NULL AND auth_user_id = (SELECT auth.uid()))
      );
  END IF;
END $$;


-- جدول: public.registration_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registration_requests') THEN
    DROP POLICY IF EXISTS "Admins can view registration requests" ON public.registration_requests;
    DROP POLICY IF EXISTS "Admins can update registration requests" ON public.registration_requests;

    CREATE POLICY "Admins can view registration requests"
      ON public.registration_requests FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );

    CREATE POLICY "Admins can update registration requests"
      ON public.registration_requests FOR UPDATE TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );
  END IF;
END $$;


-- جدول: public.purchase_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_requests') THEN
    DROP POLICY IF EXISTS "pr_select_policy" ON public.purchase_requests;
    DROP POLICY IF EXISTS "pr_update_policy" ON public.purchase_requests;

    CREATE POLICY "pr_select_policy"
      ON public.purchase_requests FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin', 'procurement_employee', 'purchasing_staff')) OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );

    CREATE POLICY "pr_update_policy"
      ON public.purchase_requests FOR UPDATE TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') IN ('system_admin', 'procurement_admin')) OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
      );
  END IF;
END $$;


-- جدول: public.profiles & public.organization_members
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;

    CREATE POLICY "profiles_select_policy"
      ON public.profiles FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (id = (SELECT auth.uid()))
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organization_members') THEN
    DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;
    DROP POLICY IF EXISTS "org_members_select_policy" ON public.organization_members;

    CREATE POLICY "org_members_select_policy"
      ON public.organization_members FOR SELECT TO authenticated
      USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (user_id = (SELECT auth.uid()))
      );
  END IF;
END $$;

