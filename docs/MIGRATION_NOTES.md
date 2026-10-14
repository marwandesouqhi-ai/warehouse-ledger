# دليل خطة الإطلاق التدريجي المحدث (Rollout & Migration Guide)

هذا المستند يوثق الترتيب الحقيقي والخطوات الدقيقة لإطلاق النظام دون أي خطر لقفل المستخدمين (Zero Lockout) وبأعلى معايير الأمان المعتمدة.

---

## 🚀 الترتيب الحقيقي والنهائي للإطلاق (Step-by-Step)

### الخطوة 1: تجهيز حساب السيستم أدمن الثابت يدويًا (بدون أسرار في المستودع)
- اتباع الخطوات الموضحة في [`scripts/bootstrap-system-admin.md`](file:///c:/Users/Glory/warehouse-ledger/scripts/bootstrap-system-admin.md):
  1. إنشاء المستخدم `marwan-desouky@warehouse.local` من لوحة تحكم Supabase Dashboard وتعيين كلمة المرور هناك مباشرة.
  2. تنفيذ استعلام [`scripts/bootstrap-system-admin.sql`](file:///c:/Users/Glory/warehouse-ledger/scripts/bootstrap-system-admin.sql) داخل Supabase SQL Editor لضبط الصلاحيات وربط الحساب.

### الخطوة 2: نشر وظائف الحافة (Edge Functions)
نشر الدوال الآمنة التي تعمل بصلاحيات الخدمة مع مفتاح `SUPABASE_SERVICE_ROLE_KEY` الخاص بالمشروع:
```bash
supabase functions deploy admin-users
supabase functions deploy login-bridge
# اختيارية:
supabase functions deploy migrate-users
```

### الخطوة 3: نشر الواجهة بالوضع الانتقالي (`transitional`)
1. ضبط متغير البيئة في Vercel أو منصة الاستضافة:
   ```env
   VITE_AUTH_MODE=transitional
   ```
2. نشر كود الواجهة. في هذا الوضع:
   - يحاول التطبيق تسجيل الدخول العادي عبر Supabase Auth أولاً.
   - إذا كان الحساب لم يُنشأ بعد في Supabase Auth، يستدعي التطبيق `login-bridge` بصورة آمنة ومحددة المعدل للتحقق التلقائي وترقية الحساب وربطه مع فرض تغيير كلمة المرور عند أول دخول.
   - يستثنى حساب `marwan-desouky` تماماً من هذه الدالة.

### الخطوة 4: التحقق من تسجيل دخول كافة الأدوار
يقوم المشرف بالتأكد من دخول موظف واحد على الأقل من كل دور للتحقق من الصلاحيات:
- **مدير النظام (`marwan-desouky`):** الوصول لكافة الشاشات (المستخدمين، عهدة المخازن، سجل العمليات، الإعدادات).
- **أمين المخزن (`warehouse_staff`):** الوصول للمخازن، صرف وتحويل العهدة، والأصناف الحالية فقط.
- **موظف المشتريات (`purchasing_staff`):** تسجيل فواتير الشراء واستعراض كافة فواتير المؤسسة، مع حجب أرصدة المخازن والمنصرف.
- **المراجع (`auditor` / `viewer`):** استعراض التقارير دون تعديل.

### الخطوة 5: تنفيذ ملفات الهجرة الجديدة، ثم نقل وتطبيق RLS المشددة
1. تنفيذ الهجرات الجديدة المضافة في `supabase/migrations/`:
   - `20261014120000_protected_system_admin.sql` (حماية حساب marwan-desouky وتثبيت دوال الأمان).
   - `20261014120001_login_attempts.sql` (جدول مكافحة التخمين).
   - `20261014130000_fix_record_purchase_rpc.sql` (دالة تسجيل الشراء الذرية المتوافقة مع المخطط).
2. **بعد تأكد دخول كافة المستخدمين النشطين بنجاح بـ Supabase Auth:**
   - نقل ملف RLS المعلّق بموافقة صاحب المشروع:
     ```bash
     git mv supabase/pending/20261013213000_harden_rls.sql supabase/migrations/
     ```
   - تطبيقه عبر `supabase db push` أو تشغيله في SQL Editor.

### الخطوة 6: التبديل إلى الوضع المشدد (`secure`) وحذف `login-bridge`
1. تحديث متغير البيئة في الاستضافة إلى:
   ```env
   VITE_AUTH_MODE=secure
   ```
2. حذف أو إيقاف استدعاء دالة `login-bridge` بعد استكمال تحويل كافة الحسابات بنجاح.

### الخطوة 7: التطهير النهائي لكلمات المرور القديمة (بعد أسبوع وبموافقة صريحة)
بعد مرور أسبوع كامل من استقرار النظام وتأكيد عمل جميع المستخدمين بكلمات مرورهم الجديدة:
1. أخذ نسخة احتياطية كاملة وشاملة من قاعدة البيانات.
2. تشغيل استعلام تفريغ كلمات المرور القديمة من جدول `app_users`:
   ```sql
   UPDATE public.app_users SET password = '';
   ```
3. هذا الإجراء **ممنوع تشغيله تلقائياً**، ولا يتم إلا بعد موافقة يدوية صريحة.

---

## 🔄 خطة التراجع الفعلي في حال الطوارئ (Emergency Rollback Plan)

> ⚠️ **تنبيه:** الوضع المحلي القديم `legacy` تم حذفه عمداً لتعزيز الأمان ومنع الثغرات.

في حال حدوث أي طارئ غير متوقع في الإنتاج، يكون الرجوع الفعلي والآمن كالتالي:

1. **الرجوع الفعلي للواجهة (Vercel Rollback):**
   - افتح لوحة تحكم **[Vercel Dashboard](https://vercel.com)** لمشروع `warehouse-ledger`.
   - انتقل إلى تبويب **Deployments**.
   - ابحث عن النسخة الموسومة بالعلامة المرجعية:
     `pre-security-backup` (أو `pre-fixes-backup`).
   - اضغط على خيارات النشر واختر **Redeploy / Promote to Production**.
   - ستعود الواجهة فوراً إلى آخر إصدار مستقر كان يعمل سابقاً.

2. **التراجع عن سياسات RLS المشددة (إذا تم تنفيذها):**
   - في حال تم تطبيق `harden_rls.sql` وتسبب في تعارض للعملاء القدامى:
   - افتح **Supabase SQL Editor**.
   - نفذ محتوى ملف التراجع المخصص:
     [`supabase/rollbacks/20261013213000_harden_rls_rollback.sql`](file:///c:/Users/Glory/warehouse-ledger/supabase/rollbacks/20261013213000_harden_rls_rollback.sql)
   - سيعيد فوراً سياسات المزامنة السلسة السابقة دون توقف.
