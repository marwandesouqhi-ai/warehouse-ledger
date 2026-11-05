-- Explicit department role matrix. No business rows are deleted.
-- system_admin retains full business access. Legacy extra grants do not override roles.
CREATE OR REPLACE FUNCTION public.app_effective_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.is_system_admin() THEN 'system_admin'
    ELSE COALESCE((SELECT u.role FROM public.app_users u
      WHERE u.auth_user_id = (SELECT auth.uid()) AND u.status = 'active'
      ORDER BY u.created_at LIMIT 1), '') END;
$$;
CREATE OR REPLACE FUNCTION public.role_can_read_department(p_role text, p_department text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT p_role IN ('system_admin','admin','viewer')
 OR (p_department = 'warehouse' AND p_role IN ('warehouse_admin','warehouse_employee','warehouse_staff','editor'))
 OR (p_department = 'procurement' AND p_role IN ('procurement_admin','procurement_employee','purchasing_staff'));
$$;
CREATE OR REPLACE FUNCTION public.role_can_add_department(p_role text, p_department text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT p_role = 'system_admin'
 OR (p_department = 'warehouse' AND p_role IN ('warehouse_employee','warehouse_staff','editor'))
 OR (p_department = 'procurement' AND p_role IN ('procurement_employee','purchasing_staff'));
$$;
CREATE OR REPLACE FUNCTION public.app_can_read_department(p_department text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT public.role_can_read_department(public.app_effective_role(), p_department);
$$;
CREATE OR REPLACE FUNCTION public.app_can_add_department(p_department text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT public.role_can_add_department(public.app_effective_role(), p_department);
$$;
CREATE OR REPLACE FUNCTION public.app_can_modify_records()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT public.app_effective_role() = 'system_admin';
$$;
CREATE OR REPLACE FUNCTION public.can_access_procurement()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT public.app_can_read_department('procurement');
$$;
-- Determine existing mixed-ledger row scope from its actual movement type.
CREATE OR REPLACE FUNCTION public.movement_department(p_kind text, p_in text, p_out text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE
 WHEN COALESCE(p_out,'') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
   AND replace(p_out,',','.')::numeric > 0 THEN 'warehouse'
 WHEN p_kind = 'purchase' THEN 'procurement'
 WHEN COALESCE(p_in,'') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
   AND replace(p_in,',','.')::numeric > 0 THEN 'procurement'
 ELSE 'warehouse' END;
$$;
DO $$
DECLARE f regprocedure;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
 'app_effective_role','role_can_read_department','role_can_add_department',
 'app_can_read_department','app_can_add_department','app_can_modify_records','movement_department','can_access_procurement')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',f);
 END LOOP;
END $$;

-- Creation commands may update derived stock internally, never arbitrary client rows.
CREATE OR REPLACE FUNCTION public.record_purchase(p_fingerprint text, p_item text, p_qty numeric, p_unit_price numeric DEFAULT 0, p_supplier text DEFAULT ''::text, p_notes text DEFAULT ''::text, p_created_by text DEFAULT ''::text, p_received_on text DEFAULT NULL::text, p_invoice_number text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_email TEXT;
  v_jwt_username TEXT;
  v_jwt_creator TEXT;
  v_existing_id UUID;
  v_movement_uuid UUID;
  v_received_on TEXT;
  v_clean_item TEXT;
  v_clean_supplier TEXT;
  v_clean_notes TEXT;
  v_custody_id TEXT;
  v_current_qty NUMERIC;
BEGIN
  -- 1. التحقق من صلاحيات المنادي (System Admin, Admin, Purchasing Staff, or manage_records)
  v_caller_role := public.app_role();
  v_caller_email := LOWER(COALESCE(auth.jwt()->>'email', ''));
  v_jwt_username := COALESCE(auth.jwt()->'app_metadata'->>'username', '');

  IF NOT public.app_can_add_department('procurement') THEN
    RAISE EXCEPTION 'Purchase creation denied' USING ERRCODE = '42501';
  END IF;
  IF p_unit_price < 0 OR length(COALESCE(p_fingerprint,'')) > 512 THEN
    RAISE EXCEPTION 'Invalid purchase';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stock:' || lower(trim(p_item)),0));

  -- 2. التحقق من صحة المدخلات
  v_clean_item := TRIM(COALESCE(p_item, ''));
  v_clean_supplier := TRIM(COALESCE(p_supplier, ''));
  v_clean_notes := TRIM(COALESCE(p_notes, ''));

  IF v_clean_item = '' OR p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'بيانات الفاتورة غير صالحة: يجب تحديد الصنف وكمية أكبر من صفر.';
  END IF;

  -- تحديد منشئ الحركة من الـ JWT حصراً لمنع التزوير
  IF v_jwt_username != '' THEN
    v_jwt_creator := v_jwt_username;
  ELSIF v_caller_email != '' THEN
    v_jwt_creator := v_caller_email;
  ELSE
    v_jwt_creator := 'purchasing_staff';
  END IF;

  v_received_on := COALESCE(NULLIF(TRIM(p_received_on), ''), to_char(now(), 'YYYY-MM-DD'));

  IF EXISTS (SELECT 1 FROM public.movements WHERE fingerprint=p_fingerprint
    AND (kind IS DISTINCT FROM 'purchase' OR owner_id IS DISTINCT FROM (SELECT auth.uid()))) THEN
    RAISE EXCEPTION 'Fingerprint belongs to a different command' USING ERRCODE='42501';
  END IF;
  -- 3. الفحص الأولي للبصمة التكرارية (Idempotency)
  IF p_fingerprint IS NOT NULL AND p_fingerprint != '' THEN
    SELECT id INTO v_existing_id
    FROM public.movements
    WHERE fingerprint = p_fingerprint AND kind='purchase' AND owner_id=(SELECT auth.uid())
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_existed', true,
        'movement_id', v_existing_id::text,
        'message', 'فاتورة مسجلة مسبقاً (تم تخطي التكرار بأمان)'
      );
    END IF;
  END IF;

  -- 4. إدخال الحركة في movements مع معالجة السباق بـ ON CONFLICT (fingerprint) DO NOTHING
  INSERT INTO public.movements (
    id,
    received_on,
    invoice_number,
    supplier,
    recipient,
    permit,
    issued_on,
    item,
    unit_price,
    qty_in,
    qty_out,
    notes,
    fingerprint,
    kind,
    custody_applied,
    created_by,
    source_warehouse_id,
    dest_type,
    owner_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_received_on,
    COALESCE(p_invoice_number, ''),
    v_clean_supplier,
    '',
    '',
    '',
    v_clean_item,
    COALESCE(p_unit_price, 0)::text,
    p_qty::text,
    '0',
    v_clean_notes,
    p_fingerprint,
    'purchase',
    true,
    v_jwt_creator,
    'main',
    'warehouse',
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    now()
  )
  ON CONFLICT (fingerprint) DO NOTHING
  RETURNING id INTO v_movement_uuid;

  -- إذا كان هناك تداخل سباق متزامن وأدخلت بالفعل
  IF v_movement_uuid IS NULL THEN
    SELECT id INTO v_existing_id
    FROM public.movements
    WHERE fingerprint = p_fingerprint AND kind='purchase' AND owner_id=(SELECT auth.uid())
    LIMIT 1;

    IF v_existing_id IS NULL THEN RAISE EXCEPTION 'Fingerprint collision' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object(
      'success', true,
      'already_existed', true,
      'movement_id', v_existing_id::text,
      'message', 'فاتورة مسجلة مسبقاً (تم تخطي التكرار بأمان)'
    );
  END IF;

  -- 5. تحديث رصيد المخزن الرئيسي في custody_items مع قفل الصف FOR UPDATE لمنع التزامن
  SELECT id, quantity INTO v_custody_id, v_current_qty
  FROM public.custody_items
  WHERE warehouse_id = 'main' AND name = v_clean_item
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.custody_items
    SET 
      quantity = quantity + p_qty,
      unit_price = CASE WHEN p_unit_price > 0 THEN p_unit_price ELSE unit_price END,
      value = (quantity + p_qty) * (CASE WHEN p_unit_price > 0 THEN p_unit_price ELSE COALESCE(unit_price, 0) END),
      updated_at = now()
    WHERE id = v_custody_id;
  ELSE
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
      created_at,
      updated_at
    ) VALUES (
      'cst-' || floor(extract(epoch from now()) * 1000)::text || '-' || floor(random() * 1000)::text,
      'main',
      '',
      v_clean_item,
      'أصناف واردة',
      p_qty,
      'قطعة',
      p_unit_price,
      (p_qty * COALESCE(p_unit_price, 0)),
      'good',
      '',
      '',
      '',
      'أضيف تلقائياً من فاتورة شراء واردة',
      'permanent',
      now(),
      now()
    );
  END IF;

  -- 6. توثيق العملية في سجل التدقيق audit_logs (مع استخدام auth.uid() كـ FK صالح أو NULL دون أصفار وهمية)
  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    v_caller_email,
    'تسجيل فاتورة شراء وزيادة رصيد المخزن الرئيسي: ' || v_clean_item,
    'purchase_invoice',
    v_movement_uuid::text,
    jsonb_build_object(
      'item', v_clean_item,
      'quantity', p_qty,
      'unit_price', p_unit_price,
      'fingerprint', p_fingerprint,
      'supplier', v_clean_supplier,
      'invoice_number', p_invoice_number,
      'received_on', v_received_on,
      'created_by', v_jwt_creator
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'movement_id', v_movement_uuid::text,
    'message', 'تم تسجيل الفاتورة وتحديث رصيد المخزن الرئيسي بنجاح.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_purchase(text,text,numeric,numeric,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_purchase(text,text,numeric,numeric,text,text,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_purchase_order(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_quote RECORD;
  v_req RECORD;
  v_existing_po RECORD;
  v_po_id UUID;
  v_po_no TEXT;
  v_delivery_date DATE;
  v_caller_id TEXT;
  v_caller_name TEXT;
BEGIN
  IF NOT public.app_can_add_department('procurement') THEN
    RAISE EXCEPTION 'غير مصرح لك بإنشاء أوامر الشراء.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('quote:' || p_quote_id::text,0));
  -- Check if PO already created for this quote (idempotent)
  SELECT * INTO v_existing_po FROM public.purchase_orders WHERE quote_id = p_quote_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'po_id', v_existing_po.id, 'po_no', v_existing_po.po_no, 'idempotent', true);
  END IF;

  SELECT q.*, s.status AS supplier_status, s.name AS supplier_name
  INTO v_quote
  FROM public.supplier_quotes q
  JOIN public.suppliers s ON s.id = q.supplier_id
  WHERE q.id = p_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'عرض السعر غير موجود.';
  END IF;

  IF v_quote.supplier_status = 'suspended' THEN
    RAISE EXCEPTION 'لا يمكن إصدار أمر شراء لمورد موقوف (%s).', v_quote.supplier_name;
  END IF;

  IF NOT v_quote.is_selected THEN
    RAISE EXCEPTION 'يجب اعتماد واختيار عرض السعر أولاً قبل إصدار أمر الشراء.';
  END IF;

  SELECT * INTO v_req FROM public.purchase_requests WHERE id = v_quote.request_id FOR UPDATE;
  IF v_req.status != 'approved' THEN
    RAISE EXCEPTION 'لا يمكن إصدار أمر شراء لطلب لم يتم اعتماده نهائياً.';
  END IF;

  v_delivery_date := CURRENT_DATE + (v_quote.delivery_days || ' days')::INTERVAL;
  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');
  v_caller_name := COALESCE(auth.jwt()->'app_metadata'->>'username', auth.jwt()->>'email', 'موظف مشتريات');

  INSERT INTO public.purchase_orders (
    request_id,
    quote_id,
    supplier_id,
    total,
    expected_delivery_date,
    status,
    notes,
    created_by
  )
  VALUES (
    v_quote.request_id,
    p_quote_id,
    v_quote.supplier_id,
    v_quote.total_price,
    v_delivery_date,
    'open',
    'أمر شراء صادر بناءً على طلب ' || v_req.request_no,
    v_caller_name
  )
  RETURNING id, po_no INTO v_po_id, v_po_no;

  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'CREATE_PURCHASE_ORDER',
    'purchase_order',
    v_po_id::TEXT,
    jsonb_build_object('po_no', v_po_no, 'request_no', v_req.request_no, 'supplier_id', v_quote.supplier_id, 'total', v_quote.total_price)
  );

  RETURN jsonb_build_object('success', true, 'po_id', v_po_id, 'po_no', v_po_no, 'idempotent', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_warehouse_issue(p_movement jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_source public.custody_items%ROWTYPE;
 v_dest public.custody_items%ROWTYPE;
 v_saved public.movements%ROWTYPE;
 v_qty numeric; v_price numeric; v_fp text; v_source_id text; v_dest_id text;
 v_dest_type text; v_item text; v_dest_warehouse text;
BEGIN
 IF NOT public.app_can_add_department('warehouse') THEN
  RAISE EXCEPTION 'Warehouse creation denied' USING ERRCODE='42501';
 END IF;
 v_qty := (p_movement->>'qty_out')::numeric;
 v_fp := trim(COALESCE(p_movement->>'fingerprint',''));
 v_item := trim(COALESCE(p_movement->>'item',''));
 v_source_id := COALESCE(NULLIF(p_movement->>'source_warehouse_id',''),'main');
 v_dest_type := COALESCE(NULLIF(p_movement->>'dest_type',''),'custodian');
 v_dest_warehouse := NULLIF(p_movement->>'dest_warehouse_id','');
 IF v_qty IS NULL OR v_qty<=0 OR v_fp='' OR length(v_fp)>512 OR v_item=''
  OR v_dest_type NOT IN ('warehouse','custodian') THEN RAISE EXCEPTION 'Invalid warehouse issue'; END IF;
 IF COALESCE(p_movement->>'qty_in','0') NOT IN ('','0','0.0') THEN RAISE EXCEPTION 'Issue cannot contain a receipt'; END IF;
 IF v_dest_type='warehouse' AND (v_dest_warehouse IS NULL OR v_dest_warehouse=v_source_id) THEN
  RAISE EXCEPTION 'Invalid destination warehouse';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('issue:'||v_fp,0));
 SELECT * INTO v_saved FROM public.movements WHERE fingerprint=v_fp;
 IF FOUND THEN
  IF v_saved.kind IS DISTINCT FROM 'issue' OR v_saved.owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
   RAISE EXCEPTION 'Fingerprint belongs to a different command' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('movement',to_jsonb(v_saved),'already_existed',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock:'||lower(v_item),0));
 -- Lock both sides in a stable order to avoid opposing-transfer deadlocks.
 PERFORM 1 FROM public.custody_items
 WHERE lower(trim(name))=lower(v_item) AND warehouse_id IN (v_source_id,v_dest_warehouse)
 ORDER BY id FOR UPDATE;
 SELECT * INTO v_source FROM public.custody_items
 WHERE warehouse_id=v_source_id AND lower(trim(name))=lower(v_item)
  AND (NULLIF(p_movement->>'source_custody_id','') IS NULL OR id=p_movement->>'source_custody_id') ORDER BY id LIMIT 1;
 IF NOT FOUND OR v_source.quantity<v_qty THEN RAISE EXCEPTION 'Insufficient warehouse stock'; END IF;
 v_price := COALESCE(v_source.unit_price,CASE WHEN v_source.quantity>0 THEN v_source.value/v_source.quantity ELSE 0 END,0);
 UPDATE public.custody_items SET quantity=quantity-v_qty,
  value=GREATEST(0,value-v_qty*v_price),updated_at=now() WHERE id=v_source.id;
 IF v_dest_type='warehouse' THEN
  SELECT * INTO v_dest FROM public.custody_items
   WHERE warehouse_id=v_dest_warehouse AND lower(trim(name))=lower(v_item) ORDER BY id LIMIT 1;
  IF FOUND THEN
   UPDATE public.custody_items SET quantity=quantity+v_qty,value=value+v_qty*v_price,updated_at=now() WHERE id=v_dest.id;
  ELSE
   v_dest_id:='transfer-'||gen_random_uuid()::text;
   INSERT INTO public.custody_items(id,warehouse_id,code,name,category,quantity,unit,unit_price,value,
     condition,custodian,room_location,notes,custody_type)
   VALUES(v_dest_id,v_dest_warehouse,v_dest_id,v_source.name,v_source.category,v_qty,v_source.unit,
     v_price,v_qty*v_price,v_source.condition,COALESCE(p_movement->>'custodian_name',''),COALESCE(p_movement->>'new_location',''),COALESCE(p_movement->>'notes',''),v_source.custody_type);
  END IF;
 END IF;
 INSERT INTO public.movements(owner_id,received_on,invoice_number,supplier,recipient,permit,issued_on,
   item,unit_price,qty_in,qty_out,notes,fingerprint,kind,custody_applied,created_by,
   source_warehouse_id,dest_warehouse_id,dest_type,custodian_name)
 VALUES((SELECT auth.uid()),COALESCE(p_movement->>'received_on',''),
   COALESCE(p_movement->>'invoice_number',''),'',COALESCE(p_movement->>'recipient',''),
   COALESCE(p_movement->>'permit',''),COALESCE(p_movement->>'issued_on',''),
   v_item,v_price::text,'0',v_qty::text,COALESCE(p_movement->>'notes',''),v_fp,'issue',true,
   COALESCE(auth.jwt()->'app_metadata'->>'username',auth.jwt()->>'email',''),
   v_source_id,v_dest_warehouse,v_dest_type,COALESCE(p_movement->>'custodian_name',''))
 RETURNING * INTO v_saved;
 RETURN jsonb_build_object('movement',to_jsonb(v_saved),'already_existed',false);
END $$;
REVOKE ALL ON FUNCTION public.record_warehouse_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_warehouse_issue(jsonb) TO authenticated;

-- Settings writes remain exclusive to the system role even if older permissive policies remain.
CREATE POLICY role_settings_insert ON public.app_settings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.app_can_modify_records());
CREATE POLICY role_settings_update ON public.app_settings AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.app_can_modify_records()) WITH CHECK(public.app_can_modify_records());
CREATE POLICY role_settings_delete ON public.app_settings AS RESTRICTIVE FOR DELETE TO authenticated USING(public.app_can_modify_records());
-- User-specific records do not expose other users through direct REST.
CREATE POLICY role_notifications_scope ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated USING(public.app_can_modify_records() OR user_id=(SELECT auth.uid()));
CREATE POLICY role_support_scope ON public.support_tickets AS RESTRICTIVE FOR SELECT TO authenticated USING(public.app_can_modify_records() OR user_id=(SELECT auth.uid()));
CREATE POLICY role_support_insert ON public.support_tickets AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(public.app_can_modify_records() OR (user_id=(SELECT auth.uid()) AND status='مفتوحة'
 AND (public.app_can_add_department('warehouse') OR public.app_can_add_department('procurement'))));
CREATE POLICY role_support_update ON public.support_tickets AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.app_can_modify_records()) WITH CHECK(public.app_can_modify_records());
CREATE POLICY role_support_delete ON public.support_tickets AS RESTRICTIVE FOR DELETE TO authenticated USING(public.app_can_modify_records());


-- Generic business policies: all read/write decisions use the active database role.
DO $$
DECLARE t text; dept text; pol record;
BEGIN
 FOREACH t IN ARRAY ARRAY['custody_items','asset_movement_log','technical_inspections',
  'inventory_settlements','inventory_analytics_snapshots','disbursement_requests',
  'suppliers','supplier_contracts','purchase_requests','purchase_request_items',
  'purchase_request_approvals','supplier_quotes','purchase_orders']
 LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  dept := CASE WHEN t IN ('custody_items','asset_movement_log','technical_inspections',
   'inventory_settlements','inventory_analytics_snapshots','disbursement_requests')
   THEN 'warehouse' ELSE 'procurement' END;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
  LOOP EXECUTE format('DROP POLICY %I ON public.%I',pol.policyname,t); END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY role_read ON public.%I FOR SELECT TO authenticated USING (public.app_can_read_department(%L))',t,dept);
  EXECUTE format('CREATE POLICY role_update ON public.%I FOR UPDATE TO authenticated USING (public.app_can_modify_records()) WITH CHECK (public.app_can_modify_records())',t);
  EXECUTE format('CREATE POLICY role_delete ON public.%I FOR DELETE TO authenticated USING (public.app_can_modify_records())',t);
  IF t IN ('purchase_request_approvals','purchase_orders') THEN
   EXECUTE format('CREATE POLICY role_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_can_modify_records())',t);
  ELSIF t='disbursement_requests' THEN
   EXECUTE 'CREATE POLICY role_insert ON public.disbursement_requests FOR INSERT TO authenticated
    WITH CHECK (public.app_can_modify_records() OR (public.app_can_add_department(''warehouse'')
    AND created_by=(SELECT auth.uid()) AND status=''pending'' AND approved_by IS NULL
    AND approved_at IS NULL AND issued_at IS NULL AND rejection_reason IS NULL))';
  ELSIF t='purchase_requests' THEN
   EXECUTE 'CREATE POLICY role_insert ON public.purchase_requests FOR INSERT TO authenticated
    WITH CHECK (public.app_can_modify_records() OR (public.app_can_add_department(''procurement'')
    AND status=''draft'' AND created_by_id=(SELECT auth.uid())
    AND selected_quote_id IS NULL AND submitted_at IS NULL))';
  ELSIF t='purchase_request_items' THEN
   EXECUTE 'CREATE POLICY role_insert ON public.purchase_request_items FOR INSERT TO authenticated
    WITH CHECK (public.app_can_modify_records() OR (public.app_can_add_department(''procurement'')
    AND EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id=request_id
      AND r.created_by_id=(SELECT auth.uid()) AND r.status=''draft'')))';
  ELSIF t='supplier_quotes' THEN
   EXECUTE 'CREATE POLICY role_insert ON public.supplier_quotes FOR INSERT TO authenticated
    WITH CHECK (public.app_can_modify_records() OR (public.app_can_add_department(''procurement'') AND NOT is_selected))';
  ELSE
   EXECUTE format('CREATE POLICY role_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_can_add_department(%L))',t,dept);
  END IF;
 END LOOP;
