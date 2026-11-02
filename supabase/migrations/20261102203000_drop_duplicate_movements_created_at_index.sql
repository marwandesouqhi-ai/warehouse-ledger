-- ==============================================================================
-- Migration: 20261102203000_drop_duplicate_movements_created_at_index.sql
-- Description: Resolve Supabase Database Linter Warning (0009_duplicate_index)
-- Detail: Table `public.movements` has identical indexes {movements_created_at_idx, movements_created_at_idx1}.
-- Action: Drop the redundant index `movements_created_at_idx1` while keeping `movements_created_at_idx`.
-- ==============================================================================

-- Drop the duplicate index on movements (created_at)
DROP INDEX IF EXISTS public.movements_created_at_idx1;

-- Ensure the primary created_at index remains intact and well-defined
CREATE INDEX IF NOT EXISTS movements_created_at_idx
  ON public.movements (created_at DESC);

