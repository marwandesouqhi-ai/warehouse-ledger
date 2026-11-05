import { useState, useEffect, useMemo, type FormEvent, type ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AccessibleDialog } from '../components/AccessibleDialog'
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
  Paperclip,
  UploadCloud,
  Download,
} from 'lucide-react'
import {
  fetchContracts,
  createContract,
  deleteContract,
  type SupplierContract,
  type ContractAttachment,
} from '../lib/contractsRepository'
import {
  validateAttachmentFile,
  fileToDataUrl,
  downloadAttachment,
} from '../lib/procurementAttachments'
import { isSystemAdmin, canAddDepartment } from '../lib/permissions'
import { logAuditEvent } from '../lib/auditLogger'
import { getCairoDateString } from '../lib/dateUtils'

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
  const canAdd = canAddDepartment(session, 'procurement')
  const [contracts, setContracts] = useState<SupplierContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedContract, setSelectedContract] = useState<SupplierContract | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form
  const [contractNumber, setContractNumber] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [contractTitle, setContractTitle] = useState('')
  const [contractType, setContractType] = useState<SupplierContract['contract_type']>('supply')
  const [startDate, setStartDate] = useState(() => getCairoDateString())
  const [endDate, setEndDate] = useState(() =>
    getCairoDateString(new Date(Date.now() + 86400000 * 365))
  )
  const [contractValue, setContractValue] = useState<number | ''>('')
  const [autoRenewal, setAutoRenewal] = useState(false)
  const [renewalNoticeDays, setRenewalNoticeDays] = useState(30)
  const [terms, setTerms] = useState('')

  // Attachments State
  const [attachments, setAttachments] = useState<ContractAttachment[]>([])
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')

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

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    setAttachmentError('')
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsReadingFile(true)
    try {
      const newAttachments: ContractAttachment[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const validation = validateAttachmentFile(file)
        if (!validation.isValid) {
          setAttachmentError(validation.error || 'الملف المختار غير صالح.')
          continue
        }

        const dataUrl = await fileToDataUrl(file)
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          dataUrl,
          uploadedAt: new Date().toISOString(),
        })
      }

      setAttachments((prev) => [...prev, ...newAttachments])
    } catch {
      setAttachmentError('حدث خطأ أثناء قراءة ومعالجة الملفات المحددة.')
    } finally {
      setIsReadingFile(false)
      // reset input value so re-selecting same file works
      e.target.value = ''
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!canAdd) return
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
        attachments: attachments,
        created_by: session?.user?.id,
        created_by_email: session?.user?.email,
      })

      setContracts((prev) => [newContract, ...prev])
      setIsAddModalOpen(false)
      setSupplierName('')
      setContractTitle('')
      setContractValue('')
      setTerms('')
      setAttachments([])
      setSuccessMessage(`تم إضافة العقد رقم ${cNumber} بنجاح مع ${attachments.length} مرفق.`)

      void logAuditEvent({
        action: `تسجيل عقد مورد: ${contractTitle}`,
        entity_type: 'contract',
        details: {
          contract_number: cNumber,
          supplier: supplierName,
          value: contractValue,
          attachments_count: attachments.length,
        },
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
          <p>أرشفة وتوثيق عقود التوريد والخدمات، إرفاق الوثائق والمستندات، وتتبع مواعيد التجديد</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button hidden={!canAdd} type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
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
          <div className="kpi-sub">التزامات العقود الإجمالية</div>
        </div>
      </div>

      {/* Filters and List */}
      <div className="card-surface">
        <div className="table-header-row flex flex-col md:flex-row gap-4 justify-between items-center p-4 border-b">
          <div className="search-box-wrap flex-1 max-w-md w-full relative">
            <Search className="search-icon absolute right-3 top-2.5 text-muted" size={18} />
            <input
              type="text"
              placeholder="البحث برقم العقد، الموضوع، أو اسم المورد..."
              aria-label="البحث في عقود التوريد"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2 border rounded-lg bg-background"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">حالة العقد:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="p-2 border rounded-lg bg-background text-sm"
            >
              <option value="all">كافة الحالات</option>
              <option value="active">ساري ونشط</option>
              <option value="draft">مسودة</option>
              <option value="expired">منتهي الصلاحية</option>
              <option value="terminated">ملغي / مفسوخ</option>
              <option value="renewed">تم التجديد</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="table-responsive">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>رقم العقد</th>
                <th>موضوع العقد والوثائق</th>
                <th>المورد / الشركة</th>
                <th>النوع</th>
                <th>فترة السريان</th>
                <th>القيمة الإجمالية</th>
                <th>الحالة</th>
                <th className="actions-cell">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted">
                    {isLoading ? 'جارٍ تحميل العقود...' : 'لا توجد عقود مسجلة تطابق معايير البحث'}
                  </td>
                </tr>
              ) : (
                filteredContracts.map((c) => {
                  const statusInfo = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft
                  const StatusIcon = statusInfo.icon

                  const endDateObj = new Date(c.end_date)
                  const diffDays = Math.ceil((endDateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  const isExpiringSoon = c.status === 'active' && diffDays <= 30 && diffDays >= 0
                  const hasAttachments = Array.isArray(c.attachments) && c.attachments.length > 0

                  return (
                    <tr key={c.id}>
                      <td className="font-semibold text-primary">{c.contract_number}</td>
                      <td>
                        <div className="flex items-center gap-2 flex-wrap">
                          <strong>{c.contract_title}</strong>
                          {hasAttachments && (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium" title="يحتوي على مرفقات موثقة">
                              <Paperclip size={11} /> {c.attachments!.length} مرفق
                            </span>
                          )}
                        </div>
                        {c.auto_renewal && (
                          <span className="block text-xs text-primary font-medium mt-0.5">تجديد تلقائي</span>
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
                            title="عرض تفاصيل العقد والمرفقات"
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
        <AccessibleDialog
          isOpen={true}
          onClose={() => setIsAddModalOpen(false)}
          titleId="new-contract-modal-title"
          dialogClassName="modal-dialog modal-dialog-form max-w-2xl"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <Plus size={18} />
              </div>
              <div>
                <h3 id="new-contract-modal-title">تسجيل عقد توريد أو اتفاقية جديدة</h3>
                <span className="modal-subtitle">إدراج بيانات التعاقد والشروط والمواعيد الرسمية وإرفاق المستندات</span>
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

            <form onSubmit={handleCreate} className="modal-body p-6 space-y-4 max-h-[80vh] overflow-y-auto">
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

              {/* قسم إرفاق المستندات والصور */}
              <div className="flex flex-col gap-2 p-4 bg-muted/20 border border-dashed border-border rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <Paperclip size={16} className="text-primary" />
                    إرفاق مستندات أو صور العقد الرسمية
                  </span>
                  <span className="text-xs text-muted">
                    {attachments.length} مرفق محدد (الحد الأقصى 10 ميجابايت للملف)
                  </span>
                </div>

                <label className="flex flex-col items-center justify-center p-4 border border-dashed rounded-md bg-background/50 hover:bg-background cursor-pointer transition-colors text-center">
                  <UploadCloud size={24} className="text-primary mb-1" />
                  <span className="text-xs font-semibold text-foreground">
                    انقر لاختيار ملف (PDF، صور، مستندات Word/Excel) أو اسحبه هنا
                  </span>
                  <span className="text-[11px] text-muted mt-0.5">
                    يتم الحفظ والتشفير تلقائياً وتضمينه في النسخ الاحتياطية السحابية والمحلية
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={handleFileSelect}
                    disabled={isReadingFile}
                    className="hidden"
                  />
                </label>

                {attachmentError && (
                  <div className="text-xs text-destructive flex items-center gap-1 bg-destructive/10 p-2 rounded">
                    <AlertTriangle size={14} />
                    <span>{attachmentError}</span>
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2.5 bg-background border rounded-md text-xs shadow-sm"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {att.type.startsWith('image/') && att.dataUrl ? (
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="w-8 h-8 object-cover rounded border"
                            />
                          ) : (
                            <FileText size={20} className="text-primary flex-shrink-0" />
                          )}
                          <div className="truncate">
                            <p className="font-semibold truncate max-w-[200px] sm:max-w-[300px]">{att.name}</p>
                            <span className="text-muted text-[10px]">
                              {(att.size / 1024).toFixed(0)} كيلوبايت • {att.type || 'مستند'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {att.dataUrl && (
                            <button
                              type="button"
                              className="p-1 text-muted hover:text-foreground rounded"
                              onClick={() => {
                                if (att.type.startsWith('image/')) {
                                  setPreviewImage(att.dataUrl!)
                                } else {
                                  downloadAttachment(att.dataUrl!, att.name)
                                }
                              }}
                              title="معاينة أو تحميل"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="p-1 text-destructive hover:bg-destructive/10 rounded"
                            onClick={() => removeAttachment(att.id)}
                            title="حذف المرفق"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                <button type="submit" className="primary-btn" disabled={isSubmitting || isReadingFile}>
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ والتوثيق...' : 'حفظ وتوثيق العقد'}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}

      {/* Modal: View Details */}
      {selectedContract && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setSelectedContract(null)}
          titleId="contract-details-modal-title"
          dialogClassName="modal-dialog max-w-2xl"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <FileText size={18} />
              </div>
              <div>
                <h3 id="contract-details-modal-title">تفاصيل عقد المورد والوثائق</h3>
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

            <div className="modal-body p-6 space-y-4 max-h-[80vh] overflow-y-auto">
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
                <span className="text-muted text-xs block mb-1">عنوان وموضوع العقد:</span>
                <p className="p-3 bg-muted/10 rounded font-semibold">{selectedContract.contract_title}</p>
              </div>

              {selectedContract.terms && (
                <div>
                  <span className="text-muted text-xs block mb-1">الشروط والأحكام والبنود:</span>
                  <p className="p-3 bg-muted/10 rounded whitespace-pre-line text-sm">
                    {selectedContract.terms}
                  </p>
                </div>
              )}

              {/* قسم المرفقات والوثائق الرسمية */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold flex items-center gap-1.5">
                    <Paperclip size={16} className="text-primary" />
                    المستندات والمرفقات الرسمية للعقد
                  </h4>
                  <span className="text-xs text-muted">
                    {selectedContract.attachments && selectedContract.attachments.length > 0
                      ? `${selectedContract.attachments.length} مستند موثق`
                      : 'لا توجد مرفقات'}
                  </span>
                </div>

                {selectedContract.attachments && selectedContract.attachments.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedContract.attachments.map((att: any, idx: number) => {
                      const isImg =
                        att.type?.startsWith('image/') ||
                        att.name?.match(/\.(png|jpg|jpeg|webp)$/i)
                      return (
                        <div
                          key={att.id || idx}
                          className="flex items-center justify-between p-3 bg-muted/20 border rounded-lg gap-2"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            {isImg && att.dataUrl ? (
                              <img
                                src={att.dataUrl}
                                alt={att.name}
                                className="w-10 h-10 object-cover rounded border cursor-pointer hover:opacity-80"
                                onClick={() => setPreviewImage(att.dataUrl)}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-xs">
                                {att.name?.split('.').pop()?.toUpperCase() || 'DOC'}
                              </div>
                            )}
                            <div className="truncate">
                              <p className="font-semibold text-xs truncate max-w-[150px]">{att.name}</p>
                              <span className="text-[10px] text-muted block">
                                {att.size ? `${(att.size / 1024).toFixed(0)} كيلوبايت` : 'ملف محفوظ'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isImg && att.dataUrl && (
                              <button
                                type="button"
                                className="table-action-btn edit-action-btn !p-1.5"
                                onClick={() => setPreviewImage(att.dataUrl)}
                                title="تكبير ومعاينة الصورة"
                              >
                                <Eye size={14} />
                              </button>
                            )}
                            {att.dataUrl && (
                              <button
                                type="button"
                                className="table-action-btn primary-action-btn !p-1.5"
                                onClick={() => downloadAttachment(att.dataUrl, att.name)}
                                title="تنزيل الملف"
                              >
                                <Download size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-muted/10 rounded text-center text-xs text-muted">
                    لم يتم إرفاق وثائق أو صور إلكترونية لهذا العقد عند التسجيل.
                  </div>
                )}
              </div>

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
        </AccessibleDialog>
      )}

      {/* Lightbox Image Preview Modal */}
      {previewImage && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setPreviewImage(null)}
          titleId="preview-image-modal-title"
          dialogClassName="relative max-w-4xl max-h-[90vh] bg-background p-3 rounded-xl shadow-2xl overflow-hidden flex flex-col items-center"
          backdropClassName="modal-backdrop z-50 flex items-center justify-center p-4 bg-black/75"
        >
            <div className="w-full flex justify-between items-center pb-2 border-b mb-2">
              <span id="preview-image-modal-title" className="text-xs font-semibold">معاينة الصورة المرفقة</span>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPreviewImage(null)}
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={previewImage}
              alt="معاينة المرفق"
              className="max-h-[75vh] w-auto object-contain rounded-lg shadow-sm"
            />
        </AccessibleDialog>
      )}
    </section>
  )
}
