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
# 1. الجلسة 1: قفل الدوال الحساسة وإنشاء قفل التهيئة الأحادية
supabase db execute -f supabase/migrations/20261017130000_lockdown_privileged_functions_and_bootstrap.sql

# 2. الجلسة 2: جداول تحصين البوت ومحاولات التحقق الفعلي بالبريد
supabase db execute -f supabase/migrations/20261017140000_telegram_bot_hardening_and_email_verification.sql

# 3. الجلسة 3: تفويض الأقسام وسجل الأكواد التراكمي وتأمين RLS
supabase db execute -f supabase/migrations/20261017150000_approval_delegation_code_registry_and_rls.sql

# 4. الجلسة 4: جلسات معالج البوت وتحصين البيانات المؤقتة
supabase db execute -f supabase/migrations/20261017160000_telegram_user_sessions.sql

# 5. الجلسة 5: نظام تأهيل وتفعيل الموظفين وفهارس الأسماء وحالة الدعوات
supabase db execute -f supabase/migrations/20261018170000_employee_onboarding_invitation_and_activation.sql
```

> **الملفات المقترحة في الانتظار (`supabase/pending/`):**
> 1. `20261013213000_harden_rls.sql`: تحصين سياسات RLS العامة.
> 2. `20261017153000_enforce_active_status_on_business_tables.sql`: تقييد الجداول التشغيلية بحالة `status = 'active'`.
> 3. `20261018130000_harden_telegram_user_sessions.sql`: تقييد جلسات المعالج المؤقتة بـ `service_role`.
> 4. `20261018173000_formalize_app_users_status_check_constraint.sql`: إضفاء الصبغة الرسمية لقيد التحقق `app_users_status_check` ليستوعب `pending_activation`.

---

## 7. آلية تقديم الطلب والتحقق المباشر عبر النظام (Direct Submission & Web-Based Verification)

- بناءً على التحديث الأخير، **تم إلغاء طلب رمز التحقق (OTP) من داخل بوت تيليجرام نهائياً**، تيسيراً لتجربة الموظف ومنعاً لأي تعثر في المحادثة.
- يقتصر دور بوت تيليجرام على جمع بيانات التسجيل الأساسية (الاسم الرباعي، البريد الإلكتروني الحقيقي، القسم، والدور المطلوب).
- بمجرد ضغط الموظف على «تأكيد وإرسال الطلب»، يُدرج الطلب مباشرة في لوحة تحكم الإدارة `UsersPage.tsx` كطلب معتمد جاهز للمراجعة (`verification_status: 'verified'`, `approval_status: 'pending'`).
- التحقق الفعلي وتعيين بيانات الاعتماد (اسم المستخدم وكلمة المرور) يتم بالكامل من داخل النظام عبر رابط الدعوة المشفر المرسل لبريد الموظف (Gmail) فور موافقة الإدارة.

---

## 8. دورة تأهيل الموظف الشاملة (Employee Onboarding Lifecycle)

تتكامل الدورة من خلال 5 مراحل مترابطة وموثقة بالكامل:

```text
[بوت تيليجرام] 
       │ (تقديم طلب: الاسم، البريد، القسم، الدور المطلوب ── بدون OTP)
       ▼
[صفحة إدارة المستخدمين UsersPage.tsx] 
       │ (مراجعة الطلب واختيار الدور النهائي المسموح)
       │ (الضغط على «قبول وإرسال الدعوة»)
       ▼
[دالة الحافة admin-users] 
       │ (قفل السجل FOR UPDATE + تخصيص Unique ID + إنشاء app_users بحالة pending_activation)
       │ (استدعاء supabaseAdmin.auth.admin.inviteUserByEmail دون إنشاء أي كلمة مرور مؤقتة)
       │ (تسجيل حالة الدعوة invitation_status = 'sent' + إشعار تيليجرام دون أي أسرار)
       ▼
