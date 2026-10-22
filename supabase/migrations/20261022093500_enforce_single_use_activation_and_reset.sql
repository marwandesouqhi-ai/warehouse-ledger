-- ==============================================================================
-- Migration: Enforce strict single-use activation & password recovery
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.complete_employee_activation(
  p_auth_user_id UUID,
  p_chosen_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user RECORD;
  v_clean_user TEXT;
  v_has_password BOOLEAN;
BEGIN
  -- Normalize chosen username
  v_clean_user := LOWER(TRIM(p_chosen_username));

  IF v_clean_user IS NULL OR LENGTH(v_clean_user) < 3 OR LENGTH(v_clean_user) > 30 THEN
    RAISE EXCEPTION 'اسم المستخدم غير صالح: يجب أن يكون بين 3 و 30 حرفاً.';
  END IF;

  -- 1. Find user by auth_user_id
  SELECT * INTO v_user
  FROM public.app_users
  WHERE auth_user_id = p_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم يتم العثور على سجل وظيفي مرتبط بجلسة الدعوة.';
  END IF;

  -- Strict single-use enforcement: if account is already active, reject re-activation
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
     OR email = v_user.email;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'activated',
    'message', 'تم تفعيل حسابك واختيار اسم المستخدم بنجاح.',
    'username', v_clean_user,
    'employee_id', v_user.employee_id
  );
END;
$$;

-- Grant column permissions to authenticated users for the employee profile attributes
GRANT SELECT (employee_id, email, department, telegram_user_id) 
  ON public.app_users TO authenticated;

-- Ensure service_role and authenticated permissions on registration_approval_settings if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'registration_approval_settings') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.registration_approval_settings TO service_role;
    GRANT SELECT ON public.registration_approval_settings TO authenticated;
  END IF;
END $$;

