/**
 * Shared security & sanitization utilities for ZNU Warehouse Ledger frontend.
 */

const FORMULA_TRIGGER_RE = /^[\s]*[=+\-@\t\r]/
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/

/**
 * Neutralizes spreadsheet CSV/XLSX formula injection (=, +, -, @, leading tab/CR/whitespace)
 * while preserving numeric values and plain primitives cleanly.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (!str) return ''
  if (FORMULA_TRIGGER_RE.test(str)) {
    return `'${str}`
  }
  return str
}

/**
 * Strict HTML entity escaping for dynamic text rendered into printable/HTML contexts.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Validates that an internal SPA route begins with a safe single slash path (no protocol-relative `//`, no `\`, no control chars).
 */
export function isSafeInternalRoute(route: unknown): route is string {
  if (typeof route !== 'string') return false
  const trimmed = route.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) return false
  if (CONTROL_CHARS_RE.test(trimmed)) return false
  return true
}

/**
 * Validates that an external URL uses an explicit safe protocol (`https:`, or `http:` only in localhost dev, plus optional `mailto:`/`tel:`).
 */
export function isSafeExternalUrl(
  url: unknown,
  options: { allowMailtoAndTel?: boolean; allowHttpLocalhost?: boolean } = {}
): url is string {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return false
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:') return true
    if (
      options.allowHttpLocalhost !== false &&
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true
    }
    if (options.allowMailtoAndTel && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Validates safe image sources (https:, local relative /assets paths, or base64 raster data URIs PNG/JPEG/WEBP).
 * Strictly rejects `image/svg+xml`, `javascript:`, `vbscript:`, and raw HTML payloads.
 */
export function isSafeImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return !trimmed.toLowerCase().endsWith('.svg')
  }
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true
  }
  return isSafeExternalUrl(trimmed, { allowHttpLocalhost: true })
}

/**
 * Opens verified safe external URLs or internal routes in a hardened window context (`noopener,noreferrer`).
 */
export function safeWindowOpen(url: string, target = '_blank'): Window | null {
  if (!isSafeExternalUrl(url, { allowHttpLocalhost: true }) && !isSafeInternalRoute(url)) {
    return null
  }
  const win = window.open(url, target, 'noopener,noreferrer')
  if (win) {
    win.opener = null
  }
  return win
}

/**
 * Masks raw PostgREST / internal technical errors into safe localized messages for UI toast/alerts.
 */
export function toSafeUserErrorMessage(error: unknown, fallback = 'تعذر إتمام العملية حالياً. يُرجى المحاولة لاحقاً.'): string {
  if (!error) return fallback
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  if (lower.includes('jwt') || lower.includes('unauthorized') || lower.includes('permission') || lower.includes('rls')) {
    return 'غير مصرح لك بتنفيذ هذا الإجراء أو انتهت الجلسة.'
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout')) {
    return 'تعذر الاتصال بالخادم حالياً. يُرجى التحقق من الشبكة.'
  }
  if (lower.includes('duplicate') || lower.includes('unique')) {
    return 'البيانات المدخلة مسجلة بالفعل ولا يمكن تكرارها.'
  }
  return fallback
}

