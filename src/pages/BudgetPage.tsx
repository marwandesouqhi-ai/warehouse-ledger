import { useState, useEffect, useMemo, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AccessibleDialog } from '../components/AccessibleDialog'
import {
  CircleDollarSign,
  Plus,
  Search,
  CheckCircle2,
  RotateCw,
  X,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  fetchBudgetPlans,
  createBudgetPlan,
  updateBudgetPlan,
  deleteBudgetPlan,
  type BudgetPlan,
} from '../lib/budgetRepository'
import { isSystemAdmin, canAddDepartment, getDashboardScope } from '../lib/permissions'
import { logAuditEvent } from '../lib/auditLogger'
import { formatCurrency } from '../lib/currency'

type BudgetPageProps = {
  session?: Session | null
  currency?: string
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
  'الخدمات والصيانة',
  'أخرى',
]

const CATEGORIES = [
  'أجهزة ومعدات معملية',
  'مستلزمات مكتبية وأوراق',
  'شبكات وسيرفرات وحواسيب',
  'مستلزمات وأجهزة طبية',
  'صيانة وقطع غيار',
  'خدمات ونظافة وتأمين',
  'أخرى',
]

export default function BudgetPage({ session, currency = 'EGP' }: BudgetPageProps) {
  const canAdd = canAddDepartment(session, getDashboardScope(session) === 'warehouse_only' ? 'warehouse' : 'procurement')
  const [plans, setPlans] = useState<BudgetPlan[]>([])
  const [fiscalYear, setFiscalYear] = useState<number>(2026)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<BudgetPlan | null>(null)
  const [editSpentAmount, setEditSpentAmount] = useState<number | ''>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form
  const [department, setDepartment] = useState(DEPARTMENTS[0])
  const [category, setCategory] = useState(CATEGORIES[0])
  const [allocatedAmount, setAllocatedAmount] = useState<number | ''>(500000)
  const [notes, setNotes] = useState('')

  const isAdmin = isSystemAdmin(session)

  const formatMoney = (val: number) => formatCurrency(val, currency)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const data = await fetchBudgetPlans(fiscalYear)
      setPlans(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [fiscalYear])

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (
        p.department.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        (p.notes && p.notes.toLowerCase().includes(term))
      )
    })
  }, [plans, searchTerm])

  const kpis = useMemo(() => {
    const totalAllocated = plans.reduce((sum, p) => sum + (Number(p.allocated_amount) || 0), 0)
    const totalSpent = plans.reduce((sum, p) => sum + (Number(p.spent_amount) || 0), 0)
    const totalRemaining = Math.max(0, totalAllocated - totalSpent)
    const spendingRatio = totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0
    return { totalAllocated, totalSpent, totalRemaining, spendingRatio }
  }, [plans])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!canAdd) return
    if (!allocatedAmount || Number(allocatedAmount) <= 0) {
      alert('يرجى تحديد مبلغ الميزانية المخصصة.')
      return
    }

    setIsSubmitting(true)
    try {
      const newPlan = await createBudgetPlan({
        fiscal_year: fiscalYear,
        department,
        category,
        allocated_amount: Number(allocatedAmount),
        spent_amount: 0,
        notes: notes.trim(),
        status: 'active',
        created_by: session?.user?.id,
        created_by_email: session?.user?.email,
      })

      setPlans((prev) => [newPlan, ...prev])
      setIsAddModalOpen(false)
      setNotes('')
      setSuccessMessage(`تم إضافة بند ميزانية جديد لـ ${department}.`)

      void logAuditEvent({
        action: `إضافة بند ميزانية: ${department} - ${category}`,
        entity_type: 'budget',
        details: { fiscal_year: fiscalYear, allocated_amount: allocatedAmount },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdateSpent = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingPlan) return

    setIsSubmitting(true)
    try {
      const updated = await updateBudgetPlan(editingPlan.id, {
        spent_amount: Number(editSpentAmount) || 0,
      })

      setPlans((prev) => prev.map((p) => (p.id === editingPlan.id ? updated : p)))
      setEditingPlan(null)
      setSuccessMessage(`تم تحديث منصرف ميزانية ${editingPlan.department}.`)

      void logAuditEvent({
        action: `تحديث منصرف ميزانية: ${editingPlan.department}`,
        entity_type: 'budget',
        details: { plan_id: editingPlan.id, spent_amount: editSpentAmount },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (plan: BudgetPlan) => {
    if (!isAdmin) return
    if (!window.confirm(`هل أنت متأكد من حذف بند ميزانية ${plan.department}؟`)) return

    try {
      await deleteBudgetPlan(plan.id)
      setPlans((prev) => prev.filter((p) => p.id !== plan.id))
      setSuccessMessage('تم حذف بند الميزانية.')

      void logAuditEvent({
        action: `حذف بند ميزانية: ${plan.department}`,
        entity_type: 'budget',
        details: { plan_id: plan.id },
        user: session?.user,
      })
    } catch {
      alert('حدث خطأ أثناء حذف البند.')
    }
  }

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <CircleDollarSign size={24} />
        </div>
        <div>
          <p className="eyebrow">التخطيط والاعتمادات المالية • جامعة الزقازيق الأهلية</p>
          <h2>الميزانية التقديرية وتخطيط المشتريات</h2>
          <p>تخصيص ميزانيات الكليات والأقسام، تتبع نسب الإنفاق الفعلية، والتحكم في فائض الاعتمادات</p>
        </div>
        <div className="headline-actions mr-auto flex items-center gap-2">
          {/* Year selector */}
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="p-2 border rounded font-bold text-primary bg-background"
          >
            <option value={2024}>السنة المالية 2024</option>
            <option value={2025}>السنة المالية 2025</option>
            <option value={2026}>السنة المالية 2026</option>
            <option value={2027}>السنة المالية 2027</option>
            <option value={2028}>السنة المالية 2028</option>
          </select>

          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>

          {canAdd && (
            <button hidden={!canAdd} type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
              <Plus size={18} /> إضافة بند ميزانية
            </button>
          )}
        </div>
      </header>

      {successMessage && (
        <div className="inline-message success flex items-center justify-between">
          <span>{successMessage}</span>
          <button type="button" className="input-action-btn" onClick={() => setSuccessMessage('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">إجمالي الميزانية المعتمدة</span>
            <span className="badge-pill">المخصص</span>
          </div>
          <div className="kpi-value text-primary font-bold">{formatMoney(kpis.totalAllocated)}</div>
          <div className="kpi-sub">المخصص الإجمالي لعام {fiscalYear}</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">إجمالي المنصرف الفعلي</span>
            <span className="badge-pill highlight">المستهلك</span>
          </div>
          <div className="kpi-value text-amber-500">{formatMoney(kpis.totalSpent)}</div>
          <div className="kpi-sub">تم صرفه عبر أوامر وفواتير التوريد</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">الفائض المتبقي المتاح</span>
            <span className="badge-pill">المتبقي</span>
          </div>
          <div className="kpi-value text-emerald-500">{formatMoney(kpis.totalRemaining)}</div>
          <div className="kpi-sub">متاح لتعاقدات وتوريدات جديدة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">نسبة استهلاك الموازنة</span>
            <span className="badge-pill">{kpis.spendingRatio}%</span>
          </div>
          <div className="kpi-value text-purple-500">{kpis.spendingRatio}%</div>
          <div className="kpi-sub">معدل الإنفاق الكلي للأقسام</div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card-surface p-4">
        <div className="movements-filter-toolbar">
          <div className="input-search-wrap">
            <Search size={16} className="input-search-icon" />
            <input
              type="search"
              placeholder="ابحث باسم الكلية، القسم، أو الفئة..."
              aria-label="ابحث في اعتمادات الميزانية"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-field w-full"
            />
          </div>
        </div>

        <div className="movement-table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>الكلية / القسم</th>
                <th>فئة البند</th>
                <th>المبلغ المخصص</th>
                <th>المنصرف الفعلي</th>
                <th>المتبقي</th>
                <th style={{ width: '180px' }}>شريط استهلاك الميزانية</th>
                <th>ملاحظات</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty text-center py-8">
                    <CircleDollarSign size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-muted">لا توجد بنود ميزانية مسجلة لعام {fiscalYear}.</p>
                  </td>
                </tr>
              ) : (
                filteredPlans.map((p) => {
                  const alloc = Number(p.allocated_amount) || 0
                  const spent = Number(p.spent_amount) || 0
                  const rem = Math.max(0, alloc - spent)
                  const pct = alloc > 0 ? Math.round((spent / alloc) * 100) : 0

                  const barColor =
                    pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'

                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.department}</strong>
                      </td>
                      <td>
                        <span className="text-xs bg-muted/40 px-2 py-1 rounded">{p.category}</span>
                      </td>
                      <td className="font-bold text-primary">{formatMoney(alloc)}</td>
                      <td className="font-semibold text-amber-600">{formatMoney(spent)}</td>
                      <td className="font-semibold text-emerald-600">{formatMoney(rem)}</td>
                      <td>
                        <div className="w-full bg-muted/30 h-2.5 rounded-full overflow-hidden mb-1">
                          <div
                            className={`${barColor} h-full rounded-full transition-all`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted block text-center font-medium">{pct}% مستهلك</span>
                      </td>
                      <td className="text-xs text-muted max-w-xs truncate">{p.notes || '—'}</td>
                      <td className="actions-cell">
                        <div className="action-buttons-wrap">
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                className="table-action-btn edit-action-btn"
                                onClick={() => {
                                  setEditingPlan(p)
                                  setEditSpentAmount(p.spent_amount)
                                }}
                                title="تحديث مبلغ المنصرف"
                              >
                                <Pencil size={15} />
                                <span>تعديل</span>
                              </button>
                              <button
                                type="button"
                                className="table-action-btn delete-action-btn"
                                onClick={() => handleDelete(p)}
                                title="حذف البند"
                              >
                                <Trash2 size={15} />
                                <span>حذف</span>
                              </button>
                            </>
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

      {/* Modal: Add Budget Item */}
      {isAddModalOpen && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setIsAddModalOpen(false)}
          titleId="add-budget-modal-title"
          dialogClassName="modal-dialog modal-dialog-form"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <Plus size={18} />
              </div>
              <div>
                <h3 id="add-budget-modal-title">إضافة اعتماد ميزانية جديد</h3>
                <span className="modal-subtitle">تخصيص ميزانية لكلية أو قسم لعام {fiscalYear}</span>
              </div>
            </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsAddModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الكلية أو القسم المستفيد *
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="p-2 border rounded"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  فئة البند / نوع الصرف *
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="p-2 border rounded"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                المبلغ المخصص (ج.م) *
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={allocatedAmount}
                  onChange={(e) => setAllocatedAmount(e.target.value ? Number(e.target.value) : '')}
                  className="p-2 border rounded"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                ملاحظات وتفاصيل التخصيص
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="المشروع المعني، خطة الصرف..."
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
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ...' : 'إدراج بند الميزانية'}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}

      {/* Modal: Edit Spent */}
      {editingPlan && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setEditingPlan(null)}
          titleId="edit-budget-spent-modal-title"
          dialogClassName="modal-dialog modal-dialog-confirm"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <Pencil size={18} />
              </div>
              <div>
                <h3 id="edit-budget-spent-modal-title">تعديل منصرف الميزانية</h3>
                <span className="modal-subtitle">{editingPlan.department}</span>
              </div>
            </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingPlan(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateSpent} className="modal-confirm-body space-y-4">
              <div className="p-3 bg-muted/20 rounded text-sm space-y-1">
                <div>المخصص الكلي: <strong>{formatMoney(editingPlan.allocated_amount)}</strong></div>
                <div>الفئة: <strong>{editingPlan.category}</strong></div>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold text-right">
                إجمالي المبلغ المنصرف الفعلي (ج.م) *
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={editSpentAmount}
                  onChange={(e) => setEditSpentAmount(e.target.value ? Number(e.target.value) : '')}
                  className="p-2 border rounded"
                />
              </label>

              <div className="modal-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setEditingPlan(null)}
                  disabled={isSubmitting}
                >
                  إلغاء
                </button>
                <button type="submit" className="primary-btn" disabled={isSubmitting}>
                  حفظ التعديل
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </section>
  )
}

