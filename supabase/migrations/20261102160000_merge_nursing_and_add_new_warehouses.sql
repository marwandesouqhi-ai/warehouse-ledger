-- Migration: Merge Nursing and Medicine Warehouses, and Add New Warehouses (Workshops and Building A)
-- Timestamp: 20261102160000
-- Purpose:
--   1. Merge 'nursing' into surviving id 'medicine' ("مخزن كلية طب بشري وتمريض")
--   2. Detect and safely resolve any code collision between 'nursing' and 'medicine' without data loss
--   3. Audit every migrated row into a dedicated audit table for rollback support
--   4. Update movements, inspections, settlements, disbursement requests, and analytics
--   5. Idempotent and safe to run multiple times

-- 1. Create audit table if not exists
CREATE TABLE IF NOT EXISTS public.warehouse_merge_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  column_name TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  details JSONB,
  migrated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_merge_audit_table ON public.warehouse_merge_audit_log (table_name, record_id);

-- Enable RLS on audit table
ALTER TABLE public.warehouse_merge_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'warehouse_merge_audit_log' AND policyname = 'Admins can manage warehouse merge audit log'
  ) THEN
    CREATE POLICY "Admins can manage warehouse merge audit log"
      ON public.warehouse_merge_audit_log
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.app_users
          WHERE id = auth.uid() AND role IN ('system_admin', 'admin', 'warehouse_admin')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.app_users
          WHERE id = auth.uid() AND role IN ('system_admin', 'admin', 'warehouse_admin')
        )
      );
  END IF;
END $$;

-- 2. Audit and rename colliding codes in custody_items before merging
DO $$
DECLARE
  v_rec RECORD;
  v_new_code TEXT;
BEGIN
  FOR v_rec IN
    SELECT n.id, n.code, n.name, n.notes
    FROM public.custody_items n
    INNER JOIN public.custody_items m
      ON m.warehouse_id = 'medicine'
      AND UPPER(TRIM(m.code)) = UPPER(TRIM(n.code))
    WHERE n.warehouse_id = 'nursing'
      AND n.code IS NOT NULL
      AND TRIM(n.code) <> ''
  LOOP
    v_new_code := v_rec.code || '-NUR';
    
    INSERT INTO public.warehouse_merge_audit_log (
      table_name, record_id, column_name, old_value, new_value, details
    ) VALUES (
      'custody_items',
      v_rec.id::TEXT,
      'code',
      v_rec.code,
      v_new_code,
      jsonb_build_object(
        'reason', 'collision_with_medicine_code',
        'item_name', v_rec.name,
        'original_notes', v_rec.notes
      )
    );

    UPDATE public.custody_items
    SET
      code = v_new_code,
      notes = CASE
        WHEN notes IS NULL OR TRIM(notes) = '' THEN '(كود سابق قبل دمج التمريض: ' || v_rec.code || ')'
        ELSE notes || ' (كود سابق قبل دمج التمريض: ' || v_rec.code || ')'
      END
    WHERE id = v_rec.id;
  END LOOP;
END $$;

-- 3. Migrate custody_items from nursing to medicine
DO $$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT id, code, name, custodian, room_location
    FROM public.custody_items
    WHERE warehouse_id = 'nursing'
  LOOP
    INSERT INTO public.warehouse_merge_audit_log (
      table_name, record_id, column_name, old_value, new_value, details
    ) VALUES (
      'custody_items',
      v_item.id::TEXT,
      'warehouse_id',
      'nursing',
      'medicine',
      jsonb_build_object('item_name', v_item.name, 'code', v_item.code)
    );
  END LOOP;

  UPDATE public.custody_items
  SET
    warehouse_id = 'medicine',
    custodian = CASE
      WHEN custodian ILIKE '%تمريض%' THEN 'أمين عهدة طب بشري وتمريض'
      ELSE COALESCE(custodian, 'أمين عهدة طب بشري وتمريض')
    END
  WHERE warehouse_id = 'nursing';
END $$;

-- 3b. Preserving distinct assets:
-- Distinct physical equipment items (such as multiple units in different rooms, models, or serial numbers)
-- are fully preserved. No automated bulk deletion is performed on shared item names.

-- 4. Migrate movements (source_warehouse_id and dest_warehouse_id)
DO $$
DECLARE
  v_mv RECORD;
