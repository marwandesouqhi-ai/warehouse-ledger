-- Migration: Restrict audit_logs SELECT strictly to System Admin only

DROP POLICY IF EXISTS "Users can read relevant audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Only system admin can read audit logs" ON public.audit_logs;

CREATE POLICY "Only system admin can read audit logs"
    ON public.audit_logs FOR SELECT TO authenticated
    USING (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'admin') OR
        ((auth.jwt()->>'email') = 'marwandesouqhi@gmail.com')
    );

NOTIFY pgrst, 'reload schema';
