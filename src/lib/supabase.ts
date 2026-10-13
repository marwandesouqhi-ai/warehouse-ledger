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
 * ⚠️ FIXED: Blanket `role === 'admin'` check removed to prevent non-system admins from gaining system admin privileges.
 */
export function checkIsSystemAdmin(sessionOrUser: Session | User | null | undefined): boolean {
    if (!sessionOrUser) return false
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return false

    const email = (user.email || '').trim().toLowerCase()
    const username = (String(user.user_metadata?.username || '')).trim().toLowerCase()
    const appRole = String(user.app_metadata?.role || '')
    const userRole = String(user.user_metadata?.role || '')
    const isSysAdminFlag = user.app_metadata?.system_admin === true

    return (
        email === 'marwan-desouky' ||
        email === 'admin' ||
        username === 'marwan-desouky' ||
        username === 'admin' ||
        appRole === 'system_admin' ||
        userRole === 'system_admin' ||
        isSysAdminFlag
    )
}

export type AppRole = 'admin' | 'editor' | 'viewer'

export function getUserRole(sessionOrUser: Session | User | null | undefined): AppRole {
    if (!sessionOrUser) return 'viewer'
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return 'viewer'

    if (checkIsSystemAdmin(user)) return 'admin'

    const role = (
        user.app_metadata?.role ||
        user.user_metadata?.role ||
        'viewer'
    ) as string

    if (role === 'admin') return 'admin'
    if (role === 'editor' || role === 'warehouse_staff' || role === 'purchasing_staff') return 'editor'
    return 'viewer'
}

export function canEditInventory(sessionOrUser: Session | User | null | undefined): boolean {
    if (!sessionOrUser) return false
    const user = 'user' in sessionOrUser ? sessionOrUser.user : sessionOrUser
    if (!user) return false
    if (checkIsSystemAdmin(user)) return true
    const role = (user.app_metadata?.role || user.user_metadata?.role || '') as string
    return role === 'admin' || role === 'editor' || role === 'warehouse_staff' || role === 'purchasing_staff'
}

