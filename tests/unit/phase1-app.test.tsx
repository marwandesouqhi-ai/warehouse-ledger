import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'

vi.mock('../../src/lib/supabase', () => ({ supabase: null, checkIsSystemAdmin: () => false }))
vi.mock('../../src/lib/localUsers', () => ({
  getLocalSession: () => ({ user: { id: 'phase1-viewer', email: 'viewer@warehouse.local', app_metadata: { role: 'viewer' }, user_metadata: {} } }),
  clearLocalSession: vi.fn(), purgeDeletedAccount: vi.fn(), syncUsersWithCloud: vi.fn(),
}))
beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('routes an unknown authenticated URL to the Arabic not-found page', () => {
  render(<MemoryRouter initialEntries={['/not-a-page']}><App /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeInTheDocument()
})

it('redirects the old new-movement URL to the canonical purchases add route', async () => {
  render(<MemoryRouter initialEntries={['/movements/new']}><App /></MemoryRouter>)
  // A viewer receives the canonical purchases permission screen, not the legacy movement form.
  expect(await screen.findByText('صفحة المشتريات والتوريدات وفواتير الشراء مقتصرة حصرياً على موظفي المشتريات وإدارة النظام.')).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /حركة وارد/ })).not.toBeInTheDocument()
})
