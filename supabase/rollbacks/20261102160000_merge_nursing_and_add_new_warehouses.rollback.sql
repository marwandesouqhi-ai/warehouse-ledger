-- Rollback Script: Merge Nursing and Medicine Warehouses
-- Timestamp: 20261102160000
-- Purpose:
--   Revert all warehouse migrations from 'medicine' back to 'nursing' based on warehouse_merge_audit_log

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  -- 1. Revert code collisions (strip -NUR)
  FOR v_rec IN
    SELECT record_id, old_value, new_value, details
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'custody_items' AND column_name = 'code'
  LOOP
    UPDATE public.custody_items
    SET
      code = v_rec.old_value,
      notes = COALESCE(v_rec.details->>'original_notes', notes)
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 2. Revert custody_items warehouse_id
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'custody_items' AND column_name = 'warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.custody_items
    SET
      warehouse_id = 'nursing',
      custodian = 'أمين عهدة كلية تمريض'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 3. Revert movements source_warehouse_id
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'movements' AND column_name = 'source_warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.movements
    SET source_warehouse_id = 'nursing'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 4. Revert movements dest_warehouse_id
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'movements' AND column_name = 'dest_warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.movements
    SET dest_warehouse_id = 'nursing'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 5. Revert technical_inspections
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'technical_inspections' AND column_name = 'warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.technical_inspections
    SET warehouse_id = 'nursing'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 6. Revert inventory_settlements
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'inventory_settlements' AND column_name = 'warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.inventory_settlements
    SET warehouse_id = 'nursing'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- 7. Revert disbursement_requests
  FOR v_rec IN
    SELECT record_id
    FROM public.warehouse_merge_audit_log
    WHERE table_name = 'disbursement_requests' AND column_name = 'warehouse_id' AND old_value = 'nursing'
  LOOP
    UPDATE public.disbursement_requests
    SET warehouse_id = 'nursing'
    WHERE id = v_rec.record_id::UUID;
  END LOOP;

  -- Clean up audit log after rollback
  DELETE FROM public.warehouse_merge_audit_log;
END $$;

