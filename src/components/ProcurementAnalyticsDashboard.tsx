import { useState, useEffect, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
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
import {
  fetchPurchaseRequests,
  fetchPurchaseOrders,
  fetchSupplierQuotes,
  type PurchaseRequest,
  type PurchaseOrder,
} from '../lib/procurementRepository'
import type { FixtureMovement } from '../lib/fixture'
import type { AppSettings } from '../lib/settings'
import { deriveMovement } from '../lib/derive'
import { matchesSearch } from '../lib/searchUtils'

interface ProcurementAnalyticsDashboardProps {
  movements: FixtureMovement[]
  currency: AppSettings['currency']
  isDashboardEmbed?: boolean
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export function ProcurementAnalyticsDashboard({
  movements,
  currency,
  isDashboardEmbed = false,
}: ProcurementAnalyticsDashboardProps) {
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
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), [])

  // KPI Calculations strictly from Data
  const kpis = useMemo(() => {
    const pendingApprovalsCount = requests.filter((r) => r.status === 'pending').length
    const openOrdersCount = purchaseOrders.filter((po) => po.status === 'open').length
    const overdueOrdersCount = purchaseOrders.filter(
      (po) => po.status === 'open' && po.expected_delivery_date && po.expected_delivery_date < todayStr
    ).length

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

  // 5-Stage Pipeline
  const pipeline = useMemo(() => {
    const stage1 = requests.filter((r) => r.status !== 'rejected' && r.status !== 'draft').length
    const stage2 = requests.filter((r) => r.status === 'pending').length
    const stage3 = purchaseOrders.filter((po) => po.status === 'open').length
    const stage4 = purchaseOrders.filter((po) => po.status === 'received').length
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

  // Alerts
  const alerts = useMemo(() => {
    const list: Array<{ id: string; type: 'danger' | 'warn' | 'info'; title: string; message: string; link?: string }> = []

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

    const pendingList = requests.filter((r) => r.status === 'pending')
    for (const req of pendingList.slice(0, 3)) {
      list.push({
        id: `pending-${req.id}`,
        type: 'warn',
        title: `طلب شراء بانتظار الاعتماد: ${req.request_no}`,
        message: `قسم «${req.department}» بانتظار استكمال مسار الموافقات (القيمة: ${formatCurrency(req.total_estimated_value || 0, currency)}).`,
        link: '/purchases/requests',
      })
    }

    for (const req of requests) {
      if (req.status === 'approved' && !req.selected_quote_id) {
        const count = quotesCountMap[req.id] || 0
        if (count >= 2) {
          list.push({
            id: `quotes-ready-${req.id}`,
            type: 'info',
            title: `عروض جاهزة للمقارنة: ${req.request_no}`,
            message: `تم استلام ${count} عروض أسعار والطلب معتمد، يمكن إصدار أمر الشراء.`,
            link: '/purchases/quotes',
          })
        }
      }
    }

    return list
  }, [purchaseOrders, requests, quotesCountMap, todayStr, currency])

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
    <div className="procurement-analytics-dashboard animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header bar if embedded */}
      {isDashboardEmbed && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--ink)' }}>مؤشرات وتحليلات إدارة المشتريات</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>دورة الشراء، الموافقات المعلقة، وأوامر التوريد لجامعة الزقازيق الأهلية</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void loadData()}
              disabled={loading}
              style={{ fontSize: '0.82rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> تحديث
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleExportExcel()}
              style={{ fontSize: '0.82rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Download size={14} /> تصدير Excel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '8px' }} />
          <div>جارٍ حساب مؤشرات أداء المشتريات...</div>
        </div>
      ) : error ? (
        <div className="inline-message error" style={{ padding: '16px', borderRadius: '10px' }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button type="button" className="secondary-btn" onClick={() => void loadData()} style={{ marginInlineStart: '10px' }}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {/* 1. KPI Metric Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '14px',
            }}
          >
            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>بانتظار الموافقة</span>
                <span style={{ padding: '6px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', color: '#d97706' }}>
                  <Clock size={18} />
                </span>
              </div>
              <div style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--ink)' }}>
                {kpis.pendingApprovalsCount}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
                طلبات شراء قيد مسار الاعتماد
              </div>
            </div>

            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>أوامر شراء مفتوحة</span>
                <span style={{ padding: '6px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb' }}>
                  <PackageCheck size={18} />
                </span>
              </div>
              <div style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--ink)' }}>
                {kpis.openOrdersCount}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
                أوامر توريد سارية مع الموردين
              </div>
            </div>

            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>أوامر متأخرة</span>
                <span style={{ padding: '6px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626' }}>
                  <AlertTriangle size={18} />
                </span>
              </div>
              <div style={{ fontSize: '1.7rem', fontWeight: 800, color: kpis.overdueOrdersCount > 0 ? '#dc2626' : 'var(--ink)' }}>
                {kpis.overdueOrdersCount}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
                تجاوزت تاريخ التسليم المتوقع
              </div>
            </div>

            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>الإنفاق هذا الشهر</span>
                <span style={{ padding: '6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#059669' }}>
                  <CircleDollarSign size={18} />
                </span>
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--ink)' }}>
                {formatCurrency(kpis.monthSpend, currency)}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
                إجمالي قيمة فواتير التوريد الواردة
              </div>
            </div>
          </div>

          {/* 2. Procurement 5-Stage Pipeline */}
          <div className="card-surface" style={{ padding: '18px', borderRadius: '12px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.96rem', color: 'var(--ink)' }}>مسار دورة المشتريات (5 مراحل)</h4>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>تتبع تدفق العمليات من تسجيل الاحتياج وحتى سداد الفاتورة</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
              {pipeline.map((step) => (
                <div
                  key={step.name}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: step.color }}>{step.name}</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ink)' }}>{step.count}</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'var(--line)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${step.pct}%`, height: '100%', background: step.color, borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>{step.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Operational Alerts & Recent Requests Split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
            {/* Alerts Box */}
            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <h4 style={{ fontSize: '0.94rem', margin: '0 0 12px 0', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} color="var(--accent)" />
                تنبيهات ومتابعات المشتريات اللحظية
              </h4>

              {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  <CheckCircle2 size={24} color="#059669" style={{ margin: '0 auto 6px' }} />
                  لا توجد تنبيهات عاجلة؛ كافة العمليات تسير وفق الجداول المعتمدة.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: `1px solid ${alert.type === 'danger' ? 'rgba(239, 68, 68, 0.4)' : alert.type === 'warn' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
                        background: alert.type === 'danger' ? 'rgba(239, 68, 68, 0.05)' : alert.type === 'warn' ? 'rgba(245, 158, 11, 0.05)' : 'rgba(59, 130, 246, 0.05)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.84rem', color: alert.type === 'danger' ? '#dc2626' : alert.type === 'warn' ? '#d97706' : '#2563eb' }}>
                          {alert.title}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--ink)', marginTop: '2px' }}>
                          {alert.message}
                        </div>
                      </div>
                      {alert.link && (
                        <NavLink to={alert.link} style={{ display: 'inline-flex', padding: '6px', color: 'var(--accent)' }}>
                          <ArrowRight size={15} />
                        </NavLink>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Requests with Search */}
            <div className="card-surface" style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ fontSize: '0.94rem', margin: 0, color: 'var(--ink)' }}>أحدث طلبات الشراء المسجلة</h4>
                <NavLink to="/purchases/requests" style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                  عرض الكل
                </NavLink>
              </div>

              <div style={{ position: 'relative', marginBottom: '12px' }}>
                <Search size={15} style={{ position: 'absolute', right: '10px', top: '9px', color: 'var(--muted)' }} />
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
    </div>
  )
}
