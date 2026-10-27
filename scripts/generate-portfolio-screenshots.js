import puppeteer from 'puppeteer-core'
import path from 'path'
import fs from 'fs'

const SCREENSHOTS_DIR = path.resolve('portfolio-screenshots')
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
}

// 1. Clean Organization Settings
const mockSettings = {
  organization: 'المستودع الذكي لإدارة المخازن والعهد',
  department: 'إدارة المخازن والمشتريات المركزية',
  currency: 'EGP',
  organizationCode: 'SWL',
  systemName: 'Smart-Warehouse-Ledger'
}

// 2. Clean System Admin Session (Zero real emails or names)
const mockSession = {
  user: {
    id: 'usr-admin-demo-01',
    email: 'admin@smart-ledger.org',
    user_metadata: {
      username: 'ahmed-elshinawy',
      name: 'م. أحمد الشناوي',
      displayName: 'م. أحمد الشناوي (مدير النظام)',
      role: 'system_admin',
      permissions: ['view_audit', 'view_settings', 'manage_records'],
      employeeId: 'ADM-1001'
    },
    app_metadata: {
      role: 'system_admin',
      system_admin: true,
      permissions: ['view_audit', 'view_settings', 'manage_records'],
      username: 'ahmed-elshinawy',
      employeeId: 'ADM-1001'
    }
  },
  access_token: 'demo-clean-token'
}

// 3. Clean Users List (Diverse staff roles)
const mockUsers = [
  {
    id: 'usr-001',
    username: 'ahmed-elshinawy',
    displayName: 'م. أحمد الشناوي (مدير النظام)',
    role: 'system_admin',
    activationCode: '100101',
    status: 'active',
    createdAt: '2025-01-15T08:00:00Z',
    employeeId: 'ADM-1001',
    email: 'admin@smart-ledger.org',
    department: 'الإدارة العامة',
    permissions: ['view_audit', 'view_settings', 'manage_records']
  },
  {
    id: 'usr-002',
    username: 'sara-ibrahim',
    displayName: 'أ. سارة إبراهيم (مدير المشتريات)',
    role: 'procurement_admin',
    activationCode: '204502',
    status: 'active',
    createdAt: '2025-02-01T09:30:00Z',
    employeeId: 'PRC-2045',
    email: 'sara.ibrahim@smart-ledger.org',
    department: 'المشتريات والتوريدات',
    permissions: ['manage_records']
  },
  {
    id: 'usr-003',
    username: 'mahmoud-abdelaziz',
    displayName: 'أ. محمود عبد العزيز (أمين المخزن الرئيسي)',
    role: 'warehouse_admin',
    activationCode: '301203',
    status: 'active',
    createdAt: '2025-02-10T10:15:00Z',
    employeeId: 'WHS-3012',
    email: 'mahmoud.aziz@smart-ledger.org',
    department: 'المخازن',
    permissions: ['manage_records']
  },
  {
    id: 'usr-004',
    username: 'dr-khaled-mansour',
    displayName: 'د. خالد منصور (مشرف عهدة الهندسة)',
    role: 'editor',
    activationCode: '408904',
    status: 'active',
    createdAt: '2025-03-01T11:00:00Z',
    employeeId: 'ENG-4089',
    email: 'k.mansour@smart-ledger.org',
    department: 'كلية الهندسة',
    permissions: []
  },
  {
    id: 'usr-005',
    username: 'mona-tarek',
    displayName: 'أ. منى طارق (أخصائي فحص الجودة)',
    role: 'warehouse_staff',
    activationCode: '502105',
    status: 'active',
    createdAt: '2025-03-15T12:00:00Z',
    employeeId: 'QLT-5021',
    email: 'mona.tarek@smart-ledger.org',
    department: 'إدارة الجودة',
    permissions: []
  },
  {
    id: 'usr-006',
    username: 'omar-hassan',
    displayName: 'م. عمر حسن (الدعم الفني والشبكات)',
    role: 'viewer',
    activationCode: '601406',
    status: 'pending_activation',
    createdAt: '2025-04-01T08:45:00Z',
    employeeId: 'IT-6014',
    email: 'omar.hassan@smart-ledger.org',
    department: 'تكنولوجيا المعلومات',
    permissions: []
  }
]

