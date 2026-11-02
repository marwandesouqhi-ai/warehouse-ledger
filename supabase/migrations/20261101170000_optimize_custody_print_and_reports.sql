-- Migration: 20261101170000_optimize_custody_print_and_reports.sql
-- Description: Backward-compatible performance indexes for custody items and official print reports
-- Safety: Non-destructive, idempotent (IF NOT EXISTS), zero downtime

CREATE INDEX IF NOT EXISTS custody_items_created_at_idx 
    ON public.custody_items (created_at ASC);

CREATE INDEX IF NOT EXISTS custody_items_wh_created_idx 
    ON public.custody_items (warehouse_id, created_at ASC);

COMMENT ON INDEX public.custody_items_wh_created_idx IS 
    'Optimizes paginated range queries and official inventory report generation per warehouse';

