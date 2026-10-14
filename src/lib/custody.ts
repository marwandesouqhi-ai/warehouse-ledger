export type WarehouseDefinition = {
  id: string
  name: string
  shortName: string
  iconKey: 'Warehouse' | 'Stethoscope' | 'Sparkles' | 'FlaskConical' | 'HeartPulse' | 'Microscope' | 'Cpu' | 'Laptop'
  description: string
  building: string
  isHub?: boolean
  suppliedBy?: string
}

export const WAREHOUSES: WarehouseDefinition[] = [
  {
    id: 'main',
    name: 'مخزن رئيسي',
    shortName: 'المخزن الرئيسي',
    iconKey: 'Warehouse',
    description: 'المستودع المركزي للتغذية والإمداد العام لكافة كليات ومعامل الجامعة',
    building: 'المبنى الإداري المركزي - الدور الأرضي',
    isHub: true,
  },
  {
    id: 'medicine',
    name: 'مخزن كلية طب بشري',
    shortName: 'طب بشري',
    iconKey: 'Stethoscope',
    description: 'عهدة الأجهزة والمجسمات الطبية ومستلزمات المعامل (توريد من المخزن الرئيسي)',
    building: 'مبنى كلية الطب البشري - جناح المعامل والمشرحة',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'dentistry',
    name: 'كلية طب أسنان',
    shortName: 'طب أسنان',
    iconKey: 'Sparkles',
    description: 'عهدة وحدات ومعدات الأسنان وأجهزة التعقيم والخامات (توريد من المخزن الرئيسي)',
    building: 'مبنى المستشفى التعليمي لطب الأسنان',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'pharmacy',
    name: 'كلية صيدلة',
    shortName: 'صيدلة',
    iconKey: 'FlaskConical',
    description: 'أجهزة التحليل الدوائي والموازين ومواد المعامل الكيميائية (توريد من المخزن الرئيسي)',
    building: 'مبنى كلية الصيدلة - الدور الثاني',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'nursing',
    name: 'كلية تمريض',
    shortName: 'تمريض',
    iconKey: 'HeartPulse',
    description: 'عرائس ومحاكيات التمريض وأجهزة المراقبة السريرية (توريد من المخزن الرئيسي)',
    building: 'مبنى كلية التمريض - معامل المهارات التمريضية',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'central_lab',
    name: 'معمل مركزي',
    shortName: 'المعمل المركزي',
    iconKey: 'Microscope',
    description: 'الأجهزة الدقيقة المشتركة والميكروسكوبات وأجهزة التحليل (توريد من المخزن الرئيسي)',
    building: 'مجمع المعامل البحثية المركزية',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'engineering',
    name: 'كلية هندسة',
    shortName: 'هندسة',
    iconKey: 'Cpu',
    description: 'أجهزة ورش الميكانيكا ومعامل القوى الكهربية والمحطات المساحية (توريد من المخزن الرئيسي)',
    building: 'مجمع ورش ومعامل الهندسة - مبنى ج',
    suppliedBy: 'المخزن الرئيسي',
  },
  {
    id: 'fci',
    name: 'كلية حاسبات و معلومات',
    shortName: 'حاسبات ومعلومات',
    iconKey: 'Laptop',
    description: 'خوادم الشبكات ومحطات العمل وأجهزة الحواسب المعملية (توريد من المخزن الرئيسي)',
    building: 'مبنى كلية الحاسبات والذكاء الاصطناعي',
    suppliedBy: 'المخزن الرئيسي',
  },
]

export type CustodyCondition = 'excellent' | 'good' | 'maintenance' | 'damaged'

export type CustodyCategory =
  | 'أجهزة إلكترونية وحواسب'
  | 'أجهزة ومعدات طبية'
  | 'أجهزة معملية وتجارب'
  | 'أثاث وتجهيزات'
  | 'أدوات ومستلزمات تشغيل'
  | 'أخرى'

export type CustodyType = 'مستديمة' | 'مستهلكة' | 'شخصية'

export type CustodyItem = {
  id: string
  warehouseId: string
  code: string
  name: string
  category: CustodyCategory
  custodian: string
  quantity: number
  unit: string
  condition: CustodyCondition
  custodyType: CustodyType
  roomLocation: string
  acquisitionDate: string
  value: number // إجمالي القيمة الدفترية للأصل (Quantity * unitPrice)
  unitPrice?: number // سعر القطعة الواحدة أو الوحدة التقديري
  serialNumber?: string
  notes?: string
}

export const CUSTODY_STORAGE_KEY = 'warehouse-ledger-custody-items'

