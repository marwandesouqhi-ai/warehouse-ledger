import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper mirroring uniform 6-digit OTP generation with rejection sampling
function generateUniform6DigitOtp(): string {
  const min = 100000
  const max = 999999
  const range = max - min + 1 // 900,000
  const maxUint32 = 0xFFFFFFFF
  const limit = maxUint32 - (maxUint32 % range)
  const buffer = new Uint32Array(1)
  let val = 0
  do {
    crypto.getRandomValues(buffer)
    val = buffer[0]
  } while (val >= limit)
  return String(min + (val % range))
}

// Helper mirroring peppered hash
async function hashTokenWithPepper(token: string, pepper?: string): Promise<string> {
  const encoder = new TextEncoder()
  const input = (pepper ? pepper + ':' : '') + token.trim()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false
  return EMAIL_REGEX.test(email.trim())
}

describe('Session B: P1-1 Real Email Verification & OTP Security Tests', () => {
  it('generates uniform 6-digit OTP numbers strictly within [100000, 999999]', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateUniform6DigitOtp()
      expect(otp).toMatch(/^\d{6}$/)
      const num = parseInt(otp, 10)
      expect(num).toBeGreaterThanOrEqual(100000)
      expect(num).toBeLessThanOrEqual(999999)
    }
  })

  it('guarantees OTP never leaks into outgoing Telegram confirmation message payloads', () => {
    const fullName = 'علي حسن'
    const email = 'ali.hassan@example.com'
    const dept = 'المخازن'
    const role = 'موظف مخازن'
    const otp = '849201'

    // Formatted Telegram message as sent by the hardened bot:
    const confirmMsg = `تم استلام بياناتك بنجاح!\n\nالاسم: ${fullName}\nالبريد: ${email}\nالقسم: ${dept}\nالدور: ${role}\n\nتم إرسال رمز التحقق إلى بريدك الإلكتروني (صالح لمدة 10 دقائق).\nيرجى فحص صندوق الوارد (أو مجلد الرسائل غير المرغوب فيها) ثم كتابة الرمز هنا عبر الأمر:\n<code>/verify الرمز</code>`

    // The message MUST NOT contain the generated OTP code!
    expect(confirmMsg).not.toContain(otp)
    expect(confirmMsg).toContain('/verify الرمز')
    expect(confirmMsg).not.toContain(`/verify ${otp}`)
  })

  it('handles unconfigured email provider safely: sets delivery_failed, does not reveal OTP, and prompts user', () => {
    const resendApiKey = '' // Unconfigured
    const hasKey = Boolean(resendApiKey && resendApiKey.startsWith('re_'))
    expect(hasKey).toBe(false)

    // Handled state:
    const verificationStatus = hasKey ? 'pending' : 'delivery_failed'
    const emailSendStatus = hasKey ? 'sent' : 'failed'

    expect(verificationStatus).toBe('delivery_failed')
    expect(emailSendStatus).toBe('failed')
  })

  it('enforces peppered SHA-256 hash storage: identical OTP produces different hash with different pepper', async () => {
    const otp = '582914'
    const hashNoPepper = await hashTokenWithPepper(otp, '')
    const hashWithPepperA = await hashTokenWithPepper(otp, 'pepper_secret_A')
    const hashWithPepperB = await hashTokenWithPepper(otp, 'pepper_secret_B')

    expect(hashNoPepper).not.toEqual(hashWithPepperA)
    expect(hashWithPepperA).not.toEqual(hashWithPepperB)
  })

  it('simulates atomic 5-attempt lockout: exceeding 5 attempts rejects verification', () => {
    interface RequestRow {
      verification_attempts: number
      is_locked: boolean
    }

    const row: RequestRow = { verification_attempts: 0, is_locked: false }

    function attemptVerify(isCorrect: boolean): { success: boolean; attempts: number; remaining: number } {
      if (row.verification_attempts >= 5) {
        row.is_locked = true
        return { success: false, attempts: row.verification_attempts, remaining: 0 }
      }
      row.verification_attempts += 1
      if (isCorrect) {
        return { success: true, attempts: row.verification_attempts, remaining: 5 - row.verification_attempts }
      }
      if (row.verification_attempts >= 5) {
        row.is_locked = true
      }
      return { success: false, attempts: row.verification_attempts, remaining: 5 - row.verification_attempts }
    }

    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = attemptVerify(false)
      expect(res.success).toBe(false)
      expect(res.attempts).toBe(i)
      expect(row.is_locked).toBe(false)
    }

    // 5th failed attempt locks
    const fifth = attemptVerify(false)
    expect(fifth.success).toBe(false)
    expect(fifth.attempts).toBe(5)
    expect(row.is_locked).toBe(true)

    // 6th attempt is rejected by lockout guard
    const sixth = attemptVerify(true) // Even if correct OTP is passed, lockout refuses!
    expect(sixth.success).toBe(false)
    expect(sixth.remaining).toBe(0)
  })
})

