# دليل تهيئة حساب مدير النظام (Bootstrap System Admin)

> ⚠️ **ملاحظة هامة للمشروع:** يرجى استخدام الدليل المعتمد الأحدث والأكثر أماناً الخالي تماماً من الأسرار: [bootstrap-system-admin.md](./bootstrap-system-admin.md) وملف SQL المرفق معه [bootstrap-system-admin.sql](./bootstrap-system-admin.sql).

هذا الدليل مخصص لحالات **التثبيت الجديد كلياً (Fresh Install)** عند غياب أي حساب مدير نظام مسبق، أو لاستعادة الوصول الإداري بأمان تام **بدون كتابة كلمات مرور صريحة داخل كود المشروع أو ملفات Git**.

---

## 1. المتطلبات
- تثبيت Supabase CLI محلياً أو امتلاك صلاحيات الوصول إلى لوحة تحكم Supabase Dashboard.
- مفتاح `service_role` السري للمشروع (لا تشاركه ولا ترفعه في المستودع).

---

## 2. الطريقة الأولى: عبر Supabase Dashboard (موصى بها)

1. ادخل إلى لوحة تحكم مشروعك على Supabase.
2. انتقل إلى **Authentication** -> **Users** -> **Add user** -> **Create user**.
3. أدخل البيانات التالية:
   - **Email:** `marwan-desouky@warehouse.local`
   - **Password:** أدخل كلمة مرور قوية (8 أحرف وأرقام ورموز على الأقل).
   - **Auto Confirm User:** فعّل الخيار (`true`).
4. بعد إنشاء الحساب، اضغط على المستخدم ثم انتقل إلى خانة **User Metadata / App Metadata**:
   قم بتعيين `app_metadata` التالي:
   ```json
   {
     "username": "marwan-desouky",
     "role": "system_admin",
     "system_admin": true,
     "permissions": ["view_audit", "view_settings", "manage_records"],
     "must_change_password": false
   }
   ```
5. احفظ التعديلات.

---

## 3. الطريقة الثانية: عبر Supabase CLI أو سكريبت SQL في SQL Editor

يمكنك تشغيل الاستعلام التالي داخل **Supabase SQL Editor**:

```sql
DO $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
  v_admin_email TEXT := 'marwan-desouky@warehouse.local';
  -- ⚠️ استبدل القيمة أدناه بكلمة المرور الخاصة بك قبل التشغيل:
  v_plaintext_pw TEXT := 'YOUR_STRONG_PASSWORD_HERE';
BEGIN
  -- تشفير كلمة المرور بواسطة pgcrypto
  v_encrypted_pw := crypt(v_plaintext_pw, gen_salt('bf'));

  -- التحقق من عدم وجود المستخدم مسبقاً
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_admin_email;

  IF v_user_id IS NULL THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      v_admin_email,
      v_encrypted_pw,
      now(),
      '{"username": "marwan-desouky", "role": "system_admin", "system_admin": true, "permissions": ["view_audit", "view_settings", "manage_records"], "must_change_password": false}'::jsonb,
      '{"username": "marwan-desouky", "displayName": "مروان دسوقي (مدير النظام)"}'::jsonb,
      now(),
      now()
    ) RETURNING id INTO v_user_id;

    -- إضافة أو تحديث صف المرآة في جدول app_users
    INSERT INTO public.app_users (
      username,
      display_name,
      role,
      status,
      permissions,
      auth_user_id,
      created_at
    ) VALUES (
      'marwan-desouky',
      'مروان دسوقي (مدير النظام)',
      'admin',
      'active',
      '["view_audit", "view_settings", "manage_records"]'::jsonb,
      v_user_id,
      now()
    ) ON CONFLICT (username) DO UPDATE SET
      auth_user_id = EXCLUDED.auth_user_id,
      status = 'active';

    RAISE NOTICE 'تم إنشاء حساب مدير النظام بنجاح بالمعرف: %', v_user_id;
  ELSE
    RAISE NOTICE 'حساب مدير النظام موجود بالفعل بالمعرف: %', v_user_id;
  END IF;
END $$;
```

---

## 4. ملاحظات هامة حول الاتصال والعمل دون إنترنت (Offline / PWA)
1. **تسجيل الدخول الأول:** يتطلب اتصالاً بالسحابة (Supabase Cloud) للتحقق من هوية المستخدم وتوليد رمز الجلسة المشفر (JWT).
2. **وضع عدم الاتصال (Offline PWA):** يدعم استمرار العمل على الجلسة الحالية النشطة والتخزين المؤقت، ولكنه **لا يدعم تسجيل دخول جديد لأول مرة** دون اتصال بالإنترنت في الوضع الآمن (`secure`).
