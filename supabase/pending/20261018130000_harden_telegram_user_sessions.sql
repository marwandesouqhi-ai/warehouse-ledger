-- Proposal: 20261018130000_harden_telegram_user_sessions.sql
-- Description: Enforce service_role-only access and age-bounded cleanup on telegram_user_sessions
-- Safety: Additive, zero business data touched.

REVOKE ALL ON TABLE public.telegram_user_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_user_sessions TO service_role;

-- Ensure RLS is active with only service_role policy
ALTER TABLE public.telegram_user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages telegram_user_sessions" ON public.telegram_user_sessions;
CREATE POLICY "Service role manages telegram_user_sessions"
  ON public.telegram_user_sessions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Age-bounded cleanup routine for abandoned sessions older than 24 hours
CREATE OR REPLACE FUNCTION public.cleanup_stale_telegram_sessions(p_retention_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT := 0;
  v_threshold TIMESTAMPTZ;
BEGIN
  v_threshold := NOW() - (p_retention_hours || ' hours')::INTERVAL;
  DELETE FROM public.telegram_user_sessions
  WHERE updated_at < v_threshold;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_telegram_sessions(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_telegram_sessions(INT) TO service_role;
