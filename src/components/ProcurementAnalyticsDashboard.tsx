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
      { name: '1. فواتير وتوريدات الشراء', count: totalCount, color: 'var(--chart-1)', desc: 'إجمالي عمليات الشراء المقيدة' },
      { name: '2. فواتير برقم رسمي', count: withInvoice, color: 'var(--chart-2)', desc: 'حركات مسجلة برقم فاتورة معتمد' },
      { name: '3. موردون معتمدون', count: withSupplier, color: 'var(--chart-3)', desc: 'حركات مرتبطة بشركات وموردين' },
      { name: '4. متوسط الفاتورة', count: avgVal, isCurrency: true, color: 'var(--chart-5)', desc: 'معدل الإنفاق لكل فاتورة شراء' },
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
    <div className={`proc-dash-wrapper ${isDashboardEmbed ? 'dashboard-embed' : ''}`}>
      {/* رأس القسم والإجراءات السريعة */}
      <div className="proc-dash-header">
        <div>
          <h2 className={`proc-dash-title ${isDashboardEmbed ? 'text-md' : 'text-lg'}`}>
            <Receipt size={22} className="text-accent" />
            تحليلات وبيانات قسم المشتريات والتوريدات
          </h2>
          <span className="proc-dash-subtitle">
            مؤشرات الإنفاق المالي، متابعة فواتير الشراء المسجلة، وحسابات الموردين في قاعدة البيانات الحقيقية
          </span>
        </div>

        <div className="proc-dash-actions">
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            className="proc-dash-export-btn"
          >
            <Download size={15} />
            تصدير تقرير المشتريات Excel
          </button>

          <NavLink
            to="/purchases?tab=add"
            className="primary-btn"
            
          >
            <Plus size={16} />
            فاتورة وتوريد جديد
          </NavLink>
        </div>
      </div>

      {/* بطاقات المؤشرات الـ 4 الرئيسية */}
      <div className="proc-dash-kpi-grid">
        <div className="proc-dash-kpi-card card-surface" data-tone="emerald">
          <div className="proc-dash-kpi-top">
            <div>
              <div className="proc-dash-kpi-label">إجمالي الإنفاق الفعلي</div>
              <div className="proc-dash-kpi-val">
                {formatCurrency(kpis.totalSpend, currency)}
              </div>
            </div>
            <div className="proc-dash-kpi-icon" data-tone="emerald">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="proc-dash-kpi-sub">
            متوسط الفاتورة: {formatCurrency(kpis.avgInvoice, currency)}
          </div>
        </div>

        <div className="proc-dash-kpi-card card-surface" data-tone="teal">
          <div className="proc-dash-kpi-top">
            <div>
              <div className="proc-dash-kpi-label">حركات وفواتير الشراء</div>
              <div className="proc-dash-kpi-val">
                {kpis.purchasesCount.toLocaleString('ar-EG')} فاتورة
              </div>
            </div>
            <div className="proc-dash-kpi-icon" data-tone="teal">
              <Receipt size={20} />
            </div>
          </div>
          <div className="proc-dash-kpi-sub">
            مسجلة ومتزامنة مع قاعدة البيانات
          </div>
        </div>

        <div className="proc-dash-kpi-card card-surface" data-tone="blue">
          <div className="proc-dash-kpi-top">
            <div>
              <div className="proc-dash-kpi-label">الإنفاق هذا الشهر</div>
              <div className="proc-dash-kpi-val">
                {formatCurrency(kpis.monthSpend, currency)}
              </div>
            </div>
            <div className="proc-dash-kpi-icon" data-tone="blue">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="proc-dash-kpi-sub">
            مشتريات دورة الشهر الجاري
          </div>
        </div>

        <div className="proc-dash-kpi-card card-surface" data-tone="purple">
          <div className="proc-dash-kpi-top">
            <div>
              <div className="proc-dash-kpi-label">الموردون والشركات</div>
              <div className="proc-dash-kpi-val">
                {kpis.suppliersCount.toLocaleString('ar-EG')} مورد
              </div>
            </div>
            <div className="proc-dash-kpi-icon" data-tone="purple">
              <Building2 size={20} />
            </div>
          </div>
          <div className="proc-dash-kpi-sub">
            <NavLink to="/purchases/suppliers" className="text-accent font-semibold">
              عرض سجل الموردين ←
            </NavLink>
          </div>
        </div>
      </div>

      {/* مسار التوريد ومؤشرات العمليات */}
      <div className="proc-dash-pipeline-card card-surface">
        <div className="proc-dash-pipeline-header">
          <Truck size={18} className="text-accent" />
          مؤشرات دورة التوريد والعمليات المسجلة
        </div>
        <div className="proc-dash-pipeline-grid">
          {pipeline.map((step) => (
            <div
              key={step.name}
              className="proc-dash-pipeline-item"
              style={{ borderInlineStartColor: step.color }}
            >
              <div className="proc-dash-pipeline-item-label">{step.name}</div>
              <div className="proc-dash-pipeline-item-val" style={{ color: step.color }}>
                {step.isCurrency ? formatCurrency(step.count, currency) : step.count.toLocaleString('ar-EG')}
              </div>
              <div className="proc-dash-pipeline-item-sub">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* جدول أحدث فواتير وحركات الشراء الفعلية */}
      <div className="proc-dash-recent-card card-surface">
        <div className="proc-dash-recent-header">
          <div>
            <div className="font-sm font-bold text-ink">
              أحدث فواتير وحركات الشراء والتوريد الفعلية
            </div>
            <span className="font-xs text-muted">
              معاينة سريعة لآخر {filteredPurchases.length} حركة شراء مسجلة في النظام
            </span>
          </div>

          <div className="flex gap-2 items-center">
            <div className="input-search-wrap">
              <Search size={14} className="input-search-icon" />
              <input
                type="text"
                placeholder="بحث برقم الفاتورة أو المورد أو الصنف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="proc-dash-search-input"
              />
            </div>
            <NavLink
              to="/purchases"
              className="proc-dash-view-all-link"
            >
              عرض كافة الفواتير ←
            </NavLink>
          </div>
        </div>

        {filteredPurchases.length === 0 ? (
          <div className="proc-dash-empty-state">
            <Package size={36} className="mx-auto mb-2 opacity-50 block" />
            لا توجد فواتير أو حركات شراء تطابق بحثك حالياً.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="custom-table w-full font-xs">
              <thead>
                <tr>
                  <th className="text-right">التاريخ</th>
                  <th className="text-right">رقم الفاتورة</th>
                  <th className="text-right">المورد / الشركة</th>
                  <th className="text-right">الصنف</th>
                  <th className="text-center">الكمية</th>
                  <th className="text-center">سعر الوحدة</th>
                  <th className="text-center">الإجمالي</th>
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
                        <strong className="text-ink">{m.inv || '—'}</strong>
                      </td>
                      <td>
                        <span className="font-semibold text-chart-1">{m.from || '—'}</span>
                      </td>
                      <td>{m.item || '—'}</td>
                      <td className="text-center font-semibold">{q.toLocaleString('ar-EG')}</td>
                      <td className="text-center">{p > 0 ? formatCurrency(p, currency) : '—'}</td>
                      <td className="text-center font-bold text-chart-3">
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
