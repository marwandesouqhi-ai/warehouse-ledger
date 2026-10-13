import { describe, it, expect } from 'vitest'
import { normalizeSearchText, matchesSearch } from '../../src/lib/searchUtils'

describe('Universal Arabic Search Normalization', () => {
    it('normalizes alef variants (أ, إ, آ, ٱ -> ا)', () => {
        expect(normalizeSearchText('أجهزة')).toBe('اجهزه')
        expect(normalizeSearchText('إذن')).toBe('اذن')
        expect(normalizeSearchText('آلات')).toBe('الات')
        expect(normalizeSearchText('اجهزة')).toBe('اجهزه')
    })

    it('normalizes teh marbuta (ة -> ه)', () => {
        expect(normalizeSearchText('مكتبة')).toBe('مكتبه')
        expect(normalizeSearchText('جامعة')).toBe('جامعه')
    })

    it('normalizes alef maksura (ى -> ي)', () => {
        expect(normalizeSearchText('مستشفى')).toBe('مستشفي')
        expect(normalizeSearchText('بشرى')).toBe('بشري')
    })

    it('strips tashkeel / diacritics', () => {
        expect(normalizeSearchText('مَخْزَنٌ')).toBe('مخزن')
        expect(normalizeSearchText('شِرْكَةٌ')).toBe('شركه')
    })

    it('matches search with Arabic variations', () => {
        // Query has no hamza, target has hamza
        expect(matchesSearch(['أجهزة كمبيوتر محمول'], 'اجهزة')).toBe(true)
        // Query has alef maksura, target has yeh
        expect(matchesSearch(['كلية الطب البشري'], 'بشرى')).toBe(true)
        // Query has heh, target has teh marbuta
        expect(matchesSearch(['مكتبة الجامعة المركزية'], 'مكتبه')).toBe(true)
        // Multi-word search in any order
        expect(matchesSearch(['مخزن كلية طب بشري', 'INV-2026'], 'بشري 2026')).toBe(true)
    })

    it('handles null, undefined and numbers safely', () => {
        expect(matchesSearch([null, undefined, 12500, 'صنف'], '12500')).toBe(true)
        expect(matchesSearch([null, undefined], 'test')).toBe(false)
        expect(matchesSearch(['صنف تجريبي'], '')).toBe(true)
    })
})