END $$;

-- Ledger scope is evaluated server-side; clients cannot choose a department tag.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='movements'
 LOOP EXECUTE format('DROP POLICY %I ON public.movements',p.policyname); END LOOP;
END $$;
REVOKE ALL ON public.movements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements TO authenticated;
CREATE POLICY role_read ON public.movements FOR SELECT TO authenticated
 USING (public.app_can_read_department(public.movement_department(kind,qty_in,qty_out)));
CREATE POLICY role_insert ON public.movements FOR INSERT TO authenticated
 WITH CHECK (public.app_can_modify_records());
CREATE POLICY role_update ON public.movements FOR UPDATE TO authenticated
 USING (public.app_can_modify_records()) WITH CHECK (public.app_can_modify_records());
CREATE POLICY role_delete ON public.movements FOR DELETE TO authenticated USING (public.app_can_modify_records());

-- Legacy cross-department aggregate reports are visible only to global readers.
-- Newly added reports/budgets get their department from the active profile.
ALTER TABLE public.budget_plans ADD COLUMN IF NOT EXISTS access_department text NOT NULL DEFAULT 'all'
 CHECK (access_department IN ('all','warehouse','procurement'));
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS access_department text NOT NULL DEFAULT 'all'
 CHECK (access_department IN ('all','warehouse','procurement'));
