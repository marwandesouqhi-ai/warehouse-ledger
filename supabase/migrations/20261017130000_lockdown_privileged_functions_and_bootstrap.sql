-- Migration: 20261017130000_lockdown_privileged_functions_and_bootstrap.sql
-- Description: Session A Remediation - Lock down privileged functions and introduce hardened one-time bootstrap
-- Safety: Additive, backward-compatible, zero data deletion.

-- 1. Create singleton bootstrap state table to prevent re-execution
CREATE TABLE IF NOT EXISTS public.system_bootstrap_state (
    is_singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (is_singleton),
    completed_at TIMESTAMPTZ,
    completed_by_auth_id UUID,
    admin_email TEXT,
    admin_username TEXT,
    admin_employee_id TEXT
);

ALTER TABLE public.system_bootstrap_state ENABLE ROW LEVEL SECURITY;

-- Revoke all client access to the bootstrap state table
REVOKE ALL ON TABLE public.system_bootstrap_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.system_bootstrap_state TO service_role;

-- Ensure singleton row exists
INSERT INTO public.system_bootstrap_state (is_singleton)
VALUES (TRUE)
ON CONFLICT (is_singleton) DO NOTHING;

-- 2. Revoke execute privileges on all privileged functions created for this feature
-- Prevents unauthorized RPC execution from anon or authenticated roles
REVOKE ALL ON FUNCTION public.generate_employee_code(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_employee_code(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.approve_employee_registration(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_employee_registration(UUID, TEXT, TEXT) TO service_role;

-- Drop old bootstrap function signature if exists and replace with hardened version without SQL defaults
DROP FUNCTION IF EXISTS public.bootstrap_system_admin(TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.bootstrap_system_admin(
  p_email TEXT,
  p_username TEXT,
  p_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_row public.system_bootstrap_state%ROWTYPE;
  v_auth_confirmed_at TIMESTAMPTZ;
  v_auth_email TEXT;
  v_existing_id TEXT;
  v_existing_auth_id UUID;
  v_existing_emp_id TEXT;
  v_matching_count INT;
  v_emp_id TEXT;
  v_result JSONB;
BEGIN
  -- Strict parameter validation: cannot be null or empty
  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RAISE EXCEPTION 'معلمة البريد الإلكتروني مطلوبة ولا يمكن أن تكون فارغة.';
  END IF;

  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RAISE EXCEPTION 'معلمة اسم المستخدم مطلوبة ولا يمكن أن تكون فارغة.';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم في نظام المصادقة auth_user_id مطلوب.';
  END IF;

  -- 1. Take singleton row lock to ensure concurrency safety and prevent double initialization
  SELECT * INTO v_lock_row
  FROM public.system_bootstrap_state
  WHERE is_singleton = TRUE
  FOR UPDATE;

  -- Check if bootstrap was already completed
  IF v_lock_row.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_initialized',
      'message', 'النظام مهيأ مسبقاً، لم يتم إجراء أي تغيير.',
      'admin_username', v_lock_row.admin_username,
      'admin_employee_id', v_lock_row.admin_employee_id
    );
  END IF;

  -- Check if any active system_admin already exists in app_users
  IF EXISTS (
    SELECT 1 FROM public.app_users
    WHERE role = 'system_admin' AND status = 'active'
  ) THEN
    -- Mark bootstrap state as completed to lock future attempts
    UPDATE public.system_bootstrap_state
    SET completed_at = NOW(),
        completed_by_auth_id = p_auth_user_id,
        admin_email = p_email,
        admin_username = p_username
    WHERE is_singleton = TRUE;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_initialized',
      'message', 'يوجد مدير نظام نشط بالفعل في النظام. تم قفل عملية التهيئة الأولية.',
      'admin_username', p_username
    );
  END IF;

  -- 2. Defense-in-depth: Read auth.users directly to verify account status
  SELECT email_confirmed_at, email
  INTO v_auth_confirmed_at, v_auth_email
  FROM auth.users
  WHERE id = p_auth_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'غير مصرح: حساب المستخدم غير موجود في سجلات المصادقة.';
  END IF;

  IF v_auth_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'غير مصرح: البريد الإلكتروني لحساب مدير النظام غير مؤكد بعد. يرجى تأكيد البريد أولاً.';
  END IF;

  IF LOWER(TRIM(v_auth_email)) <> LOWER(TRIM(p_email)) THEN
    RAISE EXCEPTION 'غير مصرح: البريد الإلكتروني لحساب المصادقة لا يطابق البريد المعتمد لمدير النظام.';
  END IF;

  -- 3. Check existing records in app_users for conflicts
  SELECT COUNT(*)
  INTO v_matching_count
  FROM public.app_users
  WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_username))
     OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(p_email)));

  IF v_matching_count > 1 THEN
    RAISE EXCEPTION 'تعارض في سجلات المستخدمين: تم العثور على أكثر من حساب يطابق اسم المستخدم أو البريد الإلكتروني.';
  END IF;

  IF v_matching_count = 1 THEN
    SELECT id, auth_user_id, employee_id
    INTO v_existing_id, v_existing_auth_id, v_existing_emp_id
    FROM public.app_users
    WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_username))
       OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(p_email)));

    -- If already linked to a different auth identity, abort
    IF v_existing_auth_id IS NOT NULL AND v_existing_auth_id <> p_auth_user_id THEN
      RAISE EXCEPTION 'تعارض في الهوية: هذا الحساب مرتبط بالفعل بحساب مصادقة آخر.';
    END IF;

    -- Preserve existing employee code if already allocated
    IF v_existing_emp_id IS NOT NULL AND TRIM(v_existing_emp_id) <> '' THEN
      v_emp_id := v_existing_emp_id;
    ELSE
      v_emp_id := public.generate_employee_code('system_admin');
    END IF;

    -- Update existing record safely
    UPDATE public.app_users
    SET email = p_email,
        username = p_username,
        employee_id = v_emp_id,
        department = 'الإدارة العامة',
        role = 'system_admin',
        status = 'active',
        auth_user_id = p_auth_user_id,
        notes = 'مدير النظام الرئيسي المعتمد'
    WHERE id = v_existing_id;

    v_result := jsonb_build_object(
      'success', true,
      'status', 'updated',
      'username', p_username,
      'email', p_email,
      'employee_id', v_emp_id,
      'role', 'system_admin'
    );
  ELSE
    -- No matching record exists; allocate new employee code
    v_emp_id := public.generate_employee_code('system_admin');

    INSERT INTO public.app_users (
      id, username, display_name, password, role,
      status, email, employee_id, department, auth_user_id, notes
    ) VALUES (
      'usr-' || gen_random_uuid()::TEXT,
      p_username,
      'مروان دسوقي (مدير النظام)',
      '-- auth-managed --',
      'system_admin',
      'active',
      p_email,
      v_emp_id,
      'الإدارة العامة',
      p_auth_user_id,
      'مدير النظام الرئيسي المعتمد'
    );

    v_result := jsonb_build_object(
      'success', true,
      'status', 'created',
      'username', p_username,
      'email', p_email,
      'employee_id', v_emp_id,
      'role', 'system_admin'
    );
  END IF;

  -- 4. Mark bootstrap lock table as completed
  UPDATE public.system_bootstrap_state
  SET completed_at = NOW(),
      completed_by_auth_id = p_auth_user_id,
      admin_email = p_email,
      admin_username = p_username,
      admin_employee_id = v_emp_id
  WHERE is_singleton = TRUE;

  -- 5. Record immutable audit log
  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, details
  ) VALUES (
    p_auth_user_id::TEXT,
    p_email,
    'تهيئة وتأكيد حساب مدير النظام الرئيسي (System Admin One-Time Bootstrap)',
    'system_admin_bootstrap',
    v_emp_id,
    v_result
  );

  RETURN v_result;
END;
$$;

-- Revoke bootstrap function execution from all client roles; only service_role may execute it
REVOKE ALL ON FUNCTION public.bootstrap_system_admin(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_system_admin(TEXT, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
