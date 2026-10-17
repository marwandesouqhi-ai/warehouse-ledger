# دليل تشغيل وضبط نظام تسجيل الموظفين وبوت تيليجرام والهوية الرقمية (Warehouse Ledger)
## الدليل المعماري والتشغيلي المحدث والآمن للإنتاج

هذا الدليل يوضح البنية الهندسية المحصنة وخطوات التثبيت والتهيئة لنظام تسجيل الموظفين الموحد، التحقق من البريد الإلكتروني عبر Resend، بوت تيليجرام، وتوليد الأكواد الوظيفية الفريدة (Unique IDs)، وتأمين حساب مدير النظام الرئيسي.

---

## 1. البنية المعمارية للنظام المحصن (Hardened Architecture)

يتكامل النظام من خلال المكونات التالية:
1. **قاعدة بيانات Supabase PostgreSQL:**
   - جدول `app_users`: السجل المرجعي للموظفين (الأكواد الوظيفية `employee_id`، القسم `department`، الدور `role`، حالة الحساب `status`).
   - جدول `registration_requests`: استيعاب طلبات التسجيل الواردة من تيليجرام وتأمينها عبر RLS كامل وحجب الصلاحيات عن العملاء.
   - عرض `registration_requests_admin_view`: عرض آمن للمدراء يستبعد بصمات الرموز السرية.
   - جدول `registration_approval_settings`: إدارة تفويض الاعتماد لمدراء الأقسام (الافتراضي: معطل ومحصور بمدير النظام الرئيسي).
   - جدول `employee_code_registry`: سجل تراكمي غير قابل للتعديل أو الحذف (Append-only with anti-tamper trigger) لحفظ وتتبع كافة الأكواد المخصصة.
   - جدول قفل التهيئة الأحادية `system_bootstrap_state`: يمنع إعادة تهيئة مدير النظام الرئيسي أكثر من مرة.
   - دوال الترقية والاعتماد المخزنة المحمية: `bootstrap_system_admin` و `approve_employee_registration` و `generate_employee_code` (محصورة بـ `service_role`).
2. **مزود المصادقة Supabase Auth:**
   - إدارة جلسات المستخدمين المشفرة ومصادقة كلمات المرور (Argon2/bcrypt) دون تخزين كلمات مرور بنصوص واضحة في جداول التطبيق.
   - تطبيق الحظر الصريح `ban_duration: '876000h'` على الحسابات المعلقة لإبطال صلاحية إصدار التوكنات فورياً.
3. **دوال الحافة (Supabase Edge Functions):**
   - `login-bridge`: جسر التحقق من اسم المستخدم أو الكود الوظيفي (Unique ID)، وفحص حالة الحساب ضد التعليق، والمصادقة المباشرة عبر Supabase Auth باستخدام `SUPABASE_ANON_KEY` دون فحص نصوص كلمات المرور بالجدول.
   - `telegram-bot`: معالج تحديثات الويب هوك الخاص ببوت تيليجرام مع فحص الترويسة السرية الصارمة، منع التحديثات المكررة، تحديد معدل الطلبات، وحظر ظهور رموز التحقق في المحادثة.
   - `verify-email`: محصورة في استدعاءات الخادم `service_role` للتحقق من رمز OTP ومقارنة بصمة التشفير.
   - `admin-users`: إدارة المستخدمين، مصفوفة الاعتماد والتفويض، التعليق/إعادة التفعيل، والتأهيل الأولي لمدير النظام.
4. **تطبيق الويب الأمامي (Vite + React + TypeScript):**
   - صفحة تسجيل الدخول `src/pages/AuthPage.tsx`: تدعم اسم المستخدم، البريد، أو الكود الوظيفي بدون استعلام مباشر لجدول المستخدمين من المتصفح.
   - لوحة إدارة المستخدمين `src/pages/UsersPage.tsx`: دليل الموظفين، إدارة تفويض الأقسام، وفلاتر الحالات، ومراجعة واعتماد طلبات تيليجرام.

---

## 2. إنشاء وتهيئة بوت تيليجرام (Telegram Bot Setup)

1. افتح تطبيق تيليجرام وتحدث إلى `@BotFather`.
2. أرسل الأمر `/newbot` واتبع التعليمات لتحديد اسم البوت واسم المستخدم (مثل `WarehouseLedgerBot`).
3. انسخ رمز التوكن السري المعطى لك.
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

