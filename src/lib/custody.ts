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

export const fixtureCustodyItems: CustodyItem[] = []

export function loadCustodyItems(): CustodyItem[] {
  try {
    const raw = localStorage.getItem(CUSTODY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const validWarehouseIds = new Set(WAREHOUSES.map((w) => w.id))
        let needsResave = false
        // Filter out old demo/fixture mock items and any deleted warehouses
        const items = (parsed as CustodyItem[])
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
}): {
  deductedFromMain: boolean
  addedToTarget: boolean
  targetWarehouse?: WarehouseDefinition
} {
  const items = loadCustodyItems()
  const cleanItemName = (movement.item || '').trim()
  const qty = Math.max(0, Number(movement.qout) || 0)
  const today = new Date().toISOString().slice(0, 10)
  const actionDate = movement.issue?.trim() || movement.date?.trim() || today

  // 1. Find item in main warehouse and deduct quantity
  const mainIdx = items.findIndex(
    (i) => i.warehouseId === 'main' && i.name.trim().toLowerCase() === cleanItemName.toLowerCase()
  )

  let mainItem: CustodyItem | undefined
  let deductedFromMain = false

  if (mainIdx !== -1) {
    mainItem = items[mainIdx]
    const newQty = Math.max(0, mainItem.quantity - qty)
    const unitPrice = mainItem.quantity > 0 ? mainItem.value / mainItem.quantity : (Number(movement.price) || 0)
    items[mainIdx] = {
      ...mainItem,
      quantity: newQty,
      value: Math.max(0, Math.round(newQty * unitPrice)),
      notes: movement.to
        ? `${mainItem.notes ? `${mainItem.notes} • ` : ''}صرف ${qty} ${mainItem.unit} إلى ${movement.to}${movement.permit ? ` (إذن ${movement.permit})` : ''}`
        : mainItem.notes,
    }
    deductedFromMain = true
  }

  // 2. Identify target warehouse (branch)
  const targetWh = findWarehouseByRecipient(movement.to)
  let addedToTarget = false

  if (targetWh && targetWh.id !== 'main') {
    // Check if target warehouse already has this item
    const targetIdx = items.findIndex(
      (i) => i.warehouseId === targetWh.id && i.name.trim().toLowerCase() === cleanItemName.toLowerCase()
    )

    const unitPrice = Number(movement.price) || (mainItem && mainItem.quantity > 0 ? mainItem.value / Math.max(1, mainItem.quantity) : 0)

    if (targetIdx !== -1) {
      const existingTarget = items[targetIdx]
      const newQty = existingTarget.quantity + qty
      const addedVal = unitPrice > 0 ? unitPrice * qty : 0
      const extraNote = `صرف وتوريد من المخزن الرئيسي (${qty} ${existingTarget.unit})${movement.permit ? ` بإذن صرف ${movement.permit}` : ''}`
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
        category: mainItem?.category || guessCategory(cleanItemName),
        custodian: `أمين عهدة ${targetWh.shortName}`,
        quantity: qty,
        unit: mainItem?.unit || 'قطعة',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: targetWh.building,
        acquisitionDate: actionDate,
        unitPrice: unitPrice > 0 ? unitPrice : undefined,
        value: unitPrice > 0 ? unitPrice * qty : 0,
        serialNumber: '',
        notes: `مصروف من المخزن الرئيسي${movement.permit ? ` (إذن صرف: ${movement.permit})` : ''}`,
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

  return {
    deductedFromMain,
    addedToTarget,
    targetWarehouse: targetWh,
  }
}
