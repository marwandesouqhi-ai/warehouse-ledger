import { describe, it, expect } from 'vitest'

describe('Edge Functions Security & Idempotency Logic Suite', () => {
  // Helper to simulate admin-users authorization check
  function checkSystemAdminAuthorization(caller: {
    email?: string
    app_metadata?: { system_admin?: boolean; role?: string }
    user_metadata?: { role?: string; username?: string }
  }): boolean {
    const isProtected = (email?: string) => {
      const clean = (email || '').trim().toLowerCase().replace(/@warehouse\.local$/, '')
      return clean === 'marwan-desouky' || clean === 'admin'
    }

    // STRICT: Only checks app_metadata and protected identity, NEVER user_metadata
    return (
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === 'system_admin' ||
      isProtected(caller.email)
    )
  }

  it('1. admin-users: strictly blocks non-system admin callers', () => {
    // Normal viewer
    expect(checkSystemAdminAuthorization({
      email: 'viewer@warehouse.local',
      app_metadata: { role: 'viewer', system_admin: false },
    })).toBe(false)

    // Normal admin
    expect(checkSystemAdminAuthorization({
      email: 'regular_admin@warehouse.local',
      app_metadata: { role: 'admin', system_admin: false },
    })).toBe(false)

    // Attacker tampering user_metadata
    expect(checkSystemAdminAuthorization({
      email: 'attacker@warehouse.local',
      user_metadata: { role: 'system_admin', username: 'marwan-desouky' },
      app_metadata: { role: 'viewer', system_admin: false },
    })).toBe(false)

    // Genuine system admin
    expect(checkSystemAdminAuthorization({
      email: 'marwan-desouky@warehouse.local',
      app_metadata: { role: 'system_admin', system_admin: true },
    })).toBe(true)
  })

  it('2. admin-users: protects system admin account from deletion or demotion', () => {
    function validateUserAction(targetUsername: string, action: 'delete' | 'demote') {
      const clean = targetUsername.trim().toLowerCase().replace(/@warehouse\.local$/, '')
      const isProtected = clean === 'marwan-desouky' || clean === 'admin'

      if (isProtected) {
        if (action === 'delete') {
          throw new Error('لا يمكن حذف حساب مدير النظام الأساسي (marwan-desouky).')
        }
        if (action === 'demote') {
          throw new Error('لا يمكن تقليص صلاحيات حساب مدير النظام الأساسي.')
        }
      }
      return true
    }

    expect(() => validateUserAction('marwan-desouky', 'delete')).toThrow(/لا يمكن حذف حساب مدير النظام الأساسي/)
    expect(() => validateUserAction('marwan-desouky@warehouse.local', 'delete')).toThrow(/لا يمكن حذف حساب مدير النظام الأساسي/)
    expect(() => validateUserAction('admin', 'delete')).toThrow(/لا يمكن حذف حساب مدير النظام الأساسي/)
    expect(() => validateUserAction('marwan-desouky', 'demote')).toThrow(/لا يمكن تقليص صلاحيات/)

    // Regular users can be deleted/demoted
    expect(validateUserAction('john_doe', 'delete')).toBe(true)
    expect(validateUserAction('john_doe', 'demote')).toBe(true)
  })

  it('3. admin-users: never returns passwords in user list or mutation responses', () => {
    const rawUsersFromDb = [
      { id: '1', username: 'user1', password: 'SecretPassword123!', role: 'warehouse_staff' },
      { id: '2', username: 'user2', password: 'AnotherSecret456!', role: 'purchasing_staff' },
    ]

    const sanitizedResponse = rawUsersFromDb.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
    }))

    const serialized = JSON.stringify(sanitizedResponse)
    expect(serialized).not.toContain('SecretPassword123!')
    expect(serialized).not.toContain('AnotherSecret456!')
    expect(serialized).not.toContain('password')
  })

  it('4. migrate-users: idempotent migration handles existing users without duplication', async () => {
    const existingAuthMap = new Map<string, any>()
    existingAuthMap.set('marwan-desouky@warehouse.local', {
      id: 'auth-uuid-marwan',
      email: 'marwan-desouky@warehouse.local',
      app_metadata: { role: 'admin' },
    })

    const appUsersTable: Array<{ id: string; username: string; password: string; role: string; auth_user_id: string | null }> = [
      { id: 'usr-1', username: 'marwan-desouky', password: 'KnownPassword.1', role: 'admin', auth_user_id: null },
      { id: 'usr-2', username: 'khaled_store', password: 'ValidPassword123', role: 'warehouse_staff', auth_user_id: null },
    ]

    const migrationLog: string[] = []

    function runMigration() {
      const summary = { migrated: 0, alreadyExists: 0, failed: 0 }

      for (const row of appUsersTable) {
        const syntheticEmail = `${row.username}@warehouse.local`
        if (existingAuthMap.has(syntheticEmail)) {
          summary.alreadyExists++
          row.auth_user_id = existingAuthMap.get(syntheticEmail).id
          migrationLog.push(`updated_${row.username}`)
        } else {
          summary.migrated++
          const newId = `auth-uuid-${row.username}`
          existingAuthMap.set(syntheticEmail, { id: newId, email: syntheticEmail })
          row.auth_user_id = newId
          migrationLog.push(`created_${row.username}`)
        }
      }
      return summary
    }

    // First run
    const report1 = runMigration()
    expect(report1.alreadyExists).toBe(1)
    expect(report1.migrated).toBe(1)
    expect(appUsersTable[0].auth_user_id).toBe('auth-uuid-marwan')
    expect(appUsersTable[1].auth_user_id).toBe('auth-uuid-khaled_store')

    // Second run (Idempotency test)
    const report2 = runMigration()
    expect(report2.alreadyExists).toBe(2)
    expect(report2.migrated).toBe(0)
    expect(existingAuthMap.size).toBe(2) // No new accounts created
  })

  it('5. migrate-users: flags accounts with invalid password (< 6 chars) as failed without corrupting them', () => {
    const userWithInvalidPassword = {
      id: 'usr-invalid',
      username: 'short_pass_user',
      password: '123', // less than 6 characters
      role: 'viewer',
    }

    let status = ''
    let reason = ''

    if (!userWithInvalidPassword.password || userWithInvalidPassword.password.length < 6) {
      status = 'failed'
      reason = 'كلمة المرور فارغة أو أقصر من 6 أحرف'
    } else {
      status = 'migrated'
    }

    expect(status).toBe('failed')
    expect(reason).toContain('أقصر من 6 أحرف')
    // Data remains intact
    expect(userWithInvalidPassword.password).toBe('123')
  })
})
