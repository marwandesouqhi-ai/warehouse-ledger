import { describe, expect, it } from 'vitest'

import originalData from '../../fixtures/original-data.json'
import { summarizeQuality } from '../../src/lib/quality'

describe('quality checks', () => {
    it('scores the fixture on the expected quality rules', () => {
        // Pass a reference date prior to fixture future date (2026-10-13)
        const counts = summarizeQuality(originalData as Array<Record<string, unknown>>, new Date('2024-01-01'))
        expect(counts.future).toBeGreaterThan(0)
        expect(counts.noinv).toBeGreaterThan(0)
        expect(counts.ptext).toBeGreaterThan(0)
    })
})
