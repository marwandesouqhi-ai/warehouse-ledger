import { readInventorySnapshot, readInventoryState, writeInventoryState } from './inventoryStorage'
import { planInventoryOperation } from './inventoryOperations'
import { executeInventoryOperation } from './inventoryRepository'
import { localDate } from './localDate'
import { loadInitialRecords } from './initialRecords'
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
  version?: number
  deletedAt?: string
  history?: import('./inventoryTypes').InventoryEvent[]
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
  const state = readInventorySnapshot()
  return state ? state.items.filter((item) => !item.deletedAt) : loadInitialRecords(CUSTODY_STORAGE_KEY, fixtureCustodyItems)
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
      quantity: Number(row.quantity) || 0,
      unit: row.unit || 'قطعة',
      unitPrice: row.unit_price ? Number(row.unit_price) : undefined,
      value: Number(row.value) || 0,
      condition: (row.condition || 'good') as CustodyCondition,
      custodian: row.custodian || '',
      roomLocation: row.room_location || '',
      serialNumber: row.serial_number || '',
      notes: row.notes || '',
      custodyType: (row.custody_type || 'مستديمة') as CustodyType,
      acquisitionDate: row.acquisition_date || '',
      version: Number(row.version) || 0, deletedAt: row.deleted_at || undefined, history: row.history || [],
    }))
  } catch (err) {
    console.warn('Could not fetch custody items from cloud:', err)
    return []
  }
}

/** Explicit changed-record operation; local persistence never invokes this implicitly. */
export async function saveCustodyItemsToCloud(items: CustodyItem[]): Promise<CustodyItem[]> {
  const state = readInventoryState()
  const changes = items.filter((item) => {
    const previous = state.items.find((entry) => entry.id === item.id)
    return !previous || JSON.stringify(previous) !== JSON.stringify(item)
  })
  if (!changes.length) return state.items.map((item) => ({ ...item }))
  const result = await executeInventoryOperation({ kind: 'import', items: changes })
  return result.items.map((item) => ({ ...item }))
}
export async function deleteCustodyItemFromCloud(itemId: string): Promise<void> {
  await executeInventoryOperation({ kind: 'item_delete', itemId })
}
export async function clearAllCustodyItemsFromCloud(): Promise<void> {
  throw new Error('المسح الشامل غير متاح لحماية البيانات. استخدم الأرشفة الموثقة لكل سجل.')
}
/** Compatibility API for local snapshots only. Existing ledger/events are retained. */
export function saveCustodyItems(items: CustodyItem[]): void {
  const state = readInventoryState()
  const byId = new Map(state.items.map((item) => [item.id, item]))
  for (const item of items) byId.set(item.id, { ...item })
  writeInventoryState({ ...state, revision: state.revision + 1, items: [...byId.values()] }, state.revision)
}

export function clearAllCustodyItems(): void {
  throw new Error('المسح الشامل غير متاح لحماية البيانات. استخدم الأرشفة الموثقة لكل سجل.')
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
      'تاريخ القيد': localDate(),
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
  const dateStr = localDate()
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

  const dateStr = localDate()
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
  id?: string | number; custodyApplied?: boolean; item: string; date?: string; qin: string | number; price?: string | number; from?: string; inv?: string | number; notes?: string
}): { added: boolean; item: CustodyItem } {
  const state = readInventoryState()
  const existing = state.items.find((item) => !item.deletedAt && item.warehouseId === 'main' && item.name.trim().toLowerCase() === movement.item.trim().toLowerCase())
  if (movement.custodyApplied || (movement.id != null && state.movements.some((entry) => String(entry.id) === String(movement.id)))) {
    if (!existing) throw new Error('تعذر تحديد الصنف المرتبط بالحركة المسجلة.')
    return { added: false, item: { ...existing } }
  }
  const row: import('./fixture').FixtureMovement = { id: movement.id ?? crypto.randomUUID(), date: movement.date || localDate(), inv: movement.inv || '', from: movement.from || '', to: '', permit: '', issue: '', item: movement.item, price: movement.price || 0, qin: movement.qin, qout: 0, notes: movement.notes || '' }
  const plan = planInventoryOperation(state, { kind: 'purchase', movement: row })
  writeInventoryState(plan.next, state.revision)
  movement.custodyApplied = true
  const itemId = plan.next.movements.at(-1)!.inventoryEffects![0].itemId
  return { added: !existing, item: plan.next.items.find((item) => item.id === itemId)! }
}

