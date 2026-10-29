-- Migration: 20261030010000_normalize_movements_unit_price.sql
-- Description: Clean up all text-stored prices with commas or whitespace in movements table

UPDATE public.movements
SET unit_price = CASE
  WHEN unit_price LIKE '%,%' THEN REGEXP_REPLACE(TRIM(unit_price), ',', '.')
  ELSE TRIM(unit_price)
END
WHERE unit_price LIKE '%,%' OR unit_price != TRIM(unit_price);
