const fs = require('fs');

const ts = fs.readFileSync('src/lib/engineeringWorkshopsCustody81.ts', 'utf8');
const jsonMatch = ts.match(/ENGINEERING_WORKSHOPS_81_ITEMS: CustodyItem\[\] = (\[[\s\S]*\])/);
const items = JSON.parse(jsonMatch[1]);

let migrationSql = `-- Migration: Engineering Workshops Custody Import (81 items, WS-0001..WS-0081)
-- Timestamp: 20261102200000
-- Purpose:
--   1. Add import_batch_id column to public.custody_items for idempotent re-runs
--   2. Add unique constraint on (warehouse_id, code)
--   3. Create atomic import_custody_batch RPC function
--   4. Restrict table & RPC privileges to authenticated and service_role (never anon)
--   5. Seed all 81 verified items for 'engineering_workshops' with zero rows skipped and exact 0 prices for missing unit prices

-- 1. Ensure import_batch_id column exists
ALTER TABLE public.custody_items ADD COLUMN IF NOT EXISTS import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_custody_items_import_batch ON public.custody_items (import_batch_id);

-- 2. Create unique index on warehouse_id and code
CREATE UNIQUE INDEX IF NOT EXISTS custody_items_wh_code_unique
  ON public.custody_items (warehouse_id, code)
  WHERE code IS NOT NULL AND code <> '';

-- 3. Revoke anonymous access and grant minimum privileges to authenticated role (enforced via RLS)
REVOKE ALL ON public.custody_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_items TO authenticated;

-- 4. Batch Import RPC Function supporting dryRun and force
CREATE OR REPLACE FUNCTION public.import_custody_batch(
  p_warehouse_id TEXT,
  p_batch_id TEXT,
  p_items JSONB,
  p_force BOOLEAN DEFAULT FALSE,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := 0;
  v_item JSONB;
  v_exists BOOLEAN := FALSE;
  v_inserted INT := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.app_can_modify_records() THEN
    RAISE EXCEPTION 'System administrator required' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  v_count := jsonb_array_length(p_items);

  -- Check if batch already exists
  SELECT EXISTS (
    SELECT 1 FROM public.custody_items
    WHERE warehouse_id = p_warehouse_id AND import_batch_id = p_batch_id
  ) INTO v_exists;

  IF v_exists AND NOT p_force THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'BATCH_ALREADY_EXISTS',
      'message', 'هذه الدفعة مسجلة بالفعل في قاعدة البيانات. استخدم force=true لإعادة الكتابة.',
      'batch_id', p_batch_id,
      'warehouse_id', p_warehouse_id
    );
  END IF;

  -- Dry run preview
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'count', v_count,
      'warehouse_id', p_warehouse_id,
      'batch_id', p_batch_id
    );
  END IF;

  -- Delete existing items if force is enabled
  IF v_exists AND p_force THEN
    DELETE FROM public.custody_items
    WHERE warehouse_id = p_warehouse_id AND import_batch_id = p_batch_id;
  END IF;

  -- Insert all items in single transaction
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.custody_items (
      id,
      warehouse_id,
      code,
      name,
      category,
      quantity,
      unit,
      unit_price,
      value,
      condition,
      custodian,
      room_location,
      serial_number,
      notes,
      custody_type,
      import_batch_id,
      created_at,
      updated_at
    ) VALUES (
      COALESCE(v_item->>'id', 'cust-' || p_warehouse_id || '-' || gen_random_uuid()),
      p_warehouse_id,
      COALESCE(v_item->>'code', ''),
      COALESCE(v_item->>'name', 'صنف بدون اسم'),
      COALESCE(v_item->>'category', 'أخرى'),
      COALESCE((v_item->>'quantity')::NUMERIC, 1),
      COALESCE(v_item->>'unit', 'قطعة'),
      COALESCE((v_item->>'unitPrice')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0),
      COALESCE((v_item->>'value')::NUMERIC, 0),
      COALESCE(v_item->>'condition', 'excellent'),
      COALESCE(v_item->>'custodian', 'أمين عهدة الورش الهندسية'),
      COALESCE(v_item->>'roomLocation', v_item->>'room_location', 'الورش الهندسية'),
      COALESCE(v_item->>'serialNumber', v_item->>'serial_number', ''),
      COALESCE(v_item->>'notes', ''),
      COALESCE(v_item->>'custodyType', v_item->>'custody_type', 'مستديمة'),
      p_batch_id,
      COALESCE((v_item->>'acquisitionDate')::TIMESTAMPTZ, now()),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      warehouse_id = EXCLUDED.warehouse_id,
      code = EXCLUDED.code,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      quantity = EXCLUDED.quantity,
      unit = EXCLUDED.unit,
      unit_price = EXCLUDED.unit_price,
      value = EXCLUDED.value,
      condition = EXCLUDED.condition,
      custodian = EXCLUDED.custodian,
      room_location = EXCLUDED.room_location,
      custody_type = EXCLUDED.custody_type,
      import_batch_id = EXCLUDED.import_batch_id,
      updated_at = now();

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'count', v_count,
    'inserted', v_inserted,
    'warehouse_id', p_warehouse_id,
    'batch_id', p_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_custody_batch(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_custody_batch(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- 5. Seed all 81 Engineering Workshop items
`;

items.forEach(it => {
  const escName = it.name.replace(/'/g, "''");
  const escCat = it.category.replace(/'/g, "''");
  const escCustodian = it.custodian.replace(/'/g, "''");
  const escLoc = it.roomLocation.replace(/'/g, "''");
  migrationSql += `INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  '${it.id}', '${it.warehouseId}', '${it.code}', '${escName}', '${escCat}', ${it.quantity}, '${it.unit}', ${it.unitPrice}, ${it.value},
  '${it.condition}', '${escCustodian}', '${escLoc}', '', '', '${it.custodyType}',
  '${it.importBatchId}', '${it.acquisitionDate}T00:00:00Z', now()
) ON CONFLICT (id) DO UPDATE SET
  warehouse_id = EXCLUDED.warehouse_id,
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  quantity = EXCLUDED.quantity,
  unit = EXCLUDED.unit,
  unit_price = EXCLUDED.unit_price,
  value = EXCLUDED.value,
  condition = EXCLUDED.condition,
  custodian = EXCLUDED.custodian,
  room_location = EXCLUDED.room_location,
  custody_type = EXCLUDED.custody_type,
  import_batch_id = EXCLUDED.import_batch_id,
  updated_at = now();
`;
});

fs.writeFileSync('supabase/migrations/20261102200000_engineering_workshops_custody_import.sql', migrationSql, 'utf8');
console.log('Saved supabase/migrations/20261102200000_engineering_workshops_custody_import.sql');

// Also write rollback
const rollbackSql = `-- Rollback: Engineering Workshops Custody Import
-- Timestamp: 20261102200000

DELETE FROM public.custody_items
WHERE warehouse_id = 'engineering_workshops' AND import_batch_id = 'ws-import-2026-11-02';

DROP FUNCTION IF EXISTS public.import_custody_batch(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN);
DROP INDEX IF EXISTS public.custody_items_wh_code_unique;
DROP INDEX IF EXISTS public.idx_custody_items_import_batch;
ALTER TABLE public.custody_items DROP COLUMN IF EXISTS import_batch_id;
`;

fs.writeFileSync('supabase/rollbacks/20261102200000_engineering_workshops_custody_import.rollback.sql', rollbackSql, 'utf8');
console.log('Saved supabase/rollbacks/20261102200000_engineering_workshops_custody_import.rollback.sql');

