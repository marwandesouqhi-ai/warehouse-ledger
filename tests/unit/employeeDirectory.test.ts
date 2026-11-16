import { describe, expect, it } from 'vitest'
import { buildEmployeeDirectory, isActiveRegistrationRequest } from '../../src/lib/employeeDirectory'
import type { RegistrationRequest } from '../../src/lib/employeeIdentity'
import type { LocalUser } from '../../src/lib/localUsers'

const request = (over: Partial<RegistrationRequest>): RegistrationRequest => ({
  id: 'req-1',
  fullName: 'Employee',
  email: 'employee@example.com',
  requestedDepartment: 'warehouse',
  requestedRole: 'warehouse_employee',
  verificationStatus: 'verified',
  approvalStatus: 'approved',
  employeeId: 'WH-EMP-000009',
  invitationStatus: 'accepted',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

const admin: LocalUser = {
  id: 'admin-1',
  username: 'owner',
  displayName: 'Owner',
  password: '',
  role: 'system_admin',
  activationCode: '',
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
  email: 'owner@example.com',
}

describe('employee directory built from users and registration requests', () => {
  it('shows an approved employee whose account row is missing', () => {
    const list = buildEmployeeDirectory([admin], [request({})])
    expect(list.map((u) => u.email)).toEqual(['owner@example.com', 'employee@example.com'])
  })

  it('never shows a rejected request, even when its invitation was accepted (deleted accounts)', () => {
    const rejected = request({ approvalStatus: 'rejected', invitationStatus: 'accepted' })
    expect(isActiveRegistrationRequest(rejected)).toBe(false)
    expect(buildEmployeeDirectory([admin], [rejected]).map((u) => u.id)).toEqual(['admin-1'])
  })

  it('ignores requests whose invitation was cancelled', () => {
    expect(buildEmployeeDirectory([admin], [request({ approvalStatus: 'pending_approval', invitationStatus: 'cancelled' })]).length).toBe(1)
  })

  it('does not duplicate an employee that already has an account (matched by e-mail)', () => {
    const existing: LocalUser = { ...admin, id: 'u-9', username: 'employee', role: 'warehouse_employee', email: 'employee@example.com' }
    const list = buildEmployeeDirectory([admin, existing], [request({})])
    expect(list.length).toBe(2)
    expect(list.find((u) => u.id === 'u-9')?.employeeId).toBe('WH-EMP-000009')
  })
})
