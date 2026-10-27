import type { CustodyCategory, CustodyCondition, CustodyItem, CustodyType } from './custody'
import { findWarehouseByRecipient, guessCategory, saveCustodyItems, saveCustodyItemsToCloud, WAREHOUSES } from './custody'

export type CustodyImportRow = {
  code?: string
  name: string
  category?: string
  custodian?: string
  quantity: number
  unit?: string
  unitPrice?: number
  value?: number
  custodyType?: string
  condition?: string
  roomLocation?: string
  acquisitionDate?: string
  serialNumber?: string
  notes?: string
  warehouseNameOrId?: string
}

export type ParsedCustodyResult = {
  validItems: CustodyItem[]
  skippedCount: number
  warnings: string[]
  errors: string[]
}

const VALID_CATEGORIES: CustodyCategory[] = [
  'أجهزة إلكترونية وحواسب',
  'أجهزة ومعدات طبية',
  'أجهزة معملية وتجارب',
  'أثاث وتجهيزات',
  'أدوات ومستلزمات تشغيل',
  'أخرى',
]

export function normalizeArabicText(text?: unknown): string {
  if (text == null) return ''
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
}

export function parseCondition(raw?: unknown): CustodyCondition {
  const norm = normalizeArabicText(raw)
  if (norm.includes('ممتاز') || norm.includes('excellent')) return 'excellent'
  if (norm.includes('صيان') || norm.includes('maintenance')) return 'maintenance'
  if (norm.includes('تالف') || norm.includes('كهن') || norm.includes('damaged') || norm.includes('scrap')) return 'damaged'
  if (norm.includes('جيد') || norm.includes('good')) return 'good'
  return 'good'
}

export function parseCustodyType(raw?: unknown): CustodyType {
  const norm = normalizeArabicText(raw)
  if (norm.includes('مستهلك')) return 'مستهلكة'
  if (norm.includes('شخص')) return 'شخصية'
  return 'مستديمة'
}

export function parseCategory(raw?: unknown, itemName = ''): CustodyCategory {
  if (!raw) return guessCategory(itemName)
  const text = String(raw).trim()
  const found = VALID_CATEGORIES.find((c) => c === text)
  if (found) return found

  const norm = normalizeArabicText(raw)
  if (norm.includes('طب') || norm.includes('اسنان') || norm.includes('مريض')) return 'أجهزة ومعدات طبية'
  if (norm.includes('معمل') || norm.includes('ميكروسكوب') || norm.includes('كيمي') || norm.includes('تجارب')) return 'أجهزة معملية وتجارب'
  if (norm.includes('حاسب') || norm.includes('كمبيوتر') || norm.includes('الكترون') || norm.includes('شبك')) return 'أجهزة إلكترونية وحواسب'
  if (norm.includes('اثاث') || norm.includes('مكتب') || norm.includes('كرسي') || norm.includes('تجهيز')) return 'أثاث وتجهيزات'
  if (norm.includes('تشغيل') || norm.includes('مستلزم') || norm.includes('ادوات')) return 'أدوات ومستلزمات تشغيل'

  return guessCategory(itemName)
}

