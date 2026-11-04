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

    it('calls the public self-service recovery action for registered users', async () => {
        mockInvoke.mockResolvedValue({
            data: {
                success: true,
                message: 'إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.',
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
})
