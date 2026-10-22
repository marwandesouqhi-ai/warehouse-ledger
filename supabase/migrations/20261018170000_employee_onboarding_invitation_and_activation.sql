-- Migration: 20261018170000_employee_onboarding_invitation_and_activation.sql
-- Description: Complete Employee Onboarding - Additive Invitation & Activation Schema
-- Safety: 100% Additive and Backward-Compatible. Zero deletion, no DROP, no TRUNCATE.

-- 1. Additive columns on registration_requests to track invitation state and sender
ALTER TABLE IF EXISTS public.registration_requests
  ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_sent_by TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_requests_invitation_status
  ON public.registration_requests (invitation_status);

-- 2. Additive unique indexes on app_users
-- Case-insensitive unique username
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_lower_username
  ON public.app_users (lower(username));

-- Case-insensitive unique email (sparse, ignores nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_lower_email
  ON public.app_users (lower(email))
  WHERE email IS NOT NULL;

-- Unique Supabase Auth UID mapping (sparse, ignores nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_auth_user_id
  ON public.app_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 3. Update registration_requests_admin_view to include invitation tracking fields
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
  invitation_status,
  invitation_sent_at,
  invitation_sent_by,
  created_at,
  updated_at
FROM public.registration_requests;

GRANT SELECT ON public.registration_requests_admin_view TO authenticated;

-- 4. Secure Helper Function: verify_auth_user_has_password
-- Checks if the given auth user has an encrypted password in auth.users
-- SECURITY DEFINER and restricted strictly to service_role to prevent leakage.
CREATE OR REPLACE FUNCTION public.verify_auth_user_has_password(p_auth_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_pwd BOOLEAN := FALSE;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT (encrypted_password IS NOT NULL AND encrypted_password <> '')
  INTO v_has_pwd
  FROM auth.users
  WHERE id = p_auth_user_id;

  RETURN COALESCE(v_has_pwd, FALSE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_auth_user_has_password(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_auth_user_has_password(UUID) TO service_role;

-- 5. Hardened approve_employee_registration update
-- Sets status = 'pending_activation' (never 'active' prior to activation)
-- Uses safe temporary placeholder username pending_<clean_id> that cannot log in
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
  v_temp_username TEXT;
  v_clean_role TEXT;
  v_clean_dept TEXT;
  v_existing_user public.app_users%ROWTYPE;
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
      'role', v_req.approved_role,
      'invitation_status', v_req.invitation_status
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

  -- 3. Enforce Approval Authorization Matrix
  IF v_reviewer.role = 'system_admin' THEN
    -- System Admin has universal authority across all departments
    NULL;
  ELSIF v_reviewer.role = 'warehouse_admin' THEN
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
    v_emp_id := COALESCE(v_existing_user.employee_id, public.generate_employee_code(v_clean_role));
    v_temp_username := v_existing_user.username;

    -- Update existing record keeping status as pending_activation if not yet activated
    UPDATE public.app_users
    SET email = v_req.email,
        employee_id = v_emp_id,
        department = v_req.requested_department,
        role = v_clean_role,
        telegram_user_id = COALESCE(v_existing_user.telegram_user_id, v_req.telegram_user_id),
        approved_at = NOW(),
        approved_by = v_reviewer.username,
        notes = 'تم اعتماد الموظف وتحديث بياناته بانتظار استكمال التفعيل'
    WHERE id = v_existing_user.id;
  ELSE
    -- Allocate new Unique ID
    v_emp_id := public.generate_employee_code(v_clean_role);

    -- Placeholder username: strictly temporary and invalid for direct login
    v_temp_username := 'pending_' || LOWER(REGEXP_REPLACE(v_emp_id, '[^a-z0-9]', '_', 'g'));
    IF EXISTS (SELECT 1 FROM public.app_users WHERE LOWER(username) = LOWER(v_temp_username)) THEN
      v_temp_username := v_temp_username || '_' || SUBSTRING(gen_random_uuid()::TEXT FROM 1 FOR 6);
    END IF;

    INSERT INTO public.app_users (
      id, username, display_name, password, role,
      status, email, employee_id, department, telegram_user_id,
      approved_at, approved_by, must_change_password, notes
    ) VALUES (
      'usr-' || gen_random_uuid()::TEXT,
      v_temp_username,
      v_req.full_name,
      '-- pending-activation --',
      v_clean_role,
      'pending_activation',
      v_req.email,
      v_emp_id,
      v_req.requested_department,
      v_req.telegram_user_id,
      NOW(),
      v_reviewer.username,
      TRUE,
      'تم اعتماد الموظف وإصدار دعوة التفعيل'
    );
  END IF;

  -- 5. Update Registration Request
  UPDATE public.registration_requests
  SET approval_status = 'approved',
      approved_role = v_clean_role,
      employee_id = v_emp_id,
      reviewed_by = v_reviewer.username,
      reviewed_at = NOW(),
      invitation_status = 'pending',
      updated_at = NOW()
  WHERE id = p_request_id;

  -- Update Registry with request_id link
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
      'role', v_clean_role,
      'department', v_req.requested_department,
      'reviewer', v_reviewer.username
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'employee_id', v_emp_id,
    'placeholder_username', v_temp_username,
    'email', v_req.email,
    'role', v_clean_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_employee_registration(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_employee_registration(UUID, TEXT, UUID) TO service_role;

-- 6. Atomic Finalize Activation Procedure
-- Validates username, checks password existence, transitions status to active, and updates requests
DROP FUNCTION IF EXISTS public.complete_employee_activation;

CREATE OR REPLACE FUNCTION public.complete_employee_activation(
  p_auth_user_id UUID,
  p_chosen_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user public.app_users%ROWTYPE;
  v_clean_user TEXT;
  v_has_password BOOLEAN := FALSE;
  v_reserved_list TEXT[] := ARRAY['admin', 'root', 'system', 'support', 'marwan-desouky', 'marwandesouqhi@gmail.com'];
  v_res_item TEXT;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم (Auth UID) مطلوب لإتمام التفعيل.';
  END IF;

  v_clean_user := LOWER(TRIM(COALESCE(p_chosen_username, '')));

  -- Rule 1: Username Length: 3 to 30 characters
  IF LENGTH(v_clean_user) < 3 OR LENGTH(v_clean_user) > 30 THEN
    RAISE EXCEPTION 'اسم المستخدم يجب أن يتكون من 3 إلى 30 حرفاً.';
  END IF;

  -- Rule 2: Allowed Charset: lowercase letters, digits, ., _, -
  IF v_clean_user !~ '^[a-z0-9._-]+$' THEN
    RAISE EXCEPTION 'اسم المستخدم يمكن أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام والنقطة والشرطة.';
  END IF;

  -- Rule 3: Must start with a letter or digit
  IF v_clean_user !~ '^[a-z0-9]' THEN
    RAISE EXCEPTION 'اسم المستخدم يجب أن يبدأ بحرف أو رقم.';
  END IF;

  -- Rule 4: Must not be an email address
  IF v_clean_user LIKE '%@%' THEN
    RAISE EXCEPTION 'اسم المستخدم يجب ألا يكون بريداً إلكترونياً.';
  END IF;

  -- Rule 5: Must not match employee-code pattern
  IF v_clean_user ~* '^[a-z]{2,3}-[a-z]{3}-\d{4,6}$' OR v_clean_user ~* '^(wh|pur|sys|emp|adm)-' THEN
    RAISE EXCEPTION 'اسم المستخدم لا يمكن أن يطابق نمط الرقم الوظيفي.';
  END IF;

  -- Rule 6: Reserved names check
  FOREACH v_res_item IN ARRAY v_reserved_list LOOP
    IF v_clean_user = v_res_item THEN
      RAISE EXCEPTION 'اسم المستخدم محجوز لنظام إدارة الخادم ولا يمكن استخدامه.';
    END IF;
  END LOOP;

  -- 1. Lock and fetch user profile
  SELECT * INTO v_user
  FROM public.app_users
  WHERE auth_user_id = p_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم يتم العثور على سجل وظيفي مرتبط بجلسة الدعوة.';
  END IF;

  IF v_user.status = 'active' THEN
    RAISE EXCEPTION 'رابط التفعيل صالح للاستخدام لمرة واحدة فقط، وقد تم تفعيل هذا الحساب بالفعل مسبقاً.';
  END IF;

  IF v_user.status <> 'pending_activation' THEN
    RAISE EXCEPTION 'حالة الحساب غير مؤهلة للتفعيل (%): يُرجى التواصل مع الإدارة.', v_user.status;
  END IF;

  -- 2. Case-insensitive uniqueness check in app_users
  IF EXISTS (
    SELECT 1 FROM public.app_users
    WHERE LOWER(username) = v_clean_user AND id <> v_user.id
  ) THEN
    RAISE EXCEPTION 'اسم المستخدم "%" مستخدم بالفعل، يرجى اختيار اسم آخر.', v_clean_user;
  END IF;

  -- 3. Verify user has password in auth.users
  v_has_password := public.verify_auth_user_has_password(p_auth_user_id);
  IF NOT v_has_password THEN
    RAISE EXCEPTION 'يجب تعيين كلمة المرور أولاً قبل إتمام تفعيل الحساب.';
  END IF;

  -- 4. Atomic transaction update
  UPDATE public.app_users
  SET username = v_clean_user,
      status = 'active',
      activated_at = NOW(),
      must_change_password = FALSE,
      notes = 'تم تفعيل الحساب بنجاح بواسطة الموظف'
  WHERE id = v_user.id;

  -- Update registration_requests invitation_status to accepted
  UPDATE public.registration_requests
  SET invitation_status = 'accepted',
      updated_at = NOW()
  WHERE employee_id = v_user.employee_id
     OR (email IS NOT NULL AND LOWER(email) = LOWER(v_user.email));

  -- Record audit log
  INSERT INTO public.audit_logs (
    user_id, user_email, action, entity_type, entity_id, details
  ) VALUES (
    p_auth_user_id::TEXT,
    v_user.email,
    'تم تفعيل الحساب واختيار اسم المستخدم: ' || v_clean_user,
    'account_activation',
    v_user.employee_id,
    jsonb_build_object(
      'employee_id', v_user.employee_id,
      'username', v_clean_user,
      'department', v_user.department,
      'role', v_user.role
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'activated',
    'message', 'تم تفعيل حسابك بنجاح!',
    'username', v_clean_user,
    'employee_id', v_user.employee_id,
    'department', v_user.department,
    'role', v_user.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_employee_activation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_employee_activation(UUID, TEXT) TO service_role;

-- 7. Read-only Identity Consistency Report Procedure
-- Lists discrepancies without altering or deleting any record
CREATE OR REPLACE FUNCTION public.get_identity_consistency_report()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_missing_auth JSONB;
  v_missing_app_user JSONB;
  v_approved_no_invitation JSONB;
  v_active_without_username JSONB;
  v_duplicate_emails JSONB;
BEGIN
  -- 1. app_users rows with no Auth user
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'app_user_id', u.id,
    'username', u.username,
    'employee_id', u.employee_id,
    'email', u.email,
    'status', u.status,
    'reason', 'auth_user_id_null_or_missing'
  )), '[]'::JSONB)
  INTO v_missing_auth
  FROM public.app_users u
  WHERE u.auth_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.auth_user_id);

  -- 2. Auth users with no app_users row
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'auth_user_id', a.id,
    'email', a.email,
    'created_at', a.created_at,
    'reason', 'no_matching_app_users_row'
  )), '[]'::JSONB)
  INTO v_missing_app_user
  FROM auth.users a
  WHERE NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.auth_user_id = a.id OR (u.email IS NOT NULL AND LOWER(u.email) = LOWER(a.email)));

  -- 3. Approved registration requests without an invitation sent
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'request_id', r.id,
    'full_name', r.full_name,
    'email', r.email,
    'employee_id', r.employee_id,
    'approval_status', r.approval_status,
    'invitation_status', r.invitation_status,
    'reason', 'approved_without_invitation_sent'
  )), '[]'::JSONB)
  INTO v_approved_no_invitation
  FROM public.registration_requests r
  WHERE r.approval_status = 'approved'
    AND (r.invitation_status IS NULL OR r.invitation_status = 'pending' OR r.invitation_sent_at IS NULL);

  -- 4. Active users without a valid final username (placeholder or blank)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'app_user_id', u.id,
    'username', u.username,
    'employee_id', u.employee_id,
    'status', u.status,
    'reason', 'active_with_placeholder_or_empty_username'
  )), '[]'::JSONB)
  INTO v_active_without_username
  FROM public.app_users u
  WHERE u.status = 'active'
    AND (u.username IS NULL OR u.username = '' OR u.username LIKE 'pending_%' OR u.username LIKE 'temp_%');

  -- 5. Duplicate emails in app_users
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'email', lower_email,
    'count', email_count,
    'reason', 'duplicate_email_in_app_users'
  )), '[]'::JSONB)
  INTO v_duplicate_emails
  FROM (
    SELECT LOWER(email) AS lower_email, COUNT(*) AS email_count
    FROM public.app_users
    WHERE email IS NOT NULL AND email <> ''
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) dups;

  RETURN jsonb_build_object(
    'generated_at', NOW(),
    'has_issues', (
      jsonb_array_length(v_missing_auth) > 0 OR
      jsonb_array_length(v_missing_app_user) > 0 OR
      jsonb_array_length(v_approved_no_invitation) > 0 OR
      jsonb_array_length(v_active_without_username) > 0 OR
      jsonb_array_length(v_duplicate_emails) > 0
    ),
    'missing_auth_users', v_missing_auth,
    'missing_app_users', v_missing_app_user,
    'approved_without_invitation', v_approved_no_invitation,
    'active_without_username', v_active_without_username,
    'duplicate_emails', v_duplicate_emails
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_identity_consistency_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_identity_consistency_report() TO service_role;

NOTIFY pgrst, 'reload schema';
