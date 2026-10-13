import { describe, expect, it } from 'vitest'

import originalData from '../../fixtures/original-data.json'
import { deriveMovement, deriveSummary } from '../../src/lib/derive'

describe('derive summary', () => {
    it('calculates row values from decimal-comma prices', () => {
        const movement = deriveMovement({ item: 'test item', price: '154,2', qin: '70', qout: '2' }, 0)

        expect(movement.total).toBe(10794)
        expect(movement.issued_value).toBeCloseTo(308.4, 10)
        expect(movement.remaining_value).toBeCloseTo(10485.6, 10)
        expect(movement.status).toBe('part')
    })

    it('matches the expected Appendix A totals', () => {
        const summary = deriveSummary(originalData as Array<Record<string, unknown>>)
        expect(summary.rows).toBe(33)
        expect(summary.distinct_items).toBe(32)
        expect(summary.total_value).toBe(3422717.345)
        expect(summary.qty_in).toBe(391)
        expect(summary.qty_out).toBe(361)
        expect(summary.issued_value).toBe(2421167.345)
        expect(summary.remaining_value).toBe(1001550)
        expect(summary.pending_rows).toBe(17)
        expect(summary.status_counts.full).toBe(16)
        expect(summary.status_counts.pending).toBe(17)
    })
})
