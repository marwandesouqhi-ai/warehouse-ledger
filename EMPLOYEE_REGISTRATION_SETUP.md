# دليل تشغيل وضبط نظام تسجيل الموظفين وبوت تيليجرام والهوية الرقمية (Warehouse Ledger)

هذا الدليل يوضح البنية الهندسية وخطوات التثبيت والتهيئة لنظام تسجيل الموظفين الموحد، التحقق من البريد الإلكتروني، بوت تيليجرام، وتوليد الأكواد الوظيفية الفريدة (Unique IDs)، وتأمين حساب مدير النظام الرئيسي.

---

## 1. البنية المعمارية للنظام (System Architecture)

يتكامل النظام من خلال المكونات التالية:
1. **قاعدة بيانات Supabase PostgreSQL:**
   - جدول `app_users`: السجل المرجعي للموظفين (الأكواد الوظيفية `employee_id`، القسم `department`، الدور `role`، حالة الحساب `status`).
   - جدول `registration_requests`: استيعاب طلبات التسجيل الواردة من تيليجرام ومتابعة حالة التحقق من البريد والاعتماد.
   - تسلسلات الأكواد الوظيفية التراكمية (PostgreSQL Sequences) لتوليد الأكواد بالتسلسل دون تصادم.
   - دوال الترقية والاعتماد المخزنة (`bootstrap_system_admin` و `approve_employee_registration`).
2. **مزود المصادقة Supabase Auth:**
   - إدارة جلسات المستخدمين المشفرة ومصادقة كلمات المرور (Argon2/bcrypt) دون تخزين كلمات مرور بنصوص واضحة في جداول التطبيق.
3. **دوال الحافة (Supabase Edge Functions):**
   - `login-bridge`: جسر التحقق من اسم المستخدم أو الكود الوظيفي (Unique ID)، وفحص حالة الحساب ضد التعليق، والمصادقة عبر Supabase Auth.
   - `telegram-bot`: معالج تحديثات الويب هوك الخاص ببوت تيليجرام (`/start`, `/register`, `/status`, `/cancel`, `/verify`).
   - `verify-email`: التحقق الآمن من رمز OTP المرسل للبريد (صلاحية 10 دقائق، استخدام لمرة واحدة، تخزين بصمة الرمز المشفرة SHA-256).
   - `admin-users`: إدارة المستخدمين، الاعتماد، التعليق/إعادة التفعيل، والتأهيل الأولي لمدير النظام.
4. **تطبيق الويب الأمامي (Vite + React + TypeScript):**
   - صفحة تسجيل الدخول `src/pages/AuthPage.tsx`: تدعم اسم المستخدم أو الكود الوظيفي.
   - لوحة إدارة المستخدمين `src/pages/UsersPage.tsx`: دليل الموظفين، تصفية الأقسام، فلاتر الحالات، ومراجعة واعتماد طلبات تيليجرام.

---

## 2. إنشاء وتهيئة بوت تيليجرام (Telegram Bot Setup)

1. افتح تطبيق تيليجرام وتحدث إلى `@BotFather`.
2. أرسل الأمر `/newbot` واتبع التعليمات لتحديد اسم البوت واسم المستخدم (مثل `WarehouseLedgerBot`).
3. انسخ رمز التوكن السري المعطى لك (مثال: `123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ`).
4. اضبط قائمة الأوامر المتاحة للبوت عبر إرسال `/setcommands` لـ `@BotFather`:
   ```text
   start - بدء استخدام البوت وعرض التعليمات
   register - تقديم طلب تسجيل موظف جديد
   status - الاستعلام عن حالة طلب التسجيل
   verify - إدخال رمز التحقق للبريد الإلكتروني
   cancel - إلغاء طلب التسجيل الحالي
   ```

---

## 3. التخزين الآمن لمفاتيح وبيانات الاعتماد (Secure Secrets Storage)

- **تحذير أمني صارم:** لا تضع `TELEGRAM_BOT_TOKEN` أو `SUPABASE_SERVICE_ROLE_KEY` في ملفات الواجهة الأمامية أو مستودع Git.
- يتم تخزين هذه المفاتيح كأسرار خادم (Server Secrets) في Supabase:
  ```bash
  supabase secrets set TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
  supabase secrets set TELEGRAM_WEBHOOK_SECRET="your_random_secure_secret"
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"
  supabase secrets set APP_BASE_URL="https://your-domain.com"
  supabase secrets set EMAIL_PROVIDER="resend"
  supabase secrets set RESEND_API_KEY="re_your_api_key"
  supabase secrets set EMAIL_FROM="Warehouse Ledger <noreply@yourdomain.com>"
  ```