export const fixtureCustodyItems: CustodyItem[] = [
  {
    id: 'cust-main-001',
    warehouseId: 'main',
    code: 'MAIN-001',
    name: 'تيشرتات مطبوعة ب لوجو الجامعة',
    category: 'أدوات ومستلزمات تشغيل',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 70,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستهلكة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-11-10',
    unitPrice: 154.2,
    value: 10794,
    serialNumber: '',
    notes: 'توريد من: سمارت تك (فاتورة: 1)'
  },
  {
    id: 'cust-main-002',
    warehouseId: 'main',
    code: 'MAIN-002',
    name: 'كابات',
    category: 'أدوات ومستلزمات تشغيل',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 155,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستهلكة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-11-10',
    unitPrice: 3.699,
    value: 573.35,
    serialNumber: '',
    notes: 'توريد من: سمارت تك (فاتورة: 1)'
  },
  {
    id: 'cust-main-003',
    warehouseId: 'main',
    code: 'MAIN-003',
    name: 'spectrodirect made in Lovibond-Germany Spectrophotometer model سبكتروفوميتر',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 145000,
    value: 145000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-004',
    warehouseId: 'main',
    code: 'MAIN-004',
    name: 'channel variable micropipette range (0.5 – 10 μ) Made in D-LAB Single ميكروبيبت قناه واحده مقاس (0.5-10)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 30,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5500,
    value: 165000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-005',
    warehouseId: 'main',
    code: 'MAIN-005',
    name: 'channel variable micropipette range (10 – 100 μ) Made in D-LAB Single ميكروبيبت قناه واحده مقاس (10-100)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 30,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5500,
    value: 165000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-006',
    warehouseId: 'main',
    code: 'MAIN-006',
    name: 'Made in D-LAB (micropipette range (100 – 1000 μ channel variable Single ميكروبيبت قناه واحده مقاس (100-1000)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 30,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5500,
    value: 165000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-007',
    warehouseId: 'main',
    code: 'MAIN-007',
    name: 'channel variable micropipette (20 – 200 μ) Made in D-LAB Single ميكروبيبت قناه واحده مقاس (20-200)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 30,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5500,
    value: 165000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-008',
    warehouseId: 'main',
    code: 'MAIN-008',
    name: 'variable (8channel) micropipette range (10 – 100 μ) Made D- Multi-channel LAB ميكروبيبت 8 قناه مقاس (10-100)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 22000,
    value: 44000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-009',
    warehouseId: 'main',
    code: 'MAIN-009',
    name: 'variable (8channel) micropipette range (200 – 1000 μ) Made in Multi-channel D-LAB ميكروبيبت 8 قناه مقاس (200-1000)',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 21000,
    value: 42000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع (فاتورة: 2)'
  },
  {
    id: 'cust-main-010',
    warehouseId: 'main',
    code: 'MAIN-010',
    name: 'فرن معملي Drying ovens with gravity convection Model LDO-30 Labitech',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 67000,
    value: 134000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-011',
    warehouseId: 'main',
    code: 'MAIN-011',
    name: 'جهاز حمام مائي water bath model lwb 122 Daihan',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 37800,
    value: 37800,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-012',
    warehouseId: 'main',
    code: 'MAIN-012',
    name: 'جهاز طرد مركزي made in Centrioun centrifuge',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 95000,
    value: 95000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-013',
    warehouseId: 'main',
    code: 'MAIN-013',
    name: 'جهاز ميكرو سنترفيوج centrifuge made in Eppendorf Micro',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 100000,
    value: 100000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-014',
    warehouseId: 'main',
    code: 'MAIN-014',
    name: 'جهاز حضانه Memmert digital Incubators with gravity convection Model IN75 معمليه',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 82000,
    value: 82000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-015',
    warehouseId: 'main',
    code: 'MAIN-015',
    name: 'سيفتى کابینت TopAir Safety Cabinet Class II BO-120',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 310000,
    value: 620000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-016',
    warehouseId: 'main',
    code: 'MAIN-016',
    name: 'ثلاجه معملية made in Haier refrigerator',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 3,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2026-10-13',
    unitPrice: 150000,
    value: 450000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-017',
    warehouseId: 'main',
    code: 'MAIN-017',
    name: 'جهاز ميكرو سنتر فيوج centrifuge made in Eppendorf Micro',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 4,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 98000,
    value: 392000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-018',
    warehouseId: 'main',
    code: 'MAIN-018',
    name: 'جهاز سبكتروفوتوميتر made in AELab model AE50 spectrophotometer',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 8,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 50000,
    value: 400000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-019',
    warehouseId: 'main',
    code: 'MAIN-019',
    name: 'Purification System Made in DAIHAN LAB TECH MODEL WD_1008 Water جهاز تقطير مياه',
    category: 'أجهزة معملية وتجارب',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 44000,
    value: 44000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-020',
    warehouseId: 'main',
    code: 'MAIN-020',
    name: '(Manufactured by: Erler Zimmer (Germany Development Fetal',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 8500,
    value: 8500,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-021',
    warehouseId: 'main',
    code: 'MAIN-021',
    name: 'Manufactured by: Erler Zimmer for demonstration of birth canal Pelvis ((Germany',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2026-10-13',
    unitPrice: 12500,
    value: 12500,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-022',
    warehouseId: 'main',
    code: 'MAIN-022',
    name: '(Manufactured by: Erler Zimmer (Germany (Muscle (7-Part Arm',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 18500,
    value: 18500,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-023',
    warehouseId: 'main',
    code: 'MAIN-023',
    name: '(Manufactured by: Erler Zimmer (Germany (Muscle (13-Part Leg',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 25000,
    value: 25000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-024',
    warehouseId: 'main',
    code: 'MAIN-024',
    name: 'Manufactured by: Erler Zimmer (Brain Model life size (5-Part Antomical, ((Germany',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5000,
    value: 5000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-025',
    warehouseId: 'main',
    code: 'MAIN-025',
    name: '(Manufactured by: Erler Zimmer (Germany (Muscle Model (4 Parts Back',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 5500,
    value: 11000,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-026',
    warehouseId: 'main',
    code: 'MAIN-026',
    name: 'Manufactured by: Erler Zimmer (unassembled (bone collection ,Skeleton ((Germany',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 19500,
    value: 19500,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-027',
    warehouseId: 'main',
    code: 'MAIN-027',
    name: '(Manufactured by: Erler Zimmer (Germany (times life size (4 Parts Ear 3',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 6200,
    value: 12400,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-028',
    warehouseId: 'main',
    code: 'MAIN-028',
    name: 'Manufactured by: Erler Zimmer (Heart 3 times life size (2 Parts Giant ((Germany',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2026-10-13',
    unitPrice: 12400,
    value: 24800,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-029',
    warehouseId: 'main',
    code: 'MAIN-029',
    name: '(Manufactured by: Erler Zimmer (Germany model 2 time enlarged Lyranx',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 2,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 7250,
    value: 14500,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-030',
    warehouseId: 'main',
    code: 'MAIN-030',
    name: '(Manufactured by: Erler Zimmer (Germany pelvic floor model, 12 parts Female',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 8250,
    value: 8250,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-031',
    warehouseId: 'main',
    code: 'MAIN-031',
    name: '(by: Ginkgomed (Taiwan Manufactured Skull Human',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2022-10-13',
    unitPrice: 2800,
    value: 2800,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  },
  {
    id: 'cust-main-032',
    warehouseId: 'main',
    code: 'MAIN-032',
    name: '(Manufactured by: Ginkgomed (Taiwan Model 2-parts natural size Heart',
    category: 'أجهزة ومعدات طبية',
    custodian: 'أمين المخزن الرئيسي',
    quantity: 1,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'المستودع الرئيسي - قسم الوارد',
    acquisitionDate: '2026-10-13',
    unitPrice: 2800,
    value: 2800,
    serialNumber: '',
    notes: 'توريد من: الهيئة العربية للتصنيع'
  }
]

