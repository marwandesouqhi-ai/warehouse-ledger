import { useState, useEffect, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import {
  fetchPurchaseRequests,
  fetchPurchaseRequestById,
  submitPurchaseRequestRpc,
  recordApprovalRpc,
  deletePurchaseRequest,
  type PurchaseRequest,
  type PurchaseRequestStatus,
} from '../../lib/procurementRepository'
import { WAREHOUSES } from '../../lib/custody'
import { can, isSystemAdmin } from '../../lib/permissions'
import { logAuditEvent } from '../../lib/auditLogger'
import { matchesSearch } from '../../lib/searchUtils'
import type { AppSettings } from '../../lib/settings'

interface PurchaseRequestsPageProps {
  session?: Session | null
  currency: AppSettings['currency']
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export default function PurchaseRequestsPage({ session, currency }: PurchaseRequestsPageProps) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseRequestStatus>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 10

  // Details Modal
  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [isSubmittingAction, setIsSubmittingAction] = useState(false)

  // Approval Decision Form
  const [approvalDecision, setApprovalDecision] = useState<'approved' | 'rejected'>('approved')
  const [approvalNote, setApprovalNote] = useState('')

  const isSysAdmin = isSystemAdmin(session)
  const canManage = isSysAdmin || can(session, 'manage_records')
  const activeUser = session?.user?.user_metadata?.displayName || session?.user?.email || 'مستخدم'

  async function loadRequests() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchPurchaseRequests()
      setRequests(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل طلبات الشراء من السحابة.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRequests()
  }, [])

  // Departments list derived from WAREHOUSES + current requests
  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const w of WAREHOUSES) {
      set.add(w.name)
    }
    for (const r of requests) {
      if (r.department && r.department.trim()) {
        set.add(r.department.trim())
      }
    }
    return Array.from(set).sort()
  }, [requests])

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (departmentFilter !== 'all' && r.department !== departmentFilter) return false
      if (searchTerm.trim()) {
        const itemNames = (r.items || []).map((i) => i.item_name).join(' ')
        const matches = matchesSearch(
          [r.request_no, r.department, r.requested_by, r.justification, itemNames],
          searchTerm
        )
        if (!matches) return false
      }
      return true
    })
  }, [requests, statusFilter, departmentFilter, searchTerm])

  const paginatedRequests = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredRequests.slice(start, start + pageSize)
  }, [filteredRequests, currentPage, pageSize])

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize))

  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, departmentFilter, searchTerm])

  async function openRequestDetails(req: PurchaseRequest) {
    setSelectedRequest(req)
    setActionError('')
    setActionSuccess('')
    setApprovalNote('')
    setApprovalDecision('approved')

    // Fetch full details with items & approvals
    try {
      const full = await fetchPurchaseRequestById(req.id)
      if (full) setSelectedRequest(full)
    } catch {
      // fallback to current
    }
  }

  async function handleSubmitRequestFromDetails() {
    if (!selectedRequest) return
    setIsSubmittingAction(true)
    setActionError('')

    try {
      await submitPurchaseRequestRpc(selectedRequest.id)
      await logAuditEvent({
        action: 'SUBMIT_PURCHASE_REQUEST',
        entity_type: 'purchase_request',
        entity_id: selectedRequest.id,
        details: { request_no: selectedRequest.request_no },
      })
      setActionSuccess('تم إرسال طلب الشراء إلى مسار الاعتماد بنجاح.')
      await loadRequests()
      const updated = await fetchPurchaseRequestById(selectedRequest.id)
      if (updated) setSelectedRequest(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر إرسال طلب الشراء.')
    } finally {
      setIsSubmittingAction(false)
    }
  }

  async function handleRecordApprovalSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRequest) return

    // Find next pending step
    const approvals = selectedRequest.approvals || []
    const nextStep = approvals.find((a) => a.decision === 'pending')
    if (!nextStep) {
      setActionError('تم اتخاذ القرار في كافة خطوات هذا الطلب مسبقاً.')
      return
    }

    setIsSubmittingAction(true)
    setActionError('')

    try {
      await recordApprovalRpc(
        selectedRequest.id,
        nextStep.step_no,
        approvalDecision,
        approvalNote
      )

      await logAuditEvent({
        action: 'RECORD_APPROVAL',
        entity_type: 'purchase_request',
        entity_id: selectedRequest.id,
        details: {
          request_no: selectedRequest.request_no,
          step_no: nextStep.step_no,
          decision: approvalDecision,
          note: approvalNote,
        },
      })

      setActionSuccess(`تم تسجيل قرار «${approvalDecision === 'approved' ? 'الموافقة' : 'الرفض'}» في خطوة «${nextStep.step_name}» بنجاح.`)
      setApprovalNote('')
      await loadRequests()
      const updated = await fetchPurchaseRequestById(selectedRequest.id)
      if (updated) setSelectedRequest(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر تسجيل قرار الاعتماد.')
    } finally {
      setIsSubmittingAction(false)
    }
  }

  async function handleDeleteDraft(req: PurchaseRequest) {
    if (!confirm(`هل أنت متأكد من حذف مسودة طلب الشراء «${req.request_no}»؟`)) return

    try {
      await deletePurchaseRequest(req.id)
      await logAuditEvent({
        action: 'DELETE_PURCHASE_REQUEST_DRAFT',
        entity_type: 'purchase_request',
        entity_id: req.id,
        details: { request_no: req.request_no },
      })
      await loadRequests()
      if (selectedRequest?.id === req.id) setSelectedRequest(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حذف المسودة.')
    }
  }

  return (
    <section className="movement-page card-surface purchases-page purchase-requests-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="requests" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '16px' }}>
        <div>
          <h2>
            <ClipboardList size={20} />
            {' '}
            طلبات الشراء والاعتمادات
          </h2>
          <span>متابعة دورة طلبات الشراء، خط سير الموافقات، ومراجعة الاحتياجات قبل التعاقد</span>
        </div>
        <div className="headline-actions">
          <NavLink
            to="/purchases/requests/new"
            className="primary-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={17} /> طلب شراء جديد
          </NavLink>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="movements-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        {/* Status Pills */}
        <div className="filter-pills" style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            الكل ({requests.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'draft' ? 'active' : ''}`}
            onClick={() => setStatusFilter('draft')}
          >
            مسودة ({requests.filter((r) => r.status === 'draft').length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setStatusFilter('pending')}
          >
            قيد الموافقة ({requests.filter((r) => r.status === 'pending').length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'approved' ? 'active' : ''}`}
            onClick={() => setStatusFilter('approved')}
          >
            معتمد ({requests.filter((r) => r.status === 'approved').length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'rejected' ? 'active' : ''}`}
            onClick={() => setStatusFilter('rejected')}
          >
            مرفوض ({requests.filter((r) => r.status === 'rejected').length})
          </button>
        </div>

        {/* Department Dropdown */}
        <div style={{ minWidth: '180px' }}>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
          >
            <option value="all">كافة الأقسام والمخازن</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div style={{ flex: '1', minWidth: '220px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '10px', color: 'var(--muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث برقم الطلب أو اسم الصنف أو مقدم الطلب..."
            style={{ width: '100%', padding: '8px 32px 8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
          />
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="table-loading" style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '8px' }} />
          <div>جارٍ تحميل طلبات الشراء من السحابة...</div>
        </div>
      ) : error ? (
        <div className="inline-message error" style={{ padding: '20px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={20} />
            <strong>تعذر جلب طلبات الشراء</strong>
          </div>
          <p style={{ margin: 0 }}>{error}</p>
          <button
            type="button"
            className="secondary-btn"
            style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            onClick={() => loadRequests()}
          >
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="empty-state card-surface" style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--line)' }}>
          <ClipboardList size={40} style={{ opacity: 0.35, marginBottom: '10px' }} />
          <h3>لا توجد طلبات شراء مطابقة</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
            {searchTerm || statusFilter !== 'all' || departmentFilter !== 'all'
              ? 'لم يتم العثور على أي طلبات تطابق الفلاتر أو نص البحث الحالي.'
              : 'لم يتم إنشاء أي طلبات شراء بعد.'}
          </p>
          <NavLink to="/purchases/requests/new" className="primary-btn">
            <Plus size={16} /> إنشاء طلب شراء جديد
          </NavLink>
        </div>
      ) : (
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="movements-table responsive-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>القسم الطالب</th>
                <th>مقدم الطلب</th>
                <th>البنود المطلوبة</th>
                <th style={{ textAlign: 'center' }}>القيمة التقديرية</th>
                <th style={{ textAlign: 'center' }}>التاريخ</th>
                <th style={{ textAlign: 'center' }}>الحالة</th>
                <th style={{ textAlign: 'center' }}>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRequests.map((req) => (
                <tr key={req.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--accent)', direction: 'ltr', textAlign: 'right' }}>
                      {req.request_no}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {req.purchase_type === 'direct' ? 'أمر مباشر' : req.purchase_type === 'practice' ? 'ممارسة' : 'مناقصة'}
                      {req.priority === 'urgent' && ' • ⚠️ عاجل'}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{req.department}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.88rem' }}>{req.requested_by}</div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.88rem', color: 'var(--ink)' }}>
                      {req.items_summary}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>
                    {formatCurrency(req.total_estimated_value || 0, currency)}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--muted)' }}>
                    {req.created_at ? req.created_at.slice(0, 10) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {req.status === 'draft' && (
                      <span className="stock-status-pill neutral" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        مسودة
                      </span>
                    )}
                    {req.status === 'pending' && (
                      <span className="stock-status-pill info" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        قيد الموافقة
                      </span>
                    )}
                    {req.status === 'approved' && (
                      <span className="stock-status-pill ok" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        معتمد
                      </span>
                    )}
                    {req.status === 'rejected' && (
                      <span className="stock-status-pill danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        مرفوض
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: '4px 10px', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => openRequestDetails(req)}
                      >
                        <Eye size={14} /> تفاصيل والاعتماد
                      </button>

                      {req.status === 'draft' && (isSysAdmin || canManage || req.created_by === activeUser) && (
                        <button
                          type="button"
                          className="icon-action-btn danger"
                          title="حذف المسودة"
                          onClick={() => handleDeleteDraft(req)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="table-pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              عرض {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredRequests.length)} من {filteredRequests.length} طلب
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="secondary-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                السابق
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Details & Approval Modal */}
      {selectedRequest && (
        <div className="modal-backdrop">
          <div className="modal-surface card-surface" style={{ maxWidth: '780px', width: '100%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ClipboardList size={20} />
                  طلب شراء رقم {selectedRequest.request_no}
                </h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                  القسم: {selectedRequest.department} • مقدم الطلب: {selectedRequest.requested_by} • تاريخ التقديم: {selectedRequest.created_at?.slice(0, 10)}
                </span>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setSelectedRequest(null)}
              >
                <X size={20} />
              </button>
            </div>

            {actionSuccess && (
              <div className="inline-message success" style={{ marginBottom: '14px' }}>
                <CheckCircle2 size={16} />
                <span>{actionSuccess}</span>
              </div>
            )}

            {actionError && (
              <div className="inline-message error" style={{ marginBottom: '14px' }}>
                <AlertTriangle size={16} />
                <span>{actionError}</span>
              </div>
            )}

            {/* Request Meta details */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', background: 'rgba(14, 124, 134, 0.04)', padding: '14px', borderRadius: '10px', marginBottom: '18px' }}>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>نوع الشراء:</span>
                <div style={{ fontWeight: 600 }}>
                  {selectedRequest.purchase_type === 'direct' ? 'أمر مباشر' : selectedRequest.purchase_type === 'practice' ? 'ممارسة' : 'مناقصة'}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>الأولوية:</span>
                <div style={{ fontWeight: 600, color: selectedRequest.priority === 'urgent' ? '#dc2626' : 'var(--ink)' }}>
                  {selectedRequest.priority === 'urgent' ? '⚠️ عاجلة' : 'عادية'}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>بند الميزانية المقترح:</span>
                <div style={{ fontWeight: 600 }}>{selectedRequest.budget_line || '—'}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>تاريخ الاحتياج المطلوب:</span>
                <div style={{ fontWeight: 600 }}>{selectedRequest.needed_by || '—'}</div>
              </div>
            </div>

            {/* Justification */}
            {selectedRequest.justification && (
              <div style={{ marginBottom: '18px' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '6px', color: 'var(--ink)' }}>مبررات وأسباب طلب الشراء:</h4>
                <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '0.88rem', lineHeight: '1.6' }}>
                  {selectedRequest.justification}
                </div>
              </div>
            )}

            {/* Items Table */}
            <div style={{ marginBottom: '22px' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span>الأصناف والبنود المطلوبة:</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                  الإجمالي التقديري: {formatCurrency(selectedRequest.total_estimated_value || 0, currency)}
                </span>
              </h4>
              <table className="movements-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>الصنف / البيان</th>
                    <th style={{ textAlign: 'center' }}>الكمية</th>
                    <th style={{ textAlign: 'center' }}>الوحدة</th>
                    <th style={{ textAlign: 'center' }}>السعر التقديري</th>
                    <th style={{ textAlign: 'center' }}>إجمالي البند</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedRequest.items || []).map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td><strong>{item.item_name}</strong></td>
                      <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ textAlign: 'center' }}>{item.unit}</td>
                      <td style={{ textAlign: 'center' }}>{formatCurrency(item.estimated_price || item.estimated_unit_price || 0, currency)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>
                        {formatCurrency(item.quantity * (item.estimated_price || item.estimated_unit_price || 0), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Approval Path Visual Timeline */}
            <div style={{ marginBottom: '22px' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'var(--ink)' }}>مسار الموافقات والاعتمادات:</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                {(selectedRequest.approvals || []).map((step) => {
                  const isApproved = step.decision === 'approved'
                  const isRejected = step.decision === 'rejected'

                  return (
                    <div
                      key={step.step_no}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: `1px solid ${isApproved ? 'rgba(16, 185, 129, 0.4)' : isRejected ? 'rgba(239, 68, 68, 0.4)' : 'var(--line)'}`,
                        background: isApproved ? 'rgba(16, 185, 129, 0.05)' : isRejected ? 'rgba(239, 68, 68, 0.05)' : 'var(--surface)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                        {isApproved ? <CheckCircle2 size={16} color="#059669" /> : isRejected ? <ShieldAlert size={16} color="#dc2626" /> : <Clock size={16} color="#d97706" />}
                        <span>الخطوة {step.step_no}: {step.step_name}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: isApproved ? '#059669' : isRejected ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                        {isApproved ? 'تمت الموافقة' : isRejected ? 'مرفوض' : 'قيد الانتظار'}
                      </div>
                      {step.decided_by && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '4px' }}>
                          بواسطة: {step.decided_by}
                          {step.decided_at && ` (${step.decided_at.slice(0, 10)})`}
                        </div>
                      )}
                      {step.note && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--ink)', marginTop: '4px', fontStyle: 'italic' }}>
                          «{step.note}»
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Action Bar based on Status */}
            {selectedRequest.status === 'draft' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={isSubmittingAction}
                  onClick={handleSubmitRequestFromDetails}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Send size={16} />
                  {isSubmittingAction ? 'جارٍ الإرسال...' : 'إرسال طلب الشراء للاعتماد'}
                </button>
              </div>
            )}

            {/* Decision Record Form for Pending Requests */}
            {selectedRequest.status === 'pending' && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--ink)' }}>تسجيل قرار اعتماد الخطوة الحالية:</h4>
                <form onSubmit={handleRecordApprovalSubmit}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="radio"
                        name="decision"
                        value="approved"
                        checked={approvalDecision === 'approved'}
                        onChange={() => setApprovalDecision('approved')}
                      />
                      <ThumbsUp size={16} color="#059669" /> موافقة واعتماد الخطوة
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="radio"
                        name="decision"
                        value="rejected"
                        checked={approvalDecision === 'rejected'}
                        onChange={() => setApprovalDecision('rejected')}
                      />
                      <ThumbsDown size={16} color="#dc2626" /> رفض الطلب
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="text"
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      placeholder="ملاحظات القرار، رقم محضر البت، أو أسباب الرفض..."
                      style={{ flex: '1', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                    />
                    <button
                      type="submit"
                      className={approvalDecision === 'approved' ? 'primary-btn' : 'secondary-btn'}
                      disabled={isSubmittingAction}
                      style={{ minWidth: '120px' }}
                    >
                      {isSubmittingAction ? 'جارٍ الحفظ...' : 'تثبيت القرار'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
