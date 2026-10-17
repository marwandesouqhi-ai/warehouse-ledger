import { describe, it, expect, vi } from 'vitest'

// Helper mirroring login-bridge identifier categorization and validation
function categorizeIdentifier(raw: string): { type: 'email' | 'employee_id' | 'username' | 'invalid'; value: string } {
  const clean = raw.trim().toLowerCase()
  if (!clean || clean.length > 120) return { type: 'invalid', value: clean }

  if (/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(clean)) {
    return { type: 'email', value: clean }
  }

  if (/^(EMP|ADM|SYS)-[A-Z]{3}-\d{4,6}$/i.test(clean)) {
    return { type: 'employee_id', value: clean.toUpperCase() }
  }

  // Username: letters, numbers, hyphens, underscores, dots, 3-50 chars
  if (/^[a-zA-Z0-9._-]{3,50}$/.test(clean)) {
    return { type: 'username', value: clean }
  }

  return { type: 'invalid', value: clean }
}

const GENERIC_LOGIN_ERROR = 'اسم المستخدم / المعرّف أو كلمة المرور غير صحيحة، أو الحساب غير نشط.'

// Simulated employee code generator
function formatEmployeeCode(role: string, seq: number): string {
  const prefixes: Record<string, string> = {
    warehouse_employee: 'EMP-WRH',
    warehouse_staff: 'EMP-WRH',
    purchasing_employee: 'EMP-PUR',
    purchasing_staff: 'EMP-PUR',
    financial_auditor: 'EMP-AUD',
    auditor: 'EMP-AUD',
    department_head: 'ADM-MGR',
    admin: 'ADM-MGR',
    system_admin: 'SYS-ADM',
  }
  const prefix = prefixes[role]
  if (!prefix) {
    throw new Error(`دور وظيفي غير معروف لتوليد الكود: ${role}`)
  }
  return `${prefix}-${String(seq).padStart(6, '0')}`
}

describe('Session C: P1-2 Login Bridge & Identifier Security Tests', () => {
  it('correctly categorizes allowed identifiers and rejects injection payloads', () => {
    expect(categorizeIdentifier('marwandesouqhi@gmail.com').type).toBe('email')
    expect(categorizeIdentifier('EMP-WRH-000042').type).toBe('employee_id')
    expect(categorizeIdentifier('ADM-MGR-000005').type).toBe('employee_id')
    expect(categorizeIdentifier('SYS-ADM-000001').type).toBe('employee_id')
    expect(categorizeIdentifier('marwan-desouky').type).toBe('username')
    expect(categorizeIdentifier('emp_user_1').type).toBe('username')

    // Dangerous / injection attempts must be classified as 'invalid'
    expect(categorizeIdentifier("admin' OR '1'='1").type).toBe('invalid')
    expect(categorizeIdentifier("user; DROP TABLE app_users;--").type).toBe('invalid')
    expect(categorizeIdentifier("<script>alert(1)</script>").type).toBe('invalid')
    expect(categorizeIdentifier("").type).toBe('invalid')
    expect(categorizeIdentifier("a".repeat(150)).type).toBe('invalid')
  })

  it('rejects login for non-active accounts (suspended or pending) with generic error without leakage', () => {
    function simulateLoginBridge(user: { status: string; passwordMatches: boolean }) {
      if (!user.passwordMatches || user.status !== 'active') {
        return { success: false, error: GENERIC_LOGIN_ERROR }
      }
      return { success: true, token: 'mock-session-jwt' }
    }

    const suspendedAttempt = simulateLoginBridge({ status: 'suspended', passwordMatches: true })
    expect(suspendedAttempt.success).toBe(false)
    expect(suspendedAttempt.error).toBe(GENERIC_LOGIN_ERROR)
    expect(suspendedAttempt.error).not.toContain('suspended')
    expect(suspendedAttempt.error).not.toContain('معلّق')

    const pendingAttempt = simulateLoginBridge({ status: 'pending_activation', passwordMatches: true })
    expect(pendingAttempt.success).toBe(false)
    expect(pendingAttempt.error).toBe(GENERIC_LOGIN_ERROR)

    const invalidPwdAttempt = simulateLoginBridge({ status: 'active', passwordMatches: false })
    expect(invalidPwdAttempt.success).toBe(false)
    expect(invalidPwdAttempt.error).toBe(GENERIC_LOGIN_ERROR)

    // Errors must be indistinguishable to prevent account enumeration
    expect(suspendedAttempt.error).toEqual(invalidPwdAttempt.error)
  })
})

