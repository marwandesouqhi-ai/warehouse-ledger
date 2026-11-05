import { useState, useEffect, useMemo, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AccessibleDialog } from '../components/AccessibleDialog'
import {
  BarChart3,
  Plus,
  CheckCircle2,
  Clock,
  Printer,
  X,
  Search,
  RotateCw,
  Eye,
} from 'lucide-react'
import {
  fetchFinancialReports,
  createFinancialReport,
  updateFinancialReportStatus,
  type FinancialReport,
} from '../lib/financialReportsRepository'
import { isSystemAdmin, canAddDepartment, getDashboardScope } from '../lib/permissions'
import { logAuditEvent } from '../lib/auditLogger'
import { formatCurrency } from '../lib/currency'
import { safePrint } from '../lib/printUtils'

type FinancialReportsPageProps = {
  session?: Session | null
  currency?: string
}

const REPORT_TYPES = {
  monthly: 'تقرير شهري',
  quarterly: 'تقرير ربع سنوي',
  annual: 'تقرير سنوي ختامي',
  custom: 'تقرير فترة مخصصة',
}

const STATUS_CONFIG = {
  draft: { label: 'مسودة', icon: Clock, className: 'status-tag pending' },
  finalized: { label: 'جاهز للاعتماد', icon: CheckCircle2, className: 'status-tag part' },
  approved: { label: 'معتمد ومصدق', icon: CheckCircle2, className: 'status-tag full' },
}

