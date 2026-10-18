# تقرير حالة المشروع: التعديلات المنفذة والمهام المتبقية
**المشروع:** `warehouse-ledger`  
**الفرع الحالي:** `fix/registration-security`  
**التاريخ:** 18 أكتوبر 2026  
**حالة الاختبارات والأنواع:** ✅ نجاح 358 من أصل 358 اختباراً في Vitest (40 ملف اختبار بنسبة 100%)، و `tsc -b` بدون أي أخطاء (0 errors)، وبناء الإنتاج `npm run build` مكتمل بنجاح (Code 0).

---

## أولاً: التعديلات التي تم تنفيذها بالكامل داخل الكود والمستودع (الجلسات A إلى E)

تم إنجاز كافة متطلبات التحصين والمعالجة في مستودع المشروع محلياً وفق القواعد الصارمة لسلامة البيانات وعدم فقدان أي سجل تجاري:

### 1. الجلسة A: تحصين حساب مسؤول النظام وإغلاق دوال RPC ذات الصلاحيات العالية
- ✅ **حظر الحذف والتعديل بحق حساب مسؤول النظام:**
  - إنشاء الهجرة `supabase/migrations/20261014120000_protected_system_admin.sql` مع Triggers تمنع أي حذف أو تعديل حتى لو صدر من `service_role`.
- ✅ **قفل الدوال الحساسة وتهيئة مسؤول النظام أحادياً:**
  - إنشاء الهجرة `supabase/migrations/20261017130000_lockdown_privileged_functions_and_bootstrap.sql` لقفل دوال RPC وسحب الصلاحيات من `PUBLIC`.
  - توفير دالة `bootstrap_system_admin` للتهيئة لمرة واحدة فقط دون أي أسرار أو كلمات مرور في السورس.
  - توثيق الإجراء في `scripts/bootstrap-system-admin.md` وسكريبت `scripts/bootstrap-system-admin.sql`.

### 2. الجلسة B: تحصين بوت تيليجرام وتوثيق البريد الإلكتروني
- ✅ **التحقق من توقيع Webhook (HMAC Secret):**
  - فرض التحقق من `x-telegram-bot-api-secret-token` ورفض أي طلب لا يحمل التوقيع المتطابق برمز 401.
- ✅ **مكافحة الإغراق وتتبع التحديثات:**
  - إنشاء الهجرة `supabase/migrations/20261017140000_telegram_bot_hardening_and_email_verification.sql` مع جداول Rate Limiting ومنع معالجة الـ Update مكرراً بناءً على قيد `23505`.
  - تسليم رموز OTP عبر البريد (Resend و Gmail SMTP) مع تعمية الرموز بـ SHA-256 + Pepper وعدم طباعتها في السجلات إطلاقاً.

### 3. الجلسة C: منظومة التسجيل، مصفوفة التفويض، وسجل الأكواد
- ✅ **هيكلة طلبات التسجيل والتفويض:**
  - إنشاء الهجرة `supabase/migrations/20261017150000_approval_delegation_code_registry_and_rls.sql` لتسجيل الموظفين ومصفوفة تفويض الأقسام وحماية سجل الأكواد.
  - إنشاء دالة الحافة `supabase/functions/user-registration/index.ts` لمعالجة الطلبات بالتحقق الثنائي دون كتابة كلمات مرور.

### 4. الجلسة D: معالج التسجيل المتدرج (Wizard) وحفظ الجلسات
- ✅ **جلسات المعالج المتدرج:**
  - إنشاء الهجرة `supabase/migrations/20261017160000_telegram_user_sessions.sql` لإدارة حالة المعالج خطوة بخطوة.
  - دعم تدفق الأوامر `/start`، `/status`، و `/cancel` محصورة بهوية صاحب الحساب فقط.

### 5. الجلسة E: معالجة الثغرات والعيوب المتبقية (F1 إلى F8)
- ✅ **F1 — حظر وإلغاء الهجرة التدميرية `20261017210000_reset_users_and_pin_admin.sql`:**
  - تأكيد خطورة الهجرة غير المعتمدة لعزلها وحذفها الجماعي لبيانات `auth.users` و `app_users` واحتوائها على كلمة مرور مشفرة ثابتة.
  - نقل الملف إلى `supabase/pending/rejected/20261017210000_reset_users_and_pin_admin.sql.REJECTED` بعد تطهير كلمة المرور واستبدالها بـ `<REMOVED>`.
  - إضافة `supabase/pending/rejected/README.md` يشرح أسباب الرفض (منع المساس ببيانات العمل ومخطط المصادقة).
  - توثيق بديل التهيئة غير التدميري في `scripts/bootstrap-system-admin.md`.
  - تدقيق كامل للمستودع لجميع عبارات `DELETE`، `TRUNCATE`، و `DROP TABLE`.
