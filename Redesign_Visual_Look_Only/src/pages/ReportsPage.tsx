import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  Building2,
  FileSpreadsheet,
  FileCheck2,
  Printer,
  Download,
  Warehouse,
  ShieldCheck,
  Wrench,
  AlertTriangle,
  ClipboardList,
  Search,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react'

import {
  exportComprehensiveCustodyWorkbook,
  exportCustodyToExcel,
  getWarehouseStats,
  loadCustodyItems,
  WAREHOUSES,
  type CustodyItem,
  type WarehouseDefinition,
} from '../lib/custody'
import type { FixtureMovement } from '../lib/fixture'
import { loadAppSettings, type AppSettings } from '../lib/settings'
import { OfficialDisbursementPermitModal } from '../components/OfficialDisbursementPermitModal'

interface ReportsPageProps {
  movements?: FixtureMovement[]
  currency?: AppSettings['currency']
  settings?: AppSettings
  session?: Session | null
  onExportMovements?: () => void
}

function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export default function ReportsPage({
  movements = [],
  currency: propCurrency,
  settings: propSettings,
  session: _session,
  onExportMovements,
}: ReportsPageProps) {
  const navigate = useNavigate()
  const settings = propSettings || loadAppSettings()
  const currency = propCurrency || settings.currency || 'EGP'

  const [items] = useState<CustodyItem[]>(loadCustodyItems)
  const [selectedWarehouseForPrint, setSelectedWarehouseForPrint] = useState<WarehouseDefinition>(WAREHOUSES[0])
  const [isPermitModalOpen, setIsPermitModalOpen] = useState(false)
  const [permitInitialItems, setPermitInitialItems] = useState<CustodyItem[]>([])
  const [permitTargetWarehouseId, setPermitTargetWarehouseId] = useState<string>('fci')
  const [searchTerm, setSearchTerm] = useState('')

  // Statistics per warehouse
  const warehouseReports = useMemo(() => {
    return WAREHOUSES.map((wh) => {
      const whItems = items.filter((i) => i.warehouseId === wh.id)
      const stats = getWarehouseStats(whItems)
      return {
        warehouse: wh,
        items: whItems,
        stats,
      }
    })
  }, [items])

  // Filtered maintenance and damaged items
  const maintenanceItems = useMemo(() => {
    return items.filter((i) => i.condition === 'maintenance')
  }, [items])

  const damagedItems = useMemo(() => {
    return items.filter((i) => i.condition === 'damaged')
  }, [items])

  // Print single warehouse inventory sheet
  function handlePrintWarehouseSheet(wh: WarehouseDefinition) {
    setSelectedWarehouseForPrint(wh)
    document.body.classList.add('printing-warehouse-sheet')
    // Small timeout to allow state to settle before printing
    setTimeout(() => {
      window.print()
    }, 150)
  }

  useEffect(() => {
    function cleanupPrint() {
      document.body.classList.remove('printing-warehouse-sheet')
    }
    window.addEventListener('afterprint', cleanupPrint)
    return () => window.removeEventListener('afterprint', cleanupPrint)
  }, [])

  const selectedWhItems = useMemo(() => {
    return items.filter((i) => i.warehouseId === selectedWarehouseForPrint.id)
  }, [items, selectedWarehouseForPrint.id])

  const selectedWhStats = useMemo(() => {
    return getWarehouseStats(selectedWhItems)
  }, [selectedWhItems])

  const filteredWarehouseReports = useMemo(() => {
    if (!searchTerm.trim()) return warehouseReports
    const q = searchTerm.toLowerCase().trim()
    return warehouseReports.filter(
      (r) =>
        r.warehouse.name.toLowerCase().includes(q) ||
        r.warehouse.shortName.toLowerCase().includes(q) ||
        r.warehouse.building.toLowerCase().includes(q)
    )
  }, [warehouseReports, searchTerm])

  return (
    <section className="reports-module content-area">
      {/* 1. Header Card */}
      <div className="card-surface reports-header-card no-print">
        <div className="reports-header-layout">
          <div>
            <div className="reports-badge-pill">
              <FileSpreadsheet size={15} />
              <span>المركز الموحد للتقارير والمستندات الرسمية</span>
            </div>
            <h2 className="reports-main-title">
              تقارير وأذون وسجلات المخازن الحكومية
            </h2>
            <p className="reports-header-desc">
              منصة مركزية لإصدار أذون الصرف الرسمية المعتمدة، طباعة محاضر الجرد السنوية لكافة كليات المؤسسة، وتصدير الدفاتر الإلكترونية (Excel) المطابقة للوائح والقوانين المخزنية.
            </p>
          </div>

          <div className="reports-header-actions">
            <button
              type="button"
              className="primary-btn reports-primary-btn"
              onClick={() => {
                setPermitInitialItems([])
                setIsPermitModalOpen(true)
              }}
              id="btn-reports-new-permit"
            >
              <FileCheck2 size={17} />
              <span>إصدار إذن صرف رسمي</span>
            </button>

            <button
              type="button"
              className="secondary-btn reports-secondary-btn"
              onClick={() => void exportComprehensiveCustodyWorkbook(items, currency, settings.organization)}
              id="btn-reports-master-excel"
              title="تحميل ملف Excel موحد شامل يحتوي على كشوف كافة الكليات الـ 8"
            >
              <Building2 size={17} className="text-accent" />
              <span>سجل الجرد الموحد (Excel)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Primary 4 Report Category Cards */}
      <div className="reports-category-grid no-print">
        {/* Card 1: Official Permit */}
        <div className="card-surface reports-cat-card">
          <div>
            <div className="reports-cat-icon accent">
              <FileCheck2 size={22} />
            </div>
            <h3 className="reports-cat-title">
              أذون الصرف ومحاضر الاستلام
            </h3>
            <p className="reports-cat-desc">
              نماذج صرف وإضافة رسمية معتمدة بالترويسة الحكومية، إقرار الاستلام، والتوقيعات الأربعة وخاتم شعار الجمهورية.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn reports-cat-btn"
            onClick={() => {
              setPermitInitialItems([])
              setIsPermitModalOpen(true)
            }}
          >
            <Printer size={15} /> فتح نموذج إذن الصرف
          </button>
        </div>

        {/* Card 2: Master Comprehensive Excel */}
        <div className="card-surface reports-cat-card">
          <div>
            <div className="reports-cat-icon teal">
              <Building2 size={22} />
            </div>
            <h3 className="reports-cat-title">
              سجل الجرد الموحد (8 كليات)
            </h3>
            <p className="reports-cat-desc">
              دفتر إلكتروني رسمي متعدد الصفحات (Multi-sheet Excel Workbook) لكافة المخازن مع أسعار الوحدات والإجماليات العامة.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn reports-cat-btn"
            onClick={() => void exportComprehensiveCustodyWorkbook(items, currency, settings.organization)}
          >
            <Download size={15} /> تحميل السجل الموحد (Excel)
          </button>
        </div>

        {/* Card 3: Movements Ledger */}
        <div className="card-surface reports-cat-card">
          <div>
            <div className="reports-cat-icon indigo">
              <ClipboardList size={22} />
            </div>
            <h3 className="reports-cat-title">
              تقرير حركة المخزن العام
            </h3>
            <p className="reports-cat-desc">
              بيان كامل بحركات الوارد والمنصرف المالي والكمي ({movements.length} حركة)، الفواتير، الموردين، وأرصدة الصرف المتبقية.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn reports-cat-btn"
            onClick={() => {
              if (onExportMovements) onExportMovements()
              else navigate('/movements')
            }}
          >
            <FileSpreadsheet size={15} /> تصدير سجل الحركات (Excel)
          </button>
        </div>

        {/* Card 4: Quality & Audit Report */}
        <div className="card-surface reports-cat-card">
          <div>
            <div className="reports-cat-icon amber">
              <ShieldCheck size={22} />
            </div>
            <h3 className="reports-cat-title">
              تقرير تدقيق وجودة البيانات
            </h3>
            <p className="reports-cat-desc">
              مطابقة القيود المخزنية، فحص التواريخ والأسعار غير المنطقية، واكتشاف تجاوزات الصرف آلياً.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn reports-cat-btn"
            onClick={() => navigate('/quality')}
          >
            <ShieldCheck size={15} /> فتح تقرير الجودة
          </button>
        </div>
      </div>

      {/* 3. Certified Inventory Reports per College (8 Warehouses Grid) */}
      <div className="card-surface reports-wh-section no-print">
        <div className="reports-wh-head">
          <div>
            <h3 className="reports-wh-title">
              كشوف الجرد المعتمدة لمخازن وكليات المؤسسة (8 مخازن)
            </h3>
            <span className="reports-wh-subtitle">
              إمكانية طباعة محضر جرد رسمي معتمد أو تصدير كشف Excel مخصص لكل كلية على حدة
            </span>
          </div>

          <div className="reports-wh-search-wrap">
            <div className="toolbar-search m-0">
              <Search size={15} />
              <input
                type="search"
                placeholder="ابحث عن كلية أو مبنى..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="reports-wh-grid">
          {filteredWarehouseReports.map(({ warehouse, items: whItems, stats }) => (
            <div
              key={warehouse.id}
              className="reports-wh-card"
            >
              <div>
                <div className="reports-wh-card-top">
                  <div className="flex items-center gap-2">
                    <div className="reports-wh-icon-box">
                      <Warehouse size={17} />
                    </div>
                    <div>
                      <h4 className="reports-wh-name">
                        {warehouse.name}
                      </h4>
                      <small className="reports-wh-building">{warehouse.building}</small>
                    </div>
                  </div>

                  <span
                    className={`reports-readiness-badge ${stats.healthyRatio >= 85 ? 'ok' : 'warn'}`}
                  >
                    جاهزية {stats.healthyRatio}%
                  </span>
                </div>

                {/* Warehouse metrics */}
                <div className="reports-wh-metrics">
                  <div>
                    <div className="reports-metric-label">عدد الأصناف</div>
                    <strong className="reports-metric-val">{whItems.length}</strong>
                  </div>
                  <div>
                    <div className="reports-metric-label">إجمالي الوحدات</div>
                    <strong className="reports-metric-val">{stats.totalUnits}</strong>
                  </div>
                  <div>
                    <div className="reports-metric-label">القيمة الدفترية</div>
                    <strong className="reports-metric-val accent">{formatCurrency(stats.totalValue, currency)}</strong>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="reports-wh-actions">
                <button
                  type="button"
                  className="secondary-btn reports-wh-btn-main"
                  onClick={() => handlePrintWarehouseSheet(warehouse)}
                  title={`طباعة محضر الجرد الرسمي A4 لكشف ${warehouse.name}`}
                  aria-label={`طباعة كشف ${warehouse.name}`}
                >
                  <Printer size={13} /> طباعة الجرد (A4)
                </button>

                <button
                  type="button"
                  className="secondary-btn reports-wh-btn-main"
                  onClick={() => void exportCustodyToExcel(warehouse.name, whItems, currency)}
                  title={`تصدير كشف Excel بالبنود والإجماليات لـ ${warehouse.name}`}
                  aria-label={`تصدير كشف Excel ${warehouse.name}`}
                >
                  <FileSpreadsheet size={13} /> تصدير Excel
                </button>

                <button
                  type="button"
                  className="secondary-btn reports-wh-btn-icon"
                  onClick={() => {
                    setPermitInitialItems([])
                    setPermitTargetWarehouseId(warehouse.id)
                    setIsPermitModalOpen(true)
                  }}
                  title="إصدار إذن صرف لهذه الكلية"
                  aria-label={`إصدار إذن صرف لـ ${warehouse.name}`}
                >
                  <FileCheck2 size={13} /> إذن صرف
                </button>

                <button
                  type="button"
                  className="secondary-btn reports-wh-btn-icon"
                  onClick={() => navigate(`/custody?warehouse=${warehouse.id}`)}
                  title="فتح سجل وإدارة عهدة هذه الكلية"
                  aria-label={`فتح سجل عهدة ${warehouse.name}`}
                >
                  <ExternalLink size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Technical Condition & Maintenance Reports */}
      <div className="reports-tech-grid no-print">
        {/* Maintenance Items Card */}
        <div className="card-surface reports-tech-card">
          <div className="reports-tech-head">
            <div className="flex items-center gap-2">
              <div className="reports-tech-icon warn">
                <Wrench size={16} />
              </div>
              <div>
                <h4 className="reports-tech-title">
                  كشف الأصول التي تحتاج صيانة عاجلة
                </h4>
                <small className="reports-tech-sub">{maintenanceItems.length} أصل مسجل بحالة صيانة</small>
              </div>
            </div>

            {maintenanceItems.length > 0 && (
              <button
                type="button"
                className="secondary-btn reports-tech-btn"
                onClick={() => void exportCustodyToExcel('أصول_تحت_الصيانة', maintenanceItems, currency)}
              >
                <Download size={13} /> تصدير Excel
              </button>
            )}
          </div>

          {maintenanceItems.length === 0 ? (
            <div className="reports-empty-box">
              <CheckCircle2 size={24} className="reports-empty-icon" />
              لا توجد أصول مسجلة بحالة صيانة حالياً — كافة الأصول تعمل بكفاءة.
            </div>
          ) : (
            <div className="reports-tech-table-wrap">
              <table className="reports-tech-table">
                <thead>
                  <tr>
                    <th>كود العهدة</th>
                    <th>الصنف</th>
                    <th>المخزن / الكلية</th>
                    <th>الكمية</th>
                    <th>القيمة</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceItems.slice(0, 6).map((item) => {
                    const wh = WAREHOUSES.find((w) => w.id === item.warehouseId)
                    return (
                      <tr key={item.id}>
                        <td><code>{item.code}</code></td>
                        <td className="font-semibold">{item.name}</td>
                        <td>{wh?.shortName || item.warehouseId}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td className="text-accent font-semibold">{formatCurrency(item.value, currency)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Damaged & Scrap Items Card */}
        <div className="card-surface reports-tech-card">
          <div className="reports-tech-head">
            <div className="flex items-center gap-2">
              <div className="reports-tech-icon bad">
                <AlertTriangle size={16} />
              </div>
              <div>
                <h4 className="reports-tech-title">
                  كشف الأصول التالفة والمعدة للتكهين
                </h4>
                <small className="reports-tech-sub">{damagedItems.length} أصل بحالة تالفة / كهنة</small>
              </div>
            </div>

            {damagedItems.length > 0 && (
              <button
                type="button"
                className="secondary-btn reports-tech-btn"
                onClick={() => void exportCustodyToExcel('أصول_كهنة_وتالفة', damagedItems, currency)}
              >
                <Download size={13} /> تصدير Excel
              </button>
            )}
          </div>

          {damagedItems.length === 0 ? (
            <div className="reports-empty-box">
              <CheckCircle2 size={24} className="reports-empty-icon" />
              لا توجد أصناف كهنة أو تالفة مسجلة في السجلات.
            </div>
          ) : (
            <div className="reports-tech-table-wrap">
              <table className="reports-tech-table">
                <thead>
                  <tr>
                    <th>كود العهدة</th>
                    <th>الصنف</th>
                    <th>المخزن / الكلية</th>
                    <th>الكمية</th>
                    <th>القيمة</th>
                  </tr>
                </thead>
                <tbody>
                  {damagedItems.slice(0, 6).map((item) => {
                    const wh = WAREHOUSES.find((w) => w.id === item.warehouseId)
                    return (
                      <tr key={item.id}>
                        <td><code>{item.code}</code></td>
                        <td className="font-semibold">{item.name}</td>
                        <td>{wh?.shortName || item.warehouseId}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td className="text-bad font-semibold">{formatCurrency(item.value, currency)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 5. Official Disbursement Permit Modal */}
      {isPermitModalOpen && (
        <OfficialDisbursementPermitModal
          initialItems={permitInitialItems}
          allWarehouseItems={items}
          settings={settings}
          defaultWarehouseId={permitTargetWarehouseId}
          onClose={() => setIsPermitModalOpen(false)}
        />
      )}

      {/* 6. Official Printable Inventory Sheet (A4 Portrait Template for Direct Printing) */}
      <div className="official-custody-print-document" aria-hidden="true">
        {(settings.logoDataUrl || settings.logoUrl) && (
          <div className="print-watermark" aria-hidden="true">
            <img src={settings.logoDataUrl || settings.logoUrl} alt="" />
          </div>
        )}
        <header className="print-letterhead">
          <div className="print-header-col print-header-right">
            <div className="print-gov-heading">جمهورية مصر العربية</div>
            <div className="print-org-name">{settings.organization || 'المؤسسة التعليمية'}</div>
            <div className="print-dept-name">{settings.department || 'إدارة المخازن المركزية'}</div>
            <div className="print-subdept-name">قسم مراقبة وتوثيق العهد والأصول المستديمة</div>
          </div>

          <div className="print-header-col print-header-center">
            {settings.logoDataUrl || settings.logoUrl ? (
              <img
                src={settings.logoDataUrl || settings.logoUrl}
                alt={settings.organization || 'شعار المؤسسة'}
                className="print-official-logo"
              />
            ) : (
              <div className="print-logo-emblem">شعار المؤسسة</div>
            )}
            <div className="print-doc-classification">كشف جرد رسمي معتمد</div>
          </div>

          <div className="print-header-col print-header-left">
            <div className="print-meta-field">
              <span className="print-meta-label">الجهة / الكلية:</span>
              <strong className="print-meta-val">{selectedWarehouseForPrint.name}</strong>
            </div>
            <div className="print-meta-field">
              <span className="print-meta-label">المبنى / الموقع:</span>
              <span className="print-meta-val">{selectedWarehouseForPrint.building}</span>
            </div>
            <div className="print-meta-field">
              <span className="print-meta-label">تاريخ الجرد:</span>
              <span className="print-meta-val">{new Date().toISOString().slice(0, 10)}</span>
            </div>
            <div className="print-meta-field">
              <span className="print-meta-label">الرقم المرجعي:</span>
              <span className="print-meta-val font-mono">INV-{selectedWarehouseForPrint.id.toUpperCase()}-2026</span>
            </div>
          </div>
        </header>

        <div className="print-doc-title-banner">
          <h1 className="print-main-title">محضر جرد وإثبات العهدة والأصول المستديمة</h1>
          <div className="print-sub-title">
            طبقاً للائحة المخازن والمشتريات الحكومية وقواعد حصر وتدقيق الأصول التخصصية
          </div>
        </div>

        <div className="print-summary-strip">
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي بنود العهدة:</span>
            <span className="print-summary-val">{selectedWhItems.length} صنف</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي الوحدات والأجهزة:</span>
            <span className="print-summary-val">{selectedWhStats.totalUnits} جهاز / وحدة</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي القيمة الدفترية:</span>
            <span className="print-summary-val">{formatCurrency(selectedWhStats.totalValue, currency)}</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">نسبة الجاهزية الفنية:</span>
            <span className="print-summary-val">{selectedWhStats.healthyRatio}% صالحة للتشغيل</span>
          </div>
        </div>

        <table className="print-official-table">
          <thead>
            <tr>
              <th className="col-w-4">م</th>
              <th className="col-w-13">كود العهدة</th>
              <th className="col-w-28">اسم الصنف والمواصفات الفنية</th>
              <th className="col-w-13">التصنيف والنوع</th>
              <th className="col-w-16">أمين العهدة / المكان</th>
              <th className="col-w-8">الكمية</th>
              <th className="col-w-10">القيمة الدفترية</th>
              <th className="col-w-8">الحالة الفنية</th>
            </tr>
          </thead>
          <tbody>
            {selectedWhItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="print-empty-row">
                  لا توجد بنود عهدة مسجلة في هذا المخزن حالياً.
                </td>
              </tr>
            ) : (
              selectedWhItems.map((item, index) => (
                <tr key={item.id}>
                  <td className="text-center">{index + 1}</td>
                  <td className="print-code-cell">{item.code}</td>
                  <td>
                    <div className="print-item-name">{item.name}</div>
                    {item.serialNumber && (
                      <div className="print-item-serial">سيريال: {item.serialNumber}</div>
                    )}
                    {item.notes && <div className="print-item-notes">{item.notes}</div>}
                  </td>
                  <td>
                    <div>{item.category}</div>
                    <span className="print-sub-type">({item.custodyType})</span>
                  </td>
                  <td>
                    <div className="print-custodian-name">{item.custodian}</div>
                    <div className="print-location-sub">{item.roomLocation}</div>
                  </td>
                  <td className="text-center">
                    <strong>{item.quantity}</strong> {item.unit}
                  </td>
                  <td className="text-center font-mono">
                    {formatCurrency(item.value, currency)}
                  </td>
                  <td className="text-center">
                    <span className={`print-condition-badge print-cond-${item.condition}`}>
                      {item.condition === 'excellent' && 'ممتازة'}
                      {item.condition === 'good' && 'جيدة'}
                      {item.condition === 'maintenance' && 'صيانة'}
                      {item.condition === 'damaged' && 'كهنة وتالف'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="print-signatures-section">
          <div className="print-signatures-notice">
            * يُقر الموقعون أدناه بصحة البيانات والمطابقة الفعلية لجرد العهدة والأصول على الطبيعة وفقاً للوائح والقوانين المخزنية.
          </div>
          <div className="print-signatures-grid">
            <div className="print-signature-box">
              <div className="print-sig-role">أمين العهدة المسؤول</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box">
              <div className="print-sig-role">عضو لجنة الجرد والفحص</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box">
              <div className="print-sig-role">مدير إدارة المخازن</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box print-approval-box">
              <div className="print-sig-role">يعتمد: عميد الكلية / رئيس الجهة</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">الاعتماد: ...................................</div>
              <div className="print-seal-area">
                <span className="print-seal-hint">(خاتم شعار الجمهورية / ختم المؤسسة)</span>
              </div>
            </div>
          </div>
        </div>

        <footer className="print-document-footer">
          <span>طُبع هذا المحضر آلياً عبر منظومة إدارة المخازن والعهدة — مستند رسمي صالح للتدقيق المالي والمخزني</span>
          <span>مستند رسمي معتمد</span>
        </footer>
      </div>
    </section>
  )
}
