-- Migration: 20261017120000_employee_registration_and_identity.sql
-- Description: Employee Registration, Identity Management, Unique IDs, Telegram Integration, and Department Isolation
-- Safety: 100% Additive and Backward-Compatible. No DROP TABLE, no TRUNCATE, no deletion of business records.

-- 1. Additive columns on app_users
ALTER TABLE IF EXISTS public.app_users
  ADD COLUMN IF NOT EXISTS employee_id TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT;

-- Enforce unique constraints where appropriate (without failing on existing nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_employee_id ON public.app_users (employee_id) WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_telegram_user_id ON public.app_users (telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_department ON public.app_users (department) WHERE department IS NOT NULL;

-- 2. Sequences for Unique Employee ID Generation (Collision-safe, Concurrency-safe)
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_wh_emp START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_wh_adm START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_pur_emp START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_pur_adm START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_sys_adm START WITH 1 INCREMENT BY 1;

-- Helper function: generate_employee_code(role)
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
  -- Determine prefix and sequence based on role
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
  ELSIF v_role = 'admin' THEN
    v_prefix := 'WH-ADM-';
    v_next_val := nextval('public.seq_emp_wh_adm');
  ELSE
    v_prefix := 'EMP-';
    v_next_val := nextval('public.seq_emp_wh_emp');
  END IF;

  v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');

  -- Ensure collision avoidance if a manual record exists
  WHILE EXISTS (SELECT 1 FROM public.app_users WHERE employee_id = v_candidate) AND v_attempt < v_max_attempts LOOP
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
    ELSE
      v_next_val := nextval('public.seq_emp_wh_emp');
    END IF;
    v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- 3. Registration Requests Table
CREATE TABLE IF NOT EXISTS public.registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    telegram_user_id BIGINT,
    telegram_username TEXT,
    requested_department TEXT NOT NULL, -- 'warehouse' (المخازن) | 'procurement' (المشتريات)
    requested_role TEXT NOT NULL,       -- 'warehouse_employee' | 'warehouse_admin' | 'procurement_employee' | 'procurement_admin'
    verification_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'verified' | 'expired'
    verification_token_hash TEXT,
    verification_token_expires_at TIMESTAMPTZ,
    verification_attempts INT NOT NULL DEFAULT 0,
    approval_status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected'
    approved_role TEXT,
    employee_id TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_email ON public.registration_requests (email);
CREATE INDEX IF NOT EXISTS idx_reg_requests_tg ON public.registration_requests (telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON public.registration_requests (approval_status, verification_status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_created ON public.registration_requests (created_at DESC);

-- Enable RLS on registration_requests
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Only System Admins and Department Admins can view and manage registration requests
DROP POLICY IF EXISTS "Admins can view registration requests" ON public.registration_requests;
CREATE POLICY "Admins can view registration requests"
  ON public.registration_requests FOR SELECT TO authenticated
  USING (
    COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false) = true OR
    COALESCE(auth.jwt()->'app_metadata'->>'role', '') IN ('system_admin', 'admin', 'warehouse_admin', 'procurement_admin')
  );

DROP POLICY IF EXISTS "Admins can update registration requests" ON public.registration_requests;
CREATE POLICY "Admins can update registration requests"
  ON public.registration_requests FOR UPDATE TO authenticated
  USING (
    COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false) = true OR
    COALESCE(auth.jwt()->'app_metadata'->>'role', '') IN ('system_admin', 'admin')
  )
  WITH CHECK (
    COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false) = true OR
    COALESCE(auth.jwt()->'app_metadata'->>'role', '') IN ('system_admin', 'admin')
  );

-- Service role bypasses RLS for Edge Functions (webhook, verify-email, approve)
GRANT SELECT, INSERT, UPDATE ON public.registration_requests TO authenticated, service_role;

-- 4. Initial System Administrator Bootstrap Procedure
-- Provisions marwan-desouky / marwandesouqhi@gmail.com with SYS-ADM-000001
DROP FUNCTION IF EXISTS public.bootstrap_system_admin;

CREATE OR REPLACE FUNCTION public.bootstrap_system_admin(
  p_email TEXT DEFAULT 'marwandesouqhi@gmail.com',
  p_username TEXT DEFAULT 'marwan-desouky',
  p_auth_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_id TEXT;
  v_existing_auth UUID;
  v_emp_id TEXT;
  v_result JSONB;
BEGIN
  -- 1. Check if marwan-desouky profile already exists
  SELECT id, auth_user_id, employee_id
  INTO v_existing_id, v_existing_auth, v_emp_id
  FROM public.app_users
  WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_username))
     OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(p_email)));

  IF v_emp_id IS NULL OR v_emp_id = '' THEN
    v_emp_id := 'SYS-ADM-000001';
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- Update existing profile safely without breaking trigger
    UPDATE public.app_users
    SET email = p_email,
        employee_id = v_emp_id,
        department = 'الإدارة العامة',
        role = 'system_admin',
        status = 'active',
        auth_user_id = COALESCE(v_existing_auth, p_auth_user_id)
    WHERE id = v_existing_id;

    v_result := jsonb_build_object(
      'status', 'updated',
      'username', p_username,
      'email', p_email,
      'employee_id', v_emp_id,
      'role', 'system_admin'
    );
  ELSE
    -- Insert initial system admin profile
    INSERT INTO public.app_users (
      id, username, display_name, password, role,
      status, email, employee_id, department, auth_user_id, notes
    ) VALUES (
      'usr-admin-marwan',
      p_username,
      'مروان دسوقي (مدير النظام)',
      '-- protected --',
      'system_admin',
      'active',
      p_email,
      v_emp_id,
      'الإدارة العامة',
      p_auth_user_id,
      'مدير النظام الرئيسي'
    );

    v_result := jsonb_build_object(
      'status', 'created',
      'username', p_username,
      'email', p_email,
      'employee_id', v_emp_id,
      'role', 'system_admin'
    );
  END IF;

  -- Record audit event
  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, details
  ) VALUES (
    COALESCE(p_auth_user_id::TEXT, 'system-bootstrap'),
    p_email,
    'تهيئة وتأكيد حساب مدير النظام الرئيسي (System Admin Bootstrap)',
    'system_admin_provisioning',
    v_emp_id,
    v_result
  );

  RETURN v_result;
