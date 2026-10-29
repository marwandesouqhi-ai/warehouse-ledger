import { useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  TrendingUp,
  Building2,
  Calendar,
} from 'lucide-react'
import type { FixtureMovement } from '../lib/fixture'
import type { CustodyItem } from '../lib/custody'
import { WAREHOUSES } from '../lib/custody'

type InventoryAnalyticsPageProps = {
  session?: Session | null
  movements?: FixtureMovement[]
  custodyItems?: CustodyItem[]
  currency?: string
}

export default function InventoryAnalyticsPage({
  movements = [],
  custodyItems = [],
  currency = 'EGP',
}: InventoryAnalyticsPageProps) {

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: currency || 'EGP', maximumFractionDigits: 0 }).format(val)
  }

  // 1. حساب إحصائيات عامة
  const stats = useMemo(() => {
    let totalInQty = 0
    let totalOutQty = 0
    let totalValue = 0

    const itemMap = new Map<string, { totalIn: number; totalOut: number; lastPrice: number; invCount: number }>()

    movements.forEach((m) => {
      const qin = Number(m.qin) || 0
      const qout = Number(m.qout) || 0
      const price = Number(m.price) || 0

      totalInQty += qin
      totalOutQty += qout
      totalValue += qin * price

      const key = m.item.trim()
      const existing = itemMap.get(key) || { totalIn: 0, totalOut: 0, lastPrice: price, invCount: 0 }
      existing.totalIn += qin
      existing.totalOut += qout
      existing.invCount += 1
      if (price > 0) existing.lastPrice = price
      itemMap.set(key, existing)
    })

    const netUnits = Math.max(0, totalInQty - totalOutQty)
    const turnoverRate = totalInQty > 0 ? ((totalOutQty / totalInQty) * 100).toFixed(1) : '0'

    // أكثر 10 أصناف حركة
    const topMovingItems = Array.from(itemMap.entries())
      .map(([name, data]) => ({
        name,
        ...data,
        remQty: Math.max(0, data.totalIn - data.totalOut),
        totalVal: data.totalIn * data.lastPrice,
        turnover: data.totalIn > 0 ? Math.round((data.totalOut / data.totalIn) * 100) : 0,
      }))
      .sort((a, b) => b.totalIn - a.totalIn)
      .slice(0, 10)

    return {
      totalInQty,
      totalOutQty,
      totalValue,
      netUnits,
      turnoverRate,
      distinctCount: itemMap.size,
      topMovingItems,
    }
  }, [movements])

  // 2. تجميع شهري
  const monthlyBreakdown = useMemo(() => {
    const months: Record<string, { month: string; inQty: number; outQty: number; inVal: number; count: number }> = {}

    movements.forEach((m) => {
      const dateStr = m.date || '2026-10-01'
      const ym = dateStr.slice(0, 7) // YYYY-MM
      if (!months[ym]) {
        months[ym] = { month: ym, inQty: 0, outQty: 0, inVal: 0, count: 0 }
      }
      const qin = Number(m.qin) || 0
      const qout = Number(m.qout) || 0
      const price = Number(m.price) || 0

      months[ym].inQty += qin
      months[ym].outQty += qout
      months[ym].inVal += qin * price
      months[ym].count += 1
    })

    return Object.values(months).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 8)
  }, [movements])

  // 3. توزيع العهدة على المخازن
  const warehouseBreakdown = useMemo(() => {
    return WAREHOUSES.map((w) => {
      const itemsInWarehouse = custodyItems.filter((i) => i.warehouseId === w.id)
      const count = itemsInWarehouse.length
      const totalUnits = itemsInWarehouse.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
      const totalValue = itemsInWarehouse.reduce((sum, i) => sum + (Number(i.value) || 0), 0)
      return {
        ...w,
        count,
        totalUnits,
        totalValue,
      }
    }).sort((a, b) => b.totalValue - a.totalValue)
  }, [custodyItems])

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <BarChart3 size={24} />
        </div>
        <div>
          <p className="eyebrow">ذكاء الأعمال والتحليلات • جامعة الزقازيق الأهلية</p>
          <h2>لوحة تحليلات المخزون وسرعة الدوران</h2>
          <p>مؤشرات الأداء المخزني، اتجاهات الوارد والمنصرف، وتوزيع الأصول بين الكليات والمخازن</p>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">قيمة المخزون الإجمالية</span>
            <span className="badge-pill">التوريدات</span>
          </div>
          <div className="kpi-value">{formatMoney(stats.totalValue)}</div>
          <div className="kpi-sub">إجمالي قيمة فواتير التوريد المسجلة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">معدل دوران المخزون</span>
            <span className="badge-pill highlight">{stats.turnoverRate}%</span>
          </div>
          <div className="kpi-value text-emerald-500">{stats.turnoverRate}%</div>
          <div className="kpi-sub">نسبة المنصرف الفعلي إلى إجمالي الوارد</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">صافي الوحدات بالمستودعات</span>
            <span className="badge-pill">رصيد متاح</span>
          </div>
          <div className="kpi-value text-cyan-500">{stats.netUnits.toLocaleString('ar-EG')}</div>
          <div className="kpi-sub">من أصل {stats.totalInQty.toLocaleString('ar-EG')} وحدة واردة</div>
        </div>

        <div className="card-surface kpi-card">
          <div className="kpi-head">
            <span className="kpi-label">الأصناف المسجلة النشطة</span>
            <span className="badge-pill">تنوع الأصناف</span>
          </div>
          <div className="kpi-value text-purple-500">{stats.distinctCount}</div>
          <div className="kpi-sub">صنف ومعدة ومستلزم عبر 8 مخازن</div>
        </div>
      </div>

      {/* Grid: 2 Columns for Deep Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Moving Items */}
        <div className="card-surface p-5">
          <div className="section-head mb-4">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <TrendingUp size={18} className="text-primary" />
                أكثر 10 أصناف طلباً وتوريداً
              </h3>
              <span className="text-xs text-muted">ترتيب الأصناف بحسب إجمالي كميات التوريد ومعدل الاستهلاك</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/20 text-xs border-b">
                <tr>
                  <th className="p-2">الصنف</th>
                  <th className="p-2">الوارد</th>
                  <th className="p-2">المنصرف</th>
                  <th className="p-2">المتبقي</th>
                  <th className="p-2">نسبة الصرف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {stats.topMovingItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/10">
                    <td className="p-2 font-medium max-w-xs truncate">{item.name}</td>
                    <td className="p-2 text-emerald-600 font-semibold">+{item.totalIn}</td>
                    <td className="p-2 text-amber-600 font-semibold">-{item.totalOut}</td>
                    <td className="p-2 font-bold">{item.remQty}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-muted/40 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${Math.min(100, item.turnover)}%` }}
                          />
                        </div>
                        <span className="text-xs">{item.turnover}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Trend Breakdown */}
        <div className="card-surface p-5">
          <div className="section-head mb-4">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <Calendar size={18} className="text-primary" />
                المقارنة الشهرية لحركة المخازن
              </h3>
              <span className="text-xs text-muted">تحليل تطور التوريد والصرف خلال الأشهر المسجلة</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/20 text-xs border-b">
                <tr>
                  <th className="p-2">الشهر</th>
                  <th className="p-2">عدد الحركات</th>
                  <th className="p-2">كمية الوارد</th>
                  <th className="p-2">كمية المنصرف</th>
                  <th className="p-2">القيمة الإجمالية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {monthlyBreakdown.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/10">
                    <td className="p-2 font-bold text-primary">{row.month}</td>
                    <td className="p-2">{row.count} عملية</td>
                    <td className="p-2 text-emerald-600 font-semibold">+{row.inQty}</td>
                    <td className="p-2 text-amber-600 font-semibold">-{row.outQty}</td>
                    <td className="p-2 font-bold">{formatMoney(row.inVal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Warehouse Distribution */}
      <div className="card-surface p-5">
        <div className="section-head mb-4">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <Building2 size={18} className="text-primary" />
              توزيع الأصول والعهدة على كليات ومخازن الجامعة
            </h3>
            <span className="text-xs text-muted">حجم الرصيد الفعلي وعدد البنود المحفوظة في كل مخزن</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {warehouseBreakdown.map((wh) => (
            <div key={wh.id} className="p-4 rounded-xl border border-border/70 bg-card/60">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm truncate">{wh.name}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-muted/40">{wh.shortName}</span>
              </div>
              <div className="text-xs text-muted mb-2">{wh.building}</div>
              <div className="text-lg font-bold text-primary mb-1">{wh.totalUnits.toLocaleString('ar-EG')} وحدة</div>
              <div className="text-xs text-muted">{wh.count} صنف مسجل بالعهدة</div>
              {wh.totalValue > 0 && (
                <div className="mt-2 text-xs font-semibold text-emerald-600">
                  {formatMoney(wh.totalValue)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

