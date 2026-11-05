import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockSetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSetSession: vi.fn(),
}))

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      setSession: mockSetSession,
    },
  },
}))

import { extractAuthTokensFromUrl, ensureActiveAuthSession } from '../../src/lib/authSessionUtils'

describe('authSessionUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('extracts tokens from standard hash', () => {
    window.history.pushState({}, '', '/#access_token=token123&refresh_token=refresh456&type=recovery')
    const tokens = extractAuthTokensFromUrl()
    expect(tokens).toEqual({
      access_token: 'token123',
      refresh_token: 'refresh456',
      type: 'recovery',
    })
  })

  it('extracts tokens from double hash created by query redirect', () => {
    window.history.pushState({}, '', '/#type=recovery#access_token=secret_acc&refresh_token=secret_ref&type=recovery')
    const tokens = extractAuthTokensFromUrl()
    expect(tokens).toEqual({
      access_token: 'secret_acc',
      refresh_token: 'secret_ref',
      type: 'recovery',
    })
  })

  it('extracts tokens from search parameters if present', () => {
    window.history.pushState({}, '', '/?access_token=search_acc&refresh_token=search_ref')
    const tokens = extractAuthTokensFromUrl()
    expect(tokens).toEqual({
      access_token: 'search_acc',
      refresh_token: 'search_ref',
      type: undefined,
    })
  })

  it('returns null when tokens are missing', () => {
    window.history.pushState({}, '', '/#type=recovery')
    expect(extractAuthTokensFromUrl()).toBeNull()
  })

  it('ensureActiveAuthSession returns true when session already exists', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'existing' } },
    })
    const hasSession = await ensureActiveAuthSession()
    expect(hasSession).toBe(true)
    expect(mockSetSession).not.toHaveBeenCalled()
  })

  it('ensureActiveAuthSession recovers session from URL if missing from getSession', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    })
    mockSetSession.mockResolvedValue({
      data: { session: { access_token: 'recovered_acc' } },
      error: null,
    })
    window.history.pushState({}, '', '/#access_token=recovered_acc&refresh_token=recovered_ref')

    const hasSession = await ensureActiveAuthSession()
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'recovered_acc',
      refresh_token: 'recovered_ref',
    })
    expect(hasSession).toBe(true)
  })
})
