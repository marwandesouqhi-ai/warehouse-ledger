import { useState, useEffect, useMemo, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  Headphones,
  Send,
  Mail,
  Paperclip,
  CheckCircle2,
  Clock,
  User,
  Building2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Trash2,
  Copy,
  Printer,
  Phone,
  ShieldCheck,
  Check,
  HelpCircle,
  Sparkles,
  MessageSquare,
  Search,
  RotateCw,
  ExternalLink,
  LogIn,
  ArrowRight,
  KeyRound,
} from 'lucide-react'

import {
  fetchSupportTickets,
  createSupportTicket,
  updateSupportTicketStatus,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from '../lib/supportTicketsRepository'
import { checkIsSystemAdmin } from '../lib/supabase'
import { isSystemAdmin } from '../lib/permissions'

type SupportPageProps = {
  session?: Session | null
}

const SUPPORT_EMAIL = 'marwandesowky2@gmail.com'
const SUPPORT_PHONE = '01011488621'
const WHATSAPP_NUMBER = '201011488621'

const DEPARTMENTS = [
  'المستودعات والمخازن',
  'الحسابات والمالية',
  'المشتريات والتوريدات',
  'المبيعات والعملاء',
  'الموارد البشرية (HR)',
  'الحركة والأسطول والنقل',
  'الإدارة العامة',
  'أخرى',
]

const CATEGORIES = [
  'مشكلة في تسجيل الدخول أو استعادة الحساب',
  'نسيان كلمة المرور أو إعادة التعيين',
  'طلب تفعيل حساب جديد أو تعديل الصلاحيات',
  'عطل في السيستم / أخطاء تقنية',
  'أجهزة كمبيوتر أو طابعات باركود',
  'الشبكة والإنترنت والاتصال بالسيرفر',
  'مشكلة في تسجيل أذون الصرف أو الإضافة',
  'استفسار أو شكوى أخرى',
]

export default function SupportPage({ session }: SupportPageProps) {
  // مقتصر حصرياً على مدير النظام (System Admin) فقط - موثق عبر app_metadata الموقعة رسمياً من السيرفر
  const isSysAdmin = Boolean(
    isSystemAdmin(session) ||
    checkIsSystemAdmin(session) ||
    session?.user?.email?.toLowerCase() === 'marwandesouqhi@gmail.com' ||
    session?.user?.email?.toLowerCase() === 'marwandesowky2@gmail.com' ||
    session?.user?.app_metadata?.role === 'system_admin' ||
    session?.user?.app_metadata?.system_admin === true
  )

  const isGuest = !session

  // Auto-fill from session metadata if available
  const initialName =
    session?.user?.user_metadata?.name ||
    session?.user?.user_metadata?.full_name ||
    (session?.user?.email ? session.user.email.split('@')[0] : '')

  const [ticketNumber, setTicketNumber] = useState<string>(() => generateTicketNumber())
  const [employeeName, setEmployeeName] = useState(initialName)
  const [employeePhone, setEmployeePhone] = useState('')
  const [employeeEmail, setEmployeeEmail] = useState(session?.user?.email || '')
  const [employeeCode] = useState<string>(() => (session?.user?.app_metadata?.employee_id as string) || '')
  const [department, setDepartment] = useState('المستودعات والمخازن')
  const [category, setCategory] = useState(isGuest ? 'مشكلة في تسجيل الدخول أو استعادة الحساب' : 'عطل في السيستم / أخطاء تقنية')
  const [priority, setPriority] = useState<TicketPriority>('متوسط')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [submittedTicket, setSubmittedTicket] = useState<SupportTicket | null>(null)
  const [guestSubmittedTickets, setGuestSubmittedTickets] = useState<SupportTicket[]>([])

  // Attachment state
  const [attachment, setAttachment] = useState<{
    file: File | null
    name: string
    type: string
    sizeFormatted: string
    previewUrl: string | null
  }>({
    file: null,
    name: '',
    type: '',
    sizeFormatted: '',
    previewUrl: null,
  })

  // Tickets list from DB / Supabase
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)

  // Admin filter states
  const [adminSearch, setAdminSearch] = useState('')
  const [adminStatusFilter, setAdminStatusFilter] = useState<string>('all')
  const [adminDeptFilter, setAdminDeptFilter] = useState<string>('all')
  const [adminNoteInput, setAdminNoteInput] = useState('')

  function generateTicketNumber(): string {
    return 'TKT-' + Math.floor(10000 + Math.random() * 90000)
  }

  // Load tickets from Supabase / Backend on mount
  async function loadTickets() {
    setIsLoading(true)
    try {
      const data = await fetchSupportTickets(session)
      setTickets(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadTickets()
  }, [session])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      alert('حجم الملف كبير جداً. الحد الأقصى هو 10 ميجابايت.')
      return
    }

    const sizeFormatted =
      file.size > 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(1) + ' MB'
        : Math.round(file.size / 1024) + ' KB'

    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setAttachment({
          file,
          name: file.name,
          type: file.type,
          sizeFormatted,
          previewUrl: event.target?.result as string,
        })
      }
      reader.readAsDataURL(file)
    } else {
      setAttachment({
        file,
        name: file.name,
        type: file.type,
        sizeFormatted,
        previewUrl: null,
      })
    }
  }

  function removeAttachment() {
    setAttachment({
      file: null,
      name: '',
      type: '',
      sizeFormatted: '',
      previewUrl: null,
    })
  }

  function formatTicketWhatsAppMessage(ticket: SupportTicket): string {
    const lines = [
      `🎫 *بلاغ دعم فني وتذكرة جديدة - Warehouse Ledger*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `🔖 *رقم التذكرة:* #${ticket.ticket_number}`,
      `👤 *الموظف / صاحب البلاغ:* ${ticket.employee_name}`,
      ticket.employee_code ? `📞 *الهاتف / التواصل:* ${ticket.employee_code}` : '',
      ticket.employee_email ? `📧 *البريد / اسم الحساب:* ${ticket.employee_email}` : '',
      `🏢 *القسم / الإدارة:* ${ticket.department}`,
      `⚙️ *تصنيف العطل:* ${ticket.category}`,
      `🚨 *درجة الأهمية:* ${ticket.priority}`,
      `📌 *عنوان المشكلة:* ${ticket.subject}`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `📝 *تفاصيل البلاغ والشكوى:*`,
      `${ticket.description}`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ticket.attachment_name || ticket.attachment_url
        ? `📎 *مرفقات:* تم إرفاق ملف (${ticket.attachment_name || 'صورة'}) ومتاح للمسؤولين بالسيستم.`
        : `📎 *المرفقات:* لا توجد مرفقات.`,
      `⏱️ *وقت التسجيل:* ${new Date(ticket.created_at).toLocaleString('ar-EG')}`,
    ].filter(Boolean)
    return lines.join('\n')
  }

  function formatTicketEmailBody(ticket: SupportTicket): string {
    return `مركز الدعم الفني - نظام إدارة المخازن (Warehouse Ledger)
===================================================
رقم التذكرة: #${ticket.ticket_number}
تاريخ البلاغ: ${new Date(ticket.created_at).toLocaleString('ar-EG')}

بيانات الموظف والقسم:
--------------------
- اسم الموظف: ${ticket.employee_name}
- هاتف التواصل: ${ticket.employee_code || 'غير محدد'}
- البريد / اسم المستخدم: ${ticket.employee_email || 'غير محدد'}
- القسم / الإدارة: ${ticket.department}
- درجة الأولوية: ${ticket.priority}
- نوع المشكلة: ${ticket.category}

عنوان المشكلة:
${ticket.subject}

تفاصيل البلاغ / الشكوى:
----------------------
${ticket.description}

المرفقات:
${ticket.attachment_name ? `مرفق مسجل: ${ticket.attachment_name}` : 'لا توجد مرفقات'}
===================================================`
  }

  function validateForm(): boolean {
    if (!employeeName.trim()) {
      alert('يرجى إدخال اسم الموظف / صاحب البلاغ بالكامل.')
      return false
    }
    if (isGuest && !employeePhone.trim() && !employeeEmail.trim()) {
      alert('يرجى كتابة رقم الهاتف أو البريد الإلكتروني للتواصل معك ومساعدتك.')
      return false
    }
    if (!subject.trim()) {
      alert('يرجى كتابة عنوان للمشكلة.')
      return false
    }
    if (!description.trim()) {
      alert('يرجى توضيح تفاصيل المشكلة أو العطل.')
      return false
    }
    return true
  }

  function getContactString(): string {
    const parts: string[] = []
    if (employeePhone.trim()) parts.push(`هاتف: ${employeePhone.trim()}`)
    if (employeeCode.trim()) parts.push(`كود: ${employeeCode.trim()}`)
    return parts.join(' | ')
  }

  async function handleDirectSubmit() {
    if (!validateForm() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const contactInfo = getContactString()
      const savedTicket = await createSupportTicket(
        {
          ticket_number: ticketNumber,
          employee_name: employeeName.trim(),
          employee_code: contactInfo,
          employee_email: employeeEmail.trim() || session?.user?.email || '',
          department,
          category,
          priority,
          subject: subject.trim(),
          description: description.trim(),
          attachment_name: attachment.name || undefined,
          attachment_type: attachment.type || undefined,
        },
        attachment.file,
        session
      )

      setTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setGuestSubmittedTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setSubmittedTicket(savedTicket)

      setStatusMessage({
        text: `تم استلام وحفظ التذكرة #${savedTicket.ticket_number} بنجاح في قاعدة البيانات المركزية`,
        type: 'success',
      })
      resetFormForNewTicket()
    } catch (err) {
      alert('حدث خطأ أثناء حفظ التذكرة: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSendWhatsApp() {
    if (!validateForm() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const contactInfo = getContactString()
      const savedTicket = await createSupportTicket(
        {
          ticket_number: ticketNumber,
          employee_name: employeeName.trim(),
          employee_code: contactInfo,
          employee_email: employeeEmail.trim() || session?.user?.email || '',
          department,
          category,
          priority,
          subject: subject.trim(),
          description: description.trim(),
          attachment_name: attachment.name || undefined,
          attachment_type: attachment.type || undefined,
        },
        attachment.file,
        session
      )

      setTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setGuestSubmittedTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setSubmittedTicket(savedTicket)

      const msg = formatTicketWhatsAppMessage(savedTicket)
      const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`

      if (attachment.name) {
        alert(
          `✓ تم تسجيل التذكرة #${savedTicket.ticket_number} وحفظها في قاعدة البيانات!\n\nملاحظة: سيتم فتح محادثة الواتساب الآن، برجاء إرفاق الصورة (${attachment.name}) مباشرة داخل شات الواتساب لتصل فوراً لمسؤول الدعم.`
        )
      }

      window.open(url, '_blank')
      setStatusMessage({
        text: `تم حفظ التذكرة #${savedTicket.ticket_number} بنجاح في قاعدة البيانات وفتح الواتساب`,
        type: 'success',
      })
      resetFormForNewTicket()
    } catch (err) {
      alert('حدث خطأ أثناء حفظ التذكرة: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSendEmail() {
    if (!validateForm() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const contactInfo = getContactString()
      const savedTicket = await createSupportTicket(
        {
          ticket_number: ticketNumber,
          employee_name: employeeName.trim(),
          employee_code: contactInfo,
          employee_email: employeeEmail.trim() || session?.user?.email || '',
          department,
          category,
          priority,
          subject: subject.trim(),
          description: description.trim(),
          attachment_name: attachment.name || undefined,
          attachment_type: attachment.type || undefined,
        },
        attachment.file,
        session
      )

      setTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setGuestSubmittedTickets((prev) => [savedTicket, ...prev.filter((t) => t.ticket_number !== savedTicket.ticket_number)])
      setSubmittedTicket(savedTicket)

      const emailSubject = `[دعم فني #${savedTicket.ticket_number}] [${savedTicket.priority}] ${savedTicket.subject}`
      const emailBody = formatTicketEmailBody(savedTicket)
      const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`

      window.location.href = url
      setStatusMessage({
        text: `تم تسجيل التذكرة #${savedTicket.ticket_number} بقاعدة البيانات وتجهيز البريد الإلكتروني`,
        type: 'info',
      })
      resetFormForNewTicket()
    } catch (err) {
      alert('حدث خطأ أثناء حفظ التذكرة: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetFormForNewTicket() {
    setTicketNumber(generateTicketNumber())
    setSubject('')
    setDescription('')
    removeAttachment()
  }

  function handleCopyTicket(ticket: SupportTicket) {
    const text = formatTicketWhatsAppMessage(ticket)
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(ticket.id)
      setTimeout(() => setCopiedId(null), 3000)
    })
  }

  function handlePrintTicket(ticket: SupportTicket) {
    const printWindow = window.open('', '_blank', 'width=700,height=800')
    if (!printWindow) return

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <title>تذكرة دعم فني #${ticket.ticket_number}</title>
          <style>
            body { font-family: Cairo, Tahoma, sans-serif; padding: 24px; color: #1e293b; line-height: 1.6; }
            .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; }
            .ticket-badge { background: #e0f2fe; color: #0369a1; padding: 6px 14px; border-radius: 6px; font-weight: bold; display: inline-block; }
            .meta-table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 20px; }
            .meta-table td { padding: 8px 12px; border: 1px solid #e2e8f0; }
            .meta-table td.label { background: #f8fafc; font-weight: bold; width: 25%; }
            .content-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-top: 10px; white-space: pre-wrap; }
            .footer { margin-top: 40px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>نظام إدارة المخازن (Warehouse Ledger) - إيصال تذكرة دعم فني</h2>
            <span class="ticket-badge">رقم التذكرة: #${ticket.ticket_number}</span>
          </div>

          <table class="meta-table">
            <tr>
              <td class="label">اسم الموظف:</td>
              <td>${ticket.employee_name}</td>
              <td class="label">كود الموظف / الهاتف:</td>
              <td>${ticket.employee_code || 'غير محدد'}</td>
            </tr>
            <tr>
              <td class="label">القسم / الإدارة:</td>
              <td>${ticket.department}</td>
              <td class="label">درجة الأولوية:</td>
              <td>${ticket.priority}</td>
            </tr>
            <tr>
              <td class="label">نوع المشكلة:</td>
              <td>${ticket.category}</td>
              <td class="label">تاريخ الإنشاء:</td>
              <td>${new Date(ticket.created_at).toLocaleString('ar-EG')}</td>
            </tr>
            <tr>
              <td class="label">الحالة الحالية:</td>
              <td colspan="3"><strong>${ticket.status}</strong></td>
            </tr>
            <tr>
              <td class="label">عنوان البلاغ:</td>
              <td colspan="3"><strong>${ticket.subject}</strong></td>
            </tr>
          </table>

          <h3>تفاصيل المشكلة والشكوى:</h3>
          <div class="content-box">${ticket.description}</div>

          ${ticket.attachment_name ? `<p><strong>المرفق:</strong> ${ticket.attachment_name}</p>` : ''}
          ${ticket.admin_notes ? `<p><strong>رد وملاحظات الدعم الفني:</strong> ${ticket.admin_notes}</p>` : ''}

          <div class="footer">
            تم تسجيل وحفظ هذه التذكرة مركزياً بقاعدة بيانات النظام | مسؤول الدعم: ${SUPPORT_PHONE} - ${SUPPORT_EMAIL}
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 300)
  }

  // Admin Actions: Update status & notes
  async function handleUpdateStatus(ticketId: string, newStatus: TicketStatus, notes?: string) {
    const adminName =
      session?.user?.user_metadata?.name ||
      session?.user?.email ||
      'مسؤول النظام'

    const ok = await updateSupportTicketStatus(ticketId, {
      status: newStatus,
      admin_notes: notes !== undefined ? notes : undefined,
      resolved_by: adminName,
    })

    if (ok) {
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId
            ? {
              ...t,
              status: newStatus,
              ...(notes !== undefined ? { admin_notes: notes } : {}),
              resolved_by: adminName,
            }
            : t
        )
      )
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket((prev) =>
          prev
            ? {
              ...prev,
              status: newStatus,
              ...(notes !== undefined ? { admin_notes: notes } : {}),
              resolved_by: adminName,
            }
            : null
        )
      }
      setStatusMessage({
        text: `تم تحديث حالة التذكرة إلى: ${newStatus}`,
        type: 'success',
      })
    }
  }

  // Filtered tickets for Admin
  const filteredAdminTickets = useMemo(() => {
    return tickets.filter((t) => {
      const matchSearch =
        !adminSearch.trim() ||
        t.ticket_number.toLowerCase().includes(adminSearch.toLowerCase()) ||
        t.employee_name.toLowerCase().includes(adminSearch.toLowerCase()) ||
        t.subject.toLowerCase().includes(adminSearch.toLowerCase()) ||
        t.description.toLowerCase().includes(adminSearch.toLowerCase())

      const matchStatus = adminStatusFilter === 'all' || t.status === adminStatusFilter
      const matchDept = adminDeptFilter === 'all' || t.department === adminDeptFilter

      return matchSearch && matchStatus && matchDept
    })
  }, [tickets, adminSearch, adminStatusFilter, adminDeptFilter])

  return (
    <section className="page-stack support-page" dir="rtl">

      {/* 1. Integrated Page Header - Differentiated for System Admin vs Regular Employees */}
      {isSysAdmin ? (
        <header className="page-intro">
          <div
            className="page-intro-icon"
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#059669',
              borderRadius: '12px',
            }}
          >
            <ShieldCheck size={26} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span className="eyebrow" style={{ color: '#059669', fontWeight: 800 }}>
                🛡️ لوحة تحكم مسؤول النظام (System Admin)
              </span>
              <span
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#047857',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                إدارة ومراجعة مشاكل المستخدمين
              </span>
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>
              لوحة إدارة ومتابعة تذاكر ومشاكل النظام
            </h2>
            <p style={{ margin: '4px 0 0', opacity: 0.8 }}>
              مراجعة وفحص كافة بلاغات وشكاوى الموظفين الواردة من مختلف الأقسام، متابعة الحلول وتحديث الحالات المركزية
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => void loadTickets()}
              className="secondary-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '8px',
              }}
              title="تحديث التذاكر من قاعدة البيانات"
            >
              <RotateCw size={14} className={isLoading ? 'animate-spin' : ''} />
              <span>تحديث التذاكر</span>
            </button>
          </div>
        </header>
      ) : (
        <header className="page-intro">
          <div
            className="page-intro-icon"
            style={{
              background: isGuest ? 'rgba(79, 70, 229, 0.12)' : 'rgba(59, 130, 246, 0.12)',
              color: isGuest ? '#4f46e5' : 'var(--accent, #3b82f6)',
              borderRadius: '12px',
            }}
          >
            <Headphones size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <p className="eyebrow">
              {isGuest
                ? 'منظومة الدعم الفني المباشر (متاح للجميع دون الحاجة لتسجيل الدخول)'
                : 'منظومة الخدمة والمساندة الفنية بقاعدة البيانات'}
            </p>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>
              {isGuest ? 'مركز الدعم الفني وبلاغات الأعطال ومشاكل الدخول' : 'مركز الدعم الفني وتذاكر الموظفين'}
            </h2>
            <p style={{ margin: '4px 0 0', opacity: 0.8 }}>
              {isGuest
                ? 'إذا كنت تواجه مشكلة في تسجيل الدخول، نسيان كلمة المرور، أو تحتاج مساعدة فنية بالمنظومة، افتح تذكرتك هنا فوراً وسيتم حلها.'
                : 'تسجيل وتتبع بلاغات وشكاوى الموظفين وحفظها سحابياً مع الربط الفوري بالواتساب والإيميل'}
            </p>
          </div>
          {isGuest && (
            <Link
              to="/auth"
              className="secondary-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              <LogIn size={15} />
              <span>العودة لصفحة الدخول</span>
            </Link>
          )}
        </header>
      )}

      {/* Guest Notice Banner */}
      {isGuest && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderRadius: '10px',
            background: 'rgba(79, 70, 229, 0.08)',
            border: '1px solid rgba(79, 70, 229, 0.2)',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <KeyRound size={22} style={{ color: '#4f46e5', flexShrink: 0 }} />
            <div>
              <strong style={{ display: 'block', fontSize: '13px', color: 'var(--ink, #1e293b)' }}>
                بوابة المساعدة العامة ومشاكل تسجيل الدخول
              </strong>
              <span style={{ fontSize: '12px', opacity: 0.8 }}>
                يمكنك كتابة بياناتك وتفاصيل العطل أو مشكلة الدخول أدناه، وسيتم تسجيل بلاغك فوراً والتواصل معك لمعالجة المشكلة.
              </span>
            </div>
          </div>
          <Link
            to="/auth"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#4f46e5',
              textDecoration: 'none',
              background: '#fff',
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(79, 70, 229, 0.3)',
            }}
          >
            <ArrowRight size={14} />
            <span>الرجوع لنموذج تسجيل الدخول</span>
          </Link>
        </div>
      )}

      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`inline-message ${statusMessage.type === 'success' ? 'success' : 'info'}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <CheckCircle2 size={18} />
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', opacity: 0.7 }}
          >
            إغلاق
          </button>
        </div>
      )}

      {/* SUCCESS CONFIRMATION CARD (Shows on Ticket Creation) */}
      {submittedTicket && (
        <div
          className="card-surface"
          style={{
            border: '2px solid #10b981',
            background: 'rgba(16, 185, 129, 0.05)',
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#065f46' }}>
                  تم استلام وتوثيق تذكرتك بنجاح برقم: #{submittedTicket.ticket_number}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#047857' }}>
                  تم حفظ البلاغ في قاعدة البيانات المركزية. سيقوم فريق الدعم الفني بمراجعة المشكلة والاتصال بك.
                </p>
              </div>
            </div>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '15px', background: '#d1fae5', color: '#065f46', padding: '6px 14px', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
              #{submittedTicket.ticket_number}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '12px', background: 'var(--surface, #fff)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line, #e2e8f0)' }}>
            <div><span style={{ opacity: 0.6 }}>الاسم:</span> <strong>{submittedTicket.employee_name}</strong></div>
            <div><span style={{ opacity: 0.6 }}>هاتف التواصل:</span> <strong>{submittedTicket.employee_code || 'غير محدد'}</strong></div>
            <div><span style={{ opacity: 0.6 }}>التصنيف:</span> <strong>{submittedTicket.category}</strong></div>
            <div><span style={{ opacity: 0.6 }}>الحالة:</span> <span style={{ color: '#059669', fontWeight: 700 }}>{submittedTicket.status}</span></div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid rgba(16, 185, 129, 0.2)', paddingTop: '14px' }}>
            <button
              type="button"
              onClick={() => handleCopyTicket(submittedTicket)}
              className="secondary-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 14px' }}
            >
              {copiedId === submittedTicket.id ? <Check size={14} style={{ color: '#16a34a' }} /> : <Copy size={14} />}
              <span>{copiedId === submittedTicket.id ? 'تم نسخ التذكرة' : 'نسخ بيانات التذكرة'}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePrintTicket(submittedTicket)}
              className="secondary-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 14px' }}
            >
              <Printer size={14} />
              <span>طباعة إيصال التذكرة</span>
            </button>

            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(formatTicketWhatsAppMessage(submittedTicket))}`}
              target="_blank"
              rel="noreferrer"
              className="primary-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                backgroundColor: '#16a34a',
                borderColor: '#16a34a',
                textDecoration: 'none',
                padding: '8px 14px',
                borderRadius: '8px',
                color: '#fff',
                fontWeight: 700,
              }}
            >
              <Phone size={14} />
              <span>مراسلة الدعم بالواتساب مباشرة</span>
            </a>

            {isGuest && (
              <Link
                to="/auth"
                className="secondary-btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  textDecoration: 'none',
                  padding: '8px 14px',
                  marginRight: 'auto',
                }}
              >
                <LogIn size={14} />
                <span>العودة لصفحة تسجيل الدخول</span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setSubmittedTicket(null)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}
            >
              فتح تذكرة أخرى
            </button>
          </div>
        </div>
      )}

      {/* Regular Employee / Guest View: Submit ticket & personal history (Hidden from System Admin) */}
      {!isSysAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>

          {/* Primary Ticket Form Card */}
          <section className="card-surface" style={{ gridColumn: 'span 2' }}>
            <div className="section-head" style={{ borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} style={{ color: 'var(--accent, #3b82f6)' }} />
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {isGuest ? 'فتح تذكرة دعم فني وبلاغ مشكلة دخول' : 'فتح تذكرة بلاغ أو شكوى جديدة'}
                  </h3>
                </div>
                <span
                  style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--accent, #3b82f6)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                >
                  رقم التذكرة: #{ticketNumber}
                </span>
              </div>
            </div>

            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void handleDirectSubmit()
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              {/* Row 1: Name, Phone, and Email */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <User size={14} style={{ color: 'var(--accent, #3b82f6)' }} />
                      {isGuest ? 'الاسم بالكامل للموظف / المستخدم' : 'اسم الموظف'} <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    required
                    value={employeeName}
                    onChange={(e) => setEmployeeName(e.target.value)}
                    placeholder="مثال: أحمد محمد علي"
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Phone size={14} style={{ color: '#16a34a' }} />
                      رقم الهاتف / الواتساب للتواصل {isGuest && <span style={{ color: '#ef4444' }}>*</span>}
                    </span>
                  </label>
                  <input
                    type="text"
                    required={isGuest && !employeeEmail.trim()}
                    value={employeePhone}
                    onChange={(e) => setEmployeePhone(e.target.value)}
                    placeholder="مثال: 010xxxxxxxx"
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Mail size={14} style={{ color: 'var(--accent, #3b82f6)' }} />
                      البريد أو اسم المستخدم <small style={{ fontWeight: 400, opacity: 0.7 }}>(اختياري)</small>
                    </span>
                  </label>
                  <input
                    type="text"
                    value={employeeEmail}
                    onChange={(e) => setEmployeeEmail(e.target.value)}
                    placeholder="مثال: user@example.com أو اسم الحساب"
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              {/* Row 2: Department & Issue Category */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Building2 size={14} style={{ color: 'var(--accent, #3b82f6)' }} />
                      الجهة / الكلية / القسم <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <HelpCircle size={14} style={{ color: 'var(--accent, #3b82f6)' }} />
                      نوع المشكلة أو التصنيف <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Priority & Subject */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div style={{ flex: '1' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                      درجة الأهمية
                    </span>
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TicketPriority)}
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="عادي">عادي (خلال 24-48 ساعة)</option>
                    <option value="متوسط">متوسط (خلال ساعات العمل اليومية)</option>
                    <option value="عاجل جداً">عاجل جداً (توقف كلي للعمل / تعذر الدخول)</option>
                  </select>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <FileText size={14} style={{ color: 'var(--accent, #3b82f6)' }} />
                      عنوان المشكلة باختصار <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={isGuest ? 'مثال: تعذر تسجيل الدخول أو كلمة المرور غير صحيحة' : 'مثال: تعذر تسجيل إذن صرف صنف معين أو خطأ في الحفظ'}
                    className="input-field"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                      color: 'var(--ink, #1e293b)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              {/* Row 4: Description */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                  <span>تفاصيل المشكلة والشكوى</span> <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isGuest
                      ? 'يرجى كتابة ما يحدث عند محاولة تسجيل الدخول، نص رسالة الخطأ الظاهرة إن وجدت، وأي معلومات إضافية للتواصل معك...'
                      : 'يرجى كتابة ما حدث بالتفصيل، رقم إذن الصرف أو الصنف المتعلق به، نص رسالة الخطأ إن وجدت، وأي ملاحظات تساعد الدعم الفني لحل المشكلة بسرعة...'
                  }
                  className="input-field"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--line, #cbd5e1)',
                    background: 'var(--surface, #fff)',
                    color: 'var(--ink, #1e293b)',
                    fontSize: '13px',
                    lineHeight: '1.6',
                  }}
                />
              </div>

              {/* Row 5: Optional File/Image Upload */}
              <div
                style={{
                  border: '2px dashed var(--line, #cbd5e1)',
                  padding: '14px',
                  borderRadius: '10px',
                  background: 'rgba(0,0,0,0.015)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Paperclip size={15} style={{ color: 'var(--accent, #3b82f6)' }} />
                    إرفاق صورة شاشة الخطأ أو مستند توضيحي (اختياري)
                  </span>
                  <span style={{ fontSize: '11px', opacity: 0.6 }}>يتم رفعها تلقائياً لقاعدة البيانات وسحابة التخزين (حتى 10MB)</span>
                </div>

                {!attachment.file ? (
                  <div style={{ position: 'relative', cursor: 'pointer' }}>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={handleFileChange}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: 'pointer',
                      }}
                    />
                    <div style={{ padding: '12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent, #3b82f6)' }}>
                        <ImageIcon size={18} />
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink, #1e293b)' }}>
                        انقر لاختيار صورة أو اسحب وأفلت الملف هنا
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'var(--surface, #fff)',
                      border: '1px solid var(--line, #e2e8f0)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {attachment.previewUrl ? (
                        <img
                          src={attachment.previewUrl}
                          alt="معاينة"
                          style={{ width: '45px', height: '45px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                        />
                      ) : (
                        <FileText size={24} style={{ color: 'var(--accent, #3b82f6)' }} />
                      )}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>{attachment.name}</div>
                        <div style={{ fontSize: '11px', opacity: 0.6 }}>{attachment.sizeFormatted}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeAttachment}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                      }}
                    >
                      <Trash2 size={14} />
                      <span>إزالة</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>
                  سيتم تسجيل وحفظ التذكرة مركزياً، اختر طريقة الإرسال المناسبة:
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  {/* Direct Database Submit */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleDirectSubmit()}
                    className="primary-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px',
                      fontWeight: 700,
                      fontSize: '13px',
                      borderRadius: '8px',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting ? 0.7 : 1,
                    }}
                  >
                    <Send size={16} />
                    <span>{isSubmitting ? 'جارٍ الحفظ والرفع...' : 'تسجيل وحفظ التذكرة فوراً'}</span>
                  </button>

                  {/* Send via WhatsApp */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSendWhatsApp()}
                    className="primary-btn"
                    style={{
                      backgroundColor: '#16a34a',
                      borderColor: '#16a34a',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px',
                      fontWeight: 700,
                      fontSize: '13px',
                      borderRadius: '8px',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting ? 0.7 : 1,
                    }}
                  >
                    <Phone size={16} />
                    <span>{isSubmitting ? 'جارٍ الحفظ...' : `حفظ ومراسلة عبر الواتساب (${SUPPORT_PHONE})`}</span>
                  </button>

                  {/* Send via Email */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSendEmail()}
                    className="secondary-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px',
                      fontWeight: 700,
                      fontSize: '13px',
                      borderRadius: '8px',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting ? 0.7 : 1,
                    }}
                  >
                    <Mail size={16} />
                    <span>{isSubmitting ? 'جارٍ الحفظ...' : 'حفظ وإرسال عبر الإيميل'}</span>
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* Sidebar Info & Tickets History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Support Channels Card */}
            <section className="card-surface" style={{ background: 'var(--surface-sunken, #f8fafc)' }}>
              <div className="section-head" style={{ borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={16} style={{ color: 'var(--accent, #3b82f6)' }} />
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>مسؤولو الدعم المباشر</h4>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                {/* WhatsApp Link */}
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid var(--line, #cbd5e1)',
                    background: 'var(--surface, #fff)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(22, 163, 74, 0.1)', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Phone size={16} />
                  </div>
                  <div>
                    <div style={{ opacity: 0.7, fontSize: '11px' }}>واتساب وهاتف الطوارئ:</div>
                    <div style={{ fontWeight: 800, fontFamily: 'monospace', color: '#16a34a', fontSize: '13px' }}>
                      {SUPPORT_PHONE}
                    </div>
                  </div>
                </a>

                {/* Email Link */}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid var(--line, #cbd5e1)',
                    background: 'var(--surface, #fff)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mail size={16} />
                  </div>
                  <div>
                    <div style={{ opacity: 0.7, fontSize: '11px' }}>البريد الإلكتروني للشكاوى:</div>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                      {SUPPORT_EMAIL}
                    </div>
                  </div>
                </a>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
                  <Sparkles size={14} style={{ color: 'var(--accent, #3b82f6)', flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    جميع التذاكر والمرفقات تحفظ مركزياً في قاعدة البيانات وسحابة التخزين لمتابعة حالة الحل.
                  </span>
                </div>
              </div>
            </section>

            {/* Past Tickets Log */}
            <section className="card-surface">
              <div className="section-head" style={{ borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={16} style={{ color: 'var(--accent, #3b82f6)' }} />
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                      {isGuest ? 'تذاكرك في هذه الجلسة' : 'سجل التذاكر'}
                    </h4>
                    <span style={{ background: 'var(--line, #e2e8f0)', padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>
                      {(isGuest ? guestSubmittedTickets : tickets).length}
                    </span>
                  </div>
                  {!isGuest && (
                    <button
                      type="button"
                      onClick={() => void loadTickets()}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent, #3b82f6)' }}
                      title="تحديث من قاعدة البيانات"
                    >
                      <RotateCw size={12} className={isLoading ? 'animate-spin' : ''} />
                      <span>تحديث</span>
                    </button>
                  )}
                </div>
              </div>

              {(isGuest ? guestSubmittedTickets : tickets).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 8px', opacity: 0.6, fontSize: '12px' }}>
                  <MessageSquare size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                  <p style={{ margin: 0 }}>
                    {isGuest
                      ? 'أي تذكرة تقوم بفتحها ستظهر هنا فوراً مع رقمها وحالتها.'
                      : 'لا توجد تذاكر مسجلة بعد.'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto' }}>
                  {(isGuest ? guestSubmittedTickets : tickets).map((t) => (
                    <div
                      key={t.id}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid var(--line, #e2e8f0)',
                        background: 'var(--surface-sunken, #f8fafc)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent, #3b82f6)' }}>
                          #{t.ticket_number}
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              backgroundColor:
                                t.status === 'تم الحل'
                                  ? 'rgba(22, 163, 74, 0.15)'
                                  : t.status === 'قيد المعالجة'
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                              color:
                                t.status === 'تم الحل'
                                  ? '#16a34a'
                                  : t.status === 'قيد المعالجة'
                                    ? '#b45309'
                                    : '#ef4444',
                            }}
                          >
                            {t.status}
                          </span>
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.subject}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', opacity: 0.7, borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: '4px' }}>
                        <span>{t.department}</span>
                        <span>{new Date(t.created_at).toLocaleDateString('ar-EG')}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                        <button
                          type="button"
                          onClick={() => handleCopyTicket(t)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          {copiedId === t.id ? (
                            <>
                              <Check size={12} style={{ color: '#16a34a' }} />
                              <span style={{ color: '#16a34a', fontWeight: 700 }}>تم النسخ</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span>نسخ</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handlePrintTicket(t)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Printer size={12} />
                          <span>طباعة</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTicket(t)
                            setAdminNoteInput(t.admin_notes || '')
                          }}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--accent, #3b82f6)', fontWeight: 700 }}
                        >
                          تفاصيل
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </div>

        </div>
      )}

      {/* SYSTEM ADMIN VIEW: Exclusively Tickets Management & Reviewing User Issues */}
      {isSysAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* 4 Summary KPI Cards for System Admin */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px',
            }}
          >
            {/* Card 1: Total */}
            <div
              className="card-surface"
              style={{
                padding: '16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                borderRight: '4px solid var(--accent, #3b82f6)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--accent, #3b82f6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FileText size={22} />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.7, fontWeight: 700 }}>إجمالي التذاكر المسجلة</div>
                <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px' }}>{tickets.length}</div>
              </div>
            </div>

            {/* Card 2: Open */}
            <div
              className="card-surface"
              style={{
                padding: '16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                borderRight: '4px solid #ef4444',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.7, fontWeight: 700 }}>تذاكر مفتوحة وبانتظار الفحص</div>
                <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: '#ef4444' }}>
                  {tickets.filter((t) => t.status === 'مفتوحة').length}
                </div>
              </div>
            </div>

            {/* Card 3: In Progress */}
            <div
              className="card-surface"
              style={{
                padding: '16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                borderRight: '4px solid #f59e0b',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Clock size={22} />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.7, fontWeight: 700 }}>قيد المعالجة الفنية</div>
                <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: '#b45309' }}>
                  {tickets.filter((t) => t.status === 'قيد المعالجة').length}
                </div>
              </div>
            </div>

            {/* Card 4: Resolved */}
            <div
              className="card-surface"
              style={{
                padding: '16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                borderRight: '4px solid #10b981',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 size={22} />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.7, fontWeight: 700 }}>تذاكر تم حلها بالكامل</div>
                <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: '#059669' }}>
                  {tickets.filter((t) => t.status === 'تم الحل').length}
                </div>
              </div>
            </div>
          </div>

          {/* Tickets Management and Review Table Card */}
          <section className="card-surface">
            <div className="section-head" style={{ borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>إدارة التذاكر ومراجعة مشاكل المستخدمين</h3>
                  <span style={{ fontSize: '12px', opacity: 0.7 }}>متابعة فورية ومباشرة لكافة البلاغات الواردة من موظفي الأقسام والمستودعات</span>
                </div>

                {/* Filters toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* Search */}
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                    <input
                      type="search"
                      placeholder="بحث برقم التذكرة أو الموظف..."
                      value={adminSearch}
                      onChange={(e) => setAdminSearch(e.target.value)}
                      style={{
                        padding: '6px 28px 6px 10px',
                        fontSize: '12px',
                        borderRadius: '8px',
                        border: '1px solid var(--line, #cbd5e1)',
                        background: 'var(--surface, #fff)',
                      }}
                    />
                  </div>

                  {/* Status Filter */}
                  <select
                    value={adminStatusFilter}
                    onChange={(e) => setAdminStatusFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                    }}
                  >
                    <option value="all">كل الحالات</option>
                    <option value="مفتوحة">المفتوحة فقط 🔴</option>
                    <option value="قيد المعالجة">قيد المعالجة 🟡</option>
                    <option value="تم الحل">تم الحل 🟢</option>
                  </select>

                  {/* Dept Filter */}
                  <select
                    value={adminDeptFilter}
                    onChange={(e) => setAdminDeptFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--line, #cbd5e1)',
                      background: 'var(--surface, #fff)',
                    }}
                  >
                    <option value="all">كل الأقسام</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => void loadTickets()}
                    className="secondary-btn"
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    title="تحديث القائمة"
                  >
                    <RotateCw size={13} className={isLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
            </div>

            {/* Admin Tickets Table / Grid */}
            {filteredAdminTickets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', opacity: 0.6 }}>
                <p>لا توجد تذاكر تطابق معايير البحث والفلترة.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--line, #e2e8f0)', background: 'var(--surface-sunken, #f8fafc)' }}>
                      <th style={{ padding: '10px 12px' }}>رقم التذكرة</th>
                      <th style={{ padding: '10px 12px' }}>الموظف</th>
                      <th style={{ padding: '10px 12px' }}>القسم</th>
                      <th style={{ padding: '10px 12px' }}>الأولوية</th>
                      <th style={{ padding: '10px 12px' }}>عنوان المشكلة</th>
                      <th style={{ padding: '10px 12px' }}>الحالة</th>
                      <th style={{ padding: '10px 12px' }}>التاريخ</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>إجراءات الأدمن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdminTickets.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--line, #e2e8f0)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent, #3b82f6)' }}>
                          #{t.ticket_number}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div><strong>{t.employee_name}</strong></div>
                          {t.employee_code && <small style={{ opacity: 0.7, display: 'block' }}>{t.employee_code}</small>}
                          {t.employee_email && <small style={{ opacity: 0.8, color: 'var(--accent, #3b82f6)', display: 'block' }}>{t.employee_email}</small>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{t.department}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              backgroundColor:
                                t.priority === 'عاجل جداً'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : t.priority === 'متوسط'
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(59, 130, 246, 0.15)',
                              color:
                                t.priority === 'عاجل جداً'
                                  ? '#ef4444'
                                  : t.priority === 'متوسط'
                                    ? '#b45309'
                                    : 'var(--accent, #3b82f6)',
                            }}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.subject}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              backgroundColor:
                                t.status === 'تم الحل'
                                  ? 'rgba(22, 163, 74, 0.15)'
                                  : t.status === 'قيد المعالجة'
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                              color:
                                t.status === 'تم الحل'
                                  ? '#16a34a'
                                  : t.status === 'قيد المعالجة'
                                    ? '#b45309'
                                    : '#ef4444',
                            }}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '11px', opacity: 0.7 }}>
                          {new Date(t.created_at).toLocaleDateString('ar-EG')}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {/* Quick change to in progress */}
                            {t.status === 'مفتوحة' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateStatus(t.id, 'قيد المعالجة')}
                                title="بدء المعالجة"
                                style={{
                                  background: 'rgba(245, 158, 11, 0.15)',
                                  color: '#b45309',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: '6px',
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                معالجة ⏳
                              </button>
                            )}

                            {/* Quick change to resolved */}
                            {t.status !== 'تم الحل' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateStatus(t.id, 'تم الحل')}
                                title="تأكيد حل المشكلة"
                                style={{
                                  background: 'rgba(22, 163, 74, 0.15)',
                                  color: '#16a34a',
                                  border: '1px solid rgba(22, 163, 74, 0.3)',
                                  borderRadius: '6px',
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                حل ✅
                              </button>
                            )}

                            {/* Open Details Modal */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTicket(t)
                                setAdminNoteInput(t.admin_notes || '')
                              }}
                              className="secondary-btn"
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                            >
                              عرض كامل
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* MODAL FOR VIEWING AND MANAGING TICKET DETAILS */}
      {selectedTicket && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            className="card-surface"
            style={{
              maxWidth: '580px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent, #3b82f6)', fontSize: '16px' }}>
                  #{selectedTicket.ticket_number}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 700 }}>بيانات التذكرة المسجلة بالداتابيز</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', background: 'var(--surface-sunken, #f8fafc)', padding: '10px', borderRadius: '8px' }}>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>الموظف:</span>
                <strong>{selectedTicket.employee_name}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>القسم:</span>
                <strong>{selectedTicket.department}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>الأولوية:</span>
                <strong>{selectedTicket.priority}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>الحالة:</span>
                <strong>{selectedTicket.status}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>التاريخ:</span>
                <span>{new Date(selectedTicket.created_at).toLocaleString('ar-EG')}</span>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>هاتف / كود:</span>
                <span>{selectedTicket.employee_code || 'غير محدد'}</span>
              </div>
              <div>
                <span style={{ opacity: 0.6, display: 'block' }}>البريد / الحساب:</span>
                <span>{selectedTicket.employee_email || 'غير محدد'}</span>
              </div>
            </div>

            <div>
              <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '4px' }}>عنوان المشكلة:</span>
              <div style={{ fontWeight: 700, fontSize: '13px', padding: '8px 10px', borderRadius: '6px', background: 'var(--surface-sunken, #f8fafc)' }}>
                {selectedTicket.subject}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '4px' }}>تفاصيل البلاغ:</span>
              <div style={{ fontSize: '12px', padding: '10px', borderRadius: '6px', background: 'var(--surface-sunken, #f8fafc)', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                {selectedTicket.description}
              </div>
            </div>

            {/* Attachment preview / link */}
            {(selectedTicket.attachment_url || selectedTicket.attachment_name) && (
              <div>
                <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '4px' }}>الملف المرفق:</span>
                <div style={{ fontSize: '12px', padding: '8px 10px', borderRadius: '6px', background: 'var(--surface-sunken, #f8fafc)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{selectedTicket.attachment_name || 'ملف مرفق'}</span>
                  {selectedTicket.attachment_url && (
                    <a
                      href={selectedTicket.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent, #3b82f6)', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', fontWeight: 700 }}
                    >
                      <ExternalLink size={13} />
                      <span>فتح الملف المرفق</span>
                    </a>
                  )}
                </div>
                {selectedTicket.attachment_url && selectedTicket.attachment_type?.startsWith('image/') && (
                  <div style={{ marginTop: '8px', textAlign: 'center' }}>
                    <img
                      src={selectedTicket.attachment_url}
                      alt="مرفق التذكرة"
                      style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: '6px', border: '1px solid var(--line, #e2e8f0)' }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* System Admin Response / Notes Section (Editable by System Admin ONLY) */}
            {isSysAdmin ? (
              <div style={{ borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  ملاحظات وردود مسؤول الدعم الفني (تُحفظ في الداتابيز):
                </span>
                <textarea
                  rows={3}
                  value={adminNoteInput}
                  onChange={(e) => setAdminNoteInput(e.target.value)}
                  placeholder="اكتب ملاحظاتك أو الحل المقترح ليظهر للموظف..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--line, #cbd5e1)',
                    background: 'var(--surface, #fff)',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void handleUpdateStatus(selectedTicket.id, selectedTicket.status, adminNoteInput)}
                    className="secondary-btn"
                    style={{ fontSize: '11px', padding: '6px 12px' }}
                  >
                    حفظ الملاحظة فقط 💾
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdateStatus(selectedTicket.id, 'قيد المعالجة', adminNoteInput)}
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#b45309',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    تحويل لـ قيد المعالجة ⏳
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUpdateStatus(selectedTicket.id, 'تم الحل', adminNoteInput)}
                    style={{
                      background: 'rgba(22, 163, 74, 0.15)',
                      color: '#16a34a',
                      border: '1px solid rgba(22, 163, 74, 0.3)',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    تحديد كـ تم الحل ✅
                  </button>
                </div>
              </div>
            ) : (
              selectedTicket.admin_notes && (
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px', color: '#16a34a' }}>
                    رد وملاحظات الدعم الفني:
                  </span>
                  <div style={{ fontSize: '12px', padding: '10px', borderRadius: '6px', background: 'rgba(22, 163, 74, 0.08)', border: '1px solid rgba(22, 163, 74, 0.2)' }}>
                    {selectedTicket.admin_notes}
                  </div>
                </div>
              )
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: '12px' }}>
              <button
                type="button"
                onClick={() => handlePrintTicket(selectedTicket)}
                className="secondary-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                <Printer size={14} />
                <span>طباعة الإيصال</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="secondary-btn"
                style={{ fontSize: '12px' }}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  )
}
