import { describe, it, expect } from 'vitest'
import {
    isValidEmployeeId,
    formatEmployeeId,
    parseEmployeeId,
    generateEmailVerificationOtp,
    hashVerificationToken,
    canReviewRegistration,
} from '../../src/lib/employeeIdentity'

describe('Employee Unique ID Unit Tests', () => {
    it('validates compliant Employee Unique IDs across all supported roles and departments', () => {
        expect(isValidEmployeeId('WH-EMP-000001')).toBe(true)
        expect(isValidEmployeeId('WH-ADM-000001')).toBe(true)
        expect(isValidEmployeeId('PUR-EMP-000001')).toBe(true)
        expect(isValidEmployeeId('PUR-ADM-000001')).toBe(true)
        expect(isValidEmployeeId('SYS-ADM-000001')).toBe(true)
        expect(isValidEmployeeId('WH-EMP-999999')).toBe(true)
    })

    it('rejects malformed or invalid employee ID structures', () => {
        expect(isValidEmployeeId('wh-emp-000001')).toBe(false) // Lowercase rejected
        expect(isValidEmployeeId('WH-EMP-1')).toBe(false) // Not 6 digits
        expect(isValidEmployeeId('WH-EMP-00001')).toBe(false) // 5 digits
        expect(isValidEmployeeId('WH-EMP-0000001')).toBe(false) // 7 digits
        expect(isValidEmployeeId('SALES-EMP-000001')).toBe(false) // Invalid department
        expect(isValidEmployeeId('WH-MGR-000001')).toBe(false) // Invalid role code
        expect(isValidEmployeeId('')).toBe(false)
        expect(isValidEmployeeId('WH_EMP_000001')).toBe(false)
    })

    it('formats unpadded or whitespace-laden employee IDs correctly', () => {
        expect(formatEmployeeId('  wh-emp-000042  ')).toBe('WH-EMP-000042')
        expect(formatEmployeeId('pur-adm-123')).toBe('PUR-ADM-000123')
    })

    it('correctly parses department and role categories from valid IDs', () => {
        const whEmp = parseEmployeeId('WH-EMP-000123')
        expect(whEmp).not.toBeNull()
        expect(whEmp?.deptPrefix).toBe('WH')
        expect(whEmp?.rolePrefix).toBe('EMP')
        expect(whEmp?.sequenceNumber).toBe(123)
        expect(whEmp?.departmentName).toBe('المخازن')
        expect(whEmp?.roleCategory).toBe('warehouse_employee')

        const purAdm = parseEmployeeId('PUR-ADM-000005')
        expect(purAdm?.departmentName).toBe('المشتريات')
        expect(purAdm?.roleCategory).toBe('procurement_admin')

        const sysAdm = parseEmployeeId('SYS-ADM-000001')
        expect(sysAdm?.departmentName).toBe('الإدارة العامة')
        expect(sysAdm?.roleCategory).toBe('system_admin')
    })

    it('generates cryptographically secure 6-digit OTP with 10-minute validity', async () => {
        const otpData = await generateEmailVerificationOtp()
        expect(otpData.otp).toMatch(/^\d{6}$/)
        expect(otpData.hashedToken).toBeDefined()
        expect(otpData.hashedToken.length).toBe(64) // SHA-256 hex length
        expect(otpData.expiresAt.getTime()).toBeGreaterThan(Date.now())
        expect(otpData.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000 + 1000)
    })

    it('consistently hashes verification tokens using SHA-256', async () => {
        const hash1 = await hashVerificationToken('123456')
        const hash2 = await hashVerificationToken('123456')
        const hashOther = await hashVerificationToken('654321')
        expect(hash1).toBe(hash2)
        expect(hash1).not.toBe(hashOther)
    })

    it('strictly enforces registration review permissions', () => {
        // System admin can review all departments
        expect(canReviewRegistration('system_admin', 'المخازن')).toBe(true)
        expect(canReviewRegistration('system_admin', 'المشتريات')).toBe(true)

        // Department admins can only review their respective department
        expect(canReviewRegistration('warehouse_admin', 'المخازن')).toBe(true)
        expect(canReviewRegistration('warehouse_admin', 'المشتريات')).toBe(false)
        expect(canReviewRegistration('procurement_admin', 'المشتريات')).toBe(true)
        expect(canReviewRegistration('procurement_admin', 'المخازن')).toBe(false)

        // Ordinary employees cannot review any registration requests
        expect(canReviewRegistration('warehouse_employee', 'المخازن')).toBe(false)
        expect(canReviewRegistration('procurement_employee', 'المشتريات')).toBe(false)
        expect(canReviewRegistration('viewer', 'المخازن')).toBe(false)
    })
})
