import { describe, expect, it, beforeEach } from 'vitest'
import { prepareAccessContext } from '../../src/lib/accessContext'
import {
  executeCustodyTransfer,
  reconcileMovementEdit,
  reverseMovementCustody,
  loadCustodyItems,
  saveCustodyItems,
  type CustodyItem,
} from '../../src/lib/custody'
import { deriveSummary } from '../../src/lib/derive'
import { evaluateLedgerQuality } from '../../src/lib/quality'
import type { FixtureMovement } from '../../src/lib/fixture'

describe('Phase 2 — Inventory Integrity', () => {
  beforeEach(() => {
    localStorage.clear()
    prepareAccessContext({ user: { id: '00000000-0000-4000-8000-000000000001', app_metadata: { role: 'system_admin' } } } as any)
  })

  describe('Issue #3: Proportional Value Allocation and Conservation on Transfer', () => {
    it('proportionally allocates value and strictly conserves total quantity and value on partial transfer', () => {
      const sourceItem: CustodyItem = {
        id: 'item-source-1',
        warehouseId: 'main',
        code: 'MAIN-001',
        name: 'ميكروسكوب ضوئي متطور',
        category: 'أجهزة معملية وتجارب',
        custodian: 'أمين المخزن الرئيسي',
        quantity: 10,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'المخزن الرئيسي',
        acquisitionDate: '2024-01-15',
        value: 50000,
        unitPrice: 5000,
      }

      const initialItems: CustodyItem[] = [sourceItem]
      const transferQty = 3

      const { updatedItems, sourceItem: nextSource, targetItem, transferredValue } =
        executeCustodyTransfer(initialItems, {
          item: sourceItem,
          targetWarehouseId: 'medicine',
          quantity: transferQty,
          custodian: 'د. أحمد',
          roomLocation: 'معمل باثولوجي',
          notes: 'صرف لمعمل الباثولوجي',
        })

      // Check proportional value
      expect(transferredValue).toBe(15000)
      expect(nextSource.quantity).toBe(7)
      expect(nextSource.value).toBe(35000)
      expect(targetItem.quantity).toBe(3)
      expect(targetItem.value).toBe(15000)

      // Strict quantity conservation
      const totalQuantity = updatedItems.reduce((sum, i) => sum + i.quantity, 0)
      expect(totalQuantity).toBe(10)

      // Strict value conservation
      const totalValue = updatedItems.reduce((sum, i) => sum + i.value, 0)
      expect(totalValue).toBe(50000)

      // Structured history event was attached
      expect(nextSource.historyEvents?.length).toBeGreaterThan(0)
      expect(nextSource.historyEvents?.[0].type).toBe('transfer')
      expect(targetItem.historyEvents?.length).toBeGreaterThan(0)
      expect(targetItem.historyEvents?.[0].type).toBe('transfer')
    })

    it('merges into existing target item while conserving total value and quantity', () => {
      const sourceItem: CustodyItem = {
        id: 'item-source-2',
        warehouseId: 'main',
        code: 'MED-100',
        name: 'شاشة مراقبة علامات حيوية',
        category: 'أجهزة ومعدات طبية',
        custodian: 'أمين المخزن الرئيسي',
        quantity: 5,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'المخزن الرئيسي',
        acquisitionDate: '2024-02-01',
        value: 25000,
        unitPrice: 5000,
      }

      const existingTarget: CustodyItem = {
        id: 'item-target-existing',
        warehouseId: 'medicine',
        code: 'MED-100',
        name: 'شاشة مراقبة علامات حيوية',
        category: 'أجهزة ومعدات طبية',
        custodian: 'أمين عهدة كلية الطب',
        quantity: 2,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'العناية المركزة',
        acquisitionDate: '2024-01-01',
        value: 10000,
        unitPrice: 5000,
      }

      const initialItems: CustodyItem[] = [sourceItem, existingTarget]
      const { updatedItems, targetItem } = executeCustodyTransfer(initialItems, {
        item: sourceItem,
        targetWarehouseId: 'medicine',
        quantity: 2,
      })

      // Target item received 2 more and 10000 more value
      expect(targetItem.quantity).toBe(4)
      expect(targetItem.value).toBe(20000)

      // Total conservation across all items
      const totalQuantity = updatedItems.reduce((sum, i) => sum + i.quantity, 0)
      expect(totalQuantity).toBe(7) // 3 in source + 4 in target

      const totalValue = updatedItems.reduce((sum, i) => sum + i.value, 0)
      expect(totalValue).toBe(35000) // 15000 in source + 20000 in target
    })
  })

  describe('Issue #4: Edit Delta Reconciliation & Deletion Reversal', () => {
    it('applies only the difference between old and new movement to custody stock', () => {
      const mainItem: CustodyItem = {
        id: 'cst-main-pc',
        warehouseId: 'main',
        code: 'PC-01',
        name: 'حاسوب مكتبي Core i7',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'أمين المخزن',
        quantity: 10,
        unit: 'جهاز',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'مخزن رئيسي',
        acquisitionDate: '2024-03-01',
        value: 150000,
        unitPrice: 15000,
      }
      saveCustodyItems([mainItem])

      const oldMovement: FixtureMovement = {
        id: 'mov-1',
        item: 'حاسوب مكتبي Core i7',
        qin: 10,
        qout: 0,
        price: 15000,
        date: '2024-03-01',
        inv: 'INV-100',
        from: 'شركة التوريدات',
        to: '',
        permit: '',
        issue: '',
        notes: '',
      }

      // User edits purchase from 10 to 14 (+4 units)
      const newMovement: FixtureMovement = {
        ...oldMovement,
        qin: 14,
      }

      reconcileMovementEdit(oldMovement, newMovement)
      const updated = loadCustodyItems().find((i) => i.id === 'cst-main-pc')

      // Stock should only increase by the delta (+4), making it 14, NOT 24!
      expect(updated?.quantity).toBe(14)
      expect(updated?.value).toBe(210000)
    })

    it('reverses inventory effect when deleting a movement', () => {
      const mainItem: CustodyItem = {
        id: 'cst-del-test',
        warehouseId: 'main',
        code: 'DEL-01',
        name: 'طابعة ليزر متعددة الوظائف',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'أمين المخزن',
        quantity: 5,
        unit: 'طابعة',
        condition: 'good',
        custodyType: 'مستديمة',
        roomLocation: 'مخزن رئيسي',
        acquisitionDate: '2024-03-01',
        value: 25000,
        unitPrice: 5000,
      }
      saveCustodyItems([mainItem])

      const inwardMovement: FixtureMovement = {
        id: 'mov-del-1',
        item: 'طابعة ليزر متعددة الوظائف',
        qin: 5,
        qout: 0,
        price: 5000,
        date: '2024-03-01',
        inv: 'INV-DEL-1',
        from: 'شركة الطابعات',
        to: '',
        permit: '',
        issue: '',
        notes: '',
      }

      reverseMovementCustody(inwardMovement)
      const afterDel = loadCustodyItems().find((i) => i.id === 'cst-del-test')

      // Reversing the inward receipt reduces stock back to 0
      expect(afterDel?.quantity).toBe(0)
      expect(afterDel?.value).toBe(0)
    })
  })

  describe('Issue #6: Cumulative Ledger Balances and Validation', () => {
    it('does not flag pure disbursement as over when cumulative receipts cover stock', () => {
      const rows = [
        { id: 1, item: 'مجهر إلكتروني', qin: 10, qout: 0, price: 1000, date: '2024-01-01' },
        { id: 2, item: 'مجهر إلكتروني', qin: 0, qout: 4, price: 1000, issue: '2024-01-15', to: 'كلية العلوم', permit: 'P-1' },
      ]

      const summary = deriveSummary(rows)
      expect(summary.qty_in).toBe(10)
      expect(summary.qty_out).toBe(4)
      expect(summary.total_value).toBe(10000)
      expect(summary.issued_value).toBe(4000)
      expect(summary.remaining_value).toBe(6000)

      // Value strictly conserved: total === issued + remaining
      expect(summary.issued_value + summary.remaining_value).toBe(summary.total_value)

      // Quality evaluation acknowledges cumulative available stock (10 >= 4)
      const findings = evaluateLedgerQuality(rows)
      const overFindings = findings.flatMap((f) => f.findings).filter((f) => f.rule === 'over')
      expect(overFindings.length).toBe(0)
    })

    it('correctly flags over-disbursement when issued quantity exceeds cumulative stock', () => {
      const rows = [
        { id: 1, item: 'كرسي متحرك', qin: 5, qout: 0, price: 500, date: '2024-01-01' },
        { id: 2, item: 'كرسي متحرك', qin: 0, qout: 8, price: 500, issue: '2024-01-10', to: 'المستشفى', permit: 'P-2' },
      ]

      const findings = evaluateLedgerQuality(rows)
      const overFindings = findings.flatMap((f) => f.findings).filter((f) => f.rule === 'over')
      expect(overFindings.length).toBe(1)
      expect(overFindings[0].message).toContain('exceeds available warehouse stock')
    })
  })
})
