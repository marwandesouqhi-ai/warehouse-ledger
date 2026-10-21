-- Migration: 20261017150000_approval_delegation_code_registry_and_rls.sql
-- Description: Session C Remediation - Approval delegation settings, append-only code registry, sequence advancement, and hardened RLS
-- Safety: Additive, zero deletion of business records.

-- 1. Table for Department Delegation Settings (Part 1.3)
CREATE TABLE IF NOT EXISTS public.registration_approval_settings (
    department TEXT PRIMARY KEY CHECK (department IN ('warehouse', 'procurement', 'المخازن', 'المشتريات')),
    delegation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.registration_approval_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registration_approval_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.registration_approval_settings TO service_role;

-- Seed default delegation rows (disabled by default)
INSERT INTO public.registration_approval_settings (department, delegation_enabled)
VALUES ('warehouse', false), ('procurement', false)
ON CONFLICT (department) DO NOTHING;

-- 2. Append-Only Employee Code Registry (P1-4)
CREATE TABLE IF NOT EXISTS public.employee_code_registry (
    employee_code TEXT PRIMARY KEY,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id UUID REFERENCES public.registration_requests(id) ON DELETE SET NULL,
    app_user_id TEXT
);

ALTER TABLE public.employee_code_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_code_registry FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.employee_code_registry TO service_role;

-- Trigger to strictly forbid UPDATE and DELETE on employee_code_registry
CREATE OR REPLACE FUNCTION public.prevent_employee_code_registry_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'سجل الأكواد الوظيفية غير قابل للتعديل أو الحذف لحماية التسلسل التاريخي.';
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_code_registry_tamper ON public.employee_code_registry;
CREATE TRIGGER trg_employee_code_registry_tamper
BEFORE UPDATE OR DELETE ON public.employee_code_registry
FOR EACH ROW EXECUTE FUNCTION public.prevent_employee_code_registry_tamper();

-- Populate existing allocated codes into the registry
INSERT INTO public.employee_code_registry (employee_code, allocated_at, app_user_id)
SELECT employee_id, NOW(), id
FROM public.app_users
WHERE employee_id IS NOT NULL AND employee_id ~ '^(WH|PUR|SYS)-(EMP|ADM)-\d{6}$'
ON CONFLICT (employee_code) DO NOTHING;

-- 3. Concurrency-Safe Sequence Advancement Past Existing Numeric Suffixes
DO $$
DECLARE
  v_max_wh_emp BIGINT := 0;
  v_max_wh_adm BIGINT := 0;
  v_max_pur_emp BIGINT := 0;
  v_max_pur_adm BIGINT := 0;
  v_max_sys_adm BIGINT := 0;
BEGIN
  -- WH-EMP-
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'WH-EMP-(\d{6})')::BIGINT), 0)
  INTO v_max_wh_emp
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^WH-EMP-\d{6}$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^WH-EMP-\d{6}$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^WH-EMP-\d{6}$'
  ) t;
  PERFORM setval('public.seq_emp_wh_emp', GREATEST(v_max_wh_emp, 1), v_max_wh_emp > 0);

  -- WH-ADM-
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'WH-ADM-(\d{6})')::BIGINT), 0)
  INTO v_max_wh_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^WH-ADM-\d{6}$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^WH-ADM-\d{6}$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^WH-ADM-\d{6}$'
  ) t;
  PERFORM setval('public.seq_emp_wh_adm', GREATEST(v_max_wh_adm, 1), v_max_wh_adm > 0);

  -- PUR-EMP-
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'PUR-EMP-(\d{6})')::BIGINT), 0)
  INTO v_max_pur_emp
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^PUR-EMP-\d{6}$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^PUR-EMP-\d{6}$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^PUR-EMP-\d{6}$'
  ) t;
  PERFORM setval('public.seq_emp_pur_emp', GREATEST(v_max_pur_emp, 1), v_max_pur_emp > 0);

  -- PUR-ADM-
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'PUR-ADM-(\d{6})')::BIGINT), 0)
  INTO v_max_pur_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^PUR-ADM-\d{6}$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^PUR-ADM-\d{6}$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^PUR-ADM-\d{6}$'
  ) t;
  PERFORM setval('public.seq_emp_pur_adm', GREATEST(v_max_pur_adm, 1), v_max_pur_adm > 0);

  -- SYS-ADM-
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'SYS-ADM-(\d{6})')::BIGINT), 0)
  INTO v_max_sys_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^SYS-ADM-\d{6}$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^SYS-ADM-\d{6}$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^SYS-ADM-\d{6}$'
  ) t;
  PERFORM setval('public.seq_emp_sys_adm', GREATEST(v_max_sys_adm, 1), v_max_sys_adm > 0);
