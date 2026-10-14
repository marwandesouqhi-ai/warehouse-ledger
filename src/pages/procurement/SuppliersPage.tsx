import { useState, useEffect, useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import {
  fetchSupplierStatsList,
  createSupplier,
  updateSupplier,
  deleteSupplierSafe,
  type SupplierStats,
  type SupplierStatus,
} from '../../lib/suppliersRepository'
import { isSystemAdmin } from '../../lib/permissions'
import { logAuditEvent } from '../../lib/auditLogger'
import { matchesSearch } from '../../lib/searchUtils'

interface SuppliersPageProps {
  session?: Session | null
}

export default function SuppliersPage({ session }: SuppliersPageProps) {
  const [suppliers, setSuppliers] = useState<SupplierStats[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | SupplierStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 10

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierStats | null>(null)
  const [actionError, setActionError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form state
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formCr, setFormCr] = useState('')
  const [formContact, setFormContact] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formStatus, setFormStatus] = useState<SupplierStatus>('under_review')
  const [formRating, setFormRating] = useState<string>('')
  const [formNotes, setFormNotes] = useState('')

  const isSysAdmin = isSystemAdmin(session)

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchSupplierStatsList()
      setSuppliers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الموردين من السحابة.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  // Categories list derived from current suppliers
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of suppliers) {
      if (s.category && s.category.trim()) {
        set.add(s.category.trim())
      }
    }
    return Array.from(set).sort()
  }, [suppliers])

  // KPIs
  const kpis = useMemo(() => {
    let active = 0
    let underReview = 0
    let suspended = 0
    for (const s of suppliers) {
      if (s.status === 'active') active++
      else if (s.status === 'under_review') underReview++
      else if (s.status === 'suspended') suspended++
    }
    return {
      total: suppliers.length,
      active,
      underReview,
      suspended,
    }
  }, [suppliers])

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (searchTerm.trim()) {
        const matches = matchesSearch(
          [s.name, s.commercial_register, s.contact_name, s.phone, s.category],
          searchTerm
        )
        if (!matches) return false
      }
      return true
    })
  }, [suppliers, statusFilter, categoryFilter, searchTerm])

  const paginatedSuppliers = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredSuppliers.slice(start, start + pageSize)
  }, [filteredSuppliers, currentPage, pageSize])

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / pageSize))

  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, categoryFilter, searchTerm])

  function resetForm() {
    setFormName('')
    setFormCategory('عام')
    setFormCr('')
    setFormContact('')
    setFormPhone('')
    setFormStatus('under_review')
    setFormRating('')
    setFormNotes('')
    setActionError('')
  }

  function openAddModal() {
    resetForm()
    setIsAddModalOpen(true)
  }

  function openEditModal(supplier: SupplierStats) {
    resetForm()
    setEditingSupplier(supplier)
    setFormName(supplier.name)
    setFormCategory(supplier.category || 'عام')
    setFormCr(supplier.commercial_register || '')
    setFormContact(supplier.contact_name || '')
    setFormPhone(supplier.phone || '')
    setFormStatus(supplier.status)
    setFormRating(supplier.rating != null ? String(supplier.rating) : '')
    setFormNotes(supplier.notes || '')
  }

  async function handleAddSupplierSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActionError('')
    setIsSubmitting(true)

    try {
      const ratingNum = formRating ? Number(formRating) : null
      const callerName = session?.user?.user_metadata?.displayName || session?.user?.email || 'موظف مشتريات'

      const created = await createSupplier({
        name: formName,
        category: formCategory,
        commercial_register: formCr,
        contact_name: formContact,
        phone: formPhone,
        status: formStatus,
        rating: ratingNum,
        notes: formNotes,
        created_by: callerName,
      })

      await logAuditEvent({
        action: 'CREATE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: created.id,
        details: { name: created.name, status: created.status },
      })

      setSuccessMessage(`تمت إضافة المورد «${created.name}» بنجاح.`)
      setIsAddModalOpen(false)
      resetForm()
      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر حفظ بيانات المورد.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEditSupplierSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingSupplier) return

    setActionError('')
    setIsSubmitting(true)

    try {
      const ratingNum = formRating ? Number(formRating) : null
      const updated = await updateSupplier(editingSupplier.id, {
        name: formName,
        category: formCategory,
        commercial_register: formCr,
        contact_name: formContact,
        phone: formPhone,
        status: formStatus,
        rating: ratingNum,
        notes: formNotes,
      })

      await logAuditEvent({
        action: 'UPDATE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: updated.id,
        details: { name: updated.name, status: updated.status },
      })

      setSuccessMessage(`تم تحديث بيانات المورد «${updated.name}» بنجاح.`)
      setEditingSupplier(null)
      resetForm()
      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر تحديث بيانات المورد.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteSupplier(supplier: SupplierStats) {
    if (!confirm(`هل أنت متأكد من رغبتك في حذف المورد «${supplier.name}» نهائياً؟`)) return

    setActionError('')
    try {
      await deleteSupplierSafe(supplier.id)

      await logAuditEvent({
        action: 'DELETE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: supplier.id,
        details: { name: supplier.name },
      })

      setSuccessMessage(`تم حذف المورد «${supplier.name}» بنجاح.`)
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حذف المورد.')
    }
  }

  async function handleQuickStatusChange(supplier: SupplierStats, newStatus: SupplierStatus) {
    try {
      await updateSupplier(supplier.id, { status: newStatus })
      await logAuditEvent({
        action: 'CHANGE_SUPPLIER_STATUS',
        entity_type: 'supplier',
        entity_id: supplier.id,
        details: { name: supplier.name, old_status: supplier.status, new_status: newStatus },
      })
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر تغيير حالة المورد.')
    }
  }

  return (
    <section className="movement-page card-surface purchases-page suppliers-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="suppliers" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '16px' }}>
        <div>
          <h2>
            <Building2 size={20} />
            {' '}
            إدارة الموردين والشركات
          </h2>
          <span>تسجيل وتأهيل الموردين المعتمدين، متابعة التقييمات، وإحصائيات التوريد الحقيقية</span>
        </div>
        <div className="headline-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={openAddModal}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={17} /> إضافة مورد جديد
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="inline-message success" style={{ marginBottom: '16px' }}>
          <CheckCircle2 size={17} />
          <span>{successMessage}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }}
            onClick={() => setSuccessMessage('')}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="purchases-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(14, 124, 134, 0.07)', border: '1px solid rgba(14, 124, 134, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent)' }}>
            <Building2 size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>إجمالي الموردين</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {kpis.total.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>سجل الموردين المعتمدين</span>
        </div>

        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.07)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#059669' }}>
            <CheckCircle2 size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>موردون نشطون</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {kpis.active.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>مؤهلون لأوامر الشراء والعروض</span>
        </div>

        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.07)', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#d97706' }}>
            <Clock size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>بانتظار الاعتماد</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {kpis.underReview.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>موردون تحت المراجعة الفنية</span>
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
            الكل ({suppliers.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'active' ? 'active' : ''}`}
            onClick={() => setStatusFilter('active')}
          >
            نشط ({kpis.active})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'under_review' ? 'active' : ''}`}
            onClick={() => setStatusFilter('under_review')}
          >
            تحت التقييم ({kpis.underReview})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'suspended' ? 'active' : ''}`}
            onClick={() => setStatusFilter('suspended')}
          >
            موقوف ({kpis.suspended})
          </button>
        </div>

        {/* Category Dropdown */}
        {categories.length > 0 && (
          <div style={{ minWidth: '160px' }}>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
            >
              <option value="all">كافة التصنيفات</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div style={{ flex: '1', minWidth: '220px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '10px', color: 'var(--muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث باسم المورد أو السجل التجاري أو جهة الاتصال..."
            style={{ width: '100%', padding: '8px 32px 8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
          />
        </div>
      </div>

      {/* Main Table Content */}
      {loading ? (
        <div className="table-loading" style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '8px' }} />
          <div>جارٍ تحميل سجل الموردين من السحابة...</div>
        </div>
      ) : error ? (
        <div className="inline-message error" style={{ padding: '20px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={20} />
            <strong>تعذر جلب بيانات الموردين</strong>
          </div>
          <p style={{ margin: 0 }}>{error}</p>
          <button
            type="button"
            className="secondary-btn"
            style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            onClick={() => loadData()}
          >
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <div className="empty-state card-surface" style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--line)' }}>
          <Building2 size={40} style={{ opacity: 0.35, marginBottom: '10px' }} />
          <h3>لا توجد سجلات موردين مطابقة</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'لم يتم العثور على أي موردين يطابقون الفلاتر أو نص البحث الحالي.'
              : 'لم يتم تسجيل أي موردين بعد في النظام.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="movements-table responsive-table">
            <thead>
              <tr>
                <th>اسم المورد</th>
                <th>التصنيف</th>
                <th>جهة الاتصال والهاتف</th>
                <th style={{ textAlign: 'center' }}>أوامر الشراء</th>
                <th style={{ textAlign: 'center' }}>الفواتير</th>
                <th style={{ textAlign: 'center' }}>التقييم</th>
                <th style={{ textAlign: 'center' }}>الحالة</th>
                <th style={{ textAlign: 'center' }}>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginatedSuppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{supplier.name}</div>
                    {supplier.commercial_register && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                        س.ت: {supplier.commercial_register}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge neutral">{supplier.category || 'عام'}</span>
                  </td>
                  <td>
                    {supplier.contact_name || supplier.phone ? (
                      <div style={{ fontSize: '0.85rem' }}>
                        <div>{supplier.contact_name || '—'}</div>
                        {supplier.phone && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', direction: 'ltr', textAlign: 'right' }}>
                            {supplier.phone}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>
                    {supplier.po_count > 0 ? (
                      <span className="badge info">{supplier.po_count}</span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>0</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>
                    {supplier.invoices_count > 0 ? (
                      <span className="badge ok">{supplier.invoices_count}</span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>0</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {supplier.rating != null ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#d97706', fontWeight: 600 }}>
                        <Star size={14} fill="#d97706" />
                        <span>{supplier.rating.toFixed(1)}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {supplier.status === 'active' && (
                      <span className="stock-status-pill ok" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        نشط
                      </span>
                    )}
                    {supplier.status === 'under_review' && (
                      <span className="stock-status-pill info" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        تحت التقييم
                      </span>
                    )}
                    {supplier.status === 'suspended' && (
                      <span className="stock-status-pill danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        موقوف
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="icon-action-btn"
                        title="تعديل المورد"
                        onClick={() => openEditModal(supplier)}
                      >
                        <Pencil size={15} />
                      </button>

                      {/* Quick status switch dropdown */}
                      <select
                        value={supplier.status}
                        onChange={(e) => handleQuickStatusChange(supplier, e.target.value as SupplierStatus)}
                        className="quick-status-select"
                        title="تغيير حالة المورد"
                        style={{ fontSize: '0.78rem', padding: '2px 6px', borderRadius: '6px', border: '1px solid var(--line)' }}
                      >
                        <option value="active">نشط</option>
                        <option value="under_review">تحت التقييم</option>
                        <option value="suspended">موقوف</option>
                      </select>

                      {isSysAdmin && (
                        <button
                          type="button"
                          className="icon-action-btn danger"
                          title="حذف المورد نهائياً (متاح فقط إذا لم تكن له حركات)"
                          onClick={() => handleDeleteSupplier(supplier)}
                        >
                          <Trash2 size={15} />
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
              عرض {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredSuppliers.length)} من {filteredSuppliers.length} مورد
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

      {/* Add / Edit Supplier Modal */}
      {(isAddModalOpen || editingSupplier) && (
        <div className="modal-backdrop">
          <div className="modal-surface card-surface" style={{ maxWidth: '520px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={20} />
                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => { setIsAddModalOpen(false); setEditingSupplier(null) }}
              >
                <X size={18} />
              </button>
            </div>

            {actionError && (
              <div className="inline-message error" style={{ marginBottom: '14px' }}>
                <AlertTriangle size={16} />
                <span>{actionError}</span>
              </div>
            )}

            <form onSubmit={editingSupplier ? handleEditSupplierSubmit : handleAddSupplierSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label>
                  اسم المورد / الشركة *
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="مثال: شركة النيل للتوريدات الطبية"
                    required
                    autoFocus
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <label>
                    التصنيف
                    <input
                      type="text"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      placeholder="مثال: أجهزة طبية، أدوات كتابية..."
                    />
                  </label>

                  <label>
                    السجل التجاري
                    <input
                      type="text"
                      value={formCr}
                      onChange={(e) => setFormCr(e.target.value)}
                      placeholder="رقم السجل التجاري"
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <label>
                    اسم مسؤول الاتصال
                    <input
                      type="text"
                      value={formContact}
                      onChange={(e) => setFormContact(e.target.value)}
                      placeholder="اسم المندوب أو المدير"
                    />
                  </label>

                  <label>
                    رقم الهاتف
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="الهاتف أو الجوال"
                      dir="ltr"
                      style={{ textAlign: 'right' }}
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <label>
                    الحالة
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as SupplierStatus)}
                    >
                      <option value="active">نشط (معتمد للتوريد)</option>
                      <option value="under_review">تحت التقييم (مسودة / مراجعة)</option>
                      <option value="suspended">موقوف (محظور مؤقتاً)</option>
                    </select>
                  </label>

                  <label>
                    التقييم (1 إلى 5)
                    <input
                      type="number"
                      min="1"
                      max="5"
                      step="0.5"
                      value={formRating}
                      onChange={(e) => setFormRating(e.target.value)}
                      placeholder="اختياري (1 - 5)"
                    />
                  </label>
                </div>

                <label>
                  ملاحظات إضافية
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="شروط التوريد، العنوان، شروط الدفع السابقة..."
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={isSubmitting}
                  onClick={() => { setIsAddModalOpen(false); setEditingSupplier(null) }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'جارٍ الحفظ...' : editingSupplier ? 'حفظ التعديلات' : 'تسجيل المورد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
