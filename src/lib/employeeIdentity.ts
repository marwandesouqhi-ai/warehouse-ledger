/**
 * src/lib/employeeIdentity.ts
 *
 * Core module for Employee Unique IDs, Registration Requests,
 * Verification Challenges, and Identity Mapping.
 */

export type EmployeeDepartment = 'warehouse' | 'procurement' | 'general'
export type EmployeeDepartmentArabic = 'المخازن' | 'المشتريات' | 'الإدارة العامة'

export type EmployeeRole =
  | 'warehouse_employee'
  | 'warehouse_admin'
  | 'procurement_employee'
  | 'procurement_admin'
  | 'system_admin'

export const DEPARTMENT_MAP: Record<string, { en: EmployeeDepartment; ar: EmployeeDepartmentArabic }> = {
  warehouse: { en: 'warehouse', ar: 'المخازن' },
  procurement: { en: 'procurement', ar: 'المشتريات' },
  general: { en: 'general', ar: 'الإدارة العامة' },
  'المخازن': { en: 'warehouse', ar: 'المخازن' },
  'المشتريات': { en: 'procurement', ar: 'المشتريات' },
  'الإدارة العامة': { en: 'general', ar: 'الإدارة العامة' },
}

export type RoleCategory = EmployeeRole

export type RegistrationRequest = {
  id: string
  fullName: string
  email: string
  telegramUserId?: number
  telegramUsername?: string
  requestedDepartment: string
  requestedRole: string
  verificationStatus: 'pending' | 'verified' | 'expired'
  approvalStatus: 'pending' | 'pending_approval' | 'approved' | 'rejected'
  approvedRole?: string
  employeeId?: string
  reviewedBy?: string
  reviewedAt?: string
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

/**
 * Regex pattern for Employee Unique IDs:
 * Examples: WH-EMP-000001, WH-ADM-000001, PUR-EMP-000001, PUR-ADM-000001, SYS-ADM-000001
 */
export const EMPLOYEE_ID_REGEX = /^(WH|PUR|SYS)-(EMP|ADM)-\d{6}$/

/**
 * Validates whether a given string is a valid Employee Unique ID format.
 * Strictly uppercase and properly structured (e.g. WH-EMP-000001).
 */
export function isValidEmployeeId(id: string | null | undefined): boolean {
  if (!id) return false
  return EMPLOYEE_ID_REGEX.test(id.trim())
}

/**
 * Formats role and sequence number into standard Employee Unique ID.
 * Also normalizes existing ID-like strings (e.g. 'wh-emp-000042' -> 'WH-EMP-000042').
 */
export function formatEmployeeId(idOrRole: string, sequenceNumber?: number): string {
  const clean = idOrRole.trim()

  if (sequenceNumber === undefined) {
    const match = clean.match(/^([a-zA-Z]+)-([a-zA-Z]+)-(\d+)$/)
    if (match) {
      const dept = match[1].toUpperCase()
      const role = match[2].toUpperCase()
      const num = match[3].padStart(6, '0')
      return `${dept}-${role}-${num}`
    }
    return clean.toUpperCase()
  }

  const cleanRole = idOrRole.toLowerCase().trim()
  let prefix = 'WH-EMP-'

  if (cleanRole === 'warehouse_employee' || cleanRole === 'warehouse_staff') {
    prefix = 'WH-EMP-'
  } else if (cleanRole === 'warehouse_admin') {
    prefix = 'WH-ADM-'
  } else if (cleanRole === 'procurement_employee' || cleanRole === 'purchasing_staff') {
    prefix = 'PUR-EMP-'
  } else if (cleanRole === 'procurement_admin') {
    prefix = 'PUR-ADM-'
  } else if (cleanRole === 'system_admin') {
    prefix = 'SYS-ADM-'
  } else if (cleanRole === 'admin') {
    prefix = 'WH-ADM-'
  }

  const paddedNum = String(Math.max(1, Math.floor(sequenceNumber))).padStart(6, '0')
  return `${prefix}${paddedNum}`
}

/**
 * Parses an Employee Unique ID into constituent parts.
 */
export function parseEmployeeId(id: string): {
  deptPrefix: string
  rolePrefix: string
  sequenceNumber: number
  department: EmployeeDepartment
  departmentName: string
  roleCategory: EmployeeRole
  roleType: 'employee' | 'admin' | 'system_admin'
  number: number
} | null {
  if (!isValidEmployeeId(id)) return null
  const clean = id.trim().toUpperCase()
  const parts = clean.split('-')
  const deptPrefix = parts[0]
  const rolePrefix = parts[1]
  const sequenceNumber = parseInt(parts[2], 10)

  let department: EmployeeDepartment = 'general'
  let departmentName = 'الإدارة العامة'
  if (deptPrefix === 'WH') {
    department = 'warehouse'
    departmentName = 'المخازن'
  } else if (deptPrefix === 'PUR') {
    department = 'procurement'
    departmentName = 'المشتريات'
  }

  let roleCategory: EmployeeRole = 'warehouse_employee'
  if (deptPrefix === 'WH' && rolePrefix === 'EMP') roleCategory = 'warehouse_employee'
  else if (deptPrefix === 'WH' && rolePrefix === 'ADM') roleCategory = 'warehouse_admin'
  else if (deptPrefix === 'PUR' && rolePrefix === 'EMP') roleCategory = 'procurement_employee'
  else if (deptPrefix === 'PUR' && rolePrefix === 'ADM') roleCategory = 'procurement_admin'
  else if (deptPrefix === 'SYS') roleCategory = 'system_admin'

  let roleType: 'employee' | 'admin' | 'system_admin' = rolePrefix === 'ADM' ? 'admin' : 'employee'
  if (deptPrefix === 'SYS') roleType = 'system_admin'

  return {
    deptPrefix,
    rolePrefix,
    sequenceNumber,
    department,
    departmentName,
    roleCategory,
    roleType,
    number: sequenceNumber,
  }
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP for email verification.
 */
export async function generateEmailVerificationOtp(): Promise<{
  otp: string
  hashedToken: string
  expiresAt: Date
}> {
  let code = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1)
    crypto.getRandomValues(array)
    code = (100000 + (array[0] % 900000)).toString()
  } else {
    code = Math.floor(100000 + Math.random() * 900000).toString()
  }
  const hashedToken = await hashVerificationToken(code)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  return { otp: code, hashedToken, expiresAt }
}

