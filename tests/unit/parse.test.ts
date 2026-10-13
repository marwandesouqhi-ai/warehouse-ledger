import { describe, expect, it } from 'vitest'

import { normalizeHeader, num, parseDate, partyKey } from '../../src/lib/parse'

describe('parse helpers', () => {
    it('converts Arabic digits and decimal commas correctly', () => {
        expect(num('154,2')).toBe(154.2)
        expect(num('1,234')).toBe(1234)
        expect(num('1.234,56')).toBe(1234.56)
        expect(num('')).toBeNull()
    })

    it('parses valid dates in multiple formats', () => {
        expect(parseDate('2022-11-10')?.toISOString()).toContain('2022-11-10')
        expect(parseDate('13/10/2022')?.toISOString()).toContain('2022-10-13')
        expect(parseDate('19/9/2024')?.toISOString()).toContain('2024-09-19')
        expect(parseDate('bad-date')).toBeNull()
    })

    it('normalizes names for matching', () => {
        expect(normalizeHeader('اسم الصنف')).toBe('اسم الصنف')
        expect(partyKey('محمد حسن و')).toBe('محمد حسن')
    })
})
