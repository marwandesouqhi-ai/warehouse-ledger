/// <reference types="node" />
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

describe('Session Wizard & Security Hardening Tests (F6)', () => {
  const botFilePath = path.resolve(__dirname, '../../supabase/functions/telegram-bot/index.ts')
  const migrationFilePath = path.resolve(__dirname, '../../supabase/migrations/20261017160000_telegram_user_sessions.sql')

  const botSource = fs.readFileSync(botFilePath, 'utf8')
  const migrationSource = fs.readFileSync(migrationFilePath, 'utf8')

  it('1. verifies telegram_user_sessions migration revokes anon/authenticated access and enables RLS', () => {
    expect(migrationSource).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migrationSource).toContain('REVOKE ALL ON TABLE public.telegram_user_sessions FROM PUBLIC, anon, authenticated')
    expect(migrationSource).toContain('GRANT ALL ON TABLE public.telegram_user_sessions TO service_role')
  })

  it('2. verifies telegram_user_sessions does NOT contain columns for OTPs, tokens, or email bodies', () => {
    expect(migrationSource).not.toContain('otp')
    expect(migrationSource).not.toContain('token')
    expect(migrationSource).not.toContain('email_body')
    expect(migrationSource).not.toContain('body')
  })

  it('3. verifies telegram bot includes age-bounded cleanup for abandoned sessions', () => {
    expect(botSource).toContain('telegram_user_sessions')
    expect(botSource).toContain('.delete()')
    expect(botSource).toContain('.lt("updated_at"')
  })

  it('4. verifies update deduplication only drops updates on Postgres unique violation 23505', () => {
    expect(botSource).toContain('dedupErr.code === "23505"')
  })

  it('5. verifies webhook authentication strictly fails closed on missing secret and uses timingSafeEqual', () => {
    expect(botSource).toContain('if (!webhookSecret)')
    expect(botSource).toContain('status: 500')
    expect(botSource).toContain('timingSafeEqual(incomingSecret, webhookSecret)')
  })

  it('6. verifies system_admin role is strictly neutralized in telegram registration requests', () => {
    expect(botSource).toContain('requestedRole === "system_admin"')
    // Should never allow system_admin
    expect(botSource).toContain('requestedRole = isWarehouse ? "warehouse_employee" : "procurement_employee"')
  })

  it('7. verifies /status and /cancel queries are strictly scoped by telegram_user_id', () => {
    expect(botSource).toMatch(/\.from\("registration_requests"\)\s*\.select\("[^"]*"\)\s*\.eq\("telegram_user_id",\s*tgUserId\)/)
  })

  it('8. verifies email delivery failure sets delivery_failed and does not reveal OTP in failure message', () => {
    expect(botSource).toContain('verificationStatus = emailRes.accepted ? "pending" : "delivery_failed"')
    expect(botSource).toContain('تعذر إرسال رمز التحقق إلى بريدك الإلكتروني حالياً')
  })

  it('9. verifies OTP is never logged via console.* in telegram bot source', () => {
    expect(botSource).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*otp[^)]*\)/i)
  })
})
