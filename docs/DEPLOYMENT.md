# دليل النشر الشامل والتشغيل في بيئة الإنتاج (Deployment & Operations Guide)
**المشروع:** `warehouse-ledger`  
**الفرع الحالي:** `fix/registration-security`  
**تاريخ التحديث:** 18 أكتوبر 2026  
**حالة البناء والاختبارات:** ✅ اجتياز 358/358 اختباراً في Vitest، وفحص الأنواع `tsc -b` خالٍ من الأخطاء (0 errors)، وحزمة الإنتاج `dist/` مبنية بنجاح.

---

## 1. نظرة عامة على معمارية النشر (Architecture Overview)

- **الواجهة الأمامية (Frontend):** 
  - مبنية بتقنية Vite + React 19 + TypeScript + Tailwind CSS.
  - واجهة عربية بالكامل (RTL) مع دعم وضع عدم الاتصال (Offline-First / PWA).
  - تُنشر كأصول ثابتة (SPA) على منصة **Vercel** أو أي خادم ويب ثابت (Cloudflare Pages, Netlify).
- **الواجهة الخلفية وقاعدة البيانات (Backend & Database):**
  - تدار بواسطة **Supabase (PostgreSQL 15+)**.
  - محكومة بسياسات أمان صارمة على مستوى السجلات (Row Level Security - RLS).
  - تستخدم **Supabase Edge Functions (Deno Runtime)** لتنفيذ العمليات الإدارية الحساسة بمفتاح الخدمة السري (`service_role`).
  - معالج تسجيل تفاعلي عبر بوت تيليجرام وتوثيق البريد الإلكتروني برموز OTP آمنة.
- **نمطا المصادقة (Dual-Mode Authentication):**
  - `transitional` (الوضع الانتقالي الافتراضي): يتيح تسجيل الدخول السلس دون انقطاع لأي موظف عبر جسر الدخول الآمن `login-bridge` وترقية الحسابات تلقائياً.
  - `secure`: يعتمد كلياً على مصادقة Supabase Auth الرسمية ورموز JWT المشفرة.

---

## 2. المتطلبات المسبقة (Prerequisites)

