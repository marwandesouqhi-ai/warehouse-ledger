/**
 * src/lib/demoProcurementData.ts
 *
 * يوفر بيانات تجريبية محلية (Mock Demo Data) متكاملة لموديول المشتريات
 * تُستخدم تلقائياً عند تشغيل التطبيق محلياً وقبل تنفيذ المايجريشن على Supabase
 * لضمان عدم توقف الشاشات والتحليلات بخطأ "Could not find table in schema cache".
 */

import type { SupplierStats } from './suppliersRepository'
import type {
  PurchaseRequest,
  PurchaseOrder,
  SupplierQuote,
} from './procurementRepository'

const DEMO_SUPPLIERS_KEY = 'warehouse_demo_suppliers'
const DEMO_REQUESTS_KEY = 'warehouse_demo_purchase_requests'
const DEMO_QUOTES_KEY = 'warehouse_demo_quotes'
const DEMO_ORDERS_KEY = 'warehouse_demo_purchase_orders'

let _isCloudTableMissing = false

export function setCloudTableMissing(value: boolean) {
  _isCloudTableMissing = value
}

export function isCloudTableMissing(): boolean {
  return _isCloudTableMissing
}

export function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string; details?: string }
  const msg = (err.message || '').toLowerCase()
  return (
    err.code === '42P01' ||
    err.code === 'PGRST204' ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  )
}

const INITIAL_DEMO_SUPPLIERS: SupplierStats[] = [
  {
    id: 'sup-demo-1',
    name: 'شركة الأهرام للتوريدات المكتبية والأوراق',
    name_key: 'شركة الاهرام للتوريدات المكتبية والاوراق',
    category: 'أدوات ومهمات مكتبية',
    commercial_register: 'CR-982103',
    contact_name: 'أحمد إبراهيم منصور',
    phone: '01012345678',
    status: 'active',
    rating: 5,
    notes: 'مورد معتمد للجامعة وملتزم بالمواصفات القياسية ومواعيد التوريد.',
    po_count: 8,
    invoices_count: 8,
    total_spend: 145000,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-10-10T12:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'sup-demo-2',
    name: 'مؤسسة النصر للتجهيزات والتجارة',
    name_key: 'مؤسسة النصر للتجهيزات والتجارة',
    category: 'أثاث وتجهيزات قاعات',
    commercial_register: 'CR-451290',
    contact_name: 'محمود عبد الرحيم',
    phone: '01123456789',
    status: 'active',
    rating: 4,
    notes: 'متخصص في مقاعد المعامل وتجهيزات القاعات الدراسية.',
    po_count: 4,
    invoices_count: 3,
    total_spend: 85000,
    created_at: '2026-09-05T09:30:00Z',
    updated_at: '2026-10-08T11:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'sup-demo-3',
    name: 'شركة الدلتا لتكنولوجيا المعلومات والشبكات',
    name_key: 'شركة الدلتا لتكنولوجيا المعلومات والشبكات',
    category: 'أجهزة حاسب وشبكات',
    commercial_register: 'CR-774412',
    contact_name: 'م. سامح فوزي',
    phone: '01234567890',
    status: 'active',
    rating: 5,
    notes: 'عقود صيانة دورية لأجهزة المعامل.',
    po_count: 6,
    invoices_count: 6,
    total_spend: 198000,
    created_at: '2026-08-15T08:00:00Z',
    updated_at: '2026-10-12T14:30:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'sup-demo-4',
    name: 'المتحدة للمستلزمات الطبية والوقائية',
    name_key: 'المتحدة للمستلزمات الطبية والوقائية',
    category: 'مستلزمات طبية ووقاية',
    commercial_register: 'CR-332115',
    contact_name: 'د. طارق كامل',
    phone: '01098765432',
    status: 'under_review',
    rating: 3,
    notes: 'ملف السجل التجاري قيد التدقيق القانوني قبل الاعتماد النهائي.',
    po_count: 0,
    invoices_count: 0,
    total_spend: 0,
    created_at: '2026-10-02T11:00:00Z',
    updated_at: '2026-10-02T11:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'sup-demo-5',
    name: 'شركة الهدى للتوريدات العمومية',
    name_key: 'شركة الهدي للتوريدات العمومية',
    category: 'أدوات ومهمات مكتبية',
    commercial_register: 'CR-110982',
    contact_name: 'ياسر الشريف',
    phone: '01512345678',
    status: 'suspended',
    rating: 1,
    notes: 'موقوف إدارياً لتكرار التأخير في تسليم طلبات كلية الصيدلة.',
    po_count: 2,
    invoices_count: 2,
    total_spend: 24000,
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-09-30T16:00:00Z',
    created_by: 'مدير المشتريات',
  },
]

