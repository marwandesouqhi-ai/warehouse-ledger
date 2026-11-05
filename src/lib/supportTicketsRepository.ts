import { assertDepartmentWrite, getAccessSession } from './accessContext'
import { getDashboardScope } from './permissions'
import { supabase } from './supabase'
import { logAuditEvent } from './auditLogger'
import type { Session } from '@supabase/supabase-js'

export type TicketPriority = 'عادي' | 'متوسط' | 'عاجل جداً'
export type TicketStatus = 'مفتوحة' | 'قيد المعالجة' | 'تم الحل' | 'مغلقة'

export interface SupportTicket {
  id: string
  ticket_number: string
  employee_name: string
  employee_code?: string
  employee_email?: string
  user_id?: string | null
  department: string
  category: string
  priority: TicketPriority
  subject: string
  description: string
  status: TicketStatus
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_type?: string | null
  admin_notes?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  created_at: string
  updated_at?: string
}

const LOCAL_STORAGE_KEY = 'warehouse_support_tickets'

/**
 * جلب التذاكر المحفوظة محلياً للطوارئ أو عدم الاتصال
 */
export function getLocalTickets(): SupportTicket[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SupportTicket[]
  } catch {
    return []
  }
}

/**
 * حفظ قائمة التذاكر في المتصفح
 */
export function saveLocalTickets(tickets: SupportTicket[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tickets.slice(0, 100)))
  } catch {
    // ignore
  }
}

/**
 * جلب التذاكر من سحابة Supabase مع fallback محلي
 */
export async function fetchSupportTickets(_session?: Session | null): Promise<SupportTicket[]> {
  const local = getLocalTickets()

  if (!supabase) {
    return local
  }

  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('Supabase support_tickets error, using local fallback:', error.message)
      return local
    }

    if (data && Array.isArray(data)) {
      const tickets = data as SupportTicket[]
      // دمج وتحديث التخزين المحلي
      saveLocalTickets(tickets)
      return tickets
    }
  } catch (err) {
    console.warn('Error fetching support tickets:', err)
  }

  return local
}

/**
 * رفع ملف المرفق إلى Supabase Storage (حاوية support-attachments)
 */
