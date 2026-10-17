-- Rollback for: 20261017160000_telegram_user_sessions.sql

DROP POLICY IF EXISTS "Service role manages telegram_user_sessions" ON public.telegram_user_sessions;
DROP TABLE IF EXISTS public.telegram_user_sessions CASCADE;
