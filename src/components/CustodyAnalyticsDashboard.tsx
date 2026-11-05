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
import { formatCurrency } from '../lib/currency'

interface CustodyAnalyticsDashboardProps {
  items: CustodyItem[]
  currency: AppSettings['currency']
  onSelectWarehouse: (warehouseId: string) => void
  onExportAllExcel: () => void
}

const formatMoney = (amount: number, currency: string) => formatCurrency(amount, currency)

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
    <div className="custody-analytics-dashboard animate-fade-in flex flex-col gap-4">
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
          onClick={onExportAllExcel}
          title="تصدير ملف Excel متعدد الصفحات يحتوي على صفحة لكل كلية + صفحة ملخص عام"
         className="highlight-action-btn secondary-btn flex items-center gap-2 p-3 font-sm">
          <FileSpreadsheet size={17} />
          <span>تصدير سجل الجرد الموحد (Excel شامل لكافة الكليات)</span>
        </button>
      </div>

      {/* 2. Grand Total KPI Cards */}
      <div className="custody-kpis-grid custody-kpis-grid-fit">
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
            <div className="flex items-center gap-2 font-bold text-ink">
              <Building2 size={18} className="text-accent" />
              <span>توزيع القيمة المالية للأصول بين الكليات والمخازن</span>
            </div>
            <span className="font-xs text-muted">مرتبة حسب القيمة</span>
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
                    <div className="flex items-center gap-2">
                      <span className="font-semibold font-sm text-ink">{wh.name}</span>
                      {wh.isHub && (
                        <span className="custody-dash-wh-hub-badge">
                          المغذي
                        </span>
                      )}
                      <span className="font-xs text-muted">({wh.itemsCount} بند)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <strong className="font-sm text-ink">{formatMoney(wh.stats.totalValue, currency)}</strong>
                      <span className="font-xs text-accent font-bold">{wh.sharePercentage}%</span>
                      <ArrowUpRight size={14} className="text-muted" />
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
        <div className="flex flex-col gap-4">
          {/* Categories Distribution */}
          <div className="card-surface custody-dash-wh-card">
            <div className="flex items-center gap-2 font-bold text-ink mb-3">
              <Boxes size={18} className="text-accent" />
              <span>توزيع الأصول حسب التصنيفات الرئيسية</span>
            </div>

            <div className="flex flex-col gap-2">
              {categoryStats.map((cat) => (
                <div
                  key={cat.category}
                  className="custody-dash-cat-item"
                >
                  <span className="font-semibold text-ink">{cat.category}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted font-xs">{cat.count} صنف ({cat.units} وحدة)</span>
                    <strong className="text-accent">{formatMoney(cat.value, currency)}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Condition Health Status */}
          <div className="card-surface custody-dash-wh-card">
            <div className="flex items-center gap-2 font-bold text-ink mb-3">
              <PieChart size={18} className="text-accent" />
              <span>الحالة الفنية التراكمية لأصول المؤسسة</span>
            </div>

            <div className="custody-dash-condition-grid">
              <div className="custody-dash-condition-box" data-condition="excellent">
                <div className="flex items-center gap-1 font-xs font-semibold">
                  <CheckCircle2 size={16} /> ممتازة (جاهزة للعمل)
                </div>
                <div className="text-lg font-bold text-ink mt-1">
                  {overallStats.excellent.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="good">
                <div className="flex items-center gap-1 font-xs font-semibold">
                  <ShieldCheck size={16} /> جيدة (تعمل بكفاءة)
                </div>
                <div className="text-lg font-bold text-ink mt-1">
                  {overallStats.good.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="maintenance">
                <div className="flex items-center gap-1 font-xs font-semibold">
                  <Wrench size={16} /> تتطلب صيانة / فحص
                </div>
                <div className="text-lg font-bold text-ink mt-1">
                  {overallStats.maintenance.toLocaleString('ar-EG')} صنف
                </div>
              </div>

              <div className="custody-dash-condition-box" data-condition="damaged">
                <div className="flex items-center gap-1 font-xs font-semibold">
                  <Ban size={16} /> تالفة / كهنة
                </div>
                <div className="text-lg font-bold text-ink mt-1">
                  {overallStats.damaged.toLocaleString('ar-EG')} صنف
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Top 5 Highest-Value Assets */}
      <div className="card-surface custody-dash-wh-card">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-ink font-sm">
            🏆 أعلى الأصول قيمة دفترية مسجلة في المؤسسة
          </div>
          <span className="font-xs text-muted">تحديد أولويات التأمين والمتابعة الدورية</span>
        </div>

        <div className="table-responsive">
          <table className="custody-table m-0">
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
                    <td className="font-semibold">{asset.name}</td>
                    <td>{wh?.name || asset.warehouseId}</td>
                    <td>{asset.category}</td>
                    <td className="font-bold">{asset.quantity} {asset.unit}</td>
                    <td>{asset.unitPrice ? formatMoney(asset.unitPrice, currency) : '—'}</td>
                    <td className="text-accent font-bold">{formatMoney(asset.value, currency)}</td>
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
