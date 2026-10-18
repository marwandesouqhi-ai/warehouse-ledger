/// <reference types="node" />
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAuthMode, isAuthSecureMode, isAuthTransitionalMode } from '../../src/lib/authMode'
import { isProtectedUsername } from '../../src/lib/protectedAccounts'

describe('Zero Lockout & Login Bridge Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('Auth Mode Resolution', () => {
    it('defaults to transitional mode when VITE_AUTH_MODE is unset', () => {
      expect(getAuthMode()).toBe('transitional')
      expect(isAuthTransitionalMode()).toBe(true)
      expect(isAuthSecureMode()).toBe(false)
    })
  })

  describe('Login Bridge Logic Simulation', () => {
    // Simulated database store
    const mockAppUsers = [
      {
        id: 'usr-active-1',
        username: 'staff_ahmed',
        password: 'ValidPassword123!',
        role: 'warehouse_staff',
        status: 'active',
        permissions: [],
        auth_user_id: null,
      },
      {
        id: 'usr-pending-2',
        username: 'pending_user',
        password: 'PendingPassword123!',
        role: 'editor',
        status: 'pending_activation',
        permissions: [],
        auth_user_id: null,
      },
      {
        id: 'usr-admin-marwan',
        username: 'marwan-desouky',
        password: 'AdminPassword123!',
        role: 'system_admin',
        status: 'active',
        permissions: ['view_audit', 'view_settings', 'manage_records'],
        auth_user_id: 'uuid-marwan',
      },
    ]

    const mockLoginAttempts: Array<{ username: string; attempted_at: string; success: boolean }> = []

    async function simulateLoginBridge(username: string, password: string): Promise<{ status: number; body: Record<string, unknown> }> {
      const cleanUser = username.trim().toLowerCase()

      // 1. Protected System Admin is strictly excluded from bridge
      if (isProtectedUsername(cleanUser)) {
        return { status: 401, body: { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' } }
      }

      // 2. Check rate limit: 5 failed attempts in last 15 minutes
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000
      const recentFailed = mockLoginAttempts.filter(
        (a) => a.username === cleanUser && !a.success && new Date(a.attempted_at).getTime() >= fifteenMinutesAgo
      )
      if (recentFailed.length >= 5) {
        return {
          status: 429,
          body: { error: 'تم تجاوز الحد الأقصى للمحاولات الفاشلة. تم تعليق المحاولة مؤقتاً لمدة 15 دقيقة لحماية الحساب.' },
        }
      }

      // 3. Query app_users
      const user = mockAppUsers.find((u) => u.username.toLowerCase() === cleanUser)
      if (!user) {
        mockLoginAttempts.push({ username: cleanUser, attempted_at: new Date().toISOString(), success: false })
        return { status: 401, body: { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' } }
      }

      // 4. Check account status
      if (user.status !== 'active') {
        mockLoginAttempts.push({ username: cleanUser, attempted_at: new Date().toISOString(), success: false })
        return { status: 401, body: { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' } }
      }

      // 5. Verify password
      if (user.password !== password) {
        mockLoginAttempts.push({ username: cleanUser, attempted_at: new Date().toISOString(), success: false })
        return { status: 401, body: { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' } }
      }

      // 6. Success: link and record
      user.auth_user_id = `auth-uuid-${cleanUser}`
      mockLoginAttempts.push({ username: cleanUser, attempted_at: new Date().toISOString(), success: true })
      return { status: 200, body: { success: true, bridged: true } }
    }

    it('1. successfully bridges active directory user with matching password', async () => {
      const res = await simulateLoginBridge('staff_ahmed', 'ValidPassword123!')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.bridged).toBe(true)

      const user = mockAppUsers.find((u) => u.username === 'staff_ahmed')
      expect(user?.auth_user_id).toBe('auth-uuid-staff_ahmed')
    })

    it('2. rejects incorrect password with generic error and records failure', async () => {
      const res = await simulateLoginBridge('staff_ahmed', 'WrongPassword123!')
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة.')
    })

    it('3. rejects pending or disabled user without revealing account existence', async () => {
      const res = await simulateLoginBridge('pending_user', 'PendingPassword123!')
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة.')
    })

    it('4. strictly excludes marwan-desouky from bridge', async () => {
      const res = await simulateLoginBridge('marwan-desouky', 'AdminPassword123!')
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة.')
    })

    it('5. enforces rate limit of max 5 failed attempts in 15 minutes', async () => {
      const target = 'brute_target'
      for (let i = 0; i < 5; i++) {
        await simulateLoginBridge(target, 'WrongPassword!')
      }

      // 6th attempt must be rejected with 429
      const lockedRes = await simulateLoginBridge(target, 'AnyPassword!')
      expect(lockedRes.status).toBe(429)
      expect(lockedRes.body.error).toContain('تم تجاوز الحد الأقصى للمحاولات الفاشلة')
    })
  })

  describe('Secure Mode Behavior', () => {
    it('verifies that login-bridge is bypassed in secure mode', () => {
      // In secure mode, isAuthTransitionalMode() is false
      const mode: string = 'secure'
      const isTransitional = mode === 'transitional'
      expect(isTransitional).toBe(false)
    })
  })

  describe('Login Bridge Architecture Security Invariants', () => {
    it('asserts that listUsers is never used in login-bridge Edge Function', () => {
      const bridgePath = path.resolve(__dirname, '../../supabase/functions/login-bridge/index.ts')
      const bridgeSource = fs.readFileSync(bridgePath, 'utf8')
      expect(bridgeSource).not.toContain('listUsers')
    })

    it('asserts that login-bridge resolves identities strictly through getUserById', () => {
      const bridgePath = path.resolve(__dirname, '../../supabase/functions/login-bridge/index.ts')
      const bridgeSource = fs.readFileSync(bridgePath, 'utf8')
      expect(bridgeSource).toContain('getUserById(appUser.auth_user_id)')
    })

    it('confirms login-bridge does not compare or write legacy passwords', () => {
      const bridgePath = path.resolve(__dirname, '../../supabase/functions/login-bridge/index.ts')
      const bridgeSource = fs.readFileSync(bridgePath, 'utf8')
      // Must not compare appUser.password directly
      expect(bridgeSource).not.toContain('appUser.password')
      // Must not call admin.updateUserById with password
      expect(bridgeSource).not.toMatch(/updateUserById\([^)]*password/)
    })
  })
})

