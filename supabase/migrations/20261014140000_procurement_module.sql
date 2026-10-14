-- Migration: 20261014140000_procurement_module.sql
-- Description: Complete procurement module schema, sequence generators, Arabic normalization,
--              idempotent seeding from movements, supplier_stats view, RLS policies, and atomic RPCs.
-- Safety: Fully additive. No DROP or TRUNCATE. Existing movements, custody_items, users remain untouched.

-- 1. Helper function: normalize_arabic_name(text)
CREATE OR REPLACE FUNCTION public.normalize_arabic_name(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_normalized TEXT;
BEGIN
  IF p_text IS NULL THEN
    RETURN '';
  END IF;

  v_normalized := TRIM(p_text);
  -- Remove tashkeel / harakat
  v_normalized := regexp_replace(v_normalized, '[\u064B-\u065F\u0670]', '', 'g');
  -- Remove tatweel
  v_normalized := regexp_replace(v_normalized, 'ـ', '', 'g');
  -- Normalize alef variants (أ, إ, آ, ٱ -> ا)
  v_normalized := regexp_replace(v_normalized, '[أإآٱ]', 'ا', 'g');
  -- Normalize alef maksura (ى -> ي)
  v_normalized := regexp_replace(v_normalized, 'ى', 'ي', 'g');
  -- Collapse multiple spaces into single space and lowercase
  v_normalized := LOWER(regexp_replace(v_normalized, '\s+', ' ', 'g'));

  RETURN TRIM(v_normalized);
END;
$$;

-- 2. Numbering sequences and atomic generator functions (PR-0001, PO-0001)
CREATE SEQUENCE IF NOT EXISTS public.seq_purchase_request_no START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_purchase_order_no START WITH 1;

CREATE OR REPLACE FUNCTION public.next_purchase_request_no()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'PR-' || LPAD(nextval('public.seq_purchase_request_no')::TEXT, 4, '0');
$$;

CREATE OR REPLACE FUNCTION public.next_purchase_order_no()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'PO-' || LPAD(nextval('public.seq_purchase_order_no')::TEXT, 4, '0');
$$;

-- 3. Core Tables

-- 3.1 Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_key TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL DEFAULT 'عام',
  commercial_register TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'under_review' CHECK (status IN ('active', 'under_review', 'suspended')),
  rating NUMERIC NULL CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON public.suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_category ON public.suppliers(category);

-- 3.2 Purchase Requests
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT UNIQUE NOT NULL DEFAULT public.next_purchase_request_no(),
  department TEXT NOT NULL CHECK (length(trim(department)) > 0),
  purchase_type TEXT NOT NULL CHECK (purchase_type IN ('direct', 'practice', 'tender')),
  budget_line TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  needed_by DATE NULL,
  requested_by TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  quote_deadline DATE NULL,
  selected_quote_id UUID NULL,
  submitted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT '',
  created_by_id UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON public.purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_department ON public.purchase_requests(department);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_needed_by ON public.purchase_requests(needed_by);

-- 3.3 Purchase Request Items
CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL CHECK (length(trim(item_name)) > 0),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'قطعة',
  estimated_price NUMERIC NOT NULL DEFAULT 0 CHECK (estimated_price >= 0),
  custody_item_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_items_request_id ON public.purchase_request_items(request_id);

-- 3.4 Purchase Request Approvals (Append-only decisions)
CREATE TABLE IF NOT EXISTS public.purchase_request_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  step_no INT NOT NULL,
  step_name TEXT NOT NULL,
  approver_name TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pr_approval_step UNIQUE (request_id, step_no)
);

CREATE INDEX IF NOT EXISTS idx_pr_approvals_request_id ON public.purchase_request_approvals(request_id);

