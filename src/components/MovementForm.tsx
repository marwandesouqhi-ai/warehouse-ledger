import { getAccessSession } from '../lib/accessContext'
import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import type {} from '@supabase/supabase-js'
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Package,
  PackagePlus,
  Pencil,
  Send,
} from 'lucide-react'


import { type FixtureMovement } from '../lib/fixture'
import {
  canCreatePurchase,
  canCreateDisbursement,
} from '../lib/permissions'
import {
  loadCustodyItems,
  WAREHOUSES,
} from '../lib/custody'
import { getCairoDateString } from '../lib/dateUtils'

// Requirement #10: Lazy-load route pages with loading and error boundaries

export function MovementEditPage({
  movements,
  onSave,
  onCancel,
}: {
  movements: FixtureMovement[]
  onSave: (movement: FixtureMovement) => Promise<void>
  onCancel: () => void
}) {
  const { id } = useParams<{ id: string }>()
  const movement = movements.find((m) => String(m.id) === String(id))

  if (!movement) {
    return (
      <section className="card-surface movement-form-page">
        <div className="section-head">
          <div>
            <h2>لم يتم العثور على الحركة</h2>
            <span>الحركة المطلوبة غير موجودة في السجل أو قد تكون حُذفت.</span>
          </div>
        </div>
        <div className="form-actions mt-4">
          <button type="button" className="primary-btn" onClick={onCancel}>العودة إلى سجل الحركات</button>
        </div>
      </section>
    )
  }

  return <MovementForm initialMovement={movement} onSave={onSave} onCancel={onCancel} />
}

