import { describe, it, expect } from 'vitest'
import { isValidEmployeeId, formatEmployeeId } from '../../src/lib/employeeIdentity'

describe('Unique ID and Username Login Flow Suite', () => {
    it('correctly discriminates between Employee Unique ID, username, and email identifiers', () => {
        function identifyLoginInputType(input: string): 'employee_id' | 'email' | 'username' {
            const clean = input.trim()
            if (clean.includes('@')) return 'email'
            if (isValidEmployeeId(clean.toUpperCase())) return 'employee_id'
            return 'username'
        }

        expect(identifyLoginInputType('WH-EMP-000001')).toBe('employee_id')
        expect(identifyLoginInputType('pur-adm-000042')).toBe('employee_id')
        expect(identifyLoginInputType('SYS-ADM-000001')).toBe('employee_id')
        expect(identifyLoginInputType('marwandesouqhi@gmail.com')).toBe('email')
        expect(identifyLoginInputType('marwan-desouky')).toBe('username')
        expect(identifyLoginInputType('store_keeper')).toBe('username')
    })

    it('sanitizes and normalizes employee ID before lookup', () => {
        const rawInput = '  wh-emp-000015 '
        const sanitized = formatEmployeeId(rawInput)
        expect(sanitized).toBe('WH-EMP-000015')
        expect(isValidEmployeeId(sanitized)).toBe(true)
    })

    it('enforces account status gating on authentication', () => {
        interface AccountRecord {
            username: string
            employeeId?: string
            status: 'active' | 'suspended' | 'pending_activation'
        }

        const activeAccount: AccountRecord = {
            username: 'ahmed_wh',
            employeeId: 'WH-EMP-000001',
            status: 'active',
        }

        const suspendedAccount: AccountRecord = {
            username: 'tariq_pur',
            employeeId: 'PUR-EMP-000002',
            status: 'suspended',
        }

        const pendingAccount: AccountRecord = {
            username: 'new_user',
            employeeId: 'WH-EMP-000003',
            status: 'pending_activation',
        }

        function verifyAccountCanLogin(acc: AccountRecord): { allowed: boolean; reason?: string } {
            if (acc.status === 'suspended') {
                return { allowed: false, reason: 'هذا الحساب موقوف حالياً من قِبل الإدارة.' }
            }
            if (acc.status === 'pending_activation') {
                return { allowed: false, reason: 'الحساب بانتظار إدخال كود التفعيل لتنشيطه.' }
            }
            return { allowed: true }
        }

        expect(verifyAccountCanLogin(activeAccount).allowed).toBe(true)
        expect(verifyAccountCanLogin(suspendedAccount).allowed).toBe(false)
        expect(verifyAccountCanLogin(suspendedAccount).reason).toContain('موقوف')
        expect(verifyAccountCanLogin(pendingAccount).allowed).toBe(false)
        expect(verifyAccountCanLogin(pendingAccount).reason).toContain('كود التفعيل')
    })
})
