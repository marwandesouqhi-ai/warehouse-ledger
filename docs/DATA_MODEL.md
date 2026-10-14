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

---

## 7. جداول موديول المشتريات (Procurement Module Tables)

### 7.1 جدول الموردين: `public.suppliers`
مسؤول عن تسجيل بيانات الشركات والموردين المعتمدين والمؤهلين للتعاقد.

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف المورد الفريد |
| `name` | `TEXT` | `NOT NULL` | اسم الشركة أو المورد التجاري |
| `name_key` | `TEXT` | `UNIQUE NOT NULL` | الاسم المطبع عربياً لمنع التكرار (دالة normalize_arabic_name) |
| `category` | `TEXT` | `NOT NULL DEFAULT 'عام'` | تصنيف التوريد (أجهزة طبية، أدوات مكتبية...) |
| `commercial_register`| `TEXT` | `NOT NULL DEFAULT ''` | رقم السجل التجاري |
| `contact_name` | `TEXT` | `NOT NULL DEFAULT ''` | اسم مندوب أو مسؤول الاتصال |
| `phone` | `TEXT` | `NOT NULL DEFAULT ''` | رقم الهاتف أو الجوال |
| `status` | `TEXT` | `NOT NULL DEFAULT 'under_review' CHECK (status IN ('active', 'under_review', 'suspended'))` | حالة المورد (نشط، تحت التقييم، موقوف) |
| `rating` | `NUMERIC` | `NULL CHECK (rating >= 1 AND rating <= 5)` | تقييم المورد من 1 إلى 5 |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات فنية وتجارية |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | تاريخ التسجيل |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | تاريخ آخر تحديث |
| `created_by` | `TEXT` | `NOT NULL DEFAULT ''` | اسم المستخدم القائم بالتسجيل |

### 7.2 جدول طلبات الشراء: `public.purchase_requests`
مسؤول عن تسجيل طلبات الشراء الواردة من الكليات والأقسام ومتابعة حالتها.

| العمود | النوع | القيمة الافتراضية / القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف الطلب |
| `request_no` | `TEXT` | `UNIQUE NOT NULL DEFAULT next_purchase_request_no()` | رقم الطلب المتسلسل الذري (PR-0001) |
| `department` | `TEXT` | `NOT NULL` | القسم أو المخزن الطالب |
| `purchase_type` | `TEXT` | `NOT NULL CHECK (purchase_type IN ('direct', 'practice', 'tender'))` | نوع الشراء (أمر مباشر، ممارسة، مناقصة) |
| `budget_line` | `TEXT` | `NOT NULL DEFAULT ''` | بند الميزانية المقترح |
| `priority` | `TEXT` | `NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent'))` | الأولوية (عادية، عاجلة) |
| `needed_by` | `DATE` | `NULL` | تاريخ الاحتياج المطلوب |
| `requested_by` | `TEXT` | `NOT NULL DEFAULT ''` | اسم الموظف مقدم الطلب |
| `justification` | `TEXT` | `NOT NULL DEFAULT ''` | مبررات وأسباب الشراء |
| `status` | `TEXT` | `NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected'))` | حالة الطلب |
| `quote_deadline`| `DATE` | `NULL` | آخر موعد لتقديم العروض |
| `selected_quote_id`| `UUID` | `NULL` | معرف عرض السعر الفائز المختار |
| `submitted_at` | `TIMESTAMPTZ` | `NULL` | توقيت إرسال الطلب للاعتماد |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | تاريخ الإنشاء |
| `created_by` | `TEXT` | `NOT NULL DEFAULT ''` | اسم المنشئ |
| `created_by_id`| `UUID` | `NULL` | معرف المستخدم في auth.uid() |

### 7.3 جدول بنود طلبات الشراء: `public.purchase_request_items`
| العمود | النوع | القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف البند |
| `request_id` | `UUID` | `REFERENCES purchase_requests(id) ON DELETE CASCADE` | معرف الطلب المرتبط |
| `item_name` | `TEXT` | `NOT NULL` | اسم الصنف والمواصفات |
| `quantity` | `NUMERIC` | `NOT NULL CHECK (quantity > 0)` | الكمية المطلوبة |
| `unit` | `TEXT` | `NOT NULL DEFAULT 'قطعة'` | وحدة القياس |
| `estimated_price` | `NUMERIC` | `NOT NULL DEFAULT 0` | السعر التقديري للوحدة |
| `custody_item_ref` | `TEXT` | `NULL` | مرجع اختياري لصنف في عهدة المخازن |