CREATE OR REPLACE FUNCTION public.stamp_business_department()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE r text := public.app_effective_role();
BEGIN
 IF r IN ('warehouse_employee','warehouse_staff','editor') THEN NEW.access_department := 'warehouse';
 ELSIF r IN ('procurement_employee','purchasing_staff') THEN NEW.access_department := 'procurement';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; p record; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_plans','financial_reports'] LOOP
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
  LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
  EXECUTE format('DROP TRIGGER IF EXISTS stamp_business_department ON public.%I',t);
  EXECUTE format('CREATE TRIGGER stamp_business_department BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_business_department()',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY role_read ON public.%I FOR SELECT TO authenticated USING (public.app_effective_role() IN (''system_admin'',''admin'',''viewer'') OR public.app_can_read_department(access_department))',t);
  EXECUTE format('CREATE POLICY role_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_can_modify_records() OR public.app_can_add_department(access_department))',t);
  EXECUTE format('CREATE POLICY role_update ON public.%I FOR UPDATE TO authenticated USING (public.app_can_modify_records()) WITH CHECK (public.app_can_modify_records())',t);
  EXECUTE format('CREATE POLICY role_delete ON public.%I FOR DELETE TO authenticated USING (public.app_can_modify_records())',t);
 END LOOP;
END $$;

-- System pages and other people's accounts are never granted by a department role.
DO $$ DECLARE t text; p record; BEGIN
 FOREACH t IN ARRAY ARRAY['registration_requests','registration_approval_settings','employee_code_registry',
   'user_invitations','telegram_bot_settings','telegram_user_sessions','telegram_rate_events',
   'telegram_processed_updates','system_bootstrap_state','system_backup_snapshots']
 LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
  LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
  EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);
  EXECUTE format('CREATE POLICY role_system_only ON public.%I FOR ALL TO authenticated USING (public.app_can_modify_records()) WITH CHECK (public.app_can_modify_records())',t);
 END LOOP;
 -- A restrictive policy intersects with existing profile rules/column privileges.
 DROP POLICY IF EXISTS role_self_profile ON public.app_users;
 CREATE POLICY role_self_profile ON public.app_users AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.app_can_modify_records() OR auth_user_id=(SELECT auth.uid()));
