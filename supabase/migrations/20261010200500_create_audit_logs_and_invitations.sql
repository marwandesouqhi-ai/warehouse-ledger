-- Migration: Create audit_logs and user_invitations tables

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'general',
    entity_id TEXT DEFAULT '',
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON public.audit_logs (user_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit logs"
    ON public.audit_logs FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read relevant audit logs" ON public.audit_logs;
CREATE POLICY "Users can read relevant audit logs"
    ON public.audit_logs FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id) OR
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    );

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

-- Table: user_invitations
CREATE TABLE IF NOT EXISTS public.user_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_by_email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_invitations_email_idx ON public.user_invitations (email);

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage invitations" ON public.user_invitations;
CREATE POLICY "Admins can manage invitations"
    ON public.user_invitations FOR ALL TO authenticated
    USING (
        (auth.uid() = invited_by) OR
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    )
    WITH CHECK (
        (auth.uid() = invited_by) OR
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_invitations TO authenticated;

NOTIFY pgrst, 'reload schema';
