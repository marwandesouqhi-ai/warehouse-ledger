# سجل تقدم معالجة الثغرات الأمنية (Security Remediation Progress)

## معلومات عامة
- **تاريخ البدء:** 17 أكتوبر 2026
- **الفرع الحالي:** `fix/registration-security`
- **حالة مستودع Git:** تم التحقق من استبعاد ملفات الأسرار بالكامل (`.env`, `.vercel/.env.production.local`).
- **قاعدة البيانات:** لم يتم إجراء أو تطبيق أي تعديلات على قاعدة البيانات الإنتاجية عن بُعد (All work local and additive).

---

## الجلسة الأولى (Session A): إغلاق الصلاحيات، التهيئة الأحادية، وتحصين الويب هوك
- **الحالة:** مكتملة ومختبرة ومثبتة في الالتزام `bd3da4b`.
- **العيوب المعالجة:** `P0-1`, `P0-2`, `P0-3`.

---

## الجلسة الثانية (Session B): التحقق الفعلي من البريد الإلكتروني وتحصين البوت
- **الحالة:** مكتملة ومختبرة بنجاح (Completed & Verified Locally)
- **العيوب التي تم التحقق منها ومعالجتها:**
  1. `P1-1` (التحقق الفعلي من البريد الإلكتروني):
     - ربط إرسال رمز OTP الفعلي عبر خادم خارجي Resend API على مستوى الخادم (`sendOtpEmailViaResend`) باستخدام `RESEND_API_KEY` و `EMAIL_FROM`.
     - منع ظهور رمز OTP نهائياً في أي رسالة صادرة لتطبيق تيليجرام أو جسم استجابة HTTP أو سجلات النظام.
     - توليد رمز OTP موحد التوزيع بدون انحياز ترجيحي (Uniform rejection sampling) بطول 6 أرقام.
     - تشفير الرمز المشفر عبر بصمة SHA-256 مع سر التشفير `OTP_PEPPER` في الخادم.
     - قصر محاولات التحقق الخاطئة على 5 محاولات عبر دالة قاعدة بيانات ذرية (`record_verification_attempt`) تمنع ثغرات السباق والتخمين المتزامن.
     - دعم مهلة إرسال (Cooldown 60s) وحد أقصى لإعادة الإرسال (3 طلبات/ساعة).
     - إغلاق الوصول العام لدالة `verify-email` وحصرها في استدعاءات الخادم الداخلية `service_role`.
  2. `P2-1` (تحصين بوت تيليجرام ومنع الحقن):
     - منع هجمات حقن الفلاتر: إلغاء دمج المتغيرات النصية في PostgREST `.or(...)` والاعتماد على استعلامات استعلامية مشروطة ومفصولة `.eq()`.
     - منع معالجة التحديثات المكررة (Update Deduplication) عبر جدول `telegram_processed_updates`.
     - تحديد معدل الطلبات (Rate Limiting) عبر جدول `telegram_rate_events` مع ضبط الأحرف والمسافات لمنع التجاوز.
     - حماية ملكية الطلبات للأمر `/status` و `/cancel` وفق معرف تيليجرام الموثق في التحديث فقط.
     - تصحيح سلوك الأمر `/cancel`: وسم الطلب بـ `cancelled` دون حذف السجل الفعلي لحماية تاريخ النظام وسجلات المراجعة، ورفض إلغاء الطلبات المعتمدة مسبقاً.
     - تحديث نص الترحيب للأمر `/start` ليتطابق نصياً وبدقة مع المواصفات الرسمية المطلوبة.
- **الملفات المنشأة:**
  - `supabase/migrations/20261017140000_telegram_bot_hardening_and_email_verification.sql`
  - `supabase/rollbacks/20261017140000_telegram_bot_hardening_and_email_verification.rollback.sql`
  - `tests/unit/sessionBSecurity.test.ts`
- **الملفات المعدلة:**
  - `supabase/functions/telegram-bot/index.ts`
  - `supabase/functions/verify-email/index.ts`
  - `.env.example`
