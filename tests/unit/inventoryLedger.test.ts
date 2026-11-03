import { describe, expect, it } from 'vitest'
import { deriveLedger, deriveSummary } from '../../src/lib/derive'
import { summarizeQuality } from '../../src/lib/quality'

describe('item/warehouse ledger valuation', () => {
  it('reduces remaining value for a separate valid outward row without a false over-issue', () => {
    const rows = [{ id: 'in', item: 'حاسوب', date: '2026-01-01', qin: 10, qout: 0, price: 100, inv: 'I' },
      { id: 'out', item: 'حاسوب', date: '2026-01-02', qin: 0, qout: 2, price: 0, to: 'جهة خارجية', permit: 'P' }]
    expect(deriveSummary(rows)).toMatchObject({ remaining_value: 800, issued_value: 200, stock_units: 8 })
    expect(summarizeQuality(rows).over).toBe(0)
    expect(deriveLedger(rows).rows[0]).toMatchObject({ rem: 8, status: 'part' })
  })
  it('conserves global stock and value on a transfer, while isolating warehouse availability', () => {
    const rows = [{ id: 'in', item: 'حاسوب', date: '2026-01-01', qin: 10, qout: 0, price: 100 },
      { id: 'out', item: 'حاسوب', date: '2026-01-02', qin: 0, qout: 2, price: 100, sourceWarehouseId: 'main', destWarehouseId: 'fci' },
      { id: 'invalid', item: 'حاسوب', date: '2026-01-03', qin: '', qout: 3, price: 100, sourceWarehouseId: 'fci', destWarehouseId: 'engineering' }]
    expect(deriveSummary(rows.slice(0, 2))).toMatchObject({ remaining_value: 1000, stock_units: 10 })
    expect(summarizeQuality(rows).over).toBe(1)
    expect(deriveLedger(rows).rows[2].available_before).toBe(2)
  })
  it('uses weighted stock cost across separate purchases, and ignores soft-deleted movements', () => {
    const rows = [{ item: 'A', qin: 5, qout: 0, price: 10 }, { item: 'A', qin: 5, qout: 0, price: 20 }, { item: 'A', qin: 0, qout: 2, price: 999 }, { item: 'A', qin: 100, qout: 0, price: 1, deletedAt: '2026-11-03' }]
    expect(deriveSummary(rows)).toMatchObject({ total_value: 150, remaining_value: 120, issued_value: 30, stock_units: 8, rows: 3 })
  })

  it('validates recorded opening stock without inventing purchase receipts', () => {
    const rows = [{ id: 'out', item: 'A', qin: 0, qout: 2, price: 10, sourceItemId: 'source', sourceQuantityBefore: 5, sourceValueBefore: 50, inventoryEffects: [{ itemId: 'source', quantity: -2, value: -20 }] }]
    expect(summarizeQuality(rows).over).toBe(0)
    expect(deriveSummary(rows)).toMatchObject({ remaining_value: 30, stock_units: 3, issued_value: 20 })
  })

})
