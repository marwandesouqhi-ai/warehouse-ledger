-- Migration: Fix audit_logs permissions and allow text user_id
-- Allows seamless recording of audit logs for both local and cloud sessions without HTTP 400/401 errors.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'audit_logs_user_id_fkey' AND table_name = 'audit_logs'
    ) THEN
        ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_user_id_fkey;
    END IF;
END $$;

ALTER TABLE public.audit_logs ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable audit_logs insert for all" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Enable audit_logs insert for all"
    ON public.audit_logs FOR INSERT TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Enable audit_logs select for all" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can read relevant audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Only system admin can read audit logs" ON public.audit_logs;
CREATE POLICY "Enable audit_logs select for all"
    ON public.audit_logs FOR SELECT TO anon, authenticated
    USING (true);

GRANT SELECT, INSERT ON public.audit_logs TO anon, authenticated;

-- Strictly disallow updates and deletions to protect audit trail integrity
REVOKE UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
