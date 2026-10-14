# دليل النشر الشامل والتشغيل في بيئة الإنتاج (Deployment & Operations Guide)

يوثق هذا الدليل خطوات نشر وتشغيل تطبيق **"دفتر حركة المخزن (Warehouse Ledger)"** في بيئة الإنتاج خطوة بخطوة، مع توضيح إعدادات Supabase، ونشر دوال السحابة (Edge Functions)، وتطبيق الترحيلات (Migrations)، وإعداد الواجهة على Vercel، وتهيئة حساب مدير النظام، مع ضمان عدم انقطاع الخدمة (Zero-Lockout Rollout) وإمكانية التراجع الفوري (Rollback Plan).

---

## 1. نظرة عامة على معمارية النشر (Architecture Overview)

- **الواجهة الأمامية (Frontend):** 
  - مبنية بتقنية Vite + React 19 + TypeScript + Tailwind CSS.
  - واجهة عربية بالكامل (RTL) تدعم وضع عدم الاتصال (PWA / Offline-First).
  - تُنشر كأصول ثابتة (SPA) على منصة **Vercel** أو أي خادم ويب ثابت (Cloudflare Pages, Netlify, Nginx).
- **الواجهة الخلفية وقاعدة البيانات (Backend & Database):**
  - تدار بواسطة **Supabase (PostgreSQL 15+)**.
  - محكومة بسياسات أمان صارمة على مستوى السجلات (Row Level Security - RLS).
  - تستخدم **Supabase Edge Functions (Deno Runtime)** لتنفيذ العمليات الإدارية الحساسة بمفتاح الخدمة السري (`service_role`).
- **نمطا المصادقة (Dual-Mode Authentication):**
  - `legacy` (الوضع الافتراضي خلال الانتقال): يعتمد على الحسابات المحلية المتزامنة لضمان استمرار عمل جميع الموظفين دون انقطاع.
  - `secure`: يعتمد كلياً على مصادقة Supabase Auth الرسمية بالبريد الاصطناعي (`<username>@warehouse.local`) وبيانات الصلاحيات المشفرة داخل `app_metadata`.

---

## 2. المتطلبات المسبقة (Prerequisites)