END $$;

-- 4. Hardened Employee Code Generator (No fallback, raises on collision exhaustion, registers code)
CREATE OR REPLACE FUNCTION public.generate_employee_code(p_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT := LOWER(TRIM(COALESCE(p_role, '')));
  v_next_val BIGINT;
  v_prefix TEXT;
  v_candidate TEXT;
  v_max_attempts INT := 10;
  v_attempt INT := 0;
BEGIN
  -- Determine prefix and sequence based strictly on allowed roles
  IF v_role = 'warehouse_employee' OR v_role = 'warehouse_staff' THEN
    v_prefix := 'WH-EMP-';
    v_next_val := nextval('public.seq_emp_wh_emp');
  ELSIF v_role = 'warehouse_admin' THEN
    v_prefix := 'WH-ADM-';
    v_next_val := nextval('public.seq_emp_wh_adm');
  ELSIF v_role = 'procurement_employee' OR v_role = 'purchasing_staff' THEN
    v_prefix := 'PUR-EMP-';
    v_next_val := nextval('public.seq_emp_pur_emp');
  ELSIF v_role = 'procurement_admin' THEN
    v_prefix := 'PUR-ADM-';
    v_next_val := nextval('public.seq_emp_pur_adm');
  ELSIF v_role = 'system_admin' THEN
    v_prefix := 'SYS-ADM-';
    v_next_val := nextval('public.seq_emp_sys_adm');
  ELSE
    RAISE EXCEPTION 'الدور الوظيفي غير مدعوم لتوليد الأكواد الوظيفية: %', p_role;
  END IF;

  v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');

  -- Collision avoidance loop checking both app_users and employee_code_registry
  WHILE (
    EXISTS (SELECT 1 FROM public.app_users WHERE employee_id = v_candidate) OR
    EXISTS (SELECT 1 FROM public.employee_code_registry WHERE employee_code = v_candidate)
  ) AND v_attempt < v_max_attempts LOOP
    v_attempt := v_attempt + 1;
    IF v_role = 'warehouse_employee' OR v_role = 'warehouse_staff' THEN
      v_next_val := nextval('public.seq_emp_wh_emp');
    ELSIF v_role = 'warehouse_admin' THEN
      v_next_val := nextval('public.seq_emp_wh_adm');
    ELSIF v_role = 'procurement_employee' OR v_role = 'purchasing_staff' THEN
      v_next_val := nextval('public.seq_emp_pur_emp');
    ELSIF v_role = 'procurement_admin' THEN
      v_next_val := nextval('public.seq_emp_pur_adm');
    ELSIF v_role = 'system_admin' THEN
      v_next_val := nextval('public.seq_emp_sys_adm');
    END IF;
    v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');
  END LOOP;

  IF v_attempt >= v_max_attempts THEN
    RAISE EXCEPTION 'تعذر تخصيص كود وظيفي فريد بعد عدة محاولات لتفادي التصادم.';
  END IF;

  -- Lock allocated candidate in the append-only registry immediately
  INSERT INTO public.employee_code_registry (employee_code, allocated_at)
  VALUES (v_candidate, NOW())
  ON CONFLICT (employee_code) DO NOTHING;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_employee_code(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_employee_code(TEXT) TO service_role;

-- 5. Hardened approve_employee_registration Database Function
DROP FUNCTION IF EXISTS public.approve_employee_registration(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.approve_employee_registration(
  p_request_id UUID,
  p_approved_role TEXT,
  p_reviewer_auth_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.registration_requests%ROWTYPE;
  v_reviewer public.app_users%ROWTYPE;
  v_delegation_enabled BOOLEAN := FALSE;
  v_emp_id TEXT;
  v_username TEXT;
  v_clean_role TEXT;
  v_clean_dept TEXT;
  v_existing_user public.app_users%ROWTYPE;
  v_has_existing BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  -- Strict validation of inputs
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'معرف الطلب مطلوب.';
  END IF;

  IF p_reviewer_auth_id IS NULL THEN
    RAISE EXCEPTION 'معرف المشرف المعتمد مطلوب.';
  END IF;

  v_clean_role := LOWER(TRIM(COALESCE(p_approved_role, '')));
  IF v_clean_role NOT IN ('warehouse_employee', 'warehouse_admin', 'procurement_employee', 'procurement_admin') THEN
    RAISE EXCEPTION 'الدور المعتمد غير صالح أو غير مسموح به في دورة الاعتماد: %', p_approved_role;
  END IF;

  -- 1. Lock the request row with FOR UPDATE
  SELECT * INTO v_req
  FROM public.registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب التسجيل غير موجود.';
  END IF;

  -- Idempotency check: if already approved, return existing profile data safely
  IF v_req.approval_status = 'approved' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_approved',
      'message', 'تم اعتماد هذا الطلب مسبقاً.',
      'employee_id', v_req.employee_id,
      'role', v_req.approved_role
    );
  END IF;

  IF v_req.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'غير مصرح: لا يمكن اعتماد طلب تسجيل لم يتم التحقق من بريده الإلكتروني بنجاح.';
  END IF;

  -- 2. Derive reviewer authority from database records (app_users)
  SELECT * INTO v_reviewer
  FROM public.app_users
  WHERE auth_user_id = p_reviewer_auth_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'غير مصرح: حساب المشرف غير موجود أو غير نشط في النظام.';
  END IF;

  -- Reject Self-Approval
  IF v_reviewer.email IS NOT NULL AND LOWER(TRIM(v_reviewer.email)) = LOWER(TRIM(v_req.email)) THEN
    RAISE EXCEPTION 'غير مصرح: لا يجوز للمشرف اعتماد طلب التسجيل الخاص به.';
  END IF;

  IF v_reviewer.telegram_user_id IS NOT NULL AND v_reviewer.telegram_user_id = v_req.telegram_user_id THEN
    RAISE EXCEPTION 'غير مصرح: لا يجوز للمشرف اعتماد طلب التسجيل الخاص به عبر التيليجرام.';
  END IF;

  v_clean_dept := CASE
    WHEN v_req.requested_department IN ('warehouse', 'المخازن') THEN 'warehouse'
    ELSE 'procurement'
  END;

  -- 3. Enforce Approval Authorization Matrix (Part 1.2 & 1.3)
  IF v_reviewer.role = 'system_admin' THEN
    -- System Admin has full approval rights across all departments
    NULL;
  ELSIF v_reviewer.role = 'warehouse_admin' THEN
    -- Check delegation setting for warehouse
    SELECT delegation_enabled INTO v_delegation_enabled
    FROM public.registration_approval_settings
    WHERE department IN ('warehouse', 'المخازن')
    LIMIT 1;

    IF NOT COALESCE(v_delegation_enabled, false) THEN
      RAISE EXCEPTION 'غير مصرح: تفويض الاعتماد لمشرفي قسم المخازن غير مفعل من قِبل مدير النظام.';
    END IF;

    IF v_clean_dept <> 'warehouse' THEN
      RAISE EXCEPTION 'غير مصرح: مشرف قسم المخازن لا يمكنه اعتماد طلبات تابعة لأقسام أخرى.';
    END IF;

    IF v_clean_role <> 'warehouse_employee' THEN
      RAISE EXCEPTION 'غير مصرح: مشرف قسم المخازن يمكنه فقط اعتماد طلبات الموظفين العاديين في قسمه.';
    END IF;
  ELSIF v_reviewer.role = 'procurement_admin' THEN
    -- Check delegation setting for procurement
    SELECT delegation_enabled INTO v_delegation_enabled
    FROM public.registration_approval_settings
    WHERE department IN ('procurement', 'المشتريات')
    LIMIT 1;

    IF NOT COALESCE(v_delegation_enabled, false) THEN
      RAISE EXCEPTION 'غير مصرح: تفويض الاعتماد لمشرفي قسم المشتريات غير مفعل من قِبل مدير النظام.';
    END IF;

    IF v_clean_dept <> 'procurement' THEN
      RAISE EXCEPTION 'غير مصرح: مشرف قسم المشتريات لا يمكنه اعتماد طلبات تابعة لأقسام أخرى.';
    END IF;

    IF v_clean_role <> 'procurement_employee' THEN
      RAISE EXCEPTION 'غير مصرح: مشرف قسم المشتريات يمكنه فقط اعتماد طلبات الموظفين العاديين في قسمه.';
    END IF;
  ELSE
    RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية اعتماد طلبات تسجيل الموظفين.';
  END IF;

  -- 4. Check if a profile already exists for this verified email or telegram identity
  SELECT * INTO v_existing_user
  FROM public.app_users
  WHERE (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(v_req.email)))
     OR (telegram_user_id IS NOT NULL AND telegram_user_id = v_req.telegram_user_id)
  LIMIT 1;

  IF FOUND THEN
    v_has_existing := TRUE;
    v_emp_id := COALESCE(v_existing_user.employee_id, public.generate_employee_code(v_clean_role));
    v_username := v_existing_user.username;

    -- Update existing record without destroying historical data
    UPDATE public.app_users
    SET email = v_req.email,
        employee_id = v_emp_id,
        department = v_req.requested_department,
        role = v_clean_role,
        telegram_user_id = COALESCE(v_existing_user.telegram_user_id, v_req.telegram_user_id),
        approved_at = NOW(),
        approved_by = v_reviewer.username,
        notes = 'تم اعتماد الموظف وتحديث بياناته'
    WHERE id = v_existing_user.id;
  ELSE
    -- Allocate new employee code
    v_emp_id := public.generate_employee_code(v_clean_role);

    -- Generate safe collision-free username
    v_username := LOWER(REGEXP_REPLACE(SPLIT_PART(v_req.email, '@', 1), '[^a-z0-9_]', '_', 'g'));
    IF v_username = '' OR LENGTH(v_username) < 3 THEN
      v_username := 'emp_' || LOWER(SUBSTRING(v_emp_id FROM '\d+$'));
    END IF;

    IF EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username) THEN
      v_username := v_username || '_' || LOWER(SUBSTRING(v_emp_id FROM '\d+$'));
    END IF;

    INSERT INTO public.app_users (
      id, username, display_name, password, role,
      status, email, employee_id, department, telegram_user_id,
      approved_at, approved_by, must_change_password, notes
    ) VALUES (
      'usr-' || gen_random_uuid()::TEXT,
      v_username,
      v_req.full_name,
      '-- auth-managed --',
      v_clean_role,
      'active',
      v_req.email,
      v_emp_id,
      v_req.requested_department,
      v_req.telegram_user_id,
      NOW(),
      v_reviewer.username,
      TRUE,
      'تم اعتماد الموظف عبر إدارة النظام'
    );
  END IF;

  -- 5. Update Registration Request
  UPDATE public.registration_requests
  SET approval_status = 'approved',
      approved_role = v_clean_role,
      employee_id = v_emp_id,
      reviewed_by = v_reviewer.username,
      reviewed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id;

  -- Update Registry with app_user_id link
  UPDATE public.employee_code_registry
  SET request_id = p_request_id
  WHERE employee_code = v_emp_id;

  -- 6. Record Audit Event
  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, details
  ) VALUES (
    p_reviewer_auth_id::TEXT,
    v_reviewer.email,
    'اعتماد طلب تسجيل موظف وتخصيص الكود الوظيفي: ' || v_emp_id,
    'employee_approval',
    v_emp_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'employee_id', v_emp_id,
      'username', v_username,
      'role', v_clean_role,
      'department', v_req.requested_department,
      'reviewer', v_reviewer.username
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'employee_id', v_emp_id,
    'username', v_username,
    'email', v_req.email,
    'role', v_clean_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_employee_registration(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_employee_registration(UUID, TEXT, UUID) TO service_role;

-- 6. RLS Policies Hardening for registration_requests (P1-5)
REVOKE INSERT, UPDATE, DELETE ON public.registration_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can update registration requests" ON public.registration_requests;
DROP POLICY IF EXISTS "Admins can view registration requests" ON public.registration_requests;

CREATE POLICY "Admins can view registration requests"
  ON public.registration_requests FOR SELECT TO authenticated
  USING (
    -- System Admin sees all requests
    (
      COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false) = true OR
      COALESCE(auth.jwt()->'app_metadata'->>'role', '') = 'system_admin'
    )
    OR
    -- Warehouse Admin sees only warehouse requests when delegation is enabled
    (
      COALESCE(auth.jwt()->'app_metadata'->>'role', '') = 'warehouse_admin' AND
      requested_department IN ('warehouse', 'المخازن') AND
      EXISTS (
        SELECT 1 FROM public.registration_approval_settings
        WHERE department IN ('warehouse', 'المخازن') AND delegation_enabled = true
      )
    )
    OR
    -- Procurement Admin sees only procurement requests when delegation is enabled
    (
      COALESCE(auth.jwt()->'app_metadata'->>'role', '') = 'procurement_admin' AND
      requested_department IN ('procurement', 'المشتريات') AND
      EXISTS (
        SELECT 1 FROM public.registration_approval_settings
        WHERE department IN ('procurement', 'المشتريات') AND delegation_enabled = true
      )
    )
  );

-- Safe administrative view that excludes OTP secret tokens and counters
DROP VIEW IF EXISTS public.registration_requests_admin_view CASCADE;

CREATE OR REPLACE VIEW public.registration_requests_admin_view
WITH (security_invoker = true)
AS
SELECT
  id,
  full_name,
  email,
  telegram_user_id,
  telegram_username,
  requested_department,
  requested_role,
  verification_status,
  approval_status,
  approved_role,
  employee_id,
  reviewed_by,
  reviewed_at,
  rejection_reason,
  created_at,
  updated_at
FROM public.registration_requests;

GRANT SELECT ON public.registration_requests_admin_view TO authenticated;

NOTIFY pgrst, 'reload schema';
