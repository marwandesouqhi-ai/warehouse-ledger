import { describe, it, expect, beforeEach } from 'vitest'
import { getSavedTheme, applyTheme, THEME_STORAGE_KEY } from '../../src/lib/theme'

describe('Theme Utility Suite', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to light or system theme and reads from storage when present', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(getSavedTheme()).toBe('dark')

    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    expect(getSavedTheme()).toBe('light')
  })

  it('safely applies theme to document and persists to localStorage', () => {
    applyTheme(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    applyTheme(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })
})
