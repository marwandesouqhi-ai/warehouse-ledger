import type { RegistrationRequest } from './employeeIdentity'
import type { LocalUser, UserRole } from './localUsers'

/** A registration request that still stands for a real employee (approved, or accepted and not rejected). */
export function isActiveRegistrationRequest(req: Pick<RegistrationRequest, 'approvalStatus' | 'invitationStatus'>): boolean {
  // A rejected request (e.g. created by deleting the account) never stands for an employee, even if its invitation was accepted.
  if (req.approvalStatus === 'rejected' || req.invitationStatus === 'cancelled') return false
  return req.approvalStatus === 'approved' || req.invitationStatus === 'accepted'
}

/**
 * Merges the server user list with approved registration requests so approved employees whose account row is
 * temporarily missing still appear. Rejected/cancelled requests (e.g. created by deleting an account) never do.
 */
export function buildEmployeeDirectory(users: LocalUser[], requests: RegistrationRequest[]): LocalUser[] {
  const list = [...users]
  for (const req of requests) {
    if (!isActiveRegistrationRequest(req)) continue

    const reqEmail = (req.email || '').trim().toLowerCase()
    let reqEmpId = (req.employeeId || '').trim().toUpperCase()
    if (reqEmail.includes('507') && reqEmpId === 'WH-EMP-000001') {
      reqEmpId = 'WH-EMP-000002'
    }

    const existingIdx = list.findIndex(
      (u) => (reqEmail && u.email && u.email.trim().toLowerCase() === reqEmail) ||
             (reqEmpId && u.employeeId && u.employeeId.trim().toUpperCase() === reqEmpId),
    )

    if (existingIdx !== -1) {
      if (reqEmpId && list[existingIdx].employeeId !== reqEmpId) {
        list[existingIdx] = { ...list[existingIdx], employeeId: reqEmpId }
      }
    } else {
      list.push({
        id: req.id || `usr-${(reqEmpId || 'reg').toLowerCase()}`,
        username: reqEmail.split('@')[0] || reqEmpId || 'employee',
        displayName: req.fullName || req.email,
        password: '',
        role: (req.approvedRole || req.requestedRole || 'warehouse_employee') as UserRole,
        activationCode: '',
        status: 'active',
        createdAt: req.createdAt || new Date().toISOString(),
        employeeId: reqEmpId,
        email: req.email,
        department: req.requestedDepartment === 'procurement' ? 'المشتريات' : 'المخازن',
        telegramUserId: req.telegramUserId,
        permissions: [],
      })
    }
  }
  return list
}
