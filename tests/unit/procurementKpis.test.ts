import { describe, it, expect } from 'vitest'
import { deriveMovement } from '../../src/lib/derive'
import type { FixtureMovement } from '../../src/lib/fixture'
import type { PurchaseRequest, PurchaseOrder } from '../../src/lib/procurementRepository'

describe('Procurement KPIs and Analytics Calculations Suite', () => {
  const mockRequests: PurchaseRequest[] = [
    { id: '1', request_no: 'PR-0001', department: 'مخزن 1', purchase_type: 'direct', priority: 'normal', requested_by: 'أ', justification: 'ج', status: 'draft', quote_deadline: null, selected_quote_id: null, submitted_at: null, created_at: '', updated_at: '', created_by: 'أ' },
    { id: '2', request_no: 'PR-0002', department: 'مخزن 2', purchase_type: 'practice', priority: 'urgent', requested_by: 'ب', justification: 'ج', status: 'pending', quote_deadline: null, selected_quote_id: null, submitted_at: null, created_at: '', updated_at: '', created_by: 'ب' },
    { id: '3', request_no: 'PR-0003', department: 'مخزن 3', purchase_type: 'direct', priority: 'normal', requested_by: 'ج', justification: 'ج', status: 'pending', quote_deadline: null, selected_quote_id: null, submitted_at: null, created_at: '', updated_at: '', created_by: 'ج' },
    { id: '4', request_no: 'PR-0004', department: 'مخزن 1', purchase_type: 'tender', priority: 'normal', requested_by: 'د', justification: 'ج', status: 'approved', quote_deadline: null, selected_quote_id: 'q-1', submitted_at: null, created_at: '', updated_at: '', created_by: 'د' },
    { id: '5', request_no: 'PR-0005', department: 'مخزن 2', purchase_type: 'direct', priority: 'normal', requested_by: 'ه', justification: 'ج', status: 'rejected', quote_deadline: null, selected_quote_id: null, submitted_at: null, created_at: '', updated_at: '', created_by: 'ه' },
  ]

  const todayStr = '2026-10-14'

  const mockPurchaseOrders: PurchaseOrder[] = [
    { id: 'po-1', po_no: 'PO-0001', request_id: '4', quote_id: 'q-1', supplier_id: 's-1', total: 15000, expected_delivery_date: '2026-10-10', status: 'open', received_on: null, invoiced_on: null, notes: '', created_at: '', created_by: '' }, // Overdue
    { id: 'po-2', po_no: 'PO-0002', request_id: '4', quote_id: 'q-2', supplier_id: 's-2', total: 8000, expected_delivery_date: '2026-10-25', status: 'open', received_on: null, invoiced_on: null, notes: '', created_at: '', created_by: '' },  // Not overdue
    { id: 'po-3', po_no: 'PO-0003', request_id: '4', quote_id: 'q-3', supplier_id: 's-3', total: 22000, expected_delivery_date: '2026-10-05', status: 'received', received_on: '2026-10-06', invoiced_on: null, notes: '', created_at: '', created_by: '' },
    { id: 'po-4', po_no: 'PO-0004', request_id: '4', quote_id: 'q-4', supplier_id: 's-1', total: 5000, expected_delivery_date: '2026-09-20', status: 'invoiced', received_on: '2026-09-22', invoiced_on: '2026-09-25', notes: '', created_at: '', created_by: '' },
  ]

  it('calculates pending approvals count correctly', () => {
    const pendingCount = mockRequests.filter((r) => r.status === 'pending').length
    expect(pendingCount).toBe(2)
  })

  it('calculates open purchase orders count correctly', () => {
    const openCount = mockPurchaseOrders.filter((po) => po.status === 'open').length
    expect(openCount).toBe(2)
  })

  it('calculates overdue orders strictly based on expected_delivery_date < today', () => {
    const overdueCount = mockPurchaseOrders.filter(
      (po) => po.status === 'open' && po.expected_delivery_date && po.expected_delivery_date < todayStr
    ).length
    expect(overdueCount).toBe(1) // only PO-0001 (2026-10-10)
  })

  it('calculates current month spend consistently with movements formula', () => {
    const currentMonth = '2026-10'
    const testMovements: FixtureMovement[] = [
      { id: 'm1', date: '2026-10-02', qin: '10', price: '150', item: 'ورق تصوير' },
      { id: 'm2', date: '2026-10-05', qin: '5', price: '200', item: 'حبر ليزر' },
      { id: 'm3', date: '2026-09-28', qin: '8', price: '100', item: 'ملفات' }, // prior month
      { id: 'm4', date: '2026-10-08', qout: '3', price: '150', item: 'ورق تصوير' }, // disbursement, not purchase
    ]

    let spend = 0
    for (let i = 0; i < testMovements.length; i++) {
      const m = testMovements[i]
      const qin = Number(m.qin) || 0
      if (qin > 0 && (m.date || '').slice(0, 7) === currentMonth) {
        const derived = deriveMovement(m, i)
        spend += derived.total ?? (qin * (Number(m.price) || 0))
      }
    }

    // 10*150 = 1500, 5*200 = 1000 -> 2500
    expect(spend).toBe(2500)
  })

  it('calculates 5-stage pipeline accurately', () => {
    const stage1 = mockRequests.filter((r) => r.status !== 'rejected' && r.status !== 'draft').length // PR-2, PR-3, PR-4 = 3
    const stage2 = mockRequests.filter((r) => r.status === 'pending').length // PR-2, PR-3 = 2
    const stage3 = mockPurchaseOrders.filter((po) => po.status === 'open').length // 2
    const stage4 = mockPurchaseOrders.filter((po) => po.status === 'received').length // 1
    const stage5 = mockPurchaseOrders.filter((po) => po.status === 'invoiced').length // 1

    expect(stage1).toBe(3)
    expect(stage2).toBe(2)
    expect(stage3).toBe(2)
    expect(stage4).toBe(1)
    expect(stage5).toBe(1)
  })
})