export default function MovementForm({
  initialMovement,
  isModal = false,
  onSave,
  onCancel,
}: {
  initialMovement?: FixtureMovement | null
  isModal?: boolean
  onSave: (movement: FixtureMovement) => Promise<void>
  onCancel: () => void
}) {
  const [today] = useState(() => getCairoDateString())
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // التبويب الافتراضي: إذا كانت حركة صرف سابقة اجعلها صرف، وإلا وارد
  const [movementType, setMovementType] = useState<'inward' | 'outward'>(() => {
    if (initialMovement) {
      if ((Number(initialMovement.qout) || 0) > 0 && (!initialMovement.qin || Number(initialMovement.qin) === 0)) {
        return 'outward'
      }
    }
    return canCreatePurchase(getAccessSession()) ? 'inward' : 'outward'
  })

  // قائمة المخازن والكليات الفرعية التابعة للجامعة (ما عدا المخزن الرئيسي)
  const branchWarehouses = useMemo(() => WAREHOUSES.filter((w) => w.id !== 'main'), [])

  // عهدة المخزن الرئيسي للربط المباشر ومعرفة الرصيد المتاح
  const mainCustodyItems = useMemo(() => {
    return loadCustodyItems().filter((i) => i.warehouseId === 'main')
  }, [])

  // حقول تاب الوارد
  const [inwardItem, setInwardItem] = useState(initialMovement?.item ?? '')
  const [inwardDate, setInwardDate] = useState(initialMovement?.date || today)
  const [inwardQin, setInwardQin] = useState<string | number>(
    initialMovement?.qin ? initialMovement.qin : ''
  )
  const [inwardPrice, setInwardPrice] = useState<string | number>(
    initialMovement?.price !== undefined ? initialMovement.price : ''
  )
  const [inwardFrom, setInwardFrom] = useState(initialMovement?.from ?? '')
  const [inwardInv, setInwardInv] = useState(initialMovement?.inv ?? '')
  const [inwardNotes, setInwardNotes] = useState(initialMovement?.notes ?? '')

  // حقول تاب الصرف
  const [outwardItem, setOutwardItem] = useState(initialMovement?.item ?? '')
  const [outwardDate, setOutwardDate] = useState(
    initialMovement?.issue || initialMovement?.date || today
  )
  const [outwardQout, setOutwardQout] = useState<string | number>(
    initialMovement?.qout ? initialMovement.qout : ''
  )
  const [outwardPrice, setOutwardPrice] = useState<string | number>(
    initialMovement?.price !== undefined ? initialMovement.price : ''
  )
  const [outwardPermit, setOutwardPermit] = useState(initialMovement?.permit ?? '')
  const [outwardNotes, setOutwardNotes] = useState(initialMovement?.notes ?? '')

  // المستلم لحركة الصرف
  const [selectedRecipientOption, setSelectedRecipientOption] = useState<string>(() => {
    if (initialMovement?.to) {
      const match = branchWarehouses.find(
        (w) =>
          w.name === initialMovement.to ||
          w.shortName === initialMovement.to ||
          w.id === initialMovement.to
      )
      if (match) return match.name
      return 'custom'
    }
    return branchWarehouses[0]?.name || ''
  })
  const [customRecipient, setCustomRecipient] = useState<string>(() => {
    if (initialMovement?.to) {
      const isBranch = branchWarehouses.some(
        (w) =>
          w.name === initialMovement.to ||
          w.shortName === initialMovement.to ||
          w.id === initialMovement.to
      )
      if (!isBranch) return initialMovement.to
    }
    return ''
  })

  // التحقق من وجود الصنف ورصيده بالمخزن الرئيسي
  const selectedMainItem = useMemo(() => {
    if (!outwardItem.trim()) return null
    return mainCustodyItems.find(
      (i) => i.name.trim().toLowerCase() === outwardItem.trim().toLowerCase()
    )
  }, [outwardItem, mainCustodyItems])

  function handleSelectMainItem(itemName: string) {
    setOutwardItem(itemName)
    const item = mainCustodyItems.find((i) => i.name === itemName)
    if (item && item.value && item.quantity > 0 && !outwardPrice) {
      setOutwardPrice(Math.round(item.value / item.quantity))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSaving(true)

    try {
      if (movementType === 'inward') {
        const cleanItem = inwardItem.trim()
        if (!cleanItem) throw new Error('اسم الصنف مطلوب لحركة الوارد.')
        const qinNum = Number(inwardQin)
        if (isNaN(qinNum) || qinNum <= 0) throw new Error('كمية الوارد يجب أن تكون أكبر من صفر.')
        const priceNum = Number(inwardPrice)
        if (isNaN(priceNum) || priceNum < 0) {
          throw new Error('سعر الوحدة يجب أن يكون رقماً صحيحاً أو عشرياً (0 أو أكثر).')
        }

        const movement: FixtureMovement = {
          id: initialMovement ? initialMovement.id : Date.now(),
          date: String(inwardDate || today),
          inv: String(inwardInv).trim(),
          from: String(inwardFrom).trim(),
          to: 'المخزن الرئيسي',
          permit: '',
          issue: '',
          item: cleanItem,
          price: priceNum,
          qin: qinNum,
          qout: 0,
          notes: String(inwardNotes).trim(),
        }

        await onSave(movement)
      } else {
        const cleanItem = outwardItem.trim()
        if (!cleanItem) throw new Error('اسم الصنف مطلوب لحركة الصرف.')
        const qoutNum = Number(outwardQout)
        if (isNaN(qoutNum) || qoutNum <= 0) throw new Error('كمية المنصرف يجب أن تكون أكبر من صفر.')

        const finalRecipient =
          selectedRecipientOption === 'custom'
            ? customRecipient.trim()
            : selectedRecipientOption.trim()

        if (!finalRecipient) throw new Error('يرجى تحديد المخزن أو الكلية المستلمة للصرف.')

        const priceNum = Number(outwardPrice) || 0

        const movement: FixtureMovement = {
          id: initialMovement ? initialMovement.id : Date.now(),
          date: String(outwardDate || today),
          inv: '',
          from: 'المخزن الرئيسي',
          to: finalRecipient,
          permit: String(outwardPermit).trim(),
          issue: String(outwardDate || today),
          item: cleanItem,
          price: priceNum,
          qin: 0,
          qout: qoutNum,
          notes: String(outwardNotes).trim(),
        }

        await onSave(movement)
        if (!initialMovement) {
          setInwardItem('')
          setInwardQin('')
          setInwardPrice('')
          setInwardFrom('')
          setInwardInv('')
          setInwardNotes('')
          setOutwardItem('')
          setOutwardQout('')
          setOutwardPrice('')
          setOutwardPermit('')
          setOutwardNotes('')
        }
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر حفظ الحركة.')
    } finally {
      setIsSaving(false)
    }
  }

  const formElement = (
    <div className="movement-form-container">
      {/* تابات التبديل بين الوارد والصرف */}
      <div className="movement-type-tabs" role="tablist" aria-label="نوع حركة المخزن">
        <button hidden={!canCreatePurchase(getAccessSession())}
          type="button"
          role="tab"
          id="tab-movement-inward"
          aria-controls="panel-movement-form"
          aria-selected={movementType === 'inward'}
          className={`movement-type-tab inward-tab ${movementType === 'inward' ? 'active' : ''}`}
          onClick={() => {
            setMovementType('inward')
            setError('')
          }}
        >
          <div className="movement-tab-icon inward">
            <ArrowDownToLine size={20} />
          </div>
          <div className="movement-tab-texts">
            <div className="movement-tab-title">حركة وارد (توريد للمخزن)</div>
            <div className="movement-tab-sub">تُضاف مباشرة لعهدة «المخزن الرئيسي»</div>
          </div>
          <span className="movement-tab-badge inward">وارد +</span>
        </button>

        <button hidden={!canCreateDisbursement(getAccessSession())}
          type="button"
          role="tab"
          id="tab-movement-outward"
          aria-controls="panel-movement-form"
          aria-selected={movementType === 'outward'}
          className={`movement-type-tab outward-tab ${movementType === 'outward' ? 'active' : ''}`}
          onClick={() => {
            setMovementType('outward')
            setError('')
          }}
        >
          <div className="movement-tab-icon outward">
            <ArrowUpRight size={20} />
          </div>
          <div className="movement-tab-texts">
            <div className="movement-tab-title">حركة صرف (للمخازن والكليات)</div>
            <div className="movement-tab-sub">تُخصم من الرئيسي وتُدرج بعهدة الكلية المستلمة</div>
          </div>
          <span className="movement-tab-badge outward">منصرف -</span>
        </button>
      </div>

      <form
        id="panel-movement-form"
        role="tabpanel"
        aria-labelledby={movementType === 'inward' ? 'tab-movement-inward' : 'tab-movement-outward'}
        className="movement-form"
        onSubmit={handleSubmit}
      >
        {/* إشعار توضيحي بحسب التاب المختار */}
        {movementType === 'inward' ? (
          <div className="movement-type-banner inward">
            <div className="banner-icon"><PackagePlus size={18} /></div>
            <div>
              <strong>توريد بضاعة إلى المخزن الرئيسي:</strong> يتم تسجيل حركة الوارد وإضافة الرصيد آلياً إلى عهدة «المخزن الرئيسي».
            </div>
          </div>
        ) : (
          <div className="movement-type-banner outward">
            <div className="banner-icon"><Send size={18} /></div>
            <div>
              <strong>صرف وتغذية للمخازن والكليات:</strong> يتم خصم الكمية المنصرفة من رصيد المخزن الرئيسي وتغذية عهدة المخزن المستلم تلقائياً.
            </div>
          </div>
        )}

        {/* ===================== حقول تاب الوارد ===================== */}
        {movementType === 'inward' && (
          <>
            <label className="span-2">
              اسم الصنف / الجهاز / الأصل
              <input
                name="item"
                value={inwardItem}
                onChange={(e) => setInwardItem(e.target.value)}
                placeholder="مثال: جهاز حاسب آلي مكتبي Core i7، شاشات عرض ذكية"
                required
                autoFocus
              />
            </label>

            <label>
              تاريخ الوارد والتسليم
              <input
                name="date"
                type="date"
                value={inwardDate}
                onChange={(e) => setInwardDate(e.target.value)}
                required
              />
            </label>

            <label>
              كمية الوارد (عدد الوحدات)
              <input
                name="qin"
                type="number"
                min="0.001"
                step="any"
                value={inwardQin}
                onChange={(e) => setInwardQin(e.target.value)}
                placeholder="مثال: 50"
                required
              />
            </label>

            <label>
              سعر الوحدة
              <input
                name="price"
                type="number"
                min="0"
                step="any"
                value={inwardPrice}
                onChange={(e) => setInwardPrice(e.target.value)}
                placeholder="سعر القطعة الواحدة"
                required
              />
            </label>

            <label>
              المورد / الشركة الموردة
              <input
                name="from"
                value={inwardFrom}
                onChange={(e) => setInwardFrom(e.target.value)}
                placeholder="اسم المورد أو الشركة الموردة للبضاعة"
              />
            </label>

            <label>
              رقم الفاتورة / أمر التوريد
              <input
                name="inv"
                value={inwardInv}
                onChange={(e) => setInwardInv(e.target.value)}
                placeholder="مثال: INV-2026/841"
              />
            </label>

            <label className="form-notes span-2">
              ملاحظات التوريد
              <textarea
                name="notes"
                rows={2}
                value={inwardNotes}
                onChange={(e) => setInwardNotes(e.target.value)}
                placeholder="ملاحظات حول حالة الاستلام، الضمان، المواصفات..."
              />
            </label>
          </>
        )}

        {/* ===================== حقول تاب الصرف ===================== */}
        {movementType === 'outward' && (
          <>
            <div className="span-2 outward-item-picker">
              <label>
                اسم الصنف المراد صرفه
                <div className="input-with-datalist">
                  <input
                    name="item"
                    list="main-warehouse-items"
                    value={outwardItem}
                    onChange={(e) => setOutwardItem(e.target.value)}
                    placeholder="اختر صنفاً من المخزن الرئيسي أو اكتب اسمه..."
                    required
                    autoFocus
                  />
                  <datalist id="main-warehouse-items">
                    {mainCustodyItems.map((item) => (
                      <option key={item.id} value={item.name}>
                        {`الرصيد: ${item.quantity} ${item.unit} • ${item.code}`}
                      </option>
                    ))}
                  </datalist>
                </div>
              </label>

              {/* شارة رصيد الصنف بالمخزن الرئيسي */}
              {selectedMainItem ? (
                <div className="stock-status-pill ok">
                  <CheckCircle2 size={15} />
                  <span>
                    متوفر في المخزن الرئيسي: <strong>{selectedMainItem.quantity} {selectedMainItem.unit}</strong>
                    {selectedMainItem.roomLocation ? ` (${selectedMainItem.roomLocation})` : ''}
                  </span>
                </div>
              ) : outwardItem.trim() ? (
                <div className="stock-status-pill info">
                  <Info size={15} />
                  <span>صنف جديد أو غير مقيد مسبقاً بالمخزن الرئيسي. سيتم تسجيل الصرف وإضافته للمخزن المستلم.</span>
                </div>
              ) : mainCustodyItems.length > 0 ? (
                <div className="quick-item-pills">
                  <span className="pills-label">أصناف سريعة بالمخزن الرئيسي:</span>
                  {mainCustodyItems.slice(0, 4).map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="quick-item-pill"
                      onClick={() => handleSelectMainItem(i.name)}
                    >
                      {i.name} ({i.quantity})
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <label>
              المخزن أو الكلية المستلمة (جهة الصرف)
              <select
                value={selectedRecipientOption}
                onChange={(e) => setSelectedRecipientOption(e.target.value)}
                required
              >
                {branchWarehouses.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name} ({w.shortName})
                  </option>
                ))}
                <option value="custom">جهة أخرى / كتابة يدوية...</option>
              </select>
            </label>

            {selectedRecipientOption === 'custom' && (
              <label>
                اسم الجهة أو المستلم
                <input
                  value={customRecipient}
                  onChange={(e) => setCustomRecipient(e.target.value)}
                  placeholder="مثال: الإدارة العامة للشؤون الهندسية، قسم الجودة"
                  required
                />
              </label>
            )}

            <label>
              تاريخ الصرف
              <input
                name="issue"
                type="date"
                value={outwardDate}
                onChange={(e) => setOutwardDate(e.target.value)}
                required
              />
            </label>

            <label>
              كمية المنصرف (عدد الوحدات)
              <input
                name="qout"
                type="number"
                min="0.001"
                step="any"
                max={selectedMainItem ? selectedMainItem.quantity : undefined}
                value={outwardQout}
                onChange={(e) => setOutwardQout(e.target.value)}
                placeholder={selectedMainItem ? `الحد الأقصى: ${selectedMainItem.quantity}` : 'مثال: 5'}
                required
              />
            </label>

            <label>
              رقم إذن الصرف
              <input
                name="permit"
                value={outwardPermit}
                onChange={(e) => setOutwardPermit(e.target.value)}
                placeholder="مثال: إذن صرف رقم 44/ص"
              />
            </label>

            <label>
              سعر الوحدة (تقديري)
              <input
                name="price"
                type="number"
                min="0"
                step="any"
                value={outwardPrice}
                onChange={(e) => setOutwardPrice(e.target.value)}
                placeholder="سعر القطعة الواحدة"
              />
            </label>

            <label className="form-notes span-2">
              ملاحظات الصرف والاعتماد
              <textarea
                name="notes"
                rows={2}
                value={outwardNotes}
                onChange={(e) => setOutwardNotes(e.target.value)}
                placeholder="اسم المستلم، الغرض من الصرف، ملاحظات فنية..."
              />
            </label>
          </>
        )}

        {error && (
          <div
            id="movement-form-error"
            className="inline-message error form-notes span-2"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <div className="form-actions span-2">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={isSaving}>إلغاء</button>
          <button
            type="submit"
            className={`primary-btn ${movementType === 'outward' ? 'outward-submit-btn' : 'inward-submit-btn'}`}
            disabled={isSaving}
          >
            {isSaving
              ? 'جارٍ الحفظ...'
              : initialMovement
                ? 'حفظ التعديلات'
                : movementType === 'inward'
                  ? 'حفظ حركة الوارد (إضافة للعهدة)'
                  : 'حفظ حركة الصرف (تغذية المخزن المستلم)'}
          </button>
        </div>
      </form>
    </div>
  )

  if (isModal) {
    return formElement
  }

  return (
    <section className="card-surface movement-form-page">
      <div className="section-head">
        <div>
          <h2>
            {initialMovement ? <Pencil size={19} /> : <Package size={19} />}
            {' '}
            {initialMovement ? 'تعديل حركة المخزن' : 'إضافة حركة جديدة'}
          </h2>
          <span>
            {initialMovement
              ? `تعديل بيانات حركة «${initialMovement.item}»`
              : 'تسجيل توريد إلى المخزن الرئيسي أو صرف للمخازن والكليات'}
          </span>
        </div>
      </div>
      {formElement}
    </section>
  )
}