// 4. Clean Suppliers
const mockSuppliers = [
  {
    id: 'sup-001',
    name: 'شركة التقنية المتقدمة للحلول الرقمية',
    name_key: 'شركة التقنية المتقدمة للحلول الرقمية',
    category: 'تكنولوجيا وحواسب',
    commercial_register: '1048209',
    contact_name: 'م. طارق المهدي',
    phone: '01023456781',
    status: 'active',
    rating: 4.9,
    notes: 'مورد معتمد للخوادم والتجهيزات البرمجية والبنية التحتية',
    created_at: '2025-01-10T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    created_by: 'usr-002',
    po_count: 8,
    invoices_count: 12,
    total_spend: 1850000
  },
  {
    id: 'sup-002',
    name: 'الدولية للتجهيزات الطبية والمعملية',
    name_key: 'الدولية للتجهيزات الطبية والمعملية',
    category: 'أجهزة طبية ومعامل',
    commercial_register: '2938104',
    contact_name: 'د. سامي رضوان',
    phone: '01198765432',
    status: 'active',
    rating: 4.8,
    notes: 'وكيل حصري لأجهزة التحليل والميكروسكوبات الرقمية',
    created_at: '2025-01-12T10:00:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    created_by: 'usr-002',
    po_count: 6,
    invoices_count: 9,
    total_spend: 1420000
  },
  {
    id: 'sup-003',
    name: 'المجموعة الحديثة للشاشات التفاعلية',
    name_key: 'المجموعة الحديثة للشاشات التفاعلية',
    category: 'شاشات ووسائط ذكية',
    commercial_register: '8847120',
    contact_name: 'أ. حاتم فؤاد',
    phone: '01234567890',
    status: 'active',
    rating: 4.7,
    notes: 'توريد وتركيب الشاشات التفاعلية لقاعات المحاضرات والمعامل',
    created_at: '2025-01-20T10:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
    created_by: 'usr-002',
    po_count: 4,
    invoices_count: 6,
    total_spend: 840000
  },
  {
    id: 'sup-004',
    name: 'الشركة الهندسية للشبكات والخوادم',
    name_key: 'الشركة الهندسية للشبكات والخوادم',
    category: 'شبكات واتصالات',
    commercial_register: '4492015',
    contact_name: 'م. كريم يوسف',
    phone: '01011223344',
    status: 'active',
    rating: 4.9,
    notes: 'توريد كابلات الفايبر ومفاتيح سيسكو وحلول مراكز البيانات',
    created_at: '2025-02-05T10:00:00Z',
    updated_at: '2026-10-18T10:00:00Z',
    created_by: 'usr-002',
    po_count: 5,
    invoices_count: 7,
    total_spend: 960000
  },
  {
    id: 'sup-005',
    name: 'ميديكال إكويبمنت لتجهيزات الأسنان',
    name_key: 'ميديكال إكويبمنت لتجهيزات الأسنان',
    category: 'معدات أسنان',
    commercial_register: '6310248',
    contact_name: 'د. نبيل عزمي',
    phone: '01556677889',
    status: 'active',
    rating: 4.6,
    notes: 'وحدات معالجة الأسنان وأجهزة التعقيم الرقمي',
    created_at: '2025-02-15T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    created_by: 'usr-002',
    po_count: 3,
    invoices_count: 4,
    total_spend: 1150000
  },
  {
    id: 'sup-006',
    name: 'الأفق للصوتيات والمرئيات والمسارح',
    name_key: 'الأفق للصوتيات والمرئيات والمسارح',
    category: 'صوتيات وعرض',
    commercial_register: '7120931',
    contact_name: 'أ. شريف كمال',
    phone: '01099887766',
    status: 'under_review',
    rating: 4.5,
    notes: 'توريد أجهزة العرض الليزري 4K وأنظمة الصوت المركزية',
    created_at: '2025-03-01T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    created_by: 'usr-002',
    po_count: 2,
    invoices_count: 3,
    total_spend: 520000
  }
]

