import { localDate } from '../lib/localDate'
import { useMemo, useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react'
import type { FixtureMovement } from '../lib/fixture'
import type { AppSettings } from '../lib/settings'
import { deriveMovement } from '../lib/derive'
import { can, canCreatePurchase } from '../lib/permissions'
import { matchesSearch } from '../lib/searchUtils'

type PurchasesPageProps = {
  movements: FixtureMovement[]
  currency: AppSettings['currency']
  onSaveMovement: (movement: FixtureMovement) => Promise<void>
  onEdit: (movement: FixtureMovement) => void
  onDelete: (movement: FixtureMovement) => void
  canEdit?: boolean
  isSystemAdmin?: boolean
  session?: Session | null
  globalSearchTerm?: string
  initialTab?: 'list' | 'add'
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    return `'${value}` as unknown as T
  }
  return value
}

export default function PurchasesPage({
  movements,
  currency,
  onSaveMovement,
  onEdit,
  onDelete,
  canEdit = true,
  isSystemAdmin = false,
  session,
  globalSearchTerm = '',
  initialTab = 'list',
}: PurchasesPageProps) {
  const [activeTab, setActiveTab] = useState<'list' | 'add'>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab')
      if (p === 'add') return 'add'
    }
    return initialTab
  })
  const [searchTerm, setSearchTerm] = useState(globalSearchTerm)
  const [sortOption, setSortOption] = useState<'date-desc' | 'date-asc' | 'item-asc' | 'val-desc' | 'qty-desc' | 'supplier-asc'>('date-desc')
  const [pageSize, setPageSize] = useState<number>(15)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [addSuccessMessage, setAddSuccessMessage] = useState('')

  // New Purchase Form State
  const [formItem, setFormItem] = useState('')
  const [formDate, setFormDate] = useState(() => localDate())
  const [formInv, setFormInv] = useState('')
  const [formFrom, setFormFrom] = useState('')
  const [formQin, setFormQin] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (globalSearchTerm) {
      setSearchTerm(globalSearchTerm)
    }
  }, [globalSearchTerm])

  // Filter only inward/purchases movements at display time (qty_in > 0)
  const purchases = useMemo(() => {
    return movements.filter((m) => (Number(m.qin) || 0) > 0)
  }, [movements])

  // Summary KPIs for purchases
  const summary = useMemo(() => {
    let totalQty = 0
    let totalValue = 0
    const suppliers = new Set<string>()

    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i]
      const derived = deriveMovement(p, i)
      totalQty += Number(p.qin) || 0
      totalValue += derived.total ?? ((Number(p.qin) || 0) * (Number(p.price) || 0))
      if (p.from && p.from.trim()) {
        suppliers.add(p.from.trim())
      }
    }

    return {
      count: purchases.length,
      totalQty,
      totalValue,
      supplierCount: suppliers.size,
    }
  }, [purchases])

  const userCanAdd = canCreatePurchase(session) || canEdit
  const canManageRecords = isSystemAdmin || can(session, 'manage_records')

  // Search and staff filtering
  const filteredPurchases = useMemo(() => {
    return purchases.filter((m) => {
      // Search term
      if (searchTerm.trim()) {
        const match = matchesSearch(
          [
            m.item,
            m.from || '',
            String(m.inv || ''),
            m.date || '',
            m.notes || '',
          ],
          searchTerm
        )
        if (!match) return false
      }

      // Staff attribution filter
      if (staffFilter !== 'all' && (m.createdBy || '').trim() !== staffFilter) {
        return false
      }

      return true
    })
  }, [purchases, searchTerm, staffFilter])

  // Unique staff members for attribution filter
  const uniqueStaffMembers = useMemo(() => {
    const set = new Set<string>()
    for (const p of purchases) {
      if (p.createdBy && p.createdBy.trim()) {
        set.add(p.createdBy.trim())
      }
    }
    return Array.from(set).sort()
  }, [purchases])

  // Sorting
  const sortedPurchases = useMemo(() => {
    const list = [...filteredPurchases]
    list.sort((a, b) => {
      const derA = deriveMovement(a, 0)
      const derB = deriveMovement(b, 0)
      if (sortOption === 'date-desc') {
        return (b.date || '').localeCompare(a.date || '')
      }
      if (sortOption === 'date-asc') {
        return (a.date || '').localeCompare(b.date || '')
      }
      if (sortOption === 'item-asc') {
        return (a.item || '').localeCompare(b.item || '')
      }
      if (sortOption === 'supplier-asc') {
        return (a.from || '').localeCompare(b.from || '')
      }
      if (sortOption === 'val-desc') {
        return (derB.total ?? 0) - (derA.total ?? 0)
      }
      if (sortOption === 'qty-desc') {
        return (Number(b.qin) || 0) - (Number(a.qin) || 0)
      }
      return 0
    })
    return list
  }, [filteredPurchases, sortOption])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedPurchases.length / pageSize))
  const paginatedPurchases = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedPurchases.slice(start, start + pageSize)
  }, [sortedPurchases, currentPage, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [sortOption, searchTerm, staffFilter])

  async function handleExportExcel() {
    const XLSX = await import('xlsx')
    const rows = sortedPurchases.map((m, index) => {
      const derived = deriveMovement(m, index)
      const qtyIn = Number(m.qin) || 0
      const unitPrice = Number(m.price) || 0
      const total = derived.total ?? (qtyIn * unitPrice)

      return {
        'التاريخ': sanitizeExcelCell(m.date || '—'),
        'رقم الفاتورة': sanitizeExcelCell(m.inv || '—'),
        'اسم الصنف': sanitizeExcelCell(m.item),
        'المورد / الشركة': sanitizeExcelCell(m.from || '—'),
        'الكمية الموردة': qtyIn,
        'سعر الوحدة': unitPrice,
        'إجمالي الفاتورة': total,
        'سُجِّلت بواسطة': sanitizeExcelCell(m.createdBy || '—'),
        'ملاحظات': sanitizeExcelCell(m.notes || ''),
      }
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'سجل المشتريات والتوريدات')
    XLSX.writeFile(workbook, `سجل-المشتريات-${localDate()}.xlsx`)
  }

  async function handleAddPurchaseSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    const qinNum = Number(formQin)
    const priceNum = Number(formPrice)

    if (!formItem.trim()) {
      setFormError('يرجى كتابة اسم الصنف.')
      return
    }
    if (isNaN(qinNum) || qinNum <= 0) {
      setFormError('يرجى إدخال كمية توريد صحيحة أكبر من صفر.')
      return
    }
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('يرجى إدخال سعر وحدة صحيح.')
      return
    }

    setIsSubmitting(true)
    try {
      const newMovement: FixtureMovement = {
        id: `purch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: formDate,
        inv: formInv.trim() || `INV-${Date.now().toString().slice(-5)}`,
        from: formFrom.trim() || 'مورد عام',
        to: '',
        permit: '',
        issue: '',
        item: formItem.trim(),
        price: priceNum,
        qin: qinNum,
        qout: 0,
        notes: formNotes.trim(),
        createdBy:
          (session?.user?.app_metadata as Record<string, unknown>)?.username as string ||
          session?.user?.email?.replace(/@warehouse\.local$/i, '') ||
          'مستخدم',
        custodyApplied: false,
      }

      await onSaveMovement(newMovement)

      setAddSuccessMessage(
        `تم تسجيل فاتورة الشراء وتوريد الصنف بنجاح: «${newMovement.item}» (كمية: +${newMovement.qin}) وإضافتها للمخزن الرئيسي.`
      )
      setFormItem('')
      setFormInv('')
      setFormFrom('')
      setFormQin('')
      setFormPrice('')
      setFormNotes('')
      setActiveTab('list')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ فاتورة الشراء.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="movement-page card-surface purchases-page">
      {/* KPI Cards */}
      <div className="purchases-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(14, 124, 134, 0.07)', border: '1px solid rgba(14, 124, 134, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent)' }}>
            <Receipt size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>إجمالي الفواتير</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {summary.count.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>حركة توريد مسجلة</span>
        </div>

        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.07)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#059669' }}>
            <Package size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>إجمالي الكميات الموردة</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {summary.totalQty.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>قطعة / وحدة موردة</span>
        </div>

        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.07)', border: '1px solid rgba(59, 130, 246, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#2563eb' }}>
            <CircleDollarSign size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>إجمالي قيمة المشتريات</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {formatCurrency(summary.totalValue, currency)}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>القيمة الإجمالية للتوريدات</span>
        </div>

        <div className="kpi-card" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.07)', border: '1px solid rgba(139, 92, 246, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#7c3aed' }}>
            <Building2 size={20} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>الموردون والشركات</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '8px', color: 'var(--ink)' }}>
            {summary.supplierCount.toLocaleString('ar-EG')}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>جهة توريد معتمدة</span>
        </div>
      </div>



      {activeTab === 'add' ? (
        <div className="movements-add-section" style={{ marginTop: '16px' }}>
          <div className="section-head movement-heading" style={{ marginBottom: '16px' }}>
            <div>
              <h2><PackagePlus size={19} /> تسجيل فاتورة شراء جديدة</h2>
              <span>تسجيل التوريد المباشر إلى المخزن الرئيسي وتحديث رصيد العهدة آلياً</span>
            </div>
            <div className="headline-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setActiveTab('list')}
              >
                <ShoppingCart size={17} /> عرض سجل المشتريات ({purchases.length})
              </button>
            </div>
          </div>

          <form className="movement-form card-surface" onSubmit={handleAddPurchaseSubmit} style={{ padding: '24px', borderRadius: '12px' }}>
            <div className="movement-type-banner inward" style={{ marginBottom: '18px' }}>
              <div className="banner-icon"><PackagePlus size={18} /></div>
              <div>
                <strong>توريد مشتريات إلى المخزن الرئيسي:</strong> يتم تسجيل فاتورة التوريد وإضافة الكمية فورياً إلى عهدة «المخزن الرئيسي».
              </div>
            </div>

            <div className="purchase-form-grid">
              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem', gridColumn: '1 / -1' }}>
                اسم الصنف / الجهاز / الأصل <span style={{ color: 'var(--accent)' }}>*</span>
                <input
                  type="text"
                  value={formItem}
                  onChange={(e) => setFormItem(e.target.value)}
                  placeholder="مثال: جهاز حاسب آلي مكتبي Core i7، شاشات عرض ذكية"
                  required
                  autoFocus
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem' }}>
                تاريخ التوريد <span style={{ color: 'var(--accent)' }}>*</span>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem' }}>
                رقم فاتورة الشراء / أمر التوريد
                <input
                  type="text"
                  value={formInv}
                  onChange={(e) => setFormInv(e.target.value)}
                  placeholder="مثال: INV-2026-081"
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem' }}>
                المورد / الشركة الموردة
                <input
                  type="text"
                  value={formFrom}
                  onChange={(e) => setFormFrom(e.target.value)}
                  placeholder="اسم الشركة أو المورد"
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem' }}>
                الكمية الموردة (الوحدات) <span style={{ color: 'var(--accent)' }}>*</span>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={formQin}
                  onChange={(e) => setFormQin(e.target.value)}
                  placeholder="مثال: 50"
                  required
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem' }}>
                سعر الوحدة <span style={{ color: 'var(--accent)' }}>*</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder="سعر القطعة الواحدة"
                  required
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'rgba(14, 124, 134, 0.05)', padding: '10px 14px', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>إجمالي قيمة الفاتورة المحسوب:</span>
                <strong style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>
                  {formatCurrency((Number(formQin) || 0) * (Number(formPrice) || 0), currency)}
                </strong>
              </div>

              <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem', gridColumn: '1 / -1' }}>
                ملاحظات الفاتورة أو شروط التسليم
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="أي ملاحظات أو بيانات إضافية حول التوريد أو الضمان..."
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', resize: 'vertical' }}
                />
              </label>
            </div>

            {formError && (
              <div className="inline-message error" style={{ marginTop: '16px' }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                type="submit"
                className="primary-btn"
                disabled={isSubmitting}
                style={{ padding: '10px 24px' }}
              >
                <Plus size={16} /> {isSubmitting ? 'جارٍ التسجيل والحفظ...' : 'حفظ فاتورة الشراء وتوريد الأصناف'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setActiveTab('list')}
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="section-head movement-heading" style={{ marginTop: '16px' }}>
            <div>
              <h2><ShoppingCart size={19} /> سجل المشتريات والتوريدات</h2>
              <span>
                {searchTerm
                  ? `عرض ${filteredPurchases.length.toLocaleString('ar-EG')} من إجمالي ${purchases.length.toLocaleString('ar-EG')} فاتورة مطابقة`
                  : `${purchases.length.toLocaleString('ar-EG')} فاتورة شراء مسجلة`}
              </span>
            </div>
            <div className="headline-actions">
              <button type="button" className="secondary-btn" onClick={handleExportExcel}>
                <ArrowDownToLine size={17} /> تصدير Excel
              </button>
              {userCanAdd && (
                <button type="button" className="primary-btn" onClick={() => setActiveTab('add')} id="btn-add-purchase-main">
                  <Plus size={18} /> إضافة فاتورة شراء جديدة
                </button>
              )}
            </div>
          </div>

          {addSuccessMessage && (
            <div className="inline-message success" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={18} />
                <span>{addSuccessMessage}</span>
              </div>
              {userCanAdd && (
                <button
                  type="button"
                  className="primary-btn small"
                  onClick={() => {
                    setAddSuccessMessage('')
                    setActiveTab('add')
                  }}
                  style={{ fontSize: '0.82rem', padding: '4px 12px' }}
                >
                  <Plus size={14} /> إضافة فاتورة أخرى
                </button>
              )}
            </div>
          )}

          {/* Filters Toolbar */}
          <div className="movements-filter-toolbar">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: '220px' }}>
              <Search size={15} style={{ position: 'absolute', right: '10px', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث باسم الصنف، المورد، رقم الفاتورة..."
                style={{
                  width: '100%',
                  padding: '7px 32px 7px 28px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--ink)',
                  fontSize: '0.85rem',
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="مسح البحث"
                >
                  <X size={13} />
                </button>
              )}
            </div>



            {/* Staff filter dropdown */}
            <div className="staff-filter-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UserCheck size={15} style={{ opacity: 0.6 }} />
              <select
                className="sort-select"
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                aria-label="تصفية حسب الموظف"
              >
                <option value="all">كل الموظفين ({purchases.length})</option>
                {uniqueStaffMembers.map((staff) => (
                  <option key={staff} value={staff}>{staff}</option>
                ))}
              </select>
            </div>

            <div className="sort-group">
              <ArrowUpDown size={15} style={{ opacity: 0.6 }} />
              <select
                className="sort-select"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as any)}
                aria-label="ترتيب الفواتير"
              >
                <option value="date-desc">التاريخ (الأحدث أولاً)</option>
                <option value="date-asc">التاريخ (الأقدم أولاً)</option>
                <option value="item-asc">اسم الصنف (أبجدياً)</option>
                <option value="supplier-asc">اسم المورد (أبجدياً)</option>
                <option value="val-desc">قيمة الفاتورة (الأعلى)</option>
                <option value="qty-desc">الكمية الموردة (الأعلى)</option>
              </select>

              <select
                className="page-size-select"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="عدد العناصر بالصفحة"
              >
                <option value={15}>15 بالصفحة</option>
                <option value={30}>30 بالصفحة</option>
                <option value={50}>50 بالصفحة</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="movement-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>م</th>
                  <th>التاريخ</th>
                  <th>رقم الفاتورة</th>
                  <th>اسم الصنف</th>
                  <th>المورد / جهة التوريد</th>
                  <th>الكمية الموردة</th>
                  <th>سعر الوحدة</th>
                  <th>إجمالي الفاتورة</th>
                  <th>سُجِّلت بواسطة</th>
                  <th className="actions-header">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPurchases.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={10}>
                      <div className="ledger-empty-box">
                        <div className="ledger-empty-icon">
                          <Package size={28} />
                        </div>
                        <h3>{searchTerm ? 'لا توجد فواتير مطابقة لبحثك' : 'سجل المشتريات فارغ حالياً'}</h3>
                        <p>
                          {searchTerm
                            ? 'جرّب البحث باسم مورد أو صنف آخر.'
                            : 'يمكنك البدء بتسجيل أول فاتورة توريد لحساب المخزن الرئيسي.'}
                        </p>
                        {userCanAdd && (
                          <div className="empty-quick-actions">
                            <button type="button" className="primary-btn" onClick={() => setActiveTab('add')}>
                              <Plus size={16} /> إضافة فاتورة شراء جديدة
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedPurchases.map((movement, index) => {
                    const derived = deriveMovement(movement, index)
                    const totalInvoice = derived.total ?? ((Number(movement.qin) || 0) * (Number(movement.price) || 0))
                    const serialNum = (currentPage - 1) * pageSize + index + 1

                    return (
                      <tr key={movement.id || index}>
                        <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{serialNum}</td>
                        <td>{movement.date || '—'}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink)' }}>
                            {movement.inv || '—'}
                          </span>
                        </td>
                        <td>
                          <div className="cell-item-name">{movement.item}</div>
                          {movement.notes && <small className="cell-sub">{movement.notes}</small>}
                        </td>
                        <td>
                          <strong style={{ color: 'var(--accent)' }}>{movement.from || '—'}</strong>
                        </td>
                        <td><span className="qty-in-tag">+{movement.qin}</span></td>
                        <td>{formatCurrency(derived.unit_price ?? (Number(movement.price) || 0), currency)}</td>
                        <td>
                          <strong style={{ color: 'var(--ink)' }}>{formatCurrency(totalInvoice, currency)}</strong>
                        </td>

                        <td>
                          <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                            {movement.createdBy || '—'}
                          </span>
                        </td>
                        <td className="actions-cell">
                          {canManageRecords ? (
                            <div className="action-buttons-wrap">
                              <button
                                type="button"
                                className="table-action-btn edit-action-btn"
                                onClick={() => onEdit(movement)}
                                title="تعديل الفاتورة"
                                aria-label={`تعديل حركة ${movement.item}`}
                              >
                                <Pencil size={15} />
                                <span>تعديل</span>
                              </button>
                              <button
                                type="button"
                                className="table-action-btn delete-action-btn"
                                onClick={() => onDelete(movement)}
                                title="حذف الفاتورة"
                                aria-label={`حذف حركة ${movement.item}`}
                              >
                                <Trash2 size={15} />
                                <span>حذف</span>
                              </button>
                            </div>
                          ) : (
                            <span className="read-only-badge" title="صلاحية قراءة وعرض فقط">
                              <Eye size={13} /> عرض فقط
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {sortedPurchases.length > pageSize && (
            <div className="pagination-bar">
              <div>
                عرض {((currentPage - 1) * pageSize + 1).toLocaleString('ar-EG')} - {Math.min(currentPage * pageSize, sortedPurchases.length).toLocaleString('ar-EG')} من إجمالي {sortedPurchases.length.toLocaleString('ar-EG')} فاتورة
              </div>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ArrowRight size={14} /> السابق
                </button>
                <span className="page-indicator">
                  صفحة {currentPage.toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}
                </span>
                <button
                  type="button"
                  className="pagination-btn"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  التالي <ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