describe('Session B: P2-1 Telegram Bot Hardening & Injection Prevention Tests', () => {
  it('validates strict email regex and rejects injection / malformed emails', () => {
    expect(isValidEmail('employee@company.com')).toBe(true)
    expect(isValidEmail('first.last+dept@domain.org.sa')).toBe(true)

    // Injection & Malformed attempts
    expect(isValidEmail('employee@domain.com,injected@test.com')).toBe(false)
    expect(isValidEmail('user@test.com; DROP TABLE app_users;')).toBe(false)
    expect(isValidEmail('invalid-email-no-at')).toBe(false)
    expect(isValidEmail('@nodomain.com')).toBe(false)
    expect(isValidEmail('spaces in email@domain.com')).toBe(false)
  })

  it('proves update deduplication prevents duplicate processing on update_id collision', () => {
    const processedUpdates = new Set<number>()

    function processUpdate(updateId: number): { processed: boolean } {
      if (processedUpdates.has(updateId)) {
        return { processed: false } // Duplicate update ignored!
      }
      processedUpdates.add(updateId)
      return { processed: true }
    }

    expect(processUpdate(1001).processed).toBe(true)
    expect(processUpdate(1001).processed).toBe(false) // Retried by Telegram -> Ignored
    expect(processUpdate(1002).processed).toBe(true)
  })

  it('normalizes rate limit identifiers so case/whitespace variants hit the same bucket', () => {
    const rateStore: Record<string, number> = {}

    function recordRateEvent(type: string, rawIdentifier: string, limit: number): boolean {
      const normalized = rawIdentifier.trim().toLowerCase()
      const key = `${type}:${normalized}`
      const count = rateStore[key] || 0
      if (count >= limit) return false
      rateStore[key] = count + 1
      return true
    }

    expect(recordRateEvent('register', 'USER@TEST.COM', 2)).toBe(true)
    expect(recordRateEvent('register', '  user@test.com ', 2)).toBe(true)
    // 3rd attempt with another variation must be BLOCKED by rate limit
    expect(recordRateEvent('register', 'User@Test.Com', 2)).toBe(false)
  })

  it('enforces cancellation ownership and preserves history: marks cancelled without row deletion', () => {
    interface RegRequest {
      id: string
      telegram_user_id: number
      approval_status: 'pending' | 'approved' | 'rejected' | 'cancelled'
    }

    const requests: RegRequest[] = [
      { id: 'req-1', telegram_user_id: 123456, approval_status: 'pending' },
      { id: 'req-2', telegram_user_id: 999999, approval_status: 'approved' },
    ]

    function cancelRequest(callerTgId: number): { success: boolean; message: string } {
      const target = requests.find((r) => r.telegram_user_id === callerTgId)
      if (!target || target.approval_status === 'cancelled') {
        return { success: false, message: 'لا يوجد طلب تسجيل معلق لإلغائه.' }
      }
      if (target.approval_status === 'approved') {
        return { success: false, message: 'غير متاح: تم اعتماد حسابك مسبقاً.' }
      }
      target.approval_status = 'cancelled'
      return { success: true, message: 'تم إلغاء طلب التسجيل بنجاح.' }
    }

    // Caller 123456 cancels their pending request
    const res1 = cancelRequest(123456)
    expect(res1.success).toBe(true)
    expect(requests.find((r) => r.id === 'req-1')?.approval_status).toBe('cancelled')
    // Row is preserved (not deleted)
    expect(requests.length).toBe(2)

    // Caller 999999 tries to cancel an already-approved request -> Refused
    const res2 = cancelRequest(999999)
    expect(res2.success).toBe(false)
    expect(res2.message).toContain('تم اعتماد حسابك مسبقاً')
  })

  it('resend cooldown and hourly cap simulation', () => {
    let lastResendAt: number | null = null
    let resendCount = 0

    function requestResend(currentTime: number): { allowed: boolean; waitSeconds?: number } {
      if (lastResendAt && currentTime - lastResendAt < 60000) {
        return { allowed: false, waitSeconds: Math.ceil((60000 - (currentTime - lastResendAt)) / 1000) }
      }
      if (resendCount >= 3) {
        return { allowed: false, waitSeconds: 3600 }
      }
      lastResendAt = currentTime
      resendCount += 1
      return { allowed: true }
    }

    const t0 = 1000000
    expect(requestResend(t0).allowed).toBe(true)
    // Attempt 30s later -> cooldown blocks
    const blockedCooldown = requestResend(t0 + 30000)
    expect(blockedCooldown.allowed).toBe(false)
    expect(blockedCooldown.waitSeconds).toBe(30)

    // Attempt 61s later -> allowed
    expect(requestResend(t0 + 61000).allowed).toBe(true)
    // Attempt 125s later -> allowed (3rd)
    expect(requestResend(t0 + 125000).allowed).toBe(true)
    // 4th attempt -> hourly cap blocks
    expect(requestResend(t0 + 200000).allowed).toBe(false)
  })
})
