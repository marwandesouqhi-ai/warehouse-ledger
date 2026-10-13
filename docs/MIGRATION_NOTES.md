# دليل وملاحظات الترحيل وقواعد البيانات (Migration Notes)

**تاريخ الإصدار:** 13 أكتوبر 2026  
**المشروع:** `warehouse-ledger`  
**الفرع:** `feat/purchases-transfers-roles`  

---

## 1. الاستراتيجية العامة وقواعد عدم فقدان البيانات (Zero Data Loss Strategy)

تم تصميم جميع التعديلات في هذا التحديث وفق القواعد الصارمة التالية:
1. **الترقية التراكمية الإضافية حصراً (Additive Migrations Only):** استخدام `ADD COLUMN IF NOT EXISTS` مع قيم افتراضية آمنة.
2. **منع الأوامر الهدامة:** لا يوجد أي استخدام لـ `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, أو `DELETE`.
3. **التوافق التام مع الجلسات والبيانات القديمة (Backward Compatibility):** أي حركة أو مستخدم قديم يظل صالحاً ويعمل بسلاسة، حيث يتم تطبيع البيانات وقت القراءة فقط داخل طبقة التطبيق.
4. **التحقق برمجياً قبل وبعد الترحيل:** اجتياز اختبار المطابقة `tests/unit/snapshot.test.ts` الذي يضمن بقاء سجل الحركات الأصلية (33 حركة، 391 وارد، 361 منصرف، 32 صنفاً) متطابقاً بنسبة 100%.

---

## 2. ترتيب ملفات الترحيل الإضافية (Migration Files & Execution Order)

يتم تشغيل الملفات التالية بالترتيب الزمني الموضح في نافذة **Supabase SQL Editor** أو عبر أداة `supabase db push`:

### الملف 1: `20261013190000_additive_roles_permissions.sql`
- **الغرض:** إضافة حقل الصلاحيات الإضافية لجدول المستخدمين.
- **الاستعلام:**
  ```sql
  ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

  COMMENT ON COLUMN public.app_users.permissions IS 'Array of extra permissions granted by system admin (view_audit, view_settings, manage_records)';
  ```

### الملف 2: `20261013193000_purchases_idempotency.sql`
- **الغرض:** إضافة حقول التتبع وتجنب تكرار التأثير على رصيد العهدة (Idempotency).
- **الاستعلام:**
  ```sql
  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS custody_applied BOOLEAN DEFAULT FALSE;

  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS created_by TEXT;

  COMMENT ON COLUMN public.movements.custody_applied IS 'Flag indicating whether inward/outward custody balance has been applied';
  COMMENT ON COLUMN public.movements.created_by IS 'Username or user ID of the staff member who registered the movement';
  ```

### الملف 3: `20261013200000_transfers_custody_sources.sql`
- **الغرض:** دعم نقل وصرف العهدة من وإلى أي مخزن فرعي أو أمين عهدة.
- **الاستعلام:**
  ```sql
  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS source_warehouse_id TEXT DEFAULT 'main';

  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS dest_warehouse_id TEXT;

  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS dest_type TEXT DEFAULT 'warehouse';

  ALTER TABLE public.movements
    ADD COLUMN IF NOT EXISTS custodian_name TEXT;

  COMMENT ON COLUMN public.movements.source_warehouse_id IS 'ID of source warehouse for outward transfer (e.g. main, pharmacy, etc.)';
  COMMENT ON COLUMN public.movements.dest_warehouse_id IS 'ID of destination warehouse for inter-branch transfer';
  COMMENT ON COLUMN public.movements.dest_type IS 'Destination classification: warehouse (inter-branch transfer) or custodian (personal/departmental custody)';
  COMMENT ON COLUMN public.movements.custodian_name IS 'Recipient employee or custodian name if dest_type is custodian';
  ```

### الملف الاختياري للمراجعة: `_proposed_rls_hardening.sql`
- **تنبيه:** هذا الملف **مقترح للمراجعة فقط** ولا يُطبق تلقائياً على خادم الإنتاج. يحتوي على سياسات مشددة لربط الصلاحيات بجدول `app_users` وهويات المستخدمين.

---

## 3. استعلامات التحقق بعد التنفيذ (Post-Migration Verification)

للتأكد من نجاح الترحيل على قاعدة البيانات، قم بتشغيل الاستعلام التالي:
```sql
-- التحقق من وجود الأعمدة الجديدة في جدول الحركات
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'movements' 
  AND column_name IN ('source_warehouse_id', 'dest_warehouse_id', 'dest_type', 'custodian_name', 'custody_applied', 'created_by');

-- التحقق من عمود الصلاحيات في جدول المستخدمين
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'app_users' 
  AND column_name = 'permissions';
```

---

## 4. خطة التراجع في حال الطوارئ (Rollback Plan)

بما أن كافة الأعمدة المضافة اختيارية وتحمل قيماً افتراضية، فإن وجودها لا يعطل النسخ البرمجية السابقة مطلقاً. إذا لزم الأمر، يمكن ببساطة تجاهل الأعمدة برمجياً دون الحاجة لحذفها من قاعدة البيانات.
