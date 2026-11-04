import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import WarehouseChatBot from '../../src/components/WarehouseChatBot'

vi.mock('../../src/lib/chatbotLiveContext', () => ({
  getLiveWarehouseContext: vi.fn(),
  queryLiveItemAvailability: vi.fn(),
  queryLiveWarehouseBalances: vi.fn(),
}))
vi.mock('../../src/lib/geminiService', () => ({
  hasGeminiApiKey: vi.fn(() => false),
  askGeminiWithContext: vi.fn(),
}))
vi.mock('../../src/lib/dataQualityAutoRepair', () => ({
  getQualityIssuesSummary: vi.fn(() => ({ total: 0 })),
  runDataQualityAutoRepair: vi.fn(),
}))

function session(role: string): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: role,
      app_metadata: { role },
      user_metadata: {},
      email: `${role}@example.com`,
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}

function chat(currentSession: Session | null) {
  return <MemoryRouter><WarehouseChatBot session={currentSession} /></MemoryRouter>
}

afterEach(cleanup)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterAll(() => Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'))

describe('WarehouseChatBot session changes', () => {
  it('mounts safely when an admin signs in after an unauthenticated render', () => {
    const { rerender } = render(chat(null))
    expect(screen.queryByRole('button', { name: 'المساعد الذكي للمخازن' })).not.toBeInTheDocument()
    rerender(chat(session('system_admin')))
    expect(screen.getByRole('button', { name: 'المساعد الذكي للمخازن' })).toBeInTheDocument()
  })

  it('removes an open admin conversation when access is lost and starts closed on return', () => {
    const admin = session('system_admin')
    const { rerender } = render(chat(admin))
    fireEvent.click(screen.getByRole('button', { name: 'المساعد الذكي للمخازن' }))
    expect(screen.getByLabelText('نافذة المساعد الذكي')).toBeInTheDocument()
    rerender(chat(session('viewer')))
    expect(screen.queryByLabelText('نافذة المساعد الذكي')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'المساعد الذكي للمخازن' })).not.toBeInTheDocument()
    rerender(chat(admin))
    expect(screen.getByRole('button', { name: 'المساعد الذكي للمخازن' })).toBeInTheDocument()
    expect(screen.queryByLabelText('نافذة المساعد الذكي')).not.toBeInTheDocument()
  })
})