END;
$$;

-- 5. Helper function for secure employee approval
CREATE OR REPLACE FUNCTION public.approve_employee_registration(
  p_request_id UUID,
  p_approved_role TEXT,
  p_reviewer_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.registration_requests%ROWTYPE;
  v_emp_id TEXT;
  v_username TEXT;
  v_department TEXT;
  v_result JSONB;
BEGIN
  -- 1. Fetch request
  SELECT * INTO v_req FROM public.registration_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب التسجيل غير موجود.';
  END IF;

  IF v_req.approval_status = 'approved' THEN
    RAISE EXCEPTION 'هذا الطلب تمت الموافقة عليه مسبقاً برقم وظيفي: %', v_req.employee_id;
  END IF;

  IF v_req.verification_status != 'verified' THEN
    RAISE EXCEPTION 'لا يمكن الموافقة على طلب تسجيل لم يتم التحقق من بريده الإلكتروني.';
  END IF;

  -- Disallow ordinary registrations from granting system_admin
  IF p_approved_role = 'system_admin' THEN
    RAISE EXCEPTION 'غير مصرح: لا يمكن منح دور مدير النظام الرئيسي من خلال طلبات التسجيل.';
  END IF;

  -- 2. Generate unique employee code
  v_emp_id := public.generate_employee_code(p_approved_role);

  -- 3. Determine unique username based on email local-part or sanitized name
  v_username := LOWER(REGEXP_REPLACE(SPLIT_PART(v_req.email, '@', 1), '[^a-z0-9_]', '_', 'g'));
  IF EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username) THEN
    v_username := v_username || '_' || SUBSTRING(v_emp_id FROM '\d+$');
  END IF;

  v_department := v_req.requested_department;

  -- 4. Insert or update app_users record
  INSERT INTO public.app_users (
    id, username, display_name, password, role,
    status, email, employee_id, department, telegram_user_id,
    approved_at, approved_by, notes
  ) VALUES (
    'usr-' || gen_random_uuid(),
    v_username,
    v_req.full_name,
    '-- auth-managed --',
    p_approved_role,
    'active',
    v_req.email,
    v_emp_id,
    v_department,
    v_req.telegram_user_id,
    NOW(),
    p_reviewer_id,
    'تم التسجيل عبر بوت التيليجرام واعتماده'
  );

  -- 5. Update registration request
  UPDATE public.registration_requests
  SET approval_status = 'approved',
      approved_role = p_approved_role,
      employee_id = v_emp_id,
      reviewed_by = p_reviewer_id,
      reviewed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 6. Audit log
  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, details
  ) VALUES (
    p_reviewer_id,
    v_req.email,
    'اعتماد طلب تسجيل موظف جديد وتخصيص الرقم الوظيفي: ' || v_emp_id,
    'employee_approval',
    v_emp_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'employee_id', v_emp_id,
      'role', p_approved_role,
      'department', v_department,
      'email', v_req.email
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', v_emp_id,
    'username', v_username,
    'email', v_req.email,
    'role', p_approved_role
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
