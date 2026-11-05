import { useState, useEffect, useMemo, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  PackageCheck,
  Search,
  Filter,
  Eye,
  X,
  FileText,
  RotateCw,
} from 'lucide-react'
import {
  fetchDisbursementRequests,
  createDisbursementRequest,
  updateDisbursementRequestStatus,
  type DisbursementRequest,
} from '../lib/disbursementRequestsRepository'
import { isSystemAdmin, canAddDepartment } from '../lib/permissions'
import { logAuditEvent } from '../lib/auditLogger'
import { WAREHOUSES } from '../lib/custody'

type DisbursementRequestsPageProps = {
  session?: Session | null
}

const DEPARTMENTS = [
  'المستودعات والمخازن',
  'الحسابات والمالية',
  'المشتريات والتوريدات',
  'الموارد البشرية (HR)',
  'إدارة تكنولوجيا المعلومات (IT)',
  'الإدارة العامة ورئاسة الجامعة',
  'كلية الهندسة',
  'كلية الطب البشري',
  'كلية الصيدلة',
  'كلية طب الأسنان',
  'كلية الحاسبات والذكاء الاصطناعي',
  'كلية العلوم',
  'كلية التمريض',
  'المدينة الجامعية والخدمات',
  'أخرى',
]

const PRIORITY_CONFIG = {
  low: { label: 'منخفضة', className: 'badge-info' },
  normal: { label: 'عادية', className: 'badge-neutral' },
  high: { label: 'عالية', className: 'badge-warn' },
  urgent: { label: 'عاجلة جداً', className: 'badge-danger' },
}

const STATUS_CONFIG = {
  pending: { label: 'قيد المراجعة', icon: Clock, className: 'status-tag pending' },
  approved: { label: 'معتمد للصرف', icon: CheckCircle2, className: 'status-tag full' },
  rejected: { label: 'مرفوض', icon: XCircle, className: 'status-tag over' },
  issued: { label: 'تم الصرف والتسليم', icon: PackageCheck, className: 'status-tag part' },
}

