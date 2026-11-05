import { canAddDepartment } from '../lib/permissions'
import { getAccessSession } from '../lib/accessContext'
import { useState, useMemo, useEffect } from 'react'
import {
  X,
  Printer,
  FileSpreadsheet,
  Save,
  Calculator,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Warehouse,
  Users,
} from 'lucide-react'
import { WAREHOUSES, type CustodyItem } from '../lib/custody'
import { getCairoDateString } from '../lib/dateUtils'
import type { AppSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { logAuditEvent } from '../lib/auditLogger'
import { AccessibleDialog } from './AccessibleDialog'

interface InventorySettlementModalProps {
  allItems: CustodyItem[]
  settings: AppSettings
  defaultWarehouseId?: string
  currency: AppSettings['currency']
  onClose: () => void
  onSaveSettlement?: (settlementData: SettlementRecord) => Promise<void> | void
}

export interface SettlementRecord {
  id: string
  warehouseId: string
  warehouseName: string
  settlementDate: string
  committeeHead: string
  custodian: string
  financialAuditor: string
  totalMatched: number
  totalDeficit: number
  totalSurplus: number
  totalDeficitValue: number
  totalSurplusValue: number
  items: Array<{
    code: string
    name: string
    bookQty: number
    actualQty: number
    diffQty: number
    diffValue: number
  }>
}

function formatMoney(amount: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return `'${value}` as unknown as T
  }
  return value
}

