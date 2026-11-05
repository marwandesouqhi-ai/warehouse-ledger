/**
 * src/lib/theme.ts
 *
 * Single guarded storage utility for theme (dark/light mode) with in-memory fallback.
 * Prevents localStorage crashes (security exceptions, private browsing quotas)
 * and centralizes DOM attribute synchronization.
 */

export const THEME_STORAGE_KEY = 'warehouse-ledger-theme'

let inMemoryTheme: 'dark' | 'light' = 'light'

/**
 * Loads the current theme from storage, falling back to system preference or in-memory state.
 */
export function getSavedTheme(): 'dark' | 'light' {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'dark' || stored === 'light') {
        inMemoryTheme = stored
        return stored
      }
      // Check system preference if no theme saved yet
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
    }
  } catch {
    // localStorage restricted or disabled
  }
  return inMemoryTheme
}

/**
 * Applies and persists the theme attribute on the document element.
 */
export function applyTheme(isDark: boolean): void {
  const theme = isDark ? 'dark' : 'light'
  inMemoryTheme = theme

  try {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  } catch {
    // ignore
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  } catch {
    // in-memory fallback active
  }
}
