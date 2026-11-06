import { supabase } from './supabase'

export interface ExtractedTokens {
  access_token: string
  refresh_token: string
  type?: string
}

/**
 * Extracts auth tokens from the URL hash or query string.
 * Supports:
 * - Standard Supabase hash: #access_token=...&refresh_token=...
 * - Double hash: #type=recovery#access_token=...&refresh_token=...
 * - Query params: ?access_token=...&refresh_token=...
 */
export function extractAuthTokensFromUrl(): ExtractedTokens | null {
  if (typeof window === 'undefined') return null

  const hash = window.location.hash || ''
  const search = window.location.search || ''

  let tokenString = ''

  if (hash.includes('access_token=')) {
    // If double hash exists, split and find the chunk with access_token
    const parts = hash.split('#').filter(Boolean)
    const tokenPart = parts.find((p) => p.includes('access_token=')) || parts[parts.length - 1] || ''
    tokenString = tokenPart
  } else if (search.includes('access_token=')) {
    tokenString = search.replace(/^\?/, '')
  }

  if (!tokenString) return null

  try {
    const params = new URLSearchParams(tokenString)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    const type = params.get('type') || undefined

    if (access_token && refresh_token) {
      // Strip tokens from browser address bar immediately to prevent Referer leakage (CWE-598)
      stripAuthTokensFromUrl()
      return { access_token, refresh_token, type }
    }
  } catch {
    // ignore parsing errors
  }

  return null
}

/**
 * Strips access_token and refresh_token from the browser address bar
 * to prevent token leakage via Referer headers, browser history, or logs (CWE-598).
 */
export function stripAuthTokensFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  try {
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    let cleanSearch = search
    if (search.includes('access_token=')) {
      const sp = new URLSearchParams(search)
      sp.delete('access_token')
      sp.delete('refresh_token')
      cleanSearch = sp.toString() ? `?${sp.toString()}` : ''
    }
    let cleanHash = ''
    if (hash && !hash.includes('access_token=')) {
      cleanHash = hash
    }
    const cleanUrl = window.location.pathname + cleanSearch + cleanHash
    window.history.replaceState(null, '', cleanUrl)
  } catch {
    // ignore
  }
}

/**
 * Ensures an active Supabase session exists, recovering it from URL tokens if needed.
 */
export async function ensureActiveAuthSession(): Promise<boolean> {
  if (!supabase) return false

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData?.session) {
      return true
    }

    const tokens = extractAuthTokensFromUrl()
    if (tokens?.access_token && tokens?.refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      })
      if (!error && data?.session) {
        return true
      }
    }
  } catch {
    // ignore errors
  }

  return false
}