const INITIAL_DEMO_REQUESTS: PurchaseRequest[] = [
  {
    id: 'pr-demo-1',
    request_no: 'PR-0001',
    department: 'كلية الحاسبات والمعلومات',
    purchase_type: 'direct',
    priority: 'urgent',
    budget_line: 'موازنة المعامل 2026',
    needed_by: '2026-10-25',
    requested_by: 'د. عميد كلية الحاسبات',
    justification: 'تجهيز معمل البرمجيات والذكاء الاصطناعي للفصل الدراسي الأول.',
    status: 'approved',
    quote_deadline: '2026-10-15',
    selected_quote_id: 'quote-demo-1',
    submitted_at: '2026-10-01T09:00:00Z',
    created_at: '2026-10-01T08:30:00Z',
    updated_at: '2026-10-05T14:00:00Z',
    created_by: 'مدير المشتريات',
    items_count: 3,
    total_estimated_value: 36000,
    items_summary: 'أجهزة سويتش شبكات، كابلات CAT6، راوترات معملية',
    items: [
      {
        id: 'pri-1',
        request_id: 'pr-demo-1',
        item_name: 'سويتش شبكات سيسكو 24 منفذ',
        specifications: 'Gigabit Switch 24-Port Managed',
        quantity: 2,
        unit: 'جهاز',
        estimated_unit_price: 12000,
        estimated_total: 24000,
        custody_item_ref: null,
      },
      {
        id: 'pri-2',
        request_id: 'pr-demo-1',
        item_name: 'لفة كابل شبكات CAT6',
        specifications: '305 متر نحاس أصلي',
        quantity: 4,
        unit: 'لفة',
        estimated_unit_price: 3000,
        estimated_total: 12000,
        custody_item_ref: null,
      },
    ],
    approvals: [
      { id: 'app-1', request_id: 'pr-demo-1', step_no: 1, step_name: 'مدير المشتريات', decision: 'approved', decided_by: 'أحمد علي', decided_at: '2026-10-01T10:00:00Z', notes: 'معتمد للمواصفات الفنية' },
      { id: 'app-2', request_id: 'pr-demo-1', step_no: 2, step_name: 'المدير المالي', decision: 'approved', decided_by: 'سامي عبد الله', decided_at: '2026-10-02T11:00:00Z', notes: 'يوجد اعتماد مالي كافٍ' },
      { id: 'app-3', request_id: 'pr-demo-1', step_no: 3, step_name: 'عميد الكلية / أمين الجامعة', decision: 'approved', decided_by: 'أ.د. رئيس الجامعة', decided_at: '2026-10-03T12:00:00Z', notes: 'معتمد' },
      { id: 'app-4', request_id: 'pr-demo-1', step_no: 4, step_name: 'لجنة الفحص والبت', decision: 'approved', decided_by: 'لجنة البت المالي', decided_at: '2026-10-05T14:00:00Z', notes: 'تم اختيار عرض شركة الدلتا' },
    ],
  },
  {
    id: 'pr-demo-2',
    request_no: 'PR-0002',
    department: 'كلية الطب البشري',
    purchase_type: 'practice',
    priority: 'urgent',
    budget_line: 'تجهيزات معامل المهارات السريرية',
    needed_by: '2026-10-30',
    requested_by: 'د. وكيل كلية الطب',
    justification: 'استكمال نواقص مستلزمات التدريب الطبي للطلاب.',
    status: 'pending',
    quote_deadline: '2026-10-20',
    selected_quote_id: null,
    submitted_at: '2026-10-10T10:00:00Z',
    created_at: '2026-10-10T09:15:00Z',
    updated_at: '2026-10-11T13:00:00Z',
    created_by: 'مدير المشتريات',
    items_count: 2,
    total_estimated_value: 28000,
    items_summary: 'مجسمات تشريح، مستلزمات تدريب طبي',
    items: [
      {
        id: 'pri-3',
        request_id: 'pr-demo-2',
        item_name: 'مجسم هيكل عظمي تعليمي',
        specifications: 'طبي بالحجم الطبيعي مع مفاصل متحركة',
        quantity: 2,
        unit: 'قطعة',
        estimated_unit_price: 14000,
        estimated_total: 28000,
        custody_item_ref: null,
      },
    ],
    approvals: [
      { id: 'app-5', request_id: 'pr-demo-2', step_no: 1, step_name: 'مدير المشتريات', decision: 'approved', decided_by: 'أحمد علي', decided_at: '2026-10-10T11:00:00Z', notes: 'مطابق للاحتياج' },
      { id: 'app-6', request_id: 'pr-demo-2', step_no: 2, step_name: 'المدير المالي', decision: 'pending', decided_by: null, decided_at: null, notes: null },
      { id: 'app-7', request_id: 'pr-demo-2', step_no: 3, step_name: 'عميد الكلية / أمين الجامعة', decision: 'pending', decided_by: null, decided_at: null, notes: null },
      { id: 'app-8', request_id: 'pr-demo-2', step_no: 4, step_name: 'لجنة الفحص والبت', decision: 'pending', decided_by: null, decided_at: null, notes: null },
    ],
  },
  {
    id: 'pr-demo-3',
    request_no: 'PR-0003',
    department: 'كلية الهندسة',
    purchase_type: 'direct',
    priority: 'normal',
    budget_line: 'مهمات مكتبية وأوراق',
    needed_by: '2026-11-05',
    requested_by: 'مدير إدارة شؤون التعليم والطلاب',
    justification: 'أوراق تصوير وطباعة امتحانات نصف العام الدراسي.',
    status: 'pending',
    quote_deadline: null,
    selected_quote_id: null,
    submitted_at: '2026-10-12T08:30:00Z',
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:30:00Z',
    created_by: 'مدير المشتريات',
    items_count: 1,
    total_estimated_value: 16500,
    items_summary: 'ورق تصوير A4 80 جم (100 كرتونة)',
    items: [
      {
        id: 'pri-4',
        request_id: 'pr-demo-3',
        item_name: 'ورق تصوير A4 80 جم',
        specifications: 'أبيض ناصع 80 جرام - 5 رزم بالكرتونة',
        quantity: 100,
        unit: 'كرتونة',
        estimated_unit_price: 165,
        estimated_total: 16500,
        custody_item_ref: 'ورق تصوير A4',
      },
    ],
    approvals: [
      { id: 'app-9', request_id: 'pr-demo-3', step_no: 1, step_name: 'مدير المشتريات', decision: 'pending', decided_by: null, decided_at: null, notes: null },
      { id: 'app-10', request_id: 'pr-demo-3', step_no: 2, step_name: 'المدير المالي', decision: 'pending', decided_by: null, decided_at: null, notes: null },
      { id: 'app-11', request_id: 'pr-demo-3', step_no: 3, step_name: 'عميد الكلية / أمين الجامعة', decision: 'pending', decided_by: null, decided_at: null, notes: null },
      { id: 'app-12', request_id: 'pr-demo-3', step_no: 4, step_name: 'لجنة الفحص والبت', decision: 'pending', decided_by: null, decided_at: null, notes: null },
    ],
  },
  {
    id: 'pr-demo-4',
    request_no: 'PR-0004',
    department: 'إدارة الأمن الجامعي والخدمات',
    purchase_type: 'direct',
    priority: 'normal',
    budget_line: 'أدوات نظافة ومهمات',
    needed_by: null,
    requested_by: 'مدير الأمن الجامعي',
    justification: 'مهمات نظافة دورية للمبنى الإداري.',
    status: 'draft',
    quote_deadline: null,
    selected_quote_id: null,
    submitted_at: null,
    created_at: '2026-10-14T11:00:00Z',
    updated_at: '2026-10-14T11:00:00Z',
    created_by: 'مدير المشتريات',
    items_count: 1,
    total_estimated_value: 5200,
    items_summary: 'أدوات نظافة ومطهرات للمبنى الإداري',
    items: [],
    approvals: [],
  },
]

