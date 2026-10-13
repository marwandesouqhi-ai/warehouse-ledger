/**
 * src/lib/authMode.ts
 *
 * Feature flag and utilities for dual-mode auth:
 * - 'legacy': Local storage authentication with cloud fallback (default)
 * - 'secure': Supabase Auth with synthetic emails, app_metadata permissions, and secure sessions
 */

export type AuthMode = 'legacy' | 'secure'

/**
 * Returns current auth mode from environment variable VITE_AUTH_MODE.
 * Defaults strictly to 'legacy' to prevent lockout until explicitly switched.
 */
export function getAuthMode(): AuthMode {
  const mode = import.meta.env.VITE_AUTH_MODE
  return mode === 'secure' ? 'secure' : 'legacy'
}

export function isAuthSecureMode(): boolean {
  return getAuthMode() === 'secure'
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