// 5. Clean Movements (Ledger - with CURRENT month 2026-10 dates for active analytics)
const mockMovements = [
  {
    id: 'mov-101',
    date: '2026-10-02',
    inv: 'INV-2026-101',
    from: 'شركة التقنية المتقدمة للحلول الرقمية',
    to: 'معامل كلية الحاسبات والذكاء الاصطناعي',
    permit: 'DSP-2026-001',
    issue: '2026-10-05',
    item: 'خادم شبكات عالي الأداء Dell PowerEdge R750',
    price: 185000,
    qin: 5,
    qout: 3,
    notes: 'مخصص لمشروعات الذكاء الاصطناعي ومعالجة البيانات الضخمة'
  },
  {
    id: 'mov-102',
    date: '2026-10-04',
    inv: 'INV-2026-102',
    from: 'المجموعة الحديثة للشاشات التفاعلية',
    to: 'قاعات المحاضرات المركزية',
    permit: 'DSP-2026-002',
    issue: '2026-10-08',
    item: 'شاشات تفاعلية ذكية 75 بوصة Ultra HD 4K Touch',
    price: 42000,
    qin: 15,
    qout: 12,
    notes: 'تجهيز القاعات الذكية والشاشات التفاعلية'
  },
  {
    id: 'mov-103',
    date: '2026-10-06',
    inv: 'INV-2026-103',
    from: 'الدولية للتجهيزات الطبية والمعملية',
    to: 'معامل بحوث كلية الطب البشري',
    permit: 'DSP-2026-003',
    issue: '2026-10-10',
    item: 'ميكروسكوب ضوئي رقمي متقدم Olympus CX23 Digital',
    price: 28500,
    qin: 25,
    qout: 20,
    notes: 'معامل الأنسجة والباثولوجي للكلية'
  },
  {
    id: 'mov-104',
    date: '2026-10-08',
    inv: 'INV-2026-104',
    from: 'الشركة الهندسية للشبكات والخوادم',
    to: 'معامل التصميم والنمذجة - كلية الهندسة',
    permit: 'DSP-2026-004',
    issue: '2026-10-12',
    item: 'أجهزة حاسب محطة عمل متقدمة HP Workstation Z2 G9',
    price: 36000,
    qin: 40,
    qout: 35,
    notes: 'معامل الأوتوكاد والرسم الهندسي والمحاكاة'
  },
  {
    id: 'mov-105',
    date: '2026-10-10',
    inv: 'INV-2026-105',
    from: 'ميديكال إكويبمنت لتجهيزات الأسنان',
    to: 'المستشفى التعليمي لطب الأسنان',
    permit: 'DSP-2026-005',
    issue: '2026-10-15',
    item: 'وحدات علاج وتدريب الأسنان المتكاملة Dental Units',
    price: 195000,
    qin: 6,
    qout: 4,
    notes: 'عيادات الجراحة والتركيبات بمستشفى الأسنان'
  },
  {
    id: 'mov-106',
    date: '2026-10-12',
    inv: 'INV-2026-106',
    from: 'الشركة الهندسية للشبكات والخوادم',
    to: 'مركز العمليات والبيانات الرئيسي',
    permit: 'DSP-2026-006',
    issue: '2026-10-16',
    item: 'مفاتيح شبكات سويتش سيسكو Cisco Catalyst 9300 48P',
    price: 68000,
    qin: 12,
    qout: 10,
    notes: 'تحديث البنية التحتية لشبكة الألياف الضوئية'
  },
  {
    id: 'mov-107',
    date: '2026-10-14',
    inv: 'INV-2026-107',
    from: 'الدولية للتجهيزات الطبية والمعملية',
    to: 'معامل التحليل الصيدلي - كلية الصيدلة',
    permit: 'DSP-2026-007',
    issue: '',
    item: 'أجهزة قياس الطيف الضوئي Spectrophotometer UV-Vis',
    price: 145000,
    qin: 4,
    qout: 0,
    notes: 'بانتظار استكمال تجهيز الطاولات المعملية المقاومة للاهتزاز'
  },
  {
    id: 'mov-108',
    date: '2026-10-15',
    inv: 'INV-2026-108',
    from: 'الأفق للصوتيات والمرئيات والمسارح',
    to: 'مدرج الاحتفالات والمؤتمرات الكبرى',
    permit: 'DSP-2026-008',
    issue: '2026-10-18',
    item: 'أجهزة عرض ليزرية احترافية Laser Projector 4K 10000 Lumens',
    price: 85000,
    qin: 6,
    qout: 4,
    notes: 'مدرجات المؤتمرات والندوات الدولية'
  },
  {
    id: 'mov-109',
    date: '2026-10-16',
    inv: 'INV-2026-109',
    from: 'الدولية للتجهيزات الطبية والمعملية',
    to: 'معامل مهارات المحاكاة السريرية - كلية التمريض',
    permit: 'DSP-2026-009',
    issue: '2026-10-19',
    item: 'محاكيات رعاية سريرية ومجسمات مريض تفاعلية Patient Simulator',
    price: 110000,
    qin: 8,
    qout: 6,
    notes: 'تدريب طلاب الامتياز والدراسات العليا'
  },
  {
    id: 'mov-110',
    date: '2026-10-18',
    inv: 'INV-2026-110',
    from: 'شركة التقنية المتقدمة للحلول الرقمية',
    to: 'مكتبات المعامل الرقمية والبحث العلمي',
    permit: 'DSP-2026-010',
    issue: '',
    item: 'طابعات ثلاثية الأبعاد احترافية 3D Printer Dual Extruder',
    price: 32000,
    qin: 10,
    qout: 0,
    notes: 'معامل الابتكار وحاضنة المشاريع الطلابية'
  }
]

