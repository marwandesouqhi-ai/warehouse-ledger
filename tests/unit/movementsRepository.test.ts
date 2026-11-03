import { describe, expect, it, vi } from 'vitest'
import type { FixtureMovement } from '../../src/lib/fixture'

// Mock supabase module
vi.mock('../../src/lib/supabase', () => {
    return {
        supabase: null,
    }
})

import { deleteMovement, updateMovement } from '../../src/lib/movementsRepository'

describe('movementsRepository update and delete fallback tests', () => {
    const sampleMovement: FixtureMovement = {
        id: 'mock-uuid-1',
        date: '2026-10-10',
        inv: 'INV-100',
        from: 'شركة النور',
        to: 'المستودع الرئيسي',
        permit: 'P-1',
        issue: '2026-10-10',
        item: 'شاشات عرض',
        price: 5000,
        qin: 10,
        qout: 2,
        notes: 'ملاحظة تجريبية',
    }

    it('does not falsely report success for an edit without a recorded inventory effect', async () => {
        localStorage.clear()
        localStorage.setItem('warehouse-ledger-movements', JSON.stringify([sampleMovement]))
        await expect(updateMovement(sampleMovement, 'owner-123')).rejects.toThrow(/حركة قديمة/)
        expect(JSON.parse(localStorage.getItem('warehouse-ledger-movements')!)).toEqual([sampleMovement])
    })
    it('rejects cancellation of an unknown movement without removing data', async () => {
        localStorage.clear()
        await expect(deleteMovement('missing', 'owner-123')).rejects.toThrow(/غير موجودة/)
    })
})
