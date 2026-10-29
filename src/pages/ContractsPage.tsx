import { useState, useEffect, useMemo, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  FileText,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  Eye,
  Trash2,
  X,
  RotateCw,
  FileCheck,
} from 'lucide-react'
import {
  fetchContracts,
  createContract,
  deleteContract,
  type SupplierContract,
} from '../lib/contractsRepository'
import { isSystemAdmin } from '../lib/permissions'
import { logAuditEvent } from '../lib/auditLogger'

type ContractsPageProps = {
  session?: Session | null
}

const CONTRACT_TYPES = {
  supply: 'توريد بضائع وأجهزة',
  service: 'خدمات ودعم تقني',
  maintenance: 'صيانة وتشغيل دوري',
  consulting: 'استشارات وتدريب',
}

const STATUS_CONFIG = {
  active: { label: 'ساري ونشط', icon: CheckCircle2, className: 'status-tag full' },
  draft: { label: 'مسودة', icon: Clock, className: 'status-tag pending' },
  expired: { label: 'منتهي الصلاحية', icon: XCircle, className: 'status-tag over' },
  terminated: { label: 'ملغي أو مفسوخ', icon: AlertTriangle, className: 'status-tag part' },
  renewed: { label: 'تم التجديد', icon: FileCheck, className: 'status-tag full' },
}