// 6. Clean Custody Items (Evenly spread across all 8 colleges)
const mockCustodyItems = [
  // 1. المخزن الرئيسي (Main Warehouse Hub)
  {
    id: 'cst-main-01',
    warehouseId: 'main',
    code: 'MAIN-001',
    name: 'خادم شبكات عالي الأداء Dell PowerEdge R750',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'وحدة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم السيرفرات',
    acquisitionDate: '2026-10-02',
    unitPrice: 185000,
    value: 370000,
    serialNumber: 'SN-DELL-750-MAIN',
    notes: 'رصيد استراتيجي متاح بالمستودع الرئيسي'
  },
  {
    id: 'cst-main-02',
    warehouseId: 'main',
    code: 'MAIN-002',
    name: 'شاشات تفاعلية ذكية 75 بوصة Ultra HD 4K Touch',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 3,
    unit: 'شاشة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الشاشات',
    acquisitionDate: '2026-10-04',
    unitPrice: 42000,
    value: 126000,
    serialNumber: 'SN-DISP-MAIN-3X',
    notes: 'رصيد متاح للتوريد للكليات'
  },
  {
    id: 'cst-main-03',
    warehouseId: 'main',
    code: 'MAIN-003',
    name: 'أجهزة حاسب محطة عمل متقدمة HP Workstation Z2',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 5,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الحاسبات',
    acquisitionDate: '2026-10-08',
    unitPrice: 36000,
    value: 180000,
    serialNumber: 'SN-HP-Z2-MAIN',
    notes: 'جاهزة للصرف حسب أوامر الشغل'
  },
  {
    id: 'cst-main-04',
    warehouseId: 'main',
    code: 'MAIN-004',
    name: 'طابعات ثلاثية الأبعاد احترافية 3D Printer Dual Extruder',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 10,
    unit: 'طابعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الأجهزة المتطورة',
    acquisitionDate: '2026-10-18',
    unitPrice: 32000,
    value: 320000,
    serialNumber: 'SN-3D-PRINT-10X',
    notes: 'توريد جديد فاتورة INV-2026-110'
  },

  // 2. كلية حاسبات ومعلومات (FCI)
  {
    id: 'cst-fci-01',
    warehouseId: 'fci',
    code: 'FCI-001',
    name: 'خادم معالجة الذكاء الاصطناعي Dell PowerEdge R750',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'د. هشام القاضي (رئيس قسم الحاسبات)',
    quantity: 3,
    unit: 'وحدة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى الحاسبات - قاعة السيرفرات الرئيسية',
    acquisitionDate: '2026-10-05',
    unitPrice: 185000,
    value: 555000,
    serialNumber: 'SN-FCI-SRV-01',
    notes: 'منصرف بإذن صرف DSP-2026-001'
  },
  {
    id: 'cst-fci-02',
    warehouseId: 'fci',
    code: 'FCI-002',
    name: 'شاشات تفاعلية ذكية 75 بوصة Ultra HD 4K',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'م. مروة سالم (مشرف المعامل)',
    quantity: 6,
    unit: 'شاشة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مجمع المعامل البرمجية - الدور الثاني',
    acquisitionDate: '2026-10-08',
    unitPrice: 42000,
    value: 252000,
    serialNumber: 'SN-FCI-DISP-6X',
    notes: 'موزعة على المعامل 201، 202، 203'
  },

  // 3. كلية هندسة (Engineering)
  {
    id: 'cst-eng-01',
    warehouseId: 'engineering',
    code: 'ENG-001',
    name: 'أجهزة حاسب محطة عمل متقدمة HP Workstation Z2 G9',
    category: 'أجهزة إلكترونية وحواسب',
    custodian: 'د. خالد منصور (مشرف عهدة الهندسة)',
    quantity: 35,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مجمع الورش والمعامل - معمل الأوتوكاد 304',
    acquisitionDate: '2026-10-12',
    unitPrice: 36000,
    value: 1260000,
    serialNumber: 'SN-ENG-HP-Z2',
    notes: 'محطات عمل مجهزة ببطاقات رسومية للنمذجة الهندسية'
  },
  {
    id: 'cst-eng-02',
    warehouseId: 'engineering',
    code: 'ENG-002',
    name: 'أجهزة راسم إشارة رقمي متقدم Oscilloscope 200MHz',
    category: 'أجهزة معملية وتجارب',
    custodian: 'م. أشرف نبيل (مهندس معمل الإلكترونيات)',
    quantity: 12,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'معمل القوى الكهربية والتحكم',
    acquisitionDate: '2026-10-14',
    unitPrice: 24000,
    value: 288000,
    serialNumber: 'SN-ENG-OSC-12X',
    notes: 'أجهزة قياس وتحليل الدوائر الإلكترونية'
  },

  // 4. كلية طب بشري (Medicine)
  {
    id: 'cst-med-01',
    warehouseId: 'medicine',
    code: 'MED-001',
    name: 'ميكروسكوب ضوئي رقمي متقدم Olympus CX23 Digital',
    category: 'أجهزة ومعدات طبية',
    custodian: 'د. ياسمين حامد (أستاذ الباثولوجي)',
    quantity: 20,
    unit: 'ميكروسكوب',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى كلية الطب - معمل الباثولوجي والأنسجة',
    acquisitionDate: '2026-10-10',
    unitPrice: 28500,
    value: 570000,
    serialNumber: 'SN-MED-OLY-20X',
    notes: 'مزود بعدسات تكبير فائقة الدقة وكاميرا رقمية'
  },
  {
    id: 'cst-med-02',
    warehouseId: 'medicine',
    code: 'MED-002',
    name: 'مجسمات تشريحية ثلاثية الأبعاد تفاعلية 3D Anatomy Model',
    category: 'أجهزة ومعدات طبية',
    custodian: 'د. كريم عبد الخالق (مشرف المشرحة)',
    quantity: 8,
    unit: 'مجسم',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'جناح التشريح والمهارات الطبية السريرية',
    acquisitionDate: '2026-10-12',
    unitPrice: 45000,
    value: 360000,
    serialNumber: 'SN-MED-ANT-8X',
    notes: 'مجسمات هيكل عظمي وأعضاء داخلية قابلة للفك'
  },

  // 5. كلية طب أسنان (Dentistry)
  {
    id: 'cst-dent-01',
    warehouseId: 'dentistry',
    code: 'DENT-001',
    name: 'وحدات علاج وتدريب الأسنان المتكاملة Dental Delivery Units',
    category: 'أجهزة ومعدات طبية',
    custodian: 'د. وليد الباز (مدير المستشفى التعليمي)',
    quantity: 4,
    unit: 'وحدة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى المستشفى التعليمي لطب الأسنان - العيادات الخارجية',
    acquisitionDate: '2026-10-15',
    unitPrice: 195000,
    value: 780000,
    serialNumber: 'SN-DENT-UNIT-4X',
    notes: 'وحدات تشغيل هيدروليكية كاملة مع أنظمة التعقيم'
  },
  {
    id: 'cst-dent-02',
    warehouseId: 'dentistry',
    code: 'DENT-002',
    name: 'أجهزة تعقيم جراحي أوتوكلاف رقمي Class B Autoclave',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أ. هناء عثمان (مشرف التعقيم المركزي)',
    quantity: 3,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'وحدة التعقيم المركزي بالمستشفى',
    acquisitionDate: '2026-10-16',
    unitPrice: 62000,
    value: 186000,
    serialNumber: 'SN-DENT-AUTO-3X',
    notes: 'مطابقة للمعايير الصحية الأوروبية'
  },

  // 6. كلية صيدلة (Pharmacy)
  {
    id: 'cst-pharm-01',
    warehouseId: 'pharmacy',
    code: 'PHARM-001',
    name: 'أجهزة قياس الطيف الضوئي Spectrophotometer UV-Vis',
    category: 'أجهزة معملية وتجارب',
    custodian: 'د. عادل عبد الرحمن (رئيس قسم التحليل الصيدلي)',
    quantity: 4,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى كلية الصيدلة - الدور الثاني معمل 204',
    acquisitionDate: '2026-10-14',
    unitPrice: 145000,
    value: 580000,
    serialNumber: 'SN-PHARM-SPEC-4X',
    notes: 'أجهزة معملية عالية الدقة لتحليل المركبات'
  },
  {
    id: 'cst-pharm-02',
    warehouseId: 'pharmacy',
    code: 'PHARM-002',
    name: 'موازين إلكترونية تحليلية دقيقة Analytical Balance 0.0001g',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أ. سميرة جلال (أمينة المعامل الكيميائية)',
    quantity: 6,
    unit: 'ميزان',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'معمل الكيمياء الدوائية',
    acquisitionDate: '2026-10-15',
    unitPrice: 28000,
    value: 168000,
    serialNumber: 'SN-PHARM-BAL-6X',
    notes: 'مزود بحاجز زجاجي للحماية من تيارات الهواء'
  },

  // 7. كلية تمريض (Nursing)
  {
    id: 'cst-nurs-01',
    warehouseId: 'nursing',
    code: 'NURS-001',
    name: 'محاكيات رعاية سريرية ومجسمات مريض تفاعلية Patient Simulator',
    category: 'أجهزة ومعدات طبية',
    custodian: 'د. رجاء فتحي (عميد كلية التمريض)',
    quantity: 6,
    unit: 'مجسم',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى كلية التمريض - معامل المهارات التمريضية',
    acquisitionDate: '2026-10-19',
    unitPrice: 110000,
    value: 660000,
    serialNumber: 'SN-NURS-SIM-6X',
    notes: 'محاكاة سريرية لتدريب الطلاب على التعامل مع الطوارئ'
  },
  {
    id: 'cst-nurs-02',
    warehouseId: 'nursing',
    code: 'NURS-002',
    name: 'أجهزة صدمات القلب وإعادة الإنعاش Defibrillator Monitor',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أ. ريم صلاح (مشرف معمل الطوارئ)',
    quantity: 4,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'معمل العناية المركزة والطوارئ',
    acquisitionDate: '2026-10-19',
    unitPrice: 58000,
    value: 232000,
    serialNumber: 'SN-NURS-DEF-4X',
    notes: 'أجهزة تدريب سريري مع وحدات تخطيط قلب مدمجة'
  },

  // 8. المعمل المركزي (Central Lab)
  {
    id: 'cst-clab-01',
    warehouseId: 'central_lab',
    code: 'CLAB-001',
    name: 'أجهزة طرد مركزي تبريدي فائق السرعة Refrigerated Centrifuge',
    category: 'أجهزة معملية وتجارب',
    custodian: 'د. حسام الدين شريف (مدير المعمل المركزي)',
    quantity: 5,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مجمع المعامل البحثية المركزية - جناح البيولوجيا الجزيئية',
    acquisitionDate: '2026-10-16',
    unitPrice: 92000,
    value: 460000,
    serialNumber: 'SN-CLAB-CENT-5X',
    notes: 'سرعة دوران 15,000 دورة مع تبريد رقمي حتى -20 درجة'
  },
  {
    id: 'cst-clab-02',
    warehouseId: 'central_lab',
    code: 'CLAB-002',
    name: 'أجهزة التضخيم الجيني الرقمي Real-Time PCR Thermal Cycler',
    category: 'أجهزة معملية وتجارب',
    custodian: 'د. رانيا عبد العزيز (باحث أول وراثة)',
    quantity: 3,
    unit: 'جهاز',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'معمل أبحاث الجينوم والتكنولوجيا الحيوية',
    acquisitionDate: '2026-10-18',
    unitPrice: 210000,
    value: 630000,
    serialNumber: 'SN-CLAB-PCR-3X',
    notes: 'أجهزة بحثية متقدمة مزودة بنظام كشف فلوري متعدد القنوات'
  }
]

