import { useInventory } from '../lib/useInventory'
import { localDate } from '../lib/localDate'
import { useMemo, useState } from 'react'
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

  const inventory = useInventory()
  const items = useMemo(() => inventory.items.filter((item) => !item.deletedAt), [inventory.items])
  const [selectedWarehouseForPrint, setSelectedWarehouseForPrint] = useState<WarehouseDefinition>(WAREHOUSES[0])
  const [isPermitModalOpen, setIsPermitModalOpen] = useState(false)
  const [permitInitialItems, setPermitInitialItems] = useState<CustodyItem[]>([])
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
    // Small timeout to allow state to settle before printing
    setTimeout(() => {
      window.print()
    }, 150)
  }

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
      <div className="card-surface" style={{ padding: '24px 28px', marginBottom: '20px', borderRadius: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', background: 'rgba(14, 124, 134, 0.08)', borderRadius: '20px', color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '10px' }}>
              <FileSpreadsheet size={15} />
              <span>المركز الموحد للتقارير والمستندات الرسمية</span>
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--ink)' }}>
              تقارير وأذون وسجلات المخازن الحكومية
            </h2>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.92rem', maxWidth: '750px', lineHeight: 1.6 }}>
              منصة مركزية لإصدار أذون الصرف الرسمية المعتمدة، طباعة محاضر الجرد السنوية لكافة كليات المؤسسة، وتصدير الدفاتر الإلكترونية (Excel) المطابقة للوائح والقوانين المخزنية.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setPermitInitialItems([])
                setIsPermitModalOpen(true)
              }}
              id="btn-reports-new-permit"
              style={{ padding: '10px 18px', fontSize: '0.9rem', fontWeight: 700 }}
            >
              <FileCheck2 size={17} />
              <span>إصدار إذن صرف رسمي</span>
            </button>

            <button
              type="button"
              className="secondary-btn"
              onClick={() => void exportComprehensiveCustodyWorkbook(items, currency, settings.organization)}
              id="btn-reports-master-excel"
              title="تحميل ملف Excel موحد شامل يحتوي على كشوف كافة الكليات الـ 8"
              style={{ padding: '10px 18px', fontSize: '0.9rem', fontWeight: 600 }}
            >
              <Building2 size={17} style={{ color: '#0e7c86' }} />
              <span>سجل الجرد الموحد (Excel)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Primary 4 Report Category Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Card 1: Official Permit */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '14px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(8, 127, 104, 0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
              <FileCheck2 size={22} />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--ink)' }}>
              أذون الصرف ومحاضر الاستلام
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              نماذج صرف وإضافة رسمية معتمدة بالترويسة الحكومية، إقرار الاستلام، والتوقيعات الأربعة وخاتم شعار الجمهورية.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 600 }}
            onClick={() => {
              setPermitInitialItems([])
              setIsPermitModalOpen(true)
            }}
          >
            <Printer size={15} /> فتح نموذج إذن الصرف
          </button>
        </div>

        {/* Card 2: Master Comprehensive Excel */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '14px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(14, 124, 134, 0.12)', color: '#0e7c86', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
              <Building2 size={22} />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--ink)' }}>
              سجل الجرد الموحد (8 كليات)
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              دفتر إلكتروني رسمي متعدد الصفحات (Multi-sheet Excel Workbook) لكافة المخازن مع أسعار الوحدات والإجماليات العامة.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 600 }}
            onClick={() => void exportComprehensiveCustodyWorkbook(items, currency, settings.organization)}
          >
            <Download size={15} /> تحميل السجل الموحد (Excel)
          </button>
        </div>

        {/* Card 3: Movements Ledger */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '14px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
              <ClipboardList size={22} />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--ink)' }}>
              تقرير حركة المخزن العام
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              بيان كامل بحركات الوارد والمنصرف المالي والكمي ({movements.length} حركة)، الفواتير، الموردين، وأرصدة الصرف المتبقية.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 600 }}
            onClick={() => {
              if (onExportMovements) onExportMovements()
              else navigate('/movements')
            }}
          >
            <FileSpreadsheet size={15} /> تصدير سجل الحركات (Excel)
          </button>
        </div>

        {/* Card 4: Quality & Audit Report */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '14px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.12)', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
              <ShieldCheck size={22} />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--ink)' }}>
              تقرير تدقيق وجودة البيانات
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              مطابقة القيود المخزنية، فحص التواريخ والأسعار غير المنطقية، واكتشاف تجاوزات الصرف آلياً.
            </p>
          </div>
          <button
            type="button"
            className="secondary-btn"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 600 }}
            onClick={() => navigate('/quality')}
          >
            <ShieldCheck size={15} /> فتح تقرير الجودة
          </button>
        </div>
      </div>

      {/* 3. Certified Inventory Reports per College (8 Warehouses Grid) */}
      <div className="card-surface" style={{ padding: '24px', borderRadius: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--ink)' }}>
              كشوف الجرد المعتمدة لمخازن وكليات المؤسسة (8 مخازن)
            </h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              إمكانية طباعة محضر جرد رسمي معتمد أو تصدير كشف Excel مخصص لكل كلية على حدة
            </span>
          </div>

          <div style={{ minWidth: '240px' }}>
            <div className="toolbar-search" style={{ margin: 0 }}>
              <Search size={15} />
              <input
                type="search"
                placeholder="ابحث عن كلية أو مبنى..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '14px' }}>
          {filteredWarehouseReports.map(({ warehouse, items: whItems, stats }) => (
            <div
              key={warehouse.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: '12px',
                padding: '16px',
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.2s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(14, 124, 134, 0.08)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Warehouse size={17} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--ink)' }}>
                        {warehouse.name}
                      </h4>
                      <small style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{warehouse.building}</small>
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: stats.healthyRatio >= 85 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                      color: stats.healthyRatio >= 85 ? '#059669' : '#d97706',
                    }}
                  >
                    جاهزية {stats.healthyRatio}%
                  </span>
                </div>

                {/* Warehouse metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', padding: '10px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: '12px', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>عدد الأصناف</div>
                    <strong style={{ fontSize: '0.94rem', color: 'var(--ink)' }}>{whItems.length}</strong>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>إجمالي الوحدات</div>
                    <strong style={{ fontSize: '0.94rem', color: 'var(--ink)' }}>{stats.totalUnits}</strong>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>القيمة الدفترية</div>
                    <strong style={{ fontSize: '0.88rem', color: 'var(--accent)' }}>{formatCurrency(stats.totalValue, currency)}</strong>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem', justifyContent: 'center' }}
                  onClick={() => handlePrintWarehouseSheet(warehouse)}
                  title={`طباعة محضر الجرد الرسمي A4 لكشف ${warehouse.name}`}
                >
                  <Printer size={13} /> طباعة الجرد (A4)
                </button>

                <button
                  type="button"
                  className="secondary-btn"
                  style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem', justifyContent: 'center' }}
                  onClick={() => void exportCustodyToExcel(warehouse.name, whItems, currency)}
                  title={`تصدير كشف Excel بالبنود والإجماليات لـ ${warehouse.name}`}
                >
                  <FileSpreadsheet size={13} /> تصدير Excel
                </button>

                <button
                  type="button"
                  className="secondary-btn"
                  style={{ padding: '7px 9px', fontSize: '0.8rem' }}
                  onClick={() => {
                    setPermitInitialItems(whItems.slice(0, 1))
                    setIsPermitModalOpen(true)
                  }}
                  title="إصدار إذن صرف لهذه الكلية"
                >
                  <FileCheck2 size={13} /> إذن صرف
                </button>

                <button
                  type="button"
                  className="secondary-btn"
                  style={{ padding: '7px 9px', fontSize: '0.8rem' }}
                  onClick={() => navigate(`/custody?warehouse=${warehouse.id}`)}
                  title="فتح سجل وإدارة عهدة هذه الكلية"
                >
                  <ExternalLink size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Technical Condition & Maintenance Reports */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* Maintenance Items Card */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Wrench size={16} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)' }}>
                  كشف الأصول التي تحتاج صيانة عاجلة
                </h4>
                <small style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{maintenanceItems.length} أصل مسجل بحالة صيانة</small>
              </div>
            </div>

            {maintenanceItems.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                onClick={() => void exportCustodyToExcel('أصول_تحت_الصيانة', maintenanceItems, currency)}
              >
                <Download size={13} /> تصدير Excel
              </button>
            )}
          </div>

          {maintenanceItems.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
              <CheckCircle2 size={24} style={{ color: '#059669', margin: '0 auto 8px auto' }} />
              لا توجد أصول مسجلة بحالة صيانة حالياً — كافة الأصول تعمل بكفاءة.
            </div>
          ) : (
            <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.84rem' }}>
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
                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                        <td>{wh?.shortName || item.warehouseId}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{formatCurrency(item.value, currency)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Damaged & Scrap Items Card */}
        <div className="card-surface" style={{ padding: '20px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={16} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)' }}>
                  كشف الأصول التالفة والمعدة للتكهين
                </h4>
                <small style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{damagedItems.length} أصل بحالة تالفة / كهنة</small>
              </div>
            </div>

            {damagedItems.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                onClick={() => void exportCustodyToExcel('أصول_كهنة_وتالفة', damagedItems, currency)}
              >
                <Download size={13} /> تصدير Excel
              </button>
            )}
          </div>

          {damagedItems.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
              <CheckCircle2 size={24} style={{ color: '#059669', margin: '0 auto 8px auto' }} />
              لا توجد أصناف كهنة أو تالفة مسجلة في السجلات.
            </div>
          ) : (
            <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.84rem' }}>
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
                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                        <td>{wh?.shortName || item.warehouseId}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td style={{ color: '#dc2626', fontWeight: 600 }}>{formatCurrency(item.value, currency)}</td>
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
          onClose={() => setIsPermitModalOpen(false)}
        />
      )}

      {/* 6. Official Printable Inventory Sheet (A4 Portrait Template for Direct Printing) */}
      <div className="official-custody-print-document" aria-hidden="true">
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
              <span className="print-meta-val">{localDate()}</span>
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
              <th style={{ width: '4%' }}>م</th>
              <th style={{ width: '13%' }}>كود العهدة</th>
              <th style={{ width: '28%' }}>اسم الصنف والمواصفات الفنية</th>
              <th style={{ width: '13%' }}>التصنيف والنوع</th>
              <th style={{ width: '16%' }}>أمين العهدة / المكان</th>
              <th style={{ width: '8%' }}>الكمية</th>
              <th style={{ width: '10%' }}>القيمة الدفترية</th>
              <th style={{ width: '8%' }}>الحالة الفنية</th>
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
          <span>صفحة 1 من 1</span>
        </footer>
      </div>

      {isPermitModalOpen && (
        <OfficialDisbursementPermitModal
          initialItems={permitInitialItems}
          allWarehouseItems={items}
          settings={settings}
          onClose={() => setIsPermitModalOpen(false)}
        />
      )}
    </section>
  )
}
