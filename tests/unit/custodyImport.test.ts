import { describe, expect, it } from 'vitest'
import {
  normalizeArabicText,
  parseCategory,
  parseCondition,
  parseCustodyType,
  parseExcelDate,
  parseRawCustodyRows,
  mergeImportedCustody,
} from '../../src/lib/custodyImport'
import type { CustodyItem } from '../../src/lib/custody'

describe('Custody Excel Import Suite', () => {
  it('normalizes Arabic text correctly', () => {
    expect(normalizeArabicText('  أجهزة   إلكترونية  ')).toBe('اجهزه الكترونيه')
  })

  it('parses condition strings correctly', () => {
    expect(parseCondition('ممتازة')).toBe('excellent')
    expect(parseCondition('ممتاز')).toBe('excellent')
    expect(parseCondition('جيدة')).toBe('good')
    expect(parseCondition('تحتاج صيانة')).toBe('maintenance')
    expect(parseCondition('تالفة / كهنة')).toBe('damaged')
    expect(parseCondition('غير معروف')).toBe('good')
  })

  it('parses custody types correctly', () => {
    expect(parseCustodyType('مستديمة')).toBe('مستديمة')
    expect(parseCustodyType('مستهلكة')).toBe('مستهلكة')
    expect(parseCustodyType('شخصية')).toBe('شخصية')
    expect(parseCustodyType('')).toBe('مستديمة')
  })

  it('parses categories with fallback to guessCategory', () => {
    expect(parseCategory('أجهزة ومعدات طبية', 'سرير مريض')).toBe('أجهزة ومعدات طبية')
    expect(parseCategory('', 'ميكروسكوب ضوئي')).toBe('أجهزة معملية وتجارب')
    expect(parseCategory('', 'جهاز لابتوب Dell')).toBe('أجهزة إلكترونية وحواسب')
  })

  it('parses ISO and DMY dates correctly', () => {
    expect(parseExcelDate('2026-10-12')).toBe('2026-10-12')
    expect(parseExcelDate('2026/10/12')).toBe('2026-10-12')
    expect(parseExcelDate('12-10-2026')).toBe('2026-10-12')
    expect(parseExcelDate('12/10/2026')).toBe('2026-10-12')
  })

  it('parses raw Excel rows matching the exact user template', () => {
    const rawRows = [
      {
        'كود العهدة': 'MAIN-001',
        'اسم الصنف': 'شاشة عرض تفاعلية 65 بوصة',
        'التصنيف': 'أجهزة إلكترونية وحواسب',
        'أمين العهدة': 'أحمد محمد',
        'الكمية': 2,
        'الوحدة': 'شاشة',
        'سعر الوحدة (EGP)': 45000,
        'نوع العهدة': 'مستديمة',
        'الحالة الفنية': 'ممتازة',
        'المكان / القاعة': 'قاعة المؤتمرات 1',
        'تاريخ القيد': '2026-09-15',
        'الرقم المسلسل': 'SN-DISP-9921',
        'ملاحظات': 'شامل الحامل الجداري',
      },
      {
        'اسم الصنف': 'مكتب إداري خشب زان',
        'الكمية': 4,
        'سعر الوحدة (EGP)': 6000,
      },
      {
        'كود العهدة': 'EMPTY-ROW',
        // Missing name - should be skipped
      },
    ]

    const result = parseRawCustodyRows(rawRows, 'main')
    expect(result.validItems.length).toBe(2)
    expect(result.skippedCount).toBe(1)

    const item1 = result.validItems[0]
    expect(item1.code).toBe('MAIN-001')
    expect(item1.name).toBe('شاشة عرض تفاعلية 65 بوصة')
    expect(item1.category).toBe('أجهزة إلكترونية وحواسب')
    expect(item1.custodian).toBe('أحمد محمد')
    expect(item1.quantity).toBe(2)
    expect(item1.unitPrice).toBe(45000)
    expect(item1.value).toBe(90000)
    expect(item1.condition).toBe('excellent')
    expect(item1.custodyType).toBe('مستديمة')
    expect(item1.acquisitionDate).toBe('2026-09-15')
    expect(item1.serialNumber).toBe('SN-DISP-9921')
    expect(item1.notes).toBe('شامل الحامل الجداري')

    const item2 = result.validItems[1]
    expect(item2.name).toBe('مكتب إداري خشب زان')
    expect(item2.category).toBe('أثاث وتجهيزات')
    expect(item2.quantity).toBe(4)
    expect(item2.unitPrice).toBe(6000)
    expect(item2.value).toBe(24000)
    expect(item2.code).toBe('MAI-002')
  })

  it('merges imported items into current records in append and replace modes', () => {
    const existing: CustodyItem[] = [
      {
        id: 'c-1',
        warehouseId: 'main',
        code: 'MAIN-001',
        name: 'طابعة ليزر',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'مروان',
        quantity: 1,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'مكتب أ',
        acquisitionDate: '2026-01-01',
        value: 5000,
      },
      {
        id: 'c-2',
        warehouseId: 'medicine',
        code: 'MED-001',
        name: 'ميكروسكوب',
        category: 'أجهزة معملية وتجارب',
        custodian: 'طبيب',
        quantity: 1,
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'معمل',
        acquisitionDate: '2026-01-01',
        value: 12000,
      },
    ]

    const newItems: CustodyItem[] = [
      {
        id: 'c-new',
        warehouseId: 'main',
        code: 'MAIN-001', // Duplicate code in main: should update quantity and value
        name: 'طابعة ليزر محدثة',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'مروان دسوقي',
        quantity: 3,
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'مكتب أ',
        acquisitionDate: '2026-10-12',
        value: 15000,
      },
      {
        id: 'c-new-2',
        warehouseId: 'main',
        code: 'MAIN-002',
        name: 'سكانر مستندات',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'مروان دسوقي',
        quantity: 1,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'مكتب أ',
        acquisitionDate: '2026-10-12',
        value: 7000,
      },
    ]

    // 1. Append mode: updates MAIN-001, adds MAIN-002, keeps MED-001
    const appendResult = mergeImportedCustody(existing, newItems, 'main', 'append')
    expect(appendResult.updatedItems.length).toBe(3)
    const updatedMain1 = appendResult.updatedItems.find((i) => i.code === 'MAIN-001')
    expect(updatedMain1?.quantity).toBe(3)
    expect(updatedMain1?.name).toBe('طابعة ليزر محدثة')

    // Existing inventory must never be removed by replacement imports.
    expect(() => mergeImportedCustody(existing, newItems, 'main', 'replace')).toThrow(/الاستبدال/)
    expect(existing).toHaveLength(2)

  })

  it('never collapses or loses existing items that share the same code or number', () => {
    // 3 items with the same generic code "1" in fci (e.g., desks, chairs, sofas)
    const existingWithSharedCodes: CustodyItem[] = [
      {
        id: 'c-1',
        warehouseId: 'fci',
        code: '1',
        name: 'مكتب بدون سايد',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين عهدة',
        quantity: 13,
        unit: 'مكتب',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'قاعة 1',
        acquisitionDate: '2026-01-01',
        value: 13000,
      },
      {
        id: 'c-2',
        warehouseId: 'fci',
        code: '1',
        name: 'كرسي مدير',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين عهدة',
        quantity: 5,
        unit: 'كرسي',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'قاعة 2',
        acquisitionDate: '2026-01-01',
        value: 5000,
      },
      {
        id: 'c-3',
        warehouseId: 'fci',
        code: '1',
        name: 'كنبة انتظار',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين عهدة',
        quantity: 2,
        unit: 'كنبة',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'مدخل',
        acquisitionDate: '2026-01-01',
        value: 8000,
      },
    ]

    const newImported: CustodyItem[] = [
      {
        id: 'c-new-imp',
        warehouseId: 'fci',
        code: '94',
        name: 'مكنة تصوير توشيبا',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'أمين عهدة',
        quantity: 1,
        unit: 'مكنة',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'إدارة',
        acquisitionDate: '2026-10-12',
        value: 25000,
      },
    ]

    const result = mergeImportedCustody(existingWithSharedCodes, newImported, 'fci', 'append')
    // Must keep all 3 existing items plus 1 new item = 4 items total (no collapse!)
    expect(result.updatedItems.length).toBe(4)
    expect(result.updatedItems.map((i) => i.name)).toContain('مكتب بدون سايد')
    expect(result.updatedItems.map((i) => i.name)).toContain('كرسي مدير')
    expect(result.updatedItems.map((i) => i.name)).toContain('كنبة انتظار')
    expect(result.updatedItems.map((i) => i.name)).toContain('مكنة تصوير توشيبا')
  })
})
