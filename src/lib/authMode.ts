/**
 * src/lib/authMode.ts
 *
 * Feature flag and utilities for dual-mode auth:
 * - 'legacy': Local storage authentication with cloud fallback (default)
 * - 'secure': Supabase Auth with synthetic emails, app_metadata permissions, and secure sessions
 */

export type AuthMode = 'legacy' | 'secure'

/**
 * Returns current auth mode.
 * Supabase Auth is the unified, authoritative authentication mechanism for the application.
 * Insecure local authentication and local mock fallback have been strictly eliminated.
 */
export function getAuthMode(): 'secure' {
  return 'secure'
}

export function isAuthSecureMode(): boolean {
  return true
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