- **تحذير أمني صارم:** لا تضع `TELEGRAM_BOT_TOKEN` أو `SUPABASE_SERVICE_ROLE_KEY` أو `OTP_PEPPER` في ملفات الواجهة الأمامية أو مستودع Git.
- يتم تخزين هذه المفاتيح كأسرار خادم (Server Secrets) في Supabase:
  ```bash
  supabase secrets set TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
  supabase secrets set TELEGRAM_WEBHOOK_SECRET="your_random_32_char_secret"
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"
  supabase secrets set APP_BASE_URL="https://your-domain.com"
  supabase secrets set RESEND_API_KEY="re_your_resend_api_key"
  supabase secrets set RESEND_FROM_EMAIL="Warehouse Ledger <onboarding@yourdomain.com>"
  supabase secrets set OTP_PEPPER="your_random_sha256_pepper_secret"
  supabase secrets set BOOTSTRAP_ADMIN_EMAIL="marwandesouqhi@gmail.com"
  supabase secrets set BOOTSTRAP_ADMIN_USERNAME="marwan-desouky"
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
3. فعّل خيار تأكيد البريد الإلكتروني **Confirm email** لحساب المالك لتأكيد هويته قبل إجراء التهيئة الأحادية.
4. اضبط خيارات أمان كلمات المرور (الحد الأدنى 12 حرفاً، أرقام ورموز).

---

## 6. تطبيق ملفات ترحيل قاعدة البيانات (Database Migrations)

يتم تطبيق ملفات الهجرة بالترتيب الآتي عبر Supabase CLI أو SQL Editor:

```bash
# 1. الجلسة A: قفل الدوال الحساسة وإنشاء قفل التهيئة الأحادية
supabase db execute -f supabase/migrations/20261017130000_lockdown_privileged_functions_and_bootstrap.sql

# 2. الجلسة B: جداول تحصين البوت ومحاولات التحقق الفعلي بالبريد
supabase db execute -f supabase/migrations/20261017140000_telegram_bot_hardening_and_email_verification.sql

