import { describe, expect, it } from 'vitest'
import {
  canAccessRoute,
  canAddDepartment,
  canPageAction,
  canReadDepartment,
  canViewTab,
  canViewPage,
  getAccessMatrix,
  getDashboardScope,
  sanitizeAccessMatrix,
} from '../../src/lib/permissions'

const session = (role: string, access?: unknown) =>
  ({ user: { id: `u-${role}`, app_metadata: { role, ...(access ? { access } : {}) } } }) as never

const matrix = {
  v: 1,
  pages: {
    custody: { view: true, create: true, update: false, delete: false, tabs: ['items'] },
    reports: { view: true },
    purchases: { view: false, create: true, update: true, delete: true },
  },
}

describe('per-user access matrix', () => {
  it('sanitizes unknown keys, non-booleans and actions without view', () => {
    const clean = sanitizeAccessMatrix({
      pages: { custody: { view: 'yes', create: true }, users: { view: true }, purchases: { view: true, delete: true, tabs: ['add', 'hack'] } },
    })!
    expect(clean.pages.users).toBeUndefined()
    expect(clean.pages.custody).toMatchObject({ view: false, create: false })
    expect(clean.pages.purchases.tabs).toEqual(['add'])
    expect(sanitizeAccessMatrix('x')).toBeNull()
  })

  it('without a matrix the role defaults are unchanged', () => {
    const s = session('warehouse_employee')
    expect(getAccessMatrix(s)).toBeNull()
    expect(canAccessRoute(s, '/custody')).toBe(true)
    expect(canAccessRoute(s, '/purchases')).toBe(false)
    expect(canPageAction(s, 'custody', 'delete')).toBe(false)
  })

  it('a matrix is authoritative and the role is only a title', () => {
    const s = session('procurement_employee', matrix)
    expect(canAccessRoute(s, '/custody')).toBe(true)
    expect(canAccessRoute(s, '/purchases')).toBe(false) // view=false hides the page even with create/update/delete
    expect(canPageAction(s, 'purchases', 'update')).toBe(false)
    expect(canPageAction(s, 'custody', 'create')).toBe(true)
    expect(canPageAction(s, 'custody', 'update')).toBe(false)
    expect(canAddDepartment(s, 'warehouse')).toBe(true)
    expect(canAddDepartment(s, 'procurement')).toBe(false)
    expect(canReadDepartment(s, 'procurement')).toBe(false)
    expect(canViewPage(s, 'custody')).toBe(true)
    expect(canViewPage(s, 'suppliers')).toBe(false)
  })

  it('tabs: listed tabs only; no list means all; hidden page hides all', () => {
    const s = session('warehouse_employee', matrix)
    expect(canViewTab(s, 'custody', 'items')).toBe(true)
    expect(canViewTab(s, 'custody', 'disbursements')).toBe(false)
    expect(canViewTab(session('warehouse_employee'), 'custody', 'disbursements')).toBe(true)
    expect(canViewTab(s, 'purchases', 'list')).toBe(false)
  })

  it('admin-only pages are never granted by a matrix, and /new /edit follow create/update', () => {
    const s = session('warehouse_employee', { v: 1, pages: { custody: { view: true, create: true, update: true, delete: false } } })
    expect(canAccessRoute(s, '/users')).toBe(false)
    expect(canAccessRoute(s, '/audit')).toBe(false)
    expect(canAccessRoute(s, '/settings')).toBe(false)
    expect(canAccessRoute(s, '/custody/new')).toBe(true)
    expect(canAccessRoute(s, '/custody/edit')).toBe(true)
    expect(canAccessRoute(s, '/custody/delete')).toBe(false)
    expect(canAccessRoute(s, '/')).toBe(true)
  })

  it('system_admin ignores the matrix and dashboard scope follows visible pages', () => {
    const admin = session('system_admin', { v: 1, pages: {} })
    expect(canAccessRoute(admin, '/users')).toBe(true)
    expect(canPageAction(admin, 'purchases', 'delete')).toBe(true)
    expect(getDashboardScope(session('warehouse_employee', matrix))).toBe('warehouse_only')
    expect(getDashboardScope(session('warehouse_employee', { v: 1, pages: { purchases: { view: true } } }))).toBe('purchases_only')
  })
})
