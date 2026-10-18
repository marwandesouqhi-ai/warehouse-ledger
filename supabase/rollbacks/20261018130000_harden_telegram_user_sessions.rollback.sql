-- Rollback for: 20261018130000_harden_telegram_user_sessions.sql

DROP FUNCTION IF EXISTS public.cleanup_stale_telegram_sessions(INT);
