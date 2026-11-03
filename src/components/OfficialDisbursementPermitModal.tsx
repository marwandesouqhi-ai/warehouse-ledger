import { localDate } from '../lib/localDate'
import React, { useState } from 'react'
import {
  X,
  Printer,
  FileCheck2,
  Warehouse,
} from 'lucide-react'
import { WAREHOUSES, type CustodyItem } from '../lib/custody'
import type { AppSettings } from '../lib/settings'

interface OfficialDisbursementPermitModalProps {
  initialItems: CustodyItem[]
  allWarehouseItems: CustodyItem[]
  settings: AppSettings
  onClose: () => void
}

export const OfficialDisbursementPermitModal: React.FC<OfficialDisbursementPermitModalProps> = ({
  initialItems,
  allWarehouseItems,
  settings,
  onClose,
}) => {
  const [permitType, setPermitType] = useState<'disburse' | 'receive'>('disburse')
  const [permitNumber, setPermitNumber] = useState<string>(() => {
    return `DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  })
  const [permitDate, setPermitDate] = useState<string>(() => {
    return localDate()
  })
  const [sourceWarehouseId, setSourceWarehouseId] = useState<string>('main')
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(
    initialItems[0]?.warehouseId || 'fci'
  )
  const [recipientName, setRecipientName] = useState<string>(initialItems[0]?.custodian || '')
  const [notes, setNotes] = useState<string>('صرف وتغذية عهدة ومهمات معتمدة بقرار لجنة المخازن')

  // Selected items to include in this permit
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => {
    if (initialItems.length > 0) {
      return new Set(initialItems.map((i) => i.id))
    }
    return new Set(allWarehouseItems.slice(0, 5).map((i) => i.id))
  })

  const sourceWh = WAREHOUSES.find((w) => w.id === sourceWarehouseId) || WAREHOUSES[0]
  const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId) || WAREHOUSES[1]

  const itemsToPrint = allWarehouseItems.filter((i) => selectedItemIds.has(i.id))

  function handlePrintPermit() {
    window.print()
  }

  function toggleItem(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const logoUrl = settings.logoDataUrl || settings.logoUrl

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog official-permit-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '850px', maxHeight: '92vh' }}
      >
        {/* Modal Controls Header (Hidden in Print) */}
        <div className="modal-header no-print">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'rgba(8, 127, 104, 0.12)', color: 'var(--accent)' }}>
              <FileCheck2 size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--ink)' }}>
                إصدار وطباعة إذن صرف / تسليم عهدة رسمي
              </h3>
              <span className="modal-subtitle">
                مستند حكومي رسمي معتمد بالترويسة والأختام والتوقيعات الثلاثية (A4)
              </span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body & Print Configuration (Hidden in Print) */}
        <div className="modal-body-scroll" style={{ padding: '20px 24px' }}>
          <div className="permit-config-panel no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', padding: '14px', background: 'var(--bg)', borderRadius: '12px', border: '1px solid var(--line)', marginBottom: '18px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              نوع المستند:
              <select
                value={permitType}
                onChange={(e) => setPermitType(e.target.value as 'disburse' | 'receive')}
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              >
                <option value="disburse">إذن صرف عهدة ومهمات مخزنية</option>
                <option value="receive">محضر فحص وإضافة عهدة مستديمة</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              رقم الإذن:
              <input
                type="text"
                value={permitNumber}
                onChange={(e) => setPermitNumber(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              تاريخ الإذن:
              <input
                type="date"
                value={permitDate}
                onChange={(e) => setPermitDate(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              الجهة المصروف منها (المسلّمة):
              <select
                value={sourceWarehouseId}
                onChange={(e) => setSourceWarehouseId(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              >
                {WAREHOUSES.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              الجهة المستلمة (الكلية / القسم):
              <select
                value={targetWarehouseId}
                onChange={(e) => setTargetWarehouseId(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              >
                {WAREHOUSES.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600 }}>
              اسم أمين العهدة المستلم:
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="اسم المستلم رباعي"
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem', fontWeight: 600, gridColumn: '1 / -1' }}>
              سبب أو قرار الصرف:
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="سبب أو قرار الصرف وتوجيهه"
                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
              />
            </label>
          </div>

          {/* Items Selector Pill Strip (Hidden in Print) */}
          <div className="no-print" style={{ marginBottom: '16px' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
              الأصناف المشمولة في الإذن ({itemsToPrint.length} صنف محدد):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '100px', overflowY: 'auto', padding: '6px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--line)' }}>
              {allWarehouseItems.map((item) => {
                const selected = selectedItemIds.has(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      border: selected ? '1px solid var(--accent)' : '1px solid var(--line)',
                      background: selected ? 'var(--accent)' : 'var(--surface)',
                      color: selected ? '#fff' : 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {selected ? '✓ ' : ''}{item.name} ({item.quantity} {item.unit})
                  </button>
                )
              })}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* THE OFFICIAL PRINTABLE DOCUMENT (A4 Portrait Official Sheet) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div
            id="printable-official-permit"
            className="printable-official-permit"
            style={{
              padding: '28px',
              background: '#ffffff',
              color: '#000000',
              border: '2px solid #000000',
              borderRadius: '4px',
              fontFamily: "'Amiri', 'Traditional Arabic', 'Cairo', serif",
              lineHeight: 1.4,
              boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px double #000', paddingBottom: '14px', marginBottom: '16px' }}>
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
            <div style={{ textAlign: 'center', margin: '14px 0', borderBottom: '1px solid #000', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, textDecoration: 'underline' }}>
                {permitType === 'disburse' ? 'إذن صرف ونقل عهدة ومهمات مخزنية' : 'محضر فحص واستلام عهدة مستديمة'}
              </h2>
              <div style={{ fontSize: '0.86rem', marginTop: '4px' }}>
                طبقاً للائحة المخازن والمشتريات الحكومية وقواعد حصر الأصول المستديمة
              </div>
            </div>

            {/* Meta Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '0.92rem', marginBottom: '16px', background: '#f9f9f9', padding: '10px 14px', border: '1px solid #ccc' }}>
              <div><strong>المخزن المنصرف منه (المسلّم):</strong> {sourceWh.name}</div>
              <div><strong>الجهة المستلمة:</strong> {targetWh.name}</div>
              <div><strong>اسم أمين العهدة المستلم:</strong> {recipientName || 'أمين عهدة الجهة'}</div>
              <div><strong>الموقع / القاعة المستهدفة:</strong> {targetWh.building}</div>
              <div style={{ gridColumn: 'span 2' }}><strong>سبب وتوجيه الصرف:</strong> {notes}</div>
            </div>

            {/* Items Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: '#eee' }}>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '38px', textAlign: 'center' }}>م</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '90px' }}>كود العهدة</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px' }}>اسم الصنف ومواصفاته الفنية</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '60px', textAlign: 'center' }}>الكمية</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '65px', textAlign: 'center' }}>الوحدة</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '85px', textAlign: 'center' }}>الحالة</th>
                  <th style={{ border: '1px solid #000', padding: '7px 8px', width: '130px' }}>ملاحظات / السيريال</th>
                </tr>
              </thead>
              <tbody>
                {itemsToPrint.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ border: '1px solid #000', padding: '18px', textAlign: 'center', color: '#666' }}>
                      يرجى اختيار صنف واحد على الأقل لإدراجه في إذن الصرف.
                    </td>
                  </tr>
                ) : (
                  itemsToPrint.map((item, idx) => (
                    <tr key={item.id}>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{item.code}</td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', fontWeight: 700 }}>{item.name}</td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>{item.unit}</td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center' }}>
                        {item.condition === 'excellent' ? 'ممتازة' : item.condition === 'good' ? 'جيدة' : item.condition === 'maintenance' ? 'تحتاج صيانة' : 'كهنة'}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '6px 8px', fontSize: '0.82rem' }}>
                        {item.serialNumber ? `S/N: ${item.serialNumber}` : item.notes || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Acknowledgment Statement */}
            <div style={{ fontSize: '0.88rem', margin: '14px 0', padding: '8px 12px', border: '1px dashed #444', lineHeight: 1.6 }}>
              <strong>إقرار استلام:</strong> أقر أنا الموقع أدناه بأنني عاينت واستلمت كافة الأصناف والمهمات المبينة عالية بحالة فنية سليمة ومطابقة للمواصفات، وقيدت بعهدتي الشخصية والمصلحية تحت مسؤوليتي المباشرة طبقاً للائحة المخازن الرسمية.
            </div>

            {/* Signatures Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginTop: '28px', textAlign: 'center', fontSize: '0.88rem' }}>
              <div>
                <strong>أمين العهدة المستلم</strong>
                <div style={{ height: '45px' }} />
                <div>الاسم: ....................</div>
                <div>التوقيع: ..................</div>
              </div>

              <div>
                <strong>أمين المخزن المسلّم</strong>
                <div style={{ height: '45px' }} />
                <div>الاسم: ....................</div>
                <div>التوقيع: ..................</div>
              </div>

              <div>
                <strong>المراجع المخزني</strong>
                <div style={{ height: '45px' }} />
                <div>الاسم: ....................</div>
                <div>التوقيع: ..................</div>
              </div>

              <div style={{ border: '1px dashed #999', padding: '4px', borderRadius: '4px' }}>
                <strong>يعتمد، مدير عام المخازن</strong>
                <div style={{ height: '30px' }} />
                <div style={{ fontSize: '0.78rem', color: '#555' }}>(خاتم شعار المؤسسة)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div className="modal-footer no-print">
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
  )
}
