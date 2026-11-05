vi.mock('../../src/lib/supabase', () => ({ supabase: null }))
import { prepareAccessContext } from '../../src/lib/accessContext'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  CUSTODY_STORAGE_KEY,
  findWarehouseByRecipient,
  fixtureCustodyItems,
  getWarehouseStats,
  loadCustodyItems,
  saveCustodyItems,
  syncInwardMovementToCustody,
  syncOutwardMovementToCustody,
  WAREHOUSES,
  type CustodyItem,
} from '../../src/lib/custody'

describe('Custody Module & Warehouse Definitions', () => {
  beforeEach(() => {
    prepareAccessContext({ user: { id: '00000000-0000-4000-8000-000000000001', app_metadata: { role: 'system_admin' } } } as any)
    localStorage.clear()
  })

  it('contains the 9 university warehouses without commerce, with main warehouse as central hub', () => {
    expect(WAREHOUSES).toHaveLength(9)

    const expectedNames = [
      'مخزن رئيسي',
      'مخزن كلية طب بشري وتمريض',
      'مخزن مبنى بشري أ',
      'كلية طب أسنان',
      'كلية صيدلة',
      'معمل مركزي',
      'كلية هندسة',
      'مخزن الورش الهندسية',
      'كلية حاسبات و معلومات',
    ]

    const actualNames = WAREHOUSES.map((w) => w.name)
    for (const name of expectedNames) {
      expect(actualNames).toContain(name)
    }

    // Verify commerce is removed
    expect(actualNames).not.toContain('كلية تجارة')

    // Verify supply hierarchy: main is hub, all others are supplied by main
    const mainWh = WAREHOUSES.find((w) => w.id === 'main')
    expect(mainWh?.isHub).toBe(true)

    const branchWarehouses = WAREHOUSES.filter((w) => w.id !== 'main')
    for (const branch of branchWarehouses) {
      expect(branch.suppliedBy).toBe('المخزن الرئيسي')
    }
  })

  it('calculates warehouse stats accurately', () => {
    const sampleItems: CustodyItem[] = [
      {
        id: '1',
        warehouseId: 'medicine',
        code: 'MED-01',
        name: 'جهاز 1',
        category: 'أجهزة ومعدات طبية',
        custodian: 'د. فلان',
        quantity: 5,
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'معمل 1',
        acquisitionDate: '2025-01-01',
        value: 10000,
      },
      {
        id: '2',
        warehouseId: 'medicine',
        code: 'MED-02',
        name: 'جهاز 2',
        category: 'أجهزة ومعدات طبية',
        custodian: 'د. علان',
        quantity: 3,
        unit: 'جهاز',
        condition: 'maintenance',
        custodyType: 'مستديمة',
        roomLocation: 'معمل 2',
        acquisitionDate: '2025-01-02',
        value: 5000,
      },
    ]

    const stats = getWarehouseStats(sampleItems)
    expect(stats.totalItems).toBe(2)
    expect(stats.totalUnits).toBe(8)
    expect(stats.totalValue).toBe(15000)
    expect(stats.excellent).toBe(1)
    expect(stats.maintenance).toBe(1)
    expect(stats.damaged).toBe(0)
    expect(stats.healthyRatio).toBe(50) // 1 out of 2 is excellent/good
  })

  it('seeds main warehouse custody with purchases items when no user records are present', () => {
    expect(fixtureCustodyItems.length).toBe(180)
    const items = loadCustodyItems()
    expect(items).toHaveLength(180)
    expect(items.filter((i) => i.warehouseId === 'main')).toHaveLength(32)
  })

  it('persists and retrieves custody items to and from localStorage', () => {
    const customItems: CustodyItem[] = [
      {
        id: 'cust-99',
        warehouseId: 'engineering',
        code: 'ENG-99',
        name: 'راسم إشارة اختباري',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'م. تجربة',
        quantity: 1,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'معمل ورشة',
        acquisitionDate: '2025-05-01',
        value: 12000,
      },
    ]

    saveCustodyItems(customItems)
    expect(localStorage.getItem(CUSTODY_STORAGE_KEY)).toContain('ENG-99')

    const loaded = loadCustodyItems()
    expect(loaded).toHaveLength(149)
    expect(loaded.some((i) => i.code === 'ENG-99')).toBe(true)
  })

  it('accurately resolves recipient warehouse by name or alias', () => {
    expect(findWarehouseByRecipient('كلية طب بشري')?.id).toBe('medicine')
    expect(findWarehouseByRecipient('طب أسنان')?.id).toBe('dentistry')
    expect(findWarehouseByRecipient('كلية صيدلة')?.id).toBe('pharmacy')
    expect(findWarehouseByRecipient('كلية تمريض')?.id).toBe('medicine')
    expect(findWarehouseByRecipient('معمل مركزي')?.id).toBe('central_lab')
    expect(findWarehouseByRecipient('كلية هندسة')?.id).toBe('engineering')
    expect(findWarehouseByRecipient('كلية حاسبات و معلومات')?.id).toBe('fci')
    expect(findWarehouseByRecipient('المخزن الرئيسي')?.id).toBe('main')
  })

  it('syncs inward movements directly to main warehouse custody', () => {
    // 1. First inward movement creates a new item in main warehouse
    const res1 = syncInwardMovementToCustody({
      item: 'ميكروسكوب ضوئي رقمي',
      date: '2026-10-11',
      qin: 10,
      price: 15000,
      from: 'الشركة الألمانية للتجهيزات',
      inv: 'INV-101',
    })
    expect(res1.added).toBe(true)
    expect(res1.item.warehouseId).toBe('main')
    expect(res1.item.quantity).toBe(10)
    expect(res1.item.category).toBe('أجهزة معملية وتجارب')

    // 2. Second inward movement with same item name increments quantity
    const res2 = syncInwardMovementToCustody({
      item: 'ميكروسكوب ضوئي رقمي',
      date: '2026-10-12',
      qin: 5,
      price: 15000,
      from: 'الشركة الألمانية للتجهيزات',
      inv: 'INV-102',
    })
    expect(res2.added).toBe(false)
    expect(res2.item.quantity).toBe(15)

    const allMain = loadCustodyItems().filter((i) => i.warehouseId === 'main')
    // 32 original main items + 1 added microscope = 33
    expect(allMain).toHaveLength(33)
    const microscope = allMain.find((i) => i.name === 'ميكروسكوب ضوئي رقمي')
    expect(microscope).toBeDefined()
    expect(microscope?.quantity).toBe(15)
  })

  it('syncs outward movements: deducts from main warehouse and feeds destination branch warehouse', () => {
    // Seed main warehouse with 20 laptops
    syncInwardMovementToCustody({
      item: 'لابتوب Dell Precision',
      qin: 20,
      price: 30000,
      from: 'دل للتكنولوجيا',
    })

    // Disburse 6 laptops to FCI (Faculty of Computers & Information)
    const outRes = syncOutwardMovementToCustody({
      item: 'لابتوب Dell Precision',
      qout: 6,
      to: 'كلية حاسبات و معلومات',
      permit: 'PERM-99',
      issue: '2026-10-11',
    })

    expect(outRes.deductedFromMain).toBe(true)
    expect(outRes.addedToTarget).toBe(true)
    expect(outRes.targetWarehouse?.id).toBe('fci')

    const items = loadCustodyItems()
    const mainItem = items.find((i) => i.warehouseId === 'main' && i.name === 'لابتوب Dell Precision')
    const fciItem = items.find((i) => i.warehouseId === 'fci' && i.name === 'لابتوب Dell Precision')

    expect(mainItem).toBeDefined()
    expect(mainItem?.quantity).toBe(14) // 20 - 6 = 14

    expect(fciItem).toBeDefined()
    expect(fciItem?.quantity).toBe(6) // 6 transferred to FCI
    expect(fciItem?.notes).toContain('PERM-99')
  })

  it('automatically calculates total value from quantity and unitPrice when user entered unit price into value field', () => {
    // Simulate user entering quantity=450 and unitPrice=6930 into the legacy value field
    const legacyItems: CustodyItem[] = [
      {
        id: 'c-test-450',
        warehouseId: 'fci',
        code: 'CUS-8832',
        name: 'ترابيزة كمبيوتر',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين العهدة',
        quantity: 450,
        unit: 'ترابيزة',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'مبنى حاسبات',
        acquisitionDate: '2026-10-11',
        value: 6930, // user typed unit price 6930 into value field
      },
      {
        id: 'c-test-13',
        warehouseId: 'fci',
        code: 'CUS-0026',
        name: 'مكتب بدون سايد',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين العهدة',
        quantity: 13,
        unit: 'مكتب',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'مبنى حاسبات',
        acquisitionDate: '2026-10-11',
        value: 8847, // user typed unit price 8847 into value field
      },
    ]

    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify(legacyItems))

    const loaded = loadCustodyItems()
    // 2 legacy items + 67 medicine + 81 workshops auto-healed = 150
    expect(loaded).toHaveLength(150)

    const tableItem = loaded.find((i) => i.code === 'CUS-8832')
    expect(tableItem).toBeDefined()
    expect(tableItem?.quantity).toBe(450)
    expect(tableItem?.unitPrice).toBe(6930)
    expect(tableItem?.value).toBe(450 * 6930) // 3,118,500

    const deskItem = loaded.find((i) => i.code === 'CUS-0026')
    expect(deskItem).toBeDefined()
    expect(deskItem?.quantity).toBe(13)
    expect(deskItem?.unitPrice).toBe(8847)
    expect(deskItem?.value).toBe(13 * 8847) // 115,011
  })

  it('automatically repairs items where value was erroneously saved equal to unitPrice for quantity > 1', () => {
    const itemsWithValueEqualsUnitPrice: CustodyItem[] = [
      {
        id: 'c-test-28',
        warehouseId: 'fci',
        code: 'CUS-1230',
        name: 'مكتب ب سايد',
        category: 'أثاث وتجهيزات',
        custodian: 'أمين العهدة',
        quantity: 28,
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'مبنى حاسبات',
        acquisitionDate: '2026-10-11',
        unitPrice: 14611,
        value: 14611, // erroneously equal to unitPrice instead of 28 * 14611
      },
    ]

    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify(itemsWithValueEqualsUnitPrice))

    const loaded = loadCustodyItems()
    // 1 repaired item + 67 medicine + 81 workshops auto-healed = 149
    expect(loaded).toHaveLength(149)
    expect(loaded[0].quantity).toBe(28)
    expect(loaded[0].unitPrice).toBe(14611)
    expect(loaded[0].value).toBe(28 * 14611) // 409,108
  })
})