-- 3.5 Supplier Quotes
CREATE TABLE IF NOT EXISTS public.supplier_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  total_price NUMERIC NOT NULL CHECK (total_price >= 0),
  delivery_days INT NOT NULL CHECK (delivery_days >= 0),
  payment_terms TEXT NOT NULL DEFAULT '',
  warranty_months INT NOT NULL DEFAULT 0 CHECK (warranty_months >= 0),
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT NOT NULL DEFAULT '',
  is_selected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_request_id ON public.supplier_quotes(request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier_id ON public.supplier_quotes(supplier_id);

-- 3.6 Purchase Orders (Does not touch custody / inventory)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no TEXT UNIQUE NOT NULL DEFAULT public.next_purchase_order_no(),
  request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  total NUMERIC NOT NULL CHECK (total >= 0),
  expected_delivery_date DATE NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'invoiced', 'cancelled')),
  received_on DATE NULL,
  invoiced_on DATE NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT '',
  CONSTRAINT uq_po_quote UNIQUE (quote_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_request_id ON public.purchase_orders(request_id);

-- 4. Additive Nullable Foreign Keys on Movements
ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movements_supplier_id ON public.movements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_movements_po_id ON public.movements(purchase_order_id);

-- 5. Idempotent Seeding: Import distinct existing suppliers from movements
INSERT INTO public.suppliers (name, name_key, status, category, created_by)
SELECT DISTINCT
  TRIM(m.supplier) AS name,
  public.normalize_arabic_name(m.supplier) AS name_key,
  'active' AS status,
  'مورد عام' AS category,
  'system_migration' AS created_by
FROM public.movements m
WHERE m.supplier IS NOT NULL 
  AND TRIM(m.supplier) != ''
ON CONFLICT (name_key) DO NOTHING;

-- 6. Supplier Stats View: aggregates POs and movements (both legacy matching normalized name and new via FK)
CREATE OR REPLACE VIEW public.supplier_stats AS
SELECT
  s.id,
  s.name,
  s.name_key,
  s.category,
  s.status,
  s.rating,
  s.contact_name,
  s.phone,
  COALESCE(po_agg.po_count, 0) AS po_count,
  COALESCE(mov_agg.invoices_count, 0) AS invoices_count,
  COALESCE(mov_agg.total_spend, 0) AS total_spend
FROM public.suppliers s
LEFT JOIN (
  SELECT
    supplier_id,
    COUNT(*) AS po_count
  FROM public.purchase_orders
  GROUP BY supplier_id
) po_agg ON po_agg.supplier_id = s.id
LEFT JOIN (
  SELECT
    matched_supplier_id,
    COUNT(*) AS invoices_count,
    SUM(line_total) AS total_spend
  FROM (
    SELECT
      CASE
        WHEN m.supplier_id IS NOT NULL THEN m.supplier_id
        ELSE s_match.id
      END AS matched_supplier_id,
      CASE
        WHEN (m.qty_in ~ '^[0-9]+(\.[0-9]+)?$') AND (m.unit_price ~ '^[0-9]+(\.[0-9]+)?$')
          THEN (m.qty_in::NUMERIC * m.unit_price::NUMERIC)
        WHEN (m.qty_in ~ '^[0-9]+(\.[0-9]+)?$')
          THEN m.qty_in::NUMERIC
        ELSE 0
      END AS line_total
    FROM public.movements m
    LEFT JOIN public.suppliers s_match
      ON m.supplier_id IS NULL AND public.normalize_arabic_name(m.supplier) = s_match.name_key
    WHERE (m.supplier_id IS NOT NULL OR s_match.id IS NOT NULL)
      AND (
        m.kind = 'purchase'
        OR (m.qty_in ~ '^[0-9]+(\.[0-9]+)?$' AND m.qty_in::NUMERIC > 0)
      )
  ) sub
  WHERE matched_supplier_id IS NOT NULL
  GROUP BY matched_supplier_id
) mov_agg ON mov_agg.matched_supplier_id = s.id;

-- 7. Security Helpers for Procurement Module
CREATE OR REPLACE FUNCTION public.can_access_procurement()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF public.is_system_admin() THEN
    RETURN true;
  END IF;

  v_role := public.app_role();
  IF v_role IN ('purchasing_staff', 'admin') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 8. Atomic RPC Functions (Security Definer with Server Verification and Audit Logging)

-- 8.1 submit_purchase_request
CREATE OR REPLACE FUNCTION public.submit_purchase_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id TEXT;
  v_req RECORD;
  v_items_count INT;
BEGIN
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك بتقديم طلبات الشراء (صلاحية مقتصرة على موظفي المشتريات والإدارة).';
  END IF;

  v_caller_role := public.app_role();
  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');

  SELECT * INTO v_req FROM public.purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء المطلوب غير موجود.';
  END IF;

  IF v_req.status != 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إرسال الطلب، حالته الحالية: %', v_req.status;
  END IF;

  SELECT COUNT(*) INTO v_items_count FROM public.purchase_request_items WHERE request_id = p_request_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن تقديم طلب شراء خالي من البنود.';
  END IF;

  -- Update status to pending
  UPDATE public.purchase_requests
  SET status = 'pending',
      submitted_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  -- Initialize 4-step approval chain
  INSERT INTO public.purchase_request_approvals (request_id, step_no, step_name, decision)
  VALUES
    (p_request_id, 1, 'مدير القسم الطالب', 'pending'),
    (p_request_id, 2, 'مسؤول المشتريات', 'pending'),
    (p_request_id, 3, 'الإدارة المالية والمراجعة', 'pending'),
    (p_request_id, 4, 'لجنة البت والاعتماد النهائي', 'pending')
  ON CONFLICT (request_id, step_no) DO NOTHING;

  -- Audit log entry
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'SUBMIT_PURCHASE_REQUEST',
    'purchase_request',
    p_request_id::TEXT,
    jsonb_build_object('request_no', v_req.request_no, 'department', v_req.department, 'items_count', v_items_count)
  );

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'pending');
END;
$$;

