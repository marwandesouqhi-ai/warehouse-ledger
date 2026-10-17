import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper mirroring constant-time comparison in telegram-bot Edge Function
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  if (aBytes.length !== bBytes.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

// Handler simulation of telegram-bot webhook authentication logic
function processTelegramWebhookAuth(method: string, headers: Record<string, string>, envSecret?: string): { status: number; error?: string } {
  if (method === 'OPTIONS') return { status: 200 }
  if (method !== 'POST') return { status: 405, error: 'Method Not Allowed' }

  const webhookSecret = (envSecret ?? '').trim()
  if (!webhookSecret) {
    return { status: 500, error: 'Server Configuration Error' }
  }

  const incomingSecret = headers['x-telegram-bot-api-secret-token'] || ''
  if (!incomingSecret || !timingSafeEqual(incomingSecret, webhookSecret)) {
    return { status: 401, error: 'Unauthorized webhook caller' }
  }

  return { status: 200 }
}

describe('Session A: P0-3 Telegram Webhook Fail-Closed Tests', () => {
  it('strictly rejects requests with 500 when TELEGRAM_WEBHOOK_SECRET is unset or empty (fail-closed)', () => {
    // Unset secret must NEVER allow bypass
    const resUnset = processTelegramWebhookAuth('POST', { 'x-telegram-bot-api-secret-token': 'any-token' }, undefined)
    expect(resUnset.status).toBe(500)
    expect(resUnset.error).toBe('Server Configuration Error')

    const resEmpty = processTelegramWebhookAuth('POST', { 'x-telegram-bot-api-secret-token': 'any-token' }, '   ')
    expect(resEmpty.status).toBe(500)
    expect(resEmpty.error).toBe('Server Configuration Error')
  })

  it('rejects requests with 401 when incoming secret header is missing or incorrect', () => {
    const configuredSecret = 'secure_secret_token_abc123'
    
    // Missing header
    const resMissing = processTelegramWebhookAuth('POST', {}, configuredSecret)
    expect(resMissing.status).toBe(401)
    expect(resMissing.error).toBe('Unauthorized webhook caller')

    // Wrong header value
    const resWrong = processTelegramWebhookAuth('POST', { 'x-telegram-bot-api-secret-token': 'wrong_secret' }, configuredSecret)
    expect(resWrong.status).toBe(401)
    expect(resWrong.error).toBe('Unauthorized webhook caller')

    // Near match (constant-time check)
    const resNear = processTelegramWebhookAuth('POST', { 'x-telegram-bot-api-secret-token': 'secure_secret_token_abc124' }, configuredSecret)
    expect(resNear.status).toBe(401)
    expect(resNear.error).toBe('Unauthorized webhook caller')
  })

  it('accepts request with 200 when incoming secret matches exactly', () => {
    const configuredSecret = 'secure_secret_token_abc123'
    const resValid = processTelegramWebhookAuth('POST', { 'x-telegram-bot-api-secret-token': configuredSecret }, configuredSecret)
    expect(resValid.status).toBe(200)
  })

  it('rejects non-POST HTTP methods with 405 Method Not Allowed', () => {
    const configuredSecret = 'secure_secret_token_abc123'
    const resGet = processTelegramWebhookAuth('GET', { 'x-telegram-bot-api-secret-token': configuredSecret }, configuredSecret)
    expect(resGet.status).toBe(405)
    expect(resGet.error).toBe('Method Not Allowed')

    const resPut = processTelegramWebhookAuth('PUT', { 'x-telegram-bot-api-secret-token': configuredSecret }, configuredSecret)
    expect(resPut.status).toBe(405)
  })
})

describe('Session A: P0-2 System Administrator One-Time Bootstrap Logic', () => {
  interface AuthUser {
    id: string
    email: string
    email_confirmed_at: string | null
    app_metadata?: Record<string, unknown>
  }

  interface BootstrapState {
    completed_at: string | null
    completed_by_auth_id: string | null
    admin_email: string | null
    admin_username: string | null
  }

  interface AppUserRow {
    id: string
    username: string
    email: string
    auth_user_id: string | null
    employee_id: string
    role: string
    status: string
  }

  let bootstrapState: BootstrapState
  let appUsers: AppUserRow[]
  let auditLogs: Array<{ action: string; outcome: string; user_id: string }>

  beforeEach(() => {
    bootstrapState = {
      completed_at: null,
      completed_by_auth_id: null,
      admin_email: null,
      admin_username: null,
    }
    appUsers = []
    auditLogs = []
  })

  function executeBootstrap(
    caller: AuthUser,
    expectedEmail: string,
    expectedUsername: string
  ): { success: boolean; status: string; message: string; employeeId?: string } {
    // 1. Edge Function Verification Layer
    const isEmailVerified = Boolean(caller.email_confirmed_at)
    const isEmailMatch = (caller.email || '').trim().toLowerCase() === expectedEmail.toLowerCase()

    if (!isEmailVerified || !isEmailMatch) {
      auditLogs.push({ action: 'bootstrap_denied', outcome: 'denied', user_id: caller.id })
      throw new Error('غير مصرح لك: إجراء التهيئة الأولية مخصص حصرياً للمالك مع بريد مؤكد.')
    }

    // 2. Database Function Simulation Layer
    if (bootstrapState.completed_at !== null) {
      return {
        success: true,
        status: 'already_initialized',
        message: 'النظام مهيأ مسبقاً، لم يتم إجراء أي تغيير.',
        employeeId: 'SYS-ADM-000001',
      }
    }

    const matchingUsers = appUsers.filter(
      (u) =>
        u.username.toLowerCase() === expectedUsername.toLowerCase() ||
        u.email.toLowerCase() === expectedEmail.toLowerCase()
    )

    if (matchingUsers.length > 1) {
      throw new Error('تعارض في سجلات المستخدمين: تم العثور على أكثر من حساب يطابق اسم المستخدم أو البريد الإلكتروني.')
    }

    let allocatedId = 'SYS-ADM-000001'

    if (matchingUsers.length === 1) {
      const existing = matchingUsers[0]
      if (existing.auth_user_id && existing.auth_user_id !== caller.id) {
        throw new Error('تعارض في الهوية: هذا الحساب مرتبط بالفعل بحساب مصادقة آخر.')
      }
      existing.auth_user_id = caller.id
      existing.role = 'system_admin'
      existing.status = 'active'
      existing.email = expectedEmail
      existing.username = expectedUsername
      allocatedId = existing.employee_id || allocatedId
    } else {
      appUsers.push({
        id: 'usr-' + caller.id,
        username: expectedUsername,
        email: expectedEmail,
        auth_user_id: caller.id,
        employee_id: allocatedId,
        role: 'system_admin',
        status: 'active',
      })
    }

    bootstrapState.completed_at = new Date().toISOString()
    bootstrapState.completed_by_auth_id = caller.id
    bootstrapState.admin_email = expectedEmail
    bootstrapState.admin_username = expectedUsername

    auditLogs.push({ action: 'bootstrap_success', outcome: 'success', user_id: caller.id })

    return {
      success: true,
      status: 'completed',
      message: 'تمت تهيئة وتأكيد حساب مدير النظام الرئيسي بنجاح.',
      employeeId: allocatedId,
    }
  }

  it('successfully bootstraps the verified owner identity on first run', () => {
    const verifiedOwner: AuthUser = {
      id: 'uuid-owner-123',
      email: 'marwandesouqhi@gmail.com',
      email_confirmed_at: '2026-10-17T10:00:00Z',
    }

    const res = executeBootstrap(verifiedOwner, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    expect(res.success).toBe(true)
    expect(res.status).toBe('completed')
    expect(res.employeeId).toBe('SYS-ADM-000001')
    expect(bootstrapState.completed_at).not.toBeNull()
    expect(bootstrapState.completed_by_auth_id).toBe('uuid-owner-123')
    expect(appUsers[0].role).toBe('system_admin')
    expect(appUsers[0].status).toBe('active')
    expect(auditLogs).toContainEqual({ action: 'bootstrap_success', outcome: 'success', user_id: 'uuid-owner-123' })
  })

  it('strictly rejects unverified email addresses even if the email string matches', () => {
    const unverifiedOwner: AuthUser = {
      id: 'uuid-unverified',
      email: 'marwandesouqhi@gmail.com',
      email_confirmed_at: null, // NOT verified
    }

    expect(() =>
      executeBootstrap(unverifiedOwner, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    ).toThrow('غير مصرح لك')

    expect(bootstrapState.completed_at).toBeNull()
    expect(auditLogs).toContainEqual({ action: 'bootstrap_denied', outcome: 'denied', user_id: 'uuid-unverified' })
  })

  it('strictly rejects an arbitrary caller trying to bootstrap with wrong email', () => {
    const attacker: AuthUser = {
      id: 'uuid-attacker',
      email: 'attacker@example.com',
      email_confirmed_at: '2026-10-17T10:00:00Z',
    }

    expect(() =>
      executeBootstrap(attacker, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    ).toThrow('غير مصرح لك')

    expect(bootstrapState.completed_at).toBeNull()
    expect(auditLogs).toContainEqual({ action: 'bootstrap_denied', outcome: 'denied', user_id: 'uuid-attacker' })
  })

  it('guarantees idempotency: subsequent bootstrap calls are safe no-ops and modify nothing', () => {
    const verifiedOwner: AuthUser = {
      id: 'uuid-owner-123',
      email: 'marwandesouqhi@gmail.com',
      email_confirmed_at: '2026-10-17T10:00:00Z',
    }

    const firstRun = executeBootstrap(verifiedOwner, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    expect(firstRun.status).toBe('completed')

    // Second run
    const secondRun = executeBootstrap(verifiedOwner, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    expect(secondRun.success).toBe(true)
    expect(secondRun.status).toBe('already_initialized')
    expect(secondRun.message).toContain('النظام مهيأ مسبقاً')
    expect(appUsers.length).toBe(1)
  })

  it('prevents account hijacking if an existing record is already linked to another Auth ID', () => {
    appUsers.push({
      id: 'usr-existing',
      username: 'marwan-desouky',
      email: 'marwandesouqhi@gmail.com',
      auth_user_id: 'legitimate-existing-auth-id',
      employee_id: 'SYS-ADM-000001',
      role: 'system_admin',
      status: 'active',
    })

    const intruderWithSameEmail: AuthUser = {
      id: 'different-auth-id-attempt',
      email: 'marwandesouqhi@gmail.com',
      email_confirmed_at: '2026-10-17T10:00:00Z',
    }

    expect(() =>
      executeBootstrap(intruderWithSameEmail, 'marwandesouqhi@gmail.com', 'marwan-desouky')
    ).toThrow('تعارض في الهوية')
  })
})

describe('Session A: P0-1 Privileged Database Functions Lockdown Verification', () => {
  it('confirms migration file revokes execute from PUBLIC, anon, and authenticated for all privileged functions', async () => {
    // Read migration content to assert explicit revocations exist
    const fs = await import('fs')
    const path = await import('path')
    const migrationPath = path.resolve('supabase/migrations/20261017130000_lockdown_privileged_functions_and_bootstrap.sql')
    const migrationContent = fs.readFileSync(migrationPath, 'utf8')

    // Assert generate_employee_code is locked down
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.generate_employee_code(TEXT) FROM PUBLIC, anon, authenticated;')
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION public.generate_employee_code(TEXT) TO service_role;')

    // Assert approve_employee_registration is locked down
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.approve_employee_registration(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;')
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION public.approve_employee_registration(UUID, TEXT, TEXT) TO service_role;')

    // Assert bootstrap_system_admin is locked down
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.bootstrap_system_admin(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;')
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION public.bootstrap_system_admin(TEXT, TEXT, UUID) TO service_role;')

    // Assert system_bootstrap_state is locked down
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.system_bootstrap_state FROM PUBLIC, anon, authenticated;')
    expect(migrationContent).toContain('GRANT ALL ON TABLE public.system_bootstrap_state TO service_role;')
  })
})
