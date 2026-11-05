import { describe, it, expect } from 'vitest'
import { canAccessRoute, canAccessProcurementModule, type EffectiveRole } from '../../src/lib/permissions'
import type { Session } from '@supabase/supabase-js'

function makeMockSession(role: EffectiveRole, permissions: string[] = []): Session {
  return {
    user: {
      id: 'mock-user-id',
      email: `${role}@warehouse.local`,
      app_metadata: {
        role,
        permissions,
        system_admin: role === 'system_admin',
      },
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  } as unknown as Session
}

describe('Procurement Module Permissions & Routing Matrix', () => {
  const procurementRoutes = [
    '/purchases/requests',
    '/purchases/requests/new',
    '/purchases/suppliers',
    '/purchases/quotes',
    '/purchases/analytics',
  ]

  it('allows system_admin to access all 5 procurement sub-routes', () => {
    const session = makeMockSession('system_admin')
    expect(canAccessProcurementModule(session)).toBe(true)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(session, route)).toBe(true)
    }
  })

  it('allows admin to access all 5 procurement sub-routes', () => {
    const session = makeMockSession('admin')
    expect(canAccessProcurementModule(session)).toBe(true)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(session, route)).toBe(!route.endsWith('/new'))
    }
  })

  it('allows purchasing_staff to access all 5 procurement sub-routes', () => {
    const session = makeMockSession('purchasing_staff')
    expect(canAccessProcurementModule(session)).toBe(true)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(session, route)).toBe(true)
    }
  })

  it('strictly BLOCKS warehouse_staff from all 5 procurement sub-routes', () => {
    const session = makeMockSession('warehouse_staff')
    expect(canAccessProcurementModule(session)).toBe(false)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(session, route)).toBe(false)
    }
  })

  it('strictly BLOCKS viewer from all 5 procurement sub-routes', () => {
    const session = makeMockSession('viewer')
    expect(canAccessProcurementModule(session)).toBe(false)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(session, route)).toBe(false)
    }
  })

  it('strictly BLOCKS unauthenticated / null session from all 5 procurement sub-routes', () => {
    expect(canAccessProcurementModule(null)).toBe(false)
    for (const route of procurementRoutes) {
      expect(canAccessRoute(null, route)).toBe(false)
    }
  })
})