export function parseExcelDate(val: unknown, XLSX?: typeof import('xlsx')): string {
  const today = new Date().toISOString().slice(0, 10)
  if (val == null || val === '') return today

  if (val instanceof Date) {
    if (!Number.isNaN(val.getTime())) {
      return val.toISOString().slice(0, 10)
    }
  }

  if (typeof val === 'number' && XLSX?.SSF) {
    try {
      return XLSX.SSF.format('yyyy-mm-dd', val)
    } catch {
      // ignore
    }
  }

  const str = String(val).trim()
  // Matches YYYY-MM-DD or YYYY/MM/DD
  const matchIso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (matchIso) {
    const y = matchIso[1]
    const m = matchIso[2].padStart(2, '0')
    const d = matchIso[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Matches DD-MM-YYYY or DD/MM/YYYY
  const matchDmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (matchDmy) {
    const d = matchDmy[1].padStart(2, '0')
    const m = matchDmy[2].padStart(2, '0')
    const y = matchDmy[3]
    return `${y}-${m}-${d}`
  }

  return today
}

/**
 * Downloads a pre-formatted Excel template (.xlsx) matching the user's template.
 */
export async function downloadCustodyTemplate(currency = 'EGP'): Promise<void> {
  const XLSX = await import('xlsx')

  const headers = [
    'كود العهدة',
    'اسم الصنف',
    'التصنيف',
    'أمين العهدة',
    'الكمية',
    'الوحدة',
    `سعر القطعة (${currency})`,
    'نوع العهدة',
    'الحالة الفنية',
    'المكان / القاعة',
    'تاريخ القيد',
    'الرقم المسلسل',
    'ملاحظات',
  ]

  const exampleRows = [
    {
      'كود العهدة': 'MAIN-001',
      'اسم الصنف': 'ميكروسكوب ضوئي ثنائي العينية',
      'التصنيف': 'أجهزة معملية وتجارب',
      'أمين العهدة': 'أمين عهدة المخزن الرئيسي',
      'الكمية': 5,
      'الوحدة': 'جهاز',
      [`سعر القطعة (${currency})`]: 18500,
      'نوع العهدة': 'مستديمة',
      'الحالة الفنية': 'ممتازة',
      'المكان / القاعة': 'معمل الكيمياء العامة - مبنى أ',
      'تاريخ القيد': new Date().toISOString().slice(0, 10),
      'الرقم المسلسل': 'SN-MC-884920',
      'ملاحظات': 'توريد جديد بضمان الوكيل لمدة عامين (يحسب النظام الإجمالي تلقائياً 5 × 18500 = 92500)',
    },
    {
      'كود العهدة': 'MAIN-002',
      'اسم الصنف': 'جهاز حاسب آلي مكتبي Core i7 شامل الشاشة',
      'التصنيف': 'أجهزة إلكترونية وحواسب',
      'أمين العهدة': 'أمين عهدة المخزن الرئيسي',
      'الكمية': 10,
      'الوحدة': 'جهاز',
      [`سعر القطعة (${currency})`]: 24000,
      'نوع العهدة': 'مستديمة',
      'الحالة الفنية': 'ممتازة',
      'المكان / القاعة': 'معمل الحاسب الآلي 1',
      'تاريخ القيد': new Date().toISOString().slice(0, 10),
      'الرقم المسلسل': 'SN-PC-2026-001',
      'ملاحظات': 'ملحق به ماوس ولوحة مفاتيح وكابلات (يحسب النظام الإجمالي تلقائياً 10 × 24000 = 240000)',
    },
  ]

  const sheet = XLSX.utils.json_to_sheet(exampleRows, { header: headers })

  // Auto-fit column widths
  sheet['!cols'] = [
    { wch: 14 }, // كود العهدة
    { wch: 38 }, // اسم الصنف
    { wch: 22 }, // التصنيف
    { wch: 24 }, // أمين العهدة
    { wch: 10 }, // الكمية
    { wch: 10 }, // الوحدة
    { wch: 18 }, // سعر القطعة
    { wch: 14 }, // نوع العهدة
    { wch: 14 }, // الحالة الفنية
    { wch: 28 }, // المكان / القاعة
    { wch: 14 }, // تاريخ القيد
    { wch: 18 }, // الرقم المسلسل
    { wch: 45 }, // ملاحظات
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'نموذج إدخال العهدة')
  XLSX.writeFile(workbook, `نموذج-استيراد-عهدة-المخازن-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/**
 * Parses raw JSON rows from XLSX sheet into CustodyItem objects.
 */
export function parseRawCustodyRows(
  rawRows: Array<Record<string, unknown>>,
  targetWarehouseId: string,
  existingItemsCountOrXLSX: number | typeof import('xlsx') = 0,
  maybeXLSX?: typeof import('xlsx')
): ParsedCustodyResult {
  const validItems: CustodyItem[] = []
  const warnings: string[] = []
  const errors: string[] = []
  let skippedCount = 0

  let existingItemsCount = 0
  let XLSX: typeof import('xlsx') | undefined

  if (typeof existingItemsCountOrXLSX === 'number') {
    existingItemsCount = existingItemsCountOrXLSX
    XLSX = maybeXLSX
  } else if (existingItemsCountOrXLSX && typeof existingItemsCountOrXLSX === 'object') {
    XLSX = existingItemsCountOrXLSX
  }

  const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId) || WAREHOUSES[0]
  const prefix = targetWh.id.toUpperCase().slice(0, 3)

  for (let index = 0; index < rawRows.length; index++) {
    const row = rawRows[index]
    const rowNum = index + 2 // 1-indexed, header is row 1

    // Find columns by normalized keys
    let code = ''
    let name = ''
    let category = ''
    let custodian = ''
    let quantity = 1
    let unit = 'قطعة'
    let unitPrice: number | undefined
    let rawValue: number | undefined
    let custodyType = 'مستديمة'
    let condition = 'good'
    let roomLocation = ''
    let acquisitionDate = ''
    let serialNumber = ''
    let notes = ''
    let rowWarehouse = ''

    for (const [key, val] of Object.entries(row)) {
      if (val == null) continue
      const normKey = normalizeArabicText(key)

      if (normKey.includes('كود') || normKey.includes('رمز') || normKey === 'code') {
        code = String(val).trim()
      } else if (
        normKey.includes('اسم الصنف') ||
        normKey.includes('الصنف') ||
        normKey.includes('المعدة') ||
        normKey.includes('الاصل') ||
        normKey.includes('البيان') ||
        normKey === 'name' ||
        normKey === 'item'
      ) {
        name = String(val).trim()
      } else if (normKey.includes('تصنيف') || normKey.includes('الفئه') || normKey === 'category') {
        category = String(val).trim()
      } else if (normKey.includes('امين') || normKey.includes('مسؤول') || normKey.includes('الطرف') || normKey === 'custodian') {
        custodian = String(val).trim()
      } else if (normKey.includes('كمي') || normKey.includes('عدد') || normKey === 'qty' || normKey === 'quantity') {
        const parsedQty = Number(String(val).replace(/[^0-9.-]/g, ''))
        if (!Number.isNaN(parsedQty) && parsedQty > 0) {
          quantity = parsedQty
        }
      } else if (normKey.includes('سعر') || normKey.includes('price')) {
        const parsedPrice = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9.-]/g, ''))
        if (!Number.isNaN(parsedPrice) && parsedPrice >= 0) {
          unitPrice = parsedPrice
        }
      } else if ((normKey.includes('وحد') && !normKey.includes('سعر')) || normKey === 'unit') {
        unit = String(val).trim() || 'قطعة'
      } else if (normKey.includes('اجمالي القيمه') || normKey.includes('القيمه الدفتريه') || normKey === 'value') {
        const parsedVal = Number(String(val).replace(/[^0-9.-]/g, ''))
        if (!Number.isNaN(parsedVal) && parsedVal >= 0) {
          rawValue = parsedVal
        }
      } else if (normKey.includes('نوع العهده') || normKey.includes('طبيعه') || normKey === 'custody_type') {
        custodyType = String(val).trim()
      } else if (normKey.includes('حاله') || normKey.includes('حالة') || normKey === 'condition') {
        condition = String(val).trim()
      } else if (normKey.includes('مكان') || normKey.includes('قاعه') || normKey.includes('قاعة') || normKey.includes('غرفه') || normKey === 'location') {
        roomLocation = String(val).trim()
      } else if (normKey.includes('تاريخ') || normKey === 'date') {
        acquisitionDate = parseExcelDate(val, XLSX)
      } else if (normKey.includes('مسلسل') || normKey.includes('سيريال') || normKey === 'serial') {
        serialNumber = String(val).trim()
      } else if (normKey.includes('ملاحظ') || normKey === 'notes') {
        notes = String(val).trim()
      } else if (normKey.includes('مخزن') || normKey.includes('كليه') || normKey.includes('مستودع') || normKey === 'warehouse') {
        rowWarehouse = String(val).trim()
      }
    }

    // Validation: Item name is mandatory
    if (!name) {
      skippedCount++
      if (Object.values(row).some((v) => v != null && String(v).trim() !== '')) {
        warnings.push(`تم تخطي الصف رقم ${rowNum} لعدم احتوائه على اسم الصنف`)
      }
      continue
    }

    // Determine target warehouse for this row
    let itemWarehouseId = targetWarehouseId
    if (rowWarehouse) {
      const matchWh = findWarehouseByRecipient(rowWarehouse)
      if (matchWh) {
        itemWarehouseId = matchWh.id
      }
    }

    const currentWarehouse = WAREHOUSES.find((w) => w.id === itemWarehouseId) || targetWh

    // Auto-generate code if empty
    if (!code) {
      const seq = (existingItemsCount + validItems.length + 1).toString().padStart(3, '0')
      code = `${prefix}-${seq}`
    }

    // Calculate value: System automatically calculates totalValue = quantity * unitPrice
    let totalValue = 0
    if (unitPrice != null && unitPrice >= 0) {
      totalValue = Math.round(quantity * unitPrice)
    } else if (rawValue != null && rawValue > 0) {
      totalValue = Math.round(rawValue)
      if (quantity > 0 && unitPrice == null) {
        unitPrice = Math.round(rawValue / quantity)
      }
    }

    const item: CustodyItem = {
      id: `c-imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${index}`,
      warehouseId: itemWarehouseId,
      code,
      name,
      category: parseCategory(category, name),
      custodian: custodian || `أمين عهدة ${currentWarehouse.shortName}`,
      quantity,
      unit,
      condition: parseCondition(condition),
      custodyType: parseCustodyType(custodyType),
      roomLocation: roomLocation || currentWarehouse.building,
      acquisitionDate: acquisitionDate || new Date().toISOString().slice(0, 10),
      unitPrice,
      value: totalValue,
      serialNumber: serialNumber && serialNumber !== '—' ? serialNumber : undefined,
      notes: notes || undefined,
    }

    validItems.push(item)
  }

  if (validItems.length === 0 && skippedCount > 0) {
    errors.push('لم يتم العثور على أي صف يحتوي على "اسم الصنف". يرجى التأكد من اختيار الشيت الصحيح ومن وجود عمود باسم الصنف.')
  }

  return { validItems, skippedCount, warnings, errors }
}

/**
 * Merges imported items into current custody records.
 */
export function mergeImportedCustody(
  currentItems: CustodyItem[],
  newItems: CustodyItem[],
  targetWarehouseId: string,
  mode: 'append' | 'replace'
): { updatedItems: CustodyItem[]; added: number; replaced: number } {
  if (mode === 'replace') {
    // Keep items from other warehouses, replace items of targetWarehouseId
    const otherWarehouseItems = currentItems.filter((i) => i.warehouseId !== targetWarehouseId)
    const updatedItems = [...otherWarehouseItems, ...newItems]
    saveCustodyItems(updatedItems)
    return {
      updatedItems,
      added: newItems.length,
      replaced: currentItems.filter((i) => i.warehouseId === targetWarehouseId).length,
    }
  }

  // Mode: append (updates existing item if matching code or clean name in same warehouse, or appends)
  // We MUST keep all current items intact without any loss or collapse!
  const updatedItems = [...currentItems]
  let added = 0
  let replaced = 0

  for (const newItem of newItems) {
    const normNewCode = (newItem.code || '').trim().toLowerCase()
    const normNewName = normalizeArabicText(newItem.name || '').trim()

    // Find if there is an existing item in the SAME warehouse that should be updated.
    // To be safe against shared/generic codes (like code '1' used across different items):
    let matchIdx = -1

    if (normNewCode) {
      const matchingCodeIndices = updatedItems
        .map((item, idx) => (item.warehouseId === newItem.warehouseId && (item.code || '').trim().toLowerCase() === normNewCode ? idx : -1))
        .filter((idx) => idx !== -1)

      if (matchingCodeIndices.length === 1) {
        // Exactly one existing item has this code in this warehouse -> update it
        matchIdx = matchingCodeIndices[0]
      } else if (matchingCodeIndices.length > 1) {
        // Multiple items have this code -> match by name to disambiguate
        const byName = matchingCodeIndices.find((idx) => {
          const item = updatedItems[idx]
          return normalizeArabicText(item.name || '').trim() === normNewName
        })
        if (byName !== undefined) {
          matchIdx = byName
        }
      }
    }

    // If still no match by code, check by exact name within the same warehouse
    if (matchIdx === -1 && normNewName) {
      matchIdx = updatedItems.findIndex(
        (item) => item.warehouseId === newItem.warehouseId && normalizeArabicText(item.name || '').trim() === normNewName
      )
    }

    if (matchIdx >= 0) {
      const existing = updatedItems[matchIdx]
      updatedItems[matchIdx] = {
        ...existing,
        ...newItem,
        id: existing.id, // preserve existing id
      }
      replaced++
    } else {
      updatedItems.push(newItem)
      added++
    }
  }

  saveCustodyItems(updatedItems)
  void saveCustodyItemsToCloud(updatedItems)

  return {
    updatedItems,
    added,
    replaced,
  }
}
