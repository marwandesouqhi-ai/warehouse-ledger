-- Additive inventory integrity migration. No legacy balances/dates are guessed or rewritten.
BEGIN;
ALTER TABLE public.custody_items
  ADD COLUMN IF NOT EXISTS acquisition_date date,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_item_id text,
  ADD COLUMN IF NOT EXISTS source_quantity_before numeric,
  ADD COLUMN IF NOT EXISTS source_value_before numeric,
  ADD COLUMN IF NOT EXISTS inventory_effects jsonb,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX movements_request_fingerprint_v2 ON public.movements(request_fingerprint) WHERE deleted_at IS NULL AND request_fingerprint IS NOT NULL;
CREATE TABLE public.inventory_operations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL,
  request jsonb NOT NULL,
  event jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_operations_actor_idx ON public.inventory_operations(actor_id, created_at);
ALTER TABLE public.inventory_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.inventory_operations TO authenticated;
CREATE POLICY inventory_operations_read ON public.inventory_operations FOR SELECT TO authenticated USING ((SELECT auth.uid()) = actor_id);
CREATE POLICY inventory_operations_insert ON public.inventory_operations FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = actor_id);

-- Legacy writers also invalidate optimistic versions; old rows start at version zero.
CREATE FUNCTION public.bump_inventory_version() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.version := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.version + 1 END;
  RETURN NEW;
END $$;
CREATE TRIGGER custody_inventory_version BEFORE INSERT OR UPDATE ON public.custody_items FOR EACH ROW EXECUTE FUNCTION public.bump_inventory_version();
CREATE TRIGGER movement_inventory_version BEFORE INSERT OR UPDATE ON public.movements FOR EACH ROW EXECUTE FUNCTION public.bump_inventory_version();

