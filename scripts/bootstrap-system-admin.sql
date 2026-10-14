-- ==============================================================================
-- سكريبت تهيئة صلاحيات حساب السيستم أدمن الثابت (marwan-desouky)
-- تنبيه أمني: لا يحتوي هذا الملف على أي كلمات مرور أو أسرار نهائياً.
-- المتطلب المسبق: إنشاء المستخدم marwan-desouky@warehouse.local يدوياً من لوحة
-- تحكم Supabase Dashboard (Authentication -> Users -> Add User) بكتابة الباسورد هناك مباشرة.
-- يرجى مراجعة هذا السكريبت والتأكد من توافق المتغيرات قبل تنفيذه في SQL Editor.
-- ==============================================================================

DO $$
DECLARE
  v_admin_email CONSTANT TEXT := 'marwan-desouky@warehouse.local';
  v_admin_username CONSTANT TEXT := 'marwan-desouky';
  v_auth_id UUID;
  v_app_user_exists BOOLEAN;
BEGIN
  -- 1. التحقق من وجود حساب Auth في جدول auth.users بالبريد المحدد حصراً
  SELECT id INTO v_auth_id
  FROM auth.users
  WHERE email = v_admin_email;

  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'المستخدم (%) غير موجود في auth.users. يرجى إنشاؤه أولاً من لوحة تحكم Supabase (Authentication -> Add user).', v_admin_email;
  END IF;

  -- 2. تحديث raw_app_meta_data في auth.users فقط لتثبيت دور السيستم أدمن والصلاحيات
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'username', v_admin_username,
    'role', 'system_admin',
    'system_admin', true,
    'permissions', jsonb_build_array('view_audit', 'view_settings', 'manage_records'),
    'must_change_password', false
  ),
  updated_at = now()
  WHERE email = v_admin_email;

  -- 3. ربط auth_user_id في جدول public.app_users دون لمس أي عمود آخر إطلاقاً
  SELECT EXISTS(
    SELECT 1 FROM public.app_users WHERE username = v_admin_username
  ) INTO v_app_user_exists;

  IF v_app_user_exists THEN
    UPDATE public.app_users
    SET auth_user_id = v_auth_id
    WHERE username = v_admin_username;

    RAISE NOTICE 'تم بنجاح تحديث صلاحيات السيستم أدمن وربط auth_user_id للمستخدم (%) بالمعرف (%)', v_admin_username, v_auth_id;
  ELSE
    -- لو لم يكن الصف موجوداً في app_users، يتم إنشاؤه بالحد الأدنى الآمن
    INSERT INTO public.app_users (
      username,
      display_name,
      role,
      status,
      permissions,
      auth_user_id,
      created_at
    ) VALUES (
      v_admin_username,
      'مروان دسوقي (مدير النظام)',
      'admin',
      'active',
      jsonb_build_array('view_audit', 'view_settings', 'manage_records'),
      v_auth_id,
      now()
    );

    RAISE NOTICE 'تم بنجاح إنشاء صف السيستم أدمن في app_users وربطه بالمعرف (%)', v_auth_id;
  END IF;

END $$;