قبل البدء في النشر، تأكد من توفر الآتي:
1. **Node.js** (الإصدار 18 أو 20 أو 22) ومدير الحزم **npm**.
2. حساب على [Supabase](https://supabase.com) مع مشروع سحابي جاهز.
3. حساب على [Vercel](https://vercel.com) مرتبط بمستودع المشروع (GitHub).
4. تثبيت أداة **Supabase CLI** محلياً على جهازك:
   ```bash
   npm install -g supabase
   ```
5. حسابات مزودي الخدمات الخارجية:
   - بوت تيليجرام عبر BotFather.
   - حساب [Resend](https://resend.com) أو حساب بريد Gmail مفعل فيه كلمة مرور التطبيق (App Password) لإرسال رسائل التحقق.

---

## 3. متغيرات البيئة والمفاتيح السرية (Environment Variables & Secrets)

### أ. متغيرات بيئة الواجهة الأمامية (Frontend / Vercel / `.env`)
| المتغير | الوصف | مثال | إلزامي؟ |
| :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | رابط مشروع Supabase الخاص بك | `https://xyzproject.supabase.co` | نعم |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | المفتاح العام للمشروع (Anon/Publishable Key) | `sb_publishable_...` | نعم |
| `VITE_AUTH_MODE` | نمط المصادقة (`transitional` أثناء النشر المبدئي، ثم `secure` لاحقاً) | `transitional` أو `secure` | نعم (الافتراضي `transitional`) |

> [!CAUTION]
> **تحذير أمني صارم:** لا تقم أبداً بوضع مفتاح `service_role` السري في ملفات `.env` أو متغيرات Vercel للواجهة الأمامية. المفتاح العام فقط (`VITE_SUPABASE_PUBLISHABLE_KEY` أو `anon key`) هو المخصص للاستخدام داخل المتصفح.

### ب. المفاتيح السرية لدوال السحابة (Supabase Edge Functions Secrets)
يتم تعيين هذه المتغيرات داخل Supabase عبر لوحة التحكم (**Project Settings** -> **Edge Functions**) أو عبر الأمر `supabase secrets set`:

| المتغير | الوصف | المصدر / الاستخدام |
| :--- | :--- | :--- |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة السري لإدارة المستخدمين في Auth و DB | لوحة تحكم Supabase API Keys |
| `TELEGRAM_BOT_TOKEN` | توكن بوت التيليجرام | BotFather على تيليجرام |
| `TELEGRAM_WEBHOOK_SECRET` | رمز الحماية السري للتحقق من طلبات Webhook | سلسلة عشوائية قوية تولدها بنفسك |
| `RESEND_API_KEY` | مفتاح خدمة إرسال البريد الإلكتروني | لوحة تحكم منصة Resend |
| `SMTP_HOST` | خادم SMTP (اختياري، مثل `smtp.gmail.com`) | إعدادات البريد الإلكتروني |
| `SMTP_PORT` | منفذ SMTP (مثل `465` أو `587`) | إعدادات البريد الإلكتروني |
| `SMTP_USER` | اسم مستخدم SMTP / البريد المرسل | بريد النظام |
| `SMTP_PASSWORD` | كلمة مرور التطبيق لخادم SMTP | كلمات مرور التطبيقات (App Passwords) |
| `REGISTRATION_OTP_PEPPER` | ملح إضافي لتشفير رموز OTP قبل مقارنتها بـ SHA-256 | سلسلة سرية عشوائية |
| `BOOTSTRAP_ADMIN_IDENTITY` | معرّف أو بريد مسؤول النظام المصرح له بالتهيئة | `marwandesouqhi@gmail.com` |

---

## 4. إعداد قاعدة البيانات والترحيلات (Database Migrations)

يحتوي المستودع على ملفات ترحيل SQL مرتبة زمنياً في مجلد `supabase/migrations/`.

### ترتيب تطبيق الترحيلات المعتمدة:
قم بتطبيق الملفات بالترتيب الزمني إما عبر Supabase CLI (`supabase db push`) أو عبر **Supabase SQL Editor**:

1. `0001_init.sql` — الجداول الأساسية لحركات المخزن والأصناف.
2. `20261010161551_create_user_movements.sql` — تخصيص الحركات لكل مستخدم.
3. `20261010200500_create_audit_logs_and_invitations.sql` — سجل التدقيق ودعوات المستخدمين.
4. `20261010204500_harden_admin_security.sql` — حماية صلاحيات الأدمن.
5. `20261011153000_restrict_audit_logs_to_system_admin.sql` — حصر سجل التدقيق على مدير النظام.
6. `20261011213000_enable_seamless_cloud_sync.sql` — مزامنة السحابة التلقائية ودعم العمل دون إنترنت.
7. `20261011220000_create_app_users_table.sql` — جدول مستخدمي التطبيق (`app_users`).
8. `20261011221500_fix_audit_logs_permissions.sql` — تصحيح أذونات سجل العمليات.
9. `20261013190000_additive_roles_permissions.sql` — إضافة حقول الصلاحيات الموسعة (`permissions`).
10. `20261013193000_purchases_idempotency.sql` — حماية عمليات الشراء من التكرار العرضي.
11. `20261013200000_transfers_custody_sources.sql` — دعم حركات التحويل وصرف العهدة من أي مخزن.
12. `20261013210000_security_hardening_schema.sql` — دالة `record_purchase` الذرية وميزات الأمان المعززة.
13. `20261013220000_remove_username_privilege_escalation.sql` — إزالة أي تصعيد صلاحيات يعتمد على اسم المستخدم وحده.
14. `20261014120000_protected_system_admin.sql` — تحصين حساب مسؤول النظام الثابت `marwan-desouky` ضد الحذف والتعديل.
15. `20261014120001_login_attempts.sql` — جدول تتبع محاولات الدخول الفاشلة ومكافحة التخمين.
16. `20261014130000_fix_record_purchase_rpc.sql` — تصحيح دالة تسجيل المشتريات الذرية وضمان اتساق العهدة.
17. `20261014140000_procurement_module.sql` — جداول موديول المشتريات، الموردين، طلبات الشراء، عروض الأسعار، وأوامر الشراء.
18. `20261017120000_employee_registration_and_identity.sql` — موديول تسجيل الموظفين وتوثيق الهوية المؤسسية.
19. `20261017130000_lockdown_privileged_functions_and_bootstrap.sql` — قفل دوال RPC وتوفير دالة التهيئة الأحادية الآمنة لمدير النظام.
20. `20261017140000_telegram_bot_hardening_and_email_verification.sql` — تحصين بوت تيليجرام وتوثيق البريد برموز OTP.
21. `20261017150000_approval_delegation_code_registry_and_rls.sql` — سجل الأكواد ومصفوفة تفويض الأقسام وسياسات RLS.
22. `20261017160000_telegram_user_sessions.sql` — جدول إدارة جلسات معالج التسجيل المتدرج.

> [!WARNING]
> **تنبيه أمني بخصوص الملفات المعلقة والمرفوضة:**
> - تم **رفض وحظر** الملف `20261017210000_reset_users_and_pin_admin.sql` ونقله إلى `supabase/pending/rejected/` لمنع أي حذف تدميري لبيانات المستخدمين ومصادقة النظام.
> - الملفات الموجودة في `supabase/pending/` (`20261013213000_harden_rls.sql` و `20261017153000_enforce_active_status_on_business_tables.sql` و `20261018130000_harden_telegram_user_sessions.sql`) هي مقترحات تنتظر المراجعة اليدوية للمالك ولا تُطبق مباشرة.

---

## 5. نشر وظائف السحابة (Edge Functions Deployment)

يشتمل النظام على دوال سحابية متخصصة ومحصنة داخل `supabase/functions/`:
1. `admin-users` — إدارة حسابات المستخدمين مع حظر تعديل حساب مسؤول النظام والتحقق من التوقيع.
2. `login-bridge` — جسر الدخول الآمن بمقارنة زمنية ثابتة ومكافحة التخمين، دون تعداد المستخدمين.
3. `telegram-bot` — معالج التسجيل التفاعلي والتحقق من توقيع Webhook وإرسال OTP عبر البريد.
4. `user-registration` — معالجة واعتماد طلبات تسجيل الموظفين وفق مصفوفة التفويض.
5. `invite-user` — إنشاء وتوثيق دعوات المستخدمين الجدد.
6. `migrate-users` — ترحيل المستخدمين بضغطة زر إلى Supabase Auth.
7. `verify-email` — التحقق من صحة عناوين البريد الإلكتروني.

### أوامر النشر عبر Supabase CLI:
```bash
# 1. تسجيل الدخول
supabase login

# 2. ربط المشروع السحابي
supabase link --project-ref YOUR_PROJECT_REF

# 3. ضبط المفاتيح السرية
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
supabase secrets set TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
supabase secrets set TELEGRAM_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET"
supabase secrets set RESEND_API_KEY="YOUR_RESEND_KEY"
supabase secrets set REGISTRATION_OTP_PEPPER="YOUR_RANDOM_PEPPER"

# 4. نشر الدوال السحابية
supabase functions deploy admin-users
supabase functions deploy login-bridge
supabase functions deploy telegram-bot
supabase functions deploy user-registration
supabase functions deploy invite-user
supabase functions deploy migrate-users
supabase functions deploy verify-email
```

---

## 6. تهيئة حساب مدير النظام (Bootstrap System Admin)

يتم ضبط الحساب دون أي كلمات مرور نصية في الكود وفق الدليل في [`scripts/bootstrap-system-admin.md`](file:///c:/Users/Glory/warehouse-ledger/scripts/bootstrap-system-admin.md):

1. **إنشاء الحساب في Supabase Auth:**
   - من **Authentication** -> **Users** -> **Add user** -> **Create user**.
   - البريد: `marwandesouqhi@gmail.com` (أو `marwan-desouky@warehouse.local`).
   - تعيين كلمة مرور قوية وتفعيل **Auto Confirm User**.
2. **استدعاء دالة التهيئة الأحادية الآمنة في SQL Editor:**
   ```sql
   SELECT public.bootstrap_system_admin(
     'marwandesouqhi@gmail.com',
     'marwan-desouky',
     'YOUR_AUTH_USER_UUID_HERE'::UUID
   );
   ```
3. في حال الرغبة في تعيين كلمة مرور جديدة لاحقاً، يتم إرسال رابط آمن عبر خيار **Send password recovery** في لوحة تحكم Supabase.

---

## 7. نشر الواجهة الأمامية على Vercel (Frontend Deployment)

1. ادخل إلى [Vercel Dashboard](https://vercel.com) واضغط **Add New...** -> **Project**.
2. اربط مستودع المشروع (الفرع `fix/registration-security` أو الفرع الرئيسي بعد الدمج).
3. إعدادات البناء:
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
4. إضافة متغيرات البيئة في **Environment Variables**:
   ```env
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-publishable-key>
   VITE_AUTH_MODE=transitional
   ```
5. اضغط **Deploy**.

---

## 8. مراحل الإطلاق التدريجي وضمان عدم القفل (Zero-Lockout Phased Rollout)

```
[ المرحلة 1: نشر الواجهة بـ transitional ] ──> [ المرحلة 2: نشر Edge Functions ] ──> [ المرحلة 3: تفعيل الموظفين ]
                                                                                             │
[ المرحلة 6: قفل RLS المشدد ] <── [ المرحلة 5: التحويل إلى secure ] <── [ المرحلة 4: التحقق والاختبار ]
```

1. **المرحلة 1: النشر بالوضع الانتقالي (`VITE_AUTH_MODE=transitional`):**
   - يتيح لكافة الموظفين الدخول دون أي انقطاع، ويقوم جسر الدخول بترقية حساباتهم تدريجياً.
2. **المرحلة 2: نشر وظائف السحابة وإعداد أسرارها:**
   - نشر دوال الحافة وضبط أسرار تيليجرام والبريد ومفتاح الخدمة.
3. **المرحلة 3: تسجيل الموظفين وربط الهويات:**
   - استخدام معالج تيليجرام أو تسجيل الدخول الأول لربط البريد وتوليد أكواد الموظفين.
4. **المرحلة 4: التحقق والاختبار الشامل:**
   - التأكد من قدرة كل دور على أداء مهامه الوظيفية بنجاح.
5. **المرحلة 5: التبديل إلى الوضع المشدد (`VITE_AUTH_MODE=secure`):**
   - تغيير المتغير في Vercel إلى `secure` وإعادة النشر.
6. **المرحلة 6: تفعيل سياسات RLS المشددة:**
   - مراجعة وتطبيق ملف [`supabase/pending/20261013213000_harden_rls.sql`](file:///c:/Users/Glory/warehouse-ledger/supabase/pending/20261013213000_harden_rls.sql) في SQL Editor لقفل الجداول وسحب أي صلاحيات عامة.

---

## 9. خطة الطوارئ والتراجع الفوري (Emergency Rollback Plan)

في حال حدوث أي طارئ أو عائق أثناء الانتقال:
1. **الرجوع الفوري للواجهة الأمامية:**
   - تغيير `VITE_AUTH_MODE=transitional` في إعدادات Vercel ثم الضغط على **Redeploy**.
2. **التراجع عن سياسات RLS المشددة:**
   - تشغيل سكريبت التراجع الجاهز:
     [`supabase/rollbacks/20261013213000_harden_rls_rollback.sql`](file:///c:/Users/Glory/warehouse-ledger/supabase/rollbacks/20261013213000_harden_rls_rollback.sql)
     داخل Supabase SQL Editor لإعادة فتح الصلاحيات فوراً.

---

## 10. قائمة التحقق بعد النشر (Post-Deployment Verification Checklist)

- [ ] تشغيل الواجهة عبر HTTPS وظهور ترويسات الأمان (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).
- [ ] تسجيل الدخول بحساب مدير النظام (`marwan-desouky`).
- [ ] التأكد من حجب صفحة المستخدمين والإعدادات وسجلات التدقيق عن الموظفين العاديين.
- [ ] تجربة تسجيل فاتورة مشتريات جديدة والتحقق من مزامنتها في السحابة.
- [ ] تجربة حركة صرف أو تحويل في العهدة والتحقق من خصم الرصيد الذري.
- [ ] اختبار بوت تيليجرام وإرسال رمز التحقق OTP إلى البريد الإلكتروني.
- [ ] اختبار وضع عدم الاتصال (قطع الإنترنت والتأكد من استمرار عمل الواجهة وسحب البيانات المخزنة محلياً).
