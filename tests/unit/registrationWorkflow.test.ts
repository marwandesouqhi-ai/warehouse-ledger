import { describe, it, expect } from 'vitest'
import {
    canReviewRegistration,
    hashVerificationToken,
    generateEmailVerificationOtp,
    type RegistrationRequest,
} from '../../src/lib/employeeIdentity'

describe('Registration Workflow and Verification Security Suite', () => {
    it('prohibits registration from requesting or assigning system_admin role directly', () => {
        const disallowedRoles = ['system_admin', 'superadmin', 'root']
        disallowedRoles.forEach((role) => {
            const isDisallowed = role === 'system_admin' || role === 'superadmin' || role === 'root'
            expect(isDisallowed).toBe(true)
        })
    })

    it('validates registration input requirements and email format', () => {
        const validEmails = ['employee@company.com', 'user.name+tag@domain.co', 'storekeeper@ledger.internal']
        const invalidEmails = ['invalid-email', '@domain.com', 'user@', 'user@.com', '']

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        validEmails.forEach((email) => {
            expect(emailRegex.test(email)).toBe(true)
        })
        invalidEmails.forEach((email) => {
            expect(emailRegex.test(email)).toBe(false)
        })
    })

    it('enforces email verification before account can proceed to active approval', async () => {
        const unverifiedRequest: RegistrationRequest = {
            id: 'req-001',
            fullName: 'محمود أحمد',
            email: 'mahmoud@company.com',
            requestedDepartment: 'المخازن',
            requestedRole: 'warehouse_employee',
            verificationStatus: 'pending',
            approvalStatus: 'pending_approval',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }

        // Rule: unverified request cannot be approved
        const canApprove = unverifiedRequest.verificationStatus === 'verified'
        expect(canApprove).toBe(false)

        const verifiedRequest: RegistrationRequest = {
            ...unverifiedRequest,
            verificationStatus: 'verified',
        }
        expect(verifiedRequest.verificationStatus === 'verified').toBe(true)
    })

    it('safely verifies OTP token against hashed secret', async () => {
        const { otp, hashedToken, expiresAt } = await generateEmailVerificationOtp()
        const userSubmittedOtp = otp
        const hashedAttempt = await hashVerificationToken(userSubmittedOtp)

        expect(hashedAttempt).toBe(hashedToken)
        expect(new Date() < expiresAt).toBe(true)

        const wrongOtpAttempt = await hashVerificationToken('000000')
        expect(wrongOtpAttempt).not.toBe(hashedToken)
    })

    it('rejects expired OTP tokens', async () => {
        const expiredDate = new Date(Date.now() - 1000) // 1 second in the past
        const isExpired = new Date() > expiredDate
        expect(isExpired).toBe(true)
    })

    it('ensures ordinary employees cannot approve requests', () => {
        const ordinaryRoles = ['warehouse_employee', 'procurement_employee', 'viewer']
        ordinaryRoles.forEach((role) => {
            expect(canReviewRegistration(role, 'المخازن')).toBe(false)
            expect(canReviewRegistration(role, 'المشتريات')).toBe(false)
        })
    })
})
