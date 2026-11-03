import { localDate } from '../lib/localDate'
import React, { useState } from 'react'
import {
  X,
  History,
  Calendar,
  MapPin,
  User,
  Package,
  Wrench,
  CheckCircle2,
  FileText,
  PlusCircle,
  Save,
} from 'lucide-react'
import { WAREHOUSES, type CustodyItem } from '../lib/custody'
import type { AppSettings } from '../lib/settings'

interface CustodyItemHistoryModalProps {
  item: CustodyItem
  currency: AppSettings['currency']
  onClose: () => void
  onUpdateItem: (updatedItem: CustodyItem, note?: string) => void | Promise<void>
}

function formatMoney(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export const CustodyItemHistoryModal: React.FC<CustodyItemHistoryModalProps> = ({
  item,
  currency,
  onClose,
  onUpdateItem,
}) => {
  const warehouse = WAREHOUSES.find((w) => w.id === item.warehouseId) || WAREHOUSES[0]

  const [newLogText, setNewLogText] = useState('')
  const [newCondition, setNewCondition] = useState(item.condition)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const historicalEvents = (item.history || []).map((event) => ({
    date: localDate(event.at), title: event.title, desc: event.description,
    type: event.kind === 'purchase' ? 'creation' : event.kind === 'transfer' || event.kind === 'disbursement' ? 'transfer' : 'note',
  }))
  async function handleSaveLog() {
    if (!newLogText.trim() && newCondition === item.condition) return
    setIsSaving(true)
    setSaveError('')
    try {
      await onUpdateItem({ ...item, condition: newCondition }, newLogText.trim() || `تغيير الحالة الفنية إلى ${newCondition}`)
      setNewLogText('')
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'تعذر حفظ الإجراء؛ احتُفظ بالنص للمحاولة مجدداً.') }
    finally { setIsSaving(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px', maxHeight: '90vh' }}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'rgba(8, 127, 104, 0.12)', color: 'var(--accent)' }}>
              <History size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--ink)' }}>سجل تاريخ وحركة الأصل</h3>
              <span className="modal-subtitle">
                تتبع مسار الأصل وتاريخ القيد والصيانة والنقل بين القاعات
              </span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body-scroll" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Asset Summary Card */}
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '12px',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>كود العهدة: <code>{item.code}</code></span>
                <h4 style={{ margin: '2px 0 0 0', fontSize: '1.1rem', color: 'var(--ink)' }}>{item.name}</h4>
              </div>
              <span className={`status-pill ${item.condition === 'excellent' || item.condition === 'good' ? 'status-pill-ok' : 'status-pill-warn'}`}>
                {item.condition === 'excellent' ? 'ممتازة' : item.condition === 'good' ? 'جيدة' : item.condition === 'maintenance' ? 'صيانة' : 'كهنة'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                <MapPin size={15} style={{ color: 'var(--accent)' }} />
                <span>{warehouse.name} ({item.roomLocation || '—'})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                <User size={15} style={{ color: 'var(--accent)' }} />
                <span>أمين العهدة: {item.custodian || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                <Package size={15} style={{ color: 'var(--accent)' }} />
                <span>الكمية: {item.quantity} {item.unit}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                <Calendar size={15} style={{ color: 'var(--accent)' }} />
                <span>القيمة: {formatMoney(item.value, currency)}</span>
              </div>
            </div>

            {item.serialNumber && (
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', borderTop: '1px dashed var(--line)', paddingTop: '8px' }}>
                الرقم التسلسلي (Serial Number): <strong>{item.serialNumber}</strong>
              </div>
            )}
          </div>

          {item.notes && <div className="inline-message"><strong>ملاحظات السجل السابق (ليست أحداثاً موثقة):</strong> {item.notes}</div>}
          {historicalEvents.length === 0 && <p>لا توجد أحداث مخزنية موثقة لهذا السجل حتى الآن. لم يتم تخمين تاريخ سابق من الملاحظات.</p>}
          {saveError && <div className="inline-message error" role="alert">{saveError}</div>}
          {/* Timeline of structured events */}
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>
              مسار الخط الزمني وسجل العمليات:
            </div>

            <div style={{ position: 'relative', paddingInlineStart: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Vertical line */}
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  bottom: '10px',
                  right: '10px',
                  width: '2px',
                  background: 'var(--line)',
                }}
              />

              {historicalEvents.map((evt, idx) => {
                const isCreation = evt.type === 'creation'
                const isTransfer = evt.type === 'transfer'
                const isMaintenance = evt.type === 'maintenance'

                const dotColor = isCreation ? '#10b981' : isTransfer ? '#3b82f6' : isMaintenance ? '#f59e0b' : 'var(--accent)'
                const Icon = isCreation ? CheckCircle2 : isTransfer ? Package : isMaintenance ? Wrench : FileText

                return (
                  <div key={idx} style={{ position: 'relative' }}>
                    {/* Dot */}
                    <div
                      style={{
                        position: 'absolute',
                        right: '-28px',
                        top: '2px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: 'var(--surface)',
                        border: `2px solid ${dotColor}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: dotColor,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                      }}
                    >
                      <Icon size={11} />
                    </div>

                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: '10px',
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '0.88rem', color: 'var(--ink)' }}>{evt.title}</strong>
                        {evt.date && (
                          <span style={{ fontSize: '0.74rem', color: 'var(--muted)', background: 'var(--bg)', padding: '2px 6px', borderRadius: '4px' }}>
                            {evt.date}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                        {evt.desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Add Log / Maintenance Note */}
          <div
            style={{
              padding: '14px',
              borderRadius: '12px',
              background: 'rgba(8, 127, 104, 0.04)',
              border: '1px solid rgba(8, 127, 104, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 600, color: 'var(--accent)' }}>
              <PlusCircle size={16} />
              <span>إضافة إجراء فحص أو ملاحظة صيانة جديدة:</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '10px' }}>
              <input
                type="text"
                placeholder="اكتب الإجراء (مثلاً: تم الفحص الفني الدوري ويعمل بكفاءة)"
                value={newLogText}
                onChange={(e) => setNewLogText(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: '0.86rem',
                }}
              />

              <select
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value as CustodyItem['condition'])}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: '0.86rem',
                }}
                aria-label="تحديث الحالة الفنية"
              >
                <option value="excellent">ممتازة (جاهزة للعمل)</option>
                <option value="good">جيدة (تعمل بكفاءة)</option>
                <option value="maintenance">تحتاج صيانة / فحص</option>
                <option value="damaged">تالفة / كهنة</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSaveLog}
                disabled={isSaving || (!newLogText.trim() && newCondition === item.condition)}
                style={{ padding: '7px 16px', fontSize: '0.85rem' }}
              >
                <Save size={15} />
                <span>حفظ في سجل الأصل</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button type="button" className="secondary-btn" onClick={onClose} style={{ padding: '8px 20px' }}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
