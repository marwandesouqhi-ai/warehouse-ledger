-- Migration: Harden permissions so ONLY System Admin can invite or modify users/members

-- 1. user_invitations: ONLY System Admin
DROP POLICY IF EXISTS "Admins can manage invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Only system admin can manage invitations" ON public.user_invitations;

CREATE POLICY "Only system admin can manage invitations"
    ON public.user_invitations FOR ALL TO authenticated
    USING (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    )
    WITH CHECK (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    );

-- 2. profiles: users can view profiles, but only update their own display name
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read profiles" ON public.profiles;
CREATE POLICY "Users can read profiles"
    ON public.profiles FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 3. organization_members: ONLY System Admin can modify roles or members
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view organization members" ON public.organization_members;
CREATE POLICY "Members can view organization members"
    ON public.organization_members FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Only system admin can modify organization members" ON public.organization_members;
CREATE POLICY "Only system admin can modify organization members"
    ON public.organization_members FOR ALL TO authenticated
    USING (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    )
    WITH CHECK (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;

NOTIFY pgrst, 'reload schema';
