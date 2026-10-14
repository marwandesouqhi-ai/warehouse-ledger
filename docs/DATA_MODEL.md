# دليل المخطط الفعلي لقاعدة البيانات (Data Model Documentation)

تم استخراج هذا المخطط الفعلي وتحليله بالترتيب الزمني لكافة ملفات الهجرات (Migrations 0001 إلى 20261014120001) لضمان الدقة وتفادي أي تعارض في الأنواع والقيود.

---

## 1. جدول الحركات المخزنية: `public.movements`
المسؤول عن تسجيل كل حركات الوارد والمنصرف وفواتير الشراء وأوامر الصرف والتحويل بين المخازن.

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | المعرف الفريد للحركة (UUID فقط، يمنع إدخال نصوص بادئة مثل `mov-`) |
| `owner_id` | `UUID` | `DEFAULT '00000000-0000-0000-0000-000000000000'::uuid` | المعرف المشترك للمؤسسة أو حساب المستخدم المنشئ |
| `received_on` | `TEXT` | `NOT NULL DEFAULT ''` | تاريخ الاستلام / الفاتورة (YYYY-MM-DD) |
| `invoice_number`| `TEXT` | `NOT NULL DEFAULT ''` | رقم الفاتورة أو إذن التوريد |
| `supplier` | `TEXT` | `NOT NULL DEFAULT ''` | اسم المورد أو الجهة الموردة |
| `recipient` | `TEXT` | `NOT NULL DEFAULT ''` | المستلم أو الجهة المستلمة |
| `permit` | `TEXT` | `NOT NULL DEFAULT ''` | رقم إذن الصرف أو إذن الإضافة |
| `issued_on` | `TEXT` | `NOT NULL DEFAULT ''` | تاريخ الصرف (YYYY-MM-DD) |
| `item` | `TEXT` | `NOT NULL CHECK (length(trim(item)) > 0)` | اسم الصنف المخزني |
| `unit_price` | `TEXT` | `NOT NULL DEFAULT ''` | سعر الوحدة كنص تجنباً لأخطاء الفاصلة |
| `qty_in` | `TEXT` | `NOT NULL DEFAULT ''` | كمية الوارد (أكبر من 0 في المشتريات) |
| `qty_out` | `TEXT` | `NOT NULL DEFAULT ''` | كمية المنصرف (0 في المشتريات) |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات الحركة أو تفاصيل الصنف |
| `fingerprint` | `TEXT` | `NOT NULL` (Unique Index) | البصمة التكرارية الفريدة لمنع التكرار (Idempotency) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | توقيت إنشاء السجل |
| `custody_applied`| `BOOLEAN` | `DEFAULT FALSE` | علامة تدل على تطبيق أثر الكمية في عهدة المخازن |
| `created_by` | `TEXT` | `NULL` | اسم أو بريد الموظف الذي أنشأ السجل (يؤخذ من الـ JWT) |
| `source_warehouse_id` | `TEXT` | `DEFAULT 'main'` | مخزن المصدر (مثل 'main') |
| `dest_warehouse_id` | `TEXT` | `NULL` | مخزن الوجهة في التحويلات بين المخازن |
| `dest_type` | `TEXT` | `DEFAULT 'warehouse'` | نوع الوجهة ('warehouse' أو 'custodian') |
| `custodian_name`| `TEXT` | `NULL` | اسم الموظف المستلم في حال الصرف كعهدة |
| `kind` | `TEXT` | `NULL` | تصنيف الحركة: `'purchase'` (شراء) أو `'transfer'` (تحويل/صرف) |

- **الفهارس والقيود الفريدة:**
  - `movements_fingerprint_idx` (UNIQUE على `fingerprint`)
  - `idx_movements_kind` على `kind`
  - `movements_owner_created_idx` على `(owner_id, created_at, id)`

---

## 2. جدول عهدة المخازن: `public.custody_items`
المسؤول عن أرصدة الأصناف الحالية في المخزن الرئيسي والمخازن الفرعية والعهد الشخصية.

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | معرف الصنف النصي (مثل `cst-1712345678900`) |
| `warehouse_id` | `TEXT` | `NOT NULL` | معرف المخزن ('main' للمخزن الرئيسي) |
| `code` | `TEXT` | `NOT NULL DEFAULT ''` | كود الصنف أو الباركود |
| `name` | `TEXT` | `NOT NULL` | اسم الصنف |
| `category` | `TEXT` | `NOT NULL DEFAULT ''` | التصنيف المخزني |
| `quantity` | `NUMERIC`| `NOT NULL DEFAULT 1` | الرصيد الحالي المتوفر |
| `unit` | `TEXT` | `NOT NULL DEFAULT 'قطعة'` | وحدة القياس |
| `unit_price` | `NUMERIC`| `NULL` | سعر الوحدة |
| `value` | `NUMERIC`| `NOT NULL DEFAULT 0` | القيمة الإجمالية (quantity * unit_price) |
| `condition` | `TEXT` | `NOT NULL DEFAULT 'good'` | حالة الصنف (good, damaged, etc.) |
| `custodian` | `TEXT` | `NOT NULL DEFAULT ''` | اسم أمين العهدة |
| `room_location`| `TEXT` | `NOT NULL DEFAULT ''` | الغرفة أو الرف |
| `serial_number`| `TEXT` | `NOT NULL DEFAULT ''` | الرقم التسلسلي |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات الصنف |
| `custody_type` | `TEXT` | `NOT NULL DEFAULT 'permanent'` | نوع العهدة (permanent / consumable) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | تاريخ الإنشاء |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | تاريخ آخر تحديث |

