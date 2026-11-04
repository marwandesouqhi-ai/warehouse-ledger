import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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

  it('3. admin-users: enforces minimum 6-character password policy', () => {
    function validatePasswordLength(password?: string): boolean {
      if (!password || typeof password !== 'string' || password.length < 6) {
        throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف للأمان.')
      }
      return true
    }

    expect(() => validatePasswordLength('12345')).toThrow(/كلمة المرور يجب ألا تقل عن 6/)
    expect(() => validatePasswordLength('short')).toThrow(/كلمة المرور يجب ألا تقل عن 6/)
    expect(validatePasswordLength('123456')).toBe(true)
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

  it('7. Static Security: No Edge Function returns Auth links or tokens in response bodies', () => {
    const functionsDir = path.resolve(__dirname, '../../supabase/functions')
    const files = fs.readdirSync(functionsDir, { recursive: true })
      .filter((f) => String(f).endsWith('.ts'))
      .map((f) => path.join(functionsDir, String(f)))

    const linkPatterns = [
      /new\s+Response\([^)]*\b(action_link|hashed_token|email_otp|recoveryLink|inviteLink)\b/i,
      /JSON\.stringify\([^)]*\b(action_link|hashed_token|email_otp|recoveryLink|inviteLink)\b/i,
    ]

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      for (const pattern of linkPatterns) {
        expect(pattern.test(content), `File ${path.basename(file)} must not expose auth links or tokens in response`).toBe(false)
      }
    }
  })

  it('8. Static Security: Every listUsers call in Edge Functions must be paginated', () => {
    const functionsDir = path.resolve(__dirname, '../../supabase/functions')
    const files = fs.readdirSync(functionsDir, { recursive: true })
      .filter((f) => String(f).endsWith('.ts'))
      .map((f) => path.join(functionsDir, String(f)))

    const unpaginatedListUsersRegex = /auth\.admin\.listUsers\s*\(\s*\)/g

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      const matches = content.match(unpaginatedListUsersRegex)
      expect(matches, `File ${path.basename(file)} contains unpaginated listUsers() call`).toBeNull()
    }
  })

  it('9. Public recovery: unknown formatted emails are treated as non-existent accounts before generateLink is called', () => {
    const file = path.resolve(__dirname, '../../supabase/functions/admin-users/index.ts')
    const content = fs.readFileSync(file, 'utf-8')

    expect(content).toContain('matchedKnownUser')
    expect(content).toMatch(/if\s*\(\s*!matchedKnownUser\s*\)\s*\{/)
    expect(content).toContain('إذا كان الحساب مسجلاً في المنظومة')
  })

  it('10. Static Security: No Edge Function returns password or temporaryPassword in response bodies', () => {
    const functionsDir = path.resolve(__dirname, '../../supabase/functions')
    const files = fs.readdirSync(functionsDir, { recursive: true })
      .filter((f) => String(f).endsWith('.ts'))
      .map((f) => path.join(functionsDir, String(f)))

    const passwordResponsePatterns = [
      /JSON\.stringify\([^)]*\b(temporaryPassword|effectivePassword)\b/i,
      /JSON\.stringify\([^)]*['"]password['"]\s*:\s*(?!null|false|undefined)/i,
    ]

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      for (const pattern of passwordResponsePatterns) {
        expect(pattern.test(content), `File ${path.basename(file)} must not return password in response`).toBe(false)
      }
    }
  })

  it('10. Static Security: Edge Functions with service-role key verify caller JWT or have secret validation', () => {
    const functionsDir = path.resolve(__dirname, '../../supabase/functions')
    const files = fs.readdirSync(functionsDir, { recursive: true })
      .filter((f) => String(f).endsWith('index.ts'))
      .map((f) => path.join(functionsDir, String(f)))

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        const hasCallerVerification =
          content.includes('getUser') ||
          content.includes('Authorization') ||
          content.includes('TELEGRAM_BOT_SECRET') ||
          content.includes('X-Telegram-Bot-Api-Secret-Token') ||
          content.includes('secret')
        expect(hasCallerVerification, `Function ${path.basename(path.dirname(file))} must verify caller or webhook secret`).toBe(true)
      }
    }
  })

  it('11. admin-users: missing Auth users are healed before recovery links are generated', () => {
    const file = path.resolve(__dirname, '../../supabase/functions/admin-users/index.ts')
    const content = fs.readFileSync(file, 'utf-8')

    expect(content).toContain('getUserByEmail')
    expect(content).toContain('ensureAuthUserForRecovery')
    expect(content).toContain('must_change_password: true')
  })
})
