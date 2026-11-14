-- ==============================================================================
-- سكريبت تهيئة صلاحيات حساب السيستم أدمن الثابت (marwan-desouky)
-- تنبيه أمني: لا يحتوي هذا الملف على أي كلمات مرور أو أسرار نهائياً،
-- ولا يعدّل جدول auth.users مباشرةً بل يستخدم دالة public.bootstrap_system_admin
-- المحصورة بدور service_role.
-- المتطلب المسبق: إنشاء/دعوة المستخدم من لوحة Supabase Dashboard
-- (Authentication -> Users -> Add user / Invite user) وتأكيد البريد الإلكتروني.
-- ==============================================================================

SELECT public.bootstrap_system_admin(
  'YOUR_ADMIN_EMAIL_HERE',           -- البريد الإلكتروني المؤكد في auth.users
  'marwan-desouky',                  -- اسم المستخدم الإداري المعتمد
  'YOUR_AUTH_USER_UUID_HERE'::UUID   -- المعرف الحقيقي UUID من auth.users
);