export function requireDisbursementSource(items: CustodyItem[], movement: {
  sourceItemId?: string; sourceWarehouseId?: string; item: string; qout: string | number
}): CustodyItem {
  const sourceWarehouseId = movement.sourceWarehouseId || 'main'
  const quantity = Number(movement.qout)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('كمية الصرف يجب أن تكون رقماً أكبر من صفر.')
  // Legacy records lack an ID: resolve only an unambiguous existing source, never invent stock.
  const matches = items.filter((item) => item.warehouseId === sourceWarehouseId && (
    movement.sourceItemId ? item.id === movement.sourceItemId : item.name.trim().toLowerCase() === movement.item.trim().toLowerCase()
  ))
  if (matches.length !== 1) throw new Error('يرجى اختيار صنف موجود ومحدد من المخزن المصدر.')
  const source = matches[0]
  if (!Number.isFinite(Number(source.quantity)) || Number(source.quantity) < quantity) {
    throw new Error(`الرصيد المتاح من «${source.name}» في المخزن المصدر (${source.quantity}) غير كافٍ لصرف كمية ${quantity}.`)
  }
  return { ...source, quantity: Number(source.quantity) }
}

/** Resolve legacy names once and reserve stock across a batch before persisting any ledger rows. */
export function resolveDisbursementSources<T extends {
  item: string; qout: string | number; sourceWarehouseId?: string; sourceItemId?: string
}>(items: CustodyItem[], movements: T[]): T[] {
  const available = items.map((item) => ({ ...item }))
  return movements.map((movement) => {
    if (!(Number(movement.qout) > 0)) return movement
    const source = requireDisbursementSource(available, movement)
    available.find((item) => item.id === source.id)!.quantity -= Number(movement.qout)
    return { ...movement, sourceItemId: source.id, item: source.name }
  })
}

export function syncOutwardMovementToCustody(movement: {
  id?: string | number; item: string; date?: string; issue?: string; qout: string | number; price?: string | number;
  to?: string; permit?: string | number; notes?: string; sourceItemId?: string; sourceWarehouseId?: string;
  destType?: 'warehouse' | 'custodian'; destWarehouseId?: string; custodianName?: string; custodyApplied?: boolean
}) {
  const state = readInventoryState()
  if (movement.custodyApplied || (movement.id != null && state.movements.some((entry) => String(entry.id) === String(movement.id)))) return { deductedFromMain: false, addedToTarget: false, deductedFromSource: false, addedToCustodian: false, targetWarehouse: undefined as WarehouseDefinition | undefined }
  const source = requireDisbursementSource(state.items.filter((item) => !item.deletedAt), movement)
  const row: import('./fixture').FixtureMovement = { ...movement, id: movement.id ?? crypto.randomUUID(), date: movement.date || localDate(), inv: '', from: '', to: movement.to || '', permit: movement.permit || '', issue: movement.issue || localDate(), item: movement.item, price: movement.price || 0, qin: 0, qout: movement.qout, notes: movement.notes || '', sourceItemId: source.id }
  const plan = planInventoryOperation(state, { kind: 'disbursement', movement: row })
  writeInventoryState(plan.next, state.revision)
  movement.custodyApplied = true
  const target = findWarehouseByRecipient(row.destWarehouseId || row.to)
  return { deductedFromMain: source.warehouseId === 'main', deductedFromSource: true, addedToTarget: row.destType !== 'custodian', addedToCustodian: row.destType === 'custodian', targetWarehouse: target }
}