export const InventorySettlementModal: React.FC<InventorySettlementModalProps> = ({
  allItems,
  settings,
  defaultWarehouseId = 'main',
  currency,
  onClose,
  onSaveSettlement,
}) => {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(defaultWarehouseId)

  // Committee members state
  const [committeeHead, setCommitteeHead] = useState('أ.د. رئيس لجنة الجرد السنوي')
  const [custodianName, setCustodianName] = useState('أمين المستودع المختص')
  const [financialAuditor, setFinancialAuditor] = useState('المراقب المالي وعضو الجرد')

  // Feedback banner state
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)

  // Items for the selected warehouse
  const warehouseItems = useMemo(() => {
    return allItems.filter((it) => it.warehouseId === selectedWarehouseId)
  }, [allItems, selectedWarehouseId])

  // Map of actual counted quantities keyed by itemId (default = item.quantity)
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({})

  // Current warehouse info
  const currentWarehouse = useMemo(() => {
    return WAREHOUSES.find((w) => w.id === selectedWarehouseId) || WAREHOUSES[0]
  }, [selectedWarehouseId])

  // Handle actual quantity change for a row
  function handleActualQtyChange(itemId: string, valStr: string) {
    const parsed = parseFloat(valStr)
    const valid = isNaN(parsed) ? 0 : Math.max(0, parsed)
    setActualQuantities((prev) => ({
      ...prev,
      [itemId]: valid,
    }))
  }

  // Calculate row metrics
  const calculatedRows = useMemo(() => {
    return warehouseItems.map((item) => {
      const actualQty = actualQuantities[item.id] !== undefined ? actualQuantities[item.id] : item.quantity
      const diffQty = actualQty - item.quantity
      const unitVal = item.unitPrice && item.unitPrice > 0
        ? item.unitPrice
        : (item.quantity > 0 ? item.value / item.quantity : item.value)
      const diffValue = diffQty * unitVal

      return {
        item,
        actualQty,
        diffQty,
        unitVal,
        diffValue,
      }
    })
  }, [warehouseItems, actualQuantities])

  // Summary KPIs
  const summary = useMemo(() => {
    let matchedCount = 0
    let deficitCount = 0
    let surplusCount = 0
    let totalDeficitVal = 0
    let totalSurplusVal = 0

    for (const row of calculatedRows) {
      if (row.diffQty === 0) {
        matchedCount++
      } else if (row.diffQty < 0) {
        deficitCount++
        totalDeficitVal += Math.abs(row.diffValue)
      } else {
        surplusCount++
        totalSurplusVal += row.diffValue
      }
    }

    return {
      totalItems: warehouseItems.length,
      matchedCount,
      deficitCount,
      surplusCount,
      totalDeficitVal,
      totalSurplusVal,
    }
  }, [calculatedRows, warehouseItems.length])

  useEffect(() => {
    function handleAfterPrint() {
      document.body.classList.remove('printing-inventory-settlement')
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  // Print function
  function handlePrintSettlement() {
    document.body.classList.add('printing-inventory-settlement')
    setTimeout(() => {
      window.print()
    }, 50)
  }

  // Excel export
  async function handleExportExcel() {
    const XLSX = await import('xlsx')
    const rows = calculatedRows.map((r, idx) => ({
      'م': idx + 1,
      'كود الأصل': sanitizeExcelCell(r.item.code),
      'اسم الصنف': sanitizeExcelCell(r.item.name),
      'الموقع / الغرفة': sanitizeExcelCell(r.item.roomLocation || '—'),
      'الرصيد الدفتري': r.item.quantity,
      'الرصيد الفعلي المجزود': r.actualQty,
      'الفارق الجردي': r.diffQty === 0 ? 'مطابق (0)' : r.diffQty < 0 ? `عجز (${r.diffQty})` : `زيادة (+${r.diffQty})`,
      'سعر الوحدة': r.unitVal,
      'القيمة المالية للفارق': r.diffValue,
      'أمين العهدة': sanitizeExcelCell(r.item.custodian || '—'),
    }))

    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'محضر التسوية والمطابقة الجردية')
    XLSX.writeFile(
      workbook,
      `محضر-تسوية-${currentWarehouse.shortName}-${getCairoDateString()}.xlsx`
    )
  }

  // Save to database
  async function handleSave() {
    if (!canAddDepartment(getAccessSession(), 'warehouse')) return
    setIsSaving(true)
    setSaveStatus('')

    const settlementData: SettlementRecord = {
      id: `STL-${Date.now()}`,
      warehouseId: selectedWarehouseId,
      warehouseName: currentWarehouse.name,
      settlementDate: new Date().toISOString(),
      committeeHead,
      custodian: custodianName,
      financialAuditor,
      totalMatched: summary.matchedCount,
      totalDeficit: summary.deficitCount,
      totalSurplus: summary.surplusCount,
      totalDeficitValue: summary.totalDeficitVal,
      totalSurplusValue: summary.totalSurplusVal,
      items: calculatedRows.map((r) => ({
        code: r.item.code,
        name: r.item.name,
        bookQty: r.item.quantity,
        actualQty: r.actualQty,
        diffQty: r.diffQty,
        diffValue: r.diffValue,
      })),
    }

    try {
      if (onSaveSettlement) {
        await onSaveSettlement(settlementData)
      } else {
        if (supabase) {
          try {
            await supabase.from('inventory_settlements').insert([
              {
                settlement_number: settlementData.id,
                warehouse_id: settlementData.warehouseId,
                warehouse_name: settlementData.warehouseName,
                settlement_date: settlementData.settlementDate,
                committee_head: settlementData.committeeHead,
                custodian: settlementData.custodian,
                financial_auditor: settlementData.financialAuditor,
                total_matched: settlementData.totalMatched,
                total_deficit: settlementData.totalDeficit,
                total_surplus: settlementData.totalSurplus,
                total_deficit_value: settlementData.totalDeficitValue,
                total_surplus_value: settlementData.totalSurplusValue,
                items: settlementData.items,
              },
            ])
          } catch (e) {
            console.warn('Supabase settlement insert failed, falling back to local storage:', e)
          }
        }

        // حفظ في التخزين المحلي كـ fallback
        const storageKey = 'warehouse_settlement_history'
        const existing = JSON.parse(localStorage.getItem(storageKey) || '[]')
        existing.unshift(settlementData)
        localStorage.setItem(storageKey, JSON.stringify(existing.slice(0, 50)))
      }

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('inventory-settlements-changed'))
        }
      } catch {
        // ignore
      }

      // تسجيل العملية في سجل العمليات والتدقيق بالداتابيز
      void logAuditEvent({
        action: `توثيق محضر تسوية جردية للمخزن (${settlementData.warehouseName})`,
        entity_type: 'inventory_settlement',
        entity_id: settlementData.id,
        details: {
          warehouse: settlementData.warehouseName,
          matched: settlementData.totalMatched,
          deficit: settlementData.totalDeficit,
          surplus: settlementData.totalSurplus,
        },
      })

      setSaveStatus('تم حفظ وتوثيق محضر التسوية الجردية بنجاح في قاعدة البيانات.')
      setTimeout(() => setSaveStatus(''), 4000)
    } catch {
      setSaveStatus('حدث خطأ أثناء حفظ محضر التسوية.')
    } finally {
      setIsSaving(false)
    }
  }

  const isDirty = Object.keys(actualQuantities).length > 0
  function handleSafeClose() {
    if (isSaving) return
    if (isDirty && !window.confirm('هل أنت متأكد من إغلاق نافذة التسوية وتجاهل التعديلات غير المحفوظة؟')) {
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

  const todayArabic = new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())

  const logoUrl = settings.logoDataUrl || settings.logoUrl

  return (
    <AccessibleDialog
      isOpen={true}
      onClose={handleSafeClose}
      titleId="settlement-modal-title"
      dialogClassName="modal-dialog settlement-modal-dialog"
      dialogStyle={{ maxWidth: '1100px', width: '96vw' }}
      closeOnBackdropClick={!isSaving}
      closeOnEscape={!isSaving}
    >
        {/* Top Header */}
        <div className="modal-header settlement-modal-header no-print">
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
              onClick={handlePrintSettlement}
              title="طباعة محضر التسوية على ورق A4 معتمد"
            >
              <Printer size={15} />
              <span>طباعة المحضر (A4)</span>
            </button>

            <button
              type="button"
              className="secondary-btn btn-sm"
              onClick={handleExportExcel}
              title="تصدير كشف التسوية إلى Excel"
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
              title="حفظ بيانات المحضر في قاعدة البيانات"
            >
              <Save size={15} />
              <span>{isSaving ? 'جارٍ الحفظ...' : 'حفظ بالقاعدة'}</span>
            </button>
          </div>

          <div className="text-end">
            <div className="flex items-center justify-end gap-2">
              <h2 id="settlement-modal-title" className="m-0 text-lg font-bold text-ink">
                محضر التسوية الجردية والمطابقة الفعلية للمخزون
              </h2>
              <div className="modal-title-icon" style={{ background: 'var(--accent-tint, #e0f2f1)', color: 'var(--accent, #006c67)' }}>
                <Calculator size={20} />
              </div>
            </div>
            <span className="text-muted font-xs block mt-0.5">
              {settings.organization || 'جامعة الزقازيق الأهلية'} • مطابقة الرصيد الفعلي بالدفتري واحتساب الفوارق الجردية
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

        {/* Modal Scrollable Body */}
        <div className="modal-body-scroll p-4" style={{ overflowY: 'auto', maxHeight: 'calc(88vh - 120px)' }}>
          {/* Interactive Screen Editor Form (Hidden in Print) */}
          <div className="settlement-editor-screen no-print">
            {/* Warehouse Selector Strip */}
          <div className="card-surface p-3 mb-4 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--surface-sunken, #f8fafc)', border: '1px solid var(--line, #e2e8f0)', borderRadius: '12px' }}>
            <span className="font-xs font-semibold text-muted">
              إجمالي الأصناف بالمخزن: <strong>{warehouseItems.length}</strong> صنف
            </span>

            <div className="flex items-center gap-2">
              <label className="font-sm font-bold text-ink flex items-center gap-2">
                <Warehouse size={16} className="text-accent" />
                <span>المخزن المراد تسويته:</span>
              </label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => {
                  setSelectedWarehouseId(e.target.value)
                  setActualQuantities({})
                }}
                className="input-compact font-bold"
                style={{ minWidth: '180px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--line, #cbd5e1)' }}
              >
                {WAREHOUSES.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 3 KPI Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {/* 1. Matched Items Card */}
            <div className="card-surface p-4 flex items-center justify-between" style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: '14px' }}>
              <div className="text-start">
                <div className="flex items-center gap-1.5 font-sm font-semibold text-emerald-800">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  <span>الأصناف المطابقة تماماً</span>
                </div>
                <div className="text-2xl font-black text-emerald-700 mt-1">
                  {summary.matchedCount}
                </div>
                <small className="text-emerald-600 font-xs">لا توجد أي فوارق دفترياً</small>
              </div>
            </div>

            {/* 2. Deficit Items Card */}
            <div className="card-surface p-4 flex items-center justify-between" style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '14px' }}>
              <div className="text-start">
                <div className="flex items-center gap-1.5 font-sm font-semibold text-rose-800">
                  <TrendingDown size={16} className="text-rose-600" />
                  <span>أصناف بها عجز (نقص)</span>
                </div>
                <div className="text-2xl font-black text-rose-700 mt-1">
                  {summary.deficitCount} <small className="text-sm font-normal">أصناف</small>
                </div>
                <small className="text-rose-600 font-xs font-semibold">
                  {summary.totalDeficitVal > 0
                    ? `إجمالي قيمة العجز: ${formatMoney(summary.totalDeficitVal, currency)}`
                    : 'إجمالي قيمة العجز: — ج.م.'}
                </small>
              </div>
            </div>

            {/* 3. Surplus Items Card */}
            <div className="card-surface p-4 flex items-center justify-between" style={{ border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: '14px' }}>
              <div className="text-start">
                <div className="flex items-center gap-1.5 font-sm font-semibold text-sky-800">
                  <TrendingUp size={16} className="text-sky-600" />
                  <span>أصناف بها زيادة (فائض)</span>
                </div>
                <div className="text-2xl font-black text-sky-700 mt-1">
                  {summary.surplusCount} <small className="text-sm font-normal">أصناف</small>
                </div>
                <small className="text-sky-600 font-xs font-semibold">
                  {summary.totalSurplusVal > 0
                    ? `إجمالي قيمة الزيادة: ${formatMoney(summary.totalSurplusVal, currency)}`
                    : 'إجمالي قيمة الزيادة: — ج.م.'}
                </small>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card-surface table-wrap mb-4" style={{ borderRadius: '12px', border: '1px solid var(--line, #e2e8f0)', overflow: 'hidden' }}>
            <table className="w-full text-sm text-right" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface-sunken, #f8fafc)', borderBottom: '2px solid var(--line, #e2e8f0)' }}>
                <tr>
                  <th className="p-3 font-bold text-ink">كود الأصل</th>
                  <th className="p-3 font-bold text-ink">اسم الصنف وبياناته</th>
                  <th className="p-3 font-bold text-ink">الموقع / الغرفة</th>
                  <th className="p-3 font-bold text-ink text-center">الرصيد الدفتري</th>
                  <th className="p-3 font-bold text-ink text-center" style={{ minWidth: '120px' }}>
                    الرصيد الفعلي المجزود
                  </th>
                  <th className="p-3 font-bold text-ink text-center">الفارق الجردي</th>
                  <th className="p-3 font-bold text-ink text-center">القيمة المالية للفارق</th>
                </tr>
              </thead>
              <tbody>
                {calculatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted">
                      لا توجد أصناف مقيدة في مستودع «{currentWarehouse.name}».
                    </td>
                  </tr>
                ) : (
                  calculatedRows.map(({ item, actualQty, diffQty, diffValue }) => (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid var(--line, #f1f5f9)',
                        background: diffQty < 0 ? '#fff5f5' : diffQty > 0 ? '#f0fdf4' : 'transparent',
                      }}
                    >
                      <td className="p-3 font-mono font-bold text-ink">{item.code}</td>
                      <td className="p-3">
                        <div className="font-bold text-ink">{item.name}</div>
                        <small className="text-muted block font-xs">
                          عهدة: {item.custodian || 'أمين المستودع'} • {item.category}
                        </small>
                      </td>
                      <td className="p-3 text-muted">{item.roomLocation || '—'}</td>
                      <td className="p-3 text-center font-bold font-mono">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={actualQty}
                          onChange={(e) => handleActualQtyChange(item.id, e.target.value)}
                          className="input-compact font-bold text-center w-24"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: diffQty !== 0 ? '2px solid #ef4444' : '1px solid #cbd5e1',
                          }}
                        />
                      </td>
                      <td className="p-3 text-center">
                        {diffQty === 0 ? (
                          <span className="badge ok font-xs font-semibold inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> مطابق (0)
                          </span>
                        ) : diffQty < 0 ? (
                          <span className="badge bad font-xs font-bold inline-flex items-center gap-1">
                            <TrendingDown size={12} /> عجز ({diffQty})
                          </span>
                        ) : (
                          <span className="badge info font-xs font-bold inline-flex items-center gap-1">
                            <TrendingUp size={12} /> زيادة (+{diffQty})
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono font-semibold">
                        {diffQty === 0 ? '—' : formatMoney(diffValue, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Committee Section */}
          <div className="card-surface p-4 mb-4" style={{ borderRadius: '12px', border: '1px solid var(--line, #e2e8f0)', background: 'var(--surface-sunken, #f8fafc)' }}>
            <div className="flex items-center gap-2 mb-3 font-bold font-sm text-ink">
              <Users size={16} className="text-accent" />
              <span>أعضاء لجنة الجرد والمطابقة المخزنية (لإدراجهم في المحضر المطبوع)</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="font-xs font-semibold text-muted block mb-1">
                  رئيس لجنة الجرد
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
                  أمين المستودع / المختص
                </label>
                <input
                  type="text"
                  value={custodianName}
                  onChange={(e) => setCustodianName(e.target.value)}
                  className="input-compact w-full"
                />
              </div>

              <div>
                <label className="font-xs font-semibold text-muted block mb-1">
                  المراقب المالي
                </label>
                <input
                  type="text"
                  value={financialAuditor}
                  onChange={(e) => setFinancialAuditor(e.target.value)}
                  className="input-compact w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer settlement-modal-footer no-print flex items-center justify-between p-4 border-t border-line">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="primary-btn"
              onClick={handlePrintSettlement}
              style={{ backgroundColor: 'var(--accent, #006c67)', color: '#fff' }}
            >
              <Printer size={15} />
              <span>طباعة محضر التسوية المعتمد</span>
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
            تاريخ التحرير: {todayArabic} • محضر رسمي معتمد لخاتم الجامعة
          </div>
        </div>
        </div>

        {/* Unified Printable Inventory Settlement Document Sheet */}
        <div
          id="printable-inventory-settlement"
          className="official-modal-print-document bg-white text-slate-900"
          style={{ color: '#0f172a' }}
        >
          {logoUrl && (
            <div className="print-watermark" aria-hidden="true">
              <img src={logoUrl} alt="" />
            </div>
          )}

          <header className="print-letterhead">
            <div className="print-header-col print-header-right">
              <div className="print-gov-heading">جمهورية مصر العربية</div>
              <div className="print-org-name">{settings.organization || 'جامعة الزقازيق الأهلية'}</div>
              <div className="print-dept-name">{settings.department || 'إدارة المخازن والمشتريات'}</div>
              <div className="print-subdept-name">لجنة الجرد والمطابقة وحصر الفروقات المخزنية</div>
            </div>

            <div className="print-header-col print-header-center">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="print-official-logo"
                  style={{ maxHeight: '60px', maxWidth: '110px', objectFit: 'contain' }}
                />
              ) : (
                <div className="print-logo-emblem">شعار المؤسسة</div>
              )}
              <div className="print-stamp-title">محضر تسوية جردية معتمد</div>
            </div>

            <div className="print-header-col print-header-left">
              <div><strong>المستودع:</strong> {currentWarehouse.name}</div>
              <div><strong>الموقع:</strong> {currentWarehouse.building}</div>
              <div><strong>تاريخ التحرير:</strong> {todayArabic}</div>
              <div><strong>رقم المحضر:</strong> STL-{currentWarehouse.id.toUpperCase()}-{new Date().getFullYear()}</div>
            </div>
          </header>

          <div className="print-title-banner">
            <h1 className="print-doc-title">محضر تسوية وجرد الفروقات المخزنية وحصر العجز والزيادة</h1>
            <div className="print-doc-subtitle">
              إثبات نتائج المطابقة الفعلية بين الأرصدة الدفترية والمجودة على الطبيعة طبقاً للائحة المخازن
            </div>
          </div>

          <div className="print-summary-strip">
            <div className="print-summary-cell">
              <span className="print-summary-label">إجمالي بنود الجرد:</span>
              <strong className="print-summary-val">{summary.totalItems} صنف</strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">الأصناف المطابقة:</span>
              <strong className="print-summary-val success">{summary.matchedCount} صنف</strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">أصناف العجز:</span>
              <strong className="print-summary-val" style={{ color: '#b91c1c' }}>
                {summary.deficitCount} صنف ({formatMoney(summary.totalDeficitVal, currency)})
              </strong>
            </div>
            <div className="print-summary-cell">
              <span className="print-summary-label">أصناف الزيادة:</span>
              <strong className="print-summary-val" style={{ color: '#1d4ed8' }}>
                {summary.surplusCount} صنف ({formatMoney(summary.totalSurplusVal, currency)})
              </strong>
            </div>
          </div>

          <table className="print-official-table" style={{ width: '100%', color: '#0f172a' }}>
            <thead>
              <tr>
                <th style={{ width: '35px', textAlign: 'center' }}>م</th>
                <th style={{ width: '80px', textAlign: 'center' }}>كود الأصل</th>
                <th>اسم الصنف والمواصفات</th>
                <th style={{ width: '130px' }}>أمين العهدة / المكان</th>
                <th style={{ width: '65px', textAlign: 'center' }}>الدفتري</th>
                <th style={{ width: '65px', textAlign: 'center' }}>الفعلي</th>
                <th style={{ width: '85px', textAlign: 'center' }}>الفارق الجردي</th>
                <th style={{ width: '90px', textAlign: 'center' }}>قيمة الفارق</th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="print-empty-row" style={{ padding: '12px', textAlign: 'center', color: '#64748b' }}>
                    لا توجد أصناف مقيدة في هذا المستودع.
                  </td>
                </tr>
              ) : (
                calculatedRows.map((r, idx) => (
                  <tr key={r.item.id}>
                    <td style={{ textAlign: 'center', color: '#0f172a' }}>{idx + 1}</td>
                    <td className="print-code-cell" style={{ textAlign: 'center', color: '#0f172a', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.item.code || '—'}
                    </td>
                    <td style={{ textAlign: 'start', color: '#0f172a' }}>
                      <div className="print-item-name" style={{ fontWeight: 700, color: '#0f172a' }}>{r.item.name || '—'}</div>
                      {r.item.serialNumber && (
                        <div className="print-item-serial" style={{ fontSize: '7pt', color: '#475569', marginTop: '1px' }}>S/N: {r.item.serialNumber}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'start', color: '#0f172a' }}>
                      <div className="print-custodian-name" style={{ fontWeight: 700, color: '#0f172a' }}>{r.item.custodian || 'أمين المستودع'}</div>
                      <div className="print-location-sub" style={{ fontSize: '7pt', color: '#64748b', marginTop: '1px' }}>{r.item.roomLocation || currentWarehouse.building}</div>
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontWeight: 700 }}>
                      {r.item.quantity ?? 0} {r.item.unit || 'قطعة'}
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontWeight: 700 }}>
                      {r.actualQty ?? 0} {r.item.unit || 'قطعة'}
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontWeight: 700 }}>
                      {r.diffQty === 0
                        ? 'مطابق (0)'
                        : r.diffQty < 0
                        ? `عجز (${r.diffQty})`
                        : `زيادة (+${r.diffQty})`}
                    </td>
                    <td style={{ textAlign: 'center', color: '#0f172a', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.diffQty === 0 ? '—' : formatMoney(Math.abs(r.diffValue), currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Unified Signatures Block (Anchored at end of last page) */}
          <div className="print-signatures-section">
            <div className="print-signatures-notice">
              * يُقر الموقعون أدناه بصحة البيانات والمطابقة الفعلية لجرد العهدة والأصول على الطبيعة وحصر الفروقات وفقاً للوائح والقوانين المخزنية.
            </div>
            <div className="print-signatures-grid">
              <div className="print-signature-box">
                <strong className="print-sig-role">رئيس لجنة الجرد والمطابقة</strong>
                <div className="print-sig-field">الاسم: {committeeHead || '....................'}</div>
                <div className="print-sig-field">التوقيع: ..................</div>
              </div>

              <div className="print-signature-box">
                <strong className="print-sig-role">عضو لجنة الجرد والمراقب المالي</strong>
                <div className="print-sig-field">الاسم: {financialAuditor || '....................'}</div>
                <div className="print-sig-field">التوقيع: ..................</div>
              </div>

              <div className="print-signature-box">
                <strong className="print-sig-role">أمين المستودع المختص</strong>
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