// 7. Clean Audit Logs
const mockAuditLogs = [
  {
    id: 'aud-001',
    user_id: 'usr-001',
    user_email: 'admin@smart-ledger.org',
    action: 'تسجيل دخول آمن إلى النظام (لوحة التحكم الرئيسية)',
    entity_type: 'auth',
    entity_id: 'session-login-01',
    details: { method: 'local_authenticated', role: 'system_admin' },
    ip_address: '192.168.1.10',
    user_agent: 'Chrome 131.0 Windows 11 Enterprise',
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString()
  },
  {
    id: 'aud-002',
    user_id: 'usr-002',
    user_email: 'sara.ibrahim@smart-ledger.org',
    action: 'اعتماد أمر الشراء رقم PO-2026-001 ومطابقة عرض السعر الفائز',
    entity_type: 'purchase_order',
    entity_id: 'PO-2026-001',
    details: { supplier: 'شركة التقنية المتقدمة للحلول الرقمية', total: 925000 },
    ip_address: '192.168.1.25',
    user_agent: 'Chrome 131.0 Windows 11 Enterprise',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()
  },
  {
    id: 'aud-003',
    user_id: 'usr-003',
    user_email: 'mahmoud.aziz@smart-ledger.org',
    action: 'إصدار إذن صرف مخزني رقم DSP-2026-004 (35 محطة عمل HP Workstation)',
    entity_type: 'disbursement',
    entity_id: 'DSP-2026-004',
    details: { recipient: 'معامل كلية الهندسة', status: 'approved' },
    ip_address: '192.168.1.42',
    user_agent: 'Chrome 131.0 Windows 11 Enterprise',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
  },
  {
    id: 'aud-004',
    user_id: 'usr-005',
    user_email: 'mona.tarek@smart-ledger.org',
    action: 'إجراء الفحص الدوري لجودة وسلامة البيانات والمطابقة المخزنية',
    entity_type: 'quality',
    entity_id: 'audit-qlt-109',
    details: { score: '100% سليم', issuesCount: 0 },
    ip_address: '192.168.1.33',
    user_agent: 'Chrome 131.0 Windows 11 Enterprise',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: 'aud-005',
    user_id: 'usr-001',
    user_email: 'admin@smart-ledger.org',
    action: 'تفعيل صلاحيات إشرافية جديدة للمستخدم د. خالد منصور',
    entity_type: 'user_management',
    entity_id: 'usr-004',
    details: { assignedRole: 'editor', targetDept: 'كلية الهندسة' },
    ip_address: '192.168.1.10',
    user_agent: 'Chrome 131.0 Windows 11 Enterprise',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()
  }
]