-- 8.2 record_approval
CREATE OR REPLACE FUNCTION public.record_approval(
  p_request_id UUID,
  p_step_no INT,
  p_decision TEXT,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req RECORD;
  v_curr_approval RECORD;
  v_prev_pending_count INT;
  v_total_steps INT;
  v_approved_steps INT;
  v_caller_id TEXT;
  v_decided_by TEXT;
BEGIN
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك بتسجيل قرارات الاعتماد.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'قرار غير صالح. القرارات المقبولة: approved أو rejected.';
  END IF;

  SELECT * INTO v_req FROM public.purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء غير موجود.';
  END IF;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'لا يمكن تسجيل اعتماد لطلب غير معلق (حالته الحالية: %).', v_req.status;
  END IF;

  -- Check previous steps are already approved
  SELECT COUNT(*) INTO v_prev_pending_count
  FROM public.purchase_request_approvals
  WHERE request_id = p_request_id AND step_no < p_step_no AND decision != 'approved';

  IF v_prev_pending_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن اتخاذ قرار في الخطوة رقم % قبل اكتمال موافقة الخطوات السابقة بالترتيب.', p_step_no;
  END IF;

  SELECT * INTO v_curr_approval
  FROM public.purchase_request_approvals
  WHERE request_id = p_request_id AND step_no = p_step_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخطوة رقم % غير معرفة في مسار هذا الطلب.', p_step_no;
  END IF;

  IF v_curr_approval.decision != 'pending' AND NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'تم اتخاذ القرار في هذه الخطوة مسبقاً ولا يمكن تعديله إلا لمدير النظام.';
  END IF;

  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');
  v_decided_by := COALESCE(auth.jwt()->'app_metadata'->>'username', auth.jwt()->>'email', 'موظف مختص');

  -- Record decision
  UPDATE public.purchase_request_approvals
  SET decision = p_decision,
      decided_by = v_decided_by,
      decided_at = now(),
      note = COALESCE(p_note, '')
  WHERE request_id = p_request_id AND step_no = p_step_no;

  IF p_decision = 'rejected' THEN
    -- Reject the entire PR
    UPDATE public.purchase_requests
    SET status = 'rejected',
        updated_at = now()
    WHERE id = p_request_id;
  ELSE
    -- Check if all steps approved
    SELECT COUNT(*), COUNT(*) FILTER (WHERE decision = 'approved')
    INTO v_total_steps, v_approved_steps
    FROM public.purchase_request_approvals
    WHERE request_id = p_request_id;

    IF v_total_steps > 0 AND v_total_steps = v_approved_steps THEN
      UPDATE public.purchase_requests
      SET status = 'approved',
          updated_at = now()
      WHERE id = p_request_id;
    END IF;
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'RECORD_PURCHASE_APPROVAL',
    'purchase_request',
    p_request_id::TEXT,
    jsonb_build_object('step_no', p_step_no, 'decision', p_decision, 'note', p_note, 'request_no', v_req.request_no)
  );

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'decision', p_decision);
END;
$$;

