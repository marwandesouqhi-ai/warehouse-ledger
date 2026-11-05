import { describe, it, expect } from 'vitest'
import { getCairoDateString, formatCairoDateDisplay } from '../../src/lib/dateUtils'

describe('Cairo Date Utils', () => {
  it('formats dates in Africa/Cairo timezone without UTC midnight offset', () => {
    // 2026-11-04 at 23:30 UTC is 2026-11-05 at 01:30 AM in Cairo (UTC+2)
    const lateNightUtc = new Date('2026-11-04T23:30:00Z')
    expect(getCairoDateString(lateNightUtc)).toBe('2026-11-05')
  })

  it('formats display date in Arabic locale', () => {
    const formatted = formatCairoDateDisplay('2026-11-05')
    expect(formatted).toBeTruthy()
    expect(formatted).not.toBe('—')
  })

  it('handles null and undefined gracefully', () => {
    expect(formatCairoDateDisplay(null)).toBe('—')
    expect(formatCairoDateDisplay(undefined)).toBe('—')
  })
})
