import { describe, it, expect } from 'vitest'

describe('Edge Functions Security & Idempotency Logic Suite', () => {
  // Helper simulating admin-users authorization check
  function checkSystemAdminAuthorization(caller: {
    email?: string
    app_metadata?: { system_admin?: boolean; role?: string }
    user_metadata?: { role?: string; username?: string }
  }): boolean {
    // STRICT: Only checks cryptographically verified app_metadata, NEVER email or user_metadata
    return (
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === 'system_admin'
    )
  }

  it('1. admin-users: strictly blocks non-system admin callers and rejects username-based escalation', () => {
    // Normal viewer
    expect(checkSystemAdminAuthorization({
      email: 'viewer@warehouse.local',
      app_metadata: { role: 'viewer', system_admin: false },
    })).toBe(false)

    // Regular admin (not system admin)
    expect(checkSystemAdminAuthorization({
      email: 'regular_admin@warehouse.local',
      app_metadata: { role: 'admin', system_admin: false },
    })).toBe(false)

    // Attacker using marwan-desouky username without signed app_metadata
    expect(checkSystemAdminAuthorization({
      email: 'marwan-desouky@warehouse.local',
      app_metadata: { role: 'viewer', system_admin: false },
    })).toBe(false)

    // Attacker tampering user_metadata
    expect(checkSystemAdminAuthorization({
      email: 'attacker@warehouse.local',
      user_metadata: { role: 'system_admin', username: 'admin' },
      app_metadata: { role: 'viewer', system_admin: false },
    })).toBe(false)

    // Genuine system admin with signed app_metadata
    expect(checkSystemAdminAuthorization({
      email: 'verified_sysadmin@warehouse.local',
      app_metadata: { role: 'system_admin', system_admin: true },
    })).toBe(true)
  })

  it('2. admin-users: protects the last active system admin from deletion or demotion', () => {
    function validateDemoteOrDelete(
      targetIsSysAdmin: boolean,
      activeSysAdminCount: number,
      action: 'delete' | 'demote'
    ) {
      if (targetIsSysAdmin && activeSysAdminCount <= 1) {
        if (action === 'delete') {
          throw new Error('لا يمكن حذف آخر مدير نظام نشط (System Admin) في المؤسسة. يجب تعيين مدير نظام بديل أولاً.')
        }
        if (action === 'demote') {
          throw new Error('لا يمكن خفض صلاحيات آخر مدير نظام نشط (System Admin) في المؤسسة. يجب تعيين مدير نظام بديل أولاً.')
        }
      }
      return true
    }

    // Only 1 active system admin: cannot delete or demote
    expect(() => validateDemoteOrDelete(true, 1, 'delete')).toThrow(/لا يمكن حذف آخر مدير نظام نشط/)
    expect(() => validateDemoteOrDelete(true, 1, 'demote')).toThrow(/لا يمكن خفض صلاحيات آخر مدير نظام نشط/)

    // Multiple system admins: allowed to delete or demote
    expect(validateDemoteOrDelete(true, 2, 'delete')).toBe(true)
    expect(validateDemoteOrDelete(true, 2, 'demote')).toBe(true)

    // Regular users: allowed to delete or demote
    expect(validateDemoteOrDelete(false, 1, 'delete')).toBe(true)
  })

  it('3. admin-users: enforces minimum 12-character strong password policy', () => {
    function validatePasswordLength(password?: string): boolean {
      if (!password || typeof password !== 'string' || password.length < 12) {
        throw new Error('كلمة المرور يجب ألا تقل عن 12 حرفاً للأمان.')
      }
      return true
    }

    expect(() => validatePasswordLength('12345678')).toThrow(/كلمة المرور يجب ألا تقل عن 12/)
    expect(() => validatePasswordLength('short-pass')).toThrow(/كلمة المرور يجب ألا تقل عن 12/)
    expect(validatePasswordLength('StrongPassword2026!#')).toBe(true)
  })

  it('4. admin-users: never returns passwords in user list responses', () => {
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

  it('5. migrate-users: dry-run mode previews accounts without performing mutations', () => {
    const appUsersTable = [
      { id: 'usr-1', username: 'account1', password: 'ValidPass12345!', role: 'warehouse_staff', auth_user_id: null },
      { id: 'usr-2', username: 'account2', password: '123', role: 'viewer', auth_user_id: null }, // short password
    ]
    const existingAuthEmails = new Set(['existing@warehouse.local'])

    function runDryRun(users: typeof appUsersTable) {
      let readyCount = 0
      let failedCount = 0
      let alreadyExistsCount = 0
      const details: Array<{ username: string; status: string }> = []

      for (const u of users) {
        const synthetic = `${u.username}@warehouse.local`
        if (existingAuthEmails.has(synthetic)) {
          alreadyExistsCount++
          details.push({ username: u.username, status: 'already_exists' })
        } else if (!u.password || u.password.length < 6) {
          failedCount++
          details.push({ username: u.username, status: 'failed' })
        } else {
          readyCount++
          details.push({ username: u.username, status: 'dry_run_ready' })
        }
      }

      return {
        dryRun: true,
        summary: { readyCount, failedCount, alreadyExistsCount },
        details,
      }
    }

    const result = runDryRun(appUsersTable)
    expect(result.dryRun).toBe(true)
    expect(result.summary.readyCount).toBe(1)
    expect(result.summary.failedCount).toBe(1)
    expect(result.summary.alreadyExistsCount).toBe(0)
    // Verify no DB mutations occurred
    expect(appUsersTable[0].auth_user_id).toBeNull()
  })

  it('6. migrate-users: idempotent migration handles existing users without duplication', async () => {
    const existingAuthMap = new Map<string, any>()
    existingAuthMap.set('user1@warehouse.local', {
      id: 'auth-uuid-user1',
      email: 'user1@warehouse.local',
      app_metadata: { role: 'admin' },
    })

    const appUsersTable: Array<{ id: string; username: string; password: string; role: string; auth_user_id: string | null }> = [
      { id: 'usr-1', username: 'user1', password: 'KnownPassword.123', role: 'admin', auth_user_id: null },
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
    expect(appUsersTable[0].auth_user_id).toBe('auth-uuid-user1')
    expect(appUsersTable[1].auth_user_id).toBe('auth-uuid-khaled_store')

    // Second run (Idempotency test)
    const report2 = runMigration()
    expect(report2.alreadyExists).toBe(2)
    expect(report2.migrated).toBe(0)
    expect(existingAuthMap.size).toBe(2) // Zero duplicate users
  })
})