END $$;
ALTER VIEW public.registration_requests_admin_view SET (security_invoker = true);
ALTER VIEW public.safe_app_users SET (security_invoker = true);
ALTER VIEW public.supplier_stats SET (security_invoker = true);
REVOKE ALL ON public.registration_requests_admin_view, public.safe_app_users FROM anon;
-- Self profile remains available, directory management goes through system-only Edge.
GRANT SELECT ON public.safe_app_users TO authenticated;

-- Intersect every existing storage policy with the role matrix.
CREATE POLICY role_storage_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING (CASE WHEN bucket_id='procurement-attachments' THEN public.app_can_read_department('procurement')
   WHEN bucket_id='support-attachments' THEN public.app_can_modify_records() OR owner_id=(SELECT auth.uid())::text
   ELSE true END);
CREATE POLICY role_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (CASE WHEN bucket_id='procurement-attachments' THEN public.app_can_add_department('procurement')
   WHEN bucket_id='support-attachments' THEN public.app_can_add_department('warehouse') OR public.app_can_add_department('procurement')
   ELSE true END);
CREATE POLICY role_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (CASE WHEN bucket_id IN ('procurement-attachments','support-attachments') THEN public.app_can_modify_records() ELSE true END)
 WITH CHECK (CASE WHEN bucket_id IN ('procurement-attachments','support-attachments') THEN public.app_can_modify_records() ELSE true END);