export default function ContractsPage({ session }: ContractsPageProps) {
  const [contracts, setContracts] = useState<SupplierContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedContract, setSelectedContract] = useState<SupplierContract | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form
  const [contractNumber, setContractNumber] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [contractTitle, setContractTitle] = useState('')
  const [contractType, setContractType] = useState<SupplierContract['contract_type']>('supply')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 86400000 * 365).toISOString().slice(0, 10)
  )
  const [contractValue, setContractValue] = useState<number | ''>('')
  const [autoRenewal, setAutoRenewal] = useState(false)
  const [renewalNoticeDays, setRenewalNoticeDays] = useState(30)
  const [terms, setTerms] = useState('')

  const isAdmin = isSystemAdmin(session)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const data = await fetchContracts()
      setContracts(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (
        c.contract_number.toLowerCase().includes(term) ||
        c.contract_title.toLowerCase().includes(term) ||
        c.supplier_name.toLowerCase().includes(term) ||
        (c.terms && c.terms.toLowerCase().includes(term))
      )
    })
  }, [contracts, statusFilter, searchTerm])

  const kpis = useMemo(() => {
    const total = contracts.length
    const active = contracts.filter((c) => c.status === 'active').length
    const totalValue = contracts.reduce((sum, c) => sum + (Number(c.contract_value) || 0), 0)

    // العقود المنتهية قريباً خلال 30 يوم
    const expiringSoon = contracts.filter((c) => {
      if (c.status !== 'active') return false
      const end = new Date(c.end_date).getTime()
      const now = Date.now()
      const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24))
      return diffDays <= 30 && diffDays >= 0
    }).length

    return { total, active, totalValue, expiringSoon }
  }, [contracts])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!supplierName.trim() || !contractTitle.trim() || !startDate || !endDate) {
      alert('يرجى تعبئة كافة الحقول الأساسية وتواريخ العقد.')
      return
    }

    setIsSubmitting(true)
    try {
      const cNumber =
        contractNumber.trim() || `CNT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`
      const newContract = await createContract({
        contract_number: cNumber,
        supplier_name: supplierName.trim(),
        contract_title: contractTitle.trim(),
        contract_type: contractType,
        start_date: startDate,
        end_date: endDate,
        contract_value: Number(contractValue) || 0,
        currency: 'EGP',
        status: 'active',
        auto_renewal: autoRenewal,
        renewal_notice_days: Number(renewalNoticeDays) || 30,
        terms: terms.trim(),
        created_by: session?.user?.id,
        created_by_email: session?.user?.email,
      })

      setContracts((prev) => [newContract, ...prev])
      setIsAddModalOpen(false)
      setSupplierName('')
      setContractTitle('')
      setContractValue('')
      setTerms('')
      setSuccessMessage(`تم إضافة العقد رقم ${cNumber} بنجاح.`)

      void logAuditEvent({
        action: `تسجيل عقد مورد: ${contractTitle}`,
        entity_type: 'contract',
        details: { contract_number: cNumber, supplier: supplierName, value: contractValue },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (contract: SupplierContract) => {
    if (!isAdmin) return
    if (!window.confirm(`هل أنت متأكد من حذف العقد رقم ${contract.contract_number}؟`)) return

    try {
      await deleteContract(contract.id)
      setContracts((prev) => prev.filter((c) => c.id !== contract.id))
      if (selectedContract?.id === contract.id) setSelectedContract(null)
      setSuccessMessage('تم حذف العقد بنجاح.')

      void logAuditEvent({
        action: `حذف عقد مورد: ${contract.contract_number}`,
        entity_type: 'contract',
        details: { contract_id: contract.id },
        user: session?.user,
      })
    } catch {
      alert('حدث خطأ أثناء حذف العقد.')
    }
  }

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <FileText size={24} />
        </div>
        <div>
          <p className="eyebrow">المشتريات والتوريدات • جامعة الزقازيق الأهلية</p>
          <h2>إدارة العقود واتفاقيات الموردين</h2>
          <p>أرشفة وتوثيق عقود التوريد والخدمات، تتبع مواعيد التجديد، والربط بأوامر الشراء</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={18} /> إضافة عقد جديد
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
            <span className="kpi-label">إجمالي العقود</span>
            <span className="badge-pill">الكل</span>
          </div>
          <div className="kpi-value">{kpis.total}</div>
          <div className="kpi-sub">عقد موثق بالمنظومة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">العقود السارية والنشطة</span>
            <span className="badge-pill highlight">ساري</span>
          </div>
          <div className="kpi-value text-emerald-500">{kpis.active}</div>
          <div className="kpi-sub">عقود قيد التنفيذ والتوريد</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">تنتهي خلال 30 يوم</span>
            <span className="badge-pill text-amber-500">تنبيه</span>
          </div>
          <div className="kpi-value text-amber-500">{kpis.expiringSoon}</div>
          <div className="kpi-sub">تتطلب مراجعة التجديد أو الإلغاء</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">القيمة المالية الإجمالية</span>
            <span className="badge-pill">ج.م</span>
          </div>
          <div className="kpi-value text-primary font-bold">
            {kpis.totalValue.toLocaleString('ar-EG')} ج.م
          </div>
          <div className="kpi-sub">إجمالي قيمة التوريدات المتعاقد عليها</div>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="card-surface p-4">
        <div className="movements-filter-toolbar">
          <div className="input-search-wrap">
            <Search size={16} className="input-search-icon" />
            <input
              type="search"
              placeholder="ابحث برقم العقد، اسم الشركة، أو عنوان الاتفاقية..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-field w-full"
            />
          </div>

          <div className="filter-group">
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              الكل ({contracts.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'active' ? 'active' : ''}`}
              onClick={() => setStatusFilter('active')}
            >
              ساري ({kpis.active})
            </button>
            <button
              type="button"
              className={`filter-tab ${statusFilter === 'expired' ? 'active' : ''}`}
              onClick={() => setStatusFilter('expired')}
            >
              منتهي
            </button>
          </div>
        </div>

        <div className="movement-table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>رقم العقد</th>
                <th>عنوان العقد / الاتفاقية</th>
                <th>المورد / الشركة</th>
                <th>نوع العقد</th>
                <th>فترة العقد (من - إلى)</th>
                <th>القيمة</th>
                <th>الحالة</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty text-center py-8">
                    <FileText size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-muted">لا توجد عقود مطابقة للبحث الحالي.</p>
                  </td>
                </tr>
              ) : (
                filteredContracts.map((c) => {
                  const statusInfo = STATUS_CONFIG[c.status] || STATUS_CONFIG.active
                  const StatusIcon = statusInfo.icon

                  const endDateObj = new Date(c.end_date)
                  const diffDays = Math.ceil((endDateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  const isExpiringSoon = c.status === 'active' && diffDays <= 30 && diffDays >= 0

                  return (
                    <tr key={c.id}>
                      <td className="font-semibold text-primary">{c.contract_number}</td>
                      <td>
                        <strong>{c.contract_title}</strong>
                        {c.auto_renewal && (
                          <span className="block text-xs text-primary font-medium">تجديد تلقائي</span>
                        )}
                      </td>
                      <td>
                        <span className="font-medium">{c.supplier_name}</span>
                      </td>
                      <td>
                        <span className="text-xs bg-muted/30 px-2 py-1 rounded">
                          {CONTRACT_TYPES[c.contract_type]}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs">
                          <span>{c.start_date}</span> إلى <span>{c.end_date}</span>
                        </div>
                        {isExpiringSoon && (
                          <span className="text-xs text-amber-600 font-bold flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={12} /> ينتهي خلال {diffDays} يوم
                          </span>
                        )}
                      </td>
                      <td>
                        <strong className="text-emerald-600">
                          {Number(c.contract_value).toLocaleString('ar-EG')} {c.currency}
                        </strong>
                      </td>
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
                            onClick={() => setSelectedContract(c)}
                            title="عرض تفاصيل العقد"
                          >
                            <Eye size={15} />
                            <span>عرض</span>
                          </button>

                          {isAdmin && (
                            <button
                              type="button"
                              className="table-action-btn delete-action-btn"
                              onClick={() => handleDelete(c)}
                              title="حذف العقد"
                            >
                              <Trash2 size={15} />
                              <span>حذف</span>
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

      {/* Modal: New Contract */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon">
                  <Plus size={18} />
                </div>
                <div>
                  <h3>تسجيل عقد توريد أو اتفاقية جديدة</h3>
                  <span className="modal-subtitle">إدراج بيانات التعاقد والشروط والمواعيد الرسمية</span>
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
                  اسم الشركة / المورد المتعاقد معه *
                  <input
                    type="text"
                    required
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="مثال: شركة النيل للتوريدات الطبية"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  رقم العقد / الكود المرجعي
                  <input
                    type="text"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    placeholder="اتركه فارغاً للتوليد الآلي (CNT-2026-XXXX)"
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">
                  موضوع وعنوان العقد *
                  <input
                    type="text"
                    required
                    value={contractTitle}
                    onChange={(e) => setContractTitle(e.target.value)}
                    placeholder="مثال: عقد توريد أجهزة حاسوب لمعامل كلية الهندسة"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  نوع التعاقد
                  <select
                    value={contractType}
                    onChange={(e) => setContractType(e.target.value as SupplierContract['contract_type'])}
                    className="p-2 border rounded"
                  >
                    <option value="supply">توريد بضائع وأجهزة</option>
                    <option value="service">خدمات ودعم فني</option>
                    <option value="maintenance">صيانة وتشغيل</option>
                    <option value="consulting">استشارات وتدريب</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  تاريخ بداية العقد *
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  تاريخ نهاية العقد *
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  قيمة العقد (ج.م) *
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={contractValue}
                    onChange={(e) => setContractValue(e.target.value ? Number(e.target.value) : '')}
                    placeholder="مثال: 500000"
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 bg-muted/20 rounded">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={autoRenewal}
                    onChange={(e) => setAutoRenewal(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>تجديد العقد تلقائياً عند انتهائه ما لم يُخطر الطرف الآخر</span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <span>إشعار التجديد قبل:</span>
                  <input
                    type="number"
                    min="1"
                    value={renewalNoticeDays}
                    onChange={(e) => setRenewalNoticeDays(Number(e.target.value) || 30)}
                    className="w-16 p-1 border rounded text-center bg-background"
                  />
                  <span>يوم</span>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                الشروط والبنود والمواصفات
                <textarea
                  rows={3}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="شروط التسليم، مواعيد الدفع، الضمان، غرامات التأخير..."
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
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ وتوثيق العقد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Details */}
      {selectedContract && (
        <div className="modal-backdrop" onClick={() => setSelectedContract(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon">
                  <FileText size={18} />
                </div>
                <div>
                  <h3>تفاصيل عقد المورد</h3>
                  <span className="modal-subtitle">{selectedContract.contract_number}</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedContract(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-lg">
                <div>
                  <span className="text-muted text-xs block">المورد / الشركة:</span>
                  <strong className="text-base">{selectedContract.supplier_name}</strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">قيمة العقد:</span>
                  <strong className="text-base text-emerald-600">
                    {Number(selectedContract.contract_value).toLocaleString('ar-EG')}{' '}
                    {selectedContract.currency}
                  </strong>
                </div>
                <div>
                  <span className="text-muted text-xs block">تاريخ السريان:</span>
                  <span>{selectedContract.start_date}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">تاريخ الانتهاء:</span>
                  <span>{selectedContract.end_date}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">نوع العقد:</span>
                  <span>{CONTRACT_TYPES[selectedContract.contract_type]}</span>
                </div>
                <div>
                  <span className="text-muted text-xs block">الحالة:</span>
                  <span>{STATUS_CONFIG[selectedContract.status].label}</span>
                </div>
              </div>

              <div>
                <span className="text-muted text-xs block mb-1">عنوان العقد:</span>
                <p className="p-3 bg-muted/10 rounded font-semibold">{selectedContract.contract_title}</p>
              </div>

              {selectedContract.terms && (
                <div>
                  <span className="text-muted text-xs block mb-1">الشروط والأحكام:</span>
                  <p className="p-3 bg-muted/10 rounded whitespace-pre-line text-sm">
                    {selectedContract.terms}
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setSelectedContract(null)}
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