CREATE FUNCTION public.apply_inventory_operation(
  p_operation_id uuid, p_kind text, p_items jsonb, p_movements jsonb, p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request jsonb := jsonb_build_object('kind',p_kind,'items',p_items,'movements',p_movements,'event',p_event);
  v_previous public.inventory_operations%ROWTYPE;
  v_change jsonb; v_after jsonb; v_expected bigint; v_row public.custody_items%ROWTYPE; v_movement public.movements%ROWTYPE;
  v_effects jsonb := '[]'::jsonb; v_effect jsonb; v_quantity numeric; v_value numeric;
  v_in numeric; v_out numeric; v_price numeric; v_source_qty numeric; v_source_value numeric; v_transfer_value numeric; v_destination jsonb; v_sum_quantity numeric; v_sum_value numeric;
  v_role text := public.app_role(); v_response jsonb := '{"success":true}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_kind NOT IN ('purchase','disbursement','transfer','edit','delete','item_save','item_delete','import') THEN RAISE EXCEPTION 'Invalid operation'; END IF;
  IF p_kind IN ('edit','delete','item_delete') AND NOT (public.is_system_admin() OR public.has_permission('manage_records')) THEN RAISE EXCEPTION 'Record management permission required' USING ERRCODE='42501'; END IF;
  IF p_kind = 'purchase' AND NOT (v_role IN ('system_admin','admin','purchasing_staff') OR public.has_permission('manage_records')) THEN RAISE EXCEPTION 'Purchase permission required' USING ERRCODE='42501'; END IF;
  IF p_kind IN ('transfer','disbursement','item_save','import') AND NOT (v_role IN ('system_admin','admin','warehouse_staff') OR public.has_permission('manage_records')) THEN RAISE EXCEPTION 'Inventory permission required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_typeof(p_movements) <> 'array' THEN RAISE EXCEPTION 'Invalid changes'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items)) <> (SELECT count(DISTINCT x->'after'->>'id') FROM jsonb_array_elements(p_items) x) THEN RAISE EXCEPTION 'Duplicate item IDs'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_movements)) <> (SELECT count(DISTINCT x->'after'->>'id') FROM jsonb_array_elements(p_movements) x) THEN RAISE EXCEPTION 'Duplicate movement IDs'; END IF;
  IF p_kind IN ('purchase','disbursement','transfer','edit','delete') AND jsonb_array_length(p_movements)<>1 THEN RAISE EXCEPTION 'One ledger movement is required'; END IF;
  -- Shared inventory is small; serialize operation plans, then lock affected legacy rows in ID order.
  PERFORM pg_advisory_xact_lock(hashtext('warehouse-ledger-inventory-operations'));
  SELECT * INTO v_previous FROM public.inventory_operations WHERE id=p_operation_id;
  IF FOUND THEN
    IF v_previous.request <> v_request THEN RAISE EXCEPTION 'Operation ID reused with different content'; END IF;
    RETURN v_previous.response;
  END IF;
  PERFORM id FROM public.movements WHERE id::text IN (SELECT x->'after'->>'id' FROM jsonb_array_elements(p_movements) x) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.custody_items WHERE id IN (SELECT x->'after'->>'id' FROM jsonb_array_elements(p_items) x) ORDER BY id FOR UPDATE;
  FOR v_change IN SELECT * FROM jsonb_array_elements(p_movements) LOOP
    v_after := v_change->'after'; v_expected := (v_change->>'expectedVersion')::bigint;
    SELECT * INTO v_movement FROM public.movements WHERE id=(v_after->>'id')::uuid;
    IF (FOUND AND (v_expected IS NULL OR v_movement.version <> v_expected)) OR (NOT FOUND AND v_expected IS NOT NULL) THEN RAISE EXCEPTION 'Movement version conflict' USING ERRCODE='40001'; END IF;
    IF p_kind IN ('purchase','disbursement','transfer') AND v_expected IS NOT NULL THEN RAISE EXCEPTION 'Create operation cannot edit a movement'; END IF;
    IF p_kind IN ('edit','delete') AND v_expected IS NULL THEN RAISE EXCEPTION 'Existing movement required'; END IF;
    IF v_expected IS NOT NULL AND coalesce(jsonb_array_length(v_movement.inventory_effects),0)=0 THEN RAISE EXCEPTION 'Legacy movement requires reviewed reconciliation'; END IF;
    IF v_expected IS NOT NULL THEN
      FOR v_effect IN SELECT * FROM jsonb_array_elements(v_movement.inventory_effects) LOOP
        v_effects := v_effects || jsonb_build_array(jsonb_build_object('itemId',v_effect->>'itemId','quantity',-(v_effect->>'quantity')::numeric,'value',-(v_effect->>'value')::numeric));
      END LOOP;
    END IF;
    IF v_after->>'deletedAt' IS NULL THEN
      v_in := coalesce(nullif(v_after->>'qin',''),'0')::numeric; v_out := coalesce(nullif(v_after->>'qout',''),'0')::numeric;
      v_price := coalesce(nullif(v_after->>'price',''),'0')::numeric;
      IF p_kind='purchase' AND (v_in<=0 OR v_out<>0) THEN RAISE EXCEPTION 'Purchase quantities required'; END IF;
      IF p_kind IN ('disbursement','transfer') AND (v_in<>0 OR v_out<=0) THEN RAISE EXCEPTION 'Outward quantities required'; END IF;
      IF v_in < 0 OR v_out < 0 OR v_price < 0 OR v_in+v_out<=0 OR (v_in>0 AND v_out>0) THEN RAISE EXCEPTION 'Invalid movement quantities'; END IF;
      SELECT coalesce(sum((e->>'quantity')::numeric),0), coalesce(sum((e->>'value')::numeric),0) INTO v_sum_quantity,v_sum_value FROM jsonb_array_elements(v_after->'inventoryEffects') e;
      IF abs(v_sum_quantity-v_in)>0.000001 OR abs(v_sum_value-v_in*v_price)>0.000001 THEN RAISE EXCEPTION 'Movement effects do not conserve quantity/value'; END IF;
      IF v_out>0 THEN
        IF jsonb_array_length(v_after->'inventoryEffects')<>2 THEN RAISE EXCEPTION 'A transfer requires source and destination effects'; END IF;
        SELECT * INTO v_row FROM public.custody_items WHERE id=v_after->>'sourceItemId';
        IF NOT FOUND OR v_row.deleted_at IS NOT NULL OR v_row.warehouse_id<>coalesce(v_after->>'sourceWarehouseId','main') THEN RAISE EXCEPTION 'Missing source item'; END IF;
        SELECT v_row.quantity-coalesce(sum((e->>'quantity')::numeric),0), v_row.value-coalesce(sum((e->>'value')::numeric),0)
          INTO v_source_qty,v_source_value FROM jsonb_array_elements(coalesce(v_movement.inventory_effects,'[]'::jsonb)) e WHERE e->>'itemId'=v_row.id;
        IF v_out>v_source_qty OR v_source_qty<=0 THEN RAISE EXCEPTION 'Insufficient source stock'; END IF;
        v_transfer_value := CASE WHEN v_out=v_source_qty THEN v_source_value ELSE round(v_source_value*v_out/v_source_qty,6) END;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'inventoryEffects') e WHERE e->>'itemId'=v_row.id AND (e->>'value')::numeric=-v_transfer_value) THEN RAISE EXCEPTION 'Transfer value must be proportional to source'; END IF;
        SELECT i->'after' INTO v_destination FROM jsonb_array_elements(p_items) i
          WHERE i->'after'->>'id' IN (SELECT e->>'itemId' FROM jsonb_array_elements(v_after->'inventoryEffects') e WHERE (e->>'quantity')::numeric=v_out AND (e->>'value')::numeric=v_transfer_value);
        IF v_destination IS NULL THEN RAISE EXCEPTION 'Missing transfer destination'; END IF;
        IF coalesce(v_after->>'destType','warehouse')='custodian' THEN
          IF v_destination->>'warehouseId'<>v_row.warehouse_id OR coalesce(v_destination->>'custodian','')='' THEN RAISE EXCEPTION 'Invalid personal custody destination'; END IF;
        ELSIF v_destination->>'warehouseId'<>v_after->>'destWarehouseId' OR v_destination->>'warehouseId'=v_row.warehouse_id THEN RAISE EXCEPTION 'Invalid destination warehouse'; END IF;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'inventoryEffects') e WHERE e->>'itemId'=v_row.id AND (e->>'quantity')::numeric=-v_out) THEN RAISE EXCEPTION 'Invalid source effect'; END IF;
      END IF;
      v_effects := v_effects || (v_after->'inventoryEffects');
    END IF;
  END LOOP;
  FOR v_change IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_after := v_change->'after'; v_expected := (v_change->>'expectedVersion')::bigint;
    SELECT * INTO v_row FROM public.custody_items WHERE id=v_after->>'id';
    IF (FOUND AND (v_expected IS NULL OR v_row.version<>v_expected)) OR (NOT FOUND AND v_expected IS NOT NULL) THEN RAISE EXCEPTION 'Inventory version conflict' USING ERRCODE='40001'; END IF;
    v_quantity := (v_after->>'quantity')::numeric; v_value := (v_after->>'value')::numeric;
    IF v_quantity IS NULL OR v_value IS NULL OR v_quantity<0 OR v_value<0 OR v_quantity::text IN ('NaN','Infinity','-Infinity') OR v_value::text IN ('NaN','Infinity','-Infinity') OR (v_quantity=0 AND v_value<>0) THEN RAISE EXCEPTION 'Invalid final inventory balance'; END IF;
    IF p_kind IN ('purchase','disbursement','transfer','edit','delete') THEN
      SELECT coalesce(sum((e->>'quantity')::numeric),0),coalesce(sum((e->>'value')::numeric),0) INTO v_sum_quantity,v_sum_value FROM jsonb_array_elements(v_effects) e WHERE e->>'itemId'=v_after->>'id';
      IF abs(v_quantity-coalesce(v_row.quantity,0)-v_sum_quantity)>0.000001 OR abs(v_value-coalesce(v_row.value,0)-v_sum_value)>0.000001 THEN RAISE EXCEPTION 'Inventory changes do not match movement effects'; END IF;
    END IF;
    INSERT INTO public.custody_items(id,warehouse_id,code,name,category,quantity,unit,unit_price,value,condition,custodian,room_location,serial_number,notes,custody_type,acquisition_date,deleted_at,history,version)
    VALUES(v_after->>'id',v_after->>'warehouseId',coalesce(v_after->>'code',''),v_after->>'name',coalesce(v_after->>'category',''),v_quantity,coalesce(v_after->>'unit','قطعة'),nullif(v_after->>'unitPrice','')::numeric,v_value,coalesce(v_after->>'condition','good'),coalesce(v_after->>'custodian',''),coalesce(v_after->>'roomLocation',''),coalesce(v_after->>'serialNumber',''),coalesce(v_after->>'notes',''),coalesce(v_after->>'custodyType','مستديمة'),nullif(v_after->>'acquisitionDate','')::date,nullif(v_after->>'deletedAt','')::timestamptz,coalesce(v_row.history,'[]'::jsonb)||jsonb_build_array(p_event),coalesce(v_expected,0)+1)
    ON CONFLICT(id) DO UPDATE SET warehouse_id=excluded.warehouse_id,code=excluded.code,name=excluded.name,category=excluded.category,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,value=excluded.value,condition=excluded.condition,custodian=excluded.custodian,room_location=excluded.room_location,serial_number=excluded.serial_number,notes=excluded.notes,custody_type=excluded.custody_type,acquisition_date=excluded.acquisition_date,deleted_at=excluded.deleted_at,history=excluded.history,updated_at=now();
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_effects) e WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE i->'after'->>'id'=e->>'itemId')) THEN RAISE EXCEPTION 'Missing inventory effect target'; END IF;
  FOR v_change IN SELECT * FROM jsonb_array_elements(p_movements) LOOP
    v_after := v_change->'after';
    INSERT INTO public.movements(id,owner_id,received_on,invoice_number,supplier,recipient,permit,issued_on,item,unit_price,qty_in,qty_out,notes,fingerprint,kind,custody_applied,created_by,source_warehouse_id,dest_warehouse_id,dest_type,custodian_name,source_item_id,inventory_effects,deleted_at,request_fingerprint,source_quantity_before,source_value_before)
    VALUES((v_after->>'id')::uuid,auth.uid(),coalesce(v_after->>'date',''),coalesce(v_after->>'inv',''),coalesce(v_after->>'from',''),coalesce(v_after->>'to',''),coalesce(v_after->>'permit',''),coalesce(v_after->>'issue',''),v_after->>'item',coalesce(v_after->>'price','0'),coalesce(v_after->>'qin','0'),coalesce(v_after->>'qout','0'),coalesce(v_after->>'notes',''),'inventory-v2:'||(v_after->>'id'),CASE WHEN coalesce(nullif(v_after->>'qin',''),'0')::numeric>0 THEN 'purchase' ELSE 'transfer' END,true,coalesce(auth.jwt()->>'email',''),coalesce(v_after->>'sourceWarehouseId','main'),v_after->>'destWarehouseId',v_after->>'destType',v_after->>'custodianName',v_after->>'sourceItemId',v_after->'inventoryEffects',nullif(v_after->>'deletedAt','')::timestamptz,v_after->>'requestFingerprint',nullif(v_after->>'sourceQuantityBefore','')::numeric,nullif(v_after->>'sourceValueBefore','')::numeric)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,received_on=excluded.received_on,invoice_number=excluded.invoice_number,supplier=excluded.supplier,recipient=excluded.recipient,permit=excluded.permit,issued_on=excluded.issued_on,item=excluded.item,unit_price=excluded.unit_price,qty_in=excluded.qty_in,qty_out=excluded.qty_out,notes=excluded.notes,source_warehouse_id=excluded.source_warehouse_id,dest_warehouse_id=excluded.dest_warehouse_id,dest_type=excluded.dest_type,custodian_name=excluded.custodian_name,source_item_id=excluded.source_item_id,inventory_effects=excluded.inventory_effects,deleted_at=excluded.deleted_at,request_fingerprint=excluded.request_fingerprint,source_quantity_before=excluded.source_quantity_before,source_value_before=excluded.source_value_before;
  END LOOP;
  INSERT INTO public.inventory_operations(id,actor_id,kind,request,event,response) VALUES(p_operation_id,auth.uid(),p_kind,v_request,p_event,v_response);
  RETURN v_response;
END $$;
REVOKE ALL ON FUNCTION public.apply_inventory_operation(uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_operation(uuid,text,jsonb,jsonb,jsonb) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
