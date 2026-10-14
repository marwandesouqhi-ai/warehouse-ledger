import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  PackagePlus,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import {
  createPurchaseRequest,
  suggestLastPurchasePrice,
  type PurchasePriority,
  type PurchaseType,
} from '../../lib/procurementRepository'
import { DEFAULT_APPROVAL_PATH } from '../../lib/approvalPaths'
import { WAREHOUSES, type CustodyItem } from '../../lib/custody'
import type { FixtureMovement } from '../../lib/fixture'
import type { AppSettings } from '../../lib/settings'
import { logAuditEvent } from '../../lib/auditLogger'

interface NewPurchaseRequestPageProps {
  session?: Session | null
  custodyItems: CustodyItem[]
  movements: FixtureMovement[]
  currency: AppSettings['currency']
}

interface ItemRow {
  id: string
  item_name: string
  quantity: string
  unit: string
  estimated_price: string
  custody_item_ref?: string
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export default function NewPurchaseRequestPage({
  session,
  custodyItems,
  movements,
  currency,
}: NewPurchaseRequestPageProps) {
  const navigate = useNavigate()

  // Form State
  const [department, setDepartment] = useState(WAREHOUSES[0]?.name || 'المخزن الرئيسي')
  const [customDepartment, setCustomDepartment] = useState('')
  const [purchaseType, setPurchaseType] = useState<PurchaseType>('direct')
  const [budgetLine, setBudgetLine] = useState('')
  const [priority, setPriority] = useState<PurchasePriority>('normal')
  const [neededBy, setNeededBy] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d.toISOString().slice(0, 10)
  })
  const [justification, setJustification] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Items State
  const [items, setItems] = useState<ItemRow[]>([
    {
      id: `item-${Date.now()}-1`,
      item_name: '',
      quantity: '1',
      unit: 'قطعة',
      estimated_price: '0',
    },
  ])

  const activeUserName = session?.user?.user_metadata?.displayName || session?.user?.email || 'موظف مختص'

  // Unique item names from custody for autocomplete
  const custodyAutocomplete = useMemo(() => {
    const map = new Map<string, { unit: string; id: string }>()
    for (const c of custodyItems) {
      if (c.name && c.name.trim() && !map.has(c.name.trim())) {
        map.set(c.name.trim(), { unit: c.unit || 'قطعة', id: c.id })
      }
    }
    return Array.from(map.entries()).map(([name, meta]) => ({ name, unit: meta.unit, id: meta.id }))
  }, [custodyItems])

  // Total Estimated Price
  const totalEstimated = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = Number(item.quantity) || 0
      const p = Number(item.estimated_price) || 0
      return sum + (q * p)
    }, 0)
  }, [items])

  function handleItemNameChange(index: number, val: string) {
    const next = [...items]
    next[index].item_name = val

    // Match with custody
    const match = custodyAutocomplete.find((c) => c.name.toLowerCase() === val.trim().toLowerCase())
    if (match) {
      next[index].unit = match.unit
      next[index].custody_item_ref = match.id
    }

    // Match with last purchase price
    const suggestedPrice = suggestLastPurchasePrice(val, movements)
    if (suggestedPrice != null && (!next[index].estimated_price || next[index].estimated_price === '0')) {
      next[index].estimated_price = String(suggestedPrice)
    }

    setItems(next)
  }

  function handleAddItem() {
    setItems((curr) => [
      ...curr,
      {
        id: `item-${Date.now()}-${curr.length + 1}`,
        item_name: '',
        quantity: '1',
        unit: 'قطعة',
        estimated_price: '0',
      },
    ])
  }

  function handleRemoveItem(index: number) {
    if (items.length <= 1) return
    setItems((curr) => curr.filter((_, i) => i !== index))
  }

  async function handleSubmit(submitImmediately: boolean) {
    setError('')
    const effectiveDept = department === 'custom' ? customDepartment.trim() : department.trim()
    if (!effectiveDept) {
      setError('يرجى تحديد أو كتابة اسم القسم الطالب.')
      return
    }

    if (items.length === 0) {
      setError('يرجى إضافة بند واحد على الأقل.')
      return
    }

    for (let i = 0; i < items.length; i++) {
      const itm = items[i]
      if (!itm.item_name.trim()) {
        setError(`يرجى كتابة اسم الصنف للبند رقم ${i + 1}.`)
        return
      }
      const q = Number(itm.quantity)
      if (isNaN(q) || q <= 0) {
        setError(`يرجى تحديد كمية صحيحة أكبر من صفر للبند «${itm.item_name}».`)
        return
      }
    }

    if (submitImmediately && !justification.trim()) {
      setError('مبررات وأسباب طلب الشراء مطلوبة قبل الإرسال للاعتماد.')
      return
    }

    setIsSubmitting(true)
    try {
      const created = await createPurchaseRequest(
        {
          department: effectiveDept,
          purchase_type: purchaseType,
          budget_line: budgetLine.trim(),
          priority,
          needed_by: neededBy || null,
          requested_by: activeUserName,
          justification: justification.trim(),
          created_by: activeUserName,
          created_by_id: session?.user?.id || null,
        },
        items.map((i) => ({
          item_name: i.item_name.trim(),
          quantity: Number(i.quantity),
          unit: i.unit.trim() || 'قطعة',
          estimated_price: Number(i.estimated_price) || 0,
          custody_item_ref: i.custody_item_ref || null,
        })),
        submitImmediately
      )

      await logAuditEvent({
        action: submitImmediately ? 'SUBMIT_PURCHASE_REQUEST' : 'CREATE_PURCHASE_REQUEST_DRAFT',
        entity_type: 'purchase_request',
        entity_id: created.id,
        details: {
          request_no: created.request_no,
          department: effectiveDept,
          items_count: items.length,
          total_estimated: totalEstimated,
        },
      })

      navigate('/purchases/requests')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ طلب الشراء.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="movement-page card-surface purchases-page new-purchase-request-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="requests" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '16px' }}>
        <div>
          <h2>
            <PackagePlus size={20} />
            {' '}
            إنشاء طلب شراء وتوريد جديد
          </h2>
          <span>تسجيل بيان الاحتياجات، تحديد الأسعار التقديرية، والبدء في دورة الموافقات الرسمية</span>
        </div>
        <div className="headline-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => navigate('/purchases/requests')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <ArrowRight size={16} /> العودة لقائمة الطلبات
          </button>
        </div>
      </div>

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

      {/* Main Form Layout (2 Columns: Form + Approval Path Side Panel) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', alignItems: 'start' }}>
        {/* Left Side: Form Details & Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Section 1: Request Basic Meta */}
          <div className="card-surface" style={{ padding: '18px', borderRadius: '10px', border: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '14px', color: 'var(--ink)' }}>بيانات الطلب والجهة الطالبة</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label>
                القسم / المخزن الطالب *
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                >
                  {WAREHOUSES.map((w) => (
                    <option key={w.id} value={w.name}>{w.name}</option>
                  ))}
                  <option value="custom">قسم آخر / كتابة يدوية...</option>
                </select>
              </label>

              {department === 'custom' && (
                <label>
                  اسم القسم أو الكلية
                  <input
                    type="text"
                    value={customDepartment}
                    onChange={(e) => setCustomDepartment(e.target.value)}
                    placeholder="مثال: كلية الهندسة، الإدارة الهندسية"
                    required
                  />
                </label>
              )}

              <label>
                نوع الشراء الموصى به
                <select
                  value={purchaseType}
                  onChange={(e) => setPurchaseType(e.target.value as PurchaseType)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                >
                  <option value="direct">أمر مباشر (احتياجات فورية ومحدودة)</option>
                  <option value="practice">ممارسة محدودة (مفاضلة عروض)</option>
                  <option value="tender">مناقصة عامة (توريدات كبرى)</option>
                </select>
              </label>

              <label>
                الأولوية
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PurchasePriority)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
                >
                  <option value="normal">عادية (ضمن خطة التوريد المعتادة)</option>
                  <option value="urgent">⚠️ عاجلة (احتياج طارئ وسريع)</option>
                </select>
              </label>

              <label>
                تاريخ الاحتياج المطلوب
                <input
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </label>

              <label>
                بند الميزانية المقترح
                <input
                  type="text"
                  value={budgetLine}
                  onChange={(e) => setBudgetLine(e.target.value)}
                  placeholder="مثال: الباب الثاني - نفقات تشغيلية"
                />
              </label>

              <label>
                مقدم الطلب (القائم بالتسجيل)
                <input
                  type="text"
                  value={activeUserName}
                  disabled
                  style={{ background: 'var(--surface)', opacity: 0.8 }}
                />
              </label>
            </div>
          </div>

          {/* Section 2: Items Dynamic Table */}
          <div className="card-surface" style={{ padding: '18px', borderRadius: '10px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '1rem', margin: 0, color: 'var(--ink)' }}>بنود وأصناف الطلب</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  يكمل النظام اسم الصنف والوحدة تلقائياً من العهدة ويقترح آخر سعر شراء تاريخي
                </span>
              </div>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleAddItem}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
              >
                <Plus size={15} /> إضافة بند آخر
              </button>
            </div>

            <datalist id="custody-items-autocomplete">
              {custodyAutocomplete.map((c) => (
                <option key={c.id} value={c.name}>{`الوحدة: ${c.unit}`}</option>
              ))}
            </datalist>

            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="movements-table" style={{ fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>اسم الصنف والمواصفات *</th>
                    <th style={{ width: '15%', textAlign: 'center' }}>الكمية *</th>
                    <th style={{ width: '15%', textAlign: 'center' }}>الوحدة</th>
                    <th style={{ width: '18%', textAlign: 'center' }}>السعر التقديري</th>
                    <th style={{ width: '12%', textAlign: 'center' }}>حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, index) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="text"
                          list="custody-items-autocomplete"
                          value={row.item_name}
                          onChange={(e) => handleItemNameChange(index, e.target.value)}
                          placeholder="اختر صنفاً أو اكتب اسماً جديداً..."
                          required
                          style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={row.quantity}
                          onChange={(e) => {
                            const next = [...items]
                            next[index].quantity = e.target.value
                            setItems(next)
                          }}
                          required
                          style={{ width: '80px', padding: '7px 8px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--line)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="text"
                          value={row.unit}
                          onChange={(e) => {
                            const next = [...items]
                            next[index].unit = e.target.value
                            setItems(next)
                          }}
                          style={{ width: '70px', padding: '7px 8px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--line)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.estimated_price}
                          onChange={(e) => {
                            const next = [...items]
                            next[index].estimated_price = e.target.value
                            setItems(next)
                          }}
                          style={{ width: '100px', padding: '7px 8px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--line)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {items.length > 1 && (
                          <button
                            type="button"
                            className="icon-action-btn danger"
                            onClick={() => handleRemoveItem(index)}
                            title="حذف هذا البند"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total summary */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px', padding: '10px 14px', background: 'rgba(14, 124, 134, 0.05)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>إجمالي القيمة التقديرية للطلب:</span>
                <strong style={{ fontSize: '1.25rem', color: 'var(--accent)' }}>
                  {formatCurrency(totalEstimated, currency)}
                </strong>
              </div>
            </div>
          </div>

          {/* Section 3: Justification */}
          <div className="card-surface" style={{ padding: '18px', borderRadius: '10px', border: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: 'var(--ink)' }}>مبررات وأسباب الاحتياج</h3>
            <textarea
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="اكتب أسباب طلب الشراء ومبررات الصرف، واحتياجات القسم أو الكلية..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}
            />
          </div>

          {/* Actions Bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <button
              type="button"
              className="secondary-btn"
              disabled={isSubmitting}
              onClick={() => navigate('/purchases/requests')}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={isSubmitting}
              onClick={() => handleSubmit(false)}
            >
              {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ كمسودة'}
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={isSubmitting}
              onClick={() => handleSubmit(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Send size={16} />
              {isSubmitting ? 'جارٍ الإرسال...' : 'إرسال للموافقة'}
            </button>
          </div>
        </div>

        {/* Right Side: Approval Path Side Panel */}
        <div className="card-surface" style={{ padding: '18px', borderRadius: '10px', border: '1px solid var(--line)', position: 'sticky', top: '20px' }}>
          <h4 style={{ fontSize: '0.95rem', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ClipboardList size={18} color="var(--accent)" />
            مسار الموافقات المعتمد
          </h4>
          <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
            وفقاً لـ approvalPaths.ts، يمر الطلب تلقائياً بالمراحل الأربع التالية بمجرد إرساله:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {DEFAULT_APPROVAL_PATH.map((step) => (
              <div
                key={step.stepNo}
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'rgba(14, 124, 134, 0.1)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}
                >
                  {step.stepNo}
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' }}>
                    {step.stepName}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px' }}>
                    {step.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
