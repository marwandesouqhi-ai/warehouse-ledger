-- Migration: 20261014120001_login_attempts.sql
-- Description: Additive table for Edge Function login rate limiting and brute-force prevention
-- Safe, additive, idempotent.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  ip_address TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time 
  ON public.login_attempts (username, attempted_at DESC);

-- Enable RLS: Strictly private table managed exclusively by Edge Functions via service_role
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.login_attempts FROM anon, authenticated;

COMMENT ON TABLE public.login_attempts IS 'Audit and rate limiting records for login-bridge authentication attempts';
