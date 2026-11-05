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
      return { access_token, refresh_token, type }
    }
  } catch {
    // ignore parsing errors
  }

  return null
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

