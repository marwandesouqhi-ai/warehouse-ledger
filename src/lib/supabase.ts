import { createClient, type Session, type User } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Invalidate legacy permanent tokens from localStorage so authentication is strictly session-based
if (typeof window !== 'undefined') {
    try {
        const legacyKeys: string[] = []
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i)
            if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
                legacyKeys.push(key)
            }
        }
        legacyKeys.forEach((key) => window.localStorage.removeItem(key))
    } catch {
        // ignore storage errors
    }
}

export const supabase = supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: {
            storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
            persistSession: true,
            autoRefreshToken: true,
        },
    })
    : null

/**
 * Check if the given session or user has System Admin privileges.
 * ⚠️ SECURITY HARDENED: Checks strictly signed app_metadata and trusted identities.
 * Never trusts user_metadata which can be forged via supabase.auth.updateUser.
 */
export function checkIsSystemAdmin(sessionOrUser: Session | User | null | undefined): boolean {
    if (!sessionOrUser) return false
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return false

    const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata) || {}
    const appRole = String(appMeta.role || '')
    const isSysAdminFlag = appMeta.system_admin === true

    return appRole === 'system_admin' || isSysAdminFlag
}

export type AppRole = 'admin' | 'editor' | 'viewer'

export function getUserRole(sessionOrUser: Session | User | null | undefined): AppRole {
    if (!sessionOrUser) return 'viewer'
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return 'viewer'

    if (checkIsSystemAdmin(user)) return 'admin'

    const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata) || {}
    const role = (appMeta.role || 'viewer') as string

    if (role === 'admin' || role === 'warehouse_admin' || role === 'procurement_admin') return 'admin'
    if (
        role === 'editor' ||
        role === 'warehouse_staff' ||
        role === 'purchasing_staff' ||
        role === 'warehouse_employee' ||
        role === 'procurement_employee'
    ) {
        return 'editor'
    }
    return 'viewer'
}

export function canEditInventory(sessionOrUser: Session | User | null | undefined): boolean {
    if (!sessionOrUser) return false
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return false
    if (checkIsSystemAdmin(user)) return true

    const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata) || {}
    const role = (appMeta.role || '') as string
    return [
        'admin',
        'editor',
        'warehouse_admin',
        'warehouse_employee',
        'procurement_admin',
        'procurement_employee',
        'warehouse_staff',
        'purchasing_staff',
    ].includes(role)
}

