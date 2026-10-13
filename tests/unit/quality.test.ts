import { describe, expect, it } from 'vitest'

import originalData from '../../fixtures/original-data.json'
import { summarizeQuality } from '../../src/lib/quality'

describe('quality checks', () => {
    it('scores the fixture on the expected quality rules', () => {
        const counts = summarizeQuality(originalData as Array<Record<string, unknown>>)
        expect(counts.future).toBeGreaterThan(0)
        expect(counts.order).toBeGreaterThan(0)
        expect(counts.noinv).toBeGreaterThan(0)
        expect(counts.ptext).toBeGreaterThan(0)
    })
})