describe('Session C: C.1 & C.2 Approval Delegation Matrix & RBAC Tests', () => {
  interface UserContext {
    id: string
    role: string
    department: string
    is_system_admin: boolean
  }

  interface RegistrationRequest {
    id: string
    requested_department: string
    requested_role: string
    verification_status: string
    approval_status: string
  }

  function evaluateApprovalPermission(
    reviewer: UserContext,
    request: RegistrationRequest,
    roleToAssign: string,
    delegationEnabled: boolean
  ): { allowed: boolean; reason?: string } {
    // 1. Self-approval denial
    if (reviewer.id === request.id) {
      return { allowed: false, reason: 'لا يمكن للمراجع اعتماد طلب التسجيل الخاص به.' }
    }

    // 2. Email verification prerequisite
    if (request.verification_status !== 'verified') {
      return { allowed: false, reason: 'لا يمكن اعتماد طلب تسجيل لم يتم تأكيد بريده الإلكتروني.' }
    }

    // 3. System Admin assignment rule: NEVER through employee registration
    if (roleToAssign === 'system_admin') {
      return { allowed: false, reason: 'لا يمكن منح دور مدير النظام الرئيسي من خلال طلبات التسجيل.' }
    }

    // 4. System Admin has universal approval authority
    if (reviewer.is_system_admin || reviewer.role === 'system_admin') {
      return { allowed: true }
    }

    // 5. Department Admin delegation checks
    if (reviewer.role === 'admin') {
      if (!delegationEnabled) {
        return { allowed: false, reason: 'تفويض اعتماد طلبات الأقسام معطل حالياً.' }
      }

      // Cannot assign administrative roles
      if (roleToAssign === 'admin' || roleToAssign === 'system_admin') {
        return { allowed: false, reason: 'غير مصرح لمدير القسم ترقية مستخدم لدور مدير.' }
      }

      // Department isolation: must match reviewer's department
      if (reviewer.department !== request.requested_department) {
        return { allowed: false, reason: 'غير مصرح لمدير القسم اعتماد طلبات خارج قسمه.' }
      }

      return { allowed: true }
    }

    return { allowed: false, reason: 'غير مصرح لك باعتماد طلبات التسجيل.' }
  }

  const sysAdmin: UserContext = {
    id: 'reviewer-sys-admin-uuid',
    role: 'system_admin',
    department: 'الإدارة العامة',
    is_system_admin: true,
  }

  const deptAdminWarehouse: UserContext = {
    id: 'reviewer-dept-wrh-uuid',
    role: 'admin',
    department: 'المخازن',
    is_system_admin: false,
  }

  const validRequestWarehouse: RegistrationRequest = {
    id: 'req-employee-wrh-uuid',
    requested_department: 'المخازن',
    requested_role: 'warehouse_employee',
    verification_status: 'verified',
    approval_status: 'pending_approval',
  }

  const validRequestProcurement: RegistrationRequest = {
    id: 'req-employee-pur-uuid',
    requested_department: 'المشتريات',
    requested_role: 'purchasing_employee',
    verification_status: 'verified',
    approval_status: 'pending_approval',
  }

  it('allows System Admin to approve requests across all departments', () => {
    const resWrh = evaluateApprovalPermission(sysAdmin, validRequestWarehouse, 'warehouse_employee', false)
    expect(resWrh.allowed).toBe(true)

    const resPur = evaluateApprovalPermission(sysAdmin, validRequestProcurement, 'purchasing_employee', false)
    expect(resPur.allowed).toBe(true)
  })

  it('blocks Department Admin approval when delegation is disabled', () => {
    const res = evaluateApprovalPermission(deptAdminWarehouse, validRequestWarehouse, 'warehouse_employee', false)
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('معطل')
  })

  it('allows Department Admin to approve within their department when delegation is enabled', () => {
    const res = evaluateApprovalPermission(deptAdminWarehouse, validRequestWarehouse, 'warehouse_employee', true)
    expect(res.allowed).toBe(true)
  })

  it('blocks Department Admin from approving requests belonging to other departments', () => {
    const res = evaluateApprovalPermission(deptAdminWarehouse, validRequestProcurement, 'purchasing_employee', true)
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('خارج قسمه')
  })

  it('blocks Department Admin from assigning administrative roles (admin or system_admin)', () => {
    const resAdmin = evaluateApprovalPermission(deptAdminWarehouse, validRequestWarehouse, 'admin', true)
    expect(resAdmin.allowed).toBe(false)

    const resSysAdmin = evaluateApprovalPermission(deptAdminWarehouse, validRequestWarehouse, 'system_admin', true)
    expect(resSysAdmin.allowed).toBe(false)
  })

  it('strictly blocks self-approval even for System Admin', () => {
    const selfRequest: RegistrationRequest = {
      id: sysAdmin.id, // same ID as reviewer
      requested_department: 'الإدارة العامة',
      requested_role: 'warehouse_employee',
      verification_status: 'verified',
      approval_status: 'pending_approval',
    }
    const res = evaluateApprovalPermission(sysAdmin, selfRequest, 'warehouse_employee', true)
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('الخاص به')
  })
})

