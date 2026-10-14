import { useState, useEffect, useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Eye,
  FileSpreadsheet,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Star,
  Truck,
  X,
  Zap,
} from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import {
  fetchPurchaseRequests,
  fetchSupplierQuotes,
  createSupplierQuote,
  selectQuoteRpc,
  createPurchaseOrderRpc,
  fetchPurchaseOrders,
  markPoReceivedRpc,
  markPoInvoicedRpc,
  type PurchaseRequest,
  type SupplierQuote,
  type PurchaseOrder,
} from '../../lib/procurementRepository'
import { fetchActiveSuppliers, type Supplier } from '../../lib/suppliersRepository'
import { logAuditEvent } from '../../lib/auditLogger'
import type { AppSettings } from '../../lib/settings'

interface QuotesPageProps {
  session?: Session | null
  currency: AppSettings['currency']
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

export default function QuotesPage({ session, currency }: QuotesPageProps) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState<string>('')
  const [quotes, setQuotes] = useState<SupplierQuote[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [quotesLoading, setQuotesLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [successMessage, setSuccessMessage] = useState<string>('')

  // Modals & Action States
  const [isAddQuoteModalOpen, setIsAddQuoteModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [modalError, setModalError] = useState('')

  // New Quote Form
  const [quoteSupplierId, setQuoteSupplierId] = useState('')
  const [quotePrice, setQuotePrice] = useState('')
  const [quoteDeliveryDays, setQuoteDeliveryDays] = useState('7')
  const [quotePaymentTerms, setQuotePaymentTerms] = useState('دفع بعد التوريد والفحص')
  const [quoteWarrantyMonths, setQuoteWarrantyMonths] = useState('12')
  const [quoteNotes, setQuoteNotes] = useState('')

  const activeUserName = session?.user?.user_metadata?.displayName || session?.user?.email || 'موظف مشتريات'

  // Load initial data
  async function loadInitialData() {
    setLoading(true)
    setError('')
    try {
      const [reqList, supList, poList] = await Promise.all([
        fetchPurchaseRequests(),
        fetchActiveSuppliers(),
        fetchPurchaseOrders(),
      ])
      setRequests(reqList)
      setSuppliers(supList)
      setPurchaseOrders(poList)

      // Auto-select first approved or pending request if available
      if (reqList.length > 0 && !selectedRequestId) {
        const preferred = reqList.find((r) => r.status === 'approved') || reqList[0]
        setSelectedRequestId(preferred.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات العروض وأوامر الشراء.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInitialData()
  }, [])

  // Load quotes whenever selectedRequestId changes
  useEffect(() => {
    if (!selectedRequestId) {
      setQuotes([])
      return
    }

    setQuotesLoading(true)
    void fetchSupplierQuotes(selectedRequestId)
      .then((data) => setQuotes(data))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'تعذر تحميل عروض الأسعار لهذا الطلب.')
      })
      .finally(() => setQuotesLoading(false))
  }, [selectedRequestId])

  const selectedRequest = useMemo(() => {
    return requests.find((r) => r.id === selectedRequestId) || null
  }, [requests, selectedRequestId])

  // Calculated best values for comparison highlighting
  const bestValues = useMemo(() => {
    if (quotes.length === 0) return { minPrice: null, minDeliveryDays: null }

    let minP = Number.POSITIVE_INFINITY
    let minD = Number.POSITIVE_INFINITY

    for (const q of quotes) {
      if (q.total_price < minP) minP = q.total_price
      if (q.delivery_days < minD) minD = q.delivery_days
    }

    return {
      minPrice: minP === Number.POSITIVE_INFINITY ? null : minP,
      minDeliveryDays: minD === Number.POSITIVE_INFINITY ? null : minD,
    }
  }, [quotes])

  const selectedQuote = useMemo(() => {
    return quotes.find((q) => q.is_selected) || null
  }, [quotes])

  const existingPoForRequest = useMemo(() => {
    if (!selectedRequestId) return null
    return purchaseOrders.find((po) => po.request_id === selectedRequestId) || null
  }, [purchaseOrders, selectedRequestId])

  async function handleAddQuoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRequestId) return

    setModalError('')
    const p = Number(quotePrice)
    const d = Number(quoteDeliveryDays)
    const w = Number(quoteWarrantyMonths)

    if (!quoteSupplierId) {
      setModalError('يرجى اختيار المورد.')
      return
    }
    if (isNaN(p) || p <= 0) {
      setModalError('يرجى إدخال سعر إجمالي صحيح أكبر من صفر.')
      return
    }
    if (isNaN(d) || d < 0) {
      setModalError('يرجى إدخال مدة توريد صحيحة.')
      return
    }

    setIsSubmitting(true)
    try {
      const created = await createSupplierQuote({
        request_id: selectedRequestId,
        supplier_id: quoteSupplierId,
        total_price: p,
        delivery_days: d,
        payment_terms: quotePaymentTerms,
        warranty_months: w,
        notes: quoteNotes,
        created_by: activeUserName,
      })

      await logAuditEvent({
        action: 'CREATE_SUPPLIER_QUOTE',
        entityType: 'supplier_quote',
        entityId: created.id,
        details: {
          request_id: selectedRequestId,
          supplier_id: quoteSupplierId,
          total_price: p,
        },
      })

      setSuccessMessage('تمت إضافة عرض السعر بنجاح إلى جدول المقارنة.')
      setIsAddQuoteModalOpen(false)
      // Reload quotes
      const reloaded = await fetchSupplierQuotes(selectedRequestId)
      setQuotes(reloaded)
      // Reset
      setQuoteSupplierId('')
      setQuotePrice('')
      setQuoteNotes('')
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'تعذر تسجيل عرض السعر.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSelectQuote(quote: SupplierQuote) {
    if (!selectedRequestId) return
    setError('')
    try {
      await selectQuoteRpc(selectedRequestId, quote.id)
      await logAuditEvent({
        action: 'SELECT_SUPPLIER_QUOTE',
        entityType: 'supplier_quote',
        entityId: quote.id,
        details: { request_id: selectedRequestId, supplier_id: quote.supplier_id },
      })
      setSuccessMessage(`تم اعتماد واختيار عرض المورد «${quote.supplier_name}» كعرض فائز.`)
      const reloaded = await fetchSupplierQuotes(selectedRequestId)
      setQuotes(reloaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر اختيار هذا العرض.')
    }
  }

  async function handleCreatePurchaseOrder() {
    if (!selectedQuote) return
    setError('')
    setIsSubmitting(true)

    try {
      const res = await createPurchaseOrderRpc(selectedQuote.id)
      await logAuditEvent({
        action: 'CREATE_PURCHASE_ORDER',
        entityType: 'purchase_order',
        entityId: res.po_id,
        details: {
          po_no: res.po_no,
          request_id: selectedRequestId,
          supplier_id: selectedQuote.supplier_id,
          total: selectedQuote.total_price,
        },
      })

      setSuccessMessage(`تم إصدار أمر الشراء بنجاح برقم «${res.po_no}».`)
      const reloadedOrders = await fetchPurchaseOrders()
      setPurchaseOrders(reloadedOrders)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء أمر الشراء.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleMarkReceived(po: PurchaseOrder) {
    try {
      await markPoReceivedRpc(po.id)
      await logAuditEvent({
        action: 'MARK_PO_RECEIVED',
        entityType: 'purchase_order',
        entityId: po.id,
        details: { po_no: po.po_no },
      })
      setSuccessMessage(`تم تحديث حالة أمر الشراء «${po.po_no}» إلى «تم الاستلام».`)
      const reloaded = await fetchPurchaseOrders()
      setPurchaseOrders(reloaded)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر تحديث حالة الاستلام.')
    }
  }

  async function handleMarkInvoiced(po: PurchaseOrder) {
    try {
      await markPoInvoicedRpc(po.id)
      await logAuditEvent({
        action: 'MARK_PO_INVOICED',
        entityType: 'purchase_order',
        entityId: po.id,
        details: { po_no: po.po_no },
      })
      setSuccessMessage(`تم تحديث حالة أمر الشراء «${po.po_no}» إلى «مفوتر».`)
      const reloaded = await fetchPurchaseOrders()
      setPurchaseOrders(reloaded)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر تحديث حالة الفوترة.')
    }
  }

  async function handleExportQuotesExcel() {
    if (quotes.length === 0 || !selectedRequest) return
    const XLSX = await import('xlsx')
    const rows = quotes.map((q, idx) => ({
      'م': idx + 1,
      'المورد / الشركة': sanitizeExcelCell(q.supplier_name || '—'),
      'السعر الإجمالي': q.total_price,
      'مدة التوريد (أيام)': q.delivery_days,
      'شروط الدفع': sanitizeExcelCell(q.payment_terms || '—'),
      'فترة الضمان (شهور)': q.warranty_months,
      'تقييم المورد': q.supplier_rating ?? '—',
      'العرض المختار': q.is_selected ? 'نعم (عرض فائز)' : 'لا',
      'ملاحظات': sanitizeExcelCell(q.notes || ''),
    }))

    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'مقارنة عروض الأسعار')
    XLSX.writeFile(workbook, `مقارنة-عروض-طلب-${selectedRequest.request_no}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <section className="movement-page card-surface purchases-page quotes-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="quotes" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '16px' }}>
        <div>
          <h2>
            <FileSpreadsheet size={20} />
            {' '}
            عروض الأسعار ومقارنة المنافسين
          </h2>
          <span>مقارنة عروض الموردين للمفاضلة الفنية والمالية، اختيار العرض الأفضل، وإصدار أوامر الشراء</span>
        </div>
      </div>

      {successMessage && (
        <div className="inline-message success" style={{ marginBottom: '16px' }}>
          <CheckCircle2 size={17} />
          <span>{successMessage}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }}
            onClick={() => setSuccessMessage('')}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="inline-message error" style={{ marginBottom: '16px' }}>
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }}
            onClick={() => setError('')}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Request Selector and Summary Card */}
      <div className="card-surface" style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--line)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: '280px', flex: '1' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px', display: 'block' }}>
              اختر طلب الشراء للمقارنة:
            </label>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)', fontWeight: 600 }}
            >
              <option value="">-- اختر طلب شراء --</option>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.request_no} • {r.department} • {r.status === 'approved' ? '✅ معتمد' : r.status === 'pending' ? '⏳ قيد الموافقة' : r.status} • {r.items_summary}
                </option>
              ))}
            </select>
          </div>

          {selectedRequest && (
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>العروض المستلمة:</span>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ink)' }}>
                  {quotes.length} عروض
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>نوع الشراء:</span>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {selectedRequest.purchase_type === 'direct' ? 'أمر مباشر' : selectedRequest.purchase_type === 'practice' ? 'ممارسة' : 'مناقصة'}
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>حالة الطلب:</span>
                <div>
                  {selectedRequest.status === 'approved' ? (
                    <span className="stock-status-pill ok">معتمد ومؤهل للتعاقد</span>
                  ) : (
                    <span className="stock-status-pill info">قيد المراجعة / مسودة</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setIsAddQuoteModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={16} /> إضافة عرض سعر
                </button>
                {quotes.length > 0 && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleExportQuotesExcel}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={15} /> تصدير المقارنة
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comparison Matrix Table */}
      {quotesLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '8px' }} />
          <div>جارٍ تحميل عروض الأسعار...</div>
        </div>
      ) : !selectedRequestId ? (
        <div className="empty-state card-surface" style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--line)' }}>
          <FileSpreadsheet size={40} style={{ opacity: 0.35, marginBottom: '10px' }} />
          <h3>اختر طلب شراء لاستعراض ومقارنة عروض الأسعار</h3>
        </div>
      ) : quotes.length === 0 ? (
        <div className="empty-state card-surface" style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed var(--line)' }}>
          <FileSpreadsheet size={40} style={{ opacity: 0.35, marginBottom: '10px' }} />
          <h3>لا توجد عروض أسعار مسجلة لهذا الطلب حتى الآن</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
            يمكنك البدء في تلقي عروض الموردين المعتمدين وتسجيل أسعارهم ومواعيد التوريد.
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setIsAddQuoteModalOpen(true)}
          >
            <Plus size={16} /> تسجيل أول عرض سعر
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '1.05rem', margin: 0, color: 'var(--ink)' }}>
              جدول المقارنة الذكية للعروض المستلمة ({quotes.length} عروض)
            </h3>
            {selectedQuote && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.85rem', color: '#059669', fontWeight: 600 }}>
                  العرض المختار: «{selectedQuote.supplier_name}» ({formatCurrency(selectedQuote.total_price, currency)})
                </span>
                {!existingPoForRequest && selectedRequest?.status === 'approved' && (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleCreatePurchaseOrder}
                    disabled={isSubmitting}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <PackageCheck size={16} /> إنشاء أمر شراء من العرض المختار
                  </button>
                )}
                {existingPoForRequest && (
                  <span className="badge ok">
                    تم إصدار أمر الشراء: {existingPoForRequest.po_no}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="movements-table responsive-table">
              <thead>
                <tr>
                  <th>المورد والتقييم</th>
                  <th style={{ textAlign: 'center' }}>السعر الإجمالي</th>
                  <th style={{ textAlign: 'center' }}>مدة التوريد</th>
                  <th>شروط الدفع</th>
                  <th style={{ textAlign: 'center' }}>فترة الضمان</th>
                  <th>الملاحظات</th>
                  <th style={{ textAlign: 'center' }}>قرار الاختيار</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const isLowestPrice = bestValues.minPrice != null && q.total_price === bestValues.minPrice
                  const isFastestDelivery = bestValues.minDeliveryDays != null && q.delivery_days === bestValues.minDeliveryDays

                  return (
                    <tr
                      key={q.id}
                      style={{
                        background: q.is_selected ? 'rgba(16, 185, 129, 0.04)' : undefined,
                        borderRight: q.is_selected ? '4px solid #059669' : undefined,
                      }}
                    >
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{q.supplier_name}</div>
                        {q.supplier_rating != null && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.78rem', color: '#d97706' }}>
                            <Star size={13} fill="#d97706" />
                            <span>{q.supplier_rating.toFixed(1)}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: isLowestPrice ? '#059669' : 'var(--ink)' }}>
                          {formatCurrency(q.total_price, currency)}
                        </div>
                        {isLowestPrice && (
                          <span className="badge ok" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                            <Zap size={11} /> الأقل سعراً
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600 }}>{q.delivery_days} أيام</div>
                        {isFastestDelivery && (
                          <span className="badge info" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                            <Truck size={11} /> الأسرع توريداً
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: '0.85rem' }}>{q.payment_terms || '—'}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '0.85rem' }}>
                          {q.warranty_months > 0 ? `${q.warranty_months} شهراً` : 'بدون ضمان'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{q.notes || '—'}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {q.is_selected ? (
                          <button
                            type="button"
                            className="primary-btn"
                            disabled
                            aria-pressed="true"
                            style={{ padding: '5px 12px', fontSize: '0.82rem', background: '#059669', borderColor: '#059669', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Check size={14} /> العرض الفائز
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary-btn"
                            disabled={Boolean(existingPoForRequest) || selectedRequest?.status !== 'approved'}
                            aria-pressed="false"
                            onClick={() => handleSelectQuote(q)}
                            title={
                              selectedRequest?.status !== 'approved'
                                ? 'يجب اعتماد طلب الشراء أولاً لاختيار العرض'
                                : existingPoForRequest
                                ? 'تم إصدار أمر الشراء بالفعل'
                                : 'اعتماد هذا العرض كعرض فائز'
                            }
                            style={{ padding: '5px 12px', fontSize: '0.82rem' }}
                          >
                            اختيار هذا العرض
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section: Purchase Orders Registry */}
      <div className="card-surface" style={{ padding: '20px', borderRadius: '10px', border: '1px solid var(--line)', marginTop: '20px' }}>
        <h3 style={{ fontSize: '1.05rem', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PackageCheck size={20} />
          أوامر الشراء الصادرة للموردين ({purchaseOrders.length})
        </h3>

        {purchaseOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)', fontSize: '0.9rem' }}>
            لا توجد أوامر شراء صادرة حتى الآن. يمكنك إصدار أمر شراء بمجرد اعتماد العرض الفائز.
          </div>
        ) : (
          <div className="table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="movements-table responsive-table">
              <thead>
                <tr>
                  <th>رقم أمر الشراء</th>
                  <th>طلب الشراء والجهة</th>
                  <th>المورد المتعاقد معه</th>
                  <th style={{ textAlign: 'center' }}>القيمة الإجمالية</th>
                  <th style={{ textAlign: 'center' }}>التسليم المتوقع</th>
                  <th style={{ textAlign: 'center' }}>الحالة</th>
                  <th style={{ textAlign: 'center' }}>متابعة الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--accent)', direction: 'ltr', textAlign: 'right' }}>
                        {po.po_no}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                        حرر بتاريخ: {po.created_at?.slice(0, 10)}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{po.request_no}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{po.department}</div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{po.supplier_name}</span>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>
                      {formatCurrency(po.total, currency)}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: '0.85rem' }}>
                      {po.expected_delivery_date || '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {po.status === 'open' && (
                        <span className="stock-status-pill info">مفتوح (بانتظار التوريد)</span>
                      )}
                      {po.status === 'received' && (
                        <span className="stock-status-pill ok">تم الاستلام والفحص</span>
                      )}
                      {po.status === 'invoiced' && (
                        <span className="stock-status-pill neutral">تمت الفوترة</span>
                      )}
                      {po.status === 'cancelled' && (
                        <span className="stock-status-pill danger">ملغي</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        {po.status === 'open' && (
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                            onClick={() => handleMarkReceived(po)}
                          >
                            تأكيد الاستلام
                          </button>
                        )}
                        {po.status === 'received' && (
                          <button
                            type="button"
                            className="secondary-btn"
                            style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                            onClick={() => handleMarkInvoiced(po)}
                          >
                            تأكيد الفاتورة
                          </button>
                        )}
                        {po.status === 'invoiced' && (
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>مكتمل التوريد والفوترة</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Supplier Quote Modal */}
      {isAddQuoteModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-surface card-surface" style={{ maxWidth: '520px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={20} /> إضافة عرض سعر للمقارنة
              </h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                onClick={() => setIsAddQuoteModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="inline-message error" style={{ marginBottom: '14px' }}>
                <AlertTriangle size={16} />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleAddQuoteSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label>
                  المورد المتقدم بالعرض *
                  <select
                    value={quoteSupplierId}
                    onChange={(e) => setQuoteSupplierId(e.target.value)}
                    required
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                  >
                    <option value="">-- اختر مورداً معتمداً --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.category || 'عام'})
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <label>
                    السعر الإجمالي للعرض *
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={quotePrice}
                      onChange={(e) => setQuotePrice(e.target.value)}
                      placeholder="السعر الإجمالي شامل الضريبة"
                      required
                    />
                  </label>

                  <label>
                    مدة التوريد (أيام) *
                    <input
                      type="number"
                      min="1"
                      value={quoteDeliveryDays}
                      onChange={(e) => setQuoteDeliveryDays(e.target.value)}
                      placeholder="أيام التوريد"
                      required
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <label>
                    شروط وطريقة الدفع
                    <input
                      type="text"
                      value={quotePaymentTerms}
                      onChange={(e) => setQuotePaymentTerms(e.target.value)}
                      placeholder="مثال: دفع بعد الاستلام والفحص"
                    />
                  </label>

                  <label>
                    فترة الضمان (بالشهور)
                    <input
                      type="number"
                      min="0"
                      value={quoteWarrantyMonths}
                      onChange={(e) => setQuoteWarrantyMonths(e.target.value)}
                      placeholder="عدد شهور الضمان"
                    />
                  </label>
                </div>

                <label>
                  ملاحظات أو شروط إضافية
                  <textarea
                    rows={2}
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder="العنوان، رقم السجل، شروط التركيب والتوصيل..."
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={isSubmitting}
                  onClick={() => setIsAddQuoteModalOpen(false)}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'جارٍ الحفظ...' : 'تسجيل العرض'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
