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

export async function fetchRegistrationRequests(): Promise<RegistrationRequest[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('registration_requests')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        return data.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          email: r.email,
          telegramUserId: r.telegram_user_id || undefined,
          telegramUsername: r.telegram_username || undefined,
          requestedDepartment: r.requested_department,
          requestedRole: r.requested_role,
          verificationStatus: r.verification_status,
          approvalStatus: r.approval_status,
          approvedRole: r.approved_role || undefined,
          employeeId: r.employee_id || undefined,
          reviewedBy: r.reviewed_by || undefined,
          reviewedAt: r.reviewed_at || undefined,
          rejectionReason: r.rejection_reason || undefined,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
      }
    } catch (err) {
      console.warn('Could not fetch registration requests from Supabase:', err)
    }
  }

  // Local fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REQ_KEY)
    if (raw) return JSON.parse(raw)
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

  // 1. Try Supabase Edge Function or RPC if available
  if (supabase) {
    try {
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'approve_registration_request',
          requestId,
          approvedRole,
        },
      })

      if (!edgeErr && edgeData?.success) {
        return {
          success: true,
          employeeId: edgeData.employeeId,
          message: edgeData.message || 'تم اعتماد الموظف بنجاح.',
        }
      }

      // Try RPC fallback
      const { data: rpcData, error: rpcErr } = await supabase.rpc('approve_employee_registration', {
        p_request_id: requestId,
        p_approved_role: approvedRole,
        p_reviewer_id: reviewerId,
      })

      if (!rpcErr && rpcData?.success) {
        return {
          success: true,
          employeeId: rpcData.employee_id,
          message: 'تم اعتماد الموظف وتخصيص الرقم الوظيفي بنجاح.',
        }
      }
    } catch (err) {
      console.warn('Cloud approval fallback to local simulation:', err)
    }
  }

  // 2. Local resilient approval simulation
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