// 8. Clean Purchase Requests & Quotes
const mockPurchaseRequests = [
  {
    id: 'pr-001',
    request_no: 'PR-2026-001',
    department: 'كلية الحاسبات والذكاء الاصطناعي',
    purchase_type: 'tender',
    budget_line: 'بند تجهيزات المعامل والذكاء الاصطناعي',
    priority: 'urgent',
    needed_by: '2026-11-30',
    requested_by: 'د. هشام القاضي',
    justification: 'تجهيز معمل الذكاء الاصطناعي بخوادم متقدمة لتدريب النماذج اللغوية والرؤية الحاسوبية',
    status: 'approved',
    quote_deadline: '2026-10-25',
    selected_quote_id: 'qte-001',
    submitted_at: '2026-10-01T10:00:00Z',
    created_at: '2026-10-01T09:00:00Z'
  },
  {
    id: 'pr-002',
    request_no: 'PR-2026-002',
    department: 'كلية الهندسة',
    purchase_type: 'practice',
    budget_line: 'تجهيزات الورش والمعامل الهندسية',
    priority: 'normal',
    needed_by: '2026-12-15',
    requested_by: 'د. خالد منصور',
    justification: 'تحديث محطات العمل لمعامل الرسم والتصميم الهندسي ثلاثي الأبعاد',
    status: 'approved',
    quote_deadline: '2026-10-28',
    selected_quote_id: 'qte-002',
    submitted_at: '2026-10-05T11:00:00Z',
    created_at: '2026-10-05T10:00:00Z'
  }
]

const mockQuotes = [
  {
    id: 'qte-001',
    request_id: 'pr-001',
    supplier_id: 'sup-001',
    supplier_name: 'شركة التقنية المتقدمة للحلول الرقمية',
    total_price: 925000,
    delivery_days: 10,
    warranty_months: 36,
    status: 'accepted',
    notes: 'شامل التركيب والضمان الممتد 3 سنوات ودعم فني على مدار الساعة',
    created_at: '2026-10-08T14:00:00Z'
  },
  {
    id: 'qte-002',
    request_id: 'pr-001',
    supplier_id: 'sup-004',
    supplier_name: 'الشركة الهندسية للشبكات والخوادم',
    total_price: 950000,
    delivery_days: 14,
    warranty_months: 24,
    status: 'rejected',
    notes: 'عرض منافس مطابق للمواصفات الفنية',
    created_at: '2026-10-09T16:00:00Z'
  }
]

const mockPurchaseOrders = [
  {
    id: 'po-001',
    po_no: 'PO-2026-001',
    request_id: 'pr-001',
    quote_id: 'qte-001',
    supplier_name: 'شركة التقنية المتقدمة للحلول الرقمية',
    total_amount: 925000,
    status: 'received',
    issued_at: '2026-10-12T10:00:00Z',
    received_at: '2026-10-20T14:00:00Z',
    notes: 'تم فحص الشحنة واستلامها مطابقة للمواصفات'
  }
]

