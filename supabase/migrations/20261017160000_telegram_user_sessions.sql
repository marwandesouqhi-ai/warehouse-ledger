-- Migration: 20261017160000_telegram_user_sessions.sql
-- Description: Interactive multi-step registration session state table for Telegram bot
-- Safety: 100% Additive.

CREATE TABLE IF NOT EXISTS public.telegram_user_sessions (
    telegram_user_id BIGINT PRIMARY KEY,
    step TEXT NOT NULL DEFAULT 'idle',
    full_name TEXT,
    email TEXT,
    department TEXT,
    role TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_user_sessions ENABLE ROW LEVEL SECURITY;

-- Revoke all client privileges; only service_role may access sessions
REVOKE ALL ON TABLE public.telegram_user_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_user_sessions TO service_role;

DROP POLICY IF EXISTS "Service role manages telegram_user_sessions" ON public.telegram_user_sessions;
CREATE POLICY "Service role manages telegram_user_sessions"
  ON public.telegram_user_sessions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

