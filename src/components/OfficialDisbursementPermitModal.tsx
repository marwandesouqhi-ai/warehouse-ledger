import React, { useState, useMemo, useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
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
} from 'lucide-react'
import { WAREHOUSES, type CustodyItem } from '../lib/custody'
import type { AppSettings } from '../lib/settings'

interface OfficialDisbursementPermitModalProps {
  initialItems: CustodyItem[]
  allWarehouseItems: CustodyItem[]
  settings: AppSettings
  onClose: () => void
  defaultWarehouseId?: string
}

export const OfficialDisbursementPermitModal: React.FC<OfficialDisbursementPermitModalProps> = ({
  initialItems,
  allWarehouseItems,
  settings,
  onClose,
  defaultWarehouseId,
}) => {
  const [permitType, setPermitType] = useState<'disburse' | 'receive'>('disburse')
  const [permitNumber, setPermitNumber] = useState<string>(() => {
    return `DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  })
  const [permitDate, setPermitDate] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10)
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
    const initialRaw = initialItems[0]?.warehouseId === 'nursing' ? 'medicine' : initialItems[0]?.warehouseId
    if (initialRaw && initialRaw !== 'main') {
      return initialRaw
    }
    return 'fci'
  })
  const [recipientName, setRecipientName] = useState<string>(initialItems[0]?.custodian || '')
  const [notes, setNotes] = useState<string>('صرف وتغذية عهدة ومهمات معتمدة بقرار لجنة المخازن')

  // Search term inside the item selector
  const [itemSearchTerm, setItemSearchTerm] = useState<string>('')

  // Selected items to include in this permit (strictly user-selected or initial items, NEVER dummy items)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => {
    if (initialItems && initialItems.length > 0) {
      return new Set(initialItems.map((i) => i.id))
    }
    return new Set<string>()
  })

  // Quantities to disburse per item (defaults to full quantity of initial items or 1 piece when user adds an item)
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    if (initialItems && initialItems.length > 0) {
      for (const it of initialItems) {
        init[it.id] = it.quantity || 1
      }
    }
    return init
  })

  // Clean up printing class after print dialog closes
  useEffect(() => {
    function handleAfterPrint() {
      document.body.classList.remove('printing-official-permit')
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  const sourceWh = WAREHOUSES.find((w) => w.id === sourceWarehouseId) || WAREHOUSES[0]
  const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId) || WAREHOUSES[1]

  // Available items in the source warehouse (or all items fallback)
  const candidateItems = useMemo(() => {
    let pool = allWarehouseItems.filter((i) => i.warehouseId === sourceWarehouseId)
    if (pool.length === 0) {
      pool = allWarehouseItems
    }
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
    const pool = [...allWarehouseItems]
    if (initialItems && initialItems.length > 0) {
      for (const init of initialItems) {
        if (!pool.some((p) => p.id === init.id)) {
          pool.push(init)
        }
      }
    }
    return pool.filter((i) => selectedItemIds.has(i.id))
  }, [allWarehouseItems, initialItems, selectedItemIds])

  const totalDisbursedPieces = useMemo(() => {
    return itemsToPrint.reduce((sum, it) => sum + (itemQuantities[it.id] ?? it.quantity), 0)
  }, [itemsToPrint, itemQuantities])

  function handlePrintPermit() {
    document.body.classList.add('printing-official-permit')
    setTimeout(() => {
      window.print()
    }, 50)
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
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="modal-dialog official-permit-dialog"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Modal Controls Header (Hidden in Print) */}
        <div className="modal-header no-print permit-controls-header">
          <div className="modal-title-wrap flex items-center gap-3">
            <div className="modal-title-icon permit-title-icon">
              <FileCheck2 size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="m-0 text-lg font-bold text-ink">
                  إصدار وطباعة إذن صرف / تسليم عهدة رسمي
                </h3>
                <span className="permit-badge-tag">
                  حجم شاشة كامل (A4 معتمد)
                </span>
              </div>
              <span className="modal-subtitle font-xs text-muted mt-1 block">
                نموذج حكومي رسمي معتمد بالترويسة والختم والعلامة المائية المعتمدة مع إمكانية تحديد عدد القطع بدقة
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="primary-btn permit-print-btn"
              onClick={handlePrintPermit}
              disabled={itemsToPrint.length === 0}
              title="طباعة إذن الصرف فوراً على مقاس A4"
            >
              <Printer size={16} />
              <span>طباعة الإذن ({itemsToPrint.length} صنف - {totalDisbursedPieces} قطعة)</span>
            </button>
            <button
              type="button"
              className="modal-close-btn permit-close-icon-btn"
              onClick={onClose}
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
                      onChange={(e) => setPermitNumber(e.target.value)}
                      className="input-compact"
                    />
                  </label>

                  <label className="form-label-compact">
                    تاريخ الإذن:
                    <input
                      type="date"
                      value={permitDate}
                      onChange={(e) => setPermitDate(e.target.value)}
                      className="input-compact"
                    />
                  </label>

                  <label className="form-label-compact">
                    المخزن المنصرف منه (المسلّم):
                    <select
                      value={sourceWarehouseId}
                      onChange={(e) => setSourceWarehouseId(e.target.value)}
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
                    type="search"
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
                    <div className="print-stamp-title">إذن رسمي معتمد</div>
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
                    طبقاً للائحة المخازن والمشتريات الحكومية وقواعد حصر وتدقيق الأصول المستديمة
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
      </motion.div>
    </motion.div>
  )
}
