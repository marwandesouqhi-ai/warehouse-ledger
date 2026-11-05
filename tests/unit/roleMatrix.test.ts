import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { can, canAccessRoute, canAddDepartment, canReadDepartment, canModifyRecords, canPrintOrExport } from '../../src/lib/permissions'
import { accessScopedFetch, assertDepartmentWrite, prepareAccessContext } from '../../src/lib/accessContext'

const session = (role: string, id = 'one') => ({ user: {
  id, app_metadata: { role, permissions: ['manage_records', 'view_settings', 'view_audit'] },
} }) as unknown as Session

const matrix = [
  ['system_admin', true, true, true, true, true],
  ['admin', true, true, false, false, false],
  ['warehouse_admin', true, false, false, false, false],
  ['procurement_admin', false, true, false, false, false],
  ['warehouse_employee', true, false, true, false, false],
  ['procurement_employee', false, true, false, true, false],
  ['warehouse_staff', true, false, true, false, false],
  ['editor', true, false, true, false, false],
  ['purchasing_staff', false, true, false, true, false],
] as const

describe('requested read-only administrator / add-only employee matrix', () => {
  beforeEach(() => { localStorage.clear(); prepareAccessContext(null) })
  for (const [role, readWh, readPc, addWh, addPc, modify] of matrix) {
    it(`${role}: scopes, exports, operations and system pages`, () => {
      const user = session(role)
      expect(canReadDepartment(user, 'warehouse')).toBe(readWh)
      expect(canReadDepartment(user, 'procurement')).toBe(readPc)
      expect(canPrintOrExport(user, 'warehouse')).toBe(readWh)
      expect(canPrintOrExport(user, 'procurement')).toBe(readPc)
      expect(canAddDepartment(user, 'warehouse')).toBe(addWh)
      expect(canAddDepartment(user, 'procurement')).toBe(addPc)
      expect(canModifyRecords(user)).toBe(modify)
      expect(can(user, 'manage_records')).toBe(modify)
      for (const path of ['/users', '/audit', '/settings', '/telegram-bot', '/chatbot-admin']) {
        expect(canAccessRoute(user, path)).toBe(role === 'system_admin')
      }
      expect(canAccessRoute(user, '/purchases/requests/new')).toBe(addPc)
      expect(canAccessRoute(user, '/purchases/edit/known-id')).toBe(modify)
      expect(canAccessRoute(user, '/custody?warehouse=central_lab')).toBe(readWh)
    })
  }
  it('rejects unauthenticated and unknown routes', () => {
    expect(canAccessRoute(null, '/purchases')).toBe(false)
    expect(canAccessRoute(session('admin'), '/undefined-business-route')).toBe(false)
  })
  it('checks permission before an offline/local mutation', () => {
    prepareAccessContext(session('admin'))
    expect(() => assertDepartmentWrite('procurement', 'create')).toThrow()
    prepareAccessContext(session('warehouse_employee'))
    expect(() => assertDepartmentWrite('warehouse', 'create')).not.toThrow()
    expect(() => assertDepartmentWrite('procurement', 'create')).toThrow()
    expect(() => assertDepartmentWrite('warehouse', 'update')).toThrow()
    expect(() => assertDepartmentWrite('warehouse', 'delete')).toThrow()
  })
  it('does not reuse notifications, user lists or business data after account/role changes', () => {
    prepareAccessContext(session('system_admin'))
    for (const key of ['app_notifications_local', 'warehouse-ledger-local-users', 'warehouse-ledger-movements', 'supplier_contracts_local']) {
      localStorage.setItem(key, '[{"private":true}]')
    }
    prepareAccessContext(session('warehouse_employee', 'two'))
    for (const key of ['app_notifications_local', 'warehouse-ledger-local-users', 'warehouse-ledger-movements', 'supplier_contracts_local']) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })
  it('discards an in-flight response from the previous account before a repository can cache it', async () => {
    prepareAccessContext(session('system_admin'))
    let finish!: (response: Response) => void
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    try {
      const pending = accessScopedFetch('https://project.invalid/rest/v1/suppliers')
      prepareAccessContext(session('warehouse_employee', 'two'))
      finish(new Response(JSON.stringify([{ private: true }])))
      const response = await pending
      expect(response.status).toBe(409)
      expect(await response.text()).not.toContain('private')
    } finally { globalThis.fetch = originalFetch }
  })
})
