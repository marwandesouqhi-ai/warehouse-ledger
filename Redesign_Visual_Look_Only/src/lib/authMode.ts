/**
 * src/lib/authMode.ts
 *
 * Feature flag and utilities for dual-mode auth:
 * - 'transitional': Supabase Auth with backend login-bridge for migrating directory users (default)
 * - 'secure': Supabase Auth direct sign-in only; login-bridge disabled
 *
 * NOTE: The old client-side local 'legacy' mode was intentionally decommissioned.
 * Real operational rollback = redeploying the version tagged 'pre-security-backup' on Vercel.
 */

export type AuthMode = 'transitional' | 'secure'

/**
 * Returns current auth mode configured in VITE_AUTH_MODE.
 * Defaults to 'transitional' to ensure zero lockout during transition.
 */
export function getAuthMode(): AuthMode {
  const mode = import.meta.env.VITE_AUTH_MODE
  if (mode === 'secure') {
    return 'secure'
  }
  return 'transitional'
}

export function isAuthSecureMode(): boolean {
  return getAuthMode() === 'secure'
}

export function isAuthTransitionalMode(): boolean {
  return getAuthMode() === 'transitional'
}

/**
 * Checks whether Supabase connection parameters are configured.
 */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  return Boolean(url && key && String(url).startsWith('http') && String(key).length > 10)
}

/**
 * Converts a username to a deterministic Supabase Auth synthetic email.
 * Example: 'marwan-desouky' -> 'marwan-desouky@warehouse.local'
 */
export function toSyntheticEmail(username: string): string {
  const clean = (username || '').trim().toLowerCase()
  if (clean.includes('@')) return clean
  return `${clean}@warehouse.local`
}

/**
 * Extracts username from a synthetic email or returns clean string.
 * Example: 'marwan-desouky@warehouse.local' -> 'marwan-desouky'
 */
export function fromSyntheticEmail(emailOrUsername: string): string {
  const clean = (emailOrUsername || '').trim().toLowerCase()
  return clean.replace(/@warehouse\.local$/, '')
}