export default function FinancialReportsPage({ session, currency = 'EGP' }: FinancialReportsPageProps) {
  const canAdd = canAddDepartment(session, getDashboardScope(session) === 'warehouse_only' ? 'warehouse' : 'procurement')
  const [reports, setReports] = useState<FinancialReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<FinancialReport | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form
  const [reportTitle, setReportTitle] = useState('')
  const [reportType, setReportType] = useState<FinancialReport['report_type']>('monthly')
  const [periodFrom, setPeriodFrom] = useState('2026-10-01')
  const [periodTo, setPeriodTo] = useState('2026-10-31')
  const [totalPurchases, setTotalPurchases] = useState<number | ''>(500000)
  const [totalDisbursements, setTotalDisbursements] = useState<number | ''>(380000)
  const [budgetAllocated, setBudgetAllocated] = useState<number | ''>(600000)

  const isAdmin = isSystemAdmin(session)

  const formatMoney = (val: number) => formatCurrency(val, currency)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const data = await fetchFinancialReports()
      setReports(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (typeFilter !== 'all' && r.report_type !== typeFilter) return false
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (
        r.report_number.toLowerCase().includes(term) ||
        r.report_title.toLowerCase().includes(term) ||
        (r.approved_by && r.approved_by.toLowerCase().includes(term))
      )
    })
  }, [reports, typeFilter, searchTerm])

  const kpis = useMemo(() => {
    const totalCount = reports.length
    const sumPurchases = reports.reduce((acc, r) => acc + (Number(r.total_purchases) || 0), 0)
    const sumDisbursements = reports.reduce((acc, r) => acc + (Number(r.total_disbursements) || 0), 0)
    const sumBudget = reports.reduce((acc, r) => acc + (Number(r.budget_allocated) || 0), 0)
    return { totalCount, sumPurchases, sumDisbursements, sumBudget }
  }, [reports])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!canAdd) return
    if (!reportTitle.trim() || !periodFrom || !periodTo) {
      alert('يرجى تعبئة عنوان التقرير والفترة الزمنية.')
      return
    }

    setIsSubmitting(true)
    try {
      const pNum = Number(totalPurchases) || 0
      const bAlloc = Number(budgetAllocated) || 0
      const bRem = Math.max(0, bAlloc - pNum)
      const rNumber = `RPT-${reportType.toUpperCase()}-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`

      const newRep = await createFinancialReport({
        report_number: rNumber,
        report_title: reportTitle.trim(),
        report_type: reportType,
        period_from: periodFrom,
        period_to: periodTo,
        total_purchases: pNum,
        total_disbursements: Number(totalDisbursements) || 0,
        budget_allocated: bAlloc,
        budget_remaining: bRem,
        status: 'draft',
        created_by: session?.user?.id,
        created_by_email: session?.user?.email,
      })

      setReports((prev) => [newRep, ...prev])
      setIsAddModalOpen(false)
      setReportTitle('')
      setSuccessMessage(`تم إنشاء التقرير المالي رقم ${rNumber} بنجاح.`)

      void logAuditEvent({
        action: `إنشاء تقرير مالي: ${reportTitle}`,
        entity_type: 'financial_report',
        details: { report_number: rNumber, period_from: periodFrom, period_to: periodTo },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApprove = async (report: FinancialReport) => {
    if (!isAdmin) return
    const approver = session?.user?.user_metadata?.displayName || session?.user?.email || 'مدير النظام'
    await updateFinancialReportStatus(report.id, 'approved', approver)
    setReports((prev) =>
      prev.map((r) =>
        r.id === report.id
          ? { ...r, status: 'approved', approved_by: approver, approved_at: new Date().toISOString() }
          : r
      )
    )
    if (selectedReport?.id === report.id) {
      setSelectedReport((prev) =>
        prev ? { ...prev, status: 'approved', approved_by: approver, approved_at: new Date().toISOString() } : null
      )
    }
    setSuccessMessage(`تم اعتماد التقرير المالي ${report.report_number}.`)

    void logAuditEvent({
      action: `اعتماد تقرير مالي دوري: ${report.report_number}`,
      entity_type: 'financial_report',
      details: { report_id: report.id },
      user: session?.user,
    })
  }

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <BarChart3 size={24} />
        </div>
        <div>
          <p className="eyebrow">التقارير والمطابقة المالية • جامعة الزقازيق الأهلية</p>
          <h2>التقارير المالية الدورية للمخازن والمشتريات</h2>
          <p>إصدار واعتماد التقارير الشهرية والربع سنوية والسنوية لمقارنة التوريدات والمصروفات بالميزانية</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button hidden={!canAdd} type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={18} /> إنشاء تقرير دوري جديد
          </button>
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
            <span className="kpi-label">إجمالي التوريدات بالتقارير</span>
            <span className="badge-pill highlight">وارد</span>
          </div>
          <div className="kpi-value text-emerald-500">{formatMoney(kpis.sumPurchases)}</div>
          <div className="kpi-sub">إجمالي قيمة فواتير المشتريات المعتمدة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">إجمالي المنصرف الفعلي</span>
            <span className="badge-pill">منصرف</span>
          </div>
          <div className="kpi-value text-amber-500">{formatMoney(kpis.sumDisbursements)}</div>
          <div className="kpi-sub">المستهلك والمسلم للكليات والأقسام</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">الميزانية المخصصة الكلية</span>
            <span className="badge-pill">الموازنة</span>
          </div>
          <div className="kpi-value text-primary font-bold">{formatMoney(kpis.sumBudget)}</div>
          <div className="kpi-sub">الاعتمادات المخصصة للفترات المسجلة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">عدد التقارير الدورية</span>
            <span className="badge-pill">مؤرشف</span>
          </div>
          <div className="kpi-value text-cyan-500">{kpis.totalCount}</div>
          <div className="kpi-sub">تقارير شهرية وفصلية وسنوية</div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card-surface p-4">
        <div className="movements-filter-toolbar">
          <div className="input-search-wrap">
            <Search size={16} className="input-search-icon" />
            <input
              type="search"
              placeholder="ابحث برقم التقرير، العنوان، أو المعتمد..."
              aria-label="ابحث في التقارير المالية"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-field w-full"
            />
          </div>

          <div className="filter-group">
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              الكل ({reports.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'monthly' ? 'active' : ''}`}
              onClick={() => setTypeFilter('monthly')}
            >
              شهرية
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'quarterly' ? 'active' : ''}`}
              onClick={() => setTypeFilter('quarterly')}
            >
              ربع سنوية
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'annual' ? 'active' : ''}`}
              onClick={() => setTypeFilter('annual')}
            >
              سنوية
            </button>
          </div>
        </div>

        <div className="movement-table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>رقم التقرير</th>
                <th>عنوان التقرير</th>
                <th>نوع التقرير</th>
                <th>الفترة (من - إلى)</th>
                <th>إجمالي المشتريات</th>
                <th>إجمالي المنصرف</th>
                <th>الحالة</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty text-center py-8">
                    <BarChart3 size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-muted">لا توجد تقارير مالية مطابقة للبحث الحالي.</p>
                  </td>
                </tr>
              ) : (
                filteredReports.map((r) => {
                  const statusInfo = STATUS_CONFIG[r.status] || STATUS_CONFIG.draft
                  const StatusIcon = statusInfo.icon

                  return (
                    <tr key={r.id}>
                      <td className="font-semibold text-primary font-mono">{r.report_number}</td>
                      <td>
                        <strong>{r.report_title}</strong>
                        {r.approved_by && (
                          <small className="block text-xs text-muted">اعتمد بواسطة: {r.approved_by}</small>
                        )}
                      </td>
                      <td>
                        <span className="text-xs bg-muted/40 px-2 py-1 rounded">
                          {REPORT_TYPES[r.report_type]}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs">
                          {r.period_from} إلى {r.period_to}
                        </div>
                      </td>
                      <td className="font-bold text-emerald-600">{formatMoney(r.total_purchases)}</td>
                      <td className="font-semibold text-amber-600">{formatMoney(r.total_disbursements)}</td>
                      <td>
                        <span className={statusInfo.className}>
                          <StatusIcon size={14} className="inline ml-1" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="actions-cell">
                        <div className="action-buttons-wrap">
                          <button
                            type="button"
                            className="table-action-btn edit-action-btn"
                            onClick={() => setSelectedReport(r)}
                            title="عرض التقرير الكامل"
                          >
                            <Eye size={15} />
                            <span>عرض</span>
                          </button>

                          {isAdmin && r.status !== 'approved' && (
                            <button
                              type="button"
                              className="table-action-btn text-emerald-600 hover:bg-emerald-50"
                              onClick={() => handleApprove(r)}
                              title="اعتماد وتصديق التقرير"
                            >
                              <CheckCircle2 size={15} />
                              <span>اعتماد</span>
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

      {/* Modal: Add Financial Report */}
      {isAddModalOpen && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setIsAddModalOpen(false)}
          titleId="add-fin-report-modal-title"
          dialogClassName="modal-dialog modal-dialog-form"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <Plus size={18} />
              </div>
              <div>
                <h3 id="add-fin-report-modal-title">إصدار تقرير مالي دوري جديد</h3>
                <span className="modal-subtitle">إدراج أرقام التوريدات والمنصرف والموازنة للفترة</span>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">
                  عنوان التقرير *
                  <input
                    type="text"
                    required
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    placeholder="مثال: التقرير المالي للمشتريات لشهر نوفمبر 2026"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  نوع التقرير *
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as FinancialReport['report_type'])}
                    className="p-2 border rounded"
                  >
                    <option value="monthly">تقرير شهري</option>
                    <option value="quarterly">تقرير ربع سنوي</option>
                    <option value="annual">تقرير سنوي ختامي</option>
                    <option value="custom">فترة مخصصة</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  بداية الفترة *
                  <input
                    type="date"
                    required
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  نهاية الفترة *
                  <input
                    type="date"
                    required
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  إجمالي قيمة المشتريات (ج.م) *
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={totalPurchases}
                    onChange={(e) => setTotalPurchases(e.target.value ? Number(e.target.value) : '')}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  إجمالي قيمة المنصرف (ج.م) *
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={totalDisbursements}
                    onChange={(e) => setTotalDisbursements(e.target.value ? Number(e.target.value) : '')}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الميزانية المخصصة للفترة (ج.م) *
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={budgetAllocated}
                    onChange={(e) => setBudgetAllocated(e.target.value ? Number(e.target.value) : '')}
                    className="p-2 border rounded"
                  />
                </label>
              </div>

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
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ التقرير المالي'}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}

      {/* Modal: View & Print Report */}
      {selectedReport && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setSelectedReport(null)}
          titleId="view-fin-report-modal-title"
          dialogClassName="modal-dialog modal-dialog-form max-w-2xl"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <BarChart3 size={18} />
              </div>
              <div>
                <h3 id="view-fin-report-modal-title">بيان التقرير المالي المعتمد</h3>
                <span className="modal-subtitle">{selectedReport.report_number}</span>
              </div>
            </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedReport(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body p-6 space-y-4">
              <div className="text-center pb-4 border-b">
                <h2 className="text-lg font-bold">جامعة الزقازيق الأهلية</h2>
                <h3 className="text-base text-primary font-semibold">{selectedReport.report_title}</h3>
                <p className="text-xs text-muted mt-1">
                  الفترة المحاسبية من {selectedReport.period_from} إلى {selectedReport.period_to}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-lg">
                <div>
                  <span className="text-muted text-xs block">إجمالي التوريدات (المشتريات):</span>
                  <strong className="text-base text-emerald-600">
                    {formatMoney(selectedReport.total_purchases)}
                  </strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">إجمالي المنصرف الفعلي:</span>
                  <strong className="text-base text-amber-600">
                    {formatMoney(selectedReport.total_disbursements)}
                  </strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">الميزانية المعتمدة:</span>
                  <strong className="text-base text-primary">
                    {formatMoney(selectedReport.budget_allocated)}
                  </strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">فائض الميزانية المتبقي:</span>
                  <strong className="text-base font-bold">
                    {formatMoney(selectedReport.budget_remaining)}
                  </strong>
                </div>
              </div>

              {selectedReport.approved_by && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-xs">
                  <strong>تم اعتماد التقرير رسمياً:</strong> بواسطة {selectedReport.approved_by} بتاريخ{' '}
                  {new Date(selectedReport.approved_at || selectedReport.created_at).toLocaleDateString('ar-EG')}
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t">
                <button
                  type="button"
                  className="secondary-btn flex items-center gap-1.5"
                  onClick={() => void safePrint()}
                >
                  <Printer size={16} /> طباعة التقرير (A4)
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setSelectedReport(null)}
                  >
                    إغلاق
                  </button>

                  {isAdmin && selectedReport.status !== 'approved' && (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => handleApprove(selectedReport)}
                    >
                      <CheckCircle2 size={16} /> اعتماد رسمي
                    </button>
                  )}
                </div>
              </div>
            </div>
        </AccessibleDialog>
      )}
    </section>
  )
}