-- 8.3 select_quote
CREATE OR REPLACE FUNCTION public.select_quote(p_request_id UUID, p_quote_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req RECORD;
  v_quote RECORD;
  v_po_exists BOOLEAN;
  v_caller_id TEXT;
BEGIN
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك باختيار عروض الأسعار.';
  END IF;

  SELECT * INTO v_req FROM public.purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء غير موجود.';
  END IF;

  IF v_req.status != 'approved' THEN
    RAISE EXCEPTION 'لا يمكن اختيار عرض سعر لطلب لم يكتمل اعتماده بعد (الحالة: %).', v_req.status;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.purchase_orders WHERE request_id = p_request_id) INTO v_po_exists;
  IF v_po_exists THEN
    RAISE EXCEPTION 'تم إنشاء أمر شراء بالفعل لهذا الطلب، لا يمكن تغيير العرض المختار.';
  END IF;

  SELECT q.*, s.status AS supplier_status, s.name AS supplier_name
  INTO v_quote
  FROM public.supplier_quotes q
  JOIN public.suppliers s ON s.id = q.supplier_id
  WHERE q.id = p_quote_id AND q.request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'عرض السعر المطلوب غير موجود أو غير مرتبط بهذا الطلب.';
  END IF;

  IF v_quote.supplier_status = 'suspended' THEN
    RAISE EXCEPTION 'لا يمكن اختيار عرض سعر من مورد موقوف (%s).', v_quote.supplier_name;
  END IF;

  -- Deselect all others, select this one
  UPDATE public.supplier_quotes SET is_selected = false WHERE request_id = p_request_id;
  UPDATE public.supplier_quotes SET is_selected = true WHERE id = p_quote_id;

  UPDATE public.purchase_requests
  SET selected_quote_id = p_quote_id,
      updated_at = now()
  WHERE id = p_request_id;

  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'SELECT_SUPPLIER_QUOTE',
    'supplier_quote',
    p_quote_id::TEXT,
    jsonb_build_object('request_id', p_request_id, 'supplier_id', v_quote.supplier_id, 'total_price', v_quote.total_price)
  );

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'selected_quote_id', p_quote_id);
END;
$$;

-- 8.4 create_purchase_order
CREATE OR REPLACE FUNCTION public.create_purchase_order(p_quote_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك بإنشاء أوامر الشراء.';
  END IF;

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

  SELECT * INTO v_req FROM public.purchase_requests WHERE id = v_quote.request_id;
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
$$;

-- 8.5 mark_po_received and mark_po_invoiced (Does NOT touch inventory)
CREATE OR REPLACE FUNCTION public.mark_po_received(p_po_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_po RECORD;
  v_caller_id TEXT;
BEGIN
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك بتحديث حالة أوامر الشراء.';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود.';
  END IF;

  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن استلام أمر شراء ملغي.';
  END IF;

  UPDATE public.purchase_orders
  SET status = 'received',
      received_on = CURRENT_DATE
  WHERE id = p_po_id;

  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'MARK_PO_RECEIVED',
    'purchase_order',
    p_po_id::TEXT,
    jsonb_build_object('po_no', v_po.po_no)
  );

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'status', 'received');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_po_invoiced(p_po_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_po RECORD;
  v_caller_id TEXT;
BEGIN
  IF NOT public.can_access_procurement() THEN
    RAISE EXCEPTION 'غير مصرح لك بتحديث حالة أوامر الشراء.';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود.';
  END IF;

  UPDATE public.purchase_orders
  SET status = 'invoiced',
      invoiced_on = CURRENT_DATE
  WHERE id = p_po_id;

  v_caller_id := COALESCE(auth.jwt()->>'sub', '00000000-0000-0000-0000-000000000000');
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    CASE WHEN v_caller_id ~ '^[0-9a-fA-F-]{36}$' THEN v_caller_id::UUID ELSE NULL END,
    COALESCE(auth.jwt()->>'email', 'system'),
    'MARK_PO_INVOICED',
    'purchase_order',
    p_po_id::TEXT,
    jsonb_build_object('po_no', v_po.po_no)
  );

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'status', 'invoiced');
END;
$$;

