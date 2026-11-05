import React, { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
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
import { getCairoDateString } from '../lib/dateUtils'
import type { AppSettings } from '../lib/settings'

interface CustodyItemHistoryModalProps {
  item: CustodyItem
  currency: AppSettings['currency']
  onClose: () => void
  onUpdateItem: (updatedItem: CustodyItem) => void
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

  // Parse notes into historical timeline points
  const historicalEvents = React.useMemo(() => {
    const events: Array<{ date?: string; title: string; desc: string; type: 'creation' | 'transfer' | 'maintenance' | 'note' }> = []

    // 1. Initial registration event
    events.push({
      date: item.acquisitionDate || 'تاريخ القيد الأولي',
      title: 'قيد وتوريد الأصل لأول مرة',
      desc: `تم توريد وقيد الأصل (${item.name}) بعدد ${item.quantity} ${item.unit} بقيمة تقديرية ${formatMoney(item.value, currency)} في عهدة "${warehouse.name}".`,
      type: 'creation',
    })

    // 2. Transfer / disbursement notes from item.notes
    if (item.notes) {
      const parts = item.notes.split('•').map((p) => p.trim()).filter(Boolean)
      for (const part of parts) {
        if (part.includes('تم النقل') || part.includes('منقول')) {
          events.push({
            title: 'حركة نقل وتوزيع داخلي',
            desc: part,
            type: 'transfer',
          })
        } else if (part.includes('صرف') || part.includes('مصروف')) {
          events.push({
            title: 'إذن صرف وتغذية مخزنية',
            desc: part,
            type: 'transfer',
          })
        } else if (part.includes('صيانة') || part.includes('فحص')) {
          events.push({
            title: 'إجراء فحص أو صيانة فنية',
            desc: part,
            type: 'maintenance',
          })
        } else {
          events.push({
            title: 'ملاحظة وقيد إداري',
            desc: part,
            type: 'note',
          })
        }
      }
    }

    return events
  }, [item, warehouse, currency])

  function handleSaveLog() {
    if (!newLogText.trim() && newCondition === item.condition) return

    setIsSaving(true)
    const today = getCairoDateString()
    const logEntry = newLogText.trim()
      ? `[${today}] ${newLogText.trim()}${newCondition !== item.condition ? ` (تعديل الحالة إلى: ${newCondition === 'excellent' ? 'ممتازة' : newCondition === 'good' ? 'جيدة' : newCondition === 'maintenance' ? 'صيانة' : 'كهنة'})` : ''}`
      : `[${today}] تم تغيير الحالة الفنية إلى ${newCondition === 'excellent' ? 'ممتازة' : newCondition === 'good' ? 'جيدة' : newCondition === 'maintenance' ? 'صيانة' : 'كهنة'}`

    const updatedNotes = item.notes ? `${item.notes} • ${logEntry}` : logEntry

    const updated: CustodyItem = {
      ...item,
      condition: newCondition,
      notes: updatedNotes,
    }

    onUpdateItem(updated)
    setNewLogText('')
    setIsSaving(false)
  }

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
        className="modal-dialog modal-dialog-lg max-h-90vh"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon modal-icon-accent">
              <History size={20} />
            </div>
            <div>
              <h3 className="m-0 text-md text-ink font-bold">سجل تاريخ وحركة الأصل</h3>
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
        <div className="modal-body-scroll p-5 flex flex-col gap-4">
          {/* Asset Summary Card */}
          <div className="card-surface p-4 flex flex-col gap-2">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <span className="font-xs text-muted">كود العهدة: <code>{item.code}</code></span>
                <h4 className="mt-1 m-0 text-md font-bold text-ink">{item.name}</h4>
              </div>
              <span className={`status-pill ${item.condition === 'excellent' || item.condition === 'good' ? 'status-pill-ok' : 'status-pill-warn'}`}>
                {item.condition === 'excellent' ? 'ممتازة' : item.condition === 'good' ? 'جيدة' : item.condition === 'maintenance' ? 'صيانة' : 'كهنة'}
              </span>
            </div>

            <div className="grid-fit-140 font-sm">
              <div className="flex items-center gap-1 text-muted">
                <MapPin size={15} className="text-accent" />
                <span>{warehouse.name} ({item.roomLocation || '—'})</span>
              </div>
              <div className="flex items-center gap-1 text-muted">
                <User size={15} className="text-accent" />
                <span>أمين العهدة: {item.custodian || '—'}</span>
              </div>
              <div className="flex items-center gap-1 text-muted">
                <Package size={15} className="text-accent" />
                <span>الكمية: {item.quantity} {item.unit}</span>
              </div>
              <div className="flex items-center gap-1 text-muted">
                <Calendar size={15} className="text-accent" />
                <span>القيمة: {formatMoney(item.value, currency)}</span>
              </div>
            </div>

            {item.serialNumber && (
              <div className="font-xs text-muted border-top-line">
                الرقم التسلسلي (Serial Number): <strong>{item.serialNumber}</strong>
              </div>
            )}
          </div>

          {/* Timeline of events */}
          <div>
            <div className="font-sm font-bold text-ink mb-3">
              مسار الخط الزمني وسجل العمليات:
            </div>

            <div className="timeline-wrapper">
              {/* Vertical line */}
              <div className="timeline-line" />

              {historicalEvents.map((evt, idx) => {
                const isCreation = evt.type === 'creation'
                const isTransfer = evt.type === 'transfer'
                const isMaintenance = evt.type === 'maintenance'

                const dotColor = isCreation ? 'var(--chart-3)' : isTransfer ? 'var(--chart-2)' : isMaintenance ? 'var(--chart-4)' : 'var(--accent)'
                const Icon = isCreation ? CheckCircle2 : isTransfer ? Package : isMaintenance ? Wrench : FileText

                return (
                  <div key={idx} className="relative">
                    {/* Dot */}
                    <div
                      className="timeline-dot"
                      style={{ borderColor: dotColor, color: dotColor }}
                    >
                      <Icon size={11} />
                    </div>

                    <div className="card-surface p-3">
                      <div className="flex justify-between items-center mb-1">
                        <strong className="font-sm text-ink">{evt.title}</strong>
                        {evt.date && (
                          <span className="code-pill text-muted font-xs">
                            {evt.date}
                          </span>
                        )}
                      </div>
                      <p className="m-0 font-xs text-muted leading-normal">
                        {evt.desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Add Log / Maintenance Note */}
          <div className="note-card-accent p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-sm font-semibold text-accent">
              <PlusCircle size={16} />
              <span>إضافة إجراء فحص أو ملاحظة صيانة جديدة:</span>
            </div>

            <div className="grid-2col-fit">
              <input
                type="text"
                placeholder="اكتب الإجراء (مثلاً: تم الفحص الفني الدوري ويعمل بكفاءة)"
                value={newLogText}
                onChange={(e) => setNewLogText(e.target.value)}
                className="input-field"
              />

              <select
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value as CustodyItem['condition'])}
                className="select-field"
                aria-label="تحديث الحالة الفنية"
              >
                <option value="excellent">ممتازة (جاهزة للعمل)</option>
                <option value="good">جيدة (تعمل بكفاءة)</option>
                <option value="maintenance">تحتاج صيانة / فحص</option>
                <option value="damaged">تالفة / كهنة</option>
              </select>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="primary-btn btn-sm inline-flex items-center gap-1"
                onClick={handleSaveLog}
                disabled={isSaving || (!newLogText.trim() && newCondition === item.condition)}
              >
                <Save size={15} />
                <span>حفظ في سجل الأصل</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button type="button" className="secondary-btn" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