- **نتائج الاختبارات:**
  - اجتياز اختبارات Session B العشرة (10/10) بنجاح.
  - اجتياز كامل حزمة اختبارات المشروع (36 ملف اختبار، 309 اختبارات ناجحة بنسبة 100%).
  - اجتياز فحص الأنواع `npm run typecheck` (0 أخطاء).

---

## الجلسة الثالثة (Session C): جسر تسجيل الدخول، الاعتماد، الأكواد الفريدة، وRLS
- **الحالة:** مكتملة ومختبرة بنجاح (Completed & Verified Locally)
- **العيوب التي تم التحقق منها ومعالجتها:**
  1. `P1-2` (إعادة بناء وتأمين جسر تسجيل الدخول `login-bridge`):
     - تحديد نوع المعرّف عبر قائمة بيضاء صارمة (`email`, `employee_id`, `username`) ترفض أي محاولة حقن SQL أو رموز مشبوهة.
     - استبدال استعلامات `.or(...)` المعرضة للحقن باستعلامات استعلامية مشروطة ومفصولة بحسب المعرّف.
     - منع تسجيل الدخول للحسابات غير النشطة (`suspended` أو `pending_activation`) دون تسريب حالة الحساب للمخترق.
     - التحقق الفعلي من كلمة المرور عبر Supabase Auth حصرياً بواسطة `signInWithPassword` (باستخدام `SUPABASE_ANON_KEY`) وإرجاع جلسة موثقة حقيقية (`access_token`, `refresh_token`, `expires_in`, `user`).
     - إرجاع خطأ عام وموحد (`GENERIC_LOGIN_ERROR`) عند أي إخفاق لمنع استنباط المستخدمين وأرقام الموظفين.
     - حذف التحقق من كلمات المرور النصية القديمة المخزنة ومحاولات مزامنة كلمات المرور عبر `admin.updateUserById`.
     - تحديث واجهة `AuthPage.tsx` لحذف أي استعلام لجدول `app_users` من المتصفح والاعتماد على الجسر وخادم التوثيق الرسمي.
  2. `P1-3` و `P1-4` و `C.1` و `C.2` (مصفوفة تفويض الاعتماد وحوكمة الأقسام):
     - إنشاء جدول إعدادات التفويض `registration_approval_settings` مع حقل `enable_department_delegation` بقيمة افتراضية `false` ومقيد بالكامل بـ RLS.
     - تأمين جدول `registration_requests`: إلغاء صلاحيات INSERT و UPDATE و DELETE من جميع أدوار العملاء (`anon`, `authenticated`) وحصر الإدارة عبر الخادم ودوال RPC.
     - إنشاء العرض الآمن `registration_requests_admin_view` الذي يستبعد أعمدة رموز OTP المشفرة لحماية الخصوصية.
     - ترقية وتأمين دالة RPC `approve_employee_registration`:
       - التحقق من هوية المراجع عبر `p_reviewer_auth_id` من قاعدة البيانات مباشرة.
       - منع المراجع من اعتماد طلبه الذاتي منعاً باتاً.
       - منع تعيين دور `system_admin` عبر طلبات التسجيل نهائياً.
       - تطبيق مصفوفة التفويض: منع مدير القسم من الاعتماد إذا كان التفويض معطلاً، ومنعه من اعتماد طلبات خارج قسمه، ومنعه من تعيين دور `admin` أو `system_admin`.
     - تحديث الدالة السحابية `admin-users`:
       - دعم أدوار مدراء الأقسام (`admin`) وتحديد صلاحياتهم في استعراض واعتماد ورفض طلبات قسمهم فقط.
       - إنشاء أو ربط حساب Supabase Auth بطريقة تكرارية آمنة (Idempotent) بدون قبول أي كلمات مرور من العميل، وتوليد رابط تعيين كلمة المرور الآمن (`generateLink(recovery)`).
       - إضافة إجراء `set_department_delegation` محصور حصرياً بمدير النظام الرئيسي (`system_admin`).
       - إضافة إجراء `get_department_delegation` للاستعلام عن حالة التفويض.
       - إضافة إجراء `send_password_recovery` لإرسال رابط تعيين كلمة المرور عبر البريد الإلكتروني.
  3. `C.3` و `C.4` (سجل الأكواد الفريدة ومكافحة التلاعب):
     - إنشاء جدول السجل التراكمي `employee_code_registry` مع قفل مشدد بواسطة Trigger يمنع التعديل (UPDATE) والحذف (DELETE) نهائياً.
     - تقديم التسلسلات الرقمية (`ALTER SEQUENCE ... RESTART WITH`) لتتجاوز أعلى رقم وظيفي مستخدم حالياً لمنع تكرار الأكواد.
     - ترقية دالة `generate_employee_code`: خريطة بادئات ثابتة لكل دور، لا توجد خيارات افتراضية عامة، رفع استثناء عند الأدوار غير المعرفة أو استنفاد محاولات التصادم، وتسجيل الكود فوراً في السجل التراكمي.
  4. `C.5` (تعليق الحسابات وحظر Supabase Auth):
     - عند تعديل حالة المستخدم إلى `suspended` في `admin-users`، يتم تطبيق حظر طويل الأمد `ban_duration: '876000h'` في Supabase Auth لمنع إصدار أي توكنات جديدة وتحديث حالته في `app_metadata` و `app_users`.
     - عند إعادة التنشيط إلى `active`، يتم إزالة الحظر `ban_duration: 'none'`.
     - تحصين مدير النظام الرئيسي المحمي (`marwan-desouky`) ضد التعليق نهائياً.
  5. مقترح السياسات لبيانات الأعمال (`supabase/pending/`):
     - إعداد ملف مقترح الهجرة `20261017153000_enforce_active_status_on_business_tables.sql` وملف التراجع المقابل لتقييد الجداول التشغيلية بحالة `status = 'active'` للمستخدمين لمراجعته من قِبل مالك المشروع.
