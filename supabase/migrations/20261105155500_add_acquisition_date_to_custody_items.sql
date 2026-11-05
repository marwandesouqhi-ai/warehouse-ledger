-- Migration: Add explicit acquisition_date column to custody_items table
-- Separates the business/ledger acquisition date from the database system timestamp created_at.

ALTER TABLE public.custody_items
ADD COLUMN IF NOT EXISTS acquisition_date DATE;

-- Backfill existing rows where acquisition_date is not yet set with the created_at date
UPDATE public.custody_items
SET acquisition_date = created_at::DATE
WHERE acquisition_date IS NULL;

-- Create index for filtering and sorting by acquisition_date
CREATE INDEX IF NOT EXISTS idx_custody_items_acquisition_date ON public.custody_items (acquisition_date);
