import { useState, useEffect, useMemo, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  History,
  Search,
  ArrowRightLeft,
  PackagePlus,
  ArrowUpRight,
  Wrench,
  AlertTriangle,
  X,
  Filter,
  Plus,
  RotateCw,
  CheckCircle2,
  FileCheck,
  Trash2,
} from 'lucide-react'
import {
  fetchAssetMovements,
  createAssetMovement,
  deleteAssetMovement,
  type AssetMovement,
} from '../lib/assetMovementRepository'
import { purgeDatabaseDemoData } from '../lib/purgeDemoData'
import { logAuditEvent } from '../lib/auditLogger'

type AssetHistoryPageProps = {
  session?: Session | null
}

const MOVEMENT_TYPES = {
  inward: { label: 'استلام وتوريد للمخزن', icon: PackagePlus, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  transfer: { label: 'نقل وتحويل بين مخازن وكليات', icon: ArrowRightLeft, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  outward: { label: 'صرف وتسليم نهائي', icon: ArrowUpRight, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/40' },
  inspection: { label: 'فحص وتدقيق جردي', icon: FileCheck, color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/40' },
  maintenance: { label: 'إرسال للصيانة والإصلاح', icon: Wrench, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  writeoff: { label: 'كهنة أو إعدام وشطب', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/40' },
}

export default function AssetHistoryPage({ session }: AssetHistoryPageProps) {
  const [movements, setMovements] = useState<AssetMovement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Form
  const [assetCode, setAssetCode] = useState('')
  const [assetName, setAssetName] = useState('')
  const [fromLocation, setFromLocation] = useState('المخزن الرئيسي')
  const [toLocation, setToLocation] = useState('كلية الحاسبات والمعلومات')
  const [movementType, setMovementType] = useState<AssetMovement['movement_type']>('transfer')
  const [quantity, setQuantity] = useState<number | ''>(1)
  const [conditionBefore, setConditionBefore] = useState('')
  const [conditionAfter, setConditionAfter] = useState('')
  const [performedBy, setPerformedBy] = useState(
    session?.user?.user_metadata?.displayName || session?.user?.user_metadata?.name || ''
  )
  const [notes, setNotes] = useState('')

  const loadData = async () => {
    setIsLoading(true)
    try {
      const data = await fetchAssetMovements()
      setMovements(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (typeFilter !== 'all' && m.movement_type !== typeFilter) return false
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (
        m.asset_code.toLowerCase().includes(term) ||
        m.asset_name.toLowerCase().includes(term) ||
        (m.from_location && m.from_location.toLowerCase().includes(term)) ||
        m.to_location.toLowerCase().includes(term) ||
        (m.notes && m.notes.toLowerCase().includes(term))
      )
    })
  }, [movements, typeFilter, searchTerm])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!assetCode.trim() || !assetName.trim() || !toLocation.trim()) {
      alert('يرجى تعبئة كود الأصل واسمه والموقع المستلم.')
      return
    }

    setIsSubmitting(true)
    try {
      const newMove = await createAssetMovement({
        asset_code: assetCode.trim().toUpperCase(),
        asset_name: assetName.trim(),
        from_location: fromLocation.trim(),
        to_location: toLocation.trim(),
        movement_type: movementType,
        quantity: Number(quantity) || 1,
        condition_before: conditionBefore.trim(),
        condition_after: conditionAfter.trim(),
        notes: notes.trim(),
        performed_by: performedBy.trim() || 'أمين المستودع',
        performed_by_email: session?.user?.email,
        performed_at: new Date().toISOString(),
        created_by: session?.user?.id,
      })

      setMovements((prev) => [newMove, ...prev])
      setIsAddModalOpen(false)
      setAssetCode('')
      setAssetName('')
      setNotes('')
      setSuccessMessage(`تم تسجيل حركة الأصل ${assetCode} بنجاح.`)

      void logAuditEvent({
        action: `تسجيل حركة أصل: ${assetCode} - ${assetName}`,
        entity_type: 'asset_history',
        details: { asset_code: assetCode, from: fromLocation, to: toLocation, type: movementType },
        user: session?.user,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteMovement = async (id: string, code: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف حركة الأصل (${code})؟`)) {
      return
    }
    await deleteAssetMovement(id)
    setMovements((prev) => prev.filter((m) => m.id !== id))
    setSuccessMessage(`تم حذف حركة الأصل (${code}) بنجاح.`)
    void logAuditEvent({
      action: `حذف حركة الأصل: ${code}`,
      entity_type: 'asset_history',
      user: session?.user,
    })
  }

  const handlePurgeDemo = async () => {
    if (!window.confirm('هل أنت متأكد من مسح جميع البيانات التجريبية والمحاكاة من النظام وقاعدة البيانات؟')) {
      return
    }
    setIsLoading(true)
    try {
      const res = await purgeDatabaseDemoData()
      await loadData()
      setSuccessMessage(res.message || 'تم تنظيف ومسح البيانات التجريبية بنجاح.')
      void logAuditEvent({
        action: 'مسح وتنظيف البيانات التجريبية من النظام',
        entity_type: 'asset_history',
        user: session?.user,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <History size={24} />
        </div>
        <div>
          <p className="eyebrow">تتبع الأصول والعهد • جامعة الزقازيق الأهلية</p>
          <h2>سجل تتبع ودورة حياة الأصول</h2>
          <p>متابعة حركة كل أصل ومعدة: من استلام التوريد، تسليم الكليات، الصيانة، وحتى الإعدام الجردي</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button
            type="button"
            className="secondary-btn text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            onClick={handlePurgeDemo}
            disabled={isLoading}
            title="مسح أي بيانات تجريبية سابقة من قاعدة البيانات والكاش"
          >
            <Trash2 size={16} /> مسح البيانات التجريبية
          </button>
          <button type="button" className="secondary-btn" onClick={loadData} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button type="button" className="primary-btn" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={18} /> تسجيل حركة أصل جديدة
          </button>
        </div>
      </header>

      {successMessage && (
        <div className="inline-message success flex items-center justify-between">
          <span>{successMessage}</span>
          <button type="button" className="input-action-btn" onClick={() => setSuccessMessage('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="card-surface p-4">
        <div className="movements-filter-toolbar">
          <div className="input-search-wrap">
            <Search size={16} className="input-search-icon" />
            <input
              type="search"
              placeholder="ابحث بكود الأصل (مثال: ZNU-IT-001)، اسم الجهاز، أو الكلية..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-field w-full"
            />
          </div>

          <div className="filter-group">
            <Filter size={15} className="opacity-60" />
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              الكل ({movements.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'transfer' ? 'active' : ''}`}
              onClick={() => setTypeFilter('transfer')}
            >
              نقل وتحويل
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'maintenance' ? 'active' : ''}`}
              onClick={() => setTypeFilter('maintenance')}
            >
              صيانة
            </button>
            <button
              type="button"
              className={`filter-tab ${typeFilter === 'inward' ? 'active' : ''}`}
              onClick={() => setTypeFilter('inward')}
            >
              توريد جديد
            </button>
          </div>
        </div>

        {/* Timeline Table */}
        <div className="movement-table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>كود الأصل</th>
                <th>اسم الأصل / المعدة</th>
                <th>نوع الحركة</th>
                <th>من</th>
                <th>إلى</th>
                <th>الكمية</th>
                <th>الحالة والملاحظات</th>
                <th>المسؤول / التاريخ</th>
                <th className="w-16 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table-empty text-center py-12">
                    <History size={40} className="mx-auto mb-3 opacity-30 text-teal-600" />
                    <p className="text-base font-semibold text-foreground">لا توجد حركات أصول مسجلة حالياً</p>
                    <p className="text-sm text-muted mt-1 max-w-md mx-auto">
                      {searchTerm || typeFilter !== 'all'
                        ? 'لا توجد نتائج تطابق معايير البحث والتصفية المحددة.'
                        : 'تم تنظيف النظام بالكامل. يمكنك توثيق حركة جديدة للأجهزة والمعدات بالنقر على زر «تسجيل حركة أصل جديدة» أعلاه.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const typeCfg = MOVEMENT_TYPES[m.movement_type] || MOVEMENT_TYPES.transfer
                  const Icon = typeCfg.icon

                  return (
                    <tr key={m.id}>
                      <td className="font-mono font-bold text-primary">{m.asset_code}</td>
                      <td>
                        <strong>{m.asset_name}</strong>
                      </td>
                      <td>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${typeCfg.bg} ${typeCfg.color}`}>
                          <Icon size={14} />
                          {typeCfg.label}
                        </span>
                      </td>
                      <td className="text-muted">{m.from_location || '—'}</td>
                      <td className="font-medium text-foreground">{m.to_location}</td>
                      <td>
                        <span className="font-bold">{m.quantity}</span>
                      </td>
                      <td>
                        {m.condition_before && (
                          <div className="text-xs text-muted">قبل: {m.condition_before}</div>
                        )}
                        {m.condition_after && (
                          <div className="text-xs font-medium text-emerald-600">بعد: {m.condition_after}</div>
                        )}
                        {m.notes && <div className="text-xs text-muted truncate max-w-xs">{m.notes}</div>}
                      </td>
                      <td>
                        <div className="text-xs font-medium">{m.performed_by || 'أمين المستودع'}</div>
                        <time className="text-xs text-muted block">
                          {new Date(m.performed_at).toLocaleDateString('ar-EG')}
                        </time>
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          className="icon-action-btn hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded transition-colors"
                          onClick={() => handleDeleteMovement(m.id, m.asset_code)}
                          title="حذف حركة الأصل"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Movement */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon">
                  <Plus size={18} />
                </div>
                <div>
                  <h3>تسجيل حركة أصل أو معدة</h3>
                  <span className="modal-subtitle">توثيق نقل العهدة أو إرسال للصيانة أو تغيير الحالة</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsAddModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  كود الأصل / الباركود *
                  <input
                    type="text"
                    required
                    value={assetCode}
                    onChange={(e) => setAssetCode(e.target.value)}
                    placeholder="مثال: ZNU-ENG-089"
                    className="p-2 border rounded font-mono"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  اسم الأصل / الجهاز *
                  <input
                    type="text"
                    required
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="مثال: جهاز رنين مغناطيسي تعليمي"
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  نوع الحركة *
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as AssetMovement['movement_type'])}
                    className="p-2 border rounded"
                  >
                    <option value="transfer">نقل وتحويل بين مخازن</option>
                    <option value="inward">توريد واستلام جديد</option>
                    <option value="outward">صرف وتسليم نهائي</option>
                    <option value="maintenance">إرسال للصيانة والإصلاح</option>
                    <option value="inspection">فحص وتدقيق جردي</option>
                    <option value="writeoff">كهنة وشطب</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الموقع السابق (من)
                  <input
                    type="text"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    placeholder="مثال: المخزن الرئيسي"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الموقع الجديد (إلى) *
                  <input
                    type="text"
                    required
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    placeholder="مثال: كلية الهندسة - معمل القوى"
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  الكمية
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  حالة الأصل قبل الحركة
                  <input
                    type="text"
                    value={conditionBefore}
                    onChange={(e) => setConditionBefore(e.target.value)}
                    placeholder="مثال: سليم / يحتاج صيانة"
                    className="p-2 border rounded"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-semibold">
                  حالة الأصل بعد الحركة
                  <input
                    type="text"
                    value={conditionAfter}
                    onChange={(e) => setConditionAfter(e.target.value)}
                    placeholder="مثال: تم التثبيت والتشغيل"
                    className="p-2 border rounded"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                المسؤول عن الحركة / القائم بالتسليم
                <input
                  type="text"
                  value={performedBy}
                  onChange={(e) => setPerformedBy(e.target.value)}
                  placeholder="اسم الموظف أو الفني المسؤول"
                  className="p-2 border rounded"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold">
                ملاحظات ومحضر الحركة
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="رقم المحضر، سبب النقل، المستلم بالتفصيل..."
                  className="p-2 border rounded"
                />
              </label>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  إلغاء
                </button>
                <button type="submit" className="primary-btn" disabled={isSubmitting}>
                  <CheckCircle2 size={16} /> {isSubmitting ? 'جارٍ الحفظ...' : 'تسجيل حركة الأصل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