---

## 4. ضبط رابط الويب هوك (Webhook Setup)

بعد نشر دالة `telegram-bot`، قم بتسجيل رابط الويب هوك لدى خوادم تيليجرام مع الترويسة السرية للحماية:

```bash
curl -F "url=https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/telegram-bot" \
     -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

للتحقق من حالة الويب هوك:
```bash
curl https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/getWebhookInfo
```

---

## 5. إعدادات Supabase Auth

1. في لوحة تحكم Supabase، توجه إلى **Authentication** > **Providers** > **Email**.
2. تأكد من تفعيل مزود البريد الإلكتروني (Email Provider).
3. فعّل خيار تأكيد البريد الإلكتروني **Confirm email** إذا رغبت في إلزام المستخدمين بالتحقق المباشر من خلال Supabase Auth، أو اعتمد على التحقق عبر دالة OTP المدمجة في النظام.
4. اضبط خيارات أمان كلمات المرور (الحد الأدنى 12 حرفاً، أرقام ورموز).

---

## 6. تعليمات تطبيق ترحيل قاعدة البيانات (Database Migrations)

تضمن ملف الترحيل التالي التغييرات التراكمية الآمنة غير الهدامة:
`supabase/migrations/20261017120000_employee_registration_and_identity.sql`

لتطبيق الترحيل على قاعدة البيانات:

### الخيار أ: عبر Supabase CLI (الموصى به)
```bash
supabase db push
```

### الخيار ب: عبر SQL Editor في لوحة تحكم Supabase
1. افتح مشروعك في Supabase Dashboard.
2. ادخل إلى **SQL Editor**.
3. افتح ملف `supabase/migrations/20261017120000_employee_registration_and_identity.sql`.
4. انسخ المحتوى والصقه واضغط على **Run**.

*ملاحظة أمان البيانات:* الترحيل تراكمي بالكامل (`ADD COLUMN IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) ولا يمس أي سجلات للمخزون أو المشتريات أو الحركات السابقة.

---

## 7. إعداد التحقق من البريد الإلكتروني (Email Verification)

- يولد النظام رمز تحقق رقمي آمن (OTP) بطول 6 أرقام باستخدام مولد عشوائي مشفر (`crypto.getRandomValues`).
- مدة صلاحية الرمز: **10 دقائق فقط**.
- استخدام لمرة واحدة: يتم وسم الرمز بالمصادقة أو إبطاله فور المحاولة الناجحة.
- حفظ آمن: يتم تخزين بصمة الرمز المشفرة بصيغة SHA-256 في عمود `verification_token_hash`.
- في بيئة التشغيل التجريبية أو عند غياب مفتاح Resend، يقوم البوت بإرشاد المتقدم لتأكيد الرمز مباشرة أو إرساله عبر القناة المهيأة.

---

## 8. تعيين كلمة المرور واستعادتها (Password Setup & Recovery)

1. عند اعتماد طلب التسجيل، يتلقى الموظف إشعاراً برقم هويته الوظيفية ورابط تعيين كلمة المرور.
2. يتم إنشاء دعوة أو رابط استعادة عبر Supabase Auth:
   ```typescript
   await supabase.auth.admin.generateLink({
     type: 'invite',
     email: employeeEmail,
   })
   ```
3. يقوم الموظف بفتح الرابط وتعيين كلمة مرور سرية قوية، ولا يتم إرسال أو تخزين كلمة المرور في رسائل تيليجرام أو سجلات النظام.

---

## 9. التأهيل الآمن لمدير النظام الرئيسي (System Administrator Provisioning)

تم تخصيص الحساب الرئيسي لمالك النظام:
- **البريد الإلكتروني:** `marwandesouqhi@gmail.com`
- **اسم المستخدم:** `marwan-desouky`
- **الدور الممنوح:** `system_admin`
- **الكود الوظيفي المخصص:** `SYS-ADM-000001`
- **حالة الحساب:** `active`

### إجراء التأهيل الآمن (Bootstrap Procedure):
يتم تنفيذ الإجراء حصرياً في بيئة الخادم أو عبر دالة SQL في قاعدة البيانات:
```sql
SELECT bootstrap_system_admin(
    'marwandesouqhi@gmail.com',
    'marwan-desouky',
    NULL -- أو معرف auth_user_id في حال وجوده مسبقاً
);
```
- الدالة آمنة لإعادة المحاولة (Idempotent): لا تكرر الحسابات ولا تنشئ ملفات مكررة.
- الحساب محمي بالكامل في الكود البرمجي من الحذف أو التعطيل أو خفض الصلاحيات.