[بريد الموظف Gmail عبر Google SMTP] 
       │ (استلام رسالة الدعوة والضغط على الرابط المؤدي لـ #type=invite)
       ▼
[واجهة تفعيل الحساب AuthPage.tsx] 
       │ (عرض الهوية للقراءة فقط: الاسم، البريد، Unique ID، القسم، الدور)
       │ (إدخال اسم المستخدم المستقل وكلمة المرور الجديدة)
       │ (تعيين كلمة المرور عبر Supabase Auth + استدعاء complete-activation)
       ▼
[التفعيل النهائي والحفظ التراكمي] 
       │ (فحص وجود كلمة المرور عبر دالة SECURITY DEFINER)
       │ (حجز اسم المستخدم فريداً وتحديث الحالة إلى active ومزامنة app_metadata)
```

### 8.1 ضبط إعدادات Google SMTP وتكوين الروابط في Supabase (خطوات المالك اليدوية)
تُرسل دعوات تفعيل الحسابات آلياً عبر خادم **Supabase Auth** باستخدام بريد Google SMTP المفعل للمشروع، وليس عبر متغيرات دوال Edge Functions:

1. **إعدادات SMTP في لوحة تحكم Supabase:**
   - توجه إلى: **Authentication** > **SMTP Settings**.
   - فعّل خيار: **Enable Custom SMTP**.
   - **Sender email:** عنوان بريد Gmail الخاص بالمشروع (مثل: `your-project@gmail.com`).
   - **Sender name:** اسم النظام (مثل: `Warehouse Ledger`).
   - **Host:** `smtp.gmail.com`
   - **Port:** `587`
   - **Encryption:** `TLS`
   - **Username:** نفس بريد Gmail المدخل في Sender email.
   - **Password:** **كلمة مرور التطبيق (Google App Password)** — تتطلب تفعيل التحقق بخطوتين (2-Step Verification) في حساب Google، ثم إنشاء كلمة مرور تطبيق مخصصة مكونة من 16 حرفاً من خلال (الأمان > التحقق بخطوتين > كلمات مرور التطبيقات). **تحذير:** لا تستخدم كلمة المرور الأساسية لحساب Gmail نهائياً.

2. **تكوين الروابط وإعادة التوجيه (Site URL & Redirect URLs):**
   - توجه إلى: **Authentication** > **URL Configuration**.
   - **Site URL:** رابط التطبيق الأساسي (مثل: `https://your-domain.com` أو محلياً `http://localhost:5173`).
   - **Redirect URLs:** أضف نمط التوجيه الشامل: `https://your-domain.com/**` (أو محلياً `http://localhost:5173/**`). **أهمية قصوى:** إذا لم تتم إضافة الرابط، يتجاهل Supabase معامل `redirectTo` ويوجه المستخدم لصفحة الموقع الرئيسية بدلاً من علامة تبويب التفعيل `#type=invite`.

3. **تخصيص قالب بريد الدعوة (Invite User Email Template):**
   - توجه إلى: **Authentication** > **Email Templates** > **Invite user**.
   - **Subject:** `دعوة لتفعيل حسابك في نظام Warehouse Ledger`
   - **Body (HTML):**
     ```html
     <h2>مرحباً بك في فريق العمل</h2>
     <p>تم قبول طلب انضمامك إلى نظام Warehouse Ledger وتخصيص هويتك الوظيفية.</p>
     <p>يرجى النقر على الرابط التالي لإنشاء اسم المستخدم وكلمة المرور الخاصة بك وتفعيل الحساب:</p>
     <p><a href="{{ .ConfirmationURL }}" style="padding:10px 20px; background:#1e40af; color:#fff; text-decoration:none; border-radius:6px; display:inline-block;">تفعيل الحساب</a></p>
     <p>إذا لم تكن قد طلبت الانضمام، يمكنك تجاهل هذه الرسالة بأمان.</p>
     ```
   - **ملاحظة:** استخدم المتغير الرسمي `{{ .ConfirmationURL }}` فقط ولا تستخدم متغيرات غير مدعومة.

4. **حدود الإرسال وصلاحية الرابط:**
   - تنتهي صلاحية الرابط وفق المهلة المحددة في إعدادات Supabase Auth (الافتراضي 24 ساعة). عند انتهاء الصلاحية، يقوم مدير النظام بالضغط على «إعادة إرسال الدعوة» من لوحة الإدارة.
   - حدود إرسال Gmail SMTP تصل إلى ~500 رسالة يومياً للحسابات المجانية و ~2000 لحسابات Google Workspace، وهي ملائمة تماماً للمنشآت والفرق المتوسطة. يُوصى بالترقية لمزود متخصص (مثل Resend أو Postmark) عند التوسع الكبير.

---

### 8.2 نافذة تفعيل الحساب وتعيين الهوية الرقمية (Activation Screen)
- عند فتح رابط الدعوة، تكتشف الواجهة التوجيه `#type=invite` وتعرض علامة تبويب التفعيل بنفس النمط والتصميم لصفحة الدخول.
- **الهوية غير القابلة للتعديل (Read-only):** الاسم الكامل، البريد الإلكتروني، الكود الوظيفي الفريد (Unique ID)، القسم، والدور الوظيفي.
- **قواعد اسم المستخدم المستقل (Username Rules):**
  - الطول: من 3 إلى 30 حرفاً.
  - الرموز المسموحة: أحرف إنجليزية صغيرة، أرقام، النقطة (`.`)، الشرطة السفلية (`_`)، والشرطة العادية (`-`).
  - يجب أن يبدأ بحرف إنجليزي أو رقم.
  - يُمنع أن يكون بريداً إلكترونياً (لا يحتوي `@`).
  - يُمنع أن يطابق نمط الأكواد الوظيفية (`WH-EMP-...`, `PUR-ADM-...`, إلخ).
  - يُمنع أن يكون اسماً محجوزاً (`admin`, `root`, `system`, `support`, `marwan-desouky`).
  - فحص عدم التكرار غير الحساس لحالة الأحرف (Case-insensitive uniqueness) مفروض عبر فهرس قاعدة بيانات `UNIQUE INDEX ON app_users (lower(username))`.
- **كلمة المرور:** حد أدنى 10 أحرف ورموز، ويتم إرسالها حصرياً لمزود المصادقة Supabase Auth عبر `supabase.auth.updateUser` دون حفظها أو كتابتها بأي جدول أو سجل.
- **التحقق الخادمي الذري:** تستدعي الواجهة دالة `complete-activation` التي تفحص وجود كلمة المرور المشفرة عبر `verify_auth_user_has_password`، ثم تنفذ الإجراء التراكمي `complete_employee_activation` لتثبيت اسم المستخدم، تحويل الحالة إلى `active`، وتحديث حالة الدعوة إلى `accepted`.

---

### 8.3 تقرير المطابقة والاتساق التشخيصي (Identity Consistency Report)
- ميزة رقابية غير تدميرية متاحة لمدير النظام الرئيسي في لوحة إدارة المستخدمين.
- تفحص قاعدة البيانات وترصد الملاحظات التالية دون إجراء أي تعديل أو حذف تلقائي:
  1. حسابات في `app_users` ليس لها سجل مقابل في `auth.users`.
  2. مستخدمين في `auth.users` ليس لديهم هوية مسجلة في `app_users`.
  3. طلبات تسجيل معتمدة لم يتم إرسال دعوات تفعيل لها.
  4. حسابات نشطة لا تحتوي على اسم مستخدم مسجل.
  5. عناوين بريد إلكتروني مكررة.
- تعرض النتائج في نافذة منبثقة تفاعلية توضح الخلل وسببه للمراجعة اليدوية للمالك.

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

---

## 14. جدول حالة التنفيذ وجاهزية المكونات (Execution & Readiness Status)

| المكون / الخطوة | الحالة التشغيلية | ملاحظات التحقق والمسؤولية |
| :--- | :---: | :--- |
| **واجهة لوحة المستخدمين (`UsersPage.tsx`)** | **منفذ ومُختبر محلياً** | عرض الطلبات، الأزرار «قبول وإرسال الدعوة»، «إعادة إرسال الدعوة»، «إلغاء الدعوة»، تقرير المطابقة. |
| **واجهة التفعيل المستقلة (`AuthPage.tsx` + `App.tsx`)** | **منفذ ومُختبر محلياً** | تبويب `#type=invite`، قفل هوية الموظف للقراءة فقط، فحص اسم المستخدم الحي وقواعد كلمة المرور. |
| **دالة الحافة `admin-users`** | **منفذ ومُختبر محلياً** | إزالة `listUsers`، إزالة كلمات المرور المؤقتة، استدعاء `inviteUserByEmail`، إجراءات الإلغاء وإعادة الإرسال. |
| **دالة الحافة `complete-activation`** | **منفذ ومُختبر محلياً** | فحص التوثيق، التحقق من تعيين كلمة المرور عبر `verify_auth_user_has_password`، والتفعيل الذري. |
| **دالة الحافة القديمة `invite-user`** | **محصنة ومقيدة محلياً** | استبدال `listUsers`، حظر مسار الدعوة القديم غير المتوافق، والإبقاء على سجلات المستخدمين السابقين دون مساس. |
| **ملف الهجرة التراكمي `20261018170000`** | **مُعد محلياً ولم يُطبق عن بُعد** | يحتوي أعمدة الدعوات، الفهارس غير الحساسة للأحرف، ودوال التفعيل الذرية والتحقق. |
| **المقترح المعلق `20261018173000` في `pending/`** | **مُعد للمراجعة (Prepared only)** | توثيق قيد `app_users_status_check` ليستوعب `pending_activation` بانتظار موافقة المالك. |
| **إعدادات Google SMTP في لوحة Supabase** | **يتطلب ضبط يدوي من المالك** | إدخال كلمة مرور تطبيق Google (Google App Password) وتفعيل SMTP في لوحة Supabase Auth. |
| **ضبط Site URL و Redirect URLs** | **يتطلب ضبط يدوي من المالك** | إضافة رابط الموقع ونمط `https://your-domain.com/**` للسماح بمعامل `redirectTo`. |
| **تخصيص قالب بريد الدعوة (Invite User)** | **يتطلب ضبط يدوي من المالك** | تعديل النص في لوحة التحكم وتضمين المتغير الرسمي `{{ .ConfirmationURL }}`. |
| **حزمة الاختبارات والأنواع (Vitest / tsc / build)** | **مكتملة وناجحة 100%** | اجتياز 374 اختباراً في 41 ملف، خلو البناء `dist/` من الأسرار، و 0 أخطاء TypeScript. |