- **الفهارس:**
  - `custody_items_warehouse_idx` على `warehouse_id`

---

## 3. جدول مستخدمي التطبيق: `public.app_users`

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف المستخدم |
| `username` | `TEXT` | `UNIQUE NOT NULL` | اسم المستخدم الفريد المطبع |
| `password` | `TEXT` | `NOT NULL DEFAULT ''` | كلمة المرور القديمة (تُفرغ بعد الترقية) |
| `display_name` | `TEXT` | `NOT NULL DEFAULT ''` | الاسم الظاهر بالعربية |
| `role` | `TEXT` | `NOT NULL CHECK (role IN (...))` | الدور الوظيفي |
| `status` | `TEXT` | `NOT NULL CHECK (status IN ('active', 'pending_activation', 'disabled'))` | حالة الحساب |
| `permissions` | `JSONB` | `DEFAULT '[]'::jsonb` | الصلاحيات التفصيلية |
| `auth_user_id` | `UUID` | `REFERENCES auth.users(id) ON DELETE SET NULL` | معرف الحساب المرتبط في Supabase Auth |
| `must_change_password` | `BOOLEAN` | `NOT NULL DEFAULT false` | إجبار المستخدم على تغيير كلمة المرور |
| `activation_code`| `TEXT` | `NULL` | كود التفعيل عند الدعوة |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات إدارية |
| `activated_at` | `TIMESTAMPTZ` | `NULL` | توقيت التفعيل |
| `last_login_at`| `TIMESTAMPTZ` | `NULL` | توقيت آخر تسجيل دخول |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | توقيت الإنشاء |

---

## 4. جدول سجل العمليات والتدقيق: `public.audit_logs`

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف السجل |
| `user_id` | `UUID` | `REFERENCES auth.users(id) ON DELETE SET NULL` | معرف المستخدم الحقيقي (أو NULL إذا لم يكن مسجلاً) |
| `user_email` | `TEXT` | `NOT NULL DEFAULT ''` | بريد المستخدم الحقيقي الموثق من JWT |
| `action` | `TEXT` | `NOT NULL` | نص العملية المنفذة |
| `entity_type` | `TEXT` | `NOT NULL DEFAULT 'general'` | نوع الكيان المتأثر |
| `entity_id` | `TEXT` | `DEFAULT ''` | معرف الكيان |
| `details` | `JSONB` | `DEFAULT '{}'::jsonb` | تفاصيل إضافية للعملية |
| `ip_address` | `TEXT` | `NOT NULL DEFAULT ''` | عنوان IP |
| `user_agent` | `TEXT` | `NOT NULL DEFAULT ''` | المتصفح |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | توقيت العملية |

---

## 5. جدول محاولات الدخول: `public.login_attempts`
جدول تراكمي (Additive) لمكافحة هجمات القوة الغاشمة (Rate Limiting).

| العمود | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف المحاولة |
| `username` | `TEXT` | `NOT NULL` | اسم المستخدم المستهدف |
| `ip_address` | `TEXT` | `NOT NULL DEFAULT ''` | عنوان IP |
| `attempted_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | توقيت المحاولة |
| `success` | `BOOLEAN` | `NOT NULL DEFAULT false` | هل نجحت المحاولة أم فشلت |
| `details` | `JSONB` | `DEFAULT '{}'::jsonb` | معلومات إضافية |

---

## 6. جدول إعدادات المؤسسة: `public.app_settings`

| العمود | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY DEFAULT 'default'` | معرف الإعدادات |
| `organization` | `TEXT` | `NOT NULL DEFAULT 'جامعة الزقازيق الأهلية'` | اسم المؤسسة |
| `department` | `TEXT` | `NOT NULL DEFAULT 'قسم المخازن'` | اسم القسم |
| `currency` | `TEXT` | `NOT NULL DEFAULT 'EGP'` | العملة |
| `logo_url` | `TEXT` | `NOT NULL DEFAULT ''` | رابط الشعار السحابي |
| `logo_data_url` | `TEXT` | `NOT NULL DEFAULT ''` | بيانات الشعار المشفرة Base64 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | توقيت التحديث |