export function loadCustodyItems(): CustodyItem[] {
  try {
    const raw = localStorage.getItem(CUSTODY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const validWarehouseIds = new Set(WAREHOUSES.map((w) => w.id))
        let needsResave = false
        // Filter out old demo/fixture mock items and any deleted warehouses
        let items = (parsed as CustodyItem[])
          .filter(
            (item) =>
              validWarehouseIds.has(item.warehouseId) &&
              !item.id.startsWith('c-main-') &&
              !item.id.startsWith('c-med-') &&
              !item.id.startsWith('c-den-') &&
              !item.id.startsWith('c-pha-') &&
              !item.id.startsWith('c-nur-') &&
              !item.id.startsWith('c-lab-') &&
              !item.id.startsWith('c-eng-') &&
              !item.id.startsWith('c-fci-') &&
              !item.id.startsWith('c-com-') &&
              !item.id.startsWith('mock-') &&
              !item.id.startsWith('demo-') &&
              !item.code?.startsWith('COM-')
          )
          .map((item) => {
            const qty = Number(item.quantity) || 1
            const val = Number(item.value) || 0
            const up = item.unitPrice != null ? Number(item.unitPrice) : null

            // Auto-repair legacy items where the user entered the unit price into the value field
            if (up == null && qty > 1 && !item.id.startsWith('c-in-') && val > 0) {
              needsResave = true
              const unitPrice = val
              return {
                ...item,
                unitPrice,
                value: Math.round(qty * unitPrice),
              }
            }

            // Auto-repair items where unitPrice was set but total value was mistakenly saved equal to unitPrice for multiple items
            if (up != null && up > 0 && qty > 1 && Math.abs(val - up) < 0.01) {
              needsResave = true
              return {
                ...item,
                unitPrice: up,
                value: Math.round(qty * up),
              }
            }

            if (up == null && qty === 1 && val > 0) {
              return {
                ...item,
                unitPrice: val,
              }
            }
            return item
          })

        if (needsResave) {
          saveCustodyItems(items)
        }
        return items
      }
    }
  } catch (err) {
    console.warn('Could not load custody items from storage:', err)
  }

  // Default to fixture items for main warehouse if storage is empty
  if (fixtureCustodyItems.length > 0) {
    try {
      localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify(fixtureCustodyItems))
    } catch {
      // ignore
    }
    return fixtureCustodyItems.map((item) => ({ ...item }))
  }

  return []
}

import { supabase } from './supabase'