const INITIAL_DEMO_QUOTES: SupplierQuote[] = [
  {
    id: 'quote-demo-1',
    request_id: 'pr-demo-1',
    supplier_id: 'sup-demo-3',
    supplier_name: 'شركة الدلتا لتكنولوجيا المعلومات والشبكات',
    total_price: 34500,
    delivery_days: 5,
    payment_terms: 'شيك مؤجل 30 يوماً بعد الفحص والاستلام',
    warranty_months: 24,
    notes: 'أقل سعر مع ضمان سنتين وتوريد شامل التركيب والبرمجة.',
    is_selected: true,
    created_at: '2026-10-04T10:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'quote-demo-2',
    request_id: 'pr-demo-1',
    supplier_id: 'sup-demo-1',
    supplier_name: 'شركة الأهرام للتوريدات المكتبية والأوراق',
    total_price: 37000,
    delivery_days: 7,
    payment_terms: 'دفع بعد الفحص والاستلام',
    warranty_months: 12,
    notes: 'توريد معملي قياسي مع ضمان سنة.',
    is_selected: false,
    created_at: '2026-10-04T11:30:00Z',
    created_by: 'مدير المشتريات',
  },
]

const INITIAL_DEMO_ORDERS: PurchaseOrder[] = [
  {
    id: 'po-demo-1',
    po_no: 'PO-0001',
    request_id: 'pr-demo-1',
    quote_id: 'quote-demo-1',
    supplier_id: 'sup-demo-3',
    supplier_name: 'شركة الدلتا لتكنولوجيا المعلومات والشبكات',
    total: 34500,
    expected_delivery_date: '2026-10-18',
    status: 'open',
    received_on: null,
    invoiced_on: null,
    notes: 'أمر توريد معتمد لتجهيز معمل الحاسبات.',
    created_at: '2026-10-06T10:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'po-demo-2',
    po_no: 'PO-0002',
    request_id: 'pr-demo-1',
    quote_id: 'quote-demo-2',
    supplier_id: 'sup-demo-1',
    supplier_name: 'شركة الأهرام للتوريدات المكتبية والأوراق',
    total: 18000,
    expected_delivery_date: '2026-10-08',
    status: 'open', // Overdue
    received_on: null,
    invoiced_on: null,
    notes: 'أمر توريد ورق تصوير - متأخر عن موعد التسليم.',
    created_at: '2026-09-28T09:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'po-demo-3',
    po_no: 'PO-0003',
    request_id: 'pr-demo-1',
    quote_id: 'quote-demo-1',
    supplier_id: 'sup-demo-2',
    supplier_name: 'مؤسسة النصر للتجهيزات والتجارة',
    total: 52000,
    expected_delivery_date: '2026-10-05',
    status: 'received',
    received_on: '2026-10-06',
    invoiced_on: null,
    notes: 'تم فحص المقاعد والاستلام بالمخزن الرئيسي.',
    created_at: '2026-09-20T10:00:00Z',
    created_by: 'مدير المشتريات',
  },
  {
    id: 'po-demo-4',
    po_no: 'PO-0004',
    request_id: 'pr-demo-1',
    quote_id: 'quote-demo-1',
    supplier_id: 'sup-demo-1',
    supplier_name: 'شركة الأهرام للتوريدات المكتبية والأوراق',
    total: 25000,
    expected_delivery_date: '2026-09-15',
    status: 'invoiced',
    received_on: '2026-09-16',
    invoiced_on: '2026-09-20',
    notes: 'مفوتر بالكامل وتم سداد المستحقات.',
    created_at: '2026-09-01T10:00:00Z',
    created_by: 'مدير المشتريات',
  },
]

// ─── دوال القراءة والكتابة المحلية ──────────────────────────────────────────

export function loadDemoSuppliers(): SupplierStats[] {
  try {
    const raw = localStorage.getItem(DEMO_SUPPLIERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_SUPPLIERS
}

export function saveDemoSuppliers(list: SupplierStats[]): void {
  try {
    localStorage.setItem(DEMO_SUPPLIERS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export function loadDemoRequests(): PurchaseRequest[] {
  try {
    const raw = localStorage.getItem(DEMO_REQUESTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_REQUESTS
}

export function saveDemoRequests(list: PurchaseRequest[]): void {
  try {
    localStorage.setItem(DEMO_REQUESTS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export function loadDemoQuotes(): SupplierQuote[] {
  try {
    const raw = localStorage.getItem(DEMO_QUOTES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_QUOTES
}

export function saveDemoQuotes(list: SupplierQuote[]): void {
  try {
    localStorage.setItem(DEMO_QUOTES_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export function loadDemoOrders(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(DEMO_ORDERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_ORDERS
}

export function saveDemoOrders(list: PurchaseOrder[]): void {
  try {
    localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}
