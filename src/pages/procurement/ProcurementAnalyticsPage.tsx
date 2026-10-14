import { useState, useEffect, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Download,
  PackageCheck,
  RefreshCw,
  Search,
} from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import {
  fetchPurchaseRequests,
  fetchPurchaseOrders,
  fetchSupplierQuotes,
  type PurchaseRequest,
  type PurchaseOrder,
} from '../../lib/procurementRepository'
import type { FixtureMovement } from '../../lib/fixture'
import type { AppSettings } from '../../lib/settings'
import { deriveMovement } from '../../lib/derive'
import { matchesSearch } from '../../lib/searchUtils'

interface ProcurementAnalyticsPageProps {
  session?: Session | null
  movements: FixtureMovement[]
  currency: AppSettings['currency']
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export default function ProcurementAnalyticsPage({
  session: _session,
  movements,
  currency,
}: ProcurementAnalyticsPageProps) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [quotesCountMap, setQuotesCountMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [reqList, poList] = await Promise.all([
        fetchPurchaseRequests(),
        fetchPurchaseOrders(),
      ])
      setRequests(reqList)
      setPurchaseOrders(poList)

      // Count quotes for each request that is pending or approved
      const counts: Record<string, number> = {}
      for (const req of reqList.slice(0, 15)) {
        try {
          const qList = await fetchSupplierQuotes(req.id)
          counts[req.id] = qList.length
        } catch {
          counts[req.id] = 0
        }
      }
      setQuotesCountMap(counts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات التحليلات.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []) // 'YYYY-MM'

  // KPI Calculations strictly from Data
  const kpis = useMemo(() => {
    // 1. بانتظار الموافقة = طلبات status = pending
    const pendingApprovalsCount = requests.filter((r) => r.status === 'pending').length

    // 2. أوامر شراء مفتوحة = purchase_orders status = open
    const openOrdersCount = purchaseOrders.filter((po) => po.status === 'open').length

    // 3. أوامر متأخرة = open AND expected_delivery_date < today
    const overdueOrdersCount = purchaseOrders.filter(
      (po) => po.status === 'open' && po.expected_delivery_date && po.expected_delivery_date < todayStr
    ).length

    // 4. الإنفاق هذا الشهر = مجموع (الكمية × سعر الوحدة) لفواتير movements في الشهر الحالي
    let monthSpend = 0
    for (let i = 0; i < movements.length; i++) {
      const m = movements[i]
      const qtyIn = Number(m.qin) || 0
      if (qtyIn > 0) {
        const dateStr = (m.date || '').slice(0, 7)
        if (dateStr === currentMonthStr) {
          const derived = deriveMovement(m, i)
          const lineVal = derived.total ?? (qtyIn * (Number(m.price) || 0))
          monthSpend += lineVal
        }
      }
    }

    return {
      pendingApprovalsCount,
      openOrdersCount,
      overdueOrdersCount,
      monthSpend,
    }
  }, [requests, purchaseOrders, movements, todayStr, currentMonthStr])

  // 5-Stage Pipeline (مسار الطلبات 5 مراحل)
  const pipeline = useMemo(() => {
    // 1. طلب شراء = غير المرفوضة ومستثنى منها المسودة
    const stage1 = requests.filter((r) => r.status !== 'rejected' && r.status !== 'draft').length

    // 2. موافقات = pending
    const stage2 = requests.filter((r) => r.status === 'pending').length

    // 3. أمر شراء = open
    const stage3 = purchaseOrders.filter((po) => po.status === 'open').length

    // 4. استلام = received
    const stage4 = purchaseOrders.filter((po) => po.status === 'received').length

    // 5. فاتورة = invoiced
    const stage5 = purchaseOrders.filter((po) => po.status === 'invoiced').length

    const maxVal = Math.max(1, stage1, stage2, stage3, stage4, stage5)

    return [
      { name: '1. طلب شراء', count: stage1, color: '#0e7c86', desc: 'طلبات سارية بالمسار' },
      { name: '2. موافقات', count: stage2, color: '#f59e0b', desc: 'بانتظار دورة الاعتماد' },
      { name: '3. أمر شراء', count: stage3, color: '#3b82f6', desc: 'أوامر مفتوحة للتوريد' },
      { name: '4. استلام', count: stage4, color: '#10b981', desc: 'تم الاستلام والفحص' },
      { name: '5. فاتورة', count: stage5, color: '#8b5cf6', desc: 'مفوترة ومكتملة' },
    ].map((step) => ({
      ...step,
      pct: Math.round((step.count / maxVal) * 100),
    }))
  }, [requests, purchaseOrders])

  // Data-driven Alerts
  const alerts = useMemo(() => {
    const list: Array<{ id: string; type: 'danger' | 'warn' | 'info'; title: string; message: string; link?: string }> = []

    // 1. Overdue POs
    const overdueList = purchaseOrders.filter(
      (po) => po.status === 'open' && po.expected_delivery_date && po.expected_delivery_date < todayStr
    )
    for (const po of overdueList) {
      list.push({
        id: `overdue-${po.id}`,
        type: 'danger',
        title: `أمر شراء متأخر: ${po.po_no}`,
        message: `المورد «${po.supplier_name}» تجاوز موعد التسليم المحدد في ${po.expected_delivery_date}.`,
        link: '/purchases/quotes',
      })
    }

    // 2. Pending Decisions
    const pendingList = requests.filter((r) => r.status === 'pending')
    for (const req of pendingList.slice(0, 3)) {
      list.push({
        id: `pending-${req.id}`,
        type: 'warn',
        title: `طلب شراء بانتظار الاعتماد: ${req.request_no}`,
        message: `قسم «${req.department}» بانتظار استكمال مسار الموافقات (القيمة التقديرية: ${formatCurrency(req.total_estimated_value || 0, currency)}).`,
        link: '/purchases/requests',
      })
    }

    // 3. Ready for comparison (>= 2 quotes and no quote selected)
    for (const req of requests) {
      if (req.status === 'approved' && !req.selected_quote_id) {
        const count = quotesCountMap[req.id] || 0
        if (count >= 2) {
          list.push({
            id: `quotes-ready-${req.id}`,
            type: 'info',
            title: `عروض جاهزة للمقارنة: ${req.request_no}`,
            message: `تم استلام ${count} عروض أسعار للطلب والطلب معتمد، يمكن الآن اختيار العرض الفائز وإصدار أمر الشراء.`,
            link: '/purchases/quotes',
          })
        }
      }
    }

    return list
  }, [purchaseOrders, requests, quotesCountMap, todayStr, currency])

  // Filtered recent 5 requests
  const recentRequests = useMemo(() => {
    let list = requests
    if (searchTerm.trim()) {
      list = list.filter((r) =>
        matchesSearch([r.request_no, r.department, r.requested_by, r.items_summary], searchTerm)
      )
    }
    return list.slice(0, 5)
  }, [requests, searchTerm])

  async function handleExportExcel() {
    const XLSX = await import('xlsx')
    const kpiRows = [
      { 'المؤشر': 'بانتظار الموافقة', 'القيمة': kpis.pendingApprovalsCount },
      { 'المؤشر': 'أوامر شراء مفتوحة', 'القيمة': kpis.openOrdersCount },
      { 'المؤشر': 'أوامر متأخرة عن موعدها', 'القيمة': kpis.overdueOrdersCount },
      { 'المؤشر': 'الإنفاق هذا الشهر', 'القيمة': kpis.monthSpend },
    ]
    const pipelineRows = pipeline.map((p) => ({
      'المرحلة': p.name,
      'العدد': p.count,
      'الوصف': p.desc,
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'مؤشرات الأداء')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pipelineRows), 'مسار المراحل')
    XLSX.writeFile(wb, `تقرير-تحليلات-المشتريات-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <section className="movement-page card-surface purchases-page procurement-analytics-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="analytics" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '16px' }}>
        <div>
          <h2>
            <BarChart3 size={20} />
            {' '}
            تحليلات ومسار إدارة المشتريات
          </h2>
          <span>مؤشرات الأداء اللحظية، مسار المراحل الخمس، تنبيهات التوريد، ومتابعة الإنفاق المالي</span>
        </div>
        <div className="headline-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={handleExportExcel}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Download size={16} /> تصدير تقرير التحليلات
          </button>
        </div>
      </div>

      {loading ? (
        <div className="table-loading" style={{ textAlign: 'center', padding: '50px', color: 'var(--muted)' }}>
          <RefreshCw size={26} className="spin-icon" style={{ marginBottom: '10px' }} />
          <div>جارٍ حساب مؤشرات الأداء من قاعدة البيانات...</div>
        </div>
      ) : error ? (
        <div className="inline-message error" style={{ padding: '20px', borderRadius: '10px' }}>
          <AlertTriangle size={20} />
          <span>{error}</span>
          <button type="button" className="secondary-btn" onClick={() => loadData()} style={{ marginInlineStart: '12px' }}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {/* 4 Real Data KPIs */}
          <div className="purchases-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            <div className="kpi-card" style={{ padding: '18px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.07)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#d97706' }}>
                <Clock size={20} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>بانتظار الموافقة</span>
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
                {kpis.pendingApprovalsCount.toLocaleString('ar-EG')}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>طلب شراء قيد دورة الاعتماد</span>
            </div>

            <div className="kpi-card" style={{ padding: '18px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.07)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#2563eb' }}>
                <PackageCheck size={20} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>أوامر شراء مفتوحة</span>
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
                {kpis.openOrdersCount.toLocaleString('ar-EG')}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>أمر شراء صادر قيد التوريد</span>
            </div>

            <div className="kpi-card" style={{ padding: '18px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.07)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#dc2626' }}>
                <AlertCircle size={20} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>طلبات / أوامر متأخرة</span>
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '8px', color: kpis.overdueOrdersCount > 0 ? '#dc2626' : 'var(--ink)' }}>
                {kpis.overdueOrdersCount.toLocaleString('ar-EG')}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>تجاوزت تاريخ التوريد المتوقع</span>
            </div>

            <div className="kpi-card" style={{ padding: '18px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.07)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#059669' }}>
                <CircleDollarSign size={20} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>الإنفاق هذا الشهر</span>
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: '#059669' }}>
                {formatCurrency(kpis.monthSpend, currency)}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>إجمالي التوريدات لشهر {currentMonthStr}</span>
            </div>
          </div>

          {/* 5-Stage Pipeline (مسار الطلبات) */}
          <div className="card-surface" style={{ padding: '20px', borderRadius: '10px', border: '1px solid var(--line)', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.05rem', margin: '0 0 6px 0', color: 'var(--ink)' }}>
              مسار المراحل الخمس لعمليات الشراء (Procurement Funnel)
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '0 0 20px 0' }}>
              متابعة تتابع تدفق الطلبات من مرحلة التقديم حتى الاستلام والفاتورة النهائية
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
              {pipeline.map((stage) => (
                <div
                  key={stage.name}
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: stage.color, marginBottom: '6px' }}>
                    {stage.name}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink)' }}>
                    {stage.count.toLocaleString('ar-EG')}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '4px' }}>
                    {stage.desc}
                  </div>
                  <div
                    style={{
                      height: '4px',
                      background: stage.color,
                      width: `${stage.pct}%`,
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Section: Data-driven Alerts & Recent Requests */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Alerts Panel */}
            <div className="card-surface" style={{ padding: '20px', borderRadius: '10px', border: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={19} color="#d97706" />
                تنبيهات المشتريات والتوريد اللحظية
              </h3>

              {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--muted)' }}>
                  <CheckCircle2 size={36} color="#059669" style={{ opacity: 0.6, marginBottom: '8px' }} />
                  <div style={{ fontWeight: 600 }}>لا توجد تنبيهات</div>
                  <p style={{ fontSize: '0.82rem', margin: '4px 0 0 0' }}>كافة أوامر الشراء وطلبات الاعتماد منتظمة ومستقرة.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {alerts.map((alt) => (
                    <div
                      key={alt.id}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: alt.type === 'danger' ? 'rgba(239, 68, 68, 0.06)' : alt.type === 'warn' ? 'rgba(245, 158, 11, 0.06)' : 'rgba(14, 124, 134, 0.06)',
                        border: `1px solid ${alt.type === 'danger' ? 'rgba(239, 68, 68, 0.2)' : alt.type === 'warn' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(14, 124, 134, 0.2)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: alt.type === 'danger' ? '#dc2626' : alt.type === 'warn' ? '#d97706' : 'var(--accent)' }}>
                          {alt.title}
                        </span>
                        {alt.link && (
                          <NavLink to={alt.link} style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                            عرض ←
                          </NavLink>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink)', lineHeight: '1.5' }}>
                        {alt.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent 5 Requests Panel */}
            <div className="card-surface" style={{ padding: '20px', borderRadius: '10px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '1.05rem', margin: 0 }}>
                  أحدث طلبات الشراء
                </h3>
                <NavLink
                  to="/purchases/requests"
                  className="secondary-btn"
                  style={{ fontSize: '0.8rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  عرض كافة الطلبات ({requests.length}) <ArrowRight size={14} />
                </NavLink>
              </div>

              {/* Search */}
              <div style={{ position: 'relative', marginBottom: '12px' }}>
                <Search size={15} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '10px', color: 'var(--muted)' }} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ابحث برقم الطلب أو القسم..."
                  style={{ width: '100%', padding: '6px 30px 6px 10px', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                />
              </div>

              {recentRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  لا توجد طلبات مسجلة مطابقة.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentRequests.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)' }}>
                          {req.request_no}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                          {req.department} • {req.items_summary}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                          {formatCurrency(req.total_estimated_value || 0, currency)}
                        </div>
                        <div>
                          {req.status === 'draft' && <span className="badge neutral">مسودة</span>}
                          {req.status === 'pending' && <span className="badge info">قيد الموافقة</span>}
                          {req.status === 'approved' && <span className="badge ok">معتمد</span>}
                          {req.status === 'rejected' && <span className="badge danger">مرفوض</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
