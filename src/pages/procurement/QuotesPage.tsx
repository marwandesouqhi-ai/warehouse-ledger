import { canAddDepartment, isSystemAdmin } from '../../lib/permissions'
import { getCairoDateString } from '../../lib/dateUtils'
import { useState, useEffect, useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AccessibleDialog } from '../../components/AccessibleDialog'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  PackageCheck,
  Plus,
  RefreshCw,
  Star,
  Truck,
  X,
  Zap,
} from 'lucide-react'

import {
  fetchPurchaseRequests,
  fetchSupplierQuotes,
  createSupplierQuote,
  selectQuoteRpc,
  createPurchaseOrderRpc,
  fetchPurchaseOrders,
  markPoReceivedRpc,
  markPoInvoicedRpc,
  createPurchaseRequest,
  type PurchaseRequest,
  type SupplierQuote,
  type PurchaseOrder,
  type PurchaseType,
  type PurchasePriority,
} from '../../lib/procurementRepository'
import { ShoppingCart, Trash2 } from 'lucide-react'
import { fetchActiveSuppliers, type Supplier } from '../../lib/suppliersRepository'
import { logAuditEvent } from '../../lib/auditLogger'
import type { AppSettings } from '../../lib/settings'
import { formatCurrency } from '../../lib/currency'

interface QuotesPageProps {
  session?: Session | null
  currency: AppSettings['currency']
}

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return `'${value}` as unknown as T
  }
  return value
}

