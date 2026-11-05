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
