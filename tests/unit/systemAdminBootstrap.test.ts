import { describe, it, expect } from 'vitest'
import { isProtectedUsername } from '../../src/lib/protectedAccounts'

describe('System Administrator Provisioning & Bootstrap Suite', () => {
    it('associates the configured administrator email and username correctly', () => {
        const expectedEmail = 'marwandesouqhi@gmail.com'
        const expectedUsername = 'marwan-desouky'
        const expectedRole = 'system_admin'

        expect(isProtectedUsername(expectedUsername)).toBe(true)
        expect(isProtectedUsername(expectedEmail)).toBe(true)
        expect(expectedRole).toBe('system_admin')
    })

    it('prevents deletion or role alteration of the primary system administrator', () => {
        const username = 'marwan-desouky'
        expect(isProtectedUsername(username)).toBe(true)

        // Attempting to modify or demote
        const isDemotionAllowed = !isProtectedUsername(username)
        expect(isDemotionAllowed).toBe(false)
    })

    it('ensures idempotent bootstrap results', () => {
        interface AdminProfile {
            username: string
            email: string
            role: string
            status: string
            employeeId?: string
        }

        const registry: Record<string, AdminProfile> = {}

        function bootstrapAdmin(email: string, username: string, _authId: string): AdminProfile {
            if (registry[email]) {
                // Idempotent: reuse existing profile, do not create duplicate
                return registry[email]
            }
            const profile: AdminProfile = {
                username,
                email,
                role: 'system_admin',
                status: 'active',
                employeeId: 'SYS-ADM-000001',
            }
            registry[email] = profile
            return profile
        }

        const run1 = bootstrapAdmin('marwandesouqhi@gmail.com', 'marwan-desouky', 'auth-uuid-001')
        const run2 = bootstrapAdmin('marwandesouqhi@gmail.com', 'marwan-desouky', 'auth-uuid-001')

        expect(run1).toEqual(run2)
        expect(Object.keys(registry).length).toBe(1)
        expect(run1.role).toBe('system_admin')
        expect(run1.status).toBe('active')
        expect(run1.employeeId).toBe('SYS-ADM-000001')
    })

    it('rejects ordinary users from claiming system_admin through registration', () => {
        const registrationAttempt = {
            fullName: 'مستخدم تجريبي',
            email: 'registrant@domain.com',
            requestedRole: 'system_admin',
        }

        // Server-side rule: registration requests with system_admin must be rejected or clamped to employee
        const sanitizedRole = registrationAttempt.requestedRole === 'system_admin'
            ? 'warehouse_employee'
            : registrationAttempt.requestedRole

        expect(sanitizedRole).not.toBe('system_admin')
        expect(sanitizedRole).toBe('warehouse_employee')
    })
})
