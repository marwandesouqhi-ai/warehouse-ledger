-- Migration: 20261029220000_create_data_quality_repair_rpc.sql
-- Description: RPC function and database tools for autonomous data quality healing and normalization

CREATE OR REPLACE FUNCTION public.repair_movements_data_quality()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed_prices INT := 0;
  v_fixed_invoices INT := 0;
  v_fixed_dates INT := 0;
  v_total_repaired INT := 0;
BEGIN
  -- 1. إصلاح الأسعار المحفوظة كنص بفواصل أو أرقام غير قياسية
  WITH updated_prices AS (
    UPDATE public.movements
    SET unit_price = CASE
      -- استبدال الفواصل العشرية بالنقاط: 154,2 -> 154.2
      WHEN unit_price LIKE '%,%' AND unit_price NOT LIKE '%.%' THEN
        REGEXP_REPLACE(TRIM(unit_price), ',', '.')
      ELSE
        TRIM(unit_price)
    END
    WHERE unit_price LIKE '%,%' OR unit_price != TRIM(unit_price)
    RETURNING 1
  )
  SELECT count(*) INTO v_fixed_prices FROM updated_prices;

  -- 2. إصلاح وتوليد أرقام الفواتير الناقصة
  WITH updated_invoices AS (
    UPDATE public.movements
    SET invoice_number = CASE
      -- إذا كان مسجلاً في الملاحظات (فاتورة: 1) أو (فاتورة: 2)
      WHEN notes ~* 'فاتورة:\s*([0-9]+)' THEN
        SUBSTRING(notes FROM '(?i)فاتورة:\s*([0-9]+)')
      WHEN notes ~* 'فاتورة\s*([0-9]+)' THEN
        SUBSTRING(notes FROM '(?i)فاتورة\s*([0-9]+)')
      -- توليد رقم فاتورة نظامي رسمي
      ELSE
        CONCAT('INV-', COALESCE(NULLIF(REPLACE(received_on, '-', ''), ''), '2026'), '-', SUBSTRING(id::text, 1, 5))
    END
    WHERE invoice_number IS NULL OR TRIM(invoice_number) = '' OR invoice_number = '0'
    RETURNING 1
  )
  SELECT count(*) INTO v_fixed_invoices FROM updated_invoices;

  -- 3. معالجة وتنسيق التواريخ
  WITH updated_dates AS (
    UPDATE public.movements
    SET issued_on = received_on
    WHERE issued_on IS NOT NULL 
      AND TRIM(issued_on) != '' 
      AND received_on IS NOT NULL 
      AND TRIM(received_on) != '' 
      AND issued_on < received_on
    RETURNING 1
  )
  SELECT count(*) INTO v_fixed_dates FROM updated_dates;

  v_total_repaired := v_fixed_prices + v_fixed_invoices + v_fixed_dates;

  RETURN jsonb_build_object(
    'success', true,
    'total_repaired', v_total_repaired,
    'fixed_prices', v_fixed_prices,
    'fixed_invoices', v_fixed_invoices,
    'fixed_dates', v_fixed_dates,
    'repaired_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_movements_data_quality() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_movements_data_quality() TO authenticated, service_role;