### 7.4 جدول مسار الموافقات والاعتمادات: `public.purchase_request_approvals`
سجل غير قابل للتعديل المباشر (Append-only) يوثق قرارات كل مرحلة في مسار الاعتماد.
| العمود | النوع | القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف الخطوة |
| `request_id` | `UUID` | `REFERENCES purchase_requests(id) ON DELETE CASCADE` | معرف الطلب |
| `step_no` | `INT` | `NOT NULL` | رقم الخطوة في المسار (1 إلى 4) |
| `step_name` | `TEXT` | `NOT NULL` | المسمى الوظيفي للخطوة |
| `approver_name` | `TEXT` | `NOT NULL DEFAULT ''` | اسم المسؤول أو الصفة |
| `decision` | `TEXT` | `CHECK (decision IN ('pending', 'approved', 'rejected'))` | قرار الخطوة |
| `decided_by` | `TEXT` | `NOT NULL DEFAULT ''` | اسم المستخدم القائم بتثبيت القرار |
| `decided_at` | `TIMESTAMPTZ` | `NULL` | توقيت اتخاذ القرار |
| `note` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات القرار أو رقم المحضر |

### 7.5 جدول عروض الأسعار: `public.supplier_quotes`
| العمود | النوع | القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف عرض السعر |
| `request_id` | `UUID` | `REFERENCES purchase_requests(id) ON DELETE CASCADE` | طلب الشراء المرتبط |
| `supplier_id` | `UUID` | `REFERENCES suppliers(id) ON DELETE RESTRICT` | المورد المتقدم بالعرض |
| `total_price` | `NUMERIC` | `NOT NULL CHECK (total_price >= 0)` | السعر الإجمالي للعرض |
| `delivery_days` | `INT` | `NOT NULL CHECK (delivery_days >= 0)` | مدة التوريد بالأيام |
| `payment_terms` | `TEXT` | `NOT NULL DEFAULT ''` | شروط الدفع والسداد |
| `warranty_months`| `INT` | `NOT NULL DEFAULT 0` | فترة الضمان بالشهور |
| `received_on` | `DATE` | `NOT NULL DEFAULT CURRENT_DATE` | تاريخ استلام العرض |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات العرض |
| `is_selected` | `BOOLEAN` | `NOT NULL DEFAULT false` | هل تم اعتماد هذا العرض كعرض فائز |

### 7.6 جدول أوامر الشراء: `public.purchase_orders`
| العمود | النوع | القيود | الوصف |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | معرف أمر الشراء |
| `po_no` | `TEXT` | `UNIQUE NOT NULL DEFAULT next_purchase_order_no()` | رقم أمر الشراء المتسلسل الذري (PO-0001) |
| `request_id` | `UUID` | `REFERENCES purchase_requests(id) ON DELETE RESTRICT` | طلب الشراء الصادر بناءً عليه |
| `quote_id` | `UUID` | `UNIQUE REFERENCES supplier_quotes(id) ON DELETE RESTRICT` | عرض السعر الفائز |
| `supplier_id` | `UUID` | `REFERENCES suppliers(id) ON DELETE RESTRICT` | المورد المتعاقد معه |
| `total` | `NUMERIC` | `NOT NULL CHECK (total >= 0)` | القيمة الإجمالية للتعاقد |
| `expected_delivery_date`| `DATE` | `NULL` | تاريخ التسليم المتوقع |
| `status` | `TEXT` | `CHECK (status IN ('open', 'received', 'invoiced', 'cancelled'))` | حالة أمر الشراء (لا تؤثر على المخزون) |
| `received_on` | `DATE` | `NULL` | تاريخ تأكيد الاستلام والفحص |
| `invoiced_on` | `DATE` | `NULL` | تاريخ إصدار الفاتورة المرتبطة |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` | ملاحظات التعاقد والتسليم |

---

## 8. الأعمدة الجديدة المضافة على جدول الحركات: `movements`
أعمدة اختيارية مضافة بأسلوب Additive ولا تؤثر على الصفوف السابقة (تبقى NULL):
- `supplier_id` (`UUID NULL REFERENCES public.suppliers(id) ON DELETE SET NULL`): ربط الفاتورة بمعرف المورد في جدول الموردين.
- `purchase_order_id` (`UUID NULL REFERENCES public.purchase_orders(id) ON DELETE SET NULL`): ربط الفاتورة بأمر الشراء الصادر بناءً عليه.

