-- supabase/migrations/20261013193000_purchases_idempotency.sql
-- Phase 2: Additive columns for movements idempotency and author tracking

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS custody_applied BOOLEAN DEFAULT FALSE;

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS created_by TEXT;

COMMENT ON COLUMN public.movements.custody_applied IS 'Flag indicating whether inward/outward custody balance has been applied';
COMMENT ON COLUMN public.movements.created_by IS 'Username or user ID of the staff member who registered the movement';
