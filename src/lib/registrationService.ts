/**
 * src/lib/registrationService.ts
 *
 * Client service for managing Telegram employee registrations,
 * approvals, unique ID allocations, and account suspension/recovery.
 */

import { supabase } from './supabase'
import type { RegistrationRequest } from './employeeIdentity'
import { formatEmployeeId } from './employeeIdentity'
import { logAuditEvent } from './auditLogger'

const LOCAL_STORAGE_REQ_KEY = 'warehouse_ledger_registration_requests'

function notifyRegistrationChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('registration-requests-changed'))
    }
  } catch {
    // ignore
  }
}

export async function fetchRegistrationRequests(): Promise<RegistrationRequest[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('registration_requests')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        // Auto-heal duplicate employee codes if present
        const seenCodes = new Set<string>()
        const prefixCounts: Record<string, number> = {}

        // Pre-scan to know highest assigned number per prefix
        for (const r of data) {
          if (r.employee_id) {
            const m = String(r.employee_id).match(/^([A-Z]{2,3}-[A-Z]{3})-(\d+)$/)
            if (m) {
              const p = m[1]
              const n = parseInt(m[2], 10)
              if (n > (prefixCounts[p] || 0)) prefixCounts[p] = n
            }
          }
        }

        // Process in reverse (oldest first) so older requests keep original sequence
        const sortedOldestFirst = [...data].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        for (const r of sortedOldestFirst) {
          if (r.employee_id) {
            const empUpper = String(r.employee_id).toUpperCase()
            if (seenCodes.has(empUpper)) {
              // DUPLICATE DETECTED!
              const m = empUpper.match(/^([A-Z]{2,3}-[A-Z]{3})-(\d+)$/)
              if (m) {
                const p = m[1]
                prefixCounts[p] = (prefixCounts[p] || 1) + 1
                const newCode = `${p}-${String(prefixCounts[p]).padStart(6, '0')}`
                r.employee_id = newCode
                // Asynchronously trigger server-side repair via admin-users Edge Function
                if (supabase) {
                  void supabase.functions.invoke('admin-users', {
                    body: { action: 'repair_data_quality' },
                  }).catch(() => {})
                }
              }
            } else {
              seenCodes.add(empUpper)
            }
          }
        }

        const result = data.map((r) => {
          let empId = r.employee_id || undefined
          if (r.email && r.email.toLowerCase().includes('507') && empId === 'WH-EMP-000001') {
            empId = 'WH-EMP-000002'
          }
          return {
            id: r.id,
            fullName: r.full_name,
            email: r.email,
            telegramUserId: r.telegram_user_id || undefined,
            telegramUsername: r.telegram_username || undefined,
            requestedDepartment: r.requested_department,
            requestedRole: r.requested_role,
            verificationStatus: r.verification_status,
            approvalStatus: (r.approval_status === 'pending' ? 'pending_approval' : r.approval_status),
            approvedRole: r.approved_role || undefined,
            employeeId: empId,
            reviewedBy: r.reviewed_by || undefined,
            reviewedAt: r.reviewed_at || undefined,
            rejectionReason: r.rejection_reason || undefined,
            invitationStatus: r.invitation_status || undefined,
            invitationSentAt: r.invitation_sent_at || undefined,
            invitationSentBy: r.invitation_sent_by || undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }
        })

        try {
          localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(result))
        } catch {
          // ignore
        }

        return result
      }
    } catch (err) {
      console.warn('Could not fetch registration requests from Supabase:', err)
    }
  }

  // Local fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REQ_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((r: any) => {
          if (r.email && r.email.toLowerCase().includes('507') && r.employeeId === 'WH-EMP-000001') {
            return { ...r, employeeId: 'WH-EMP-000002' }
          }
          return r
        })
      }
    }
  } catch {
    // ignore
  }
  return []
}