export default function DisbursementRequestsPage({ session }: DisbursementRequestsPageProps) {
  const canAdd = canAddDepartment(session, 'warehouse')
  const [requests, setRequests] = useState<DisbursementRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedRequest, setSelectedRequest] = useState<DisbursementRequest | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [rejectionModalRequest, setRejectionModalRequest] = useState<DisbursementRequest | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionSuccess, setActionSuccess] = useState('')

  // Form states
  const [requesterName, setRequesterName] = useState(
    session?.user?.user_metadata?.displayName || session?.user?.user_metadata?.name || ''
  )
  const [requesterDepartment, setRequesterDepartment] = useState(DEPARTMENTS[0])
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState<number | ''>('')
  const [unit, setUnit] = useState('قطعة')
  const [purpose, setPurpose] = useState('')
  const [priority, setPriority] = useState<DisbursementRequest['priority']>('normal')
  const [warehouseId, setWarehouseId] = useState('main')
  const [notes, setNotes] = useState('')

  const isAdmin = isSystemAdmin(session)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const data = await fetchDisbursementRequests()
      setRequests(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (statusFilter !== 'all' && req.status !== statusFilter) return false
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (
        req.request_number.toLowerCase().includes(term) ||
        req.item_name.toLowerCase().includes(term) ||
        req.requester_name.toLowerCase().includes(term) ||
        req.requester_department.toLowerCase().includes(term) ||
        req.purpose.toLowerCase().includes(term)
      )
    })
  }, [requests, statusFilter, searchTerm])

  const kpis = useMemo(() => {
    const total = requests.length
    const pending = requests.filter((r) => r.status === 'pending').length
    const approved = requests.filter((r) => r.status === 'approved').length
    const issued = requests.filter((r) => r.status === 'issued').length
    return { total, pending, approved, issued }
  }, [requests])

  const handleCreateRequest = async (e: FormEvent) => {
    e.preventDefault()
    if (!canAdd) return
    if (!itemName.trim() || !quantity || Number(quantity) <= 0 || !purpose.trim()) {
      alert('يرجى ملء جميع الحقول الإلزامية وتحديد كمية أكبر من صفر.')
      return
    }

    setIsSubmitting(true)
    try {
      const reqNumber = `REQ-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
      const newReq = await createDisbursementRequest({
        request_number: reqNumber,
        requester_name: requesterName.trim() || 'موظف مصرح',
        requester_department: requesterDepartment,
        item_name: itemName.trim(),
        quantity_requested: Number(quantity),
        unit: unit.trim() || 'قطعة',
        purpose: purpose.trim(),
        priority,
        status: 'pending',
        warehouse_id: warehouseId,
        notes: notes.trim(),
        created_by: session?.user?.id,
        created_by_email: session?.user?.email,
      })

      setRequests((prev) => [newReq, ...prev])
      setIsAddModalOpen(false)
      setItemName('')
      setQuantity('')
      setPurpose('')
      setNotes('')
      setActionSuccess(`تم تسجيل طلب الصرف بنجاح برقم: ${reqNumber}`)

      void logAuditEvent({
        action: `تقديم طلب صرف داخلي: ${itemName}`,
        entity_type: 'request',
        details: { request_number: reqNumber, item: itemName, quantity },
        user: session?.user,
      })
    } catch {
      alert('حدث خطأ أثناء حفظ طلب الصرف.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApprove = async (req: DisbursementRequest) => {
    if (!window.confirm(`هل أنت متأكد من اعتماد طلب الصرف رقم ${req.request_number}؟`)) return
    setIsSubmitting(true)
    try {
      const approver = session?.user?.user_metadata?.displayName || session?.user?.email || 'مدير النظام'
      await updateDisbursementRequestStatus(req.id, 'approved', {
        approved_by: approver,
        approved_at: new Date().toISOString(),
      })
      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: 'approved', approved_by: approver, approved_at: new Date().toISOString() }
            : r
        )
      )
      if (selectedRequest?.id === req.id) {
        setSelectedRequest((prev) =>
          prev ? { ...prev, status: 'approved', approved_by: approver, approved_at: new Date().toISOString() } : null
        )
      }
      setActionSuccess(`تم اعتماد طلب الصرف رقم ${req.request_number} بنجاح.`)

      void logAuditEvent({
        action: `اعتماد طلب صرف: ${req.request_number}`,
        entity_type: 'request',
        details: { request_id: req.id, item: req.item_name, quantity: req.quantity_requested },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleIssue = async (req: DisbursementRequest) => {
    if (!window.confirm(`تأكيد تنفيذ الصرف الفعلي وتسليم العهدة للصنف: ${req.item_name}؟`)) return
    setIsSubmitting(true)
    try {
      await updateDisbursementRequestStatus(req.id, 'issued', {
        issued_at: new Date().toISOString(),
      })
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: 'issued', issued_at: new Date().toISOString() } : r))
      )
      if (selectedRequest?.id === req.id) {
        setSelectedRequest((prev) => (prev ? { ...prev, status: 'issued', issued_at: new Date().toISOString() } : null))
      }
      setActionSuccess(`تم تسجيل الصرف والتسليم الفعلي لطلب ${req.request_number}.`)

      void logAuditEvent({
        action: `صرف وتسليم فعلي لطلب: ${req.request_number}`,
        entity_type: 'request',
        details: { request_id: req.id, item: req.item_name },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async (e: FormEvent) => {
    e.preventDefault()
    if (!rejectionModalRequest || !rejectionReason.trim()) return
    setIsSubmitting(true)
    try {
      await updateDisbursementRequestStatus(rejectionModalRequest.id, 'rejected', {
        rejection_reason: rejectionReason.trim(),
      })
      setRequests((prev) =>
        prev.map((r) =>
          r.id === rejectionModalRequest.id
            ? { ...r, status: 'rejected', rejection_reason: rejectionReason.trim() }
            : r
        )
      )
      setRejectionModalRequest(null)
      setRejectionReason('')
      if (selectedRequest?.id === rejectionModalRequest.id) {
        setSelectedRequest((prev) =>
          prev ? { ...prev, status: 'rejected', rejection_reason: rejectionReason.trim() } : null
        )
      }
      setActionSuccess('تم رفض طلب الصرف وتوثيق السبب.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <ClipboardList size={24} />
        </div>
        <div>
          <p className="eyebrow">إدارة المخزن والتشغيل • جامعة الزقازيق الأهلية</p>
          <h2>طلبات الصرف الداخلي</h2>
          <p>تقديم واعتماد ومتابعة طلبات صرف المستلزمات والأدوات بين الكليات والأقسام وإدارة المخازن</p>
        </div>
        <div className="headline-actions mr-auto">
          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button hidden={!canAdd} type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={18} /> طلب صرف جديد
          </button>
        </div>
      </header>

      {actionSuccess && (
        <div className="inline-message success flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button type="button" className="input-action-btn" onClick={() => setActionSuccess('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">إجمالي الطلبات</span>
            <span className="badge-pill">الكل</span>
          </div>
          <div className="kpi-value">{kpis.total}</div>
          <div className="kpi-sub">طلب صرف مسجل بالمنظومة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">قيد المراجعة</span>
            <span className="badge-pill highlight">معلق</span>
          </div>
          <div className="kpi-value text-amber-500">{kpis.pending}</div>
          <div className="kpi-sub">بانتظار موافقة أمين المستودع</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">معتمد للصرف</span>
            <span className="badge-pill">معتمد</span>
          </div>
          <div className="kpi-value text-emerald-500">{kpis.approved}</div>
          <div className="kpi-sub">جاهز لإصدار إذن الصرف والتسليم</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">تم الصرف الفعلي</span>
            <span className="badge-pill">مكتمل</span>
          </div>
          <div className="kpi-value text-blue-500">{kpis.issued}</div>
          <div className="kpi-sub">تم تسليم العهدة للمستلم</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card-surface p-4">
        <div className="movements-filter-toolbar">
          <div className="input-search-wrap">
            <Search size={16} className="input-search-icon" />
            <input
              type="search"
              placeholder="ابحث برقم الطلب، اسم الصنف، مقدم الطلب أو الكلية..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-field w-full"
            />
          </div>

          <div className="filter-group">
            <Filter size={15} className="opacity-60" />
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              الكل ({requests.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              قيد المراجعة ({kpis.pending})
            </button>
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'approved' ? 'active' : ''}`}
              onClick={() => setStatusFilter('approved')}
            >
              معتمد ({kpis.approved})
            </button>
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'issued' ? 'active' : ''}`}
              onClick={() => setStatusFilter('issued')}
            >
              تم الصرف ({kpis.issued})
            </button>
          </div>
        </div>

        {/* Requests Table */}
        <div className="movement-table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>الصنف المطلوب</th>
                <th>مقدم الطلب / القسم</th>
                <th>الكمية</th>
                <th>الأولوية</th>
                <th>الحالة</th>
                <th>تاريخ الطلب</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty text-center py-8">
                    <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-muted">لا توجد طلبات صرف مطابقة للبحث أو الفلتر المختار.</p>
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => {
                  const statusInfo = STATUS_CONFIG[req.status]
                  const StatusIcon = statusInfo.icon
                  const priorityInfo = PRIORITY_CONFIG[req.priority]

                  return (
                    <tr key={req.id}>
                      <td className="font-semibold text-primary">{req.request_number}</td>
                      <td>
                        <strong>{req.item_name}</strong>
                        {req.purpose && <div className="text-muted text-xs truncate max-w-xs">{req.purpose}</div>}
                      </td>
                      <td>
                        <div>{req.requester_name}</div>
                        <small className="text-muted">{req.requester_department}</small>
                      </td>
                      <td>
                        <span className="font-bold">{req.quantity_requested}</span> {req.unit}
                      </td>
                      <td>
                        <span className={`status-pill ${priorityInfo.className}`}>{priorityInfo.label}</span>
                      </td>
                      <td>
                        <span className={statusInfo.className}>
                          <StatusIcon size={14} className="inline ml-1" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td>{new Date(req.created_at).toLocaleDateString('ar-EG')}</td>
                      <td className="actions-cell">
                        <div className="action-buttons-wrap">
                          <button
                            type="button"
                            className="table-action-btn edit-action-btn"
                            onClick={() => setSelectedRequest(req)}
                            title="عرض تفاصيل الطلب"
                          >
                            <Eye size={15} />
                            <span>عرض</span>
                          </button>

                          {isAdmin && req.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="table-action-btn text-emerald-600 hover:bg-emerald-50"
                                onClick={() => handleApprove(req)}
                                title="اعتماد الطلب"
                                disabled={isSubmitting}
                              >
                                <CheckCircle2 size={15} />
                                <span>اعتماد</span>
                              </button>
                              <button
                                type="button"
                                className="table-action-btn text-red-600 hover:bg-red-50"
                                onClick={() => setRejectionModalRequest(req)}
                                title="رفض الطلب"
                                disabled={isSubmitting}
                              >
                                <XCircle size={15} />
                                <span>رفض</span>
                              </button>
                            </>
                          )}

                          {isAdmin && req.status === 'approved' && (
                            <button
                              type="button"
                              className="table-action-btn text-blue-600 hover:bg-blue-50"
                              onClick={() => handleIssue(req)}
                              title="تسجيل الصرف الفعلي"
                              disabled={isSubmitting}
                            >
                              <PackageCheck size={15} />
                              <span>صرف</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New Disbursement Request */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon">
                  <Plus size={18} />
                </div>
                <div>
                  <h3>تقديم طلب صرف مستلزمات داخلي</h3>
                  <span className="modal-subtitle">سيتم إرسال الطلب لأمين المخزن للمراجعة والاعتماد</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  اسم مقدم الطلب *
                  <input
                    type="text"
                    required
                    value={requesterName}
                    onChange={(e) => setRequesterName(e.target.value)}
                    placeholder="الاسم الثلاثي أو الوظيفي"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الكلية أو القسم الطالب *
                  <select
                    value={requesterDepartment}
                    onChange={(e) => setRequesterDepartment(e.target.value)}
                    className="p-2 border rounded"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">
                  اسم الصنف المطلوب *
                  <input
                    type="text"
                    required
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="مثال: شاشات ذكية، أوراق تصوير، أدوات معملية..."
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الكمية المطلوبة *
                  <div className="flex gap-2">
                    <input
                      type="number"
                      required
                      min="1"
                      step="any"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                      placeholder="العدد"
                      className="p-2 border rounded w-2/3"
                    />
                    <input
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="الوحدة"
                      className="p-2 border rounded w-1/3"
                    />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  درجة الأولوية
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as DisbursementRequest['priority'])}
                    className="p-2 border rounded"
                  >
                    <option value="low">منخفضة (خلال أسبوعين)</option>
                    <option value="normal">عادية (خلال أسبوع)</option>
                    <option value="high">عالية (خلال 48 ساعة)</option>
                    <option value="urgent">عاجلة جداً (فوري اليوم)</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  المخزن المصدر
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="p-2 border rounded"
                  >
                    {WAREHOUSES.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                الغرض من الصرف ومكان الاستخدام *
                <textarea
                  required
                  rows={2}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="بيان الحاجة والجهة أو القاعة المستفيدة بالتحديد..."
                  className="p-2 border rounded"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                ملاحظات إضافية
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="أي مواصفات خاصة أو تعليمات تسليم..."
                  className="p-2 border rounded"
                />
              </label>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  إلغاء
                </button>
                <button type="submit" className="primary-btn" disabled={isSubmitting}>
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ...' : 'إرسال طلب الصرف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Details View */}
      {selectedRequest && (
        <div className="modal-backdrop" onClick={() => setSelectedRequest(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon">
                  <FileText size={18} />
                </div>
                <div>
                  <h3>تفاصيل طلب الصرف الداخلي</h3>
                  <span className="modal-subtitle">{selectedRequest.request_number}</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedRequest(null)}
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-lg">
                <div>
                  <span className="text-muted text-xs block">الصنف:</span>
                  <strong className="text-base">{selectedRequest.item_name}</strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">الكمية:</span>
                  <strong className="text-base">
                    {selectedRequest.quantity_requested} {selectedRequest.unit}
                  </strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">مقدم الطلب:</span>
                  <span>{selectedRequest.requester_name}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">القسم / الكلية:</span>
                  <span>{selectedRequest.requester_department}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">الحالة:</span>
                  <span>{STATUS_CONFIG[selectedRequest.status].label}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">الأولوية:</span>
                  <span>{PRIORITY_CONFIG[selectedRequest.priority].label}</span>
                </div>
              </div>

              <div>
                <span className="text-muted text-xs block mb-1">الغرض من الصرف:</span>
                <p className="p-3 bg-muted/10 rounded">{selectedRequest.purpose}</p>
              </div>

              {selectedRequest.notes && (
                <div>
                  <span className="text-muted text-xs block mb-1">الملاحظات:</span>
                  <p className="p-3 bg-muted/10 rounded">{selectedRequest.notes}</p>
                </div>
              )}

              {selectedRequest.rejection_reason && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
                  <strong className="block text-xs mb-1">سبب الرفض:</strong>
                  {selectedRequest.rejection_reason}
                </div>
              )}

              {selectedRequest.approved_by && (
                <div className="text-xs text-muted flex gap-4 border-t pt-2">
                  <span>المعتمد: {selectedRequest.approved_by}</span>
                  {selectedRequest.approved_at && (
                    <span>التاريخ: {new Date(selectedRequest.approved_at).toLocaleDateString('ar-EG')}</span>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t">
                <button type="button" className="secondary-btn" onClick={() => setSelectedRequest(null)}>
                  إغلاق
                </button>

                {isAdmin && selectedRequest.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => {
                        setRejectionModalRequest(selectedRequest)
                      }}
                    >
                      <XCircle size={16} /> رفض الطلب
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => handleApprove(selectedRequest)}
                    >
                      <CheckCircle2 size={16} /> اعتماد الطلب
                    </button>
                  </div>
                )}

                {isAdmin && selectedRequest.status === 'approved' && (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => handleIssue(selectedRequest)}
                  >
                    <PackageCheck size={16} /> إتمام الصرف والتسليم
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rejection Reason */}
      {rejectionModalRequest && (
        <div className="modal-backdrop" onClick={() => setRejectionModalRequest(null)}>
          <div className="modal-dialog modal-dialog-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon modal-icon-danger">
                  <XCircle size={18} />
                </div>
                <div>
                  <h3>رفض طلب الصرف</h3>
                  <span className="modal-subtitle">{rejectionModalRequest.request_number}</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRejectionModalRequest(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReject} className="modal-confirm-body space-y-4">
              <p className="text-sm text-muted">
                يرجى توضيح سبب رفض طلب الصرف للصنف <strong>{rejectionModalRequest.item_name}</strong> لتسجيله في السجل الرسمي للمنظومة:
              </p>

              <textarea
                required
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="مثال: عدم كفاية الرصيد بالمخزن الرئيسي / يلزم إرفاق موافقة عميد الكلية أولاً..."
                className="w-full p-2 border rounded"
              />

              <div className="modal-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setRejectionModalRequest(null)}
                  disabled={isSubmitting}
                >
                  إلغاء
                </button>
                <button type="submit" className="danger-btn" disabled={isSubmitting}>
                  تأكيد الرفض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

