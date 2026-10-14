import { useState, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Building2,
  DollarSign,
  Download,
  Package,
  Plus,
  Receipt,
  Search,
  TrendingUp,
  Truck,
} from 'lucide-react'
import type { FixtureMovement } from '../lib/fixture'
import type { AppSettings } from '../lib/settings'
import { matchesSearch } from '../lib/searchUtils'
import { extractSuppliersFromMovements } from '../lib/suppliersRepository'

interface ProcurementAnalyticsDashboardProps {
  movements?: FixtureMovement[]
  currency: AppSettings['currency']
  isDashboardEmbed?: boolean
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return `'${value}` as unknown as T
  }
  return value
}

export function ProcurementAnalyticsDashboard({
  movements = [],
  currency,
  isDashboardEmbed = false,
}: ProcurementAnalyticsDashboardProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const currentMonthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`

  // الفواتير وحركات الشراء الفعلية فقط (الوارد)
  const purchaseMovements = useMemo(() => {
    return movements.filter((m) => (Number(m.qin) || 0) > 0)
  }, [movements])

  // الموردون الفعليون المستخرجون من الحركات
  const realSuppliers = useMemo(() => {
    return extractSuppliersFromMovements()
  }, [])

  // الحسابات والمؤشرات الفعلية 100%
  const kpis = useMemo(() => {
    let totalSpend = 0
    let monthSpend = 0

    for (const m of purchaseMovements) {
      const q = Number(m.qin) || 0
      const p = Number(m.price) || 0
      const val = q * p
      totalSpend += val

      const dateStr = String(m.date || '')
      if (dateStr.startsWith(currentMonthPrefix) || dateStr.includes(`/${currentMonth}/`) || dateStr.includes(`/${currentMonth < 10 ? '0' + currentMonth : currentMonth}/`)) {
        monthSpend += val
      }
    }

    const avgInvoice = purchaseMovements.length > 0 ? totalSpend / purchaseMovements.length : 0

    return {
      totalSpend,
      monthSpend,
      purchasesCount: purchaseMovements.length,
      suppliersCount: realSuppliers.length,
      avgInvoice,
    }
  }, [purchaseMovements, realSuppliers, currentMonthPrefix])

  // مراحل التوريد والعمليات
  const pipeline = useMemo(() => {
    const totalCount = purchaseMovements.length
    const withInvoice = purchaseMovements.filter((m) => Boolean(m.inv && String(m.inv).trim())).length
    const withSupplier = purchaseMovements.filter((m) => Boolean(m.from && m.from.trim() && m.from !== 'رصيد أول المدة')).length
    const avgVal = totalCount > 0 ? Math.round(kpis.totalSpend / totalCount) : 0

    return [
      { name: '1. فواتير وتوريدات الشراء', count: totalCount, color: '#0e7c86', desc: 'إجمالي عمليات الشراء المقيدة' },
      { name: '2. فواتير برقم رسمي', count: withInvoice, color: '#3b82f6', desc: 'حركات مسجلة برقم فاتورة معتمد' },
      { name: '3. موردون معتمدون', count: withSupplier, color: '#10b981', desc: 'حركات مرتبطة بشركات وموردين' },
      { name: '4. متوسط الفاتورة', count: avgVal, isCurrency: true, color: '#8b5cf6', desc: 'معدل الإنفاق لكل فاتورة شراء' },
    ]
  }, [purchaseMovements, kpis.totalSpend])

  // أحدث حركات الشراء المفلترة للجدول
  const filteredPurchases = useMemo(() => {
    let list = purchaseMovements
    if (searchTerm.trim()) {
      list = list.filter((m) =>
        matchesSearch([m.inv, m.from, m.item, m.date, m.notes, m.price, m.qin], searchTerm)
      )
    }
    return list.slice(0, 10)
  }, [purchaseMovements, searchTerm])

  async function handleExportExcel() {
    const XLSX = await import('xlsx')
    const kpiRows = [
      { 'المؤشر': 'إجمالي الإنفاق الفعلي على المشتريات', 'القيمة': kpis.totalSpend },
      { 'المؤشر': 'الإنفاق خلال هذا الشهر', 'القيمة': kpis.monthSpend },
      { 'المؤشر': 'إجمالي فواتير وحركات الشراء', 'القيمة': kpis.purchasesCount },
      { 'المؤشر': 'عدد الموردين المسجلين', 'القيمة': kpis.suppliersCount },
      { 'المؤشر': 'متوسط قيمة الفاتورة', 'القيمة': kpis.avgInvoice },
    ]

    const purchasesRows = purchaseMovements.map((m, idx) => ({
      'م': idx + 1,
      'تاريخ التوريد': sanitizeExcelCell(m.date || '—'),
      'رقم الفاتورة': sanitizeExcelCell(m.inv || '—'),
      'المورد / الشركة': sanitizeExcelCell(m.from || '—'),
      'الصنف': sanitizeExcelCell(m.item || '—'),
      'الكمية الواردة': Number(m.qin) || 0,
      'سعر الوحدة': Number(m.price) || 0,
      'القيمة الإجمالية': (Number(m.qin) || 0) * (Number(m.price) || 0),
      'ملاحظات': sanitizeExcelCell(m.notes || ''),
    }))

    const wb = XLSX.utils.book_new()
    const wsKpis = XLSX.utils.json_to_sheet(kpiRows)
    const wsPurchases = XLSX.utils.json_to_sheet(purchasesRows)

    XLSX.utils.book_append_sheet(wb, wsKpis, 'مؤشرات المشتريات')
    XLSX.utils.book_append_sheet(wb, wsPurchases, 'حركات الشراء الفعلية')
    XLSX.writeFile(wb, `تقرير-تحليلات-المشتريات-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className={`procurement-analytics-wrapper ${isDashboardEmbed ? 'dashboard-embed' : ''}`}>
      {/* رأس القسم والإجراءات السريعة */}
      <div
        className="analytics-top-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: isDashboardEmbed ? '1.25rem' : '1.45rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--ink)' }}>
            <Receipt size={22} style={{ color: 'var(--accent)' }} />
            تحليلات وبيانات قسم المشتريات والتوريدات
          </h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
            مؤشرات الإنفاق المالي، متابعة فواتير الشراء المسجلة، وحسابات الموردين في قاعدة البيانات الحقيقية
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            <Download size={15} />
            تصدير تقرير المشتريات Excel
          </button>

          <NavLink
            to="/purchases?tab=add"
            className="primary-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Plus size={16} />
            فاتورة وتوريد جديد
          </NavLink>
        </div>
      </div>

      {/* بطاقات المؤشرات الـ 4 الرئيسية */}
      <div
        className="kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: '14px',
          marginBottom: '22px',
        }}
      >
        <div
          className="kpi-card card-surface"
          style={{
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            borderTop: '4px solid #10b981',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>إجمالي الإنفاق الفعلي</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--ink)', marginTop: '4px' }}>
                {formatCurrency(kpis.totalSpend, currency)}
              </div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
              <DollarSign size={20} />
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '8px' }}>
            متوسط الفاتورة: {formatCurrency(kpis.avgInvoice, currency)}
          </div>
        </div>

        <div
          className="kpi-card card-surface"
          style={{
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            borderTop: '4px solid #0e7c86',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>حركات وفواتير الشراء</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--ink)', marginTop: '4px' }}>
                {kpis.purchasesCount.toLocaleString('ar-EG')} فاتورة
              </div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(14, 124, 134, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0e7c86' }}>
              <Receipt size={20} />
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '8px' }}>
            مسجلة ومتزامنة مع قاعدة البيانات
          </div>
        </div>

        <div
          className="kpi-card card-surface"
          style={{
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            borderTop: '4px solid #3b82f6',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>الإنفاق هذا الشهر</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--ink)', marginTop: '4px' }}>
                {formatCurrency(kpis.monthSpend, currency)}
              </div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '8px' }}>
            مشتريات دورة الشهر الجاري
          </div>
        </div>

        <div
          className="kpi-card card-surface"
          style={{
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            borderTop: '4px solid #8b5cf6',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>الموردون والشركات</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--ink)', marginTop: '4px' }}>
                {kpis.suppliersCount.toLocaleString('ar-EG')} مورد
              </div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: '8px', background: 'rgba(139, 92, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <Building2 size={20} />
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '8px' }}>
            <NavLink to="/purchases/suppliers" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              عرض سجل الموردين ←
            </NavLink>
          </div>
        </div>
      </div>

      {/* مسار التوريد ومؤشرات العمليات */}
      <div
        className="card-surface"
        style={{
          padding: '18px',
          borderRadius: '12px',
          border: '1px solid var(--line)',
          marginBottom: '22px',
        }}
      >
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Truck size={18} style={{ color: 'var(--accent)' }} />
          مؤشرات دورة التوريد والعمليات المسجلة
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          {pipeline.map((step) => (
            <div
              key={step.name}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.02)',
                border: '1px solid var(--line)',
                borderInlineStart: `4px solid ${step.color}`,
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink)' }}>{step.name}</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: step.color, marginTop: '4px' }}>
                {step.isCurrency ? formatCurrency(step.count, currency) : step.count.toLocaleString('ar-EG')}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '4px' }}>{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* جدول أحدث فواتير وحركات الشراء الفعلية */}
      <div
        className="card-surface"
        style={{
          padding: '18px',
          borderRadius: '12px',
          border: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--ink)' }}>
              أحدث فواتير وحركات الشراء والتوريد الفعلية
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
              معاينة سريعة لآخر {filteredPurchases.length} حركة شراء مسجلة في النظام
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} style={{ position: 'absolute', right: '10px', top: '10px', color: 'var(--muted)' }} />
              <input
                type="text"
                placeholder="بحث برقم الفاتورة أو المورد أو الصنف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 30px 7px 10px',
                  borderRadius: '7px',
                  border: '1px solid var(--line)',
                  fontSize: '0.82rem',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                }}
              />
            </div>
            <NavLink
              to="/purchases"
              style={{
                fontSize: '0.82rem',
                color: 'var(--accent)',
                fontWeight: 600,
                textDecoration: 'none',
                padding: '7px 12px',
                borderRadius: '7px',
                border: '1px solid var(--line)',
                background: 'var(--surface)',
              }}
            >
              عرض كافة الفواتير ←
            </NavLink>
          </div>
        </div>

        {filteredPurchases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px', color: 'var(--muted)', fontSize: '0.9rem' }}>
            <Package size={36} style={{ margin: '0 auto 8px', opacity: 0.4, display: 'block' }} />
            لا توجد فواتير أو حركات شراء تطابق بحثك حالياً.
          </div>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right' }}>التاريخ</th>
                  <th style={{ textAlign: 'right' }}>رقم الفاتورة</th>
                  <th style={{ textAlign: 'right' }}>المورد / الشركة</th>
                  <th style={{ textAlign: 'right' }}>الصنف</th>
                  <th style={{ textAlign: 'center' }}>الكمية</th>
                  <th style={{ textAlign: 'center' }}>سعر الوحدة</th>
                  <th style={{ textAlign: 'center' }}>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((m) => {
                  const q = Number(m.qin) || 0
                  const p = Number(m.price) || 0
                  const total = q * p
                  return (
                    <tr key={m.id}>
                      <td>{m.date || '—'}</td>
                      <td>
                        <strong style={{ color: 'var(--ink)' }}>{m.inv || '—'}</strong>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: '#0e7c86' }}>{m.from || '—'}</span>
                      </td>
                      <td>{m.item || '—'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{q.toLocaleString('ar-EG')}</td>
                      <td style={{ textAlign: 'center' }}>{p > 0 ? formatCurrency(p, currency) : '—'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#10b981' }}>
                        {total > 0 ? formatCurrency(total, currency) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
export default ProcurementAnalyticsDashboard
