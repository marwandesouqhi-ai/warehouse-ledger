import { canAddDepartment } from '../lib/permissions'
import { getAccessSession } from '../lib/accessContext'
import { useState, useMemo, useEffect } from 'react'
import {
  X,
  Printer,
  FileSpreadsheet,
  Save,
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Users,
  Plus,
  Trash2,
} from 'lucide-react'
import { WAREHOUSES } from '../lib/custody'
import { getCairoDateString } from '../lib/dateUtils'
import type { AppSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { logAuditEvent } from '../lib/auditLogger'
import { AccessibleDialog } from './AccessibleDialog'
import { formatCurrency } from '../lib/currency'
import { safePrint } from '../lib/printUtils'

export interface InspectionItemRow {
  id: string
  name: string
  requestedQty: number
  suppliedQty: number
  acceptedQty: number
  rejectedQty: number
  unitPrice: number
  rejectionReason: string
}

interface TechnicalInspectionModalProps {
  settings: AppSettings
  currency: AppSettings['currency']
  defaultSupplier?: string
  defaultPoNo?: string
  defaultInvoiceNo?: string
  initialItems?: InspectionItemRow[]
  onClose: () => void
  onSave?: (data: InspectionReportData) => Promise<void> | void
}

export interface InspectionReportData {
  inspectionNo: string
  supplier: string
  poNumber: string
  invoiceNumber: string
  warehouseId: string
  warehouseName: string
  inspectionDate: string
  decision: 'accepted' | 'accepted_with_notes' | 'rejected'
  totalAcceptedValue: number
  items: InspectionItemRow[]
  committeeHead: string
  technicalExpert: string
  custodian: string
  finalNotes: string
}

const formatMoney = (amount: number, currency: AppSettings['currency']): string => formatCurrency(amount, currency)

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return `'${value}` as unknown as T
  }
  return value
}