/**
 * Hash a verification token using SHA-256 for secure storage.
 */
export async function hashVerificationToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode((token || '').trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Authority check for registration review.
 * Only system_admin can approve administrative roles or cross-department requests.
 * Ordinary employees can NEVER approve any requests.
 */
export function canReviewRegistration(
  reviewerRole: string,
  targetDepartmentOrRole: string,
  targetDepartmentOptional?: string
): boolean {
  const rRole = (reviewerRole || '').toLowerCase().trim()
  const targetDept = (targetDepartmentOptional || targetDepartmentOrRole || '').toLowerCase().trim()
  const targetRole = targetDepartmentOptional ? targetDepartmentOrRole.toLowerCase().trim() : ''

  if (rRole === 'system_admin') {
    if (targetRole === 'system_admin') return false
    return true
  }

  if (rRole === 'warehouse_admin') {
    if (targetRole === 'warehouse_admin' || targetRole === 'system_admin' || targetRole === 'admin') return false
    return targetDept === 'warehouse' || targetDept === 'المخازن'
  }

  if (rRole === 'procurement_admin') {
    if (targetRole === 'procurement_admin' || targetRole === 'system_admin' || targetRole === 'admin') return false
    return targetDept === 'procurement' || targetDept === 'المشتريات'
  }

  return false
}
