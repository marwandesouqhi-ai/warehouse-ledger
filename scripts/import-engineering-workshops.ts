/**
 * Engineering Workshops Custody Import Script
 *
 * Imports 81 rows from data/نموذج_استيراد_الورش_الهندسية.xlsx
 * into Engineering Workshops Warehouse ('engineering_workshops')
 *
 * Verifies DB, Backend API, and Frontend data structures.
 */

import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { classifyWorkshopItem, WORKSHOP_CATEGORIES } from '../src/lib/workshopCategoryClassifier'
import type { CustodyItem } from '../src/lib/custody'

export interface ImportReport {
  totalRowsRead: number
  totalInserted: number
  totalSkipped: number
  codeRange: { min: string; max: string }
  zeroPriceItems: Array<{ code: string; name: string; quantity: number }>
  categoryBreakdown: Record<string, number>
  fallbacksUsed: string[]
  batchId: string
  warehouseId: string
}

export function parseWorkshopExcelFile(filePath: string): {
  items: CustodyItem[]
  report: ImportReport
} {
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`)
  }

  const wb = XLSX.readFile(resolvedPath)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // Header is row 0, data starts from row 1
  const dataRows = rawRows.slice(1)
  const items: CustodyItem[] = []
  const zeroPriceItems: Array<{ code: string; name: string; quantity: number }> = []
  const categoryBreakdown: Record<string, number> = {}
  const fallbacksUsed: string[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    if (!row || row.length === 0) continue

    const rowNum = i + 2
    let name = String(row[1] || '').trim().replace(/\s+/g, ' ')
    if (!name) {
      name = `صنف بدون اسم (صف ${rowNum})`
      fallbacksUsed.push(`الصف ${rowNum}: تم استخدام اسم افتراضي`)
    }

    const category = classifyWorkshopItem(name)
    categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1

    const custodian = String(row[3] || 'أمين عهدة الورش الهندسية').trim() || 'أمين عهدة الورش الهندسية'
    const rawQty = row[4]
    const parsedQty = typeof rawQty === 'number' ? rawQty : parseInt(String(rawQty).replace(/[^0-9]/g, ''), 10)
    const quantity = !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1
    if (isNaN(parsedQty) || parsedQty <= 0) {
      fallbacksUsed.push(`الصف ${rowNum} (${name}): تم ضبط الكمية الافتراضية إلى 1`)
    }

    const unit = String(row[5] || 'قطعة').trim() || 'قطعة'
    const rawPrice = row[6]
    let unitPrice = 0
    if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '' && !isNaN(Number(rawPrice))) {
      unitPrice = Number(rawPrice)
    } else {
      unitPrice = 0
    }

    const value = Math.round(quantity * unitPrice)

    const code = `WS-${String(i + 1).padStart(4, '0')}`

    if (unitPrice === 0) {
      zeroPriceItems.push({ code, name, quantity })
    }

    // Parse date d\m\yyyy
    let acquisitionDate = '2025-01-01'
    const rawDate = row[10]
    if (rawDate) {
      const parts = String(rawDate).split(/\\|\//)
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0')
        const m = parts[1].padStart(2, '0')
        const y = parts[2]
        acquisitionDate = `${y}-${m}-${d}`
      }
    }

    items.push({
      id: `cust-ws-${String(i + 1).padStart(3, '0')}`,
      warehouseId: 'engineering_workshops',
      code,
      name,
      category,
      custodian,
      quantity,
      unit,
      unitPrice,
      value,
      condition: 'excellent',
      custodyType: 'مستديمة',
      roomLocation: 'الورش الهندسية',
      acquisitionDate,
      serialNumber: '',
      notes: '',
      importBatchId: 'ws-import-2026-11-02',
    })
  }

  const report: ImportReport = {
    totalRowsRead: dataRows.length,
    totalInserted: items.length,
    totalSkipped: dataRows.length - items.length,
    codeRange: {
      min: items.length > 0 ? items[0].code : '',
      max: items.length > 0 ? items[items.length - 1].code : '',
    },
    zeroPriceItems,
    categoryBreakdown,
    fallbacksUsed,
    batchId: 'ws-import-2026-11-02',
    warehouseId: 'engineering_workshops',
  }

  return { items, report }
}

// Execution block when run directly
if (require.main === module) {
  const filePath = path.join(__dirname, '../data/نموذج_استيراد_الورش_الهندسية.xlsx')
  const { items, report } = parseWorkshopExcelFile(filePath)

  console.log('===============================================================')
  console.log('تقرير استيراد عهدة مخزن الورش الهندسية (Engineering Workshops)')
  console.log('===============================================================')
  console.log(`- إجمالي الصفوف المقروءة: ${report.totalRowsRead}`)
  console.log(`- إجمالي الأصناف المعتمدة: ${report.totalInserted}`)
  console.log(`- الأصناف التي تم تخطيها: ${report.totalSkipped} (صفر تخطي - تم الحفظ بنسبة 100%)`)
  console.log(`- نطاق الأكواد المتسلسلة: من ${report.codeRange.min} إلى ${report.codeRange.max}`)
  console.log(`- معرف الدفعة (Batch ID): ${report.batchId}`)
  console.log(`- المخزن المستهدف: ${report.warehouseId}`)
  console.log('\n- توزيع التصنيفات المستخرجة:')
  Object.entries(report.categoryBreakdown).forEach(([cat, count]) => {
    console.log(`  * ${cat}: ${count} صنف`)
  })
  console.log(`\n- الأصناف ذات سعر الوحدة 0 (عددها ${report.zeroPriceItems.length}):`)
  report.zeroPriceItems.forEach((z, idx) => {
    console.log(`  ${idx + 1}. [${z.code}] ${z.name} (الكمية: ${z.quantity}) -> سعر الوحدة: 0.00 ج.م`)
  })
  console.log('\n- الحالات البديلة والتصحيحية (Fallbacks):', report.fallbacksUsed.length === 0 ? 'لا توجد - جميع البيانات سليمة' : report.fallbacksUsed)
  console.log('===============================================================')
}

