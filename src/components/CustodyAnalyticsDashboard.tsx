import React, { useMemo } from 'react'
import {
  Building2,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Package,
  Boxes,
  PieChart,
  BarChart3,
  TrendingUp,
  ShieldCheck,
  Wrench,
  Ban,
  ArrowUpRight,
} from 'lucide-react'
import { WAREHOUSES, getWarehouseStats, type CustodyItem } from '../lib/custody'
import type { AppSettings } from '../lib/settings'

interface CustodyAnalyticsDashboardProps {
  items: CustodyItem[]
  currency: AppSettings['currency']
  onSelectWarehouse: (warehouseId: string) => void
  onExportAllExcel: () => void
}

function formatMoney(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export const CustodyAnalyticsDashboard: React.FC<CustodyAnalyticsDashboardProps> = ({
  items,
  currency,
  onSelectWarehouse,
  onExportAllExcel,
}) => {
  // 1. Overall stats across all warehouses
  const overallStats = useMemo(() => {
    return getWarehouseStats(items)
  }, [items])

  // 2. Per-warehouse statistics
  const warehouseBreakdown = useMemo(() => {
    return WAREHOUSES.map((wh) => {
      const whItems = items.filter((i) => i.warehouseId === wh.id)
      const stats = getWarehouseStats(whItems)
      const sharePercentage = overallStats.totalValue > 0 ? Math.round((stats.totalValue / overallStats.totalValue) * 100) : 0
      return {
        ...wh,
        stats,
        itemsCount: whItems.length,
        sharePercentage,
      }
    }).sort((a, b) => b.stats.totalValue - a.stats.totalValue)
  }, [items, overallStats.totalValue])

  // Max value among warehouses for bar normalization
  const maxWarehouseValue = useMemo(() => {
    return Math.max(...warehouseBreakdown.map((w) => w.stats.totalValue), 1)
  }, [warehouseBreakdown])

  // 3. Category breakdown
  const categoryStats = useMemo(() => {
    const map: Record<string, { count: number; units: number; value: number }> = {}
    for (const item of items) {
      const cat = item.category || 'أخرى'
      if (!map[cat]) map[cat] = { count: 0, units: 0, value: 0 }
      map[cat].count++
      map[cat].units += Number(item.quantity) || 0
      map[cat].value += Number(item.value) || 0
    }
    return Object.entries(map)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.value - a.value)
  }, [items])

  // 4. Top 5 highest-value assets in university
  const topValuableAssets = useMemo(() => {
    return [...items]
      .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
      .slice(0, 5)
  }, [items])

  return (
    <div className="custody-analytics-dashboard animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* 1. Header Banner */}
      <div className="custody-dash-banner card-surface">
        <div className="custody-dash-banner-lead">
          <div className="custody-dash-icon-box">
            <BarChart3 size={24} />
          </div>
          <div>
            <h3 className="custody-dash-banner-title">
              لوحة التقارير والتحليلات الإحصائية لأصول وعهد المؤسسة
            </h3>
            <span className="custody-dash-banner-sub">
              تحليل مركزي مباشر يوضح توزيع القيمة المالية ونسب الصلاحية الفنية عبر كافة الكليات والمخازن الـ 8
            </span>
          </div>
        </div>

        <button
          type="button"
          className="highlight-action-btn"
          onClick={onExportAllExcel}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: 'var(--text-sm)' }}
          title="تصدير ملف Excel متعدد الصفحات يحتوي على صفحة لكل كلية + صفحة ملخص عام"
        >
          <FileSpreadsheet size={17} />
          <span>تصدير سجل الجرد الموحد (Excel شامل لكافة الكليات)</span>
        </button>
      </div>

      {/* 2. Grand Total KPI Cards */}
      <div className="custody-kpis-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="custody-kpi-card card-surface tone-emerald">
          <div className="kpi-mini-head">
            <span>إجمالي القيمة الدفترية للأصول</span>
            <TrendingUp size={17} />
          </div>
          <strong className="kpi-big-num">{formatMoney(overallStats.totalValue, currency)}</strong>
          <small className="kpi-mini-sub">إجمالي استثمارات كافة الكليات الـ 8</small>
        </div>

        <div className="custody-kpi-card card-surface tone-teal">
          <div className="kpi-mini-head">
            <span>إجمالي بنود العهدة المسجلة</span>
            <Package size={17} />
          </div>
          <strong className="kpi-big-num">{overallStats.totalItems.toLocaleString('ar-EG')} بند</strong>
          <small className="kpi-mini-sub">{overallStats.totalUnits.toLocaleString('ar-EG')} قطعة / جهاز فعلي</small>
        </div>

        <div className="custody-kpi-card card-surface tone-blue">
          <div className="kpi-mini-head">
            <span>نسبة الجاهزية والصلاحية الفنية</span>
            <ShieldCheck size={17} />
          </div>
          <strong className="kpi-big-num">{overallStats.healthyRatio}%</strong>
          <small className="kpi-mini-sub">
            {(overallStats.excellent + overallStats.good).toLocaleString('ar-EG')} صنف بحالة ممتازة وجيدة
          </small>
        </div>

        <div className="custody-kpi-card card-surface tone-amber">
          <div className="kpi-mini-head">
            <span>أصول تتطلب صيانة أو فحص</span>
            <AlertTriangle size={17} />
          </div>
          <strong className="kpi-big-num">
            {(overallStats.maintenance + overallStats.damaged).toLocaleString('ar-EG')} صنف
          </strong>
          <small className="kpi-mini-sub">
            {overallStats.maintenance} قيد الصيانة • {overallStats.damaged} كهنة وتالف
          </small>
        </div>
      </div>

      {/* 3. Main Chart Sections: Warehouses Financial Breakdown */}
      <div className="custody-dash-split-grid">
        {/* Warehouses Comparative Chart */}
        <div className="card-surface custody-dash-wh-card">
          <div className="custody-dash-wh-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--ink)' }}>
              <Building2 size={18} style={{ color: 'var(--accent)' }} />
              <span>توزيع القيمة المالية للأصول بين الكليات والمخازن</span>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>مرتبة حسب القيمة</span>
          </div>

          <div className="custody-dash-wh-list">
            {warehouseBreakdown.map((wh) => {
              const barWidth = Math.max(4, Math.round((wh.stats.totalValue / maxWarehouseValue) * 100))
              return (
                <div
                  key={wh.id}
                  className="custody-dash-wh-item"
                  onClick={() => onSelectWarehouse(wh.id)}
                  title={`انتقل لعرض عهدة ${wh.name}`}
                  role="button"
                  tabIndex={0}
                >
                  <div className="custody-dash-wh-top-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{wh.name}</span>
                      {wh.isHub && (
                        <span className="custody-dash-wh-hub-badge">
                          المغذي
                        </span>
                      )}
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>({wh.itemsCount} بند)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{formatMoney(wh.stats.totalValue, currency)}</strong>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 700 }}>{wh.sharePercentage}%</span>
                      <ArrowUpRight size={14} style={{ color: 'var(--muted)' }} />
                    </div>
                  </div>

                  {/* Visual Bar */}
                  <div className="custody-dash-bar-track">
                    <div
                      className="custody-dash-bar-fill"
                      style={{
                        width: `${barWidth}%`,
                        opacity: wh.stats.totalValue > 0 ? 1 : 0,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Technical Condition Matrix & Categories */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {/* Categories Distribution */}
          <div className="card-surface custody-dash-wh-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--ink)', marginBottom: 'var(--sp-3)' }}>
              <Boxes size={18} style={{ color: 'var(--accent)' }} />
              <span>توزيع الأصول حسب التصنيفات الرئيسية</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {categoryStats.map((cat) => (
                <div
                  key={cat.category}
                  className="custody-dash-cat-item"
                >
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{cat.category}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{cat.count} صنف ({cat.units} وحدة)</span>
                    <strong style={{ color: 'var(--accent)' }}>{formatMoney(cat.value, currency)}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Condition Health Status */}
          <div className="card-surface custody-dash-wh-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--ink)', marginBottom: 'var(--sp-3)' }}>
              <PieChart size={18} style={{ color: 'var(--accent)' }} />
              <span>الحالة الفنية التراكمية لأصول المؤسسة</span>
            </div>

            <div className="custody-dash-condition-grid">
              <div className="custody-dash-condition-box" data-condition="excellent">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  <CheckCircle2 size={16} /> ممتازة (جاهزة للعمل)
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--ink)', marginTop: '4px' }}>
                  {overallStats.excellent.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="good">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  <ShieldCheck size={16} /> جيدة (تعمل بكفاءة)
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--ink)', marginTop: '4px' }}>
                  {overallStats.good.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="maintenance">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  <Wrench size={16} /> تتطلب صيانة / فحص
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--ink)', marginTop: '4px' }}>
                  {overallStats.maintenance.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="damaged">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  <Ban size={16} /> تالفة / كهنة
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--ink)', marginTop: '4px' }}>
                  {overallStats.damaged.toLocaleString('ar-EG')} صنف
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Top 5 Highest-Value Assets */}
      <div className="card-surface custody-dash-wh-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
          <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
            🏆 أعلى الأصول قيمة دفترية مسجلة في المؤسسة
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>تحديد أولويات التأمين والمتابعة الدورية</span>
        </div>

        <div className="table-responsive">
          <table className="custody-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>كود العهدة</th>
                <th>اسم الصنف</th>
                <th>المخزن / الكلية</th>
                <th>التصنيف</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>إجمالي القيمة</th>
                <th>الحالة الفنية</th>
              </tr>
            </thead>
            <tbody>
              {topValuableAssets.map((asset) => {
                const wh = WAREHOUSES.find((w) => w.id === asset.warehouseId)
                return (
                  <tr key={asset.id}>
                    <td><code>{asset.code}</code></td>
                    <td style={{ fontWeight: 600 }}>{asset.name}</td>
                    <td>{wh?.name || asset.warehouseId}</td>
                    <td>{asset.category}</td>
                    <td style={{ fontWeight: 700 }}>{asset.quantity} {asset.unit}</td>
                    <td>{asset.unitPrice ? formatMoney(asset.unitPrice, currency) : '—'}</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{formatMoney(asset.value, currency)}</td>
                    <td>
                      <span className={`status-pill ${asset.condition === 'excellent' || asset.condition === 'good' ? 'status-pill-ok' : 'status-pill-warn'}`}>
                        {asset.condition === 'excellent' ? 'ممتازة' : asset.condition === 'good' ? 'جيدة' : asset.condition === 'maintenance' ? 'صيانة' : 'كهنة'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
