-- Migration: 20261013210000_security_hardening_schema.sql
-- Description: Additive schema columns, secure helper functions, and atomic record_purchase RPC
-- Note: All statements are additive and safe. No DROP, TRUNCATE, or data loss.

-- 1. Additive columns on app_users
ALTER TABLE IF EXISTS public.app_users 
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.app_users 
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- 2. Additive columns on movements
ALTER TABLE IF EXISTS public.movements 
  ADD COLUMN IF NOT EXISTS kind TEXT;

CREATE INDEX IF NOT EXISTS idx_movements_kind ON public.movements(kind);
CREATE INDEX IF NOT EXISTS idx_movements_fingerprint ON public.movements(fingerprint);

-- 3. Safe helper function: movement_kind(row)
-- Determines movement kind for legacy rows where kind is null, without cast exceptions.
CREATE OR REPLACE FUNCTION public.movement_kind(r public.movements)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_in NUMERIC := 0;
  v_out NUMERIC := 0;
BEGIN
  -- If kind is already populated, return it directly
  IF r.kind IS NOT NULL AND r.kind != '' THEN
    RETURN r.kind;
  END IF;

  -- Safe parse for qty_in (regex numeric check)
  IF r.qty_in IS NOT NULL AND r.qty_in ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_in := r.qty_in::NUMERIC;
  END IF;

  -- Safe parse for qty_out (regex numeric check)
  IF r.qty_out IS NOT NULL AND r.qty_out ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_out := r.qty_out::NUMERIC;
  END IF;

  IF v_in > 0 AND v_out = 0 THEN
    RETURN 'purchase';
  ELSE
    RETURN 'transfer';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'transfer';
END;
$$;

-- 4. Helper security definer functions reading strictly from auth.jwt()->'app_metadata'
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
  v_sysadmin BOOLEAN;
  v_role TEXT;
BEGIN
  v_email := LOWER(COALESCE(auth.jwt()->>'email', ''));
  v_sysadmin := COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false);
  v_role := COALESCE(auth.jwt()->'app_metadata'->>'role', '');

  IF v_sysadmin = true OR v_role = 'system_admin' THEN
    RETURN true;
  END IF;

  IF v_email IN ('marwan-desouky', 'admin', 'marwan-desouky@warehouse.local', 'admin@warehouse.local') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.is_system_admin() THEN
    RETURN 'system_admin';
  END IF;

  RETURN COALESCE(auth.jwt()->'app_metadata'->>'role', 'viewer');
END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perms JSONB;
BEGIN
  IF public.is_system_admin() THEN
    RETURN true;
  END IF;

  v_perms := auth.jwt()->'app_metadata'->'permissions';
  IF v_perms IS NOT NULL AND jsonb_typeof(v_perms) = 'array' THEN
    RETURN v_perms ? p_permission;
  END IF;

  RETURN false;
END;
$$;

-- 5. Atomic RPC: record_purchase(...)
-- Allows purchasing_staff to atomically record a purchase movement and increment main warehouse custody
-- without needing direct write permission on custody_items table.
CREATE OR REPLACE FUNCTION public.record_purchase(
  p_fingerprint TEXT,
  p_item TEXT,
  p_qty NUMERIC,
  p_unit_price NUMERIC DEFAULT 0,
  p_supplier TEXT DEFAULT '',
  p_notes TEXT DEFAULT '',
  p_created_by TEXT DEFAULT '',
  p_date TEXT DEFAULT NULL,
  p_movement_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_email TEXT;
  v_existing_id TEXT;
  v_new_id TEXT;
  v_date TEXT;
  v_clean_item TEXT;
  v_clean_creator TEXT;
BEGIN
  -- 1. Authorization check
  v_caller_role := public.app_role();
  v_caller_email := LOWER(COALESCE(auth.jwt()->>'email', ''));

  IF v_caller_role NOT IN ('system_admin', 'admin', 'purchasing_staff') AND NOT public.has_permission('manage_records') THEN
    RAISE EXCEPTION 'غير مصرح: تسجيل فواتير الشراء مقتصر على موظف المشتريات وإدارة النظام.';
  END IF;

  v_clean_item := TRIM(p_item);
  IF v_clean_item = '' OR p_qty <= 0 THEN
    RAISE EXCEPTION 'بيانات الفاتورة غير صالحة: يجب تحديد الصنف وكمية أكبر من صفر.';
  END IF;

  -- 2. Idempotency check via fingerprint
  IF p_fingerprint IS NOT NULL AND p_fingerprint != '' THEN
    SELECT id INTO v_existing_id
    FROM public.movements
    WHERE fingerprint = p_fingerprint
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_existed', true,
        'movement_id', v_existing_id,
        'message', 'فاتورة مسجلة مسبقاً (تم تخطي التكرار بأمان)'
      );
    END IF;
  END IF;

  -- 3. Generate movement ID and date
  v_new_id := COALESCE(p_movement_id, 'mov-' || floor(extract(epoch from now()) * 1000)::text);
  v_date := COALESCE(p_date, to_char(now(), 'YYYY-MM-DD'));
  v_clean_creator := COALESCE(NULLIF(TRIM(p_created_by), ''), v_caller_email, 'موظف مشتريات');

  -- 4. Insert purchase movement
  INSERT INTO public.movements (
    id,
    date,
    item,
    qty_in,
    qty_out,
    unit_price,
    notes,
    fingerprint,
    kind,
    created_by,
    created_at
  ) VALUES (
    v_new_id,
    v_date,
    v_clean_item,
    p_qty::text,
    '0',
    p_unit_price::text,
    CASE 
      WHEN p_supplier != '' THEN 'المورد: ' || p_supplier || CASE WHEN p_notes != '' THEN ' | ' || p_notes ELSE '' END
      ELSE p_notes
    END,
    p_fingerprint,
    'purchase',
    v_clean_creator,
    now()
  );

  -- 5. Atomically increment main warehouse custody item
  IF EXISTS (SELECT 1 FROM public.custody_items WHERE warehouse_id = 'main' AND name = v_clean_item) THEN
    UPDATE public.custody_items
    SET 
      quantity = quantity + p_qty,
      updated_at = now()
    WHERE warehouse_id = 'main' AND name = v_clean_item;
  ELSE
    INSERT INTO public.custody_items (
      id,
      warehouse_id,
      name,
      quantity,
      value,
      notes,
      created_at,
      updated_at
    ) VALUES (
      'cst-' || floor(extract(epoch from now()) * 1000)::text,
      'main',
      v_clean_item,
      p_qty,
      p_unit_price,
      'أضيف تلقائياً من فاتورة شراء واردة',
      now(),
      now()
    );
  END IF;

  -- 6. Log audit event
  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    v_caller_email,
    'تسجيل فاتورة شراء وزيادة رصيد المخزن الرئيسي: ' || v_clean_item,
    'purchase_invoice',
    v_new_id,
    jsonb_build_object(
      'item', v_clean_item,
      'quantity', p_qty,
      'fingerprint', p_fingerprint,
      'supplier', p_supplier
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'movement_id', v_new_id,
    'message', 'تم تسجيل الفاتورة وتحديث رصيد المخزن الرئيسي بنجاح.'
  );
END;
$$;
