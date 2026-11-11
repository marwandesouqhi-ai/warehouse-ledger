import type { Session } from '@supabase/supabase-js'
import type { LocalUserSession } from './localUsers'
import { canAddDepartment, canModifyRecords, canReadDepartment, getEffectiveRole, type BusinessDepartment } from './permissions'

let currentSession: Session | LocalUserSession | null = null

/** UI/offline protection only; the database independently enforces every grant. */
export function prepareAccessContext(session: Session | LocalUserSession | null): boolean {
  currentSession = session
  const identity = session ? `${session.user.id}:${getEffectiveRole(session)}` : 'signed-out'
  try {
    const previous = localStorage.getItem('warehouse-access-context-v2')
    if (previous === identity) return false
    localStorage.removeItem('app_notifications_local')
    localStorage.removeItem('znu_telegram_bot_settings')
    // Business caches must not cross account or department boundaries (audit logs and settings are permanently preserved).
    const protectedKeys = /^(warehouse|custody|budget_plans|financial_reports|asset_movements|disbursement|purchase_|supplier_|support_tickets|notifications|znu_(users|local_users|chatbot))/
    for (const key of Object.keys(localStorage)) {
      if (protectedKeys.test(key) && !/settings|theme|dark|auto_backup_schedule|audit/.test(key)) localStorage.removeItem(key)
    }
    localStorage.setItem('warehouse-access-context-v2', identity)
    return true
  } catch {
    return true
  }
}

export function getAccessSession() { return currentSession }
export function getAccessIdentity(): string {
  return currentSession ? `${currentSession.user.id}:${getEffectiveRole(currentSession)}` : 'signed-out'
}

const recentSecurityDenialCache = new Map<string, number>()

/** Discard a response belonging to the previous account, including in-flight cache fills, and surface RLS/API 401/403 denials. */
export async function accessScopedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const identity = getAccessIdentity()
  const response = await globalThis.fetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/\/(rest|functions|storage)\/v1\//.test(url) && identity !== getAccessIdentity()) {
    void response.body?.cancel().catch(() => undefined)
    return new Response(JSON.stringify({ message: 'تغير الحساب؛ أعد تحميل البيانات.', code: 'ACCESS_CONTEXT_CHANGED' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Capture PostgREST RLS (401/403) and Edge API denials when authenticated without causing recursion
  if (
    typeof window !== 'undefined' &&
    currentSession &&
    (response.status === 401 || response.status === 403) &&
    /\/(rest|functions)\/v1\//.test(url) &&
    !/\/(audit_logs|login_attempts|rpc\/record_security_event|functions\/v1\/(login-bridge|admin-users|invite-user|migrate-users))/.test(url)
  ) {
    try {
      const parsedPath = new URL(url, window.location.origin).pathname
      const method = (init?.method || 'GET').toUpperCase()
      const cacheKey = `${method}:${parsedPath}:${response.status}`
      const now = Date.now()
      const lastSent = recentSecurityDenialCache.get(cacheKey) || 0
      if (now - lastSent > 10_000) {
        recentSecurityDenialCache.set(cacheKey, now)
        window.dispatchEvent(
          new CustomEvent('znu-security-api-denial', {
            detail: {
              method,
              path: parsedPath,
              status: response.status,
            },
          })
        )
      }
    } catch {
      // ignore URL parse issues
    }
  }

  return response
}
export function canReadCurrentDepartment(department: BusinessDepartment): boolean {
  return Boolean(currentSession) && canReadDepartment(currentSession, department)
}
export function assertDepartmentWrite(department: BusinessDepartment, operation: 'create' | 'update' | 'delete') {
  const allowed = currentSession && (operation === 'create'
    ? canAddDepartment(currentSession, department) : canModifyRecords(currentSession))
  if (!allowed) throw new Error('لا تملك صلاحية تنفيذ هذه العملية في هذا القسم.')
}