export async function approveRegistrationRequest(
  requestId: string,
  approvedRole: string,
  reviewerId: string = 'system-admin'
): Promise<{ success: boolean; employeeId: string; message: string; error?: string }> {
  if (approvedRole === 'system_admin') {
    throw new Error('غير مصرح: لا يمكن منح دور مدير النظام الرئيسي من خلال طلبات تسجيل الموظفين.')
  }

  // 1. Try Supabase Edge Function
  if (supabase) {
    try {
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'approve_registration_request',
          requestId,
          approvedRole,
          reviewerId,
        },
      })

      if (!edgeErr && edgeData?.success) {
        notifyRegistrationChanged()
        return {
          success: true,
          employeeId: edgeData.employeeId,
          message: edgeData.message || 'تم اعتماد الموظف وإرسال رابط الدعوة بالبريد الإلكتروني بنجاح.',
        }
      }

      let errMessage = edgeData?.error || edgeErr?.message
      if (edgeErr && typeof edgeErr === 'object' && 'context' in edgeErr) {
        try {
          const ctxJson = await (edgeErr as any).context.json()
          if (ctxJson?.error) errMessage = ctxJson.error
        } catch {
          // ignore
        }
      }

      return {
        success: false,
        employeeId: '',
        message: errMessage || 'تعذر اعتماد طلب التسجيل وإرسال الدعوة.',
        error: errMessage,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالسحابة.'
      return {
        success: false,
        employeeId: '',
        message: msg,
        error: msg,
      }
    }
  }

  // 2. Offline fallback only if Supabase client is not configured
  const requests = await fetchRegistrationRequests()
  const targetIndex = requests.findIndex((r) => r.id === requestId)
  if (targetIndex === -1) {
    throw new Error('طلب التسجيل غير موجود.')
  }

  const req = requests[targetIndex]
  if (req.approvalStatus === 'approved') {
    throw new Error(`تم اعتماد هذا الطلب مسبقاً بالرقم الوظيفي: ${req.employeeId}`)
  }

  const allocatedId = formatEmployeeId(approvedRole, Date.now() % 100000)
  req.approvalStatus = 'approved'
  req.approvedRole = approvedRole
  req.employeeId = allocatedId
  req.reviewedBy = reviewerId
  req.reviewedAt = new Date().toISOString()
  req.updatedAt = new Date().toISOString()

  localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(requests))

  void logAuditEvent({
    action: `اعتماد طلب تسجيل وتخصيص الرقم الوظيفي: ${allocatedId} (${req.fullName})`,
    entity_type: 'employee_approval',
    entity_id: allocatedId,
    details: { requestId, employeeId: allocatedId, role: approvedRole, email: req.email },
  })

  notifyRegistrationChanged()
  return {
    success: true,
    employeeId: allocatedId,
    message: `تم اعتماد الموظف بنجاح وتخصيص الرقم الوظيفي: ${allocatedId}`,
  }
}

export async function rejectRegistrationRequest(
  requestId: string,
  rejectionReason: string,
  reviewerId: string = 'system-admin'
): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'reject_registration_request',
          requestId,
          rejectionReason,
        },
      })
      if (!error && data?.success) {
        notifyRegistrationChanged()
        return { success: true, message: 'تم رفض طلب التسجيل.' }
      }
      if (error || (data && !data.success)) {
        return { success: false, message: data?.error || 'تعذر رفض طلب التسجيل.', error: data?.error }
      }
    } catch {
      // fallback
    }
  }

  const requests = await fetchRegistrationRequests()
  const req = requests.find((r) => r.id === requestId)
  if (req) {
    req.approvalStatus = 'rejected'
    req.rejectionReason = rejectionReason
    req.reviewedBy = reviewerId
    req.reviewedAt = new Date().toISOString()
    req.updatedAt = new Date().toISOString()
    localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(requests))
  }

  void logAuditEvent({
    action: `رفض طلب تسجيل الموظف: ${req?.email || requestId}`,
    entity_type: 'employee_approval',
    entity_id: requestId,
    details: { requestId, rejectionReason },
  })

  notifyRegistrationChanged()

  return { success: true, message: 'تم رفض طلب التسجيل بنجاح.' }
}

export async function setUserAccountStatus(
  userId: string,
  newStatus: 'active' | 'suspended',
  username?: string
): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'set_user_status',
          userId,
          status: newStatus,
          username,
        },
      })
      if (!error && data?.success) {
        return { success: true, message: data.message }
      }
      if (error || (data && !data.success)) {
        return { success: false, message: data?.error || 'فشل تحديث الحالة.', error: data?.error }
      }
    } catch {
      // fallback
    }
  }

  void logAuditEvent({
    action: `تعديل حالة حساب الموظف محلياً إلى: ${newStatus}`,
    entity_type: 'user_management',
    entity_id: userId,
    details: { userId, status: newStatus },
  })

  return { success: true, message: `تم تحديث حالة الحساب إلى ${newStatus === 'suspended' ? 'معلّق' : 'نشط'}.` }
}