export async function fetchCustodyItemsFromCloud(): Promise<CustodyItem[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase.from('custody_items').select('*').order('created_at', { ascending: true })
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id,
      warehouseId: row.warehouse_id,
      code: row.code,
      name: row.name,
      category: (row.category || guessCategory(row.name)) as CustodyCategory,
      quantity: Number(row.quantity) || 1,
      unit: row.unit || 'قطعة',
      unitPrice: row.unit_price ? Number(row.unit_price) : undefined,
      value: Number(row.value) || 0,
      condition: (row.condition || 'good') as CustodyCondition,
      custodian: row.custodian || '',
      roomLocation: row.room_location || '',
      serialNumber: row.serial_number || '',
      notes: row.notes || '',
      custodyType: (row.custody_type || 'مستديمة') as CustodyType,
      acquisitionDate: row.created_at ? String(row.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
    }))
  } catch (err) {
    console.warn('Could not fetch custody items from cloud:', err)
    return []
  }
}

export async function saveCustodyItemsToCloud(items: CustodyItem[]): Promise<void> {
  if (!supabase || items.length === 0) return
  try {
    const rows = items.map((item) => ({
      id: item.id,
      warehouse_id: item.warehouseId,
      code: item.code || '',
      name: item.name,
      category: item.category || '',
      quantity: item.quantity,
      unit: item.unit || 'قطعة',
      unit_price: item.unitPrice ?? null,
      value: item.value,
      condition: item.condition || 'good',
      custodian: item.custodian || '',
      room_location: item.roomLocation || '',
      serial_number: item.serialNumber || '',
      notes: item.notes || '',
      custody_type: item.custodyType || 'مستديمة',
    }))
    await supabase.from('custody_items').upsert(rows, { onConflict: 'id' })
  } catch (err) {
    console.warn('Could not sync custody items to cloud:', err)
  }
}

export async function deleteCustodyItemFromCloud(id: string): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('custody_items').delete().eq('id', id)
  } catch (err) {
    console.warn('Could not delete custody item from cloud:', err)
  }
}

export async function clearAllCustodyItemsFromCloud(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('custody_items').delete().neq('id', '')
  } catch (err) {
    console.warn('Could not clear custody items from cloud:', err)
  }
}

export function saveCustodyItems(items: CustodyItem[]): void {
  try {
    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify(items))
  } catch (err) {
    console.error('Could not save custody items to storage:', err)
  }
  // Asynchronously sync to Supabase cloud
  void saveCustodyItemsToCloud(items)
}

export function clearAllCustodyItems(): void {
  try {
    localStorage.removeItem(CUSTODY_STORAGE_KEY)
  } catch (err) {
    console.error('Could not clear custody items from storage:', err)
  }
  // Asynchronously wipe from Supabase cloud
  void clearAllCustodyItemsFromCloud()
}

export async function exportCustodyToExcel(warehouseName: string, items: CustodyItem[], currency: string) {
  const XLSX = await import('xlsx')
  let totalUnits = 0
  let totalValue = 0

  const rows: Record<string, unknown>[] = items.map((item, index) => {
    const conditionText =
      item.condition === 'excellent' ? 'ممتازة' :
      item.condition === 'good' ? 'جيدة' :
      item.condition === 'maintenance' ? 'تحتاج صيانة' : 'تالفة / كهنة'

    const unitPrice = item.unitPrice ?? (item.quantity > 0 ? Math.round(item.value / item.quantity) : item.value)
    totalUnits += Number(item.quantity) || 0
    totalValue += Number(item.value) || 0

    return {
      'م': index + 1,
      'كود العهدة': item.code,
      'اسم الصنف': item.name,
      'التصنيف': item.category,
      'أمين العهدة': item.custodian,
      'الكمية': item.quantity,
      'الوحدة': item.unit,
      [`سعر الوحدة (${currency})`]: unitPrice,
      [`إجمالي القيمة (${currency})`]: item.value,
      'نوع العهدة': item.custodyType,
      'الحالة الفنية': conditionText,
      'المكان / القاعة': item.roomLocation,
      'تاريخ القيد': item.acquisitionDate,
      'الرقم التسلسلي': item.serialNumber || '—',
      'ملاحظات': item.notes || '',
    }
  })

  // Append official summary totals row
  if (items.length > 0) {
    rows.push({
      'م': ('—' as unknown as number),
      'كود العهدة': 'الإجمالي العام',
      'اسم الصنف': `إجمالي ${items.length} صنف مسجل في ${warehouseName}`,
      'التصنيف': '',
      'أمين العهدة': '',
      'الكمية': totalUnits,
      'الوحدة': 'وحدة / جهاز',
      [`سعر الوحدة (${currency})`]: ('—' as unknown as number),
      [`إجمالي القيمة (${currency})`]: totalValue,
      'نوع العهدة': '',
      'الحالة الفنية': '',
      'المكان / القاعة': '',
      'تاريخ القيد': new Date().toISOString().slice(0, 10),
      'الرقم التسلسلي': '',
      'ملاحظات': `تم استخراج الكشف إلكترونياً من منظومة إدارة العهد والمخازن`,
    })
  }

  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 6 },  // م
    { wch: 14 }, // كود العهدة
    { wch: 38 }, // اسم الصنف
    { wch: 22 }, // التصنيف
    { wch: 22 }, // أمين العهدة
    { wch: 10 }, // الكمية
    { wch: 12 }, // الوحدة
    { wch: 16 }, // سعر الوحدة
    { wch: 20 }, // إجمالي القيمة
    { wch: 12 }, // نوع العهدة
    { wch: 14 }, // الحالة الفنية
    { wch: 26 }, // المكان / القاعة
    { wch: 14 }, // تاريخ القيد
    { wch: 18 }, // الرقم التسلسلي
    { wch: 36 }, // ملاحظات
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, `عهدة ${warehouseName.slice(0, 22)}`)
  const dateStr = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `كشف-عهدة-${warehouseName.replace(/\s+/g, '-')}-${dateStr}.xlsx`)
}

