-- supabase/migrations/20261013190000_additive_roles_permissions.sql
-- Phase 1: Additive column for custom permissions array
-- Safe: IF NOT EXISTS ensures idempotency, default '[]' preserves existing accounts

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN public.app_users.permissions IS 'Custom extra permissions: view_audit, view_settings, manage_records';
