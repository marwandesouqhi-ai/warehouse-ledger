-- ==============================================================================
-- Rollback: 20261102203000_drop_duplicate_movements_created_at_index.rollback.sql
-- Description: Rollback for duplicate index drop
-- ==============================================================================

CREATE INDEX IF NOT EXISTS movements_created_at_idx1
  ON public.movements (created_at DESC);

