// Lightweight client error reporting: unexpected runtime errors are written to the existing audit log
// (event_type = "client_error", severity = "warning") so they show up in the audit page and the 6-hourly security report.
// Severity is deliberately not "critical" so these never trigger instant Telegram alerts.
import { logAuditEvent } from './auditLogger'

const MAX_REPORTS_PER_MINUTE = 5
const DEDUPE_WINDOW_MS = 5 * 60_000

// Errors that are environmental or harmless and would only add noise.
const IGNORED = [
  /ResizeObserver loop/i,
  /Failed to execute 'writeText' on 'Clipboard'/i,
  /NotAllowedError/i,
  /AbortError/i,
  /Loading chunk .* failed/i,
  /Importing a module script failed/i,
  /Failed to fetch dynamically imported module/i,
  /Script error\.?$/i,
]

const recent = new Map<string, number>()
let windowStart = 0
let countInWindow = 0

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function reportClientError(error: unknown, context: { source: string; componentStack?: string } = { source: 'unknown' }): void {
  try {
    const message = messageOf(error).slice(0, 300)
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return

    const now = Date.now()
    if (now - windowStart > 60_000) {
      windowStart = now
      countInWindow = 0
    }
    if (countInWindow >= MAX_REPORTS_PER_MINUTE) return

    const key = `${context.source}:${message}`
    const last = recent.get(key) ?? 0
    if (now - last < DEDUPE_WINDOW_MS) return
    recent.set(key, now)
    countInWindow += 1

    const stack = error instanceof Error ? (error.stack || '').split('\n').slice(0, 6).join('\n') : ''
    void logAuditEvent({
      action: `خطأ غير متوقع في الواجهة: ${message.slice(0, 120)}`,
      entity_type: 'client_error',
      entity_id: typeof location !== 'undefined' ? location.pathname : '',
      event_type: 'client_error',
      severity: 'warning',
      details: {
        source: context.source,
        message,
        stack,
        componentStack: context.componentStack?.split('\n').slice(0, 6).join('\n'),
        path: typeof location !== 'undefined' ? location.pathname : '',
        appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
      },
    }).catch(() => undefined)
  } catch {
    // reporting must never throw
  }
}

let installed = false

export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => {
    reportClientError(event.error ?? event.message, { source: 'window.onerror' })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, { source: 'unhandledrejection' })
  })
}