- ✅ **F2 — إزالة كلمة مرور الأدمن الثابتة من `supabase/functions/admin-users/index.ts`:**
  - إزالة المتغير `expectedAdminPassword` الثابت في الدالة `reset_and_seed_system_admin`.
  - استبدال المنطق برد خطأ 400 يوجه لاستخدام إجراء التهيئة الآمن أو استعادة كلمة المرور عبر Supabase Auth.
  - مسح شامل للمستودع للتأكد من خلوه من أي كلمات مرور ثابتة.
  - إضافة اختبار مسح أمني ثابت `tests/unit/noHardcodedPasswords.test.ts` لمنع كتابة أي كلمات مرور في دوال الحافة.
- ✅ **F3 — تصحيح فحص الأنواع واجتياز بناء المشروع الإنتاجي:**
  - التحقق من صفحة `src/pages/UsersPage.tsx` وإصلاح توافق أنواع العقدة (Node types) في ملفات الاختبار.
  - اجتياز `tsc -b` بالكامل (0 errors) ونجاح `npm run build` بنجاح كامل.
- ✅ **F4 — إزالة استدعاء `listUsers()` من جسر الدخول `supabase/functions/login-bridge/index.ts`:**
  - حذف استدعاء `listUsers` نهائياً لمنع تعداد المستخدمين.
  - حصر استرجاع الهوية بدقة عبر `getUserById(appUser.auth_user_id)`، مع إرجاع رسالة خطأ عربية عامة وموحدة عند عدم وجود حساب مصادقة.
  - تحديث وتوسيع اختبارات `tests/unit/loginBridge.test.ts` للتحقق من عدم استدعاء `listUsers`.
- ✅ **F5 — استعادة ملف `.env.example` بقيم نائبة فارغة:**
  - استعادة الملف عبر Git وتعبئته بكافة المتغيرات المقروءة في الكود (`import.meta.env` و `Deno.env.get`) بقيم فارغة تماماً وتوضيحات موجزة دون أي أسرار.
- ✅ **F6 — مراجعة أمنية لمعالج تيليجرام وجدول الجلسات المؤقتة:**
  - تحصين `telegram_user_sessions` بسحب الصلاحيات من `PUBLIC, anon, authenticated` وقصرها على `service_role`.
  - إضافة تنظيف دوري محدد بـ 24 ساعة للجلسات المهجورة داخل كود البوت ومقترح الهجرة.
  - التأكد من خلو سجلات الطباعة ورسائل البوت من أي رموز OTP، وقصر إرسالها على البريد الإلكتروني.
  - إضافة اختبار شامل لتحصين المعالج `tests/unit/telegramWizardSecurity.test.ts` (9 اختبارات ناجحة).
- ✅ **F7 — تحليل ضوضاء نهايات الأسطر (CRLF/LF):**
  - تشخيص السبب الكامن في إعداد `core.autocrlf` في بيئة ويندوز.
  - التحقق من نقاء التعديلات عبر `git diff --ignore-cr-at-eol --stat` (10 ملفات فقط هي المعدلة فعلياً).
  - اقتراح ملف `.gitattributes` لاعتماده من مالك المشروع.
- ✅ **F8 — توثيق سلامة البيانات للهجرات:**
  - إعداد جدول سلامة البيانات التفصيلي لكافة هجرات الفرع، والتأكد من أنها تراكمية بالكامل ولا تمس بيانات الأعمال.
  - تأكيد بقاء ملف الهجرة الحساس `20261017153000_enforce_active_status_on_business_tables.sql` داخل `supabase/pending/` كمقترح للمراجعة فقط.

---

## ثانياً: المهام العملية اليدوية المتبقية لمالك المشروع (Project Owner Manual Steps)

تتطلب هذه الإجراءات وصول مالك النظام إلى لوحة تحكم Supabase ومزودي الخدمات الخارجية (Resend، Gmail، Telegram)، ويجب إجراؤها بعناية:

