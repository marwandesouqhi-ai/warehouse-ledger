import { useState, useMemo, useEffect } from 'react'
import {
  X,
  Printer,
  FileCheck2,
  Search,
  Plus,
  Minus,
  Package,
  Layers,
  ArrowRightLeft,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react'
import { WAREHOUSES, type CustodyItem } from '../lib/custody'
import { getCairoDateString } from '../lib/dateUtils'
import type { AppSettings } from '../lib/settings'
import { AccessibleDialog } from './AccessibleDialog'

export interface OfficialDisbursementPermitModalProps {
  initialItems?: CustodyItem[]
  allWarehouseItems: CustodyItem[]
  settings: AppSettings
  onClose: () => void
  defaultWarehouseId?: string
  onRecordPermit?: (payload: {
    permitNumber: string
    permitDate: string
    sourceWarehouseId: string
    targetWarehouseId: string
    recipientName: string
    notes: string
    items: Array<{ item: CustodyItem; quantity: number }>
  }) => Promise<void> | void
}

export const OfficialDisbursementPermitModal: React.FC<OfficialDisbursementPermitModalProps> = ({
  initialItems = [],
  allWarehouseItems,
  settings,
  onClose,
  defaultWarehouseId,
  onRecordPermit,
}) => {
  const [permitType, setPermitType] = useState<'disburse' | 'receive'>('disburse')
  const [permitNumber, setPermitNumber] = useState<string>(() => {
    return `DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  })
  const [permitDate, setPermitDate] = useState<string>(() => {
    return getCairoDateString()
  })
  const [sourceWarehouseId, setSourceWarehouseId] = useState<string>(() => {
    if (initialItems[0]?.warehouseId) {
      return initialItems[0].warehouseId
    }
    return 'main'
  })
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(() => {
    const rawDefault = defaultWarehouseId === 'nursing' ? 'medicine' : defaultWarehouseId
    if (rawDefault && rawDefault !== 'main') {
      return rawDefault
    }
    return 'fci'
  })
  const [recipientName, setRecipientName] = useState<string>('')
  const [notes, setNotes] = useState<string>('صرف وتغذية عهدة ومهمات معتمدة بقرار لجنة المخازن')

  // Search term inside the item selector
  const [itemSearchTerm, setItemSearchTerm] = useState<string>('')

  // Selected items: requirement #18: NO preselected items; explicit user selection only
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set<string>())

  // Quantities to disburse per item
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})

  // Recording and Submission state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRecorded, setIsRecorded] = useState(false)
  const [recordFeedback, setRecordFeedback] = useState<string | null>(null)

  // Clean up printing class after print dialog closes
  useEffect(() => {
    function handleAfterPrint() {
      document.body.classList.remove('printing-official-permit')
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  function handleSourceWarehouseChange(newSourceId: string) {
    setSourceWarehouseId(newSourceId)
    // Clear selection when source changes to prevent cross-warehouse leakage
    setSelectedItemIds(new Set())
    setItemQuantities({})
  }

  const sourceWh = WAREHOUSES.find((w) => w.id === sourceWarehouseId) || WAREHOUSES[0]
  const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId) || WAREHOUSES[1]

  // Available items strictly in the source warehouse (Requirement #18: NO fallback to all items)
  const candidateItems = useMemo(() => {
    const pool = allWarehouseItems.filter((i) => i.warehouseId === sourceWarehouseId && (i.quantity || 0) > 0)
    if (!itemSearchTerm.trim()) return pool
    const q = itemSearchTerm.toLowerCase().trim()
    return pool.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        (i.serialNumber && i.serialNumber.toLowerCase().includes(q)) ||
        (i.category && i.category.toLowerCase().includes(q))
    )
  }, [allWarehouseItems, sourceWarehouseId, itemSearchTerm])

  const itemsToPrint = useMemo(() => {
    return allWarehouseItems
      .filter((i) => i.warehouseId === sourceWarehouseId && selectedItemIds.has(i.id))
  }, [allWarehouseItems, sourceWarehouseId, selectedItemIds])

  const totalDisbursedPieces = useMemo(() => {
    return itemsToPrint.reduce((sum, it) => sum + (itemQuantities[it.id] ?? 1), 0)
  }, [itemsToPrint, itemQuantities])

  // Validation rules (Requirement #18: block same source/target, require quantities and essential fields)
  const validationError = useMemo(() => {
    if (sourceWarehouseId === targetWarehouseId) {
      return 'لا يمكن أن يكون المخزن المنصرف منه هو نفس الجهة المستلمة. يرجى اختيار جهة مستلمة مختلفة.'
    }
    if (!permitNumber.trim()) {
      return 'يرجى إدخال رقم الإذن الرسمي.'
    }
    if (!permitDate.trim()) {
      return 'يرجى تحديد تاريخ الإذن.'
    }
    if (!recipientName.trim()) {
      return 'يرجى إدخال اسم أمين العهدة أو المسؤول المستلم.'
    }
    if (selectedItemIds.size === 0) {
      return 'يرجى تحديد صنف واحد على الأقل لإدراجه في إذن الصرف.'
    }
    for (const it of itemsToPrint) {
      const qty = itemQuantities[it.id] ?? 0
      if (!qty || qty <= 0) {
        return `يرجى تحديد كمية صالحة للصنف "${it.name}".`
      }
      if (qty > it.quantity) {
        return `الكمية المحددة للصنف "${it.name}" (${qty}) تتجاوز الرصيد المتاح بالمخزن (${it.quantity}).`
      }
    }
    return null
  }, [sourceWarehouseId, targetWarehouseId, permitNumber, permitDate, recipientName, selectedItemIds, itemsToPrint, itemQuantities])

  // Safe dismissal handler (Requirement #25)
  const isDirty = selectedItemIds.size > 0 || recipientName.trim().length > 0
  function handleSafeClose() {
    if (isSubmitting) return
    if (isDirty && !isRecorded) {
      if (!window.confirm('هل أنت متأكد من إغلاق نافذة الإذن وتجاهل التعديلات غير المسجلة؟')) {
        return
      }
    }
    onClose()
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isSubmitting) return
        handleSafeClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSubmitting, isDirty, isRecorded])

  function handlePrintPermit() {
    if (validationError) return
    document.body.classList.add('printing-official-permit')
    setTimeout(() => {
      window.print()
    }, 50)
  }

  async function handleRecordAndExecute() {
    if (validationError || !onRecordPermit) return
    setIsSubmitting(true)
    setRecordFeedback(null)
    try {
      const itemsPayload = itemsToPrint.map((it) => ({
        item: it,
        quantity: itemQuantities[it.id] ?? 1,
      }))
      await onRecordPermit({
        permitNumber,
        permitDate,
        sourceWarehouseId,
        targetWarehouseId,
        recipientName,
        notes,
        items: itemsPayload,
      })
      setIsRecorded(true)
      setRecordFeedback('✓ تم اعتماد وتسجيل إذن الصرف ونقل العهدة في الدفاتر بنجاح!')
    } catch (err) {
      setRecordFeedback(err instanceof Error ? err.message : 'تعذر اعتماد وتسجيل الإذن.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function toggleItem(item: CustodyItem) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
        if (itemQuantities[item.id] === undefined) {
          setItemQuantities((q) => ({ ...q, [item.id]: 1 }))
        }
      }
      return next
    })
  }

  function updateQuantity(itemId: string, newQty: number, maxQty: number) {
    const valid = Math.max(1, Math.min(Math.floor(newQty) || 1, maxQty))
    setItemQuantities((prev) => ({
      ...prev,
      [itemId]: valid,
    }))
  }

  function selectAllCandidates() {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      candidateItems.forEach((it) => {
        next.add(it.id)
        if (itemQuantities[it.id] === undefined) {
          setItemQuantities((q) => ({ ...q, [it.id]: 1 }))
        }
      })
      return next
    })
  }

  function clearAllCandidates() {
    setSelectedItemIds(new Set())
  }

  const logoUrl = settings.logoDataUrl || settings.logoUrl

  return (
    <AccessibleDialog
      isOpen={true}
      onClose={handleSafeClose}
      titleId="official-permit-modal-title"
      dialogClassName="modal-dialog official-permit-dialog"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      {/* Modal Controls Header (Hidden in Print) */}
      <div className="modal-header no-print permit-controls-header">
        <div className="modal-title-wrap flex items-center gap-3">
          <div className="modal-title-icon permit-title-icon">
            <FileCheck2 size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 id="official-permit-modal-title" className="m-0 text-lg font-bold text-ink">
                إصدار وطباعة إذن صرف / تسليم عهدة رسمي
              </h3>
                <span className={`permit-badge-tag ${isRecorded ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 font-bold' : ''}`}>
                  {isRecorded ? '✓ إذن رسمي معتمد ومسجل بالدفاتر' : 'مسودة إذن (غير مسجلة بالدفاتر)'}
                </span>
              </div>
              <span className="modal-subtitle font-xs text-muted mt-1 block">
                نموذج حكومي رسمي معتمد بالترويسة والختم والعلامة المائية المعتمدة مع التدقيق الفوري للكميات والأرصدة
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isRecorded ? (
              <>
                <button
                  type="button"
                  className="secondary-btn permit-print-btn"
                  onClick={handlePrintPermit}
                  disabled={itemsToPrint.length === 0 || !!validationError || isSubmitting}
                  title={validationError || "طباعة مسودة الإذن للمعاينة"}
                >
                  <Printer size={16} />
                  <span>طباعة مسودة ({itemsToPrint.length} صنف)</span>
                </button>
                {onRecordPermit && (
                  <button
                    type="button"
                    className="primary-btn permit-record-btn"
                    onClick={handleRecordAndExecute}
                    disabled={itemsToPrint.length === 0 || !!validationError || isSubmitting}
                    title={validationError || "اعتماد وتسجيل الإذن ونقل الأصناف بالدفاتر"}
                  >
                    <FileCheck2 size={16} />
                    <span>{isSubmitting ? 'جارٍ التسجيل بالدفاتر...' : `اعتماد وتسجيل الإذن (${itemsToPrint.length} صنف)`}</span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="primary-btn permit-print-btn bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handlePrintPermit}
                title="طباعة إذن الصرف الرسمي المعتمد"
              >
                <Printer size={16} />
                <span>طباعة الإذن المعتمد ({itemsToPrint.length} صنف - {totalDisbursedPieces} قطعة)</span>
              </button>
            )}
            <button
              type="button"
              className="modal-close-btn permit-close-icon-btn"
              onClick={handleSafeClose}
              disabled={isSubmitting}
              aria-label="إغلاق"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Main Content (2-Column Desktop Grid) */}
        <div className="modal-body-scroll permit-modal-body-scroll">
          <div className="official-permit-body-grid">
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* RIGHT COLUMN: PERMIT CONFIG & ITEM QUANTITIES (Hidden in Print) */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div className="no-print permit-left-col">
              {recordFeedback && (
                <div className="inline-message success flex items-center gap-2 mb-3 font-sm">
                  <CheckCircle2 size={16} />
                  <span>{recordFeedback}</span>
                </div>
              )}

              {validationError && (
                <div className="inline-message error flex items-center gap-2 mb-3 font-sm" role="alert">
                  <ShieldAlert size={16} />
                  <span>{validationError}</span>
                </div>
              )}

              {/* Card 1: Permit Metadata Form */}
              <div className="permit-card-box">
                <div className="flex items-center gap-2 mb-3 font-bold font-sm text-ink">
                  <ArrowRightLeft size={16} className="text-accent" />
                  <span>بيانات إذن الصرف والتوجيه</span>
                </div>

                <div className="grid-2col-fit">
                  <label className="form-label-compact">
                    نوع المستند:
                    <select
                      value={permitType}
                      disabled={isRecorded || isSubmitting}
                      onChange={(e) => setPermitType(e.target.value as 'disburse' | 'receive')}
                      className="input-compact"
                    >
                      <option value="disburse">إذن صرف عهدة ومهمات</option>
                      <option value="receive">محضر فحص واستلام عهدة</option>
                    </select>
                  </label>

                  <label className="form-label-compact">
                    رقم الإذن:
                    <input
                      type="text"
                      value={permitNumber}
                      disabled={isRecorded || isSubmitting}
                      onChange={(e) => setPermitNumber(e.target.value)}
                      className="input-compact"
                    />
                  </label>

                  <label className="form-label-compact">
                    تاريخ الإذن:
                    <input
                      type="date"
                      value={permitDate}
                      disabled={isRecorded || isSubmitting}
                      onChange={(e) => setPermitDate(e.target.value)}
                      className="input-compact"
                    />
                  </label>

                  <label className="form-label-compact">
                    المخزن المنصرف منه (المسلّم):
                    <select
                      value={sourceWarehouseId}
                      disabled={isRecorded || isSubmitting}
                      onChange={(e) => handleSourceWarehouseChange(e.target.value)}
                      className="input-compact"
                    >
                      {WAREHOUSES.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-label-compact">
                    الجهة المستلمة (الكلية):
                    <select
                      value={targetWarehouseId}
                      disabled={isRecorded || isSubmitting}
                      onChange={(e) => setTargetWarehouseId(e.target.value)}
                      className="input-compact"
                    >
                      {WAREHOUSES.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-label-compact">
                    اسم أمين العهدة المستلم:
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="اسم المستلم رباعي"
                      className="input-compact"
                    />
                  </label>

                  <label className="form-label-compact col-span-2">
                    سبب وقرار الصرف:
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="سبب وتوجيه الصرف"
                      className="input-compact"
                    />
                  </label>
                </div>
              </div>

              {/* Card 2: Items & Piece Quantity Manager */}
              <div className="permit-card-flex-box">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-bold font-sm text-ink">
                    <Package size={16} className="text-accent" />
                    <span>تحديد الأصناف وعدد القطع</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="permit-small-btn"
                      onClick={selectAllCandidates}
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      className="permit-small-btn"
                      onClick={clearAllCandidates}
                    >
                      إلغاء التحديد
                    </button>
                  </div>
                </div>

                {/* Search Bar for items */}
                <div className="permit-search-bar">
                  <Search size={14} className="text-muted" />
                  <input
                    id="permit-item-search-input"
                    type="search"
                    aria-label="ابحث في أصناف إذن الصرف بالاسم أو الكود أو السيريال"
                    placeholder="ابحث بالاسم، الكود، أو السيريال..."
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                    className="permit-search-input"
                  />
                  {itemSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setItemSearchTerm('')}
                      className="bg-none border-none cursor-pointer p-0"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Items List with Custom Quantity Selector */}
                <div className="permit-items-list-container">
                  {candidateItems.length === 0 ? (
                    <div className="text-center p-5 text-muted font-xs">
                      لا توجد أصناف متوفرة في مخزن "{sourceWh.name}" مطابقة للبحث.
                    </div>
                  ) : (
                    candidateItems.map((item) => {
                      const isSelected = selectedItemIds.has(item.id)
                      const disburseQty = itemQuantities[item.id] ?? item.quantity

                      return (
                        <div
                          key={item.id}
                          className={`permit-item-row ${isSelected ? 'selected' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <label className="permit-item-row-label">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleItem(item)}
                                className="permit-item-checkbox"
                              />
                              <div>
                                <div className="font-sm font-bold text-ink">
                                  {item.name}
                                </div>
                                <div className="flex items-center gap-2 mt-1 font-xs text-muted">
                                  <span className="font-mono font-semibold">{item.code}</span>
                                  <span>•</span>
                                  <span>المتاح بالرصيد: <strong>{item.quantity}</strong> {item.unit}</span>
                                </div>
                              </div>
                            </label>

                            <span className={`permit-item-status-badge ${isSelected ? 'selected' : 'unselected'}`}>
                              {isSelected ? 'مشمول بالإذن' : 'غير محدد'}
                            </span>
                          </div>

                          {/* When selected: Quantity Stepper & Direct Input */}
                          {isSelected && (
                            <div className="permit-item-qty-stepper-box">
                              <div className="font-xs font-semibold text-ink">
                                عدد القطع المراد صرفها:
                              </div>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="permit-stepper-btn"
                                  onClick={() => updateQuantity(item.id, disburseQty - 1, item.quantity)}
                                  disabled={disburseQty <= 1}
                                  aria-label="إنقاص قطعة واحدة"
                                >
                                  <Minus size={13} />
                                </button>

                                <input
                                  type="number"
                                  min={1}
                                  max={item.quantity}
                                  value={disburseQty}
                                  onChange={(e) => updateQuantity(item.id, Number(e.target.value), item.quantity)}
                                  className="permit-qty-input"
                                />

                                <button
                                  type="button"
                                  className="permit-stepper-btn"
                                  onClick={() => updateQuantity(item.id, disburseQty + 1, item.quantity)}
                                  disabled={disburseQty >= item.quantity}
                                  aria-label="زيادة قطعة واحدة"
                                >
                                  <Plus size={13} />
                                </button>

                                <span className="font-xs text-muted min-w-40">
                                  من {item.quantity} {item.unit}
                                </span>

                                {item.quantity > 1 && (
                                  <div className="flex items-center gap-1 me-1">
                                    <button
                                      type="button"
                                      className={`permit-qty-quick-btn ${disburseQty === 1 ? 'active' : ''}`}
                                      onClick={() => updateQuantity(item.id, 1, item.quantity)}
                                      disabled={disburseQty === 1}
                                      title="تحديد قطعة واحدة فقط"
                                    >
                                      1 قطعة
                                    </button>
                                    <button
                                      type="button"
                                      className={`permit-qty-quick-btn ${disburseQty === item.quantity ? 'active' : ''}`}
                                      onClick={() => updateQuantity(item.id, item.quantity, item.quantity)}
                                      disabled={disburseQty === item.quantity}
                                      title="صرف كامل الكمية المتاحة بالرصيد"
                                    >
                                      الكل ({item.quantity})
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* LEFT COLUMN: LIVE A4 OFFICIAL DOCUMENT PREVIEW */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div className="permit-right-col-preview">
              <div className="no-print permit-preview-topbar">
                <div className="flex items-center gap-1 text-ink font-semibold">
                  <Layers size={15} className="text-accent" />
                  <span>معاينة حية للمستند الرسمي A4 (الختم والعلامة المائية مفعّلة)</span>
                </div>
                <span className="text-muted font-xs">
                  {itemsToPrint.length} صنف مدرج • {totalDisbursedPieces} قطعة إجمالية
                </span>
              </div>

              {/* ═══════════════════════════════════════════════════════════ */}
              {/* THE OFFICIAL PRINTABLE DOCUMENT (A4 Portrait Official Sheet) */}
              {/* ═══════════════════════════════════════════════════════════ */}
              <div
                id="printable-official-permit"
                className="printable-official-permit bg-white text-slate-900"
                style={{ color: '#0f172a' }}
              >
                {/* Security Watermark (Logo centered behind text) */}
                {logoUrl && (
                  <div className="print-watermark" aria-hidden="true">
                    <img src={logoUrl} alt="" />
                  </div>
                )}

                {/* Unified Letterhead */}
                <header className="print-letterhead">
                  <div className="print-header-col print-header-right">
                    <div className="print-gov-heading">جمهورية مصر العربية</div>
                    <div className="print-org-name">{settings.organization || 'جامعة الزقازيق الأهلية'}</div>
                    <div className="print-dept-name">{settings.department || 'إدارة المخازن والمشتريات'}</div>
                    <div className="print-subdept-name">قسم مراقبة وحسابات العهد الحكومية</div>
                  </div>

                  <div className="print-header-col print-header-center">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="print-official-logo"
                        style={{ maxHeight: '60px', maxWidth: '110px', objectFit: 'contain' }}
                      />
                    ) : (
                      <div className="print-logo-emblem">شعار المؤسسة</div>
                    )}
                    <div className="print-stamp-title">
                      {isRecorded ? 'إذن رسمي معتمد' : 'مسودة للمعاينة'}
                    </div>
                  </div>

                  <div className="print-header-col print-header-left">
                    <div><strong>رقم الإذن:</strong> {permitNumber}</div>
                    <div><strong>التاريخ:</strong> {permitDate}</div>
                    <div><strong>المخزن المسلّم:</strong> {sourceWh.name}</div>
                    <div><strong>المخزن المستلم:</strong> {targetWh.name}</div>
                  </div>
                </header>

                {/* Unified Title Banner */}
                <div className="print-title-banner">
                  <h1 className="print-doc-title">
                    {permitType === 'disburse' ? 'إذن صرف ونقل عهدة ومهمات مخزنية' : 'محضر فحص واستلام عهدة مستديمة'}
                  </h1>
                  <div className="print-doc-subtitle">
                    {isRecorded
                      ? 'طبقاً للائحة المخازن والمشتريات الحكومية وقواعد حصر وتدقيق الأصول المستديمة (مسجل بالدفاتر)'
                      : 'مسودة غير معتمدة للمراجعة المبدئية فقط — لم تسجل في دفاتر العهدة بعد'}
                  </div>
                </div>

                {/* Meta Strip */}
                <div className="permit-meta-grid mb-4">
                  <div><strong>المخزن المنصرف منه (المسلّم):</strong> {sourceWh.name}</div>
                  <div><strong>الجهة المستلمة:</strong> {targetWh.name}</div>
                  <div><strong>اسم أمين العهدة المستلم:</strong> {recipientName || 'أمين عهدة الجهة'}</div>
                  <div><strong>الموقع / القاعة المستهدفة:</strong> {targetWh.building}</div>
                  <div className="col-span-2"><strong>سبب وتوجيه الصرف:</strong> {notes}</div>
                </div>

                {/* Items Table */}
                <table className="print-official-table permit-table">
                  <thead>
                    <tr className="permit-table-header-row">
                      <th style={{ width: '38px', textAlign: 'center' }}>م</th>
                      <th style={{ width: '100px', textAlign: 'center' }}>كود العهدة</th>
                      <th>اسم الصنف ومواصفاته الفنية</th>
                      <th style={{ width: '65px', textAlign: 'center' }}>الكمية</th>
                      <th style={{ width: '65px', textAlign: 'center' }}>الوحدة</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>الحالة</th>
                      <th style={{ width: '140px' }}>ملاحظات / السيريال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsToPrint.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-muted" style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                          يرجى اختيار صنف واحد على الأقل وتحديد عدد القطع لإدراجه في إذن الصرف.
                        </td>
                      </tr>
                    ) : (
                      itemsToPrint.map((item, idx) => {
                        const disburseQty = itemQuantities[item.id] !== undefined ? itemQuantities[item.id] : (item.quantity || 1)
                        const conditionLabel =
                          item.condition === 'excellent'
                            ? 'ممتازة'
                            : item.condition === 'good'
                            ? 'جيدة'
                            : item.condition === 'maintenance'
                            ? 'تحتاج صيانة'
                            : 'كهنة'
                        return (
                          <tr key={item.id}>
                            <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>{item.code || '—'}</td>
                            <td style={{ fontWeight: 700 }}>{item.name}</td>
                            <td style={{ textAlign: 'center', fontWeight: 800, fontSize: '11pt' }}>
                              {disburseQty}
                            </td>
                            <td style={{ textAlign: 'center' }}>{item.unit || 'قطعة'}</td>
                            <td style={{ textAlign: 'center' }}>{conditionLabel}</td>
                            <td style={{ fontSize: '7.5pt' }}>
                              {item.serialNumber ? `S/N: ${item.serialNumber}` : item.notes || '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {itemsToPrint.length > 0 && (
                    <tfoot>
                      <tr className="permit-table-footer-row">
                        <td colSpan={3} className="text-start" style={{ textAlign: 'start', fontWeight: 700 }}>
                          إجمالي عدد القطع المصرّحة بالإذن:
                        </td>
                        <td className="text-center font-extrabold text-base" style={{ textAlign: 'center', fontWeight: 800, fontSize: '11pt' }}>
                          {totalDisbursedPieces}
                        </td>
                        <td colSpan={3} style={{ fontWeight: 600 }}>
                          قطعة / وحدة عهدة
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {/* Acknowledgment Statement */}
                <div className="permit-declaration-box">
                  <strong>إقرار استلام:</strong> أقر أنا الموقع أدناه بأنني عاينت واستلمت كافة الأصناف والمهمات المبينة أعلاه بالعدد والكمية المحددة بحالة فنية سليمة ومطابقة للمواصفات، وقيدت بعهدتي الشخصية والمصلحية تحت مسؤوليتي المباشرة طبقاً للائحة المخازن الرسمية.
                </div>

                {/* Unified Signatures Block (Image 3: Anchored at end of last page) */}
                <div className="print-signatures-section">
                  <div className="print-signatures-notice">
                    * يُقر الموقعون أدناه بصحة بيانات الصرف والمعاينة الفنية والاستلام الفعلي لكافة الأصناف الموضحة أعلاه وفقاً للوائح والقوانين المخزنية.
                  </div>
                  <div className="print-signatures-grid">
                    <div className="print-signature-box">
                      <strong className="print-sig-role">أمين العهدة المستلم</strong>
                      <div className="print-sig-field">الاسم: {recipientName || '....................'}</div>
                      <div className="print-sig-field">التوقيع: ..................</div>
                    </div>

                    <div className="print-signature-box">
                      <strong className="print-sig-role">أمين المخزن المسلّم</strong>
                      <div className="print-sig-field">الاسم: ....................</div>
                      <div className="print-sig-field">التوقيع: ..................</div>
                    </div>

                    <div className="print-signature-box">
                      <strong className="print-sig-role">المراجع المخزني</strong>
                      <div className="print-sig-field">الاسم: ....................</div>
                      <div className="print-sig-field">التوقيع: ..................</div>
                    </div>

                    <div className="print-signature-box print-seal-box">
                      <strong className="print-sig-role">يعتمد: مدير عام المخازن</strong>
                      <div className="print-sig-field">الاعتماد: ..................</div>
                      <div className="print-seal-area">
                        <span className="print-seal-hint">(خاتم شعار المؤسسة)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div className="modal-footer no-print permit-footer-controls">
          <div className="flex items-center gap-3 font-sm text-muted">
            <span className="font-semibold text-ink">
              الملخص: {itemsToPrint.length} صنف محدد ({totalDisbursedPieces} قطعة إجمالية)
            </span>
            <span>•</span>
            <span>المستند مهيأ بالكامل للطباعة على ورقة A4 رأسية</span>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="secondary-btn" onClick={onClose}>
              إلغاء
            </button>
            <button
              type="button"
              onClick={handlePrintPermit}
              disabled={itemsToPrint.length === 0}
             className="primary-btn font-bold">
              <Printer size={16} />
              <span>طباعة الإذن الآن (A4 معتمد)</span>
            </button>
          </div>
        </div>
    </AccessibleDialog>
  )
}
