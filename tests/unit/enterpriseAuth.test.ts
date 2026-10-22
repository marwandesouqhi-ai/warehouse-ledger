import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalSession, saveUserToCloud, setLocalSession, type LocalUser } from '../../src/lib/localUsers'
import { supabase } from '../../src/lib/supabase'

describe('Enterprise Directory Authentication & User Provisioning Suite', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('1. setLocalSession correctly establishes session for warehouse_staff user', () => {
    const user: LocalUser = {
      id: 'usr-1791799116909-qe22',
      username: 'mohammed-ibrahem',
      displayName: 'محمد ابراهيم',
      password: '',
      role: 'warehouse_staff',
      activationCode: '428950',
      status: 'active',
      createdAt: '2026-10-12T09:58:36.909Z',
      permissions: [],
    }

    const session = setLocalSession(user)
    expect(session.user.id).toBe(user.id)
    expect(session.user.email).toBe('mohammed-ibrahem')
    expect(session.user.app_metadata.role).toBe('warehouse_staff')
    expect(session.user.user_metadata.displayName).toBe('محمد ابراهيم')

    const loaded = getLocalSession()
    expect(loaded).not.toBeNull()
    expect(loaded?.user.app_metadata.role).toBe('warehouse_staff')
  })

  it('2. saveUserToCloud preserves existing database password when updating without new password', async () => {
    if (!supabase) return

    // Mock supabase select returning existing row with password
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const maybeSingleSpy = vi.fn().mockResolvedValue({
      data: { id: 'usr-target', password: 'ExistingHashedPassword123' },
      error: null,
    })
    const eqSpy = vi.fn().mockReturnValue({ maybeSingle: maybeSingleSpy })
    const selectSpy = vi.fn().mockReturnValue({ eq: eqSpy })

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectSpy,
      update: updateSpy,
    } as any)

    const updatedUser: LocalUser = {
      id: 'usr-target',
      username: 'ahmed_store',
      displayName: 'أحمد أمين المخزن المعدل',
      password: '', // Empty in memory
      role: 'warehouse_staff',
      activationCode: '123456',
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    await saveUserToCloud(updatedUser)

    expect(updateSpy).toHaveBeenCalled()
    const payloadPassed = updateSpy.mock.calls[0][0]
    expect(payloadPassed.password).toBe('ExistingHashedPassword123')
  })

  it('3. saveUserToCloud sets new password when provided', async () => {
    if (!supabase) return

    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const maybeSingleSpy = vi.fn().mockResolvedValue({
      data: { id: 'usr-target', password: 'OldPassword123' },
      error: null,
    })
    const eqSpy = vi.fn().mockReturnValue({ maybeSingle: maybeSingleSpy })
    const selectSpy = vi.fn().mockReturnValue({ eq: eqSpy })

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectSpy,
      update: updateSpy,
    } as any)

    const userWithNewPassword: LocalUser = {
      id: 'usr-target',
      username: 'ahmed_store',
      displayName: 'أحمد أمين المخزن',
      password: 'BrandNewSecurePassword123!',
      role: 'warehouse_staff',
      activationCode: '123456',
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    await saveUserToCloud(userWithNewPassword)

    expect(updateSpy).toHaveBeenCalled()
    const payloadPassed = updateSpy.mock.calls[0][0]
    expect(payloadPassed.password).toBe('BrandNewSecurePassword123!')
  })

  it('4. setLocalSession and getLocalSession strictly assign system_admin to founder marwan-desouky', () => {
    const founderUser: LocalUser = {
      id: 'usr-admin-marwan',
      username: 'marwan-desouky',
      displayName: 'مروان دسوقي (مدير النظام)',
      password: '',
      role: 'admin', // even if stored as admin
      activationCode: '1001',
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    const session = setLocalSession(founderUser)
    expect(session.user.app_metadata.role).toBe('system_admin')
    expect(session.user.app_metadata.system_admin).toBe(true)
    expect(session.user.app_metadata.permissions).toContain('view_audit')
    expect(session.user.app_metadata.permissions).toContain('view_settings')

    const loaded = getLocalSession()
    expect(loaded?.user.app_metadata.role).toBe('system_admin')
    expect(loaded?.user.app_metadata.system_admin).toBe(true)
  })

  it('5. saveUserToCloud strictly skips protected account marwan-desouky without making network calls', async () => {
    if (!supabase) return

    const selectSpy = vi.fn()
    vi.spyOn(supabase, 'from').mockReturnValue({ select: selectSpy } as any)

    const founderUser: LocalUser = {
      id: 'usr-admin-marwan',
      username: 'marwan-desouky',
      displayName: 'مروان دسوقي',
      password: '',
      role: 'system_admin',
      activationCode: '',
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    await saveUserToCloud(founderUser)

    expect(selectSpy).not.toHaveBeenCalled()
  })
})