قبل البدء في النشر، تأكد من توفر الآتي:
1. **Node.js** (الإصدار 18 أو 20 أو 22) ومدير الحزم **npm** (أو pnpm).
2. حساب على [Supabase](https://supabase.com) مع مشروع جديد جاهز.
3. حساب على [Vercel](https://vercel.com) مرتبط بمستودع المشروع (GitHub).
4. تثبيت أداة **Supabase CLI** محلياً على جهازك:
   ```bash
   # عبر npm
   npm install -g supabase
   
   # أو عبر Scoop (Windows)
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   
   # أو عبر Homebrew (macOS/Linux)
   brew install supabase/tap/supabase
   ```

---

## 3. متغيرات البيئة والمفاتيح السرية (Environment Variables & Secrets)

### أ. متغيرات بيئة الواجهة الأمامية (Frontend / Vercel / `.env.local`)
| المتغير | الوصف | مثال | إلزامي؟ |
| :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | رابط مشروع Supabase الخاص بك | `https://xyzproject.supabase.co` | نعم |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | المفتاح العام للمشروع (Anon/Publishable Key) | `sb_publishable_...` | نعم |
| `VITE_AUTH_MODE` | نمط المصادقة (`legacy` أثناء النشر المبدئي، ثم `secure` بعد الترحيل) | `legacy` أو `secure` | اختياري (الافتراضي `legacy`) |

> [!CAUTION]
> **تحذير أمني صارم:** لا تقم أبداً بوضع مفتاح `service_role` السري في ملفات `.env` أو متغيرات Vercel للواجهة الأمامية. المفتاح العام فقط (`VITE_SUPABASE_PUBLISHABLE_KEY` أو `anon key`) هو المخصص للاستخدام داخل المتصفح.

### ب. المفاتيح السرية لدوال السحابة (Supabase Edge Functions Secrets)
| المتغير | الوصف | مكان التعيين |
| :--- | :--- | :--- |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة السري لإدارة المستخدمين في Auth و DB | يُعين عبر `supabase secrets set` داخل المشروع السحابي |
| `SUPABASE_URL` | رابط المشروع (يوفره Supabase تلقائياً داخل الدالة) | تلقائي |
| `SUPABASE_ANON_KEY` | المفتاح العام (يوفره Supabase تلقائياً داخل الدالة) | تلقائي |

---

## 4. إعداد قاعدة البيانات والترحيلات (Database Migrations)

يحتوي المستودع على ملفات ترحيل SQL مرتبة في مجلد `supabase/migrations/`.

### ترتيب تطبيق الترحيلات:
قم بتطبيق الملفات بالترتيب الزمني إما عبر Supabase CLI أو عبر **Supabase SQL Editor**:

1. `0001_init.sql` — الجداول الأساسية لحركات المخزن.
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

> [!IMPORTANT]
> **ملاحظة حرجة حول ملف تشديد الحماية `20261013213000_harden_rls.sql`:**
> هذا الملف يلغي وصول المستخدمين غير المسجلين (`anon`) تماماً ويقيد الوصول فقط لرموز JWT الموقعة. **لا تنفذ هذا الملف أثناء وضع `legacy`** حتى لا يتعطل دخول الموظفين القدامى. يتم تنفيذه فقط في **المرحلة 6** بعد اكتمال ترحيل الحسابات وتفعيل وضع `secure`.

---

## 5. نشر وظائف السحابة (Edge Functions Deployment)

يشتمل النظام على 3 دوال سحابية أساسية في `supabase/functions/`:
1. `admin-users` — إدارة حسابات المستخدمين (إنشاء، تعديل، إعادة تعيين كلمة المرور، تبديل مدير النظام) مع التحقق الصارم من JWT.
2. `invite-user` — إنشاء الدعوات الأمنية وتوليد روابط الدعوة.
3. `migrate-users` — ترحيل المستخدمين بضغطة زر وبشكل تكراري آمن (Idempotent) من جدول `app_users` إلى Supabase Auth الرسمي.

### أوامر النشر عبر Supabase CLI:

```bash
# 1. تسجيل الدخول إلى حساب Supabase
supabase login

# 2. ربط المشروع المحلي بالمشروع السحابي (استبدل YOUR_PROJECT_REF برمز مشروعك)
supabase link --project-ref YOUR_PROJECT_REF

# 3. تعيين مفتاح service_role السري لدوال السحابة
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_ACTUAL_SERVICE_ROLE_KEY"

# 4. نشر الدوال السحابية الثلاث
supabase functions deploy admin-users
supabase functions deploy invite-user
supabase functions deploy migrate-users
```

---

## 6. تهيئة حساب مدير النظام الأول (Bootstrap System Admin)

عند تثبيت النظام لأول مرة على قاعدة بيانات جديدة فارغة، يلزم إنشاء حساب مدير النظام الأولي (`marwan-desouky`):

### الطريقة السريعة عبر Supabase Dashboard:
1. ادخل إلى **Authentication** -> **Users** -> **Add user** -> **Create user**.
2. أدخل البيانات:
   - **Email:** `marwan-desouky@warehouse.local`
   - **Password:** أدخل كلمة مرور قوية جديدة (8 أحرف على الأقل).
   - **Auto Confirm User:** فعّل الخيار (`true`).
3. بعد إنشاء الحساب، اضغط على المستخدم ثم انتقل إلى خانة **App Metadata**:
   ```json
   {
     "username": "marwan-desouky",
     "role": "system_admin",
     "system_admin": true,
     "permissions": ["view_audit", "view_settings", "manage_records"],
     "must_change_password": false
   }
   ```
4. احفظ التعديلات.

*(للطريقة البرمجية عبر SQL Editor مع تشفير كلمة المرور بـ pgcrypto ومزامنة `app_users`، راجع الدليل المخصص في [scripts/bootstrap-admin.md](file:///c:/Users/Glory/warehouse-ledger/scripts/bootstrap-admin.md)).*

---

## 7. نشر الواجهة الأمامية على Vercel (Frontend Deployment)

1. ادخل إلى منصة [Vercel](https://vercel.com) واضغط **Add New...** -> **Project**.
2. اربط مستودع المشروع من GitHub.
3. اضبط إعدادات البناء:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `./`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
4. أضف متغيرات البيئة في قسم **Environment Variables**:
   - `VITE_SUPABASE_URL` = `https://<your-project>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `<your-publishable-key>`
   - `VITE_AUTH_MODE` = `legacy` (في المرحلة الأولى)
5. اضغط **Deploy**.

> [!NOTE]
> ملف [vercel.json](file:///c:/Users/Glory/warehouse-ledger/vercel.json) المرفق في المستودع معد مسبقاً للتعامل مع إعادة توجيه مسارات SPA (`/* -> /index.html`)، وترويس الحماية الأمنية (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`)، والتحكم في كاش ملف الخدمة (`sw.js`).

---

## 8. مراحل الإطلاق التدريجي وضمان عدم القفل (Phased Rollout - Zero Lockout)

لضمان انتقال سلس ومعدوم المخاطر دون انقطاع أي موظف عن العمل:

```
[ المرحلة 1: نشر Legacy ] ──> [ المرحلة 2: نشر Edge Functions ] ──> [ المرحلة 3: ترحيل المستخدمين ]
                                                                                │
[ المرحلة 6: قفل RLS المشدد ] <── [ المرحلة 5: التحويل إلى Secure ] <── [ المرحلة 4: التحقق والاختبار ]
```

1. **المرحلة 1: النشر المبدئي بالوضع القديم (`VITE_AUTH_MODE=legacy`)**:
   - يتيح لجميع المستخدمين الحاليين تسجيل الدخول واستخدام النظام كالمعتاد بدون أي تغيير.
2. **المرحلة 2: نشر الدوال السحابية ومفتاح الخدمة**:
   - نشر `admin-users`, `invite-user`, `migrate-users` وضبط `SUPABASE_SERVICE_ROLE_KEY`.
3. **المرحلة 3: تهيئة مدير النظام وترحيل المستخدمين**:
   - تسجيل دخول مدير النظام، ثم تشغيل زر الترحيل (أو استدعاء الدالة السحابية `migrate-users`).
   - تنشئ الدالة حسابات Supabase Auth رسمية لكل موظف وتعين `must_change_password: true`.
4. **المرحلة 4: الاختبار والتحقق**:
   - تجربة تسجيل الدخول بحساب مدير النظام ومستخدم تجريبي للتأكد من استلام الرموز وتطبيق الصلاحيات.
5. **المرحلة 5: تفعيل الوضع الآمن رسمياً**:
   - تعديل المتغير في Vercel إلى: `VITE_AUTH_MODE=secure`.
   - إعادة نشر الواجهة (Redeploy).
   - عند تسجيل دخول الموظفين لأول مرة، تطلب منهم الواجهة تعيين كلمة مرور شخصية قوية جديدة.
6. **المرحلة 6: تفعيل الحماية المشددة لقاعدة البيانات**:
   - تطبيق ملف `supabase/migrations/20261013213000_harden_rls.sql` في Supabase SQL Editor لقفل الجداول وسجل العمليات تماماً.

---

## 9. خطة الطوارئ والتراجع الفوري (Emergency Rollback Plan)

في حال حدوث أي طارئ أو عائق أثناء الانتقال:
1. **الرجوع الفوري للواجهة الأمامية:**
   - قم بتغيير `VITE_AUTH_MODE=legacy` في Vercel Project Settings ثم أعد النشر (Redeploy).
   - سيعود النظام للعمل بالنمط المحلي القديم فوراً.
2. **التراجع عن سياسات RLS المقيدة:**
   - في حال كنت قد طبقت `20261013213000_harden_rls.sql`، قم بتشغيل سكريبت التراجع الجاهز:
     [supabase/rollbacks/20261013213000_harden_rls_rollback.sql](file:///c:/Users/Glory/warehouse-ledger/supabase/rollbacks/20261013213000_harden_rls_rollback.sql)
     داخل Supabase SQL Editor لإعادة فتح الصلاحيات فوراً.

---

## 10. قائمة التحقق بعد النشر (Post-Deployment Verification Checklist)

- [ ] التأكد من تشغيل الموقع عبر HTTPS بنجاح وظهور الترويسات الأمنية (Check Headers via DevTools).
- [ ] تسجيل الدخول بحساب مدير النظام (`marwan-desouky`).
- [ ] التأكد من قفل صفحة المستخدمين وسجل العمليات والإعدادات عن المستخدمين العاديين.
- [ ] تسجيل دخول موظف مشتريات والتأكد من نطاق المشتريات العام (`purchasesScope: 'all'`).
- [ ] تجربة تسجيل حركة مشتريات جديدة والتحقق من حفظها ومزامنتها في السحابة.
- [ ] تجربة تسجيل حركة صرف أو تحويل في صفحة العهدة والتحقق من خصم الرصيد.
- [ ] اختبار تصدير واستيراد ملفات Excel والتأكد من تطابق البيانات.
- [ ] تجربة وضع عدم الاتصال (قطع الإنترنت والتأكد من استمرار عمل الواجهة وسحب البيانات المخزنة محلياً).