CREATE POLICY role_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (CASE WHEN bucket_id IN ('procurement-attachments','support-attachments') THEN public.app_can_modify_records() ELSE true END);
DROP POLICY IF EXISTS "Allow upload for support attachments" ON storage.objects;
CREATE POLICY support_authenticated_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='support-attachments'
  AND (public.app_can_add_department('warehouse') OR public.app_can_add_department('procurement')));

-- Mutating procurement state transitions are reserved to the system administrator.
DO $$ DECLARE f record; def text; BEGIN
 FOR f IN SELECT p.oid, p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('submit_purchase_request','record_approval','select_quote','mark_po_received','mark_po_invoiced')
 LOOP
  def := pg_get_functiondef(f.oid);
  def := regexp_replace(def, '\yBEGIN\y', E'BEGIN\n  IF NOT public.app_can_modify_records() THEN RAISE EXCEPTION ''Operation requires system administrator'' USING ERRCODE = ''42501''; END IF;\n', 'i');
  EXECUTE def;
 END LOOP;
 -- Any optional privileged import RPC is system-only, not an anonymous capability.
 FOR f IN SELECT p.oid, p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='import_custody_batch'
 LOOP
  def := regexp_replace(pg_get_functiondef(f.oid), '\yBEGIN\y', E'BEGIN\n IF NOT public.app_can_modify_records() THEN RAISE EXCEPTION ''System administrator required'' USING ERRCODE=''42501''; END IF;\n', 'i');
  EXECUTE def;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $$;