export async function exportComprehensiveCustodyWorkbook(
  items: CustodyItem[],
  currency: string,
  organizationName: string = 'المؤسسة التعليمية'
) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()

  // 1. Master Summary Sheet across all warehouses
  const summaryRows = WAREHOUSES.map((wh, idx) => {
    const whItems = items.filter((i) => i.warehouseId === wh.id)
    const stats = getWarehouseStats(whItems)
    return {
      'م': idx + 1,
      'المخزن / الكلية': wh.name,
      'الصفة': wh.isHub ? 'المخزن الرئيسي المغذي' : 'كلية / مخزن فرعي',
      'الموقع': wh.building,
      'عدد بنود الأصناف': stats.totalItems,
      'إجمالي عدد الوحدات والأجهزة': stats.totalUnits,
      [`إجمالي القيمة الدفترية (${currency})`]: stats.totalValue,
      'صالح للعمل (ممتاز وجيد)': stats.excellent + stats.good,
      'يحتاج صيانة': stats.maintenance,
      'تالف / كهنة': stats.damaged,
      'نسبة الصلاحية الفنية': `${stats.healthyRatio}%`,
    }
  })

  // Add overall grand total row
  const overallStats = getWarehouseStats(items)
  summaryRows.push({
    'م': ('—' as unknown as number),
    'المخزن / الكلية': 'الإجمالي العام لكافة المخازن والكليات',
    'الصفة': `${WAREHOUSES.length} مخزن وكلية`,
    'الموقع': organizationName,
    'عدد بنود الأصناف': overallStats.totalItems,
    'إجمالي عدد الوحدات والأجهزة': overallStats.totalUnits,
    [`إجمالي القيمة الدفترية (${currency})`]: overallStats.totalValue,
    'صالح للعمل (ممتاز وجيد)': overallStats.excellent + overallStats.good,
    'يحتاج صيانة': overallStats.maintenance,
    'تالف / كهنة': overallStats.damaged,
    'نسبة الصلاحية الفنية': `${overallStats.healthyRatio}%`,
  })

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
  summarySheet['!cols'] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 24 },
    { wch: 35 },
    { wch: 18 },
    { wch: 26 },
    { wch: 26 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
  ]
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'الملخص العام للمؤسسة')

  // 2. Individual Warehouse Sheets
  for (const wh of WAREHOUSES) {
    const whItems = items.filter((i) => i.warehouseId === wh.id)
    if (whItems.length === 0) continue

    const rows = whItems.map((item, index) => {
      const conditionText =
        item.condition === 'excellent' ? 'ممتازة' :
        item.condition === 'good' ? 'جيدة' :
        item.condition === 'maintenance' ? 'تحتاج صيانة' : 'تالفة / كهنة'

      const unitPrice = item.unitPrice ?? (item.quantity > 0 ? Math.round(item.value / item.quantity) : item.value)

      return {
        'م': index + 1,
        'كود العهدة': item.code,
        'اسم الصنف': item.name,
        'التصنيف': item.category,
        'أمين العهدة': item.custodian,
        'الكمية': item.quantity,
        'الوحدة': item.unit,
        [`سعر الوحدة (${currency})`]: unitPrice,
        [`إجمالي القيمة (${currency})`]: item.value,
        'نوع العهدة': item.custodyType,
        'الحالة الفنية': conditionText,
        'المكان / القاعة': item.roomLocation,
        'تاريخ القيد': item.acquisitionDate,
        'الرقم التسلسلي': item.serialNumber || '—',
        'ملاحظات': item.notes || '',
      }
    })

    const whSheet = XLSX.utils.json_to_sheet(rows)
    whSheet['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 36 },
      { wch: 22 },
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 20 },
      { wch: 12 },
      { wch: 14 },
      { wch: 26 },
      { wch: 14 },
      { wch: 18 },
      { wch: 36 },
    ]
    const tabName = wh.shortName.slice(0, 28)
    XLSX.utils.book_append_sheet(workbook, whSheet, tabName)
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `سجل-جرد-العهد-الموحد-${dateStr}.xlsx`)
}

