import React, { useState, useMemo, useEffect } from 'react'
import {
  X,
  Printer,
  FileCheck2,
  Warehouse,
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
    if (defaultWarehouseId && defaultWarehouseId !== 'main') {
      return defaultWarehouseId
    }
    if (initialItems[0]?.warehouseId && initialItems[0].warehouseId !== 'main') {
      return initialItems[0].warehouseId
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
    return allWarehouseItems.filter((i) => selectedItemIds.has(i.id))
  }, [allWarehouseItems, selectedItemIds])

  const totalDisbursedPieces = useMemo(() => {
    return itemsToPrint.reduce((sum, it) => sum + (itemQuantities[it.id] ?? it.quantity), 0)
  }, [itemsToPrint, itemQuantities])

  function handlePrintPermit() {
    document.body.classList.add('printing-official-permit')
    window.print()
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog official-permit-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '96vw',
          maxWidth: '1440px',
          height: '95vh',
          maxHeight: '95vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '16px',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {/* Modal Controls Header (Hidden in Print) */}
        <div
          className="modal-header no-print"
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div className="modal-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              className="modal-title-icon"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--badge-success-bg)',
                color: 'var(--accent)',
              }}
            >
              <FileCheck2 size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--ink)' }}>
                  إصدار وطباعة إذن صرف / تسليم عهدة رسمي
                </h3>
                <span
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    color: 'var(--muted)',
                  }}
                >
                  حجم شاشة كامل (A4 معتمد)
                </span>
              </div>
              <span className="modal-subtitle" style={{ fontSize: '0.84rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
                نموذج حكومي رسمي معتمد بالترويسة والختم والعلامة المائية المعتمدة مع إمكانية تحديد عدد القطع بدقة
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="primary-btn"
              onClick={handlePrintPermit}
              disabled={itemsToPrint.length === 0}
              style={{
                padding: '8px 18px',
                fontSize: '0.9rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              title="طباعة إذن الصرف فوراً على مقاس A4"
            >
              <Printer size={16} />
              <span>طباعة الإذن ({itemsToPrint.length} صنف - {totalDisbursedPieces} قطعة)</span>
            </button>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="إغلاق"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Main Content (2-Column Desktop Grid) */}
        <div
          className="modal-body-scroll"
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '16px 20px',
            background: 'var(--bg)',
          }}
        >
          <div
            className="official-permit-body-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(380px, 460px) 1fr',
              gap: '18px',
              height: '100%',
              alignItems: 'stretch',
            }}
          >
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* RIGHT COLUMN: PERMIT CONFIG & ITEM QUANTITIES (Hidden in Print) */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div
              className="no-print"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                height: '100%',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
            >
              {/* Card 1: Permit Metadata Form */}
              <div
                style={{
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  padding: '14px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)' }}>
                  <ArrowRightLeft size={16} className="text-accent" />
                  <span>بيانات إذن الصرف والتوجيه</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    نوع المستند:
                    <select
                      value={permitType}
                      onChange={(e) => setPermitType(e.target.value as 'disburse' | 'receive')}
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    >
                      <option value="disburse">إذن صرف عهدة ومهمات</option>
                      <option value="receive">محضر فحص واستلام عهدة</option>
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    رقم الإذن:
                    <input
                      type="text"
                      value={permitNumber}
                      onChange={(e) => setPermitNumber(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    تاريخ الإذن:
                    <input
                      type="date"
                      value={permitDate}
                      onChange={(e) => setPermitDate(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    المخزن المنصرف منه (المسلّم):
                    <select
                      value={sourceWarehouseId}
                      onChange={(e) => setSourceWarehouseId(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    >
                      {WAREHOUSES.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    الجهة المستلمة (الكلية):
                    <select
                      value={targetWarehouseId}
                      onChange={(e) => setTargetWarehouseId(e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    >
                      {WAREHOUSES.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                    اسم أمين العهدة المستلم:
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="اسم المستلم رباعي"
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600, gridColumn: 'span 2' }}>
                    سبب وقرار الصرف:
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="سبب وتوجيه الصرف"
                      style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.82rem' }}
                    />
                  </label>
                </div>
              </div>

              {/* Card 2: Items & Piece Quantity Manager */}
              <div
                style={{
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  minHeight: '340px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)' }}>
                    <Package size={16} className="text-accent" />
                    <span>تحديد الأصناف وعدد القطع</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={selectAllCandidates}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.72rem',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        cursor: 'pointer',
                      }}
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      onClick={clearAllCandidates}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.72rem',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--bg)',
                        cursor: 'pointer',
                      }}
                    >
                      إلغاء التحديد
                    </button>
                  </div>
                </div>

                {/* Search Bar for items */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    marginBottom: '10px',
                  }}
                >
                  <Search size={14} style={{ color: 'var(--muted)' }} />
                  <input
                    type="search"
                    placeholder="ابحث بالاسم، الكود، أو السيريال..."
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      width: '100%',
                      fontSize: '0.8rem',
                      color: 'var(--ink)',
                    }}
                  />
                  {itemSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setItemSearchTerm('')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Items List with Custom Quantity Selector */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    overflowY: 'auto',
                    flex: 1,
                    maxHeight: '360px',
                    paddingLeft: '2px',
                  }}
                >
                  {candidateItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--muted)', fontSize: '0.82rem' }}>
                      لا توجد أصناف متوفرة في مخزن "{sourceWh.name}" مطابقة للبحث.
                    </div>
                  ) : (
                    candidateItems.map((item) => {
                      const isSelected = selectedItemIds.has(item.id)
                      const disburseQty = itemQuantities[item.id] ?? item.quantity

                      return (
                        <div
                          key={item.id}
                          style={{
                            borderRadius: '10px',
                            border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                            background: isSelected ? 'var(--accent-dim)' : 'var(--bg)',
                            padding: '10px 12px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                cursor: 'pointer',
                                flex: 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleItem(item)}
                                style={{
                                  marginTop: '3px',
                                  cursor: 'pointer',
                                  width: '16px',
                                  height: '16px',
                                  accentColor: 'var(--accent)',
                                }}
                              />
                              <div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)' }}>
                                  {item.name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '0.74rem', color: 'var(--muted)' }}>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.code}</span>
                                  <span>•</span>
                                  <span>المتاح بالرصيد: <strong>{item.quantity}</strong> {item.unit}</span>
                                </div>
                              </div>
                            </label>

                            <span
                              style={{
                                fontSize: '0.72rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: isSelected ? 'var(--accent)' : 'var(--surface)',
                                color: isSelected ? 'var(--text-on-accent)' : 'var(--muted)',
                                fontWeight: 700,
                              }}
                            >
                              {isSelected ? 'مشمول بالإذن' : 'غير محدد'}
                            </span>
                          </div>

                          {/* When selected: Quantity Stepper & Direct Input */}
                          {isSelected && (
                            <div
                              style={{
                                marginTop: '10px',
                                paddingTop: '8px',
                                borderTop: '1px dashed var(--line)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '10px',
                                background: 'var(--surface)',
                                padding: '8px 10px',
                                borderRadius: '8px',
                              }}
                            >
                              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink)' }}>
                                عدد القطع المراد صرفها:
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, disburseQty - 1, item.quantity)}
                                  disabled={disburseQty <= 1}
                                  style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--line)',
                                    background: 'var(--bg)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: disburseQty <= 1 ? 'not-allowed' : 'pointer',
                                    opacity: disburseQty <= 1 ? 0.4 : 1,
                                  }}
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
                                  style={{
                                    width: '60px',
                                    padding: '4px 6px',
                                    textAlign: 'center',
                                    fontSize: '0.9rem',
                                    fontWeight: 700,
                                    borderRadius: '6px',
                                    border: '1.5px solid var(--accent)',
                                    background: 'var(--bg)',
                                    color: 'var(--ink)',
                                  }}
                                />

                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, disburseQty + 1, item.quantity)}
                                  disabled={disburseQty >= item.quantity}
                                  style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--line)',
                                    background: 'var(--bg)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: disburseQty >= item.quantity ? 'not-allowed' : 'pointer',
                                    opacity: disburseQty >= item.quantity ? 0.4 : 1,
                                  }}
                                  aria-label="زيادة قطعة واحدة"
                                >
                                  <Plus size={13} />
                                </button>

                                <span style={{ fontSize: '0.78rem', color: 'var(--muted)', minWidth: '40px' }}>
                                  من {item.quantity} {item.unit}
                                </span>

                                {item.quantity > 1 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '4px' }}>
                                    <button
                                      type="button"
                                      onClick={() => updateQuantity(item.id, 1, item.quantity)}
                                      disabled={disburseQty === 1}
                                      style={{
                                        fontSize: '0.73rem',
                                        padding: '2px 6px',
                                        borderRadius: '5px',
                                        border: '1px solid var(--line)',
                                        background: disburseQty === 1 ? 'var(--surface)' : 'var(--bg)',
                                        color: 'var(--ink)',
                                        cursor: disburseQty === 1 ? 'default' : 'pointer',
                                        opacity: disburseQty === 1 ? 0.45 : 1,
                                        fontWeight: 600,
                                      }}
                                      title="تحديد قطعة واحدة فقط"
                                    >
                                      1 قطعة
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => updateQuantity(item.id, item.quantity, item.quantity)}
                                      disabled={disburseQty === item.quantity}
                                      style={{
                                        fontSize: '0.73rem',
                                        padding: '2px 7px',
                                        borderRadius: '5px',
                                        border: '1px solid var(--accent)',
                                        background: disburseQty === item.quantity ? 'var(--accent)' : 'var(--accent-dim)',
                                        color: disburseQty === item.quantity ? 'var(--text-on-accent)' : 'var(--accent)',
                                        cursor: disburseQty === item.quantity ? 'default' : 'pointer',
                                        opacity: disburseQty === item.quantity ? 0.7 : 1,
                                        fontWeight: 700,
                                      }}
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
            <div
              style={{
                height: '100%',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--bg)',
                borderRadius: '12px',
                padding: '4px',
              }}
            >
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--surface)',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  marginBottom: '10px',
                  fontSize: '0.82rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)', fontWeight: 600 }}>
                  <Layers size={15} className="text-accent" />
                  <span>معاينة حية للمستند الرسمي A4 (الختم والعلامة المائية مفعّلة)</span>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: '0.76rem' }}>
                  {itemsToPrint.length} صنف مدرج • {totalDisbursedPieces} قطعة إجمالية
                </span>
              </div>

              {/* ═══════════════════════════════════════════════════════════ */}
              {/* THE OFFICIAL PRINTABLE DOCUMENT (A4 Portrait Official Sheet) */}
              {/* ═══════════════════════════════════════════════════════════ */}
              <div
                id="printable-official-permit"
                className="printable-official-permit"
                style={{
                  position: 'relative',
                  padding: '28px',
                  background: '#ffffff',
                  color: '#000000',
                  border: '2px solid #000000',
                  borderRadius: '4px',
                  fontFamily: "'Amiri', 'Traditional Arabic', 'Cairo', serif",
                  lineHeight: 1.4,
                  boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                }}
              >
                {/* Security Watermark (Logo centered behind text) */}
                {logoUrl && (
                  <div className="print-watermark" aria-hidden="true">
                    <img src={logoUrl} alt="" />
                  </div>
                )}

                {/* Header */}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px double #000', paddingBottom: '14px', marginBottom: '16px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>جمهورية مصر العربية</div>
                    <div style={{ fontSize: '0.98rem', fontWeight: 700 }}>{settings.organization || 'المؤسسة التعليمية'}</div>
                    <div style={{ fontSize: '0.9rem' }}>{settings.department || 'إدارة المخازن المركزية'}</div>
                    <div style={{ fontSize: '0.82rem' }}>قسم مراقبة وحسابات العهد الحكومية</div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" style={{ maxHeight: '68px', maxWidth: '100px', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ border: '1px solid #333', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem' }}>
                        <Warehouse size={28} style={{ margin: '0 auto' }} />
                        <div>شعار المؤسسة</div>
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'left', direction: 'ltr', fontSize: '0.85rem' }}>
                    <div><strong>رقم الإذن:</strong> {permitNumber}</div>
                    <div><strong>التاريخ:</strong> {permitDate}</div>
                    <div><strong>السنة المالية:</strong> 2026/2027</div>
                  </div>
                </div>

                {/* Title */}
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', margin: '14px 0', borderBottom: '1px solid #000', paddingBottom: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, textDecoration: 'underline' }}>
                    {permitType === 'disburse' ? 'إذن صرف ونقل عهدة ومهمات مخزنية' : 'محضر فحص واستلام عهدة مستديمة'}
                  </h2>
                  <div style={{ fontSize: '0.86rem', marginTop: '4px' }}>
                    طبقاً للائحة المخازن والمشتريات الحكومية وقواعد حصر وتدقيق الأصول المستديمة
                  </div>
                </div>

                {/* Meta Strip */}
                <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '0.92rem', marginBottom: '16px', background: '#f9f9f9', padding: '10px 14px', border: '1px solid #ccc' }}>
                  <div><strong>المخزن المنصرف منه (المسلّم):</strong> {sourceWh.name}</div>
                  <div><strong>الجهة المستلمة:</strong> {targetWh.name}</div>
                  <div><strong>اسم أمين العهدة المستلم:</strong> {recipientName || 'أمين عهدة الجهة'}</div>
                  <div><strong>الموقع / القاعة المستهدفة:</strong> {targetWh.building}</div>
                  <div style={{ gridColumn: 'span 2' }}><strong>سبب وتوجيه الصرف:</strong> {notes}</div>
                </div>

                {/* Items Table */}
                <table style={{ position: 'relative', zIndex: 1, width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: '#eee' }}>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '38px', textAlign: 'center' }}>م</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '95px' }}>كود العهدة</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px' }}>اسم الصنف ومواصفاته الفنية</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '70px', textAlign: 'center' }}>الكمية</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '65px', textAlign: 'center' }}>الوحدة</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '85px', textAlign: 'center' }}>الحالة</th>
                      <th style={{ border: '1px solid #000', padding: '7px 8px', width: '130px' }}>ملاحظات / السيريال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsToPrint.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ border: '1px solid #000', padding: '18px', textAlign: 'center', color: '#666' }}>
                          يرجى اختيار صنف واحد على الأقل وتحديد عدد القطع لإدراجه في إذن الصرف.
                        </td>
                      </tr>
                    ) : (
                      itemsToPrint.map((item, idx) => {
                        const disburseQty = itemQuantities[item.id] ?? item.quantity
                        return (
                          <tr key={item.id}>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{item.code}</td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', fontWeight: 700 }}>{item.name}</td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontWeight: 800, fontSize: '0.98rem' }}>
                              {disburseQty}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>{item.unit}</td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>
                              {item.condition === 'excellent' ? 'ممتازة' : item.condition === 'good' ? 'جيدة' : item.condition === 'maintenance' ? 'تحتاج صيانة' : 'كهنة'}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '6px 8px', fontSize: '0.82rem' }}>
                              {item.serialNumber ? `S/N: ${item.serialNumber}` : item.notes || '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {itemsToPrint.length > 0 && (
                    <tfoot>
                      <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                        <td colSpan={3} style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'left' }}>
                          إجمالي عدد القطع المصرّحة بالإذن:
                        </td>
                        <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: '1rem', fontWeight: 800 }}>
                          {totalDisbursedPieces}
                        </td>
                        <td colSpan={3} style={{ border: '1px solid #000', padding: '6px 8px' }}>
                          قطعة / وحدة عهدة
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {/* Acknowledgment Statement */}
                <div style={{ position: 'relative', zIndex: 1, fontSize: '0.88rem', margin: '14px 0', padding: '8px 12px', border: '1px dashed #444', lineHeight: 1.6 }}>
                  <strong>إقرار استلام:</strong> أقر أنا الموقع أدناه بأنني عاينت واستلمت كافة الأصناف والمهمات المبينة أعلاه بالعدد والكمية المحددة بحالة فنية سليمة ومطابقة للمواصفات، وقيدت بعهدتي الشخصية والمصلحية تحت مسؤوليتي المباشرة طبقاً للائحة المخازن الرسمية.
                </div>

                {/* Signatures Strip */}
                <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginTop: '24px', textAlign: 'center', fontSize: '0.88rem' }}>
                  <div>
                    <strong>أمين العهدة المستلم</strong>
                    <div style={{ height: '42px' }} />
                    <div>الاسم: ....................</div>
                    <div>التوقيع: ..................</div>
                  </div>

                  <div>
                    <strong>أمين المخزن المسلّم</strong>
                    <div style={{ height: '42px' }} />
                    <div>الاسم: ....................</div>
                    <div>التوقيع: ..................</div>
                  </div>

                  <div>
                    <strong>المراجع المخزني</strong>
                    <div style={{ height: '42px' }} />
                    <div>الاسم: ....................</div>
                    <div>التوقيع: ..................</div>
                  </div>

                  <div style={{ border: '1px dashed #999', padding: '4px', borderRadius: '4px' }}>
                    <strong>يعتمد، مدير عام المخازن</strong>
                    <div style={{ height: '28px' }} />
                    <div style={{ fontSize: '0.78rem', color: '#555' }}>(خاتم شعار المؤسسة)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div
          className="modal-footer no-print"
          style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', color: 'var(--muted)' }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
              الملخص: {itemsToPrint.length} صنف محدد ({totalDisbursedPieces} قطعة إجمالية)
            </span>
            <span>•</span>
            <span>المستند مهيأ بالكامل للطباعة على ورقة A4 رأسية</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" className="secondary-btn" onClick={onClose} style={{ padding: '8px 18px' }}>
              إلغاء
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handlePrintPermit}
              disabled={itemsToPrint.length === 0}
              style={{ padding: '9px 24px', fontSize: '0.92rem', fontWeight: 700 }}
            >
              <Printer size={16} />
              <span>طباعة الإذن الآن (A4 معتمد)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
