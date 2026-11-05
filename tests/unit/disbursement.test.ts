vi.mock('../../src/lib/supabase', () => ({ supabase: null }))
import { prepareAccessContext } from '../../src/lib/accessContext'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadCustodyItems,
  saveCustodyItems,
  syncInwardMovementToCustody,
  syncOutwardMovementToCustody,
  type CustodyItem,
} from '../../src/lib/custody'

describe('Disbursement & Multi-Warehouse Transfer Suite (Phase 3)', () => {
  beforeEach(() => {
    prepareAccessContext({ user: { id: '00000000-0000-4000-8000-000000000001', app_metadata: { role: 'system_admin' } } } as any)
    localStorage.clear()
  })

  it('rejects disbursement when requested quantity exceeds available stock in source warehouse', () => {
    // Seed main warehouse with 5 units
    syncInwardMovementToCustody({
      item: 'ميكروسكوب ضوئي',
      qin: 5,
      price: 12000,
      from: 'شركة الأجهزة العلمية',
    })

    // Attempt to disburse 10 units (more than 5)
    expect(() => {
      syncOutwardMovementToCustody({
        item: 'ميكروسكوب ضوئي',
        qout: 10,
        sourceWarehouseId: 'main',
        to: 'كلية طب بشري',
      })
    }).toThrow(/غير كافٍ/)
  })

  it('rejects disbursement when source and destination warehouse are identical', () => {
    syncInwardMovementToCustody({
      item: 'كراسي مدرجات',
      qin: 100,
      price: 500,
      from: 'مصنع الأثاث التعليمي',
    })

    expect(() => {
      syncOutwardMovementToCustody({
        item: 'كراسي مدرجات',
        qout: 10,
        sourceWarehouseId: 'main',
        destWarehouseId: 'main',
        destType: 'warehouse',
      })
    }).toThrow(/نفس المستودع/)
  })

  it('supports transfers from a branch warehouse to another branch warehouse', () => {
    // Seed engineering warehouse with 15 units
    const items: CustodyItem[] = [
      {
        id: 'eng-01',
        warehouseId: 'engineering',
        code: 'ENG-001',
        name: 'جهاز مساحة Total Station',
        category: 'أجهزة معملية وتجارب',
        custodian: 'أمين عهدة كلية هندسة',
        quantity: 15,
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'معمل المساحة',
        acquisitionDate: '2026-10-10',
        unitPrice: 45000,
        value: 15 * 45000,
      },
    ]
    saveCustodyItems(items)

    // Transfer 3 units from engineering to fci (computers)
    const result = syncOutwardMovementToCustody({
      item: 'جهاز مساحة Total Station',
      qout: 3,
      sourceWarehouseId: 'engineering',
      destWarehouseId: 'fci',
      destType: 'warehouse',
      permit: 'PERM-TR-01',
      issue: '2026-10-13',
    })

    expect(result.deductedFromSource).toBe(true)
    expect(result.addedToTarget).toBe(true)
    expect(result.targetWarehouse?.id).toBe('fci')

    const updated = loadCustodyItems()
    const engItem = updated.find((i) => i.warehouseId === 'engineering' && i.name === 'جهاز مساحة Total Station')
    const fciItem = updated.find((i) => i.warehouseId === 'fci' && i.name === 'جهاز مساحة Total Station')

    expect(engItem?.quantity).toBe(12) // 15 - 3
    expect(fciItem?.quantity).toBe(3)
  })

  it('supports personal disbursement to a specific custodian', () => {
    syncInwardMovementToCustody({
      item: 'جهاز iPad Pro للمتابعة الميدانية',
      qin: 10,
      price: 28000,
      from: 'أبل الشرق الأوسط',
    })

    const result = syncOutwardMovementToCustody({
      item: 'جهاز iPad Pro للمتابعة الميدانية',
      qout: 1,
      sourceWarehouseId: 'main',
      destType: 'custodian',
      custodianName: 'د. خالد إبراهيم (عميد الكلية)',
      permit: 'PERM-CUST-10',
      to: 'مكتب العميد',
    })

    expect(result.deductedFromSource).toBe(true)
    expect(result.addedToCustodian).toBe(true)

    const updated = loadCustodyItems()
    const mainItem = updated.find((i) => i.warehouseId === 'main' && i.name === 'جهاز iPad Pro للمتابعة الميدانية' && i.custodian !== 'د. خالد إبراهيم (عميد الكلية)')
    const personalItem = updated.find((i) => i.custodian === 'د. خالد إبراهيم (عميد الكلية)')

    expect(mainItem?.quantity).toBe(9) // 10 - 1
    expect(personalItem).toBeDefined()
    expect(personalItem?.quantity).toBe(1)
    expect(personalItem?.custodyType).toBe('شخصية')
  })

  it('enforces idempotency when custodyApplied is already true', () => {
    syncInwardMovementToCustody({
      item: 'سيرفر خادم بيانات Rack 2U',
      qin: 2,
      price: 150000,
      from: 'HPE',
    })

    const movement = {
      item: 'سيرفر خادم بيانات Rack 2U',
      qout: 1,
      sourceWarehouseId: 'main',
      destWarehouseId: 'fci',
      custodyApplied: false,
    }

    const res1 = syncOutwardMovementToCustody(movement)
    expect(res1.deductedFromSource).toBe(true)
    expect(movement.custodyApplied).toBe(true)

    // Call again with custodyApplied = true
    const res2 = syncOutwardMovementToCustody(movement)
    expect(res2.deductedFromSource).toBe(false)
    expect(res2.addedToTarget).toBe(false)

    // Verify main quantity was only deducted ONCE
    const items = loadCustodyItems()
    const mainItem = items.find((i) => i.warehouseId === 'main' && i.name === 'سيرفر خادم بيانات Rack 2U')
    expect(mainItem?.quantity).toBe(1) // not 0!
  })

  it('regression: legacy call signature produces exact same expected result', () => {
    // Seed main warehouse with 20 items
    syncInwardMovementToCustody({
      item: 'لابتوب HP ProBook',
      qin: 20,
      price: 22000,
      from: 'اتش بي إيجيبت',
    })

    // Call with ONLY legacy fields (no sourceWarehouseId, no destWarehouseId, no destType)
    const outRes = syncOutwardMovementToCustody({
      item: 'لابتوب HP ProBook',
      qout: 8,
      to: 'كلية تمريض',
      permit: 'PERM-NURS-01',
      issue: '2026-10-13',
    })

    expect(outRes.deductedFromMain).toBe(true)
    expect(outRes.addedToTarget).toBe(true)
    expect(outRes.targetWarehouse?.id).toBe('medicine')

    const items = loadCustodyItems()
    const mainItem = items.find((i) => i.warehouseId === 'main' && i.name === 'لابتوب HP ProBook')
    const branchItem = items.find((i) => i.warehouseId === 'medicine' && i.name === 'لابتوب HP ProBook')

    expect(mainItem?.quantity).toBe(12) // 20 - 8
    expect(branchItem?.quantity).toBe(8)
  })

  it('rejects disbursement and never creates destination record when source item does not exist (Issue #19)', () => {
    // Attempting to disburse an item that doesn't exist in source warehouse
    expect(() => {
      syncOutwardMovementToCustody({
        item: 'صنف غير موجود إطلاقاً',
        sourceItemId: 'non-existent-id',
        qout: 5,
        sourceWarehouseId: 'main',
        to: 'كلية هندسة',
      })
    }).toThrow(/غير مسجل في المخزن المصدر المحدد/)

    // Confirm no phantom item was created in destination warehouse
    const items = loadCustodyItems()
    expect(items.some((i) => i.name === 'صنف غير موجود إطلاقاً')).toBe(false)
  })

  it('accepts disbursement with valid sourceItemId and conserves quantity (Issue #19)', () => {
    syncInwardMovementToCustody({
      item: 'شاشة سامسونج 27 بوصة',
      qin: 10,
      price: 8000,
      from: 'سامسونج مصر',
    })

    const itemsBefore = loadCustodyItems()
    const sourceItem = itemsBefore.find((i) => i.name === 'شاشة سامسونج 27 بوصة' && i.warehouseId === 'main')!
    expect(sourceItem).toBeDefined()

    const res = syncOutwardMovementToCustody({
      item: sourceItem.name,
      sourceItemId: sourceItem.id,
      qout: 4,
      sourceWarehouseId: 'main',
      destWarehouseId: 'engineering',
      destType: 'warehouse',
      to: 'كلية هندسة',
    })

    expect(res.deductedFromSource).toBe(true)
    expect(res.addedToTarget).toBe(true)

    const itemsAfter = loadCustodyItems()
    const mainAfter = itemsAfter.find((i) => i.id === sourceItem.id)!
    const destAfter = itemsAfter.find((i) => i.name === sourceItem.name && i.warehouseId === 'engineering')!

    expect(mainAfter.quantity).toBe(6)
    expect(destAfter.quantity).toBe(4)
  })
})