export function getWarehouseStats(items: CustodyItem[]) {
  const totalItems = items.length
  const totalUnits = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const totalValue = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0)

  let excellent = 0
  let good = 0
  let maintenance = 0
  let damaged = 0

  for (const item of items) {
    if (item.condition === 'excellent') excellent++
    else if (item.condition === 'good') good++
    else if (item.condition === 'maintenance') maintenance++
    else if (item.condition === 'damaged') damaged++
  }

  const healthyRatio = totalItems > 0 ? Math.round(((excellent + good) / totalItems) * 100) : 100

  return {
    totalItems,
    totalUnits,
    totalValue,
    excellent,
    good,
    maintenance,
    damaged,
    healthyRatio,
  }
}

export function guessCategory(name: string): CustodyCategory {
  const n = (name || '').toLowerCase()
  if (
    n.includes('طب') ||
    n.includes('اسنان') ||
    n.includes('أسنان') ||
    n.includes('سرير') ||
    n.includes('سماعة') ||
    n.includes('جراح') ||
    n.includes('مريض') ||
    n.includes('محقن')
  ) {
    return 'أجهزة ومعدات طبية'
  }
  if (
    n.includes('ميكروسكوب') ||
    n.includes('معمل') ||
    n.includes('كيمي') ||
    n.includes('ميزان') ||
    n.includes('طرد') ||
    n.includes('مخبار') ||
    n.includes('تحليل') ||
    n.includes('عينة')
  ) {
    return 'أجهزة معملية وتجارب'
  }
  if (
    n.includes('حاسب') ||
    n.includes('كمبيوتر') ||
    n.includes('لابتوب') ||
    n.includes('شاشة') ||
    n.includes('طابعة') ||
    n.includes('سيرفر') ||
    n.includes('سويتش') ||
    n.includes('راوتر') ||
    n.includes('كابل')
  ) {
    return 'أجهزة إلكترونية وحواسب'
  }
  if (
    n.includes('مكتب') ||
    n.includes('كرسي') ||
    n.includes('دولاب') ||
    n.includes('رف') ||
    n.includes('طاولة') ||
    n.includes('صالون')
  ) {
    return 'أثاث وتجهيزات'
  }
  if (
    n.includes('ورق') ||
    n.includes('حبر') ||
    n.includes('قلم') ||
    n.includes('ادوات') ||
    n.includes('أدوات') ||
    n.includes('مستهلك')
  ) {
    return 'أدوات ومستلزمات تشغيل'
  }
  return 'أجهزة إلكترونية وحواسب'
}

export function findWarehouseByRecipient(toText?: string): WarehouseDefinition | undefined {
  if (!toText) return undefined
  const clean = toText.trim().toLowerCase()
  if (!clean) return undefined

  // 1. Direct ID match
  const byId = WAREHOUSES.find((w) => w.id.toLowerCase() === clean)
  if (byId) return byId

  // 2. Exact match against name or shortName
  const byName = WAREHOUSES.find(
    (w) => w.name.toLowerCase() === clean || w.shortName.toLowerCase() === clean
  )
  if (byName) return byName

  // 3. Normalized Arabic match (ignoring alef variants, teh marbuta, etc.)
  const norm = (str: string) =>
    str
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim()

  const cleanNorm = norm(clean)

  if (cleanNorm.includes('بشري') || cleanNorm.includes('طب بشري') || cleanNorm.includes('medicine')) {
    return WAREHOUSES.find((w) => w.id === 'medicine')
  }
  if (cleanNorm.includes('اسنان') || cleanNorm.includes('طب اسنان') || cleanNorm.includes('dentistry')) {
    return WAREHOUSES.find((w) => w.id === 'dentistry')
  }
  if (cleanNorm.includes('صيدل') || cleanNorm.includes('pharmacy')) {
    return WAREHOUSES.find((w) => w.id === 'pharmacy')
  }
  if (cleanNorm.includes('تمريض') || cleanNorm.includes('nursing')) {
    return WAREHOUSES.find((w) => w.id === 'nursing')
  }
  if (cleanNorm.includes('مركزي') || cleanNorm.includes('معمل مركزي') || cleanNorm.includes('central_lab')) {
    return WAREHOUSES.find((w) => w.id === 'central_lab')
  }
  if (cleanNorm.includes('هندس') || cleanNorm.includes('engineering')) {
    return WAREHOUSES.find((w) => w.id === 'engineering')
  }
  if (cleanNorm.includes('حاسب') || cleanNorm.includes('معلومات') || cleanNorm.includes('fci')) {
    return WAREHOUSES.find((w) => w.id === 'fci')
  }
  if (cleanNorm.includes('رئيسي') || cleanNorm.includes('الرئيسي') || cleanNorm.includes('main')) {
    return WAREHOUSES.find((w) => w.id === 'main')
  }

  // Fallback to substring matching
  return WAREHOUSES.find((w) => {
    const wNorm = norm(w.name)
    const sNorm = norm(w.shortName)
    return cleanNorm.includes(wNorm) || cleanNorm.includes(sNorm) || wNorm.includes(cleanNorm) || sNorm.includes(cleanNorm)
  })
}