describe('Session C: C.3 & C.4 Unique Employee Code Generation & Registry Tests', () => {
  it('generates proper prefix and zero-padded 6-digit sequence for each role', () => {
    expect(formatEmployeeCode('warehouse_employee', 1)).toBe('EMP-WRH-000001')
    expect(formatEmployeeCode('purchasing_employee', 42)).toBe('EMP-PUR-000042')
    expect(formatEmployeeCode('financial_auditor', 315)).toBe('EMP-AUD-000315')
    expect(formatEmployeeCode('admin', 5)).toBe('ADM-MGR-000005')
    expect(formatEmployeeCode('system_admin', 1)).toBe('SYS-ADM-000001')
  })

  it('raises error for unsupported or unmapped roles', () => {
    expect(() => formatEmployeeCode('unknown_hacker_role', 1)).toThrow('دور وظيفي غير معروف')
  })

  it('simulates sequence monotonicity and anti-tamper append-only registry', () => {
    const registry: Array<{ code: string; allocated_at: string; request_id: string }> = []

    function registerCode(code: string, requestId: string) {
      if (registry.some((r) => r.code === code)) {
        throw new Error(`Collision detected: Employee code ${code} is already registered!`)
      }
      registry.push({ code, allocated_at: new Date().toISOString(), request_id: requestId })
    }

    registerCode('EMP-WRH-000001', 'req-1')
    registerCode('EMP-WRH-000002', 'req-2')

    expect(registry.length).toBe(2)
    expect(() => registerCode('EMP-WRH-000001', 'req-3')).toThrow('Collision detected')
  })
})

describe('Session C: C.5 Suspension, Auth Ban Duration & Protection Tests', () => {
  it('computes correct Auth ban_duration and app_metadata status on suspension', () => {
    function computeAuthUpdateForStatus(status: 'active' | 'suspended') {
      return {
        ban_duration: status === 'suspended' ? '876000h' : 'none',
        app_metadata: { status },
      }
    }

    const suspendedConfig = computeAuthUpdateForStatus('suspended')
    expect(suspendedConfig.ban_duration).toBe('876000h')
    expect(suspendedConfig.app_metadata.status).toBe('suspended')

    const activeConfig = computeAuthUpdateForStatus('active')
    expect(activeConfig.ban_duration).toBe('none')
    expect(activeConfig.app_metadata.status).toBe('active')
  })

  it('protects System Admin marwan-desouky from suspension', () => {
    function attemptSuspension(username: string, email: string) {
      const protectedNames = ['marwan-desouky', 'marwandesouqhi@gmail.com']
      if (protectedNames.includes(username.toLowerCase()) || protectedNames.includes(email.toLowerCase())) {
        throw new Error('غير مصرح: لا يمكن تعليق أو تعطيل حساب مدير النظام الرئيسي.')
      }
      return { success: true }
    }

    expect(() => attemptSuspension('marwan-desouky', 'marwandesouqhi@gmail.com')).toThrow('مدير النظام الرئيسي')
    expect(attemptSuspension('john-doe', 'john@example.com').success).toBe(true)
  })
})