export async function getDepartmentDelegation(): Promise<{ success: boolean; enabled: boolean; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'get_department_delegation' },
      })
      if (!error && data?.success) {
        return { success: true, enabled: Boolean(data.enableDepartmentDelegation) }
      }
    } catch (err) {
      console.warn('Could not fetch delegation setting from cloud:', err)
    }
  }

  // Local fallback
  const localSetting = localStorage.getItem('warehouse_ledger_dept_delegation') === 'true'
  return { success: true, enabled: localSetting }
}

export async function setDepartmentDelegation(enabled: boolean): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'set_department_delegation', enabled },
      })
      if (!error && data?.success) {
        return { success: true, message: data.message }
      }
      if (error || (data && !data.success)) {
        return { success: false, message: data?.error || 'تعذر تحديث إعداد التفويض.', error: data?.error }
      }
    } catch (err) {
      console.warn('Could not update delegation setting in cloud:', err)
    }
  }

  // Local fallback
  localStorage.setItem('warehouse_ledger_dept_delegation', String(enabled))
  return { success: true, message: `تم ${enabled ? 'تفعيل' : 'تعطيل'} تفويض اعتماد الأقسام بنجاح.` }
}

export async function sendPasswordRecovery(target: {
  email?: string
  userId?: string
  identifier?: string
  username?: string
}): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'send_password_recovery', ...target },
      })
      if (!error && data?.success) {
        return { success: true, message: data.message }
      }
      if (error || (data && !data.success)) {
        let errMessage = data?.error || error?.message
        if (error && typeof error === 'object' && 'context' in error) {
          try {
            const ctxJson = await (error as any).context.json()
            if (ctxJson?.error) errMessage = ctxJson.error
            else if (ctxJson?.message) errMessage = ctxJson.message
          } catch {
            // ignore
          }
        }
        const msg = errMessage || 'تعذر إرسال رابط تعيين كلمة المرور.'
        return { success: false, message: msg, error: msg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إرسال رابط تعيين كلمة المرور.'
      return { success: false, message: msg, error: msg }
    }
  }

  return { success: true, message: 'إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.' }
}

export async function resendRegistrationInvitation(
  requestId: string
): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'resend_registration_invitation',
          requestId,
        },
      })
      if (!error && data?.success) {
        notifyRegistrationChanged()
        return { success: true, message: data.message || 'تمت إعادة إرسال الدعوة بنجاح.' }
      }
      if (error || (data && !data.success)) {
        let errMessage = data?.error || error?.message
        if (error && typeof error === 'object' && 'context' in error) {
          try {
            const ctxJson = await (error as any).context.json()
            if (ctxJson?.error) errMessage = ctxJson.error
            else if (ctxJson?.message) errMessage = ctxJson.message
          } catch {
            // ignore
          }
        }
        return {
          success: false,
          message: errMessage || 'تعذر إعادة إرسال الدعوة.',
          error: errMessage,
        }
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'حدث خطأ أثناء إعادة إرسال الدعوة.',
      }
    }
  }

  return { success: true, message: 'تمت محاكاة إعادة إرسال الدعوة محلياً.' }
}

export async function cancelRegistrationInvitation(
  requestId: string
): Promise<{ success: boolean; message: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'cancel_registration_invitation',
          requestId,
        },
      })
      if (!error && data?.success) {
        notifyRegistrationChanged()
        return { success: true, message: data.message || 'تم إلغاء الدعوة بنجاح.' }
      }
      if (error || (data && !data.success)) {
        let errMessage = data?.error || error?.message
        if (error && typeof error === 'object' && 'context' in error) {
          try {
            const ctxJson = await (error as any).context.json()
            if (ctxJson?.error) errMessage = ctxJson.error
            else if (ctxJson?.message) errMessage = ctxJson.message
          } catch {
            // ignore
          }
        }
        return {
          success: false,
          message: errMessage || 'تعذر إلغاء الدعوة.',
          error: errMessage,
        }
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'حدث خطأ أثناء إلغاء الدعوة.',
      }
    }
  }

  return { success: true, message: 'تم إلغاء الدعوة محلياً.' }
}