async function setupPageData(page, { darkMode = false, authenticated = true } = {}) {
  await page.evaluateOnNewDocument((data, isDark, isAuth) => {
    // 1. Seed LocalStorage
    if (isAuth) {
      localStorage.setItem('warehouse-ledger-local-session', JSON.stringify(data.session))
      sessionStorage.setItem('warehouse-ledger-local-session', JSON.stringify(data.session))
    } else {
      localStorage.removeItem('warehouse-ledger-local-session')
      sessionStorage.removeItem('warehouse-ledger-local-session')
    }

    localStorage.setItem('warehouse-ledger-theme', isDark ? 'dark' : 'light')
    localStorage.setItem('warehouse-ledger-settings', JSON.stringify(data.settings))
    localStorage.setItem('warehouse-ledger-local-users', JSON.stringify(data.users))
    localStorage.setItem('warehouse_custom_suppliers', JSON.stringify(data.suppliers))
    localStorage.setItem('warehouse-ledger-movements', JSON.stringify(data.movements))
    localStorage.setItem('warehouse-ledger-custody-items', JSON.stringify(data.custodyItems))
    localStorage.setItem('warehouse-ledger-audit-logs', JSON.stringify(data.auditLogs))
    localStorage.setItem('warehouse_custom_purchase_requests', JSON.stringify(data.purchaseRequests))
    localStorage.setItem('warehouse_custom_quotes', JSON.stringify(data.quotes))
    localStorage.setItem('warehouse_custom_purchase_orders', JSON.stringify(data.purchaseOrders))

    // 2. Intercept fetch for Supabase calls to return our rich sanitized data
    const origFetch = window.fetch
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || ''
      
      if (url.includes('supabase.co')) {
        let body = []
        let status = 200
        let headers = { 'content-type': 'application/json' }

        // Match table: /rest/v1/movements
        if (/\/rest\/v1\/movements(\?|$)/.test(url)) {
          body = data.movements.map((m, idx) => ({
            id: `00000000-0000-0000-0000-00000000000${(idx + 1).toString(16)}`,
            received_on: String(m.date),
            invoice_number: String(m.inv),
            supplier: String(m.from),
            recipient: String(m.to),
            permit: String(m.permit),
            issued_on: String(m.issue),
            item: String(m.item),
            unit_price: String(m.price),
            qty_in: String(m.qin),
            qty_out: String(m.qout),
            notes: String(m.notes),
            created_at: `${m.date}T10:00:00Z`
          }))
          headers['content-range'] = `0-${body.length - 1}/${body.length}`
        } else if (/\/rest\/v1\/custody_items(\?|$)/.test(url)) {
          body = data.custodyItems.map(c => ({
            id: c.id,
            warehouse_id: c.warehouseId,
            code: c.code,
            name: c.name,
            category: c.category,
            quantity: c.quantity,
            unit: c.unit,
            unit_price: c.unitPrice,
            value: c.value,
            condition: c.condition,
            custodian: c.custodian,
            room_location: c.roomLocation,
            serial_number: c.serialNumber,
            notes: c.notes,
            custody_type: c.custodyType,
            created_at: `${c.acquisitionDate}T10:00:00Z`
          }))
          headers['content-range'] = `0-${body.length - 1}/${body.length}`
        } else if (/\/rest\/v1\/app_users(\?|$)/.test(url)) {
          body = data.users.map(u => ({
            id: u.id,
            username: u.username,
            display_name: u.displayName,
            role: u.role,
            activation_code: u.activationCode,
            status: u.status,
            created_at: u.createdAt,
            employee_id: u.employeeId,
            email: u.email,
            department: u.department,
            permissions: u.permissions
          }))
        } else if (/\/rest\/v1\/app_settings(\?|$)/.test(url)) {
          body = [data.settings]
        } else if (/\/rest\/v1\/suppliers(\?|$)/.test(url)) {
          body = data.suppliers
        } else if (/\/rest\/v1\/purchase_requests(\?|$)/.test(url)) {
          body = data.purchaseRequests
        } else if (/\/rest\/v1\/supplier_quotes(\?|$)/.test(url)) {
          body = data.quotes
        } else if (/\/rest\/v1\/purchase_orders(\?|$)/.test(url)) {
          body = data.purchaseOrders
        } else if (/\/rest\/v1\/audit_logs(\?|$)/.test(url)) {
          body = data.auditLogs
        } else if (/\/auth\/v1/.test(url)) {
          if (isAuth) {
            body = { user: data.session.user, session: data.session }
          } else {
            return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401, headers })
          }
        }

        return new Response(JSON.stringify(body), {
          status,
          headers: new Headers(headers)
        })
      }

      return origFetch.apply(this, arguments)
    }
  }, {
    settings: mockSettings,
    session: mockSession,
    users: mockUsers,
    suppliers: mockSuppliers,
    movements: mockMovements,
    custodyItems: mockCustodyItems,
    auditLogs: mockAuditLogs,
    purchaseRequests: mockPurchaseRequests,
    quotes: mockQuotes,
    purchaseOrders: mockPurchaseOrders
  }, darkMode, authenticated)
}

async function captureScreen(browser, {
  name,
  urlPath,
  darkMode = false,
  authenticated = true,
  waitForSelector = 'main',
  action = null,
  delay = 1400
}) {
  console.log(`📸 Capturing: ${name}...`)
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })

  await setupPageData(page, { darkMode, authenticated })

  const fullUrl = `http://localhost:5173${urlPath}`
  await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 30000 })

  if (waitForSelector) {
    try {
      await page.waitForSelector(waitForSelector, { timeout: 6000 })
    } catch {
      // continue
    }
  }

  if (action) {
    await action(page)
  }

  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay))
  }

  const outputPath = path.join(SCREENSHOTS_DIR, `${name}.png`)
  await page.screenshot({ path: outputPath, fullPage: false })
  console.log(`✅ Saved: ${outputPath}`)
  await page.close()
}

