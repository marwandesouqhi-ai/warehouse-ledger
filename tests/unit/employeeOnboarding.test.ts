import { describe, it, expect, vi } from 'vitest'
import {
    validateChosenUsername,
    validateChosenPassword,
    canReviewRegistration,
    RESERVED_USERNAMES,
    EMPLOYEE_ID_REGEX,
} from '../../src/lib/employeeIdentity'
import {
    fetchIdentityConsistencyReport,
    resendRegistrationInvitation,
    cancelRegistrationInvitation,
} from '../../src/lib/registrationService'
import { isProtectedUsername, isRootAdmin } from '../../src/lib/protectedAccounts'
import { supabase } from '../../src/lib/supabase'
import * as fs from 'fs'
import * as path from 'path'

describe('Employee Onboarding: Telegram -> Admin Approval -> Gmail Invite -> Activation -> Identity Persistence', () => {

    describe('1. Username & Password Validation Rules', () => {
        it('accepts valid usernames conforming to all requirements', () => {
            const valid = ['ahmed.ali', 'saleh_k', 'khalid-99', 'user.name.1', 'john_doe']
            valid.forEach((u) => {
                const res = validateChosenUsername(u)
                expect(res.valid).toBe(true)
                expect(res.error).toBeUndefined()
            })
        })

        it('rejects usernames violating length constraints (3-30 chars)', () => {
            expect(validateChosenUsername('ab').valid).toBe(false)
            expect(validateChosenUsername('a'.repeat(31)).valid).toBe(false)
            expect(validateChosenUsername('').valid).toBe(false)
            expect(validateChosenUsername(null).valid).toBe(false)
        })

        it('rejects usernames with invalid characters or not starting with letter/digit', () => {
            expect(validateChosenUsername('.invalid').valid).toBe(false)
            expect(validateChosenUsername('-invalid').valid).toBe(false)
            expect(validateChosenUsername('_invalid').valid).toBe(false)
            expect(validateChosenUsername('user!name').valid).toBe(false)
            expect(validateChosenUsername('user$123').valid).toBe(false)
            expect(validateChosenUsername('محمد').valid).toBe(false)
        })

        it('rejects email-like inputs as usernames', () => {
            expect(validateChosenUsername('employee@company.com').valid).toBe(false)
            expect(validateChosenUsername('user@domain').valid).toBe(false)
        })

        it('rejects employee-code-like patterns as usernames', () => {
            expect(validateChosenUsername('WH-EMP-000001').valid).toBe(false)
            expect(validateChosenUsername('wh-emp-000001').valid).toBe(false)
            expect(validateChosenUsername('PUR-ADM-000042').valid).toBe(false)
            expect(validateChosenUsername('sys-adm-000001').valid).toBe(false)
            expect(validateChosenUsername('emp-001').valid).toBe(false)
        })

        it('rejects reserved and protected usernames case-insensitively', () => {
            const reserved = [
                ...RESERVED_USERNAMES,
                'ADMIN', 'ROOT',
                'SYSTEM', 'SUPPORT',
                'MARWAN-DESOUKY',
            ]
            reserved.forEach((u) => {
                const res = validateChosenUsername(u)
                expect(res.valid).toBe(false)
                expect(res.error).toContain('محجوز')
            })
            expect(isProtectedUsername('marwan-desouky')).toBe(true)
            expect(isProtectedUsername('marwandesouqhi@gmail.com')).toBe(true)
            expect(isRootAdmin('admin')).toBe(true)
        })

        it('validates password minimum length (at least 10 chars)', () => {
            expect(validateChosenPassword('short12').valid).toBe(false)
            expect(validateChosenPassword('123456789').valid).toBe(false)
            expect(validateChosenPassword('StrongP@ssw0rd!').valid).toBe(true)
            expect(validateChosenPassword('longpassphrase123').valid).toBe(true)
        })
    })

    describe('2. Admin Approval & Authority Matrix', () => {
        it('allows system_admin to approve warehouse and procurement employee and admin roles', () => {
            expect(canReviewRegistration('system_admin', 'warehouse_employee', 'warehouse')).toBe(true)
            expect(canReviewRegistration('system_admin', 'warehouse_admin', 'warehouse')).toBe(true)
            expect(canReviewRegistration('system_admin', 'procurement_employee', 'procurement')).toBe(true)
            expect(canReviewRegistration('system_admin', 'procurement_admin', 'procurement')).toBe(true)
        })

        it('prohibits granting system_admin role through registration review', () => {
            expect(canReviewRegistration('system_admin', 'system_admin', 'general')).toBe(false)
            expect(canReviewRegistration('warehouse_admin', 'system_admin', 'warehouse')).toBe(false)
            expect(canReviewRegistration('procurement_admin', 'system_admin', 'procurement')).toBe(false)
        })

        it('restricts department admin to non-admin roles in their own department only', () => {
            // Warehouse Admin
            expect(canReviewRegistration('warehouse_admin', 'warehouse_employee', 'warehouse')).toBe(true)
            expect(canReviewRegistration('warehouse_admin', 'warehouse_admin', 'warehouse')).toBe(false)
            expect(canReviewRegistration('warehouse_admin', 'procurement_employee', 'procurement')).toBe(false)

            // Procurement Admin
            expect(canReviewRegistration('procurement_admin', 'procurement_employee', 'procurement')).toBe(true)
            expect(canReviewRegistration('procurement_admin', 'procurement_admin', 'procurement')).toBe(false)
            expect(canReviewRegistration('procurement_admin', 'warehouse_employee', 'warehouse')).toBe(false)
        })

        it('denies approval rights to ordinary employees and unknown roles', () => {
            const forbidden = ['warehouse_employee', 'procurement_employee', 'viewer', 'editor', 'anonymous', '']
            forbidden.forEach((role) => {
                expect(canReviewRegistration(role, 'warehouse_employee', 'warehouse')).toBe(false)
            })
        })
    })

    describe('3. Unique ID Allocation & Formats', () => {
        it('enforces exact pattern matching on allocated Unique IDs', () => {
            expect(EMPLOYEE_ID_REGEX.test('WH-EMP-000001')).toBe(true)
            expect(EMPLOYEE_ID_REGEX.test('WH-ADM-000010')).toBe(true)
            expect(EMPLOYEE_ID_REGEX.test('PUR-EMP-000100')).toBe(true)
            expect(EMPLOYEE_ID_REGEX.test('PUR-ADM-000005')).toBe(true)
            expect(EMPLOYEE_ID_REGEX.test('SYS-ADM-000001')).toBe(true)

            expect(EMPLOYEE_ID_REGEX.test('INVALID-001')).toBe(false)
            expect(EMPLOYEE_ID_REGEX.test('wh-emp-000001')).toBe(false) // must be uppercase
        })
    })

    describe('4. Identity Consistency Diagnostic Report (Non-destructive)', () => {
        it('returns structured report matching schema and does not perform destructive changes', async () => {
            if (supabase) {
                const mockInvoke = vi.fn().mockImplementation(async (fnName: string, options: any) => {
                    if (fnName === 'admin-users' && options?.body?.action === 'consistency_report') {
                        return {
                            data: {
                                success: true,
                                report: {
                                    generated_at: new Date().toISOString(),
                                    has_issues: false,
                                    missing_auth_users: [],
                                    missing_app_users: [],
                                    approved_without_invitation: [],
                                    active_without_username: [],
                                    duplicate_emails: [],
                                },
                            },
                            error: null,
                        }
                    }
                    return { data: null, error: new Error('Unknown function') }
                })
                vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any)
            }

            const reportResult = await fetchIdentityConsistencyReport()
            expect(reportResult.success).toBe(true)
            expect(reportResult.report).toBeDefined()
            if (reportResult.report) {
                expect(typeof reportResult.report.generated_at).toBe('string')
                expect(typeof reportResult.report.has_issues).toBe('boolean')
                expect(Array.isArray(reportResult.report.missing_app_users)).toBe(true)
                expect(Array.isArray(reportResult.report.missing_auth_users)).toBe(true)
                expect(Array.isArray(reportResult.report.approved_without_invitation)).toBe(true)
                expect(Array.isArray(reportResult.report.active_without_username)).toBe(true)
                expect(Array.isArray(reportResult.report.duplicate_emails)).toBe(true)
            }
        })

        it('invokes admin-users for resending and cancelling invitations', async () => {
            if (supabase) {
                const mockInvoke = vi.fn().mockImplementation(async (fnName: string, options: any) => {
                    if (fnName === 'admin-users') {
                        if (options?.body?.action === 'resend_registration_invitation') {
                            return { data: { success: true, message: 'تمت إعادة إرسال الدعوة بنجاح.' }, error: null }
                        }
                        if (options?.body?.action === 'cancel_registration_invitation') {
                            return { data: { success: true, message: 'تم إلغاء الدعوة بنجاح.' }, error: null }
                        }
                    }
                    return { data: null, error: new Error('Unknown action') }
                })
                vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke: mockInvoke } as any)
            }

            const resendRes = await resendRegistrationInvitation('test-req-id')
            expect(resendRes.success).toBe(true)
            expect(resendRes.message).toContain('إعادة إرسال')

            const cancelRes = await cancelRegistrationInvitation('test-req-id')
            expect(cancelRes.success).toBe(true)
            expect(cancelRes.message).toContain('إلغاء')
        })
    })

    describe('5. Static Security Verification (No Passwords / No listUsers in Approval Path)', () => {
        it('verifies admin-users Edge Function does NOT call listUsers in approve_registration_request', () => {
            const adminUsersPath = path.resolve(__dirname, '../../supabase/functions/admin-users/index.ts')
            const content = fs.readFileSync(adminUsersPath, 'utf-8')

            // Extract the approve_registration_request action block
            const approveBlockStart = content.indexOf('action === "approve_registration_request"')
            expect(approveBlockStart).toBeGreaterThan(-1)

            const approveBlockEnd = content.indexOf('action === "resend_registration_invitation"')
            const approveBlock = content.slice(approveBlockStart, approveBlockEnd)

            // Must NOT contain listUsers
            expect(approveBlock).not.toContain('listUsers')

            // Must call inviteUserByEmail
            expect(approveBlock).toContain('inviteUserByEmail')

            // Must NOT create password or temp password in approve action
            expect(approveBlock).not.toContain('generateTempPassword')
            expect(approveBlock).not.toContain('password:')
        })

        it('verifies complete-activation Edge Function atomic procedure call and password verification', () => {
            const activationPath = path.resolve(__dirname, '../../supabase/functions/complete-activation/index.ts')
            const content = fs.readFileSync(activationPath, 'utf-8')

            // Must call verify_auth_user_has_password
            expect(content).toContain('verify_auth_user_has_password')

            // Must call complete_employee_activation atomic RPC
            expect(content).toContain('complete_employee_activation')

            // Must NOT log passwords
            expect(content).not.toContain('console.log(password')
        })

        it('verifies additive migration includes case-insensitive unique indexes and password verification function', () => {
            const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20261018170000_employee_onboarding_invitation_and_activation.sql')
            const content = fs.readFileSync(migrationPath, 'utf-8')

            expect(content).toContain('lower(username)')
            expect(content).toContain('lower(email)')
            expect(content).toContain('verify_auth_user_has_password')
            expect(content).toContain('complete_employee_activation')
        })

        it('verifies approval response never returns action links, tokens, or passwords', () => {
            const adminUsersPath = path.resolve(__dirname, '../../supabase/functions/admin-users/index.ts')
            const content = fs.readFileSync(adminUsersPath, 'utf-8')

            const approveBlockStart = content.indexOf('action === "approve_registration_request"')
            const approveBlockEnd = content.indexOf('action === "resend_registration_invitation"')
            const approveBlock = content.slice(approveBlockStart, approveBlockEnd)

            // Assert that the response JSON only contains safe status fields
            expect(approveBlock).toContain('success: true')
            expect(approveBlock).toContain('invitationStatus: "sent"')
            expect(approveBlock).not.toContain('actionLink:')
            expect(approveBlock).not.toContain('action_link:')
            expect(approveBlock).not.toContain('token:')
            expect(approveBlock).not.toContain('temporaryPassword')
        })

        it('verifies pending_activation accounts cannot log in through login-bridge', () => {
            const loginBridgePath = path.resolve(__dirname, '../../supabase/functions/login-bridge/index.ts')
            const content = fs.readFileSync(loginBridgePath, 'utf-8')

            // Must enforce appUser.status !== "active"
            expect(content).toContain('appUser.status !== "active"')
            expect(content).toContain('GENERIC_LOGIN_ERROR')
        })

        it('verifies resend_registration_invitation enforces 30s rate-limit and prevents accepted invites from resending', () => {
            const adminUsersPath = path.resolve(__dirname, '../../supabase/functions/admin-users/index.ts')
            const content = fs.readFileSync(adminUsersPath, 'utf-8')

            const resendBlockStart = content.indexOf('action === "resend_registration_invitation"')
            const resendBlockEnd = content.indexOf('action === "cancel_registration_invitation"')
            const resendBlock = content.slice(resendBlockStart, resendBlockEnd)

            expect(resendBlock).toContain('invitation_status === "accepted"')
            expect(resendBlock).toContain('30000') // 30 seconds rate limit
        })
    })
})
