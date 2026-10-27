import { supabase } from './supabase'
import { logAuditEvent } from './auditLogger'

export type UserInvitation = {
    id: string
    email: string
    role: string
    invited_by: string | null
    invited_by_email: string
    status: 'pending' | 'accepted' | 'expired'
    created_at: string
    accepted_at: string | null
}

export type UserInvitationResult = {
    success: boolean
    message: string
    emailSent?: boolean
    inviteLink?: string | null
}

/**
 * Send an invitation to a user directly from inside the system.
 * Calls the Supabase Edge Function `invite-user`.
 */
export async function sendUserInvitation(email: string, role = 'viewer'): Promise<UserInvitationResult> {
    if (!supabase) {
        throw new Error('اتصال Supabase غير متاح.')
    }

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
        throw new Error('يرجى إدخال بريد إلكتروني صالح.')
    }

    // Call the deployed Edge Function
    const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: trimmedEmail, role },
    })

    if (error) {
        console.error('Edge function invite error:', error)
        let parsedMessage = error.message

        if ('context' in error && error.context && typeof (error.context as Response).json === 'function') {
            try {
                const body = await (error.context as Response).json()
                if (body?.error) parsedMessage = body.error
            } catch {
                // Keep default
            }
        }

        if (parsedMessage.includes('rate limit')) {
            parsedMessage = 'تم تجاوز حد إرسال الإيميلات التجريبية في Supabase (3 إيميلات/ساعة). يرجى المحاولة لاحقاً أو إعداد SMTP مخصص.'
        }

        throw new Error(parsedMessage || 'تعذر إرسال الدعوة. تحقق من الصلاحيات.')
    }

    if (data?.error) {
        throw new Error(data.error)
    }

    // Log in audit log
    await logAuditEvent({
        action: 'دعوة مستخدم جديد من النظام',
        entity_type: 'invitation',
        details: {
            invited_email: trimmedEmail,
            role,
            email_sent: data?.emailSent,
            has_direct_link: Boolean(data?.inviteLink),
        },
    })

    return {
        success: true,
        message: data?.message || `تمت الدعوة بنجاح لـ ${trimmedEmail}`,
        emailSent: data?.emailSent,
        inviteLink: data?.inviteLink,
    }
}

/**
 * Fetch all invitations sent from the system
 */
export async function fetchUserInvitations(): Promise<UserInvitation[]> {
    if (!supabase) return []

    const { data, error } = await supabase
        .from('user_invitations')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching invitations:', error)
        return []
    }

    return (data ?? []) as UserInvitation[]
}

export type RegisteredUser = {
    id: string
    email: string
    role: string
    system_admin: boolean
    created_at: string
    last_sign_in_at: string | null
}

export type AdminResetPasswordResult = {
    success: boolean
    message: string
    recoveryLink?: string | null
}

/**
 * Allows the current logged-in user to change their own password
 */
export async function changeCurrentUserPassword(newPassword: string): Promise<void> {
    if (!supabase) {
        throw new Error('اتصال Supabase غير متاح.')
    }
    if (!newPassword || newPassword.length < 6) {
        throw new Error('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف.')
    }

    const { data, error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
        throw new Error(error.message || 'تعذر تحديث كلمة المرور.')
    }
    if (!data.user) {
        throw new Error('لم يتم تأكيد حفظ كلمة المرور.')
    }

    await logAuditEvent({
        action: 'تغيير كلمة المرور الشخصية للمستخدم',
        entity_type: 'user_security',
        details: { user_id: data.user.id, email: data.user.email },
    })
}

/**
 * Allows the System Admin to reset or set a new password for any user who forgot it
 */
export async function adminResetUserPassword(email: string, newPassword?: string): Promise<AdminResetPasswordResult> {
    if (!supabase) {
        throw new Error('اتصال Supabase غير متاح.')
    }
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
        throw new Error('يرجى إدخال بريد إلكتروني صالح للمستخدم.')
    }
    if (newPassword && newPassword.length < 6) {
        throw new Error('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف.')
    }

    const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
            action: 'reset-password',
            email: trimmedEmail,
            newPassword: newPassword?.trim() || undefined,
        },
    })

    if (error) {
        console.error('Edge function reset password error:', error)
        let msg = error.message
        if ('context' in error && error.context && typeof (error.context as Response).json === 'function') {
            try {
                const b = await (error.context as Response).json()
                if (b?.error) msg = b.error
            } catch {
                // ignore
            }
        }
        throw new Error(msg || 'تعذر إعادة تعيين كلمة المرور للمستخدم.')
    }

    if (data?.error) {
        throw new Error(data.error)
    }

    return {
        success: true,
        message: data?.message || `تم تحديث كلمة المرور للمستخدم ${trimmedEmail}`,
        recoveryLink: data?.recoveryLink ?? null,
    }
}

/**
 * Fetch all registered users in the project (available to System Admin)
 */
export async function fetchRegisteredUsers(): Promise<RegisteredUser[]> {
    if (!supabase) return []

    try {
        const { data, error } = await supabase.functions.invoke('invite-user', {
            body: { action: 'list-users' },
        })
        if (error || data?.error) return []
        return (data?.users || []) as RegisteredUser[]
    } catch {
        return []
    }
}
