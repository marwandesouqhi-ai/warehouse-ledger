import React, { useMemo, useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  X,
  Printer,
  FileSpreadsheet,
  Warehouse,
} from 'lucide-react'
import {
  type CustodyItem,
  type WarehouseDefinition,
  exportCustodyToExcel,
  getWarehouseStats,
} from '../lib/custody'
import type { AppSettings } from '../lib/settings'

interface OfficialInventoryReportModalProps {
  warehouse: WarehouseDefinition
  items: CustodyItem[]
  settings: AppSettings
  currency: AppSettings['currency']
  onClose: () => void
}

function formatMoney(amount: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

export const OfficialInventoryReportModal: React.FC<OfficialInventoryReportModalProps> = ({
  warehouse,
  items,
  settings,
  currency,
  onClose,
}) => {
  const shouldReduceMotion = useReducedMotion()

  const whItems = useMemo(() => {
    return items.filter((i) => i.warehouseId === warehouse.id)
  }, [items, warehouse.id])

  const stats = useMemo(() => {
    return getWarehouseStats(whItems)
  }, [whItems])

  useEffect(() => {
    function handleAfterPrint() {
      document.body.classList.remove('printing-official-inventory')
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  function handlePrint() {
    document.body.classList.add('printing-official-inventory')
    setTimeout(() => {
      window.print()
    }, 50)
  }

  const logoUrl = settings.logoDataUrl || settings.logoUrl

  const todayArabic = new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
    >
      <motion.div
        className="modal-dialog official-inventory-modal-dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        style={{ maxWidth: '1020px', width: '96vw' }}
      >
        {/* Top Header Controls (Hidden in Print) */}
        <div className="modal-header no-print flex items-center justify-between p-4 border-b border-line bg-surface">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="إغلاق"
            >
              <X size={18} />
            </button>

            <button
              type="button"
              className="primary-btn btn-sm"
              onClick={handlePrint}
              style={{ backgroundColor: 'var(--accent, #006c67)', color: '#fff' }}
            >
              <Printer size={15} />
              <span>طباعة المحضر فوراً (A4)</span>
            </button>

            <button
              type="button"
              className="secondary-btn btn-sm"
              onClick={() => void exportCustodyToExcel(warehouse.name, whItems, currency)}
            >
              <FileSpreadsheet size={15} />
              <span>تصدير Excel</span>
            </button>
          </div>

          <div className="text-end">
            <h2 className="m-0 text-lg font-bold text-ink">
              معاينة محضر كشف حصر وجرد العهدة ({warehouse.name})
            </h2>
            <span className="text-muted font-xs block">
              نموذج معتمد رسمياً ببيانات الجامعة وأعضاء لجنة الجرد وخاتم الاعتماد
            </span>
          </div>
        </div>

        {/* Scrollable Document Preview Body */}
        <div className="modal-body-scroll p-6 bg-slate-50 dark:bg-slate-900/40" style={{ overflowY: 'auto', maxHeight: 'calc(88vh - 120px)' }}>
          <div
            id="printable-official-inventory"
            className="card-surface official-print-card-surface p-8 max-w-4xl mx-auto shadow-md rounded-xl bg-white text-slate-900 relative"
            style={{ color: '#0f172a' }}
          >
            {/* Watermark: centered on every page in print */}
            {logoUrl && (
              <div className="print-watermark" aria-hidden="true">
                <img src={logoUrl} alt="" />
              </div>
            )}

            {/* Official Letterhead */}
            <header className="print-letterhead flex items-start justify-between border-b pb-4 mb-4 gap-4">
              <div className="print-header-col print-header-right text-right">
                <div className="print-gov-heading font-bold text-sm text-ink">جمهورية مصر العربية</div>
                <div className="print-org-name font-bold text-base text-accent">{settings.organization || 'جامعة الزقازيق الأهلية'}</div>
                <div className="print-dept-name font-sm text-ink">{settings.department || 'إدارة المخازن والمشتريات'}</div>
                <div className="print-subdept-name font-xs text-muted">قسم مراقبة وتوثيق العهد والأصول المستديمة</div>
              </div>

              <div className="print-header-col print-header-center text-center">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="print-official-logo mx-auto" style={{ maxHeight: '64px', maxWidth: '120px', objectFit: 'contain' }} />
                ) : (
                  <div className="p-3 rounded-full bg-slate-100 text-muted inline-block">
                    <Warehouse size={32} />
                  </div>
                )}
                <div className="print-stamp-title text-xs font-bold text-accent mt-1">كشف جرد رسمي معتمد</div>
              </div>

              <div className="print-header-col print-header-left text-left font-xs">
                <div><strong>المستودع:</strong> {warehouse.name}</div>
                <div><strong>الموقع:</strong> {warehouse.building}</div>
                <div><strong>تاريخ الجرد:</strong> {todayArabic}</div>
                <div><strong>الرقم المرجعي:</strong> INV-{warehouse.id.toUpperCase()}-2026</div>
              </div>
            </header>

            {/* Document Title Banner */}
            <div className="print-title-banner text-center py-3 bg-slate-50 rounded-lg mb-4 border border-line">
              <h1 className="print-doc-title text-xl font-black text-ink m-0">محضر جرد وإثبات العهدة والأصول المستديمة</h1>
              <div className="print-doc-subtitle text-xs text-muted mt-1">
                طبقاً للائحة المخازن والمشتريات وقواعد حصر وتدقيق الأصول التخصصية
              </div>
            </div>

            {/* Summary KPI Strip */}
            <div className="print-summary-strip grid grid-cols-2 md:grid-cols-4 gap-2 text-center p-3 bg-slate-100/70 rounded-lg mb-4 font-xs border border-line">
              <div className="print-summary-cell">
                <span className="print-summary-label text-muted block">إجمالي بنود العهدة:</span>
                <strong className="print-summary-val text-sm font-bold text-ink">{whItems.length} صنف</strong>
              </div>
              <div className="print-summary-cell">
                <span className="print-summary-label text-muted block">إجمالي الوحدات:</span>
                <strong className="print-summary-val text-sm font-bold text-ink">{stats.totalUnits} جهاز / وحدة</strong>
              </div>
              <div className="print-summary-cell">
                <span className="print-summary-label text-muted block">القيمة الدفترية:</span>
                <strong className="print-summary-val accent text-sm font-bold text-accent">{formatMoney(stats.totalValue, currency)}</strong>
              </div>
              <div className="print-summary-cell">
                <span className="print-summary-label text-muted block">نسبة الجاهزية:</span>
                <strong className="print-summary-val success text-sm font-bold text-emerald-700">{stats.healthyRatio}% صالحة</strong>
              </div>
            </div>

            {/* Main Items Table */}
            <table className="print-official-table w-full text-xs text-right mb-6" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="bg-slate-100 border-b border-line">
                  <th className="p-2 text-center w-8">م</th>
                  <th className="p-2 font-bold w-24">كود العهدة</th>
                  <th className="p-2 font-bold">اسم الصنف والمواصفات</th>
                  <th className="p-2 font-bold w-28">أمين العهدة / المكان</th>
                  <th className="p-2 font-bold text-center w-16">الكمية</th>
                  <th className="p-2 font-bold text-center w-24">القيمة الدفترية</th>
                  <th className="p-2 font-bold text-center w-20">الحالة الفنية</th>
                </tr>
              </thead>
              <tbody>
                {whItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted">
                      لا توجد أصناف مقيدة في هذا المخزن حالياً.
                    </td>
                  </tr>
                ) : (
                  whItems.map((item, idx) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="p-2 text-center text-muted">{idx + 1}</td>
                      <td className="p-2 font-mono font-bold text-ink">{item.code}</td>
                      <td className="p-2">
                        <div className="font-bold text-ink">{item.name}</div>
                        {item.serialNumber && (
                          <div className="text-muted font-mono font-xs">S/N: {item.serialNumber}</div>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="font-semibold text-ink">{item.custodian}</div>
                        <small className="text-muted block">{item.roomLocation}</small>
                      </td>
                      <td className="p-2 text-center font-bold">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="p-2 text-center font-mono font-semibold">
                        {formatMoney(item.value, currency)}
                      </td>
                      <td className="p-2 text-center">
                        <span className={`badge ${item.condition === 'excellent' || item.condition === 'good' ? 'ok' : 'warn'}`}>
                          {item.condition === 'excellent' && 'ممتازة'}
                          {item.condition === 'good' && 'جيدة'}
                          {item.condition === 'maintenance' && 'صيانة'}
                          {item.condition === 'damaged' && 'كهنة'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Official Signatures Grid (Image 3: Anchored at end of last page) */}
            <div className="print-signatures-section border-t pt-4 mt-6">
              <div className="print-signatures-notice text-xs text-muted text-center mb-4">
                * يُقر الموقعون أدناه بصحة البيانات والمطابقة الفعلية لجرد العهدة والأصول على الطبيعة وفقاً للوائح والقوانين المخزنية.
              </div>
              <div className="print-signatures-grid grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-xs">
                <div className="print-signature-box p-3 border border-line rounded-lg">
                  <strong className="print-sig-role block mb-6 text-ink">أمين العهدة المسؤول</strong>
                  <div className="print-sig-field text-muted">الاسم: ....................</div>
                  <div className="print-sig-field text-muted mt-1">التوقيع: ..................</div>
                </div>

                <div className="print-signature-box p-3 border border-line rounded-lg">
                  <strong className="print-sig-role block mb-6 text-ink">عضو لجنة الجرد والفحص</strong>
                  <div className="print-sig-field text-muted">الاسم: ....................</div>
                  <div className="print-sig-field text-muted mt-1">التوقيع: ..................</div>
                </div>

                <div className="print-signature-box p-3 border border-line rounded-lg">
                  <strong className="print-sig-role block mb-6 text-ink">مدير إدارة المخازن</strong>
                  <div className="print-sig-field text-muted">الاسم: ....................</div>
                  <div className="print-sig-field text-muted mt-1">التوقيع: ..................</div>
                </div>

                <div className="print-signature-box print-seal-box p-3 border border-line rounded-lg bg-slate-50">
                  <strong className="print-sig-role block mb-4 text-ink">يعتمد: رئيس الجهة</strong>
                  <div className="print-sig-field text-muted">الاعتماد: ..................</div>
                  <div className="print-seal-area mt-2">
                    <span className="print-seal-hint text-xs font-semibold">(خاتم شعار المؤسسة)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer no-print flex items-center justify-between p-4 border-t border-line">
          <button
            type="button"
            className="secondary-btn"
            onClick={onClose}
          >
            إغلاق
          </button>

          <button
            type="button"
            className="primary-btn"
            onClick={handlePrint}
            style={{ backgroundColor: 'var(--accent, #006c67)', color: '#fff' }}
          >
            <Printer size={15} />
            <span>طباعة المحضر (A4 معتمد)</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