### 1. تدوير وتغيير كلمة مرور مسؤول النظام فوراً (Credential Rotation)
- **السبب:** كلمة المرور السابقة كانت مسجلة في التزامات Git سابقة على المستودع (`8ee6ca8` و `bd3da4b`)، ولذلك يجب التعامل معها على أنها مخترقة ومكشوفة بالكامل.
- **الإجراء:**
  1. افتح **Supabase Dashboard** -> انتقل إلى **Authentication** -> **Users**.
  2. ابحث عن حساب مسؤول النظام (`marwan-desouky@warehouse.local`).
  3. اضغط على خيارات الحساب واختر **Send password recovery** أو قم بتعيين كلمة مرور جديدة قوية وفريدة عبر لوحة التحكم.
  4. إذا كانت كلمة المرور هذه قد استُخدمت في أي خدمة أخرى، يجب تغييرها فوراً في تلك الخدمات.

### 2. تدوير المفاتيح والأسرار الخارجية (Secrets Rotation)
- قم بتدوير وتحديث أي مفاتيح أو رموز كانت متداولة أو مسجلة في ملفات `.env` محلية سابقة:
  - `TELEGRAM_BOT_TOKEN`: عبر BotFather على تيليجرام.
  - `TELEGRAM_WEBHOOK_SECRET`: إنشاء سر عشوائي قوي وتحديثه في إعدادات Webhook.
  - `RESEND_API_KEY`: توليد مفتاح جديد من لوحة تحكم Resend وإلغاء القديم.
  - `SMTP_PASSWORD`: إنشاء كلمة مرور تطبيق جديدة (App Password) لحساب Gmail.
  - `REGISTRATION_OTP_PEPPER`: تعيين قيمة عشوائية جديدة عبر `Deno.env` / Supabase Secrets.
  - `SUPABASE_SERVICE_ROLE_KEY`: إذا تم تداولها خارج بيئة التطوير المحمية.

### 3. تطبيق الهجرات على بيئة تجريبية أولاً (Staging Migration)
- قبل تطبيق أي هجرة على قاعدة البيانات الحية، قم بتشغيلها على مشروع تجريبي (Staging / Local Supabase):
  - الهجرات الآمنة المعتمدة في `supabase/migrations/`:
    1. `20261017120000_employee_registration_and_identity.sql`
    2. `20261017130000_lockdown_privileged_functions_and_bootstrap.sql`
    3. `20261017140000_telegram_bot_hardening_and_email_verification.sql`
    4. `20261017150000_approval_delegation_code_registry_and_rls.sql`
    5. `20261017160000_telegram_user_sessions.sql`

### 4. مراجعة المقترحات المعلقة في `supabase/pending/`
- الملفات التالية هي مقترحات **فقط** ولم تُطبق وتنتظر موافقتك اليدوية:
  - `supabase/pending/20261013213000_harden_rls.sql`: تشديد سياسات RLS على جداول النظام (يطبق بعد اكتمال ترقية جميع الموظفين).
  - `supabase/pending/20261017153000_enforce_active_status_on_business_tables.sql`: قيود التحقق من حالة الموظف النشط على جداول الحركات والعهد.
  - `supabase/pending/20261018130000_harden_telegram_user_sessions.sql`: إضافة قفل إضافي لصلاحيات جدول الجلسات ووظيفة التنظيف الدوري التلقائي.

### 5. نشر وظائف الحافة (Edge Functions) بعد المراجعة
- بعد مراجعة الكود وإعداد الأسرار في Supabase Secrets، يتم نشر الدوال عبر Supabase CLI:
  ```bash
  supabase functions deploy admin-users
  supabase functions deploy login-bridge
  supabase functions deploy telegram-bot
  supabase functions deploy user-registration
  ```

---

## ثالثاً: ملخص قياسات الجودة والتحقق الأمني

| الفحص | الأداة | النتيجة | الحالة |
| :--- | :--- | :--- | :---: |
| فحص الأنواع | `tsc -b` | 0 أخطاء | ✅ سليم |
| وحدة الاختبارات | `vitest run` | 358 اختبار ناجح من أصل 358 (40 ملف اختبار) | ✅ سليم بنسبة 100% |
| فحص الجودة والتنسيق | `oxlint .` | 0 أخطاء (42 تحذير أسلوبي غير حرج) | ✅ سليم |
| بناء حزمة الإنتاج | `npm run build` | اكتمل البناء في 2.31 ثانية | ✅ جاهز للإنتاج |
| سلامة البيانات | فحص يدوي واستعلامات AST | عدم وجود أي أوامر حذف لبيانات العمل | ✅ مؤكد |