export async function uploadSupportAttachment(file: File, ticketNumber: string): Promise<{ url: string; name: string; type: string } | null> {
  if (!supabase) return null

  try {
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${ticketNumber}/${Date.now()}_${cleanFileName}`

    const { error: uploadError } = await supabase.storage
      .from('support-attachments')
      .upload(filePath, file, { cacheControl: '3600', upsert: true })

    if (uploadError) {
      console.warn('Attachment upload failed:', uploadError.message)
      return null
    }

    const { data: publicData } = supabase.storage
      .from('support-attachments')
      .getPublicUrl(filePath)

    return {
      url: publicData.publicUrl,
      name: file.name,
      type: file.type,
    }
  } catch (err) {
    console.warn('Failed to upload attachment:', err)
    return null
  }
}

/**
 * إنشاء وحفظ تذكرة دعم فني جديدة في قاعدة البيانات
 */
export async function createSupportTicket(
  ticketData: Omit<SupportTicket, 'id' | 'created_at' | 'status'> & { status?: TicketStatus },
  attachmentFile?: File | null,
  session?: Session | null
): Promise<SupportTicket> {
  assertDepartmentWrite(getDashboardScope(getAccessSession()) === 'warehouse_only' ? 'warehouse' : 'procurement', 'create')
  let attachmentUrl = ticketData.attachment_url || null
  let attachmentName = ticketData.attachment_name || null
  let attachmentType = ticketData.attachment_type || null

  // 1. رفع المرفق إن وجد
  if (attachmentFile && supabase) {
    const uploaded = await uploadSupportAttachment(attachmentFile, ticketData.ticket_number)
    if (uploaded) {
      attachmentUrl = uploaded.url
      attachmentName = uploaded.name
      attachmentType = uploaded.type
    }
  }

  const newTicket: SupportTicket = {
    ...ticketData,
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    status: ticketData.status || 'مفتوحة',
    attachment_url: attachmentUrl,
    attachment_name: attachmentName,
    attachment_type: attachmentType,
    created_at: new Date().toISOString(),
  }

  // 2. الحفظ في Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .insert([
          {
            ticket_number: newTicket.ticket_number,
            employee_name: newTicket.employee_name,
            employee_code: newTicket.employee_code || '',
            employee_email: newTicket.employee_email || session?.user?.email || '',
            user_id: session?.user?.id || null,
            department: newTicket.department,
            category: newTicket.category,
            priority: newTicket.priority,
            subject: newTicket.subject,
            description: newTicket.description,
            status: newTicket.status,
            attachment_url: newTicket.attachment_url,
            attachment_name: newTicket.attachment_name,
            attachment_type: newTicket.attachment_type,
          },
        ])
        .select()
        .single()

      if (!error && data) {
        newTicket.id = data.id
      } else if (error) {
        console.warn('Could not insert to Supabase, saved locally:', error.message)
      }
    } catch (err) {
      console.warn('Failed to insert support ticket in Supabase:', err)
    }
  }

  // 3. تحديث السجل المحلي
  const current = getLocalTickets()
  const updated = [newTicket, ...current.filter((t) => t.ticket_number !== newTicket.ticket_number)]
  saveLocalTickets(updated)

  // 4. تسجيل في سجل التدقيق والمراقبة
  try {
    void logAuditEvent({
      action: `فتح تذكرة دعم فني #${newTicket.ticket_number}`,
      entity_type: 'support_ticket',
      entity_id: newTicket.ticket_number,
      details: {
        employee: newTicket.employee_name,
        department: newTicket.department,
        priority: newTicket.priority,
        category: newTicket.category,
        subject: newTicket.subject,
      },
    })
  } catch {
    // ignore
  }

  return newTicket
}

/**
 * تحديث حالة التذكرة أو كتابة ملاحظات الأدمن
 */
export async function updateSupportTicketStatus(
  id: string,
  updates: {
    status?: TicketStatus
    admin_notes?: string
    resolved_by?: string
  }
): Promise<boolean> {
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    updated_at: now,
  }

  if (updates.status) {
    payload.status = updates.status
    if (updates.status === 'تم الحل' || updates.status === 'مغلقة') {
      payload.resolved_at = now
    }
  }
  if (updates.admin_notes !== undefined) payload.admin_notes = updates.admin_notes
  if (updates.resolved_by !== undefined) payload.resolved_by = updates.resolved_by

  let success = false

  if (supabase) {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update(payload)
        .eq('id', id)

      if (!error) {
        success = true
      } else {
        console.warn('Supabase update ticket status error:', error.message)
      }
    } catch (err) {
      console.warn('Failed to update ticket in Supabase:', err)
    }
  }

  // تحديث محلي
  const current = getLocalTickets()
  const updatedList = current.map((t) =>
    t.id === id ? { ...t, ...updates, updated_at: now, ...(updates.status === 'تم الحل' ? { resolved_at: now } : {}) } : t
  )
  saveLocalTickets(updatedList)

  // تسجيل بالتدقيق
  try {
    void logAuditEvent({
      action: `تحديث حالة تذكرة دعم فني (${updates.status || 'تعديل'})`,
      entity_type: 'support_ticket',
      entity_id: id,
      details: updates,
    })
  } catch {
    // ignore
  }

  return success || !supabase
}

/**
 * حذف تذكرة دعم
 */
export async function deleteSupportTicket(id: string): Promise<boolean> {
  let success = false
  if (supabase) {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .delete()
        .eq('id', id)
      if (!error) success = true
    } catch {
      // ignore
    }
  }

  const current = getLocalTickets()
  saveLocalTickets(current.filter((t) => t.id !== id))
  return success || !supabase
}
