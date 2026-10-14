# دليل الهجرات المعلّقة (Pending Migrations)

يحتوي هذا المجلد على ملفات هجرات الأمان المشددة (مثل سياسات حماية مستوى الصف RLS) المعزولة عمداً لمنع تنفيذها التلقائي بواسطة `supabase db push` قبل اكتمال مرحلة النقل التدريجي (Zero-Lockout Transitional Phase).

---

## متى يُنقل هذا الملف إلى `supabase/migrations/`؟
يمنع نقل هذا الملف إلا بعد استيفاء الشروط التالية بالكامل والحصول على موافقة صريحة من صاحب المشروع:

1. **اكتمال تجهيز حساب السيستم أدمن الثابت:**
   تم إنشاء `marwan-desouky@warehouse.local` وتنفيذ `scripts/bootstrap-system-admin.sql` والتحقق من قدرته على تسجيل الدخول.
2. **نشر وظائف الحافة (Edge Functions):**
   نشر دالتي `admin-users` و`login-bridge` بنجاح على مشروع Supabase.
3. **نشر الواجهة بالوضع الانتقالي:**
   نشر التطبيق بمتغير بيئة `VITE_AUTH_MODE=transitional` ليتمكن موظفو المستودع من تسجيل الدخول الأول وترقية حساباتهم إلى Supabase Auth تلقائياً دون إغلاق وصولهم.
4. **التحقق من ربط كافة المستخدمين:**
   التأكد من أن جميع الموظفين النشطين يمتلكون صفوفاً مرتبطة بـ `auth_user_id` صالح في جدول `app_users`.
5. **موافقة صاحب المشروع:**
   موافقة يدوية بعد مراجعة جاهزية فرق العمل.

---

## كيف يتم نقل وتنفيذ الملف؟

1. نقل الملف باستخدام Git للحفاظ على تاريخه:
   ```bash
   git mv supabase/pending/20261013213000_harden_rls.sql supabase/migrations/
   ```
2. تطبيق الهجرة على قاعدة البيانات:
   - إما عبر Supabase CLI:
     ```bash
     supabase db push
     ```
   - أو بنسخ محتوى الملف ولصقه وتنفيذه داخل **Supabase SQL Editor**.
3. **في حال الطوارئ أو الحاجة للتراجع:**
   يتوفر سكريبت التراجع الجاهز في:
   [`supabase/rollbacks/20261013213000_harden_rls_rollback.sql`](file:///c:/Users/Glory/warehouse-ledger/supabase/rollbacks/20261013213000_harden_rls_rollback.sql)