async function run() {
  console.log('🚀 Starting Enhanced High-Resolution Portfolio Capture...')
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=max',
      '--force-color-profile=srgb'
    ]
  })

  try {
    // 1. Dashboard Overview (Main)
    await captureScreen(browser, {
      name: '01-dashboard-overview',
      urlPath: '/',
      delay: 1500
    })

    // 2. Dashboard - Procurement Analytics Tab
    await captureScreen(browser, {
      name: '02-dashboard-procurement-analytics',
      urlPath: '/',
      action: async (page) => {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'))
          const target = btns.find(b => b.textContent && b.textContent.includes('المشتريات'))
          if (target) target.click()
        })
      },
      delay: 1200
    })

    // 3. Dashboard - Custody Analytics Tab
    await captureScreen(browser, {
      name: '03-dashboard-custody-analytics',
      urlPath: '/',
      action: async (page) => {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'))
          const target = btns.find(b => b.textContent && b.textContent.includes('العهد والأصول'))
          if (target) target.click()
        })
      },
      delay: 1200
    })

    // 4. Purchases Ledger
    await captureScreen(browser, {
      name: '04-purchases-ledger',
      urlPath: '/purchases',
      delay: 1200
    })

    // 5. Add Purchase / Procurement Form
    await captureScreen(browser, {
      name: '05-add-purchase-transaction',
      urlPath: '/purchases?tab=add',
      delay: 1200
    })

    // 6. Suppliers Management
    await captureScreen(browser, {
      name: '06-suppliers-management',
      urlPath: '/purchases/suppliers',
      delay: 1200
    })

    // 7. Price Quotes and Purchase Orders
    await captureScreen(browser, {
      name: '07-quotes-and-purchase-orders',
      urlPath: '/purchases/quotes',
      delay: 1200
    })

    // 8. Custody - Main Warehouse Hub
    await captureScreen(browser, {
      name: '08-custody-main-warehouse',
      urlPath: '/custody?warehouse=main',
      delay: 1400
    })

    // 9. Custody - College of Engineering
    await captureScreen(browser, {
      name: '09-custody-engineering-college',
      urlPath: '/custody?warehouse=engineering',
      delay: 1200
    })

    // 10. Custody - College of Computers & AI (FCI)
    await captureScreen(browser, {
      name: '10-custody-fci-college',
      urlPath: '/custody?warehouse=fci',
      delay: 1200
    })

    // 11. Official Reports Center
    await captureScreen(browser, {
      name: '11-official-reports-center',
      urlPath: '/reports',
      delay: 1400
    })

    // 12. Official Disbursement Permit Modal
    await captureScreen(browser, {
      name: '12-disbursement-permit-modal',
      urlPath: '/reports',
      action: async (page) => {
        // Open modal
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'))
          const target = btns.find(b => b.textContent && b.textContent.includes('إذن صرف'))
          if (target) target.click()
        })
        await new Promise((r) => setTimeout(r, 600))
        // Select all items or check first item checkbox
        await page.evaluate(() => {
          const selectAllBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تحديد الكل'))
          if (selectAllBtn) {
            selectAllBtn.click()
          } else {
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
            checkboxes.slice(0, 3).forEach(c => c.click())
          }
        })
      },
      delay: 1200
    })

    // 13. Smart Excel Import Hub
    await captureScreen(browser, {
      name: '13-excel-smart-import',
      urlPath: '/imports',
      delay: 1200
    })

    // 14. Data Quality & Health Score
    await captureScreen(browser, {
      name: '14-data-quality-inspection',
      urlPath: '/quality',
      delay: 1200
    })

    // 15. System Audit Trail Logs
    await captureScreen(browser, {
      name: '15-audit-trail-logs',
      urlPath: '/audit',
      delay: 1200
    })

    // 16. Users & Permissions Matrix
    await captureScreen(browser, {
      name: '16-users-and-permissions',
      urlPath: '/users',
      delay: 1200
    })

    // 17. System & Organization Settings
    await captureScreen(browser, {
      name: '17-organization-settings',
      urlPath: '/settings',
      delay: 1200
    })

    // 18. Dashboard in Dark Mode (Showcase)
    await captureScreen(browser, {
      name: '18-dashboard-dark-mode',
      urlPath: '/',
      darkMode: true,
      delay: 1500
    })

    // 19. Custody in Dark Mode (Showcase)
    await captureScreen(browser, {
      name: '19-custody-dark-mode',
      urlPath: '/custody?warehouse=main',
      darkMode: true,
      delay: 1400
    })

    // 20. Secure Login & Auth Portal
    await captureScreen(browser, {
      name: '20-secure-login-portal',
      urlPath: '/',
      authenticated: false,
      delay: 1200
    })

    console.log('🎉 All 20 screens successfully re-captured with rich sanitized data!')
  } catch (err) {
    console.error('Error during capture:', err)
  } finally {
    await browser.close()
  }
}

run()