- **الملفات المنشأة:**
  - `supabase/migrations/20261017150000_approval_delegation_code_registry_and_rls.sql`
  - `supabase/rollbacks/20261017150000_approval_delegation_code_registry_and_rls.rollback.sql`
  - `supabase/pending/20261017153000_enforce_active_status_on_business_tables.sql`
  - `supabase/rollbacks/20261017153000_enforce_active_status_on_business_tables.rollback.sql`
  - `tests/unit/sessionCSecurity.test.ts`
- **الملفات المعدلة:**
  - `supabase/functions/login-bridge/index.ts`
  - `supabase/functions/admin-users/index.ts`
  - `src/pages/AuthPage.tsx`
  - `src/pages/UsersPage.tsx`
  - `src/lib/registrationService.ts`
- **نتائج الاختبارات:**
  - اجتياز اختبارات Session C الثلاثة عشر (13/13) بنجاح.
  - اجتياز كامل حزمة اختبارات المشروع (37 ملف اختبار، 322 اختبار ناجح بنسبة 100%).
  - اجتياز فحص الأنواع `npm run typecheck` (0 أخطاء).

---

## الجلسة الرابعة (Session D): الفحص النهائي والتوثيق والتقرير الشامل
- **الحالة:** مكتملة وموثقة بالكامل (Completed & Documented)
- **المهام المنفذة:**
  1. `D.1` فحص البناء وحزم الإنتاج وخلو الأسرار (Build & Secret Scan):
     - بناء الحزمة الإنتاجية بنجاح عبر `npm run build` (`tsc -b && vite build`) بدون أي أخطاء.
     - فحص شامل لمجلد الإنتاج `dist/` والتأكد من خلوه تماماً من أي أسرار خادم (`service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `OTP_PEPPER`).
     - التحقق من مطابقة ملفات `.env` و `.env.production` و `.vercel/` لقواعد التجاهل في `.gitignore` ومنع تعقبها في Git.
  2. `D.2` إنشاء دليل التحقق المحلي وقائمة الفحص التشغيلية:
     - إنشاء وثيقة `docs/LOCAL_VERIFICATION_CHECKLIST.md` باللغة العربية تشرح تفصيلياً خطوات تطبيق ملفات الهجرة الثلاثة بالترتيب، نشر الدوال السحابية الأربعة، ضبط الأسرار، وخطوات الفحص العملي خطوة بخطوة وإجراءات التراجع.
  3. `D.3` تحديث التوثيق المعماري الرسمي:
     - تحديث وثيقة `EMPLOYEE_REGISTRATION_SETUP.md` بالكامل لتعكس معمارية الإنتاج النهائية المطبقة في الجلسات الأربع.
  4. `D.4` و `D.5` تحديث سجل التقدم وإعداد التقرير الختامي الشامل:
     - استكمال كافة سجلات التقدم لجميع الجلسات A, B, C, D بنجاح 100%.
- **الملفات المنشأة:**
  - `docs/LOCAL_VERIFICATION_CHECKLIST.md`
  - `tests/unit/endToEndIntegration.test.ts`
- **الملفات المعدلة:**
  - `EMPLOYEE_REGISTRATION_SETUP.md`
  - `docs/REMEDIATION_PROGRESS.md`
  - `supabase/functions/telegram-bot/index.ts`
  - `src/pages/UsersPage.tsx`
  - `.env.example`
---

## الجلسة الخامسة (Session E): معالجة العيوب المتبقية والتحصين الشامل (F1–F8)
- **الحالة:** مكتملة ومختبرة بنجاح بنسبة 100% (Completed & Verified Locally)
- **العيوب التي تم التحقق منها ومعالجتها:**
  1. `F1` (الهجرة التدميرية `20261017210000_reset_users_and_pin_admin.sql`):
     - تأكيد احتواء الملف على أوامر حذف مدمرة لكافة مستخدمي `auth.users` و `public.app_users` وكلمة مرور صريحة لمدير النظام.
     - رفض الملف نهائياً وحظره من `supabase/migrations/` ونقله إلى `supabase/pending/rejected/20261017210000_reset_users_and_pin_admin.sql.REJECTED` مع استبدال كلمة المرور بـ `<REMOVED>`.
     - إنشاء وثيقة التوثيق `supabase/pending/rejected/README.md` التي توضح أسباب الرفض الصارمة.
     - تحديث دليل `scripts/bootstrap-system-admin.md` لتوضيح المسار الآمن المعتمد (التهيئة الأحادية من الجلسة A + بريد استعادة كلمة المرور الرسمي من Supabase).
     - إجراء مسح شامل لكافة الهجرات والسكربتات والوثائق لأوامر `DELETE FROM` و `TRUNCATE` و `DROP TABLE` و `CASCADE` وتوثيقها.
  2. `F2` (كلمة مرور مدير النظام الصريحة في `supabase/functions/admin-users/index.ts`):
     - التحقق من وجود القيمة الصريحة في المتغير `expectedAdminPassword` حول السطر 731 ضمن إجراء `reset_and_seed_system_admin`.
     - حذف القيمة الصريحة وإلغاء المنطق التدميري بالكامل واستبدال الإجراء برد رفض صريح (`status: 400`) يمنع مساس بيانات المستخدمين ويوجه لاستخدام `bootstrap_system_admin` و `send_password_recovery`.
     - إنشاء اختبار فحص ثابت `tests/unit/noHardcodedPasswords.test.ts` يتحقق آلياً من خلو كافة دوال Edge Functions من أي تعيين لكلمات مرور صريحة ومنع استدعاءات `createUser` أو `updateUserById` بكلمات مرور مكتوبة في الكود.
     - تنبيه المالك لتدوير كلمة المرور المكشوفة في الالتزامات السابقة عبر بريد الاستعادة وتغييرها في أي خدمة تم إعادة استخدامها فيها.
  3. `F3` (خطأ البناء في `src/pages/UsersPage.tsx` وتصحيح أرقام التوثيق):
     - حل مشكلة الاستيراد غير المستخدم `deleteLocalUser` باستبدالها بـ `deleteUserPermanently` المستخدمة فعلياً في حذف الحسابات المحلية.
     - حل توافق أنواع Node في اختبارات الفحص الأمني عبر إضافة مرجع الأنواع الصريح.
     - إعادة قياس كافة الفحوصات وتصحيح الأرقام الرسمية بنجاح 100%.
  4. `F4` (إزالة `listUsers()` من `supabase/functions/login-bridge/index.ts`):
     - حذف مسار الالتفاف والبحث الاحتياطي عبر `listUsers({ page: 1, perPage: 10 })` نهائياً.
     - قصر التحقق من هوية المصادقة حصرياً على `getUserById(appUser.auth_user_id)`.
     - معالجة أي حساب غير مرتبط بـ `auth_user_id` كفشل دخول عام موحد (`GENERIC_LOGIN_ERROR`) لمنع استنباط الحسابات.
     - تحديث اختبار `tests/unit/loginBridge.test.ts` ليؤكد خلو الدالة من استدعاء `listUsers` واعتمادها الحصري على `getUserById`.
  5. `F5` (استعادة ملف `.env.example` وتحديث كافة المتغيرات):
     - استعادة الملف بدون أوامر git تدميرية عبر `git show HEAD:.env.example`.
     - مراجعة وتصفير كافة القيم لتبقى نصوص فارغة (`KEY=`) فقط دون أي قيم افتراضية سرية.
     - تغطية شاملة لكافة المتغيرات المقروءة في الواجهة (`import.meta.env`) وفي دوال Deno (`Deno.env.get`) شاملاً مزودي البريد (Resend و Gmail SMTP) وبوت تيليجرام وسر `OTP_PEPPER`.
  6. `F6` (مراجعة وتحصين معالج التيليجرام وجلسات المعالج):
     - تحصين جدول `telegram_user_sessions`: سحب الصلاحيات من `anon` و `authenticated` وقصرها على `service_role` فقط مع تفعيل RLS.
     - تأكيد خلو جلسات المعالج من أي رموز OTP أو توكنات أو نصوص بريد كاملة.
     - إضافة آلية تنظيف دورية محددة زمنياً (Age-Bounded Pruning) للجلسات المتخلفة عن 24 ساعة.
     - إنشاء المقترح لقاعدة البيانات البعيدة `supabase/pending/20261018130000_harden_telegram_user_sessions.sql` وملف التراجع المقابل.
     - إنشاء حزمة اختبارات شاملة `tests/unit/telegramWizardSecurity.test.ts` (9 اختبارات ناجحة).
  7. `F7` (ضوضاء نهايات الأسطر CRLF/LF):
     - تشخيص السبب: تفعيل `core.autocrlf = true` في بيئة Windows مع غياب ملف `.gitattributes` موحد.
     - تأكيد أن التغييرات الفعلية تقتصر على ملفات الميزات الأمنية فقط عند التجاهل عبر `git diff --ignore-cr-at-eol --stat`.
     - اقتراح محتوى ملف `.gitattributes` لتوحيد نهايات الأسطر في التقرير النهائي لانتظار موافقة المالك.
  8. `F8` (التحقق الصارم من سلامة البيانات التشغيلية):
     - مراجعة كافة الهجرات المضافة في هذا الفرع والتأكد من أنها تراكمية 100% ولا تحذف أي بيانات تشغيلية.
     - تأكيد بقاء الملف `supabase/pending/20261017153000_enforce_active_status_on_business_tables.sql` مقترحاً فقط في مجلد الانتظار.

## الجلسة السادسة (Session G): استكمال دورة تأهيل الموظفين (من طلب تيليجرام حتى تفعيل الهوية)
- **الحالة:** مكتملة ومختبرة محلياً بنجاح بنسبة 100% (Completed & Verified Locally)
- **المحاور التي تم التحقق منها ومعالجتها:**
  1. `G.1` اعتماد الطلبات وإرسال دعوة Gmail عبر Google SMTP:
     - تحديث دالة `admin-users` (إجراء `approve_registration_request`):
       - إزالة أي استدعاء لـ `listUsers` وحذف أي توليد لكلمات مرور مؤقتة نهائياً.
       - حجز الكود الوظيفي الفريد `employee_id` ذرياً عبر التسلسل المخصص وسجل الأكواد.
       - إنشاء أو ربط هوية `app_users` بحالة `pending_activation` واسم مستخدم مؤقت (`pending_<clean_emp_id>`) لا يمكن استخدامه للدخول نهائياً.
       - استدعاء `supabaseAdmin.auth.admin.inviteUserByEmail` مع `redirectTo: APP_BASE_URL + "/#type=invite"` ليرسل خادم Supabase Auth رسالة الدعوة عبر مزود Google SMTP.
       - تسجيل حالة الدعوة `invitation_status = 'sent'` وتوقيت الإرسال وهوية المعتمد.
       - إشعار الموظف على تيليجرام دون أي أسرار أو روابط أو رموز OTP.
     - إضافة إجراءات الإدارة: «إعادة إرسال الدعوة» (`resend_registration_invitation`) و «إلغاء الدعوة» (`cancel_registration_invitation`).
  2. `G.2` شاشة تفعيل الحساب واختيار اسم المستخدم وكلمة المرور (`AuthPage.tsx` + `App.tsx`):
     - استقبال رابط الدعوة `#type=invite` وعرض تبويب تفعيل الحساب باللغة العربية بنفس هوية صفحة الدخول.
     - عرض بطاقة الهوية للقراءة فقط (الاسم، البريد، الكود الوظيفي، القسم، الدور).
     - التحقق الفوري من قواعد اسم المستخدم (3-30 حرفاً، حروف إنجليزية وأرقام ونقاط وشرطات، غير مكرر، غير محجوز، ليس بريداً أو كوداً وظيفياً).
     - تعيين كلمة المرور مباشرة في Supabase Auth عبر `supabase.auth.updateUser` دون كتابتها في أي جدول.
  3. `G.3` دالة التفعيل الذرية الخادمة (`complete-activation`):
     - التحقق من جلسة المصادقة النشطة.
     - فحص وجود كلمة المرور في `auth.users.encrypted_password` عبر دالة أمنية `verify_auth_user_has_password` (SECURITY DEFINER).
     - تنفيذ معاملة ذرية `complete_employee_activation` لتثبيت اسم المستخدم، تحويل الحالة إلى `active`، وتسجيل قبول الدعوة.
  4. `G.4` تقرير المطابقة والاتساق التشخيصي (Identity Consistency Report):
     - إضافة دالة خادم واستدعاء واجهة لجلب تقرير شامل للمطابقة بين `app_users` و `auth.users` وطلبات التسجيل دون أي حذف أو مساس بالبيانات.
     - عرض التقرير في نافذة منبثقة مخصصة لمدير النظام.
  5. `G.5` تحصين وتقييد الدالة القديمة `invite-user`:
     - إزالة مسار `listUsers` واستبدال البحث المباشر بـ `getUserById`.
     - حظر مسار إنشاء المستخدمين بالصلاحيات القديمة وتوجيه الإدارة إلى نظام التأهيل الموحد مع الإبقاء على حسابات وسجلات المستخدمين السابقة.
- **الملفات المنشأة:**
  - `supabase/migrations/20261018170000_employee_onboarding_invitation_and_activation.sql`
  - `supabase/pending/20261018173000_formalize_app_users_status_check_constraint.sql`
  - `supabase/rollbacks/20261018173000_formalize_app_users_status_check_constraint.rollback.sql`
  - `supabase/functions/complete-activation/index.ts`
  - `tests/unit/employeeOnboarding.test.ts`
- **الملفات المعدلة:**
  - `supabase/functions/admin-users/index.ts`
  - `supabase/functions/invite-user/index.ts`
  - `src/lib/employeeIdentity.ts`
  - `src/lib/registrationService.ts`
  - `src/pages/AuthPage.tsx`
  - `src/pages/UsersPage.tsx`
  - `src/App.tsx`
  - `EMPLOYEE_REGISTRATION_SETUP.md`
  - `docs/REMEDIATION_PROGRESS.md`

---

## جدول سلامة البيانات للهجرات المضافة في الفرع (`fix/registration-security`)

| ملف الهجرة | تراكمي (Additive)؟ | عمليات الحذف / الإسقاط (DELETE / DROP / TRUNCATE) | مساس مخطط المصادقة (`auth`) | الملاحظات والحالة الأمنية |
| :--- | :---: | :--- | :---: | :--- |
| `20261017120000_employee_registration_and_identity.sql` | **نعم** | لا يوجد أي حذف نهائياً | **لا** | آمن 100%، يضيف جداول وأعمدة طلبات التسجيل |
| `20261017130000_lockdown_privileged_functions_and_bootstrap.sql` | **نعم** | `DROP FUNCTION` فقط لإعادة تعريف توقيع الدالة | قراءة فقط (`SELECT` للتحقق من تأكيد البريد) | آمن، يقفل دوال RPC وينشئ دالة التهيئة الأحادية دون مساس بالبيانات |
| `20261017140000_telegram_bot_hardening_and_email_verification.sql` | **نعم** | `DELETE` محدد زمنياً لجداول تتبع تقنية فقط (أحداث المعدل والتحديثات) | **لا** | آمن ومسموح، تنظيف دوري محدد بـ 7 أيام و 24 ساعة لجداول البوت |
| `20261017150000_approval_delegation_code_registry_and_rls.sql` | **نعم** | `DROP VIEW` فقط لتحديث العرض الآمن للطلبات | قراءة فقط (`SELECT` للتحقق من هوية المراجع) | آمن، يضيف سجل الأكواد ومصفوفة تفويض الأقسام وسياسات RLS |
| `20261017160000_telegram_user_sessions.sql` | **نعم** | لا يوجد (إسقاط السياسة السابقة فقط) | **لا** | آمن، جدول مؤقت لجلسات المعالج مع RLS محصور بـ `service_role` |
| `20261017210000_reset_users_and_pin_admin.sql` | **مرفوض (لا)** | **نعم (DELETE جماعي لـ auth.users و app_users)** | **نعم (كتابة وتعديل مباشر في auth.users)** | **تم رفضه وحظره ونقله إلى `pending/rejected` وتطهير كلمة المرور منه** |
| `20261018170000_employee_onboarding_invitation_and_activation.sql` | **نعم** | لا يوجد أي حذف نهائياً | قراءة فقط (`encrypted_password IS NOT NULL` عبر دالة أمنية) | آمن 100%، فهارس فريدة ودوال تفعيل ذري وحفظ هويات |

---

## حالة الاختبارات والأنواع النهائية المحدثة والواقعية (Freshly Measured Results)
- **اختبارات Vitest:** 41 ملف اختبار، 382 اختبار ناجح بنسبة 100% (41 passed, 382 passed, 0 failed).
- **فحص TypeScript:** اجتياز كامل عبر `tsc -b` (0 errors).
- **بناء Vite الإنتاجي:** نجاح كامل عبر `npm run build` (`tsc -b && vite build`) (Code 0).
- **فحص خلو الحزمة الإنتاجية من الأسرار (`dist/`):** اجتياز كامل وفحص نظيف (0 تسريبات).
- **المرحلة C (نظام التصميم وتجربة المستخدم):** مكتملة بنسبة 100% (انخفاض الأنماط المضمنة بنسبة 50% من 794 إلى 400، 0 ألوان Hex في التطبيق، توحيد 3 نقاط تجاوب، ومطابقة WCAG AA).
- **المقترحات المعلّقة في `supabase/pending/`:**
  - `20261013213000_harden_rls.sql` (مقترح معلق لسياسات RLS).
  - `20261017153000_enforce_active_status_on_business_tables.sql` (مقترح معلق لحالة المستخدمين النشطين).
  - `20261018130000_harden_telegram_user_sessions.sql` (مقترح معلق لتحصين جلسات التيليجرام وتنظيفها).
  - `20261018173000_formalize_app_users_status_check_constraint.sql` (مقترح معلق لقيد حالة المستخدمين لاستيعاب `pending_activation`).