# 3. الجلسة C: تفويض الأقسام وسجل الأكواد التراكمي وتأمين RLS
supabase db execute -f supabase/migrations/20261017150000_approval_delegation_code_registry_and_rls.sql
```

> **ملف المقترح لبيانات الأعمال:**
> تم وضع مقترح حظر المستخدمين المعلقين في الجداول التشغيلية في:
> `supabase/pending/20261017153000_enforce_active_status_on_business_tables.sql`
> راجعه قبل تطبيقه في الإنتاج.

---

## 7. إعداد التحقق الفعلي من البريد الإلكتروني (Email Verification & Resend API)

- يولد النظام رمز تحقق رقمي آمن (OTP) بطول 6 أرقام عبر خوارزمية رفض العينات الموحدة (Uniform rejection sampling) لمنع انحياز التوزيع.
- يتم إرسال الرمز عبر مزود Resend API على مستوى الخادم.
- **الحماية ضد التسريب:** لا يظهر الرمز نهائياً في محادثة تيليجرام أو ردود HTTP أو سجلات النظام.
- يتم تخزين بصمة الرمز المشفرة في قاعدة البيانات باستخدام SHA-256 مع سر تشفير الخادم `OTP_PEPPER`.
- حماية ضد هجمات التخمين: قفل ذري (Atomic Lockout) عند تجاوز 5 محاولات خاطئة عبر الدالة المخزنة `record_verification_attempt`.
- قيود المعدل: مهلة 60 ثانية بين كل محاولة إرسال، وحد أقصى 3 رسائل في الساعة لكل بريد/حساب تيليجرام.

---

## 8. تعيين كلمة المرور واستعادتها (Password Setup & Recovery)

1. عند اعتماد طلب التسجيل، يتلقى الموظف إشعاراً برقم هويته الوظيفية عبر تيليجرام.
2. يتم إنشاء رابط تعيين كلمة المرور الآمن عبر Supabase Auth:
   ```typescript
   await supabase.auth.admin.generateLink({
     type: 'recovery',
     email: employeeEmail,
   })
   ```
3. يستلم الموظف الرابط على بريده الموثق، ويقوم بفتح الرابط وتعيين كلمة المرور بنفسه مباشرة في Supabase Auth دون تدخل أو معرفة أي شخص.

---

## 9. التأهيل الآمن الأوحد لمدير النظام الرئيسي (System Administrator Provisioning)

تم تخصيص الحساب الرئيسي لمالك النظام:
- **البريد الإلكتروني المؤكد:** `marwandesouqhi@gmail.com`
- **اسم المستخدم:** `marwan-desouky`
- **الدور الممنوح:** `system_admin`
- **الكود الوظيفي المخصص:** `SYS-ADM-000001`
- **حالة الحساب:** `active`

### إجراء التأهيل الأوحد (Bootstrap Lock):
- يتم عبر استدعاء `bootstrap_system_admin` من خلال جلسة مؤكدة لبريد المالك.
- تُسجل العملية في جدول القفل `system_bootstrap_state`.
- يُقفل الإجراء نهائياً بعد التنفيذ الأول وتُرفض أي محاولات تالية.

---

## 10. تخصيص الأكواد الوظيفية الفريدة (Unique ID Generation)

صيغة الأكواد الموحدة:
- موظف مخازن: `EMP-WRH-000001`
- موظف مشتريات: `EMP-PUR-000001`
- مراجع مالي: `EMP-AUD-000001`
- مدير قسم / مشرف: `ADM-MGR-000001`
- مدير النظام العام: `SYS-ADM-000001`

### ضمانات الأمان وعدم التصادم:
- توليد الأكواد يتم عبر تسلسلات PostgreSQL مستقلة لكل فئة دور تم تقديمها لتتجاوز أعلى كود موجود.
- يتم حفظ كل كود مخصص في جدول السجل التراكمي `employee_code_registry` الذي يحظر التعديل أو الحذف نهائياً عبر Trigger أمني.

---

## 11. تسجيل الدخول عبر جسر التوثيق (Login Bridge)

يدعم نموذج تسجيل الدخول خيارات متعددة في حقل المعرّف:
1. **اسم المستخدم** (مثل: `marwan-desouky`).
2. **الكود الوظيفي الفريد** (مثل: `EMP-WRH-000001`).
3. **البريد الإلكتروني** (مثل: `marwandesouqhi@gmail.com`).

### آلية الجسر المحصن (Login Bridge):
- فحص المعرف وفق قائمة بيضاء ترفض أي محاولة لحقن SQL أو رموز مشبوهة.
- استعلام آمن ومحدد عبر PostgREST (بدون استخدام `.or(...)` القابل للتلاعب).
- فحص حالة الحساب: إذا كان الحساب **معلقاً (Suspended)** أو **غير نشط** يُرفض الطلب فوراً برسالة خطأ عامة موحدة.
- تفويض التحقق من كلمة المرور إلى Supabase Auth الرسمي عبر `signInWithPassword`.
- إرجاع جلسة موثقة رسمية JWT متوافقة مع RLS.

---

## 12. مصفوفة تفويض الاعتماد وعزل الأقسام (Department Delegation & RBAC)

1. **الوضع الافتراضي (التفويض معطل):**
   - مدير النظام الرئيسي (`system_admin`) هو الوحيد المخول باعتماد أو رفض طلبات التسجيل لكافة الأقسام.
2. **عند تفعيل التفويض من لوحة الإدارة:**
   - يحق لمدير القسم (`admin`) مراجعة واعتماد طلبات الموظفين التابعين لنفس قسمه فقط (`requested_department == reviewer.department`).
   - يُمنع مدير القسم منعاً باتاً من ترقية أي موظف إلى دور `admin` أو `system_admin`.
   - يُمنع المراجع من اعتماد طلبه الذاتي نهائياً.

---

## 13. تعليق الحسابات وحظر Supabase Auth

- تعليق الحساب من لوحة الإدارة يقوم بتحديث حالته إلى `suspended` في `app_metadata` و `app_users`.
- يتم تفعيل الحظر الصريح `ban_duration: '876000h'` في Supabase Auth لمنع إصدار أو تجديد التوكنات.
- حساب مدير النظام الرئيسي `marwan-desouky` محمي برمجياً من التعليق أو الحذف.
- عند إعادة التنشيط إلى `active`، يتم رفع الحظر تلقائياً `ban_duration: 'none'`.
