-- ==============================================================================
-- Migration: 20261014130000_fix_record_purchase_rpc.sql
-- Description: Replace public.record_purchase with actual schema alignment,
--              UUID primary key, received_on date column, row-locking (FOR UPDATE)
--              on custody_items, JWT identity enforcement, and race-safe ON CONFLICT.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.record_purchase(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_purchase;

CREATE OR REPLACE FUNCTION public.record_purchase(
  p_fingerprint TEXT,
  p_item TEXT,
  p_qty NUMERIC,
  p_unit_price NUMERIC DEFAULT 0,
  p_supplier TEXT DEFAULT '',
  p_notes TEXT DEFAULT '',
  p_created_by TEXT DEFAULT '',
  p_received_on TEXT DEFAULT NULL,
  p_invoice_number TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  IF v_caller_role NOT IN ('system_admin', 'admin', 'purchasing_staff') 
     AND NOT public.has_permission('manage_records') THEN
    RAISE EXCEPTION 'غير مصرح: تسجيل فواتير الشراء مقتصر على موظف المشتريات وإدارة النظام.';
  END IF;

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

  -- 3. الفحص الأولي للبصمة التكرارية (Idempotency)
  IF p_fingerprint IS NOT NULL AND p_fingerprint != '' THEN
    SELECT id INTO v_existing_id
    FROM public.movements
    WHERE fingerprint = p_fingerprint
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
    WHERE fingerprint = p_fingerprint
    LIMIT 1;

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
$$;

GRANT EXECUTE ON FUNCTION public.record_purchase TO authenticated;