export function syncInwardMovementToCustody(movement: {
  item: string
  date?: string
  qin: string | number
  price?: string | number
  from?: string
  inv?: string | number
  notes?: string
}): { added: boolean; item: CustodyItem } {
  const items = loadCustodyItems()
  const cleanItemName = (movement.item || '').trim()
  if (!cleanItemName) {
    throw new Error('اسم الصنف مطلوب لإضافة العهدة.')
  }
  const today = new Date().toISOString().slice(0, 10)
  const acquisitionDate = movement.date?.trim() || today
  const qty = Math.max(0, Number(movement.qin) || 0)
  const price = Math.max(0, Number(movement.price) || 0)

  // Find if item already exists in main warehouse
  const existingIdx = items.findIndex(
    (i) => i.warehouseId === 'main' && i.name.trim().toLowerCase() === cleanItemName.toLowerCase()
  )

  let resultItem: CustodyItem

  if (existingIdx !== -1) {
    const existing = items[existingIdx]
    const updatedQty = existing.quantity + qty
    const updatedValue = existing.value + (price > 0 ? price * qty : 0)
    const extraNote = movement.from
      ? `توريد جديد (${qty} ${existing.unit}) من ${movement.from}${movement.inv ? ` (فاتورة ${movement.inv})` : ''}`
      : ''
    const updatedNotes = extraNote
      ? (existing.notes ? `${existing.notes} • ${extraNote}` : extraNote)
      : existing.notes

    resultItem = {
      ...existing,
      quantity: updatedQty,
      unitPrice: price > 0 ? price : existing.unitPrice,
      value: updatedValue,
      notes: updatedNotes,
    }
    items[existingIdx] = resultItem
    saveCustodyItems(items)
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('custody-changed'))
      }
    } catch {
      // ignore
    }
    return { added: false, item: resultItem }
  } else {
    const mainItemsCount = items.filter((i) => i.warehouseId === 'main').length
    const nextSeq = (mainItemsCount + 1).toString().padStart(3, '0')
    const code = `MAIN-${nextSeq}`

    const note = movement.from
      ? `توريد من: ${movement.from}${movement.inv ? ` (فاتورة: ${movement.inv})` : ''}`
      : (movement.notes || 'وارد جديد للمخزن الرئيسي')

    resultItem = {
      id: `c-in-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      warehouseId: 'main',
      code,
      name: cleanItemName,
      category: guessCategory(cleanItemName),
      custodian: 'أمين المخزن الرئيسي',
      quantity: qty,
      unit: 'قطعة',
      condition: 'excellent',
      custodyType: 'مستديمة',
      roomLocation: 'المستودع الرئيسي - قسم الوارد',
      acquisitionDate,
      unitPrice: price,
      value: price > 0 ? price * qty : 0,
      serialNumber: '',
      notes: note,
    }
    items.unshift(resultItem)
    saveCustodyItems(items)
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('custody-changed'))
      }
    } catch {
      // ignore
    }
    return { added: true, item: resultItem }
  }
}

export function syncOutwardMovementToCustody(movement: {
  item: string
  date?: string
  issue?: string
  qout: string | number
  price?: string | number
  to?: string
  permit?: string | number
  notes?: string
  sourceWarehouseId?: string
  destType?: 'warehouse' | 'custodian'
  destWarehouseId?: string
  custodianName?: string
  custodyApplied?: boolean
}): {
  deductedFromMain: boolean
  addedToTarget: boolean
  targetWarehouse?: WarehouseDefinition
  deductedFromSource?: boolean
  addedToCustodian?: boolean
} {
  if (movement.custodyApplied) {
    return {
      deductedFromMain: false,
      addedToTarget: false,
      deductedFromSource: false,
      addedToCustodian: false,
    }
  }

  const items = loadCustodyItems()
  const cleanItemName = (movement.item || '').trim()
  const qty = Math.max(0, Number(movement.qout) || 0)
  const today = new Date().toISOString().slice(0, 10)
  const actionDate = movement.issue?.trim() || movement.date?.trim() || today
  const sourceWhId = movement.sourceWarehouseId || 'main'

  // Validation: cannot disburse to the exact same warehouse
  const explicitTargetWhId = movement.destWarehouseId
  if (explicitTargetWhId && explicitTargetWhId === sourceWhId) {
    throw new Error('لا يمكن صرف أو تحويل الصنف إلى نفس المستودع المصدر.')
  }

  // 1. Find item in source warehouse and deduct quantity
  const sourceIdx = items.findIndex(
    (i) => i.warehouseId === sourceWhId && i.name.trim().toLowerCase() === cleanItemName.toLowerCase()
  )

  let sourceItem: CustodyItem | undefined
  let deductedFromSource = false

  if (sourceIdx !== -1) {
    sourceItem = items[sourceIdx]
    if (sourceItem.quantity < qty) {
      throw new Error(`الرصيد المتاح من «${cleanItemName}» في المخزن المصدر (${sourceItem.quantity}) غير كافٍ لصرف كمية ${qty}.`)
    }
    const newQty = Math.max(0, sourceItem.quantity - qty)
    const unitPrice = sourceItem.quantity > 0 ? sourceItem.value / sourceItem.quantity : (Number(movement.price) || 0)
    items[sourceIdx] = {
      ...sourceItem,
      quantity: newQty,
      value: Math.max(0, Math.round(newQty * unitPrice)),
      notes: movement.to
        ? `${sourceItem.notes ? `${sourceItem.notes} • ` : ''}صرف ${qty} ${sourceItem.unit} إلى ${movement.to}${movement.permit ? ` (إذن ${movement.permit})` : ''}`
        : sourceItem.notes,
    }
    deductedFromSource = true
  }

  // 2. Identify target warehouse or custodian
  const targetWh = explicitTargetWhId
    ? WAREHOUSES.find((w) => w.id === explicitTargetWhId)
    : findWarehouseByRecipient(movement.to)

  let addedToTarget = false
  let addedToCustodian = false

  if (movement.destType === 'custodian' || movement.custodianName) {
    const custodianName = movement.custodianName || movement.to || 'أمين عهدة'
    const unitPrice = Number(movement.price) || (sourceItem && sourceItem.quantity > 0 ? sourceItem.value / Math.max(1, sourceItem.quantity) : 0)

    const newItem: CustodyItem = {
      id: `c-cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      warehouseId: sourceWhId,
      code: `CUS-${Date.now().toString().slice(-4)}`,
      name: cleanItemName,
      category: sourceItem?.category || guessCategory(cleanItemName),
      custodian: custodianName,
      quantity: qty,
      unit: sourceItem?.unit || 'قطعة',
      condition: 'excellent',
      custodyType: 'شخصية',
      roomLocation: movement.to || 'عهدة موظف',
      acquisitionDate: actionDate,
      unitPrice: unitPrice > 0 ? unitPrice : undefined,
      value: unitPrice > 0 ? unitPrice * qty : 0,
      serialNumber: '',
      notes: `صرف كعهدة شخصية للموظف: ${custodianName}${movement.permit ? ` (إذن صرف: ${movement.permit})` : ''}`,
    }
    items.push(newItem)
    addedToCustodian = true
  } else if (targetWh && targetWh.id !== sourceWhId) {
    // Check if target warehouse already has this item
    const targetIdx = items.findIndex(
      (i) => i.warehouseId === targetWh.id && i.name.trim().toLowerCase() === cleanItemName.toLowerCase()
    )

    const unitPrice = Number(movement.price) || (sourceItem && sourceItem.quantity > 0 ? sourceItem.value / Math.max(1, sourceItem.quantity) : 0)

    if (targetIdx !== -1) {
      const existingTarget = items[targetIdx]
      const newQty = existingTarget.quantity + qty
      const addedVal = unitPrice > 0 ? unitPrice * qty : 0
      const extraNote = `صرف وتوريد من ${sourceWhId === 'main' ? 'المخزن الرئيسي' : (WAREHOUSES.find(w => w.id === sourceWhId)?.name || sourceWhId)} (${qty} ${existingTarget.unit})${movement.permit ? ` بإذن صرف ${movement.permit}` : ''}`
      items[targetIdx] = {
        ...existingTarget,
        quantity: newQty,
        unitPrice: unitPrice > 0 ? unitPrice : existingTarget.unitPrice,
        value: existingTarget.value + addedVal,
        notes: existingTarget.notes ? `${existingTarget.notes} • ${extraNote}` : extraNote,
      }
      addedToTarget = true
    } else {
      const branchItemsCount = items.filter((i) => i.warehouseId === targetWh.id).length
      const seq = (branchItemsCount + 1).toString().padStart(3, '0')
      const prefix = targetWh.id.toUpperCase().slice(0, 3)
      const code = `${prefix}-${seq}`

      const newItem: CustodyItem = {
        id: `c-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        warehouseId: targetWh.id,
        code,
        name: cleanItemName,
        category: sourceItem?.category || guessCategory(cleanItemName),
        custodian: `أمين عهدة ${targetWh.shortName}`,
        quantity: qty,
        unit: sourceItem?.unit || 'قطعة',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: targetWh.building,
        acquisitionDate: actionDate,
        unitPrice: unitPrice > 0 ? unitPrice : undefined,
        value: unitPrice > 0 ? unitPrice * qty : 0,
        serialNumber: '',
        notes: `مصروف من ${sourceWhId === 'main' ? 'المخزن الرئيسي' : (WAREHOUSES.find(w => w.id === sourceWhId)?.name || sourceWhId)}${movement.permit ? ` (إذن صرف: ${movement.permit})` : ''}`,
      }
      items.push(newItem)
      addedToTarget = true
    }
  }

  saveCustodyItems(items)
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('custody-changed'))
    }
  } catch {
    // ignore
  }

  movement.custodyApplied = true

  return {
    deductedFromMain: sourceWhId === 'main' && deductedFromSource,
    addedToTarget,
    targetWarehouse: targetWh,
    deductedFromSource,
    addedToCustodian,
  }
}