---

## 10. ربط البريد واسم المستخدم لمدير النظام

- يتم ربط اسم المستخدم `marwan-desouky` بسجل مدير النظام في `app_users`.
- عند تسجيل الدخول باسم `marwan-desouky`، يقوم `login-bridge` بالاستعلام الآمن عن البريد الإلكتروني المقترن `marwandesouqhi@gmail.com` والمصادقة على كلمة المرور في Supabase Auth دون كشف البريد لأطراف غير مصرح لها.

---

## 11. رحلة تسجيل الموظف عبر تيليجرام (Employee Registration Workflow)

1. يرسل الموظف `/start` للبوت ليتلقى رسالة الترحيب والشروط.
2. يرسل `/register` ويبدأ إدخال:
   - الاسم الكامل ثلاثياً أو رباعياً.
   - البريد الإلكتروني الرسمي.
   - اختيار القسم (`المخازن` أو `المشتريات`).
   - اختيار الدور المطلوب (`warehouse_employee`, `warehouse_admin`, `procurement_employee`, `procurement_admin`).
3. يرسل النظام رمز OTP إلى البريد الإلكتروني.
4. يرسل الموظف `/verify 123456` لإثبات ملكية البريد.
5. يتحول الطلب إلى حالة "بانتظار موافقة الإدارة" (`pending_approval`).

---

## 12. اعتماد حسابات الموظفين (Administrative Approval)

1. يسجل مدير النظام دخوله إلى صفحة **المستخدمون** (`/users`).
2. يفتح تبويب **طلبات التسجيل (تيليجرام)**.
3. يستعرض الطلبات التي أكملت التحقق من البريد بنجاح.
4. يضغط على **اعتماد وتخصيص كود وظيفي**:
   - يمكن للمدير تأكيد الدور المطلوب أو تعديله وفق الهيكل التنظيمي.
   - لا يمكن ترقية أي موظف إلى `system_admin` من خلال واجهة طلبات الموظفين.
5. يخصص النظام الكود الوظيفي فورياً، وتُنشأ الهوية في Supabase Auth و `app_users`.

---

## 13. تخصيص الأكواد الوظيفية الفريدة (Unique ID Generation)

صيغة الأكواد الموحدة:
- موظف مخازن: `WH-EMP-000001`
- مدير مخازن: `WH-ADM-000001`
- موظف مشتريات: `PUR-EMP-000001`
- مدير مشتريات: `PUR-ADM-000001`
- مدير النظام العام: `SYS-ADM-000001`

### ضمانات الأمان وعدم التصادم:
- توليد الأكواد يتم عبر تسلسلات PostgreSQL مستقلة لكل فئة دور.
- قيد فريد قطعي على مستوى قاعدة البيانات: `CONSTRAINT uq_app_users_employee_id UNIQUE (employee_id)`.
- الكود ثابت وغير قابل لإعادة الاستخدام بعد خروج الموظف لضمان تكامل سجلات المراجعة وحركات العهد.

---

## 14. تسجيل الدخول عبر اسم المستخدم أو الكود الوظيفي

يدعم نموذج تسجيل الدخول خيارين في حقل المعرّف:
1. **اسم المستخدم** (مثل: `marwan-desouky`).
2. **الكود الوظيفي الفريد** (مثل: `WH-EMP-000001`).

### آلية الجسر الآمن (Login Bridge):
- يستقبل الجسر المعرف وكلمة المرور عبر اتصال مشفر HTTPS.
- يتحقق من نمط المعرف وصحة بنية الكود.
- يفحص حالة الحساب: إذا كان الحساب **معلقاً (Suspended)** أو **مرفوضاً (Rejected)** يُرفض الطلب فوراً برسالة خطأ عامة لحماية سرية البيانات.
- يستعلم الجسر داخلياً عن البريد المقترن ويفوض التحقق من كلمة المرور إلى Supabase Auth.
- يتم إنشاء جلسة عمل رسمية JWT متوافقة مع سياسات RLS.

---

## 15. الصلاحيات وفصل الأقسام (RBAC & Department Isolation)

| الدور | إدارة النظام والمستخدمين | إدارة المخازن وحركات الجرد | إدارة المشتريات والموردين |
| :--- | :---: | :---: | :---: |
| `system_admin` | كامل الصلاحيات | كامل الصلاحيات | كامل الصلاحيات |
| `warehouse_admin` | لا | كامل الصلاحيات | عرض المقروءات فقط |
| `warehouse_employee` | لا | إدخال وصرف العهد | محجوب |
| `procurement_admin` | لا | عرض المقروءات فقط | كامل الصلاحيات |
| `procurement_employee` | لا | محجوب | تسجيل الفواتير والموردين |