-- 9. Row Level Security (RLS) on all new tables

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke public/anon access
REVOKE ALL ON public.suppliers FROM anon;
REVOKE ALL ON public.purchase_requests FROM anon;
REVOKE ALL ON public.purchase_request_items FROM anon;
REVOKE ALL ON public.purchase_request_approvals FROM anon;
REVOKE ALL ON public.supplier_quotes FROM anon;
REVOKE ALL ON public.purchase_orders FROM anon;

-- Policies: Read/Insert for purchasing_staff, admin, and system_admin only
-- 9.1 suppliers
CREATE POLICY suppliers_select_policy ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY suppliers_insert_policy ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY suppliers_update_policy ON public.suppliers
  FOR UPDATE TO authenticated
  USING (public.can_access_procurement())
  WITH CHECK (public.can_access_procurement());

CREATE POLICY suppliers_delete_policy ON public.suppliers
  FOR DELETE TO authenticated
  USING (public.is_system_admin());

-- 9.2 purchase_requests
CREATE POLICY pr_select_policy ON public.purchase_requests
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY pr_insert_policy ON public.purchase_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY pr_update_policy ON public.purchase_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_system_admin()
    OR public.has_permission('manage_records')
    OR (
      public.can_access_procurement()
      AND status = 'draft'
      AND (
        created_by_id IS NULL
        OR created_by_id = auth.uid()
        OR created_by = COALESCE(auth.jwt()->'app_metadata'->>'username', '')
      )
    )
  )
  WITH CHECK (
    public.is_system_admin()
    OR public.has_permission('manage_records')
    OR (
      public.can_access_procurement()
      AND status = 'draft'
    )
  );

CREATE POLICY pr_delete_policy ON public.purchase_requests
  FOR DELETE TO authenticated
  USING (
    public.is_system_admin()
    OR (
      public.can_access_procurement()
      AND status = 'draft'
      AND (
        created_by_id IS NULL
        OR created_by_id = auth.uid()
        OR created_by = COALESCE(auth.jwt()->'app_metadata'->>'username', '')
      )
    )
  );

-- 9.3 purchase_request_items
CREATE POLICY pr_items_select_policy ON public.purchase_request_items
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY pr_items_insert_policy ON public.purchase_request_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY pr_items_update_policy ON public.purchase_request_items
  FOR UPDATE TO authenticated
  USING (public.can_access_procurement())
  WITH CHECK (public.can_access_procurement());

CREATE POLICY pr_items_delete_policy ON public.purchase_request_items
  FOR DELETE TO authenticated
  USING (public.can_access_procurement());

-- 9.4 purchase_request_approvals (Append-only decisions)
CREATE POLICY pr_approvals_select_policy ON public.purchase_request_approvals
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY pr_approvals_insert_policy ON public.purchase_request_approvals
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY pr_approvals_update_policy ON public.purchase_request_approvals
  FOR UPDATE TO authenticated
  USING (public.is_system_admin());

CREATE POLICY pr_approvals_delete_policy ON public.purchase_request_approvals
  FOR DELETE TO authenticated
  USING (public.is_system_admin());

-- 9.5 supplier_quotes
CREATE POLICY quotes_select_policy ON public.supplier_quotes
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY quotes_insert_policy ON public.supplier_quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY quotes_update_policy ON public.supplier_quotes
  FOR UPDATE TO authenticated
  USING (public.can_access_procurement())
  WITH CHECK (public.can_access_procurement());

CREATE POLICY quotes_delete_policy ON public.supplier_quotes
  FOR DELETE TO authenticated
  USING (public.is_system_admin());

-- 9.6 purchase_orders
CREATE POLICY po_select_policy ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (public.can_access_procurement());

CREATE POLICY po_insert_policy ON public.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_procurement());

CREATE POLICY po_update_policy ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (public.is_system_admin() OR public.has_permission('manage_records'));

CREATE POLICY po_delete_policy ON public.purchase_orders
  FOR DELETE TO authenticated
  USING (public.is_system_admin());
