/**
 * src/lib/dateUtils.ts
 *
 * Shared date formatting utilities grounded in Cairo timezone (Africa/Cairo, UTC+2/UTC+3).
 * Prevents off-by-one date errors caused by UTC toISOString() slicing in Egypt/local time.
 */

const CAIRO_TIMEZONE = 'Africa/Cairo'

const cairoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Returns today's date formatted as YYYY-MM-DD in Africa/Cairo timezone.
 */
export function getCairoDateString(date: Date = new Date()): string {
  try {
    return cairoDateFormatter.format(date)
  } catch {
    // Graceful fallback for non-standard environments
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

/**
 * Format a date string (ISO or date-only) for display in Egyptian Arabic locale.
 */
export function formatCairoDateDisplay(dateInput?: string | null): string {
  if (!dateInput) return '—'
  try {
    const d = new Date(dateInput)
    if (isNaN(d.getTime())) return String(dateInput)
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: CAIRO_TIMEZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d)
  } catch {
    return String(dateInput)
  }
}

/**
 * Normalizes and parses any date string (ISO, YYYY-MM-DD, DD/MM/YYYY, Arabic digits)
 * into a reliable numeric timestamp for accurate sorting.
 */
export function parseDateToTimestamp(raw?: string | null): number {
  if (!raw) return 0
  let str = String(raw).trim()
  if (!str) return 0

  // Normalize Eastern Arabic numerals (٠-٩) to standard ASCII (0-9)
  str = str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmyMatch) {
    const day = Number(dmyMatch[1])
    const month = Number(dmyMatch[2]) - 1
    const year = Number(dmyMatch[3])
    const d = new Date(year, month, day)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  }

  // Match YYYY/MM/DD or YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (ymdMatch) {
    const year = Number(ymdMatch[1])
    const month = Number(ymdMatch[2]) - 1
    const day = Number(ymdMatch[3])
    const d = new Date(year, month, day)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  }

  const parsed = Date.parse(str)
  return isNaN(parsed) ? 0 : parsed
}