export default function QuotesPage({ session, currency }: QuotesPageProps) {
  const canAdd = canAddDepartment(session, 'procurement')
  const isSysAdmin = isSystemAdmin(session)
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

  // Create Purchase Request Form State
  const [isCreateRequestModalOpen, setIsCreateRequestModalOpen] = useState(false)
  const [createReqSubmitting, setCreateReqSubmitting] = useState(false)
  const [createReqError, setCreateReqError] = useState('')
  const [reqDept, setReqDept] = useState('كلية الهندسة')
  const [reqPurchaseType, setReqPurchaseType] = useState<PurchaseType>('practice')
  const [reqBudgetLine, setReqBudgetLine] = useState('موازنة معامل وأجهزة 2026 / 2027')
  const [reqPriority, setReqPriority] = useState<PurchasePriority>('normal')
  const [reqNeededBy, setReqNeededBy] = useState(() =>
    getCairoDateString(new Date(Date.now() + 86400000 * 14))
  )
  const [reqRequestedBy, setReqRequestedBy] = useState(activeUserName)
  const [reqJustification, setReqJustification] = useState('')
  const [reqSubmitImmediately, setReqSubmitImmediately] = useState(isSysAdmin)
  const [reqItems, setReqItems] = useState([
    { item_name: '', quantity: 1, unit: 'قطعة', estimated_price: 0 },
  ])

  function handleAddReqItem() {
    setReqItems((prev) => [
      ...prev,
      { item_name: '', quantity: 1, unit: 'قطعة', estimated_price: 0 },
    ])
  }

  function handleRemoveReqItem(index: number) {
    if (reqItems.length <= 1) return
    setReqItems((prev) => prev.filter((_, i) => i !== index))
  }

  function handleReqItemChange(index: number, field: string, value: any) {
    setReqItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const totalReqEstimatedValue = useMemo(() => {
    return reqItems.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimated_price) || 0),
      0
    )
  }, [reqItems])

  async function handleCreatePurchaseRequest(e: React.FormEvent) {
    if (!canAdd) return
    e.preventDefault()
    setCreateReqError('')

    if (!reqDept.trim()) {
      setCreateReqError('يرجى تحديد أو كتابة اسم القسم أو الكلية الطالبة.')
      return
    }
    if (!reqJustification.trim()) {
      setCreateReqError('يرجى توضيح مبررات وأسباب طلب الشراء.')
      return
    }
    const validItems = reqItems.filter((i) => i.item_name.trim().length > 0)
    if (validItems.length === 0) {
      setCreateReqError('يجب إدخال اسم صنف واحد على الأقل.')
      return
    }

    setCreateReqSubmitting(true)
    try {
      const created = await createPurchaseRequest(
        {
          department: reqDept.trim(),
          purchase_type: reqPurchaseType,
          budget_line: reqBudgetLine.trim(),
          priority: reqPriority,
          needed_by: reqNeededBy || null,
          requested_by: reqRequestedBy.trim() || activeUserName,
          justification: reqJustification.trim(),
          created_by: activeUserName,
          created_by_id: session?.user?.id || null,
        },
        validItems.map((i) => ({
          item_name: i.item_name.trim(),
          quantity: Number(i.quantity) || 1,
          unit: i.unit.trim() || 'قطعة',
          estimated_price: Number(i.estimated_price) || 0,
        })),
        isSysAdmin && reqSubmitImmediately
      )

      await logAuditEvent({
        action: `إنشاء طلب شراء جديد: ${created.request_no} للقسم ${reqDept}`,
        entity_type: 'purchase_request',
        entity_id: created.id,
        details: {
          request_no: created.request_no,
          department: reqDept,
          total_estimated: totalReqEstimatedValue,
          items_count: validItems.length,
        },
        user: session?.user,
      })

      setSuccessMessage(`تم إنشاء طلب الشراء بنجاح! رقم الطلب: «${created.request_no}» بمبلغ تقديري ${totalReqEstimatedValue.toLocaleString('ar-EG')} ج.م.`)
      setIsCreateRequestModalOpen(false)
      setReqJustification('')
      setReqItems([{ item_name: '', quantity: 1, unit: 'قطعة', estimated_price: 0 }])

      // Reload requests list and select the new request
      const updatedList = await fetchPurchaseRequests()
      setRequests(updatedList)
      setSelectedRequestId(created.id)
    } catch (err) {
      setCreateReqError(err instanceof Error ? err.message : 'تعذر إنشاء طلب الشراء.')
    } finally {
      setCreateReqSubmitting(false)
    }
  }

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
    if (!canAdd) return
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
        entity_type: 'supplier_quote',
        entity_id: created.id,
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
    if (!isSysAdmin) return
    if (!selectedRequestId) return
    setError('')
    try {
      await selectQuoteRpc(selectedRequestId, quote.id)
      await logAuditEvent({
        action: 'SELECT_SUPPLIER_QUOTE',
        entity_type: 'supplier_quote',
        entity_id: quote.id,
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
    if (!canAdd) return
    if (!selectedQuote) return
    setError('')
    setIsSubmitting(true)

    try {
      const res = await createPurchaseOrderRpc(selectedQuote.id)
      await logAuditEvent({
        action: 'CREATE_PURCHASE_ORDER',
        entity_type: 'purchase_order',
        entity_id: res.po_id,
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
    if (!isSysAdmin) return
    try {
      await markPoReceivedRpc(po.id)
      await logAuditEvent({
        action: 'MARK_PO_RECEIVED',
        entity_type: 'purchase_order',
        entity_id: po.id,
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
    if (!isSysAdmin) return
    try {
      await markPoInvoicedRpc(po.id)
      await logAuditEvent({
        action: 'MARK_PO_INVOICED',
        entity_type: 'purchase_order',
        entity_id: po.id,
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
    XLSX.writeFile(workbook, `مقارنة-عروض-طلب-${selectedRequest.request_no}-${getCairoDateString()}.xlsx`)
  }

  return (
    <section className="movement-page card-surface purchases-page quotes-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}


      <div className="section-head movement-heading quotes-header-row">
        <div>
          <h2>
            <FileSpreadsheet size={20} />
            {' '}
            عروض الأسعار ومقارنة المنافسين
          </h2>
          <span>مقارنة عروض الموردين للمفاضلة الفنية والمالية، اختيار العرض الأفضل، وإصدار أوامر الشراء</span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button
            type="button"
            onClick={() => void loadInitialData()}
            disabled={loading}
            className="quotes-refresh-btn"
            aria-label="تحديث بيانات عروض الأسعار"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'جاري التحميل...' : 'تحديث البيانات'}</span>
          </button>
          <button hidden={!canAdd}
            type="button"
            onClick={() => setIsCreateRequestModalOpen(true)}
            className="primary-btn inline-flex items-center gap-1.5"
            style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
          >
            <Plus size={16} />
            <span>إنشاء طلب شراء جديد</span>
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="inline-message success mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={17} />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="cursor-pointer text-muted bg-none border-none p-1"
            onClick={() => setSuccessMessage('')}
            aria-label="إغلاق التنبيه"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="inline-message error mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="cursor-pointer text-muted bg-none border-none p-1"
            onClick={() => setError('')}
            aria-label="إغلاق الخطأ"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Request Selector and Summary Card */}
      <div className="card-surface quotes-selector-card">
        <div className="quotes-selector-layout">
          <div className="quotes-select-wrap">
            <label className="form-label-block">
              اختر طلب الشراء للمقارنة:
              <select
                value={selectedRequestId}
                onChange={(e) => setSelectedRequestId(e.target.value)}
                className="quotes-select-input"
                aria-label="اختر طلب الشراء للمقارنة"
              >
                <option value="">-- اختر طلب شراء --</option>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.request_no} • {r.department} • {r.status === 'approved' ? '✅ معتمد' : r.status === 'pending' ? '⏳ قيد الموافقة' : r.status} • {r.items_summary}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedRequest && (
            <div className="quotes-req-summary">
              <div>
                <span className="font-xs text-muted">العروض المستلمة:</span>
                <div className="font-bold text-lg text-ink">
                  {quotes.length} عروض
                </div>
              </div>

              <div>
                <span className="font-xs text-muted">نوع الشراء:</span>
                <div className="font-semibold text-sm">
                  {selectedRequest.purchase_type === 'direct' ? 'أمر مباشر' : selectedRequest.purchase_type === 'practice' ? 'ممارسة' : 'مناقصة'}
                </div>
              </div>

              <div>
                <span className="font-xs text-muted">حالة الطلب:</span>
                <div>
                  {selectedRequest.status === 'approved' ? (
                    <span className="badge ok">معتمد ومؤهل للتعاقد</span>
                  ) : (
                    <span className="badge info">قيد المراجعة / مسودة</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button hidden={!canAdd}
                  type="button"
                  className="primary-btn inline-flex items-center gap-1"
                  onClick={() => setIsAddQuoteModalOpen(true)}
                >
                  <Plus size={16} /> إضافة عرض سعر
                </button>
                {quotes.length > 0 && (
                  <button
                    type="button"
                    className="secondary-btn inline-flex items-center gap-1"
                    onClick={handleExportQuotesExcel}
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
        <div className="text-center p-8 text-muted">
          <RefreshCw size={24} className="spin-icon mb-2" />
          <div>جارٍ تحميل عروض الأسعار...</div>
        </div>
      ) : !selectedRequestId ? (
        <div className="empty-state card-surface text-center p-8 border-dashed border-line">
          <FileSpreadsheet size={44} className="opacity-35 mb-3 text-primary mx-auto" />
          <h3 className="text-base font-bold text-ink mb-1">اختر طلب شراء لاستعراض ومقارنة عروض الأسعار</h3>
          <p className="text-xs text-muted mb-4 max-w-md mx-auto">
            يمكنك اختيار طلب شراء سابق من القائمة المنسدلة أعلاه، أو البدء فوراً بإنشاء طلب شراء جديد وتحديد بنود التوريد المطلوبة.
          </p>
          <button hidden={!canAdd}
            type="button"
            className="primary-btn inline-flex items-center gap-1.5"
            onClick={() => setIsCreateRequestModalOpen(true)}
          >
            <Plus size={16} />
            <span>إنشاء طلب شراء جديد الآن</span>
          </button>
        </div>
      ) : quotes.length === 0 ? (
        <div className="empty-state card-surface text-center p-8 border-dashed border-line">
          <FileSpreadsheet size={40} className="opacity-35 mb-2" />
          <h3>لا توجد عروض أسعار مسجلة لهذا الطلب حتى الآن</h3>
          <p className="text-muted font-sm mb-4">
            يمكنك البدء في تلقي عروض الموردين المعتمدين وتسجيل أسعارهم ومواعيد التوريد.
          </p>
          <button hidden={!canAdd}
            type="button"
            className="primary-btn"
            onClick={() => setIsAddQuoteModalOpen(true)}
          >
            <Plus size={16} /> تسجيل أول عرض سعر
          </button>
        </div>
      ) : (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
            <h3 className="text-base m-0 text-ink">
              جدول المقارنة الذكية للعروض المستلمة ({quotes.length} عروض)
            </h3>
            {selectedQuote && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-sm text-ok font-semibold">
                  العرض المختار: «{selectedQuote.supplier_name}» ({formatCurrency(selectedQuote.total_price, currency)})
                </span>
                {!existingPoForRequest && selectedRequest?.status === 'approved' && (
                  <button hidden={!canAdd}
                    type="button"
                    className="primary-btn inline-flex items-center gap-1"
                    onClick={handleCreatePurchaseOrder}
                    disabled={isSubmitting}
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

          <div className="table-wrapper overflow-x-auto">
            <table className="movements-table responsive-table">
              <thead>
                <tr>
                  <th>المورد والتقييم</th>
                  <th className="text-center">السعر الإجمالي</th>
                  <th className="text-center">مدة التوريد</th>
                  <th>شروط الدفع</th>
                  <th className="text-center">فترة الضمان</th>
                  <th>الملاحظات</th>
                  <th className="text-center">قرار الاختيار</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const isLowestPrice = bestValues.minPrice != null && q.total_price === bestValues.minPrice
                  const isFastestDelivery = bestValues.minDeliveryDays != null && q.delivery_days === bestValues.minDeliveryDays

                  return (
                    <tr
                      key={q.id}
                      className={q.is_selected ? 'quotes-table-tr-selected' : undefined}
                    >
                      <td>
                        <div className="font-bold text-ink">{q.supplier_name}</div>
                        {q.supplier_rating != null && (
                          <div className="suppliers-rating-box font-xs">
                            <Star size={13} fill="var(--warn)" />
                            <span>{q.supplier_rating.toFixed(1)}</span>
                          </div>
                        )}
                      </td>
                      <td className="text-center">
                        <div className={`font-bold text-base ${isLowestPrice ? 'text-ok' : 'text-ink'}`}>
                          {formatCurrency(q.total_price, currency)}
                        </div>
                        {isLowestPrice && (
                          <span className="badge ok font-xs inline-flex items-center gap-1 mt-1">
                            <Zap size={11} /> الأقل سعراً
                          </span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="font-semibold">{q.delivery_days} أيام</div>
                        {isFastestDelivery && (
                          <span className="badge info font-xs inline-flex items-center gap-1 mt-1">
                            <Truck size={11} /> الأسرع توريداً
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="font-sm">{q.payment_terms || '—'}</span>
                      </td>
                      <td className="text-center">
                        <span className="font-sm">
                          {q.warranty_months > 0 ? `${q.warranty_months} شهراً` : 'بدون ضمان'}
                        </span>
                      </td>
                      <td>
                        <span className="font-xs text-muted">{q.notes || '—'}</span>
                      </td>
                      <td className="text-center">
                        {q.is_selected ? (
                          <button
                            type="button"
                            className="primary-btn quotes-btn-winner"
                            disabled
                            aria-pressed="true"
                          >
                            <Check size={14} /> العرض الفائز
                          </button>
                        ) : (
                          <button hidden={!isSysAdmin}
                            type="button"
                            className="secondary-btn quotes-btn-choose"
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
      <div className="card-surface mt-5 p-5 rounded-lg border border-line">
        <h3 className="text-base m-0 mb-3 flex items-center gap-2">
          <PackageCheck size={20} />
          أوامر الشراء الصادرة للموردين ({purchaseOrders.length})
        </h3>

        {purchaseOrders.length === 0 ? (
          <div className="text-center p-8 text-muted font-sm">
            لا توجد أوامر شراء صادرة حتى الآن. يمكنك إصدار أمر شراء بمجرد اعتماد العرض الفائز.
          </div>
        ) : (
          <div className="table-wrapper overflow-x-auto">
            <table className="movements-table responsive-table">
              <thead>
                <tr>
                  <th>رقم أمر الشراء</th>
                  <th>طلب الشراء والجهة</th>
                  <th>المورد المتعاقد معه</th>
                  <th className="text-center">القيمة الإجمالية</th>
                  <th className="text-center">التسليم المتوقع</th>
                  <th className="text-center">الحالة</th>
                  <th className="text-center">متابعة الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <div className="font-bold text-accent text-right font-mono">
                        {po.po_no}
                      </div>
                      <div className="font-xs text-muted">
                        حرر بتاريخ: {po.created_at?.slice(0, 10)}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold">{po.request_no}</div>
                      <div className="font-xs text-muted">{po.department}</div>
                    </td>
                    <td>
                      <span className="font-semibold">{po.supplier_name}</span>
                    </td>
                    <td className="text-center font-bold">
                      {formatCurrency(po.total, currency)}
                    </td>
                    <td className="text-center font-sm">
                      {po.expected_delivery_date || '—'}
                    </td>
                    <td className="text-center">
                      {po.status === 'open' && (
                        <span className="badge info">مفتوح (بانتظار التوريد)</span>
                      )}
                      {po.status === 'received' && (
                        <span className="badge ok">تم الاستلام والفحص</span>
                      )}
                      {po.status === 'invoiced' && (
                        <span className="badge muted">تمت الفوترة</span>
                      )}
                      {po.status === 'cancelled' && (
                        <span className="badge bad">ملغي</span>
                      )}
                    </td>
                    <td className="text-center">
                      <div className="inline-flex gap-2">
                        {po.status === 'open' && (
                          <button hidden={!isSysAdmin}
                            type="button"
                            className="secondary-btn quotes-btn-choose"
                            onClick={() => handleMarkReceived(po)}
                            aria-label={`تأكيد استلام أمر الشراء ${po.po_no}`}
                          >
                            تأكيد الاستلام
                          </button>
                        )}
                        {po.status === 'received' && (
                          <button hidden={!isSysAdmin}
                            type="button"
                            className="secondary-btn quotes-btn-choose"
                            onClick={() => handleMarkInvoiced(po)}
                            aria-label={`تأكيد فاتورة أمر الشراء ${po.po_no}`}
                          >
                            تأكيد الفاتورة
                          </button>
                        )}
                        {po.status === 'invoiced' && (
                          <span className="font-xs text-muted">مكتمل التوريد والفوترة</span>
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
        <AccessibleDialog
          isOpen={true}
          onClose={() => setIsAddQuoteModalOpen(false)}
          titleId="add-quote-modal-title"
          dialogClassName="modal-surface card-surface quotes-modal-surface"
        >
            <div className="flex justify-between items-center mb-4">
              <h3 id="add-quote-modal-title" className="m-0 flex items-center gap-2">
                <Plus size={20} /> إضافة عرض سعر للمقارنة
              </h3>
              <button
                type="button"
                className="cursor-pointer text-muted bg-none border-none p-1"
                onClick={() => setIsAddQuoteModalOpen(false)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="inline-message error mb-3">
                <AlertTriangle size={16} />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleAddQuoteSubmit}>
              <div className="flex flex-col gap-3">
                <label className="form-label-block">
                  المورد المتقدم بالعرض *
                  <select
                    value={quoteSupplierId}
                    onChange={(e) => setQuoteSupplierId(e.target.value)}
                    required
                    className="form-input-themed"
                  >
                    <option value="">-- اختر مورداً معتمداً --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.category || 'عام'})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="form-grid-2col">
                  <label className="form-label-block">
                    السعر الإجمالي للعرض *
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={quotePrice}
                      onChange={(e) => setQuotePrice(e.target.value)}
                      placeholder="السعر الإجمالي شامل الضريبة"
                      required
                      className="form-input-themed"
                    />
                  </label>

                  <label className="form-label-block">
                    مدة التوريد (أيام) *
                    <input
                      type="number"
                      min="1"
                      value={quoteDeliveryDays}
                      onChange={(e) => setQuoteDeliveryDays(e.target.value)}
                      placeholder="أيام التوريد"
                      required
                      className="form-input-themed"
                    />
                  </label>
                </div>

                <div className="form-grid-2col">
                  <label className="form-label-block">
                    شروط وطريقة الدفع
                    <input
                      type="text"
                      value={quotePaymentTerms}
                      onChange={(e) => setQuotePaymentTerms(e.target.value)}
                      placeholder="مثال: دفع بعد الاستلام والفحص"
                      className="form-input-themed"
                    />
                  </label>

                  <label className="form-label-block">
                    فترة الضمان (بالشهور)
                    <input
                      type="number"
                      min="0"
                      value={quoteWarrantyMonths}
                      onChange={(e) => setQuoteWarrantyMonths(e.target.value)}
                      placeholder="عدد شهور الضمان"
                      className="form-input-themed"
                    />
                  </label>
                </div>

                <label className="form-label-block">
                  ملاحظات أو شروط إضافية
                  <textarea
                    rows={2}
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder="العنوان، رقم السجل، شروط التركيب والتوصيل..."
                    className="form-input-themed"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 mt-4">
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
        </AccessibleDialog>
      )}

      {/* Modal: New Purchase Request */}
      {isCreateRequestModalOpen && (
        <AccessibleDialog
          isOpen={true}
          onClose={() => setIsCreateRequestModalOpen(false)}
          titleId="create-purchase-req-modal-title"
          dialogClassName="modal-dialog max-w-3xl"
        >
          <div className="modal-header">
            <div className="modal-title-wrap">
              <div className="modal-title-icon">
                <ShoppingCart size={18} />
              </div>
              <div>
                <h3 id="create-purchase-req-modal-title">إنشاء طلب شراء وتوريد جديد</h3>
                <span className="modal-subtitle">إدراج بيانات الاحتياج، البنود والمواصفات، والاعتمادات المالية</span>
              </div>
            </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsCreateRequestModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreatePurchaseRequest} className="modal-body p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {createReqError && (
                <div className="inline-message error text-xs">
                  <AlertTriangle size={15} />
                  <span>{createReqError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  القسم / الكلية الطالبة *
                  <select
                    value={reqDept}
                    onChange={(e) => setReqDept(e.target.value)}
                    className="p-2 border rounded bg-background text-sm"
                  >
                    <option value="المخزن الرئيسي (قسم الوارد)">المخزن الرئيسي (قسم الوارد)</option>
                    <option value="كلية الهندسة">كلية الهندسة</option>
                    <option value="كلية الطب البشري">كلية الطب البشري</option>
                    <option value="كلية الصيدلة">كلية الصيدلة</option>
                    <option value="كلية طب الأسنان">كلية طب الأسنان</option>
                    <option value="كلية الحاسبات والذكاء الاصطناعي">كلية الحاسبات والذكاء الاصطناعي</option>
                    <option value="كلية العلوم">كلية العلوم</option>
                    <option value="كلية التمريض">كلية التمريض</option>
                    <option value="إدارة الشؤون الهندسية والصيانة">إدارة الشؤون الهندسية والصيانة</option>
                    <option value="إدارة تقنية المعلومات والشبكات">إدارة تقنية المعلومات والشبكات</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  نوع الشراء / آلية التعاقد *
                  <select
                    value={reqPurchaseType}
                    onChange={(e) => setReqPurchaseType(e.target.value as PurchaseType)}
                    className="p-2 border rounded bg-background text-sm"
                  >
                    <option value="practice">ممارسة محدودة (عروض أسعار ومقارنة)</option>
                    <option value="direct">أمر شراء مباشر (احتياج فوري)</option>
                    <option value="tender">مناقصة عامة رسمية</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  بند الموازنة والتمويل
                  <input
                    type="text"
                    value={reqBudgetLine}
                    onChange={(e) => setReqBudgetLine(e.target.value)}
                    placeholder="مثال: موازنة توريدات المعامل 2026"
                    className="p-2 border rounded bg-background text-sm"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  درجة الأولوية *
                  <select
                    value={reqPriority}
                    onChange={(e) => setReqPriority(e.target.value as PurchasePriority)}
                    className="p-2 border rounded bg-background text-sm"
                  >
                    <option value="normal">عادي (توريد اعتيادي مجدول)</option>
                    <option value="urgent">عاجل جداً (احتياج طارئ)</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  تاريخ الحاجة المطلوب
                  <input
                    type="date"
                    value={reqNeededBy}
                    onChange={(e) => setReqNeededBy(e.target.value)}
                    className="p-2 border rounded bg-background text-sm"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  اسم المسؤول مقدم الطلب
                  <input
                    type="text"
                    value={reqRequestedBy}
                    onChange={(e) => setReqRequestedBy(e.target.value)}
                    className="p-2 border rounded bg-background text-sm"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                  مبررات وأسباب الشراء *
                  <input
                    type="text"
                    required
                    value={reqJustification}
                    onChange={(e) => setReqJustification(e.target.value)}
                    placeholder="مثال: حاجة المعامل للأجهزة لبدء الفصل الدراسي الجديد"
                    className="p-2 border rounded bg-background text-sm"
                  />
                </label>
              </div>

              {/* Dynamic Items Table */}
              <div className="border rounded-lg p-3 bg-muted/10 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-ink">قائمة الأصناف والبنود المطلوبة</span>
                  <button
                    type="button"
                    onClick={handleAddReqItem}
                    className="secondary-btn text-xs py-1 px-2.5 inline-flex items-center gap-1"
                  >
                    <Plus size={13} /> إضافة صنف آخر
                  </button>
                </div>

                <div className="space-y-2">
                  {reqItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-background p-2 rounded border text-xs">
                      <div className="col-span-12 sm:col-span-5">
                        <input
                          type="text"
                          required
                          placeholder="اسم الصنف والمواصفات *"
                          value={item.item_name}
                          onChange={(e) => handleReqItemChange(idx, 'item_name', e.target.value)}
                          className="w-full p-1.5 border rounded text-xs"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <input
                          type="number"
                          min="1"
                          required
                          placeholder="الكمية"
                          value={item.quantity}
                          onChange={(e) => handleReqItemChange(idx, 'quantity', e.target.value ? Number(e.target.value) : '')}
                          className="w-full p-1.5 border rounded text-xs text-center"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <select
                          value={item.unit}
                          onChange={(e) => handleReqItemChange(idx, 'unit', e.target.value)}
                          className="w-full p-1.5 border rounded text-xs"
                        >
                          <option value="قطعة">قطعة</option>
                          <option value="جهاز">جهاز</option>
                          <option value="كرتونة">كرتونة</option>
                          <option value="باكتة">باكتة</option>
                          <option value="متر">متر</option>
                          <option value="طقم">طقم</option>
                        </select>
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="السعر التقديري"
                          value={item.estimated_price || ''}
                          onChange={(e) => handleReqItemChange(idx, 'estimated_price', e.target.value ? Number(e.target.value) : 0)}
                          className="w-full p-1.5 border rounded text-xs text-center"
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveReqItem(idx)}
                          disabled={reqItems.length <= 1}
                          className="text-destructive p-1 hover:bg-destructive/10 rounded disabled:opacity-30"
                          title="حذف البند"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center pt-2 border-t text-xs">
                  <span className="text-muted">إجمالي التكلفة التقديرية للطلب:</span>
                  <strong className="text-sm font-bold text-emerald-600">
                    {totalReqEstimatedValue.toLocaleString('ar-EG')} ج.م
                  </strong>
                </div>
              </div>

              <div className="p-3 bg-muted/20 rounded flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={reqSubmitImmediately}
                    onChange={(e) => setReqSubmitImmediately(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>اعتماد الطلب فوراً وتحويله لمرحلة جمع عروض الأسعار</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setIsCreateRequestModalOpen(false)}
                  disabled={createReqSubmitting}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={createReqSubmitting}
                >
                  {createReqSubmitting ? 'جارٍ الإنشاء...' : 'حفظ واعتماد طلب الشراء'}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </section>
  )
}