export const TechnicalInspectionModal: React.FC<TechnicalInspectionModalProps> = ({
  settings,
  currency,
  defaultSupplier = 'شركة التوريدات الطبية والعلمية المتطورة',
  defaultPoNo = 'PO-2026-089',
  defaultInvoiceNo = 'INV-9941',
  initialItems,
  onClose,
  onSave,
}) => {
  const [inspectionNo] = useState(() => {
    return `INSP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
  })

  // Form Fields
  const [supplier, setSupplier] = useState(defaultSupplier)
  const [poNumber, setPoNumber] = useState(defaultPoNo)
  const [invoiceNumber, setInvoiceNumber] = useState(defaultInvoiceNo)
  const [warehouseId, setWarehouseId] = useState('main')
  const [inspectionDate, setInspectionDate] = useState(() => getCairoDateString())

  // Decision State
  const [decision, setDecision] = useState<'accepted' | 'accepted_with_notes' | 'rejected'>('accepted')

  // Committee Formation
  const [committeeHead, setCommitteeHead] = useState('أ.د. وكيل الكلية ورئيس لجنة الفحص')
  const [technicalExpert, setTechnicalExpert] = useState('م. خبير المعامل والأجهزة (عضو فني)')
  const [custodianName, setCustodianName] = useState('أمين المستودع الرئيسي (عضو ومستلم)')
  const [finalNotes, setFinalNotes] = useState(
    'تمت المعاينة والفحص الفني ومطابقة الكتالوجات والمواصفات الفنية المعتمدة.'
  )

  // Status feedback
  const [saveStatus, setSaveStatus] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Items table
  const [items, setItems] = useState<InspectionItemRow[]>(() => {
    if (initialItems && initialItems.length > 0) return initialItems
    return [
      {
        id: '1',
        name: 'ميكروسكوب ضوئي إكلينيكي ثنائي العدسات 1000X',
        requestedQty: 10,
        suppliedQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        unitPrice: 45000,
        rejectionReason: '',
      },
      {
        id: '2',
        name: 'شاشة تفاعلية ذكية 75 بوصة للقاعات والمعامل',
        requestedQty: 5,
        suppliedQty: 5,
        acceptedQty: 5,
        rejectedQty: 0,
        unitPrice: 65000,
        rejectionReason: '',
      },
    ]
  })

  const targetWh = useMemo(() => {
    return WAREHOUSES.find((w) => w.id === warehouseId) || WAREHOUSES[0]
  }, [warehouseId])

  // Total Accepted Value
  const totalAcceptedValue = useMemo(() => {
    return items.reduce((acc, row) => acc + (row.acceptedQty * row.unitPrice), 0)
  }, [items])

  function updateItemRow(id: string, field: keyof InspectionItemRow, value: any) {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        const updated = { ...row, [field]: value }
        if (field === 'suppliedQty' || field === 'acceptedQty') {
          const sup = field === 'suppliedQty' ? Number(value) || 0 : row.suppliedQty
          const acc = field === 'acceptedQty' ? Number(value) || 0 : row.acceptedQty
          updated.rejectedQty = Math.max(0, sup - acc)
        }
        return updated
      })
    )
  }

  function addNewRow() {
    setItems((prev) => [
      ...prev,
      {
        id: `insp-item-${Date.now()}`,
        name: '',
        requestedQty: 1,
        suppliedQty: 1,
        acceptedQty: 1,
        rejectedQty: 0,
        unitPrice: 0,
        rejectionReason: '',
      },
    ])
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id))
  }

  useEffect(() => {
    function handleAfterPrint() {
      document.body.classList.remove('printing-technical-inspection')
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  function handlePrint() {
    void safePrint({ bodyClass: 'printing-technical-inspection' })
  }

  async function handleExportExcel() {
    const XLSX = await import('xlsx')
    const rows = items.map((r, idx) => ({
      'م': idx + 1,
      'اسم الصنف': sanitizeExcelCell(r.name),
      'الكمية المطلوبة': r.requestedQty,
      'الكمية الموردة': r.suppliedQty,
      'الكمية المقبولة': r.acceptedQty,
      'الكمية المرفوضة': r.rejectedQty,
      'سعر الوحدة': r.unitPrice,
      'إجمالي المقبول': r.acceptedQty * r.unitPrice,
      'سبب الرفض والملاحظات': sanitizeExcelCell(r.rejectionReason || '—'),
    }))

    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'محضر الفحص والاستلام')
    XLSX.writeFile(workbook, `محضر-فحص-واردات-${inspectionNo}.xlsx`)
  }

  async function handleSave() {
    if (!canAddDepartment(getAccessSession(), 'warehouse')) return
    setIsSaving(true)
    setSaveStatus('')

    const payload: InspectionReportData = {
      inspectionNo,
      supplier,
      poNumber,
      invoiceNumber,
      warehouseId,
      warehouseName: targetWh.name,
      inspectionDate,
      decision,
      totalAcceptedValue,
      items,
      committeeHead,
      technicalExpert,
      custodian: custodianName,
      finalNotes,
    }

    try {
      if (onSave) {
        await onSave(payload)
      } else {
        if (supabase) {
          try {
            await supabase.from('technical_inspections').insert([
              {
                inspection_number: payload.inspectionNo,
                supplier: payload.supplier,
                po_number: payload.poNumber,
                invoice_number: payload.invoiceNumber,
                warehouse_id: payload.warehouseId,
                warehouse_name: payload.warehouseName,
                inspection_date: payload.inspectionDate,
                decision: payload.decision,
                total_accepted_value: payload.totalAcceptedValue,
                items: payload.items,
                committee_head: payload.committeeHead,
                technical_expert: payload.technicalExpert,
                custodian: payload.custodian,
                final_notes: payload.finalNotes,
              },
            ])
          } catch (e) {
            console.warn('Supabase inspection insert failed, falling back to local:', e)
          }
        }

        const storageKey = 'warehouse_inspection_reports'
        const existing = JSON.parse(localStorage.getItem(storageKey) || '[]')
        existing.unshift(payload)
        localStorage.setItem(storageKey, JSON.stringify(existing.slice(0, 50)))
      }

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('technical-inspections-changed'))
        }
      } catch {
        // ignore
      }

      // تسجيل في سجل العمليات والتدقيق
      void logAuditEvent({
        action: `اعتماد محضر فحص واستلام فني #${payload.inspectionNo}`,
        entity_type: 'technical_inspection',
        entity_id: payload.inspectionNo,
        details: {
          supplier: payload.supplier,
          decision: payload.decision,
          totalValue: payload.totalAcceptedValue,
          warehouse: payload.warehouseName,
        },
      })

      setSaveStatus('تم توثيق واعتماد محضر الفحص والاستلام الفني بنجاح في قاعدة البيانات.')
      setTimeout(() => setSaveStatus(''), 4000)
    } catch {
      setSaveStatus('تعذر حفظ محضر الفحص والاستلام.')
    } finally {
      setIsSaving(false)
    }
  }

  const isDirty = Boolean(supplier.trim() || invoiceNumber.trim() || items.some(i => i.name.trim()))
  function handleSafeClose() {
    if (isSaving) return
    if (isDirty && !window.confirm('هل أنت متأكد من إغلاق محضر الفحص الفني وتجاهل التعديلات؟')) {
      return
    }
    onClose()
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isSaving) return
        handleSafeClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSaving, isDirty])

  return (
    <AccessibleDialog
      isOpen={true}
      onClose={handleSafeClose}
      titleId="inspection-modal-title"
      dialogClassName="modal-dialog inspection-modal-dialog"
      dialogStyle={{ maxWidth: '1100px', width: '96vw' }}
      closeOnBackdropClick={!isSaving}
      closeOnEscape={!isSaving}
    >
        {/* Modal Header */}
        <div className="modal-header inspection-modal-header no-print">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="modal-close-btn"
              onClick={handleSafeClose}
              disabled={isSaving}
              aria-label="إغلاق النافذة"
            >
              <X size={18} />
            </button>

            <button
              type="button"
              className="secondary-btn btn-sm"
              onClick={handlePrint}
              title="طباعة محضر الفحص A4"
            >
              <Printer size={15} />
              <span>طباعة (A4)</span>
            </button>

            <button
              type="button"
              className="secondary-btn btn-sm"
              onClick={handleExportExcel}
              title="تصدير بيانات المحضر إلى Excel"
            >
              <FileSpreadsheet size={15} />
              <span>إكسيل</span>
            </button>

            <button hidden={!canAddDepartment(getAccessSession(), 'warehouse')}
              type="button"
              className="primary-btn btn-sm"
              onClick={handleSave}
              disabled={isSaving}
              style={{ backgroundColor: 'var(--accent, #006c67)', color: '#fff' }}
              title="حفظ المحضر بقاعدة البيانات"
            >
              <Save size={15} />
              <span>{isSaving ? 'جارٍ الحفظ...' : 'حفظ بالقاعدة'}</span>
            </button>
          </div>

          <div className="text-end">
            <div className="flex items-center justify-end gap-2">
              <h2 id="inspection-modal-title" className="m-0 text-lg font-bold text-ink">
                محضر الفحص والاستلام الفني للواردات ({inspectionNo})
              </h2>
              <div className="modal-title-icon" style={{ background: 'var(--accent-tint, #e0f2f1)', color: 'var(--accent, #006c67)' }}>
                <ClipboardCheck size={20} />
              </div>
            </div>
            <span className="text-muted font-xs block mt-0.5">
              {settings.organization || 'جامعة الزقازيق الأهلية'} • توثيق واعتماد لجنة الفحص والمعاينة الفنية لمشتريات الجامعة طبقاً للائحة المخازن
            </span>
          </div>
        </div>

        {/* Save Status Notification */}
        {saveStatus && (
          <div className="inline-message success no-print mx-5 mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>{saveStatus}</span>
            </div>
            <button
              type="button"
              className="text-muted bg-none border-none cursor-pointer"
              onClick={() => setSaveStatus('')}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="modal-body-scroll p-4" style={{ overflowY: 'auto', maxHeight: 'calc(88vh - 120px)' }}>
          {/* Interactive Screen Editor Form (Hidden in Print) */}
          <div className="inspection-editor-screen no-print">
            {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className="md:col-span-2">
              <label className="font-xs font-semibold text-muted block mb-1">
                المورد / الشركة
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className="input-compact w-full font-bold"
                />
              </div>
            </div>

            <div>
              <label className="font-xs font-semibold text-muted block mb-1">
                رقم أمر التوريد / الشراء
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="input-compact w-full font-mono font-semibold"
              />
            </div>

            <div>
              <label className="font-xs font-semibold text-muted block mb-1">
                رقم الفاتورة المرفقة
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="input-compact w-full font-mono font-semibold"
              />
            </div>

            <div>
              <label className="font-xs font-semibold text-muted block mb-1">
                المستودع المستلم
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="input-compact w-full font-semibold"
              >
                {WAREHOUSES.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-xs font-semibold text-muted block mb-1">
                تاريخ محضر الفحص
              </label>
              <input
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                className="input-compact w-full font-semibold"
              />
            </div>
          </div>

          {/* Decision Strip */}
          <div className="card-surface p-3 mb-4 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--surface-sunken, #f8fafc)', border: '1px solid var(--line, #e2e8f0)', borderRadius: '12px' }}>
            <div className="flex items-center gap-2">
              <span className="font-bold font-sm text-ink">قرار لجنة الفحص والاستلام:</span>
              <button
                type="button"
                onClick={() => setDecision('accepted')}
                className={`btn-sm font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-all ${decision === 'accepted'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white border border-line text-ink hover:bg-slate-100'
                  }`}
              >
                <CheckCircle2 size={15} />
                <span>مطابق ومقبول كلياً</span>
              </button>

              <button
                type="button"
                onClick={() => setDecision('accepted_with_notes')}
                className={`btn-sm font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-all ${decision === 'accepted_with_notes'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white border border-line text-ink hover:bg-slate-100'
                  }`}
              >
                <AlertTriangle size={15} />
                <span>مقبول مع ملاحظات</span>
              </button>

              <button
                type="button"
                onClick={() => setDecision('rejected')}
                className={`btn-sm font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-all ${decision === 'rejected'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white border border-line text-ink hover:bg-slate-100'
                  }`}
              >
                <XCircle size={15} />
                <span>مرفوض كلياً</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-xs font-semibold text-muted">إجمالي القيمة المقبولة:</span>
              <strong className="text-emerald-700 text-lg font-mono">
                {formatMoney(totalAcceptedValue, currency)}
              </strong>
            </div>
          </div>

          {/* Items Table */}
          <div className="card-surface table-wrap mb-4" style={{ borderRadius: '12px', border: '1px solid var(--line, #e2e8f0)', overflow: 'hidden' }}>
            <table className="w-full text-sm text-right" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface-sunken, #f8fafc)', borderBottom: '2px solid var(--line, #e2e8f0)' }}>
                <tr>
                  <th className="p-3 font-bold text-ink">اسم الصنف</th>
                  <th className="p-3 font-bold text-ink text-center w-24">الكمية المطلوبة</th>
                  <th className="p-3 font-bold text-ink text-center w-24">الموردة</th>
                  <th className="p-3 font-bold text-ink text-center w-24">المقبولة</th>
                  <th className="p-3 font-bold text-ink text-center w-24">المرفوضة</th>
                  <th className="p-3 font-bold text-ink text-center w-28">سعر الوحدة</th>
                  <th className="p-3 font-bold text-ink">سبب الرفض والملاحظات الفنية</th>
                  <th className="p-3 w-10 text-center no-print">#</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--line, #f1f5f9)' }}>
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateItemRow(row.id, 'name', e.target.value)}
                        placeholder="اسم الصنف والمواصفات..."
                        className="input-compact w-full font-bold"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.requestedQty}
                        onChange={(e) => updateItemRow(row.id, 'requestedQty', Number(e.target.value))}
                        className="input-compact text-center w-20 font-bold"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.suppliedQty}
                        onChange={(e) => updateItemRow(row.id, 'suppliedQty', Number(e.target.value))}
                        className="input-compact text-center w-20 font-bold"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.acceptedQty}
                        onChange={(e) => updateItemRow(row.id, 'acceptedQty', Number(e.target.value))}
                        className="input-compact text-center w-20 font-bold text-emerald-700 bg-emerald-50 border-emerald-300"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.rejectedQty}
                        onChange={(e) => updateItemRow(row.id, 'rejectedQty', Number(e.target.value))}
                        className="input-compact text-center w-20 font-bold text-rose-700"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.unitPrice}
                        onChange={(e) => updateItemRow(row.id, 'unitPrice', Number(e.target.value))}
                        className="input-compact text-center w-24 font-mono font-bold"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.rejectionReason}
                        onChange={(e) => updateItemRow(row.id, 'rejectionReason', e.target.value)}
                        placeholder="سبب الرفض إن وُجد..."
                        className="input-compact w-full text-xs"
                      />
                    </td>
                    <td className="p-2 text-center no-print">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={items.length <= 1}
                        className="text-muted hover:text-bad bg-none border-none cursor-pointer p-1"
                        title="حذف البند"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="p-2 no-print border-t border-line flex justify-end">
              <button
                type="button"
                className="secondary-btn btn-sm inline-flex items-center gap-1 font-xs"
                onClick={addNewRow}
              >
                <Plus size={14} />
                <span>إضافة صنف آخر للفحص</span>
              </button>
            </div>
          </div>

          {/* Committee Form Section */}
          <div className="card-surface p-4 mb-3" style={{ borderRadius: '12px', border: '1px solid var(--line, #e2e8f0)', background: 'var(--surface-sunken, #f8fafc)' }}>
            <div className="flex items-center gap-2 mb-3 font-bold font-sm text-ink">
              <Users size={16} className="text-accent" />
              <span>تشكيل لجنة الفحص والاستلام المعتمدة:</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="font-xs font-semibold text-muted block mb-1">
                  رئيس لجنة الفحص والاستلام
                </label>
                <input
                  type="text"
                  value={committeeHead}
                  onChange={(e) => setCommitteeHead(e.target.value)}
                  className="input-compact w-full"
                />
              </div>

              <div>
                <label className="font-xs font-semibold text-muted block mb-1">
                  العضو الفني المتخصص
                </label>
                <input
                  type="text"
                  value={technicalExpert}
                  onChange={(e) => setTechnicalExpert(e.target.value)}
                  className="input-compact w-full"
                />
              </div>

              <div>
                <label className="font-xs font-semibold text-muted block mb-1">
                  أمين المستودع (المستلم والمطابق)
                </label>
                <input
                  type="text"
                  value={custodianName}
                  onChange={(e) => setCustodianName(e.target.value)}
                  className="input-compact w-full"
                />
              </div>
            </div>

            <div>
              <label className="font-xs font-semibold text-muted block mb-1">
                ملاحظات وتوصيات الفحص النهائية
              </label>
              <textarea
                value={finalNotes}
                onChange={(e) => setFinalNotes(e.target.value)}
                rows={2}
                className="input-compact w-full"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer inspection-modal-footer no-print flex items-center justify-between p-4 border-t border-line">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="primary-btn"
              onClick={handlePrint}
              style={{ backgroundColor: 'var(--accent, #006c67)', color: '#fff' }}
            >
              <Printer size={15} />
              <span>طباعة محضر الفحص والاستلام (A4)</span>
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
            >
              إغلاق
            </button>
          </div>

          <div className="text-muted font-xs">
            مستند رسمي معتمد طبقاً لأحكام لائحة المخازن والمشتريات
          </div>
        </div>
        </div>
        {/* Unified Printable Inspection Document Sheet */}
        <div
          id="printable-technical-inspection"
          className="official-modal-print-document bg-white text-slate-900"
          style={{ color: '#0f172a' }}
        >
          {(settings.logoDataUrl || settings.logoUrl) && (
            <div className="print-watermark" aria-hidden="true">
              <img src={settings.logoDataUrl || settings.logoUrl} alt="" />
            </div>
          )}

          <header className="print-letterhead">
            <div className="print-header-col print-header-right">
              <div className="print-gov-heading">جمهورية مصر العربية</div>
              <div className="print-org-name">{settings.organization || 'جامعة الزقازيق الأهلية'}</div>
              <div className="print-dept-name">{settings.department || 'إدارة المخازن والمشتريات'}</div>
              <div className="print-subdept-name">لجنة الفحص والاستلام الفني والمعاينة</div>
            </div>

            <div className="print-header-col print-header-center">
              {settings.logoDataUrl || settings.logoUrl ? (
                <img
                  src={settings.logoDataUrl || settings.logoUrl}
                  alt="Logo"
                  className="print-official-logo"
                  style={{ maxHeight: '60px', maxWidth: '110px', objectFit: 'contain' }}
                />
              ) : (
                <div className="print-logo-emblem">شعار المؤسسة</div>
              )}
              <div className="print-stamp-title">محضر فحص واستلام رسمي معتمد</div>
            </div>

            <div className="print-header-col print-header-left">
              <div><strong>رقم المحضر:</strong> {inspectionNo}</div>
              <div><strong>تاريخ الفحص:</strong> {inspectionDate}</div>
              <div><strong>أمر التوريد:</strong> {poNumber || '—'}</div>
              <div><strong>رقم الفاتورة:</strong> {invoiceNumber || '—'}</div>
              <div><strong>المستودع:</strong> {targetWh.name}</div>
            </div>
          </header>

          <div className="print-title-banner">
            <h1 className="print-doc-title">محضر فحص واستلام فني للواردات والمهمات المخزنية</h1>
            <div className="print-doc-subtitle">
              إثبات المعاينة والمطابقة الفنية الميدانية طبقاً لأحكام لائحة المخازن والمشتريات
            </div>
          </div>

          <div className="print-summary-strip">
            <div className="print-summary-cell">
              <span className="print-summary-label">المورد / الشركة:</span>
              <strong className="print-summary-val">{supplier}</strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">إجمالي البنود:</span>
              <strong className="print-summary-val">{items.length} صنف</strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">القيمة المقبولة:</span>
              <strong className="print-summary-val accent">{formatMoney(totalAcceptedValue, currency)}</strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">قرار اللجنة:</span>
              <strong className="print-summary-val success">
                {decision === 'accepted' ? 'قبول مطابق' : decision === 'rejected' ? 'مرفوض كلياً' : 'قبول جزئي مشروط'}
              </strong>
            </div>
          </div>

          <table className="print-official-table" style={{ width: '100%', color: '#0f172a' }}>
            <thead>
              <tr>
                <th style={{ width: '35px', textAlign: 'center' }}>م</th>
                <th>اسم ومواصفات الصنف</th>
                <th style={{ width: '65px', textAlign: 'center' }}>المطلوبة</th>
                <th style={{ width: '65px', textAlign: 'center' }}>الموردة</th>
                <th style={{ width: '65px', textAlign: 'center' }}>المقبولة</th>
                <th style={{ width: '65px', textAlign: 'center' }}>المرفوضة</th>
                <th style={{ width: '85px', textAlign: 'center' }}>سعر الوحدة</th>
                <th style={{ width: '95px', textAlign: 'center' }}>الإجمالي المقبول</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '12px', textAlign: 'center', color: '#64748b' }}>
                    لا توجد أصناف مدرجة في محضر الفحص.
                  </td>
                </tr>
              ) : (
                items.map((r, idx) => (
                  <tr key={r.id}>
                    <td style={{ textAlign: 'center', color: '#0f172a' }}>{idx + 1}</td>
                    <td style={{ textAlign: 'start', color: '#0f172a', fontWeight: 700 }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{r.name || '—'}</div>
                      {r.rejectionReason && (
                        <div style={{ fontSize: '7pt', color: '#b91c1c', marginTop: '2px' }}>سبب الرفض: {r.rejectionReason}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a' }}>{r.requestedQty ?? 0}</td>
                    <td style={{ textAlign: 'center', color: '#0f172a' }}>{r.suppliedQty ?? 0}</td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontWeight: 700 }}>{r.acceptedQty ?? 0}</td>
                    <td style={{ textAlign: 'center', color: '#0f172a' }}>{r.rejectedQty ?? 0}</td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontFamily: 'monospace' }}>
                      {formatMoney(r.unitPrice, currency)}
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontFamily: 'monospace', fontWeight: 700 }}>
                      {formatMoney((r.acceptedQty || 0) * (r.unitPrice || 0), currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {finalNotes && (
            <div style={{ fontSize: '7.5pt', marginBottom: '8px', padding: '6px 8px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
              <strong>توصيات وملاحظات اللجنة:</strong> {finalNotes}
            </div>
          )}

          {/* Unified Signatures Block (Image 3: Anchored at end of last page) */}
          <div className="print-signatures-section">
            <div className="print-signatures-notice">
              * يُقر الموقعون أدناه بأنهم أجروا المعاينة والفحص الفني الظاهري والدقيق لكافة المهمات والأصناف الموضحة أعلاه وفقاً للمواصفات واللوائح.
            </div>
            <div className="print-signatures-grid">
              <div className="print-signature-box">
                <strong className="print-sig-role">رئيس لجنة الفحص</strong>
                <div className="print-sig-field">الاسم: {committeeHead || '....................'}</div>
                <div className="print-sig-field">التوقيع: ..................</div>
              </div>

              <div className="print-signature-box">
                <strong className="print-sig-role">العضو الفني المتخصص</strong>
                <div className="print-sig-field">الاسم: {technicalExpert || '....................'}</div>
                <div className="print-sig-field">التوقيع: ..................</div>
              </div>

              <div className="print-signature-box">
                <strong className="print-sig-role">أمين المستودع المستلم</strong>
                <div className="print-sig-field">الاسم: {custodianName || '....................'}</div>
                <div className="print-sig-field">التوقيع: ..................</div>
              </div>

              <div className="print-signature-box print-seal-box">
                <strong className="print-sig-role">يعتمد: رئيس الجهة</strong>
                <div className="print-sig-field">الاعتماد: ..................</div>
                <div className="print-seal-area">
                  <span className="print-seal-hint">(خاتم شعار المؤسسة)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </AccessibleDialog>
  )
}
