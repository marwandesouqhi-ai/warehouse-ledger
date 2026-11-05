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

import {
  fetchSupplierStatsList,
  createSupplier,
  updateSupplier,
  deleteSupplierSafe,
  type SupplierStats,
  type SupplierStatus,
} from '../../lib/suppliersRepository'
import { isSystemAdmin, canAddDepartment } from '../../lib/permissions'
import { logAuditEvent } from '../../lib/auditLogger'
import { matchesSearch } from '../../lib/searchUtils'

interface SuppliersPageProps {
  session?: Session | null
}

export default function SuppliersPage({ session }: SuppliersPageProps) {
  const canAdd = canAddDepartment(session, 'procurement')
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
    if (!canAdd) return
    resetForm()
    setIsAddModalOpen(true)
  }

  function openEditModal(supplier: SupplierStats) {
    if (!isSysAdmin) return
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
    if (!canAdd) return
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
    if (!isSysAdmin) return
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
    if (!isSysAdmin) return
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


      {/* Page Header */}
      <div className="section-head movement-heading mt-3 mb-4">
        <div>
          <h2>
            <Building2 size={20} />
            {' '}
            إدارة الموردين والشركات
          </h2>
          <span>تسجيل وتأهيل الموردين المعتمدين، متابعة التقييمات، وإحصائيات التوريد الحقيقية</span>
        </div>
        <div className="headline-actions">
          <button hidden={!canAdd}
            type="button"
            className="primary-btn inline-flex items-center gap-1"
            onClick={openAddModal}
          >
            <Plus size={17} /> إضافة مورد جديد
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="inline-message success mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={17} />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="cursor-pointer text-muted"
            onClick={() => setSuccessMessage('')}
            aria-label="إغلاق رسالة النجاح"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="purchases-kpis">
        <div className="purchases-kpi-card">
          <div className="purchases-kpi-head text-accent">
            <Building2 size={20} />
            <span className="purchases-kpi-label">إجمالي الموردين</span>
          </div>
          <div className="purchases-kpi-val">
            {kpis.total.toLocaleString('ar-EG')}
          </div>
          <span className="purchases-kpi-sub">سجل الموردين المعتمدين</span>
        </div>

        <div className="purchases-kpi-card">
          <div className="purchases-kpi-head text-ok">
            <CheckCircle2 size={20} />
            <span className="purchases-kpi-label">موردون نشطون</span>
          </div>
          <div className="purchases-kpi-val">
            {kpis.active.toLocaleString('ar-EG')}
          </div>
          <span className="purchases-kpi-sub">مؤهلون لأوامر الشراء والعروض</span>
        </div>

        <div className="purchases-kpi-card">
          <div className="purchases-kpi-head text-warn">
            <Clock size={20} />
            <span className="purchases-kpi-label">بانتظار الاعتماد</span>
          </div>
          <div className="purchases-kpi-val">
            {kpis.underReview.toLocaleString('ar-EG')}
          </div>
          <span className="purchases-kpi-sub">موردون تحت المراجعة الفنية</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="suppliers-filter-controls">
        {/* Status Pills */}
        <div className="suppliers-pills">
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
          <div className="suppliers-cat-select-wrap">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="suppliers-cat-select"
              aria-label="تصفية حسب التصنيف"
            >
              <option value="all">كافة التصنيفات</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div className="suppliers-search-wrap">
          <Search size={16} className="suppliers-search-icon" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث باسم المورد أو السجل التجاري أو جهة الاتصال..."
            className="suppliers-search-input"
            aria-label="بحث في الموردين"
          />
        </div>
      </div>

      {/* Main Table Content */}
      {loading ? (
        <div className="table-loading text-center p-8 text-muted">
          <RefreshCw size={24} className="spin-icon mb-2" />
          <div>جارٍ تحميل سجل الموردين من السحابة...</div>
        </div>
      ) : error ? (
        <div className="inline-message error p-5 rounded-lg flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} />
            <strong>تعذر جلب بيانات الموردين</strong>
          </div>
          <p className="m-0">{error}</p>
          <button
            type="button"
            className="secondary-btn self-start mt-2"
            onClick={() => loadData()}
          >
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <div className="empty-state card-surface text-center p-8 border border-dashed">
          <Building2 size={40} className="opacity-35 mb-2" />
          <h3>لا توجد سجلات موردين مطابقة</h3>
          <p className="text-muted font-sm">
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'لم يتم العثور على أي موردين يطابقون الفلاتر أو نص البحث الحالي.'
              : 'لم يتم تسجيل أي موردين بعد في النظام.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper card-surface suppliers-table-wrap">
          <table className="custom-table suppliers-table">
            <thead>
              <tr>
                <th>اسم المورد / الشركة</th>
                <th>التصنيف</th>
                <th>جهة الاتصال والهاتف</th>
                <th className="suppliers-th-center">أوامر الشراء</th>
                <th className="suppliers-th-center">الفواتير</th>
                <th className="suppliers-th-center">التقييم</th>
                <th className="suppliers-th-center">الحالة</th>
                <th className="suppliers-th-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginatedSuppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <div className="suppliers-name-col">{supplier.name}</div>
                    {supplier.commercial_register && (
                      <div className="suppliers-sub-text">
                        س.ت: {supplier.commercial_register}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge muted">{supplier.category || 'عام'}</span>
                  </td>
                  <td>
                    {supplier.contact_name || supplier.phone ? (
                      <div className="font-sm">
                        <div className="font-medium">{supplier.contact_name || '—'}</div>
                        {supplier.phone && (
                          <div className="suppliers-phone-text">
                            {supplier.phone}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-center font-semibold">
                    {supplier.po_count > 0 ? (
                      <span className="badge info">{supplier.po_count}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="text-center font-semibold">
                    {supplier.invoices_count > 0 ? (
                      <span className="badge ok">{supplier.invoices_count}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="text-center">
                    {supplier.rating != null ? (
                      <div className="suppliers-rating-box">
                        <Star size={14} fill="var(--warn)" />
                        <span>{supplier.rating.toFixed(1)}</span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-center">
                    {supplier.status === 'active' && (
                      <span className="badge ok">
                        نشط
                      </span>
                    )}
                    {supplier.status === 'under_review' && (
                      <span className="badge info">
                        تحت التقييم
                      </span>
                    )}
                    {supplier.status === 'suspended' && (
                      <span className="badge bad">
                        موقوف
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <div className="suppliers-actions-group">
                      <button hidden={!isSysAdmin}
                        type="button"
                        className="suppliers-icon-btn"
                        title="تعديل المورد"
                        aria-label={`تعديل المورد ${supplier.name}`}
                        onClick={() => openEditModal(supplier)}
                      >
                        <Pencil size={15} />
                      </button>

                      {/* Quick status switch dropdown */}
                      <select hidden={!isSysAdmin}
                        value={supplier.status}
                        onChange={(e) => handleQuickStatusChange(supplier, e.target.value as SupplierStatus)}
                        className="suppliers-status-select"
                        title="تغيير حالة المورد"
                        aria-label={`تغيير حالة المورد ${supplier.name}`}
                      >
                        <option value="active">نشط</option>
                        <option value="under_review">تحت التقييم</option>
                        <option value="suspended">موقوف</option>
                      </select>

                      {isSysAdmin && (
                        <button hidden={!isSysAdmin}
                          type="button"
                          className="suppliers-icon-btn danger"
                          title="حذف المورد نهائياً (متاح فقط إذا لم تكن له حركات)"
                          aria-label={`حذف المورد ${supplier.name}`}
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
          <div className="suppliers-pagination-bar">
            <span className="font-sm text-muted">
              عرض {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredSuppliers.length)} من {filteredSuppliers.length} مورد
            </span>
            <div className="flex gap-2">
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
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsAddModalOpen(false)
              setEditingSupplier(null)
            }
          }}
        >
          <div className="modal-surface card-surface suppliers-modal-card">
            <div className="flex justify-between items-center mb-5">
              <h3 className="m-0 flex items-center gap-2 text-xl text-ink">
                <Building2 size={22} className="text-accent" />
                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                className="cursor-pointer text-muted p-1 bg-none border-none"
                onClick={() => { setIsAddModalOpen(false); setEditingSupplier(null) }}
                aria-label="إغلاق النافذة"
              >
                <X size={20} />
              </button>
            </div>

            {actionError && (
              <div className="inline-message error mb-4">
                <AlertTriangle size={16} />
                <span>{actionError}</span>
              </div>
            )}

            <form onSubmit={editingSupplier ? handleEditSupplierSubmit : handleAddSupplierSubmit}>
              <div className="flex flex-col gap-3">
                <label className="form-label-block">
                  اسم المورد / الشركة <span className="text-bad">*</span>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="مثال: شركة النيل للتوريدات الطبية"
                    required
                    autoFocus
                    className="form-input-themed"
                  />
                </label>

                <div className="form-grid-2col">
                  <label className="form-label-block">
                    التصنيف
                    <input
                      type="text"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      placeholder="مثال: أجهزة طبية، أدوات كتابية..."
                      className="form-input-themed"
                    />
                  </label>

                  <label className="form-label-block">
                    السجل التجاري
                    <input
                      type="text"
                      value={formCr}
                      onChange={(e) => setFormCr(e.target.value)}
                      placeholder="رقم السجل التجاري"
                      className="form-input-themed"
                    />
                  </label>
                </div>

                <div className="form-grid-2col">
                  <label className="form-label-block">
                    اسم مسؤول الاتصال
                    <input
                      type="text"
                      value={formContact}
                      onChange={(e) => setFormContact(e.target.value)}
                      placeholder="اسم المندوب أو المدير"
                      className="form-input-themed"
                    />
                  </label>

                  <label className="form-label-block">
                    رقم الهاتف
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="الهاتف أو الجوال"
                      dir="ltr"
                      className="form-input-themed text-right"
                    />
                  </label>
                </div>

                <div className="form-grid-2col">
                  <label className="form-label-block">
                    الحالة
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as SupplierStatus)}
                      className="form-input-themed"
                    >
                      <option value="active">نشط (معتمد للتوريد)</option>
                      <option value="under_review">تحت التقييم (مسودة / مراجعة)</option>
                      <option value="suspended">موقوف (محظور مؤقتاً)</option>
                    </select>
                  </label>

                  <label className="form-label-block">
                    التقييم (1 إلى 5)
                    <input
                      type="number"
                      min="1"
                      max="5"
                      step="0.5"
                      value={formRating}
                      onChange={(e) => setFormRating(e.target.value)}
                      placeholder="اختياري (1 - 5)"
                      className="form-input-themed"
                    />
                  </label>
                </div>

                <label className="form-label-block">
                  ملاحظات إضافية
                  <textarea
                    rows={3}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="شروط التوريد، العنوان، شروط الدفع السابقة..."
                    className="form-input-themed"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-3 mt-5">
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