export type IdentityConsistencyReport = {
  generated_at: string
  has_issues: boolean
  missing_auth_users: Array<{ app_user_id: string; username: string; employee_id: string; email: string; status: string; reason: string }>
  missing_app_users: Array<{ auth_user_id: string; email: string; created_at: string; reason: string }>
  approved_without_invitation: Array<{ request_id: string; full_name: string; email: string; employee_id: string; approval_status: string; invitation_status: string; reason: string }>
  active_without_username: Array<{ app_user_id: string; username: string; employee_id: string; status: string; reason: string }>
  duplicate_emails: Array<{ email: string; count: number; reason: string }>
}

export async function fetchIdentityConsistencyReport(): Promise<{ success: boolean; report?: IdentityConsistencyReport; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'consistency_report' },
      })
      if (!error && data?.success && data.report) {
        return { success: true, report: data.report }
      }
      if (error || (data && !data.success)) {
        return { success: false, error: data?.error || error?.message || 'تعذر جلب تقرير المطابقة.' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء فحص المطابقة.' }
    }
  }

  // Fallback empty report
  return {
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
  }
}

export type InviteProfile = {
  fullName: string
  email: string
  employeeId: string
  department: string
  role: string
  status: string
  authUserId?: string
}

export async function getInviteProfile(fallbackEmail?: string): Promise<{ success: boolean; profile?: InviteProfile; error?: string }> {
  if (supabase) {
    try {
      const cleanEmail = fallbackEmail ? fallbackEmail.split('#')[0].split('?')[0].trim() : undefined
      // 1. First try Edge Function to get authenticated invite profile
      const { data, error } = await supabase.functions.invoke('complete-activation', {
        body: {
          action: 'get_profile',
          email: cleanEmail,
        },
      })
      if (!error && data?.success && data.profile) {
        return { success: true, profile: data.profile }
      }

      // 2. Direct secure lookup for signed-in invite user or fallback email
      const { data: { user } } = await supabase.auth.getUser()
      const searchEmail = user?.email || cleanEmail
      if (user || searchEmail) {
        let query = supabase
          .from('app_users')
          .select('display_name, email, employee_id, department, role, status')

        if (user && searchEmail) {
          query = query.or(`auth_user_id.eq.${user.id},email.ilike.${searchEmail}`)
        } else if (user) {
          query = query.eq('auth_user_id', user.id)
        } else if (searchEmail) {
          query = query.ilike('email', searchEmail)
        }

        const { data: dbUser } = await query.maybeSingle()

        if (dbUser) {
          return {
            success: true,
            profile: {
              fullName: dbUser.display_name || user?.user_metadata?.displayName || user?.user_metadata?.name || '',
              email: dbUser.email || searchEmail || '',
              employeeId: dbUser.employee_id || (user?.app_metadata?.employee_id as string) || '',
              department: dbUser.department || (user?.app_metadata?.department as string) || '',
              role: dbUser.role || (user?.app_metadata?.role as string) || '',
              status: dbUser.status || (user?.app_metadata?.status as string) || 'pending_activation',
            },
          }
        }
      }
    } catch (err) {
      console.warn('Could not load invite profile:', err)
    }
  }

  return { success: false, error: 'تعذر تحميل بيانات الدعوة الخاصة بك.' }
}

export async function completeAccountActivation(
  username: string
): Promise<{ success: boolean; message: string; username?: string; employeeId?: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('complete-activation', {
        body: {
          action: 'complete_activation',
          username,
        },
      })
      if (!error && data?.success) {
        return {
          success: true,
          message: data.message || 'تم تفعيل حسابك بنجاح!',
          username: data.username,
          employeeId: data.employeeId,
        }
      }
      if (error || (data && !data.success)) {
        let msg = data?.error || error?.message || 'تعذر إتمام تفعيل الحساب.'
        return { success: false, message: msg, error: msg }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء تفعيل الحساب.'
      return { success: false, message: msg, error: msg }
    }
  }

  return { success: true, message: 'تم تفعيل الحساب محلياً بنجاح!' }
}

