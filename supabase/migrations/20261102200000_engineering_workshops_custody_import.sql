-- Migration: Engineering Workshops Custody Import (81 items, WS-0001..WS-0081)
-- Timestamp: 20261102200000
-- Purpose:
--   1. Add import_batch_id column to public.custody_items for idempotent re-runs
--   2. Add unique constraint on (warehouse_id, code)
--   3. Create atomic import_custody_batch RPC function
--   4. Grant table & RPC privileges to anon and authenticated roles
--   5. Seed all 81 verified items for 'engineering_workshops' with zero rows skipped and exact 0 prices for missing unit prices

-- 1. Ensure import_batch_id column exists
ALTER TABLE public.custody_items ADD COLUMN IF NOT EXISTS import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_custody_items_import_batch ON public.custody_items (import_batch_id);

-- 2. Create unique index on warehouse_id and code
CREATE UNIQUE INDEX IF NOT EXISTS custody_items_wh_code_unique
  ON public.custody_items (warehouse_id, code)
  WHERE code IS NOT NULL AND code <> '';

-- 3. Grant privileges so anon and authenticated users can access custody items
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_items TO anon, authenticated;

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

GRANT EXECUTE ON FUNCTION public.import_custody_batch TO anon, authenticated;

-- 5. Seed all 81 Engineering Workshop items
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-001', 'engineering_workshops', 'WS-0001', 'ماكينه المخرطه', 'ماكينات ومعدات ورش', 1, 'قطعة', 534375, 534375,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-002', 'engineering_workshops', 'WS-0002', 'قدم ذات ورنه', 'أدوات وأجهزة قياس', 5, 'قطعة', 2466, 12330,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-003', 'engineering_workshops', 'WS-0003', 'قدم اعماق 200mm', 'أدوات وأجهزة قياس', 3, 'قطعة', 5273, 15819,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-004', 'engineering_workshops', 'WS-0004', 'قدم بوجه ساعه', 'أدوات وأجهزة قياس', 3, 'قطعة', 6199, 18597,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-005', 'engineering_workshops', 'WS-0005', 'قدم رقميه', 'أدوات وأجهزة قياس', 3, 'قطعة', 15889, 47667,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-006', 'engineering_workshops', 'WS-0006', 'ميكروميتر', 'أدوات وأجهزة قياس', 3, 'قطعة', 7204, 21612,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-007', 'engineering_workshops', 'WS-0007', 'زاويه', 'أدوات وأجهزة قياس', 3, 'قطعة', 663, 1989,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-008', 'engineering_workshops', 'WS-0008', 'قدم قياس ارتفاعات ياباني', 'أدوات وأجهزة قياس', 1, 'قطعة', 45743, 45743,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-009', 'engineering_workshops', 'WS-0009', 'قدم قياس ارتفاعات انجليزي', 'أدوات وأجهزة قياس', 1, 'قطعة', 74385, 74385,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-010', 'engineering_workshops', 'WS-0010', 'فيلر مجسات', 'أدوات وأجهزة قياس', 1, 'قطعة', 3563, 3563,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-011', 'engineering_workshops', 'WS-0011', 'جهاز قياس خشونه', 'أدوات وأجهزة قياس', 1, 'قطعة', 1425, 1425,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-012', 'engineering_workshops', 'WS-0012', 'لحام القوس سطحي', 'معدات ولوازم لحام', 1, 'قطعة', 384750, 384750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-013', 'engineering_workshops', 'WS-0013', 'لحام القوس كهربي', 'معدات ولوازم لحام', 2, 'قطعة', 64125, 128250,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-014', 'engineering_workshops', 'WS-0014', 'لحام فاز', 'معدات ولوازم لحام', 2, 'قطعة', 40000, 80000,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-015', 'engineering_workshops', 'WS-0015', 'صاروخ', 'ماكينات ومعدات ورش', 2, 'قطعة', 8550, 17100,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-016', 'engineering_workshops', 'WS-0016', 'portable efu meextractor', 'معدات ولوازم لحام', 1, 'قطعة', 192375, 192375,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-017', 'engineering_workshops', 'WS-0017', 'استاند', 'عدد وأدوات يدوية', 2, 'قطعة', 31350, 62700,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-018', 'engineering_workshops', 'WS-0018', 'لحام قوس كهربي ميج', 'معدات ولوازم لحام', 1, 'قطعة', 235125, 235125,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-019', 'engineering_workshops', 'WS-0019', 'ماكينه منشار شريط محلي', 'ماكينات ومعدات ورش', 1, 'قطعة', 75953, 75953,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-020', 'engineering_workshops', 'WS-0020', 'ماكينه تخانه 2 موتور ماركه ucm محلي', 'نجارة وأخشاب', 1, 'قطعة', 118062, 118062,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-021', 'engineering_workshops', 'WS-0021', 'ماكينه رابوه ماركه ucmموديل pl-400', 'نجارة وأخشاب', 1, 'قطعة', 115782, 115782,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-022', 'engineering_workshops', 'WS-0022', 'مخرطه اخشاب عاده ماركه ucmموديل tb-1500', 'ماكينات ومعدات ورش', 1, 'قطعة', 80085, 80085,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-023', 'engineering_workshops', 'WS-0023', 'ماكينه منقاربنط مائل الماركه ucmموديل tg-45', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 70110, 70110,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-024', 'engineering_workshops', 'WS-0024', 'سندال 50كجم بالقاعده وبفرن واحد انجيليزي', 'سباكة وقوالب ومعادن', 1, 'قطعة', 31350, 31350,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-025', 'engineering_workshops', 'WS-0025', 'زهره حداده بقاعده 40-40', 'سباكة وقوالب ومعادن', 1, 'قطعة', 51870, 51870,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-026', 'engineering_workshops', 'WS-0026', '1/2 مرزبه 5كجم', 'عدد وأدوات يدوية', 4, 'قطعة', 1026, 4104,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-027', 'engineering_workshops', 'WS-0027', 'لقط ماسك للعينات 45كجم(اشكال مختلفه)', 'عدد وأدوات يدوية', 4, 'قطعة', 513, 2052,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-028', 'engineering_workshops', 'WS-0028', 'طقم بلصات مكون من 3قطع (دائري-مدبب-مربع)', 'ثقب وتفريز وقلاووظ', 3, 'قطعة', 1212, 3636,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-029', 'engineering_workshops', 'WS-0029', 'مرزبه 10كجم', 'عدد وأدوات يدوية', 4, 'قطعة', 2423, 9692,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-030', 'engineering_workshops', 'WS-0030', 'مكبس 10طن', 'أفران ومكابس', 1, 'قطعة', 39900, 39900,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-031', 'engineering_workshops', 'WS-0031', 'فرن ظهر في السباكه', 'سباكة وقوالب ومعادن', 1, 'قطعة', 1154250, 1154250,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-06-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-032', 'engineering_workshops', 'WS-0032', 'مكبس 50طن', 'أفران ومكابس', 1, 'قطعة', 511575, 511575,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-033', 'engineering_workshops', 'WS-0033', 'ترابيزه خشبيه', 'نجارة وأخشاب', 2, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-034', 'engineering_workshops', 'WS-0034', 'نماذج خشبيه اشكال مختلفه', 'سباكة وقوالب ومعادن', 10, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-035', 'engineering_workshops', 'WS-0035', 'طقم عده سباكه مكون من 40 قطعه', 'سباكة وقوالب ومعادن', 3, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-036', 'engineering_workshops', 'WS-0036', 'لقطه شباك بوتقه', 'سباكة وقوالب ومعادن', 1, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-037', 'engineering_workshops', 'WS-0037', 'شيال بوتقه', 'سباكة وقوالب ومعادن', 1, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-038', 'engineering_workshops', 'WS-0038', 'نظاره للمعدن معتمه', 'مهمات وسلامة مهنية', 10, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-039', 'engineering_workshops', 'WS-0039', 'جوانتي حراري', 'مهمات وسلامة مهنية', 10, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-040', 'engineering_workshops', 'WS-0040', 'روازق وزهر 4 مقاسات مختلفه', 'سباكة وقوالب ومعادن', 1, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-041', 'engineering_workshops', 'WS-0041', 'روازق خشب 4 مقاسات', 'سباكة وقوالب ومعادن', 1, 'قطعة', 0, 0,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-042', 'engineering_workshops', 'WS-0042', 'فرن حداده يعمل بالغاز الطبيعي', 'أفران ومكابس', 1, 'قطعة', 65625, 65625,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-043', 'engineering_workshops', 'WS-0043', 'ماكينه لحام النقطه', 'معدات ولوازم لحام', 1, 'قطعة', 677875, 677875,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-044', 'engineering_workshops', 'WS-0044', 'ماكينه فريزه', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 648945, 648945,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-045', 'engineering_workshops', 'WS-0045', 'صنيه دواره', 'ماكينات ومعدات ورش', 1, 'قطعة', 9747, 9747,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-046', 'engineering_workshops', 'WS-0046', 'قطع تثبيت', 'عدد وأدوات يدوية', 1, 'قطعة', 2385, 2385,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-047', 'engineering_workshops', 'WS-0047', 'مثقاب تزجه', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 7695, 7695,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-048', 'engineering_workshops', 'WS-0048', 'مثقاب 2*3', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 2265, 2265,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-049', 'engineering_workshops', 'WS-0049', 'مثقاب model 25050', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 455288, 455288,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-050', 'engineering_workshops', 'WS-0050', 'مقشطه نطاحه model z 4050', 'ماكينات ومعدات ورش', 1, 'قطعة', 410400, 410400,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-051', 'engineering_workshops', 'WS-0051', 'ماكينه تجليخ مسطحه model sm350', 'ماكينات ومعدات ورش', 1, 'قطعة', 538650, 538650,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-052', 'engineering_workshops', 'WS-0052', 'ماكينه تجليخ سير model msg 250', 'ماكينات ومعدات ورش', 1, 'قطعة', 371925, 371925,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-053', 'engineering_workshops', 'WS-0053', 'ماكينه منشار اوتوماتيك model bms 75', 'ماكينات ومعدات ورش', 1, 'قطعة', 106875, 106875,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-054', 'engineering_workshops', 'WS-0054', 'ماكينه المقص اليدوي model ea 42', 'ماكينات ومعدات ورش', 1, 'قطعة', 7682, 7682,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-055', 'engineering_workshops', 'WS-0055', 'ماكينه تني يدوي', 'ماكينات ومعدات ورش', 1, 'قطعة', 51300, 51300,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-056', 'engineering_workshops', 'WS-0056', 'ماكينه ثني صاج يدويه', 'ماكينات ومعدات ورش', 1, 'قطعة', 384750, 384750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-057', 'engineering_workshops', 'WS-0057', 'مساعد قياس', 'أدوات وأجهزة قياس', 3, 'قطعة', 2907, 8721,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-058', 'engineering_workshops', 'WS-0058', 'برجل مدبب', 'أدوات وأجهزة قياس', 3, 'قطعة', 6883, 20649,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-059', 'engineering_workshops', 'WS-0059', 'geugeble black set', 'أدوات وأجهزة قياس', 1, 'قطعة', 57000, 57000,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-060', 'engineering_workshops', 'WS-0060', 'universal bevel protraltor 150m', 'أدوات وأجهزة قياس', 3, 'قطعة', 17528, 52584,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-061', 'engineering_workshops', 'WS-0061', 'طقم ازميل خشب 11 قطعه', 'نجارة وأخشاب', 1, 'قطعة', 650, 650,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-062', 'engineering_workshops', 'WS-0062', 'شنطه عده', 'عدد وأدوات يدوية', 3, 'قطعة', 350, 1050,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-063', 'engineering_workshops', 'WS-0063', 'بود قلاوظ احجام', 'ثقب وتفريز وقلاووظ', 12, 'قطعة', 200, 2400,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-064', 'engineering_workshops', 'WS-0064', 'سن قلاوظ احجام', 'ثقب وتفريز وقلاووظ', 16, 'قطعة', 100, 1600,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-065', 'engineering_workshops', 'WS-0065', 'بلص نواه', 'ثقب وتفريز وقلاووظ', 6, 'قطعة', 250, 1500,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-066', 'engineering_workshops', 'WS-0066', 'مقص احجام مختلفه', 'ماكينات ومعدات ورش', 12, 'قطعة', 75, 900,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-067', 'engineering_workshops', 'WS-0067', 'منشار احجام مختلفه', 'ماكينات ومعدات ورش', 8, 'قطعة', 1300, 10400,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-068', 'engineering_workshops', 'WS-0068', 'زاويه خشابي', 'أدوات وأجهزة قياس', 4, 'قطعة', 550, 2200,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-069', 'engineering_workshops', 'WS-0069', 'كماشه', 'عدد وأدوات يدوية', 3, 'قطعة', 350, 1050,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-070', 'engineering_workshops', 'WS-0070', 'متر شريط', 'أدوات وأجهزة قياس', 3, 'قطعة', 120, 360,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-071', 'engineering_workshops', 'WS-0071', 'سداق ظهر', 'سباكة وقوالب ومعادن', 3, 'قطعة', 1050, 3150,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-072', 'engineering_workshops', 'WS-0072', 'شاكوش احجام مختلفه', 'عدد وأدوات يدوية', 7, 'قطعة', 450, 3150,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-073', 'engineering_workshops', 'WS-0073', 'شوكه علامه', 'أدوات وأجهزة قياس', 5, 'قطعة', 250, 1250,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-074', 'engineering_workshops', 'WS-0074', 'زمبه علامه', 'أدوات وأجهزة قياس', 5, 'قطعة', 350, 1750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-075', 'engineering_workshops', 'WS-0075', 'ازميل نجاره', 'عدد وأدوات يدوية', 7, 'قطعة', 250, 1750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-076', 'engineering_workshops', 'WS-0076', 'طقم مفكات 6 قطع عاده', 'عدد وأدوات يدوية', 1, 'قطعة', 1700, 1700,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-077', 'engineering_workshops', 'WS-0077', 'مبرد خشابي انواع مختلفه', 'عدد وأدوات يدوية', 23, 'قطعة', 250, 5750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-078', 'engineering_workshops', 'WS-0078', 'مبرد سن سكينه', 'عدد وأدوات يدوية', 5, 'قطعة', 350, 1750,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-079', 'engineering_workshops', 'WS-0079', 'منشار اركيت', 'ماكينات ومعدات ورش', 1, 'قطعة', 1200, 1200,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-080', 'engineering_workshops', 'WS-0080', 'شانيور كهربائي', 'ثقب وتفريز وقلاووظ', 1, 'قطعة', 3500, 3500,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
INSERT INTO public.custody_items (
  id, warehouse_id, code, name, category, quantity, unit, unit_price, value,
  condition, custodian, room_location, serial_number, notes, custody_type,
  import_batch_id, created_at, updated_at
) VALUES (
  'cust-ws-081', 'engineering_workshops', 'WS-0081', 'فاره كهربائيه', 'نجارة وأخشاب', 1, 'قطعة', 10700, 10700,
  'excellent', 'أمين عهدة الورش الهندسية', 'الورش الهندسية', '', '', 'مستديمة',
  'ws-import-2026-11-02', '2025-01-01T00:00:00Z', now()
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