-- Profile column-level grants must also be revoked for anonymous callers.
DO $$ DECLARE cols text; BEGIN
 SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.columns
 WHERE table_schema='public' AND table_name='app_users';
 EXECUTE format('REVOKE SELECT (%s) ON public.app_users FROM anon',cols);
END $$;
CREATE POLICY role_profile_insert ON public.app_users AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.app_can_modify_records());
CREATE POLICY role_profile_update ON public.app_users AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.app_can_modify_records()) WITH CHECK(public.app_can_modify_records());
CREATE POLICY role_profile_delete ON public.app_users AS RESTRICTIVE FOR DELETE TO authenticated USING(public.app_can_modify_records());
CREATE POLICY role_profile_private ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING(public.app_can_modify_records() OR id=(SELECT auth.uid()));
CREATE POLICY role_members_private ON public.organization_members AS RESTRICTIVE FOR SELECT TO authenticated USING(public.app_can_modify_records() OR user_id=(SELECT auth.uid()));

CREATE POLICY role_audit_read ON public.audit_logs AS RESTRICTIVE FOR SELECT TO authenticated USING(public.app_can_modify_records());
REVOKE ALL ON public.profiles, public.organization_members FROM anon;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','organization_members','organizations'] LOOP
 EXECUTE format('CREATE POLICY role_identity_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.app_can_modify_records())',t);
 EXECUTE format('CREATE POLICY role_identity_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.app_can_modify_records()) WITH CHECK(public.app_can_modify_records())',t);
 EXECUTE format('CREATE POLICY role_identity_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(public.app_can_modify_records())',t);
 END LOOP;
END $$;
