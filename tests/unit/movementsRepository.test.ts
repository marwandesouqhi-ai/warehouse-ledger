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

    it('returns movement as-is when supabase client is not connected', async () => {
        const result = await updateMovement(sampleMovement, 'owner-123')
        expect(result).toEqual(sampleMovement)
    })

    it('handles delete without error when supabase is not connected', async () => {
        await expect(deleteMovement('mock-uuid-1', 'owner-123')).resolves.toBeUndefined()
    })
})