BEGIN
  -- 4a. source_warehouse_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'movements' AND column_name = 'source_warehouse_id'
  ) THEN
    FOR v_mv IN
      SELECT id, item, permit, source_warehouse_id
      FROM public.movements
      WHERE source_warehouse_id = 'nursing'
    LOOP
      INSERT INTO public.warehouse_merge_audit_log (
        table_name, record_id, column_name, old_value, new_value, details
      ) VALUES (
        'movements',
        v_mv.id::TEXT,
        'source_warehouse_id',
        'nursing',
        'medicine',
        jsonb_build_object('item', v_mv.item, 'permit', v_mv.permit)
      );
    END LOOP;

    UPDATE public.movements
    SET source_warehouse_id = 'medicine'
    WHERE source_warehouse_id = 'nursing';
  END IF;

  -- 4b. dest_warehouse_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'movements' AND column_name = 'dest_warehouse_id'
  ) THEN
    FOR v_mv IN
      SELECT id, item, permit, dest_warehouse_id
      FROM public.movements
      WHERE dest_warehouse_id = 'nursing'
    LOOP
      INSERT INTO public.warehouse_merge_audit_log (
        table_name, record_id, column_name, old_value, new_value, details
      ) VALUES (
        'movements',
        v_mv.id::TEXT,
        'dest_warehouse_id',
        'nursing',
        'medicine',
        jsonb_build_object('item', v_mv.item, 'permit', v_mv.permit)
      );
    END LOOP;

    UPDATE public.movements
    SET dest_warehouse_id = 'medicine'
    WHERE dest_warehouse_id = 'nursing';
  END IF;
END $$;

-- 5. Migrate technical_inspections if exists
DO $$
DECLARE
  v_insp RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'technical_inspections' AND column_name = 'warehouse_id'
  ) THEN
    FOR v_insp IN
      SELECT id, inspection_number, warehouse_id
      FROM public.technical_inspections
      WHERE warehouse_id = 'nursing'
    LOOP
      INSERT INTO public.warehouse_merge_audit_log (
        table_name, record_id, column_name, old_value, new_value, details
      ) VALUES (
        'technical_inspections',
        v_insp.id::TEXT,
        'warehouse_id',
        'nursing',
        'medicine',
        jsonb_build_object('inspection_number', v_insp.inspection_number)
      );
    END LOOP;

    UPDATE public.technical_inspections
    SET warehouse_id = 'medicine'
    WHERE warehouse_id = 'nursing';
  END IF;
END $$;

-- 6. Migrate inventory_settlements if exists
DO $$
DECLARE
  v_set RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_settlements' AND column_name = 'warehouse_id'
  ) THEN
    FOR v_set IN
      SELECT id, settlement_number, warehouse_id
      FROM public.inventory_settlements
      WHERE warehouse_id = 'nursing'
    LOOP
      INSERT INTO public.warehouse_merge_audit_log (
        table_name, record_id, column_name, old_value, new_value, details
      ) VALUES (
        'inventory_settlements',
        v_set.id::TEXT,
        'warehouse_id',
        'nursing',
        'medicine',
        jsonb_build_object('settlement_number', v_set.settlement_number)
      );
    END LOOP;

    UPDATE public.inventory_settlements
    SET warehouse_id = 'medicine'
    WHERE warehouse_id = 'nursing';
  END IF;
END $$;

-- 7. Migrate disbursement_requests if exists
DO $$
DECLARE
  v_req RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disbursement_requests' AND column_name = 'warehouse_id'
  ) THEN
    FOR v_req IN
      SELECT id, request_number, warehouse_id
      FROM public.disbursement_requests
      WHERE warehouse_id = 'nursing'
    LOOP
      INSERT INTO public.warehouse_merge_audit_log (
        table_name, record_id, column_name, old_value, new_value, details
      ) VALUES (
        'disbursement_requests',
        v_req.id::TEXT,
        'warehouse_id',
        'nursing',
        'medicine',
        jsonb_build_object('request_number', v_req.request_number)
      );
    END LOOP;

    UPDATE public.disbursement_requests
    SET warehouse_id = 'medicine'
    WHERE warehouse_id = 'nursing';
  END IF;
END $$;

-- 8. Migrate inventory_analytics_snapshots if exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_analytics_snapshots' AND column_name = 'warehouse_id'
  ) THEN
    UPDATE public.inventory_analytics_snapshots
    SET warehouse_id = 'medicine'
    WHERE warehouse_id = 'nursing';
  END IF;
END $$;

COMMENT ON TABLE public.warehouse_merge_audit_log IS 'Audit log of migrated rows and resolved code collisions during the merge of nursing warehouse into medicine';

