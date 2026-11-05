import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInvoke } = vi.hoisted(() => ({
    mockInvoke: vi.fn(),
}))

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        functions: {
            invoke: mockInvoke,
        },
    },
}))

import { sendPasswordRecovery } from '../../src/lib/registrationService'

describe('Password recovery flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('calls the public self-service recovery action for registered users and returns success', async () => {
        mockInvoke.mockResolvedValue({
            data: {
                success: true,
                message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني المسجل في النظام بنجاح.',
            },
            error: null,
        })

        const result = await sendPasswordRecovery({ identifier: 'user@example.com' })

        expect(mockInvoke).toHaveBeenCalledWith('admin-users', {
            body: {
                action: 'send_password_recovery',
                identifier: 'user@example.com',
            },
        })

        expect(result.success).toBe(true)
        expect(result.message).toContain('تم إرسال رابط إعادة تعيين كلمة المرور')
    })

    it('rejects non-existent users or gibberish and returns clear Arabic not found error', async () => {
        // Simulates unconfirmed / non-matching user returned from backend
        mockInvoke.mockResolvedValue({
            data: {
                success: true,
                message: 'إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.',
            },
            error: null,
        })

        const result = await sendPasswordRecovery({ identifier: 'نتسيبنسثتتلا' })

        expect(result.success).toBe(false)
        expect(result.error).toContain('لم يتم العثور على أي حساب مسجل')
    })

    it('handles HTTP error responses from edge function gracefully', async () => {
        mockInvoke.mockResolvedValue({
            data: null,
            error: {
                message: 'لم يتم العثور على أي حساب مسجل بهذا الاسم أو الرقم الوظيفي أو البريد الإلكتروني.',
            },
        })

        const result = await sendPasswordRecovery({ identifier: 'unknown_emp' })

        expect(result.success).toBe(false)
        expect(result.error).toContain('لم يتم العثور على أي حساب مسجل')
    })
})