- يتم فرض العزل في الواجهة الأمامية عبر مصفوفة المسارات `ROUTE_ACCESS`.
- يتم فرض العزل في قاعدة البيانات عبر سياسات الأمان على مستوى الصفوف (Row Level Security - RLS).

---

## 16. تعليق الحسابات واستعادتها (Suspension & Recovery)

- يمكن لمدير النظام تعليق أي حساب موظف بنقرة واحدة من لوحة الإدارة.
- تعليق الحساب يمنع تسجيل الدخول ويمنع إجراء أي حركات مخزنية أو مشتريات جديدة.
- **الحفاظ التام على البيانات:** تعليق أو حذف الحساب لا يمس حركات المخزن التاريخية أو الفواتير المسجلة باسم الموظف.
- يمكن إعادة تفعيل الحساب المعلق فورياً (`active`).

---

## 17. المتغيرات البيئية المطلوبة (.env)

```dotenv
# Supabase Client
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_AUTH_MODE=transitional

# Supabase Server Secrets (Edge Functions)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret
APP_BASE_URL=https://your-app-domain.com
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_resend_key
EMAIL_FROM=Warehouse Ledger <noreply@yourdomain.com>
```

---

## 18. التشغيل المحلي (Local Development)

1. تثبيت الحزم:
   ```bash
   npm install
   ```
2. تشغيل فحص الأنواع (TypeScript):
   ```bash
   npm run typecheck
   ```
3. تشغيل الاختبارات الآلية:
   ```bash
   npm test
   ```
4. تشغيل خادم التطوير:
   ```bash
   npm run dev
   ```

---

## 19. نشر دوال الحافة (Deploying Edge Functions)

باستخدام Supabase CLI:
```bash
# نشر دالة جسر تسجيل الدخول
supabase functions deploy login-bridge --no-verify-jwt

# نشر دالة بوت تيليجرام
supabase functions deploy telegram-bot --no-verify-jwt

# نشر دالة التحقق من البريد
supabase functions deploy verify-email --no-verify-jwt

# نشر دالة إدارة المستخدمين
supabase functions deploy admin-users
```

---

## 20. تشغيل الاختبارات الآلية (Running Automated Tests)

يحتوي المشروع على اختبارات وحدة وتكامل تغطي كامل السيناريوهات:
```bash
npx vitest run
```
تشمل الاختبارات:
- التحقق من صيغ الأكواد الوظيفية وعدم تكرارها (`employeeIdentity.test.ts`).
- دورة تسجيل الموظف والتحقق من البريد (`registrationWorkflow.test.ts`).
- تسجيل الدخول بالأكواد الوظيفية وحجب الحسابات المعلقة (`uniqueIdLogin.test.ts`).
- عزل الأقسام وصلاحيات المخازن والمشتريات (`departmentIsolation.test.ts`).
- أمان وتأهيل مدير النظام الرئيسي وعدم قابليته للتعديل أو الحذف (`systemAdminBootstrap.test.ts`).

---

## 21. استكشاف الأخطاء وإصلاحها (Troubleshooting)

1. **البوت لا يستجيب لأوامر تيليجرام:**
   - تحقق من ضبط الويب هوك بشكل صحيح عبر `getWebhookInfo`.
   - تأكد من مطابقة `TELEGRAM_WEBHOOK_SECRET` بين الخادم وتيليجرام.
   - راجع سجلات الدالة في Supabase Dashboard > Edge Functions > Logs.
2. **فشل تسجيل الدخول بالكود الوظيفي:**
   - تأكد من حالة الحساب في `app_users` (يجب أن تكون `active`).
   - تأكد من أن دالة `login-bridge` منشورة وتعمل بدون أخطاء CORS.
3. **عدم وصول رمز التحقق عبر البريد:**
   - تأكد من صحة مفتاح `RESEND_API_KEY` ونطاق الإرسال المعتمد `EMAIL_FROM`.
   - راجع مجلد الرسائل غير المرغوب فيها (Spam).

---

## 22. النسخ الاحتياطي واستعادة النظام (Backup & Disaster Recovery)

- يحتفظ النظام بنظام نسخ احتياطي دوري لقاعدة البيانات وسجلات المراجعة.
- عند استعادة أي نسخة احتياطية، تظل الأكواد الوظيفية المسلسلة محمية بفضل قيود `UNIQUE` وتسلسلات PostgreSQL المستقلة.
- يتم تسجيل كافة عمليات التأهيل، والاعتماد، والتعليق في جدول وسجلات المراجعة `audit_logs`.
