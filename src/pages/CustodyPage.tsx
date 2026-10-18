import { useEffect, useMemo, useState, useRef, type FormEvent } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  BarChart3,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileUp,
  Filter,
  FlaskConical,
  HeartPulse,
  History,
  Laptop,
  Microscope,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Sparkles,
  Stethoscope,
  Trash2,
  Upload,
  Warehouse,
  X,
} from 'lucide-react'

import {
  deleteCustodyItemFromCloud,
  exportComprehensiveCustodyWorkbook,
  exportCustodyToExcel,
  fetchCustodyItemsFromCloud,
  getWarehouseStats,
  loadCustodyItems,
  saveCustodyItems,
  syncOutwardMovementToCustody,
  fixtureCustodyItems,
  WAREHOUSES,
  type CustodyCategory,
  type CustodyCondition,
  type CustodyItem,
  type CustodyType,
  type WarehouseDefinition,
} from '../lib/custody'
import {
  downloadCustodyTemplate,
  mergeImportedCustody,
  parseRawCustodyRows,
} from '../lib/custodyImport'
import { CustodyItemHistoryModal } from '../components/CustodyItemHistoryModal'
import { OfficialDisbursementPermitModal } from '../components/OfficialDisbursementPermitModal'
import { logAuditEvent } from '../lib/auditLogger'
import { loadAppSettings, type AppSettings } from '../lib/settings'
import { matchesSearch } from '../lib/searchUtils'
import { canEditInventory, checkIsSystemAdmin } from '../lib/supabase'
import type { FixtureMovement } from '../lib/fixture'
import { getStoredMovements } from '../lib/backup'
import { canCreateDisbursement } from '../lib/permissions'

const ICONS_MAP: Record<WarehouseDefinition['iconKey'], React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Warehouse,
  Stethoscope,
  Sparkles,
  FlaskConical,
  HeartPulse,
  Microscope,
  Cpu,
  Laptop,
}

function formatCurrency(value: number, currency: AppSettings['currency']): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

type CustodyPageProps = {
  currency?: AppSettings['currency']
  settings?: AppSettings
  session?: Session | null
  globalSearchTerm?: string
  movements?: FixtureMovement[]
  onSaveMovement?: (movement: FixtureMovement, redirectPath?: string | null) => Promise<void>
}

export default function CustodyPage({
  currency: propCurrency,
  settings: propSettings,
  session,
  globalSearchTerm,
  movements: propMovements,
  onSaveMovement,
}: CustodyPageProps) {
  const canEdit = canEditInventory(session)
  const canDisburse = canCreateDisbursement(session) || canEdit
  const isSystemAdmin = checkIsSystemAdmin(session)
  const settings = propSettings || loadAppSettings()
  const currency = propCurrency || settings.currency || 'EGP'
  const [items, setItems] = useState<CustodyItem[]>(loadCustodyItems)

  const [searchParams] = useSearchParams()
  const [mainTab, setMainTab] = useState<'items' | 'disbursements'>(() => {
    return searchParams.get('tab') === 'disbursements' ? 'disbursements' : 'items'
  })

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'disbursements') {
      setMainTab('disbursements')
    } else if (tabParam === 'items') {
      setMainTab('items')
    }
  }, [searchParams])

  const storedOrPropMovements = propMovements && propMovements.length > 0 ? propMovements : getStoredMovements()
  const outwardMovements = useMemo(() => {
    return storedOrPropMovements.filter((m) => (Number(m.qout) || 0) > 0)
  }, [storedOrPropMovements])

  // Disbursement search and filters
  const [disbursementSearch, setDisbursementSearch] = useState('')
  const [disbursementSourceWh, setDisbursementSourceWh] = useState<string>('all')
  const [disbursementDestWh, setDisbursementDestWh] = useState<string>('all')
  const [isNewDisbursementOpen, setIsNewDisbursementOpen] = useState(false)

  const urlWarehouseId = searchParams.get('warehouse')
  const [activeWarehouseId, setActiveWarehouseId] = useState<string>(() => {
    if (urlWarehouseId && WAREHOUSES.some((w) => w.id === urlWarehouseId)) {
      return urlWarehouseId
    }
    return 'main'
  })

  useEffect(() => {
    if (urlWarehouseId && WAREHOUSES.some((w) => w.id === urlWarehouseId)) {
      setActiveWarehouseId(urlWarehouseId)
    }
  }, [urlWarehouseId])

  const [searchTerm, setSearchTerm] = useState(globalSearchTerm || '')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedCondition, setSelectedCondition] = useState<string>('all')
  const [selectedType, setSelectedType] = useState<string>('all')

  useEffect(() => {
    if (globalSearchTerm !== undefined) {
      setSearchTerm(globalSearchTerm)
    }
  }, [globalSearchTerm])

  useEffect(() => {
    function handleSyncUpdate() {
      setItems(loadCustodyItems())
    }
    window.addEventListener('custody-changed', handleSyncUpdate)
    window.addEventListener('storage', handleSyncUpdate)

    // Ensure main warehouse items exist locally if missing
    setItems((currentItems) => {
      const hasMain = currentItems.some((i) => i.warehouseId === 'main')
      if (!hasMain && fixtureCustodyItems.length > 0) {
        const merged = [...fixtureCustodyItems.map((i) => ({ ...i })), ...currentItems]
        saveCustodyItems(merged)
        return merged
      }
      return currentItems
    })

    // Direct cloud sync on mount to ensure complete and up-to-date records
    let isMounted = true
    void fetchCustodyItemsFromCloud().then((cloudItems) => {
      if (!isMounted) return
      if (cloudItems && cloudItems.length > 0) {
        const hasMain = cloudItems.some((i) => i.warehouseId === 'main')
        const finalItems = hasMain ? cloudItems : [...fixtureCustodyItems.map((i) => ({ ...i })), ...cloudItems]
        setItems(finalItems)
        saveCustodyItems(finalItems)
      }
    })

    return () => {
      isMounted = false
      window.removeEventListener('custody-changed', handleSyncUpdate)
      window.removeEventListener('storage', handleSyncUpdate)
    }
  }, [])

  // Modals state
  const [editingItem, setEditingItem] = useState<CustodyItem | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [transferringItem, setTransferringItem] = useState<CustodyItem | null>(null)
  const [deletingItem, setDeletingItem] = useState<CustodyItem | null>(null)
  const [isSupplyingFromMain, setIsSupplyingFromMain] = useState(false)
  const [supplyingRowItem, setSupplyingRowItem] = useState<CustodyItem | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importNotice, setImportNotice] = useState<string>('')

  const [historyItem, setHistoryItem] = useState<CustodyItem | null>(null)
  const [isPermitModalOpen, setIsPermitModalOpen] = useState(false)
  const [permitInitialItems, setPermitInitialItems] = useState<CustodyItem[]>([])
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false)

  const activeWarehouse = useMemo(() => {
    return WAREHOUSES.find((w) => w.id === activeWarehouseId) || WAREHOUSES[0]
  }, [activeWarehouseId])

  const warehouseCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const w of WAREHOUSES) {
      map[w.id] = 0
    }
    for (const item of items) {
      if (map[item.warehouseId] !== undefined) {
        map[item.warehouseId]++
      }
    }
    return map
  }, [items])

  const activeWarehouseItems = useMemo(() => {
    return items.filter((item) => item.warehouseId === activeWarehouseId)
  }, [items, activeWarehouseId])

  const mainWarehouseItems = useMemo(() => {
    return items.filter((item) => item.warehouseId === 'main')
  }, [items])

  const activeStats = useMemo(() => {
    return getWarehouseStats(activeWarehouseItems)
  }, [activeWarehouseItems])

  const filteredItems = useMemo(() => {
    return activeWarehouseItems.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false
      if (selectedCondition !== 'all' && item.condition !== selectedCondition) return false
      if (selectedType !== 'all' && item.custodyType !== selectedType) return false

      if (searchTerm.trim()) {
        const matches = matchesSearch(
          [
            item.name,
            item.code,
            item.custodian,
            item.roomLocation,
            item.category,
            item.serialNumber,
            item.notes,
          ],
          searchTerm
        )
        if (!matches) return false
      }

      return true
    })
  }, [activeWarehouseItems, selectedCategory, selectedCondition, selectedType, searchTerm])

  const filteredDisbursements = useMemo(() => {
    return outwardMovements.filter((m) => {
      if (disbursementSourceWh !== 'all') {
        const srcWh = WAREHOUSES.find((w) => w.id === disbursementSourceWh)
        const matchSourceId = m.sourceWarehouseId === disbursementSourceWh
        const matchSourceName = srcWh && m.from && (m.from.includes(srcWh.name) || m.from.includes(srcWh.shortName))
        if (!matchSourceId && !matchSourceName) return false
      }
      if (disbursementDestWh !== 'all') {
        const destWh = WAREHOUSES.find((w) => w.id === disbursementDestWh)
        const matchDestId = m.destWarehouseId === disbursementDestWh
        const matchDestName = destWh && m.to && (m.to.includes(destWh.name) || m.to.includes(destWh.shortName))
        if (!matchDestId && !matchDestName) return false
      }
      if (disbursementSearch.trim()) {
        const matches = matchesSearch(
          [
            m.item,
            m.from,
            m.to,
            m.issue,
            m.permit,
            m.notes,
            m.custodianName,
          ],
          disbursementSearch
        )
        if (!matches) return false
      }
      return true
    })
  }, [outwardMovements, disbursementSourceWh, disbursementDestWh, disbursementSearch])

  const disbursementStats = useMemo(() => {
    let totalQty = 0
    let totalVal = 0
    const itemSet = new Set<string>()
    for (const m of outwardMovements) {
      const q = Number(m.qout) || 0
      const p = Number(m.price) || 0
      totalQty += q
      totalVal += q * p
      if (m.item) itemSet.add(m.item.trim())
    }
    return {
      count: outwardMovements.length,
      totalQty,
      totalVal,
      uniqueItems: itemSet.size,
    }
  }, [outwardMovements])

  function handleSaveItem(item: CustodyItem) {
    const exists = items.some((i) => i.id === item.id)
    if (exists && !isSystemAdmin) {
      alert('تعديل الأصناف مقتصر حصرياً على مدير النظام (System Admin).')
      return
    }

    let next: CustodyItem[]
    if (exists) {
      next = items.map((i) => (i.id === item.id ? item : i))
    } else {
      next = [item, ...items]
    }
    setItems(next)
    saveCustodyItems(next)

    void logAuditEvent({
      action: exists ? `تعديل عهدة: ${item.name} (${activeWarehouse.name})` : `إضافة عهدة جديدة: ${item.name} (${activeWarehouse.name})`,
      entity_type: 'custody',
      details: {
        warehouseId: item.warehouseId,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        custodian: item.custodian,
      },
      user: session?.user,
    })

    setIsAddingNew(false)
    setEditingItem(null)
  }

  function handleDeleteItem(item: CustodyItem) {
    if (!isSystemAdmin) {
      alert('حذف الأصناف مقتصر حصرياً على مدير النظام (System Admin).')
      return
    }

    const next = items.filter((i) => i.id !== item.id)
    setItems(next)
    saveCustodyItems(next)
    void deleteCustodyItemFromCloud(item.id)

    void logAuditEvent({
      action: `حذف عهدة: ${item.name} من ${activeWarehouse.name}`,
      entity_type: 'custody',
      details: { id: item.id, code: item.code, name: item.name },
      user: session?.user,
    })

    setDeletingItem(null)
  }

  function handleTransfer(
    item: CustodyItem,
    targetWarehouseId: string,
    transferQty: number,
    newCustodian: string,
    newLocation: string,
    transferReason: string
  ) {
    const targetWarehouse = WAREHOUSES.find((w) => w.id === targetWarehouseId)
    if (!targetWarehouse) return

    let next = [...items]
    if (transferQty >= item.quantity) {
      // Transfer entire record
      next = next.map((i) => {
        if (i.id === item.id) {
          return {
            ...i,
            warehouseId: targetWarehouseId,
            custodian: newCustodian || i.custodian,
            roomLocation: newLocation || i.roomLocation,
            notes: transferReason ? `${i.notes ? `${i.notes} • ` : ''}تم النقل من ${activeWarehouse.name} (${transferReason})` : i.notes,
          }
        }
        return i
      })
    } else {
      // Split record: reduce source qty and add new item to destination
      next = next.map((i) => {
        if (i.id === item.id) {
          return { ...i, quantity: i.quantity - transferQty }
        }
        return i
      })
      const newItem: CustodyItem = {
        ...item,
        id: `c-tr-${Date.now()}`,
        warehouseId: targetWarehouseId,
        quantity: transferQty,
        custodian: newCustodian || item.custodian,
        roomLocation: newLocation || item.roomLocation,
        notes: transferReason ? `منقول من ${activeWarehouse.name}: ${transferReason}` : `منقول من ${activeWarehouse.name}`,
      }
      next.push(newItem)
    }

    setItems(next)
    saveCustodyItems(next)

    void logAuditEvent({
      action: `نقل عهدة: ${item.name} (${transferQty} ${item.unit}) من ${activeWarehouse.name} إلى ${targetWarehouse.name}`,
      entity_type: 'custody',
      details: {
        code: item.code,
        fromWarehouse: activeWarehouse.name,
        toWarehouse: targetWarehouse.name,
        quantity: transferQty,
        newCustodian,
        reason: transferReason,
      },
      user: session?.user,
    })

    setTransferringItem(null)
  }

  // Central supply disbursement handler (from main to any branch)
  function handleDisburseFromMain(
    sourceItem: CustodyItem,
    targetWarehouseId: string,
    quantity: number,
    recipientCustodian: string,
    newLocation: string,
    permitNo: string
  ) {
    const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId)
    if (!targetWh) return

    let next = [...items]
    if (quantity >= sourceItem.quantity) {
      next = next.map((i) => {
        if (i.id === sourceItem.id) {
          return {
            ...i,
            warehouseId: targetWarehouseId,
            custodian: recipientCustodian || i.custodian,
            roomLocation: newLocation || i.roomLocation,
            notes: `مصروف من المخزن الرئيسي ${permitNo ? `(إذن صرف رقم ${permitNo})` : ''}`,
          }
        }
        return i
      })
    } else {
      next = next.map((i) => {
        if (i.id === sourceItem.id) {
          return { ...i, quantity: i.quantity - quantity }
        }
        return i
      })
      const newItem: CustodyItem = {
        ...sourceItem,
        id: `c-sup-${Date.now()}`,
        warehouseId: targetWarehouseId,
        quantity,
        custodian: recipientCustodian,
        roomLocation: newLocation,
        notes: `مصروف من المخزن الرئيسي ${permitNo ? `(إذن صرف رقم ${permitNo})` : ''}`,
      }
      next.push(newItem)
    }

    setItems(next)
    saveCustodyItems(next)

    void logAuditEvent({
      action: `صرف وتغذية عهدة: ${sourceItem.name} (${quantity} ${sourceItem.unit}) من المخزن الرئيسي إلى ${targetWh.name}`,
      entity_type: 'custody',
      details: {
        item: sourceItem.name,
        from: 'مخزن رئيسي',
        to: targetWh.name,
        quantity,
        permit: permitNo,
        recipient: recipientCustodian,
      },
      user: session?.user,
    })

    setIsSupplyingFromMain(false)
    setSupplyingRowItem(null)
  }

  function handlePrint() {
    const logo = settings.logoDataUrl || settings.logoUrl
    if (logo && logo.startsWith('http')) {
      const img = new Image()
      img.onload = () => window.print()
      img.onerror = () => window.print()
      img.src = logo
    } else {
      window.print()
    }
  }

  function handleImportCustody(newItems: CustodyItem[], targetWarehouseId: string, mode: 'append' | 'replace') {
    const result = mergeImportedCustody(items, newItems, targetWarehouseId, mode)
    setItems(result.updatedItems)
    setIsImportModalOpen(false)

    const targetWh = WAREHOUSES.find((w) => w.id === targetWarehouseId) || activeWarehouse
    setActiveWarehouseId(targetWarehouseId)
    setImportNotice(
      mode === 'replace'
        ? `تم استبدال عهدة "${targetWh.name}" واستيراد ${result.added} صنف بنجاح!`
        : `تم استيراد ${result.added} صنف جديد وتحديث ${result.replaced} صنف في عهدة "${targetWh.name}" بنجاح!`
    )
    setTimeout(() => setImportNotice(''), 6000)

    void logAuditEvent({
      action: `استيراد عهدة من ملف Excel (${newItems.length} صنف) إلى ${targetWh.name}`,
      entity_type: 'custody',
      details: {
        warehouseId: targetWarehouseId,
        warehouseName: targetWh.name,
        count: newItems.length,
        mode,
        added: result.added,
        replaced: result.replaced,
      },
      user: session?.user,
    })
  }

  async function handleExportDisbursements() {
    const XLSX = await import('xlsx')
    const rows = filteredDisbursements.map((m, idx) => ({
      'م': idx + 1,
      'تاريخ الصرف': m.date || '—',
      'اسم الصنف': m.item,
      'الكمية المنصرفة': Number(m.qout) || 0,
      'سعر الوحدة': Number(m.price) || 0,
      'إجمالي القيمة': (Number(m.qout) || 0) * (Number(m.price) || 0),
      'المخزن المصدر': m.from || 'المخزن الرئيسي',
      'الوجهة / المستلم': m.to || '—',
      'رقم الإذن': m.permit || m.issue || '—',
      'ملاحظات': m.notes || '',
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'سجل المنصرف والتحويلات')
    XLSX.writeFile(workbook, `سجل-المنصرف-والتحويل-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function handleCreateDisbursement(mv: FixtureMovement) {
    if (onSaveMovement) {
      await onSaveMovement(mv, null)
    } else {
      syncOutwardMovementToCustody(mv)
    }
    void logAuditEvent({
      action: `إذن صرف وتحويل عهدة: ${mv.item} (${mv.qout} وحدة) من ${mv.from} إلى ${mv.to}`,
      entity_type: 'custody',
      details: {
        item: mv.item,
        quantity: mv.qout,
        from: mv.from,
        to: mv.to,
        permit: mv.permit,
        date: mv.date,
        sourceWarehouseId: mv.sourceWarehouseId,
        destWarehouseId: mv.destWarehouseId,
        destType: mv.destType,
        custodianName: mv.custodianName,
      },
      user: session?.user,
    })
    setItems(loadCustodyItems())
    setIsNewDisbursementOpen(false)
    setImportNotice(`تم تسجيل إذن الصرف وحفظ الحركة بنجاح (${mv.item} - ${mv.qout} وحدة)!`)
    setTimeout(() => setImportNotice(''), 6000)
  }

  function handleOpenPermitForMovement(mv: FixtureMovement) {
    const synthItem: CustodyItem = {
      id: `perm-${mv.id}`,
      warehouseId: mv.destWarehouseId || (mv.destType === 'warehouse' ? 'fci' : 'main'),
      code: String(mv.permit || mv.issue || mv.id),
      name: mv.item,
      category: 'أجهزة ومعدات طبية',
      custodian: mv.to || mv.custodianName || 'المستلم',
      quantity: Number(mv.qout) || 1,
      unit: 'قطعة',
      condition: 'excellent',
      custodyType: 'مستديمة',
      roomLocation: mv.to || '',
      acquisitionDate: mv.date || new Date().toISOString().slice(0, 10),
      unitPrice: Number(mv.price) || 0,
      value: (Number(mv.qout) || 1) * (Number(mv.price) || 0),
      serialNumber: '',
      notes: mv.notes || '',
    }
    setPermitInitialItems([synthItem])
    setIsPermitModalOpen(true)
  }

  const ActiveIcon = ICONS_MAP[activeWarehouse.iconKey] || Warehouse

  return (
    <section className="custody-module">
      {/* 1. Header & Quick Actions */}
      <div className="custody-header-card card-surface">
        <div className="custody-header-main">
          <div className="custody-badge-row">
            <span className="custody-status-chip">
              <ActiveIcon size={16} />
              <span>{activeWarehouse.name}</span>
            </span>

            {activeWarehouse.isHub ? (
              <span className="hub-badge">
                <Warehouse size={14} /> المركز التوريدي الرئيسي لكافة الكليات (7 مخازن فرعية)
              </span>
            ) : (
              <span className="supplied-by-badge">
                <ArrowLeftRight size={14} /> جهة التوريد والإمداد: المخزن الرئيسي
              </span>
            )}

            <span className="hero-divider">•</span>
            <span className="building-loc">{activeWarehouse.building}</span>
          </div>
          <h2 className="custody-title">منظومة عهدة المخازن والأصول التخصصية</h2>
          <p className="custody-description">{activeWarehouse.description}</p>

          {/* Quick links to Reports and Dashboard Analytics */}
          <div className="custody-view-toggle-bar" style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
            <NavLink
              to="/reports"
              className="secondary-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                fontWeight: 600,
                fontSize: '0.86rem',
                padding: '7px 16px',
                borderRadius: '8px',
                textDecoration: 'none',
              }}
            >
              <FileSpreadsheet size={15} style={{ color: 'var(--accent)' }} />
              <span>مركز التقارير وسجلات الجرد</span>
            </NavLink>

            <NavLink
              to="/"
              className="secondary-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                fontWeight: 600,
                fontSize: '0.86rem',
                padding: '7px 16px',
                borderRadius: '8px',
                textDecoration: 'none',
              }}
            >
              <BarChart3 size={15} style={{ color: 'var(--chart-1)' }} />
              <span>لوحة التحليلات العامة بالداشبورد</span>
            </NavLink>
          </div>
        </div>

        <div className="custody-actions-group">
          {canEdit && (
            activeWarehouse.isHub ? (
              <button
                type="button"
                className="highlight-action-btn"
                onClick={() => {
                  setSupplyingRowItem(null)
                  setIsSupplyingFromMain(true)
                }}
                id="btn-supply-from-main"
              >
                <ArrowLeftRight size={16} /> صرف وتوزيع إلى مخزن فرعي
              </button>
            ) : (
              <button
                type="button"
                className="highlight-action-btn"
                onClick={() => {
                  setSupplyingRowItem(null)
                  setIsSupplyingFromMain(true)
                }}
                id="btn-receive-from-main"
              >
                <ArrowLeftRight size={16} /> استلام صرف من المخزن الرئيسي
              </button>
            )
          )}

          {canEdit && (
            <button
              type="button"
              className="primary-btn"
              onClick={() => setIsAddingNew(true)}
              id="btn-add-custody"
            >
              <Plus size={17} /> إضافة صنف عهدة
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              className="highlight-action-btn"
              onClick={() => setIsImportModalOpen(true)}
              id="btn-import-custody-excel"
              title="استيراد كشف عهدة وأصول من ملف Excel"
            >
              <FileUp size={16} /> استيراد كشف Excel
            </button>
          )}

          {/* Official Government Permit Button */}
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setPermitInitialItems([])
              setIsPermitModalOpen(true)
            }}
            id="btn-open-permit-modal"
            title="طباعة إذن صرف أو محضر فحص واستلام رسمي معتمد"
          >
            <FileCheck2 size={16} /> إذن صرف رسمي
          </button>

          {/* Enhanced Export Excel Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              id="btn-export-custody-excel"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="تصدير كشف عهدة إلى ملف Excel"
            >
              <FileSpreadsheet size={16} />
              <span>تصدير Excel</span>
              <ChevronDown size={14} />
            </button>

            {isExportDropdownOpen && (
              <div
                className="export-dropdown-menu"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '6px',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
                  minWidth: '280px',
                  zIndex: 50,
                  overflow: 'hidden',
                  padding: '6px',
                }}
              >
                <button
                  type="button"
                  style={{
                    width: '100%',
                    textAlign: 'right',
                    padding: '9px 12px',
                    borderRadius: '7px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--ink)',
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                  }}
                  onClick={() => {
                    setIsExportDropdownOpen(false)
                    void exportCustodyToExcel(activeWarehouse.name, activeWarehouseItems, currency)
                  }}
                >
                  <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>تصدير عهدة {activeWarehouse.shortName}</div>
                    <small style={{ color: 'var(--muted)', fontSize: '0.74rem' }}>كشف بالبنود والإجماليات ({activeWarehouseItems.length} صنف)</small>
                  </div>
                </button>

                <button
                  type="button"
                  style={{
                    width: '100%',
                    textAlign: 'right',
                    padding: '9px 12px',
                    borderRadius: '7px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--ink)',
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    borderTop: '1px solid var(--line)',
                    marginTop: '4px',
                    paddingTop: '8px',
                  }}
                  onClick={() => {
                    setIsExportDropdownOpen(false)
                    void exportComprehensiveCustodyWorkbook(items, currency, settings.organization)
                  }}
                >
                  <Building2 size={16} style={{ color: 'var(--chart-1)' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>سجل الجرد الموحد لكافة الكليات</div>
                    <small style={{ color: 'var(--muted)', fontSize: '0.74rem' }}>ملف Excel شامل متعدد الصفحات لكافة المخازن الـ 8</small>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="secondary-btn"
            onClick={handlePrint}
            title="طباعة كشف الجرد والعهدة للمخزن الحالي"
            id="btn-print-custody"
          >
            <Printer size={16} /> طباعة الكشف
          </button>
        </div>
      </div>

      {importNotice && (
        <div
          className="inline-message success"
          role="status"
          style={{
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={18} />
            <span>{importNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportNotice('')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              padding: 0,
              display: 'flex',
            }}
            aria-label="إغلاق التنبيه"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 1.5 Primary View Navigation Tabs */}
      <div className="custody-nav-tabs-bar no-print" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'items'}
          className={`custody-nav-tab-btn ${mainTab === 'items' ? 'active' : ''}`}
          onClick={() => setMainTab('items')}
          id="tab-custody-items"
        >
          <Package size={18} />
          <span>الأصناف والعهدة الحالية</span>
          <span className="badge-pill">{items.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'disbursements'}
          className={`custody-nav-tab-btn ${mainTab === 'disbursements' ? 'active' : ''}`}
          onClick={() => setMainTab('disbursements')}
          id="tab-custody-disbursements"
        >
          <ArrowLeftRight size={18} />
          <span>حركات المنصرف والتحويل</span>
          <span className="badge-pill">{outwardMovements.length}</span>
        </button>
      </div>

      {mainTab === 'items' ? (
        <>
          {/* 2. Warehouses Tabs Strip */}
          <div className="warehouses-tabs-container card-surface" role="tablist" aria-label="أقسام ومخازن العهدة">
        <div className="warehouses-scroll-strip">
          {WAREHOUSES.map((wh) => {
            const Icon = ICONS_MAP[wh.iconKey] || Warehouse
            const count = warehouseCounts[wh.id] || 0
            const isActive = wh.id === activeWarehouseId

            return (
              <button
                key={wh.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`warehouse-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveWarehouseId(wh.id)
                  setSearchTerm('')
                }}
                id={`tab-warehouse-${wh.id}`}
              >
                <div className="tab-icon-wrap">
                  <Icon size={18} />
                </div>
                <div className="tab-text-wrap">
                  <span className="tab-name">{wh.name}</span>
                  <span className="tab-count-badge">
                    {wh.isHub ? `${count} عهدة (مغذي)` : `${count} عهدة`}
                  </span>
                </div>
                {isActive && <span className="tab-active-indicator" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* 3. Warehouse KPI Strip */}
      <div className="custody-kpis-grid">
        <div className="custody-kpi-card card-surface tone-teal">
          <div className="kpi-mini-head">
            <span>إجمالي بنود العهدة</span>
            <Package size={17} />
          </div>
          <strong className="kpi-big-num">{activeStats.totalItems.toLocaleString('ar-EG')}</strong>
          <small className="kpi-mini-sub">{activeStats.totalUnits.toLocaleString('ar-EG')} قطعة / وحدة مسجلة</small>
        </div>

        <div className="custody-kpi-card card-surface tone-emerald">
          <div className="kpi-mini-head">
            <span>القيمة الدفترية المقدرة</span>
            <FileSpreadsheet size={17} />
          </div>
          <strong className="kpi-big-num">{formatCurrency(activeStats.totalValue, currency)}</strong>
          <small className="kpi-mini-sub">إجمالي قيمة أصول {activeWarehouse.shortName}</small>
        </div>

        <div className="custody-kpi-card card-surface tone-blue">
          <div className="kpi-mini-head">
            <span>الصلاحية الفنية التامة</span>
            <CheckCircle2 size={17} />
          </div>
          <strong className="kpi-big-num">{activeStats.healthyRatio}%</strong>
          <small className="kpi-mini-sub">
            {activeStats.excellent + activeStats.good} صنف بحالة ممتازة وجيدة
          </small>
        </div>

        <div className="custody-kpi-card card-surface tone-amber">
          <div className="kpi-mini-head">
            <span>تتطلب صيانة أو فحص</span>
            <AlertTriangle size={17} />
          </div>
          <strong className="kpi-big-num">
            {(activeStats.maintenance + activeStats.damaged).toLocaleString('ar-EG')}
          </strong>
          <small className="kpi-mini-sub">
            {activeStats.maintenance} قيد الصيانة • {activeStats.damaged} كهنة
          </small>
        </div>
      </div>

      {/* 4. Filter and Search Toolbar */}
      <div className="custody-toolbar card-surface">
        <div className="custody-search-wrap">
          <Search size={16} />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`ابحث في عهدة ${activeWarehouse.name} (الصنف، الكود، أمين العهدة، المعمل)...`}
            id="input-custody-search"
          />
          {searchTerm && (
            <button type="button" className="clear-search-btn" onClick={() => setSearchTerm('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="custody-filter-selects">
          <div className="filter-select-group">
            <Filter size={14} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="تصفية حسب التصنيف"
            >
              <option value="all">كافة التصنيفات</option>
              <option value="أجهزة إلكترونية وحواسب">أجهزة إلكترونية وحواسب</option>
              <option value="أجهزة ومعدات طبية">أجهزة ومعدات طبية</option>
              <option value="أجهزة معملية وتجارب">أجهزة معملية وتجارب</option>
              <option value="أثاث وتجهيزات">أثاث وتجهيزات</option>
              <option value="أدوات ومستلزمات تشغيل">أدوات ومستلزمات تشغيل</option>
              <option value="أخرى">أخرى</option>
            </select>
          </div>

          <div className="filter-select-group">
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              aria-label="تصفية حسب الحالة الفنية"
            >
              <option value="all">كافة الحالات الفنية</option>
              <option value="excellent">ممتازة (جاهزة للعمل)</option>
              <option value="good">جيدة (تعمل بكفاءة)</option>
              <option value="maintenance">تحتاج صيانة / فحص</option>
              <option value="damaged">تالفة / كهنة</option>
            </select>
          </div>

          <div className="filter-select-group">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              aria-label="تصفية حسب نوع العهدة"
            >
              <option value="all">كافة أنواع العهد</option>
              <option value="مستديمة">عهدة مستديمة</option>
              <option value="مستهلكة">عهدة مستهلكة</option>
              <option value="شخصية">عهدة شخصية</option>
            </select>
          </div>
        </div>
      </div>

      {/* 5. Main Custody Table */}
      <div className="custody-table-card card-surface">
        <div className="table-scroll-container">
          <table className="custody-table">
            <thead>
              <tr>
                <th>كود العهدة</th>
                <th>اسم الصنف والمواصفات</th>
                <th>التصنيف</th>
                <th>أمين العهدة والموقع</th>
                <th>الكمية</th>
                <th>القيمة الدفترية (الإجمالي)</th>
                <th>الحالة الفنية</th>
                <th>النوع</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table-empty">
                    <div className="ledger-empty-box">
                      <div className="ledger-empty-icon">
                        <Package size={28} />
                      </div>
                      <h3>
                        {searchTerm || selectedCategory !== 'all' || selectedCondition !== 'all'
                          ? 'لا توجد أصناف مطابقة للبحث أو التصفية'
                          : `لا توجد أصناف مسجلة في ${activeWarehouse.name} حالياً`}
                      </h3>
                      <p>
                        {searchTerm
                          ? 'جرّب تعديل كلمات البحث أو مسح عوامل التصفية لعرض بنود العهدة.'
                          : activeWarehouse.isHub
                          ? 'يمكنك البدء بإضافة صنف عهدة مركزي وتوزيعه على الكليات.'
                          : `يمكنك استلام وتوريد أصناف من المخزن الرئيسي أو إضافة قيد عهدة جديد.`}
                      </p>
                      {canEdit && (
                        <div className="empty-quick-actions">
                          {!activeWarehouse.isHub && (
                            <button
                              type="button"
                              className="highlight-action-btn"
                              onClick={() => setIsSupplyingFromMain(true)}
                            >
                              <ArrowLeftRight size={16} /> استلام صرف من المخزن الرئيسي
                            </button>
                          )}
                          <button type="button" className="primary-btn" onClick={() => setIsAddingNew(true)}>
                            <Plus size={16} /> إضافة صنف عهدة جديد
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const conditionClass =
                    item.condition === 'excellent' ? 'condition-excellent' :
                    item.condition === 'good' ? 'condition-good' :
                    item.condition === 'maintenance' ? 'condition-maintenance' : 'condition-damaged'

                  const conditionLabel =
                    item.condition === 'excellent' ? 'ممتازة' :
                    item.condition === 'good' ? 'جيدة' :
                    item.condition === 'maintenance' ? 'تحتاج صيانة' : 'تالفة / كهنة'

                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="code-pill">{item.code}</span>
                      </td>
                      <td>
                        <div className="cell-item-name">{item.name}</div>
                        <div className="cell-sub-tags">
                          {item.serialNumber && <span className="serial-tag">سيريال: {item.serialNumber}</span>}
                          {item.notes && <span className="notes-tag">{item.notes}</span>}
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{item.category}</span>
                      </td>
                      <td>
                        <div className="custodian-name">{item.custodian}</div>
                        <small className="cell-sub">{item.roomLocation}</small>
                      </td>
                      <td>
                        <span className="qty-tag">
                          {item.quantity} {item.unit}
                        </span>
                      </td>
                      <td>
                        <div className="custody-val-cell">
                          <strong className="total-val">{formatCurrency(item.value, currency)}</strong>
                          {item.unitPrice ? (
                            <small className="unit-price-sub" title="سعر القطعة الواحدة">
                              ({formatCurrency(item.unitPrice, currency)} / {item.unit})
                            </small>
                          ) : item.quantity > 1 ? (
                            <small className="unit-price-sub" title="متوسط سعر الوحدة">
                              ({formatCurrency(Math.round(item.value / item.quantity), currency)} / {item.unit})
                            </small>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill ${conditionClass}`}>{conditionLabel}</span>
                      </td>
                      <td>
                        <span className="type-badge">{item.custodyType}</span>
                      </td>
                      <td className="actions-cell">
                        <div className="action-buttons-wrap">
                          <button
                            type="button"
                            className="table-action-btn history-action-btn"
                            onClick={() => setHistoryItem(item)}
                            title="سجل تتبع تاريخ وحركة الأصل وفحوصات الصيانة"
                            aria-label={`تاريخ ${item.name}`}
                          >
                            <History size={14} />
                            <span>تاريخ الأصل</span>
                          </button>
                          <button
                            type="button"
                            className="table-action-btn permit-action-btn"
                            onClick={() => {
                              setPermitInitialItems([item])
                              setIsPermitModalOpen(true)
                            }}
                            title="إعداد وطباعة إذن صرف رسمي لهذا الصنف"
                            aria-label={`إذن صرف ${item.name}`}
                          >
                            <FileCheck2 size={14} />
                            <span>إذن صرف</span>
                          </button>
                          {canEdit ? (
                            <>
                              {activeWarehouse.isHub && (
                                <button
                                  type="button"
                                  className="table-action-btn supply-action-btn"
                                  onClick={() => {
                                    setSupplyingRowItem(item)
                                    setIsSupplyingFromMain(true)
                                  }}
                                  title="صرف وتوريد هذا الصنف إلى كلية أو مخزن فرعي"
                                  aria-label={`صرف ${item.name} لكلية`}
                                >
                                  <ArrowLeftRight size={14} />
                                  <span>صرف لفرعي</span>
                                </button>
                              )}
                              {isSystemAdmin && (
                                <button
                                  type="button"
                                  className="table-action-btn edit-action-btn"
                                  onClick={() => setEditingItem(item)}
                                  title="تعديل بيانات العهدة"
                                  aria-label={`تعديل ${item.name}`}
                                >
                                  <Pencil size={14} />
                                  <span>تعديل</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="table-action-btn transfer-action-btn"
                                onClick={() => setTransferringItem(item)}
                                title="نقل العهدة إلى مخزن أو كلية أخرى"
                                aria-label={`نقل ${item.name}`}
                              >
                                <ArrowLeftRight size={14} />
                                <span>نقل</span>
                              </button>
                              {isSystemAdmin && (
                                <button
                                  type="button"
                                  className="table-action-btn delete-action-btn"
                                  onClick={() => setDeletingItem(item)}
                                  title="حذف الصنف من العهدة"
                                  aria-label={`حذف ${item.name}`}
                                >
                                  <Trash2 size={14} />
                                  <span>حذف</span>
                                </button>
                              )}
                              {!isSystemAdmin && (
                                <span className="read-only-badge" style={{ fontSize: '0.75rem', padding: '3px 8px' }} title="التعديل والحذف لمدير النظام فقط">
                                  <Eye size={12} /> تعديل/حذف: للمدير فقط
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="read-only-badge" title="صلاحية قراءة وعرض فقط">
                              <Eye size={12} /> عرض فقط
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="custody-table-footer">
          <span>
            عرض {filteredItems.length.toLocaleString('ar-EG')} صنف من إجمالي{' '}
            {activeWarehouseItems.length.toLocaleString('ar-EG')} مسجل في {activeWarehouse.name}
          </span>
          <button
            type="button"
            className="text-link-btn"
            onClick={() => void exportCustodyToExcel(activeWarehouse.name, activeWarehouseItems, currency)}
          >
            تحميل تقرير Excel كامل <ArrowDownToLine size={14} />
          </button>
        </div>
      </div>
    </>
  ) : (
    /* Disbursements View */
    <div className="custody-disbursements-view">
      {/* 2. Disbursements KPI Strip */}
      <div className="custody-kpis-grid">
        <div className="custody-kpi-card card-surface tone-teal">
          <div className="kpi-mini-head">
            <span>إجمالي أذون المنصرف</span>
            <ArrowLeftRight size={17} />
          </div>
          <strong className="kpi-big-num">{disbursementStats.count.toLocaleString('ar-EG')}</strong>
          <small className="kpi-mini-sub">{disbursementStats.uniqueItems.toLocaleString('ar-EG')} صنف مختلف تم صرفه</small>
        </div>

        <div className="custody-kpi-card card-surface tone-emerald">
          <div className="kpi-mini-head">
            <span>إجمالي الوحدات المنصرفة</span>
            <Package size={17} />
          </div>
          <strong className="kpi-big-num">{disbursementStats.totalQty.toLocaleString('ar-EG')}</strong>
          <small className="kpi-mini-sub">قطعة / وحدة محولة ومنصرفة</small>
        </div>

        <div className="custody-kpi-card card-surface tone-blue">
          <div className="kpi-mini-head">
            <span>إجمالي القيمة التقديرية</span>
            <FileSpreadsheet size={17} />
          </div>
          <strong className="kpi-big-num">{formatCurrency(disbursementStats.totalVal, currency)}</strong>
          <small className="kpi-mini-sub">القيمة الدفترية للأصناف المنصرفة</small>
        </div>

        <div className="custody-kpi-card card-surface tone-amber">
          <div className="kpi-mini-head">
            <span>عدد المخازن المستفيدة</span>
            <Warehouse size={17} />
          </div>
          <strong className="kpi-big-num">
            {new Set(outwardMovements.map((m) => m.destWarehouseId || m.to).filter(Boolean)).size.toLocaleString('ar-EG')}
          </strong>
          <small className="kpi-mini-sub">كليات ومستودعات وجهات مستلمة</small>
        </div>
      </div>

      {/* 3. Filter & Search Toolbar */}
      <div className="custody-toolbar card-surface">
        <div className="custody-search-wrap">
          <Search size={16} />
          <input
            type="search"
            value={disbursementSearch}
            onChange={(e) => setDisbursementSearch(e.target.value)}
            placeholder="ابحث في حركات المنصرف (الصنف، المستلم، المخزن المصدر، إذن الصرف)..."
            id="input-disbursement-search"
          />
          {disbursementSearch && (
            <button type="button" className="clear-search-btn" onClick={() => setDisbursementSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="custody-filter-selects">
          <div className="filter-select-group">
            <Filter size={14} />
            <select
              value={disbursementSourceWh}
              onChange={(e) => setDisbursementSourceWh(e.target.value)}
              aria-label="تصفية حسب المخزن المصدر"
            >
              <option value="all">كافة المخازن المصدر</option>
              {WAREHOUSES.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="filter-select-group">
            <select
              value={disbursementDestWh}
              onChange={(e) => setDisbursementDestWh(e.target.value)}
              aria-label="تصفية حسب المخزن المستلم"
            >
              <option value="all">كافة الوجهات والمخازن المستلمة</option>
              {WAREHOUSES.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          {canDisburse && (
            <button
              type="button"
              className="primary-btn"
              onClick={() => setIsNewDisbursementOpen(true)}
              id="btn-add-disbursement-toolbar"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              <span>إذن صرف / تحويل جديد</span>
            </button>
          )}

          <button
            type="button"
            className="secondary-btn"
            onClick={handleExportDisbursements}
            title="تصدير كشف المنصرف والتحويلات إلى Excel"
          >
            <FileSpreadsheet size={16} />
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      {/* 4. Disbursements Table */}
      <div className="custody-table-card card-surface">
        <div className="table-scroll-container">
          <table className="custody-table">
            <thead>
              <tr>
                <th>#</th>
                <th>تاريخ الصرف</th>
                <th>اسم الصنف</th>
                <th>الكمية المنصرفة</th>
                <th>سعر الوحدة</th>
                <th>إجمالي القيمة</th>
                <th>المخزن المصدر</th>
                <th>الوجهة / المستلم</th>
                <th>رقم المستند / الإذن</th>
                <th>ملاحظات</th>
                <th className="actions-header">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredDisbursements.length === 0 ? (
                <tr>
                  <td colSpan={11} className="table-empty">
                    <div className="ledger-empty-box">
                      <div className="ledger-empty-icon">
                        <ArrowLeftRight size={28} />
                      </div>
                      <h3>
                        {disbursementSearch || disbursementSourceWh !== 'all' || disbursementDestWh !== 'all'
                          ? 'لا توجد حركات منصرف مطابقة للبحث أو التصفية'
                          : 'لا توجد حركات منصرف أو تحويل مسجلة بعد'}
                      </h3>
                      <p>
                        {canDisburse
                          ? 'يمكنك تسجيل أول حركة صرف أو تحويل بين المخازن بالضغط على «إذن صرف / تحويل جديد» أعلاه.'
                          : 'لم يتم تسجيل أية أذون صرف في النظام حتى الآن.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDisbursements.map((m, idx) => {
                  const qty = Number(m.qout) || 0
                  const price = Number(m.price) || 0
                  const total = qty * price
                  return (
                    <tr key={m.id || idx}>
                      <td>{idx + 1}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{m.date || m.issue || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{m.item}</td>
                      <td style={{ fontWeight: 700, color: 'var(--bad)' }}>{qty}</td>
                      <td>{formatCurrency(price, currency)}</td>
                      <td style={{ fontWeight: 700, color: 'var(--ink)' }}>{formatCurrency(total, currency)}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
                          <Warehouse size={13} style={{ color: 'var(--accent)' }} />
                          <span>{m.from || 'المخزن الرئيسي'}</span>
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{m.to || m.custodianName || '—'}</span>
                      </td>
                      <td>
                        {m.permit || m.issue ? (
                          <code style={{ fontSize: '0.82rem', padding: '2px 6px', background: 'var(--bg)', borderRadius: '4px' }}>
                            {m.permit || m.issue}
                          </code>
                        ) : '—'}
                      </td>
                      <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.notes || '—'}
                      </td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() => handleOpenPermitForMovement(m)}
                          title="طباعة إذن صرف رسمي معتمد لهذا البند"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', padding: '4px 8px' }}
                        >
                          <Printer size={14} />
                          <span>إذن رسمي</span>
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
    </div>
  )}

      {/* 6. Add/Edit Modal */}
      {(isAddingNew || (isSystemAdmin && editingItem)) && (
        <CustodyItemModal
          initialItem={editingItem}
          defaultWarehouseId={activeWarehouseId}
          onSave={handleSaveItem}
          onClose={() => {
            setIsAddingNew(false)
            setEditingItem(null)
          }}
        />
      )}

      {/* 7. Transfer Custody Modal */}
      {transferringItem && (
        <TransferCustodyModal
          item={transferringItem}
          currentWarehouse={activeWarehouse}
          onTransfer={handleTransfer}
          onClose={() => setTransferringItem(null)}
        />
      )}

      {/* 8. Supply from Main Warehouse Modal */}
      {isSupplyingFromMain && (
        <SupplyFromMainModal
          mainItems={mainWarehouseItems}
          initialItem={supplyingRowItem}
          defaultTargetWarehouseId={activeWarehouse.isHub ? 'medicine' : activeWarehouse.id}
          onDisburse={handleDisburseFromMain}
          onClose={() => {
            setIsSupplyingFromMain(false)
            setSupplyingRowItem(null)
          }}
        />
      )}

      {/* 9. Delete Confirmation Modal */}
      {isSystemAdmin && deletingItem && (
        <div className="modal-backdrop" onClick={() => setDeletingItem(null)}>
          <div className="modal-dialog modal-dialog-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-title-icon" style={{ background: 'var(--badge-danger-bg)', color: 'var(--bad)' }}>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3>تأكيد إسقاط / حذف العهدة</h3>
                  <span className="modal-subtitle">{activeWarehouse.name}</span>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeletingItem(null)} aria-label="إغلاق">
                <X size={18} />
              </button>
            </div>

            <div className="modal-confirm-body">
              <div className="confirm-icon-wrap delete-tone">
                <Trash2 size={26} />
              </div>
              <h3>هل أنت متأكد من حذف هذا الصنف من العهدة؟</h3>
              <p>سيتم إزالة هذا القيد نهائياً من سجلات عهدة {activeWarehouse.name}.</p>

              <div className="confirm-details-card">
                <div className="confirm-detail-row">
                  <span className="confirm-detail-label">الصنف:</span>
                  <strong className="confirm-detail-val">{deletingItem.name}</strong>
                </div>
                <div className="confirm-detail-row">
                  <span className="confirm-detail-label">كود العهدة:</span>
                  <span className="confirm-detail-val">{deletingItem.code}</span>
                </div>
                <div className="confirm-detail-row">
                  <span className="confirm-detail-label">أمين العهدة:</span>
                  <span className="confirm-detail-val">{deletingItem.custodian}</span>
                </div>
                <div className="confirm-detail-row">
                  <span className="confirm-detail-label">الكمية:</span>
                  <span className="confirm-detail-val">{deletingItem.quantity} {deletingItem.unit}</span>
                </div>
              </div>

              <div className="confirm-warning">
                ⚠️ تنبيه: هذه العملية ستُسجل في سجل التدقيق والعمليات.
              </div>

              <div className="modal-confirm-actions">
                <button type="button" className="secondary-btn" onClick={() => setDeletingItem(null)}>
                  إلغاء
                </button>
                <button type="button" className="danger-btn" onClick={() => handleDeleteItem(deletingItem)}>
                  <Trash2 size={16} /> تأكيد الحذف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Custody Excel Modal */}
      {isImportModalOpen && (
        <ImportCustodyModal
          activeWarehouse={activeWarehouse}
          existingItemsCount={items.length}
          currency={currency}
          onImport={handleImportCustody}
          onClose={() => setIsImportModalOpen(false)}
        />
      )}

      {/* 8. Item Lifecycle & History Modal */}
      {historyItem && (
        <CustodyItemHistoryModal
          item={historyItem}
          currency={currency}
          onClose={() => setHistoryItem(null)}
          onUpdateItem={handleSaveItem}
        />
      )}

      {/* 9. Official Disbursement / Inspection Permit Modal */}
      {isPermitModalOpen && (
        <OfficialDisbursementPermitModal
          initialItems={permitInitialItems}
          allWarehouseItems={activeWarehouseItems}
          settings={settings}
          onClose={() => setIsPermitModalOpen(false)}
        />
      )}

      {/* 9.5 New Disbursement / Transfer Modal */}
      {isNewDisbursementOpen && (
        <NewDisbursementModal
          items={items}
          currency={currency}
          onClose={() => setIsNewDisbursementOpen(false)}
          onSubmit={handleCreateDisbursement}
        />
      )}

      {/* 10. Official Printed Document Template (A4 Portrait - Certified Inventory Sheet) */}
      <div className="official-custody-print-document" aria-hidden="true">
        {/* Formal Institutional Letterhead */}
        <header className="print-letterhead">
          <div className="print-header-col print-header-right">
            <div className="print-gov-heading">جمهورية مصر العربية</div>
            <div className="print-org-name">{settings.organization || 'المؤسسة التعليمية'}</div>
            <div className="print-dept-name">{settings.department || 'إدارة المخازن المركزية'}</div>
            <div className="print-subdept-name">قسم مراقبة وتوثيق العهد والأصول المستديمة</div>
          </div>

          <div className="print-header-col print-header-center">
            {settings.logoDataUrl || settings.logoUrl ? (
              <img
                src={settings.logoDataUrl || settings.logoUrl}
                alt={settings.organization || 'شعار المؤسسة'}
                className="print-official-logo"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                  const parent = e.currentTarget.parentElement;
                  if (parent && !parent.querySelector('.print-logo-fallback')) {
                    const fallback = document.createElement('div');
                    fallback.className = 'print-logo-emblem print-logo-fallback';
                    fallback.innerHTML = '<span>' + (settings.organization || 'شعار المؤسسة') + '</span>';
                    parent.appendChild(fallback);
                  }
                }}
              />
            ) : (
              <div className="print-logo-emblem">
                <Warehouse size={32} />
                <span>{settings.organization || 'شعار المؤسسة'}</span>
              </div>
            )}
          </div>

          <div className="print-header-col print-header-left">
            <div className="print-meta-item">
              <span className="print-meta-label">رقم الكشف:</span>
              <span className="print-meta-value">INV-CUST-{activeWarehouse.id.toUpperCase()}</span>
            </div>
            <div className="print-meta-item">
              <span className="print-meta-label">تاريخ الجرد:</span>
              <span className="print-meta-value">
                {new Intl.DateTimeFormat('ar-EG', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }).format(new Date())}
              </span>
            </div>
            <div className="print-meta-item">
              <span className="print-meta-label">المستودع:</span>
              <span className="print-meta-value">{activeWarehouse.name}</span>
            </div>
            <div className="print-meta-item">
              <span className="print-meta-label">جهة الإمداد:</span>
              <span className="print-meta-value">
                {activeWarehouse.isHub ? 'مستودع إمداد عام مركزي' : 'المخزن الرئيسي'}
              </span>
            </div>
          </div>
        </header>

        {/* Document Title Banner */}
        <div className="print-document-banner">
          <h1 className="print-doc-title">محضر كشف حصر وجرد العهدة المخزنية الرسمية</h1>
          <div className="print-doc-subtitle">
            بيان تفصيلي بعهدة: <strong>{activeWarehouse.name}</strong> — {activeWarehouse.building}
          </div>
        </div>

        {/* Statistical KPI summary strip */}
        <div className="print-summary-strip">
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي البنود المسجلة:</span>
            <span className="print-summary-val">{activeWarehouseItems.length.toLocaleString('ar-EG')} صنف</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي الوحدات والقطع:</span>
            <span className="print-summary-val">{activeStats.totalUnits.toLocaleString('ar-EG')} وحدة</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">إجمالي القيمة الدفترية:</span>
            <span className="print-summary-val">{formatCurrency(activeStats.totalValue, currency)}</span>
          </div>
          <div className="print-summary-cell">
            <span className="print-summary-label">نسبة الجاهزية الفنية:</span>
            <span className="print-summary-val">{activeStats.healthyRatio}% صالحة للتشغيل</span>
          </div>
        </div>

        {/* Printable Official Inventory Table */}
        <table className="print-official-table">
          <thead>
            <tr>
              <th style={{ width: '4%' }}>م</th>
              <th style={{ width: '13%' }}>كود العهدة</th>
              <th style={{ width: '28%' }}>اسم الصنف والمواصفات الفنية</th>
              <th style={{ width: '13%' }}>التصنيف والنوع</th>
              <th style={{ width: '16%' }}>أمين العهدة / المكان</th>
              <th style={{ width: '8%' }}>الكمية</th>
              <th style={{ width: '10%' }}>القيمة الدفترية</th>
              <th style={{ width: '8%' }}>الحالة الفنية</th>
            </tr>
          </thead>
          <tbody>
            {activeWarehouseItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="print-empty-row">
                  لا توجد بنود عهدة مسجلة في هذا المخزن حالياً — الكشف نظيف ومعد لإدراج الأصول الجديدة.
                </td>
              </tr>
            ) : (
              activeWarehouseItems.map((item, index) => (
                <tr key={item.id}>
                  <td className="text-center">{index + 1}</td>
                  <td className="print-code-cell">{item.code}</td>
                  <td>
                    <div className="print-item-name">{item.name}</div>
                    {item.serialNumber && (
                      <div className="print-item-serial">سيريال: {item.serialNumber}</div>
                    )}
                    {item.notes && <div className="print-item-notes">{item.notes}</div>}
                  </td>
                  <td>
                    <div>{item.category}</div>
                    <span className="print-sub-type">({item.custodyType})</span>
                  </td>
                  <td>
                    <div className="print-custodian-name">{item.custodian}</div>
                    <div className="print-location-sub">{item.roomLocation}</div>
                  </td>
                  <td className="text-center">
                    <strong>{item.quantity}</strong> {item.unit}
                  </td>
                  <td className="text-center font-mono">
                    {formatCurrency(item.value, currency)}
                  </td>
                  <td className="text-center">
                    <span className={`print-condition-badge print-cond-${item.condition}`}>
                      {item.condition === 'excellent' && 'ممتازة'}
                      {item.condition === 'good' && 'جيدة'}
                      {item.condition === 'maintenance' && 'صيانة'}
                      {item.condition === 'damaged' && 'كهنة وتالف'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Official Signatures & Approvals */}
        <div className="print-signatures-section">
          <div className="print-signatures-notice">
            * يُقر الموقعون أدناه بصحة البيانات والمطابقة الفعلية لجرد العهدة والأصول على الطبيعة وفقاً للوائح والقوانين المخزنية.
          </div>
          <div className="print-signatures-grid">
            <div className="print-signature-box">
              <div className="print-sig-role">أمين العهدة المسؤول</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box">
              <div className="print-sig-role">عضو لجنة الجرد والفحص</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box">
              <div className="print-sig-role">مدير إدارة المخازن</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">التوقيع: ...................................</div>
              <div className="print-sig-field">التاريخ: ..... / ..... / 2026 م</div>
            </div>

            <div className="print-signature-box print-approval-box">
              <div className="print-sig-role">يعتمد: عميد الكلية / رئيس الجهة</div>
              <div className="print-sig-field">الاسم: .......................................</div>
              <div className="print-sig-field">الاعتماد: ...................................</div>
              <div className="print-seal-area">
                <span className="print-seal-hint">(خاتم شعار الجمهورية / ختم المؤسسة)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Print Document Footer */}
        <footer className="print-document-footer">
          <span>طُبع هذا المحضر آلياً عبر منظومة إدارة المخازن والعهدة — مستند رسمي صالح للتدقيق المالي والمخزني</span>
          <span>صفحة 1 من 1</span>
        </footer>
      </div>
    </section>
  )
}

function CustodyItemModal({
  initialItem,
  defaultWarehouseId,
  onSave,
  onClose,
}: {
  initialItem: CustodyItem | null
  defaultWarehouseId: string
  onSave: (item: CustodyItem) => void
  onClose: () => void
}) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  const initialQty = initialItem?.quantity || 1
  const initialUnit = initialItem?.unit || 'جهاز'

  const initialUnitPriceVal = useMemo(() => {
    if (!initialItem) return ''
    if (initialItem.unitPrice != null && initialItem.unitPrice > 0) {
      return initialItem.unitPrice
    }
    // If unitPrice is missing but value was entered (user entered unit price into value field)
    if (initialItem.value > 0) {
      return initialItem.value
    }
    return ''
  }, [initialItem])

  const initialTotalVal = useMemo(() => {
    if (!initialItem) return ''
    if (initialItem.unitPrice != null && initialItem.unitPrice > 0) {
      if (initialItem.quantity > 1 && Math.abs(initialItem.value - initialItem.unitPrice) < 0.01) {
        return Math.round(initialItem.quantity * initialItem.unitPrice)
      }
      return initialItem.value
    }
    if (initialItem.value > 0) {
      return Math.round(initialItem.quantity * initialItem.value)
    }
    return ''
  }, [initialItem])

  const [quantity, setQuantity] = useState<number | string>(initialQty)
  const [unit, setUnit] = useState<string>(initialUnit)
  const [unitPrice, setUnitPrice] = useState<number | string>(initialUnitPriceVal)
  const [totalValue, setTotalValue] = useState<number | string>(initialTotalVal)

  function handleQuantityChange(valStr: string) {
    setQuantity(valStr)
    const q = Number(valStr) || 0
    const p = Number(unitPrice) || 0
    if (p > 0) {
      setTotalValue(Math.round(q * p))
    }
  }

  function handleUnitPriceChange(valStr: string) {
    setUnitPrice(valStr)
    const p = Number(valStr) || 0
    const q = Number(quantity) || 0
    setTotalValue(Math.round(q * p))
  }

  function handleTotalValueChange(valStr: string) {
    setTotalValue(valStr)
    const total = Number(valStr) || 0
    const q = Number(quantity) || 0
    if (q > 0 && total > 0) {
      const derivedPrice = parseFloat((total / q).toFixed(2))
      setUnitPrice(derivedPrice)
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)

    const numQty = Math.max(1, Number(quantity) || 1)
    const numUnitPrice = Math.max(0, Number(unitPrice) || 0)
    const numTotalValue = Number(totalValue) || Math.round(numQty * numUnitPrice)

    const item: CustodyItem = {
      id: initialItem ? initialItem.id : `c-${Date.now()}`,
      warehouseId: String(fd.get('warehouseId') || defaultWarehouseId),
      code: String(fd.get('code')).trim(),
      name: String(fd.get('name')).trim(),
      category: fd.get('category') as CustodyCategory,
      custodian: String(fd.get('custodian')).trim(),
      quantity: numQty,
      unit: unit.trim() || 'قطعة',
      condition: fd.get('condition') as CustodyCondition,
      custodyType: fd.get('custodyType') as CustodyType,
      roomLocation: String(fd.get('roomLocation')).trim(),
      acquisitionDate: String(fd.get('acquisitionDate') || today),
      unitPrice: numUnitPrice,
      value: numTotalValue > 0 ? numTotalValue : Math.round(numQty * numUnitPrice),
      serialNumber: String(fd.get('serialNumber') ?? '').trim(),
      notes: String(fd.get('notes') ?? '').trim(),
    }

    onSave(item)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon">
              {initialItem ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <div>
              <h3>{initialItem ? 'تعديل بيانات صنف العهدة' : 'إضافة صنف عهدة جديد'}</h3>
              <span className="modal-subtitle">سجل عهدة المخازن والأصول</span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <form className="movement-form custody-form-grid" onSubmit={handleSubmit}>
            <label>
              المخزن التابع له
              <select name="warehouseId" defaultValue={initialItem?.warehouseId || defaultWarehouseId} required>
                {WAREHOUSES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.isHub ? '(المخزن الرئيسي المغذي)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              كود العهدة / الباركود
              <input
                name="code"
                required
                defaultValue={initialItem?.code || `CUS-${Date.now().toString().slice(-4)}`}
                placeholder="مثال: MED-MIC-101"
              />
            </label>

            <label className="span-2">
              اسم الصنف / الجهاز / الأصل
              <input
                name="name"
                required
                defaultValue={initialItem?.name || ''}
                placeholder="مثال: ميكروسكوب ضوئي ثلاثي الأبعاد Olympus"
              />
            </label>

            <label>
              التصنيف
              <select name="category" defaultValue={initialItem?.category || 'أجهزة إلكترونية وحواسب'} required>
                <option value="أجهزة إلكترونية وحواسب">أجهزة إلكترونية وحواسب</option>
                <option value="أجهزة ومعدات طبية">أجهزة ومعدات طبية</option>
                <option value="أجهزة معملية وتجارب">أجهزة معملية وتجارب</option>
                <option value="أثاث وتجهيزات">أثاث وتجهيزات</option>
                <option value="أدوات ومستلزمات تشغيل">أدوات ومستلزمات تشغيل</option>
                <option value="أخرى">أخرى</option>
              </select>
            </label>

            <label>
              أمين العهدة المسئول
              <input
                name="custodian"
                required
                defaultValue={initialItem?.custodian || ''}
                placeholder="مثال: د. رامي عبد المنعم"
              />
            </label>

            <label>
              الكمية
              <input
                name="quantity"
                type="number"
                min="1"
                step="1"
                required
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
                placeholder="مثال: 450"
              />
            </label>

            <label>
              وحدة القياس
              <input
                name="unit"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="مثال: ترابيزة، مكتب، جهاز، طقم"
              />
            </label>

            <label>
              سعر القطعة / الوحدة (القيمة التقديرية)
              <input
                name="unitPrice"
                type="number"
                min="0"
                step="any"
                value={unitPrice}
                onChange={(e) => handleUnitPriceChange(e.target.value)}
                placeholder="سعر الوحدة الواحدة (مثال: 6930)"
              />
            </label>

            <label>
              إجمالي القيمة الدفترية (يُحسب تلقائياً)
              <input
                name="value"
                type="number"
                min="0"
                step="any"
                value={totalValue}
                onChange={(e) => handleTotalValueChange(e.target.value)}
                placeholder="يُحسب تلقائياً: الكمية × سعر القطعة"
              />
            </label>

            <div className="custody-calc-summary span-2">
              <div className="calc-summary-title">
                <Calculator size={15} />
                <span>الحساب التلقائي لإجمالي القيمة الدفترية:</span>
              </div>
              <div className="calc-summary-details">
                <span className="calc-part-qty">
                  <strong>{quantity || 0}</strong> {unit || 'وحدة'}
                </span>
                <span className="calc-op">×</span>
                <span className="calc-part-price">
                  <strong>{Number(unitPrice || 0).toLocaleString('ar-EG')}</strong> ج.م. / {unit || 'وحدة'}
                </span>
                <span className="calc-op">=</span>
                <span className="calc-part-total">
                  <strong>{Number(totalValue || 0).toLocaleString('ar-EG')}</strong> ج.م. (الإجمالي)
                </span>
              </div>
            </div>

            <label>
              الحالة الفنية
              <select name="condition" defaultValue={initialItem?.condition || 'excellent'} required>
                <option value="excellent">ممتازة (جاهزة للعمل فوراً)</option>
                <option value="good">جيدة (تعمل بكفاءة مستقرة)</option>
                <option value="maintenance">تحتاج صيانة / فحص دوري</option>
                <option value="damaged">تالفة / كهنة</option>
              </select>
            </label>

            <label>
              نوع العهدة
              <select name="custodyType" defaultValue={initialItem?.custodyType || 'مستديمة'} required>
                <option value="مستديمة">عهدة مستديمة</option>
                <option value="مستهلكة">عهدة مستهلكة</option>
                <option value="شخصية">عهدة شخصية</option>
              </select>
            </label>

            <label>
              المكان / القاعة / المعمل
              <input
                name="roomLocation"
                required
                defaultValue={initialItem?.roomLocation || ''}
                placeholder="مثال: معمل الهستولوجي - قاعة ب"
              />
            </label>

            <label>
              تاريخ القيد / الاستلام
              <input
                name="acquisitionDate"
                type="date"
                required
                defaultValue={initialItem?.acquisitionDate || today}
              />
            </label>

            <label className="span-2">
              الرقم التسلسلي للمصنع (Serial No.)
              <input
                name="serialNumber"
                defaultValue={initialItem?.serialNumber || ''}
                placeholder="اختياري: SN-88219"
              />
            </label>

            <label className="form-notes span-2">
              ملاحظات وتفاصيل إضافية
              <textarea
                name="notes"
                rows={2}
                defaultValue={initialItem?.notes || ''}
                placeholder="أي ملاحظات حول الملحقات أو حالة الفحص..."
              />
            </label>

            <div className="form-actions span-2">
              <button type="button" className="secondary-btn" onClick={onClose}>
                إلغاء
              </button>
              <button type="submit" className="primary-btn">
                {initialItem ? 'حفظ التعديلات' : 'إضافة إلى العهدة'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function TransferCustodyModal({
  item,
  currentWarehouse,
  onTransfer,
  onClose,
}: {
  item: CustodyItem
  currentWarehouse: WarehouseDefinition
  onTransfer: (
    item: CustodyItem,
    targetWarehouseId: string,
    transferQty: number,
    newCustodian: string,
    newLocation: string,
    transferReason: string
  ) => void
  onClose: () => void
}) {
  const otherWarehouses = useMemo(() => {
    return WAREHOUSES.filter((w) => w.id !== currentWarehouse.id)
  }, [currentWarehouse.id])

  const [targetId, setTargetId] = useState(otherWarehouses[0]?.id || '')
  const [qty, setQty] = useState(item.quantity)
  const [newCustodian, setNewCustodian] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault()
    if (qty < 1 || qty > item.quantity) {
      setError(`الكمية المنقولة يجب أن تكون بين 1 و ${item.quantity}.`)
      return
    }
    if (!targetId) {
      setError('يرجى اختيار المخزن المحول إليه.')
      return
    }

    onTransfer(item, targetId, qty, newCustodian, newLocation, reason)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'rgba(14, 124, 134, 0.12)', color: 'var(--accent)' }}>
              <ArrowLeftRight size={18} />
            </div>
            <div>
              <h3>نقل عهدة بين المخازن والكليات</h3>
              <span className="modal-subtitle">نقل صنف مع تحويل المسؤولية الإدارية</span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <form className="movement-form custody-transfer-form" onSubmit={handleFormSubmit}>
            <div className="transfer-source-box">
              <div className="transfer-source-label">الصنف المنقول:</div>
              <strong className="transfer-item-title">{item.name}</strong>
              <div className="transfer-source-meta">
                <span>الكود: {item.code}</span>
                <span>•</span>
                <span>المخزن الحالي: <strong>{currentWarehouse.name}</strong></span>
                <span>•</span>
                <span>الرصيد المتاح: <strong>{item.quantity} {item.unit}</strong></span>
              </div>
            </div>

            <label>
              المخزن / الكلية المحول إليها
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                {otherWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.shortName})
                  </option>
                ))}
              </select>
            </label>

            <label>
              الكمية المراد نقلها (بالـ {item.unit})
              <input
                type="number"
                min="1"
                max={item.quantity}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                required
              />
            </label>

            <label>
              أمين العهدة الجديد (في المخزن المستلم)
              <input
                value={newCustodian}
                onChange={(e) => setNewCustodian(e.target.value)}
                placeholder="اسم المستلم المسؤول الجديد"
                required
              />
            </label>

            <label>
              المقر / القاعة الجديدة
              <input
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="مثال: معمل 102، مبنى الكلية"
                required
              />
            </label>

            <label className="form-notes span-2">
              سبب النقل / رقم إذن التحويل الداخلي
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: نقل بموجب قرار تشغيل المعمل المشترك رقم 44..."
              />
            </label>

            {error && <div className="inline-message error span-2">{error}</div>}

            <div className="form-actions span-2">
              <button type="button" className="secondary-btn" onClick={onClose}>
                إلغاء
              </button>
              <button type="submit" className="primary-btn">
                <ArrowLeftRight size={16} /> تأكيد نقل العهدة
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function SupplyFromMainModal({
  mainItems,
  initialItem,
  defaultTargetWarehouseId,
  onDisburse,
  onClose,
}: {
  mainItems: CustodyItem[]
  initialItem?: CustodyItem | null
  defaultTargetWarehouseId: string
  onDisburse: (
    sourceItem: CustodyItem,
    targetWarehouseId: string,
    quantity: number,
    recipientCustodian: string,
    newLocation: string,
    permitNo: string
  ) => void
  onClose: () => void
}) {
  const branchWarehouses = useMemo(() => {
    return WAREHOUSES.filter((w) => w.id !== 'main')
  }, [])

  const [selectedItemId, setSelectedItemId] = useState<string>(
    initialItem?.id || mainItems[0]?.id || ''
  )
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(
    defaultTargetWarehouseId === 'main' ? branchWarehouses[0]?.id || 'medicine' : defaultTargetWarehouseId
  )
  const selectedItem = useMemo(() => {
    return mainItems.find((i) => i.id === selectedItemId) || mainItems[0]
  }, [mainItems, selectedItemId])

  const [quantity, setQuantity] = useState<number>(1)
  const [recipientCustodian, setRecipientCustodian] = useState<string>('')
  const [newLocation, setNewLocation] = useState<string>('')
  const [permitNo, setPermitNo] = useState<string>(`صرف-${new Date().getFullYear()}/${Math.floor(100 + Math.random() * 900)}`)
  const [error, setError] = useState<string>('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedItem) {
      setError('لا توجد أصناف متاحة للصرف في المخزن الرئيسي حالياً.')
      return
    }
    if (quantity < 1 || quantity > selectedItem.quantity) {
      setError(`الكمية المصروفة يجب أن تكون بين 1 و ${selectedItem.quantity}.`)
      return
    }
    if (!recipientCustodian.trim()) {
      setError('يرجى تحديد اسم أمين العهدة المستلم في الكلية.')
      return
    }

    onDisburse(selectedItem, targetWarehouseId, quantity, recipientCustodian.trim(), newLocation.trim(), permitNo.trim())
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'var(--badge-success-bg)', color: 'var(--good)' }}>
              <ArrowLeftRight size={18} />
            </div>
            <div>
              <h3>صرف وتغذية عهدة من المخزن الرئيسي</h3>
              <span className="modal-subtitle">إمداد المخازن الفرعية والكليات من المخزن المركزي المغذي</span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {mainItems.length === 0 ? (
            <div className="ledger-empty-box">
              <Package size={32} />
              <h3>لا توجد أصناف مسجلة في المخزن الرئيسي حالياً</h3>
              <p>يجب قيد أصناف في المخزن الرئيسي أولاً لتتمكن من صرفها وتوزيعها على الكليات والمعامل.</p>
              <button type="button" className="secondary-btn" onClick={onClose}>
                إغلاق
              </button>
            </div>
          ) : (
            <form className="movement-form custody-transfer-form" onSubmit={handleSubmit}>
              <label className="span-2">
                اختر الصنف المراد صرفه من المخزن الرئيسي
                <select
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value)
                    setQuantity(1)
                  }}
                  required
                >
                  {mainItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — [الكود: {item.code}] (المتاح بالمخزن الرئيسي: {item.quantity} {item.unit})
                    </option>
                  ))}
                </select>
              </label>

              {selectedItem && (
                <div className="transfer-source-box span-2">
                  <div className="transfer-source-label">بيانات الصنف بالمخزن الرئيسي:</div>
                  <strong className="transfer-item-title">{selectedItem.name}</strong>
                  <div className="transfer-source-meta">
                    <span>التصنيف: <strong>{selectedItem.category}</strong></span>
                    <span>•</span>
                    <span>الرصيد المتاح: <strong>{selectedItem.quantity} {selectedItem.unit}</strong></span>
                    <span>•</span>
                    <span>أمين العهدة الحالي: <strong>{selectedItem.custodian}</strong></span>
                  </div>
                </div>
              )}

              <label>
                الكلية / المخزن الفرعي المستلم
                <select
                  value={targetWarehouseId}
                  onChange={(e) => setTargetWarehouseId(e.target.value)}
                  required
                >
                  {branchWarehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name} ({wh.shortName})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                الكمية المصروفة {selectedItem ? `(بالـ ${selectedItem.unit})` : ''}
                <input
                  type="number"
                  min="1"
                  max={selectedItem?.quantity || 1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                />
              </label>

              <label>
                أمين العهدة المستلم في الكلية
                <input
                  value={recipientCustodian}
                  onChange={(e) => setRecipientCustodian(e.target.value)}
                  placeholder="مثال: د. أحمد فؤاد"
                  required
                />
              </label>

              <label>
                المقر / المعمل / القاعة بالكلية
                <input
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="مثال: معمل 201، مبنى الكلية"
                  required
                />
              </label>

              <label className="span-2">
                رقم إذن الصرف المخزني / المستند
                <input
                  value={permitNo}
                  onChange={(e) => setPermitNo(e.target.value)}
                  placeholder="مثال: إذن صرف 120/2026"
                  required
                />
              </label>

              {error && <div className="inline-message error span-2">{error}</div>}

              <div className="form-actions span-2">
                <button type="button" className="secondary-btn" onClick={onClose}>
                  إلغاء
                </button>
                <button type="submit" className="primary-btn">
                  <ArrowLeftRight size={16} /> اعتماد الصرف والتغذية
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

type ImportCustodyModalProps = {
  activeWarehouse: WarehouseDefinition
  existingItemsCount: number
  currency: AppSettings['currency']
  onImport: (newItems: CustodyItem[], targetWarehouseId: string, mode: 'append' | 'replace') => void
  onClose: () => void
}

function ImportCustodyModal({
  activeWarehouse,
  existingItemsCount,
  currency,
  onImport,
  onClose,
}: ImportCustodyModalProps) {
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(activeWarehouse.id)
  const importMode = 'append'
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [parsedRows, setParsedRows] = useState<CustodyItem[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const targetWh = useMemo(() => {
    return WAREHOUSES.find((w) => w.id === targetWarehouseId) || activeWarehouse
  }, [targetWarehouseId, activeWarehouse])

  async function handleFileSelected(selectedFile: File) {
    setParseError(null)
    setWarnings([])
    setFile(selectedFile)
    setFileName(selectedFile.name)
    setIsParsing(true)

    try {
      const XLSX = await import('xlsx')
      const buffer = await selectedFile.arrayBuffer()
      const workbook = XLSX.read(buffer, { cellDates: true })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        throw new Error('الملف فارغ أو لا يحتوي على أي صفحات عمل (Sheets).')
      }
      const sheet = workbook.Sheets[firstSheetName]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })

      if (!rawRows || rawRows.length === 0) {
        throw new Error('لم يتم العثور على أي صفوف أو بيانات داخل ملف Excel.')
      }

      const result = parseRawCustodyRows(rawRows, targetWarehouseId, existingItemsCount, XLSX)
      if (result.validItems.length === 0) {
        throw new Error('لم يتم استخراج أي أصناف صالحة. يرجى التأكد من احتواء الملف على عمود "اسم الصنف" أو مطابقة قالب العهدة.')
      }

      setParsedRows(result.validItems)
      setWarnings(result.warnings)
    } catch (err) {
      console.error('Custody import failed:', err)
      setParseError(err instanceof Error ? err.message : 'تعذر قراءة ملف Excel أو معالجة البيانات.')
      setParsedRows([])
    } finally {
      setIsParsing(false)
    }
  }

  function handleWarehouseChange(newWhId: string) {
    setTargetWarehouseId(newWhId)
    if (parsedRows.length > 0) {
      setParsedRows((prev) => prev.map((item) => ({ ...item, warehouseId: newWhId })))
    }
  }

  function handleResetFile() {
    setFile(null)
    setFileName('')
    setParsedRows([])
    setParseError(null)
    setWarnings([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleDownloadTemplate() {
    try {
      setIsDownloadingTemplate(true)
      await downloadCustodyTemplate(currency)
    } catch (err) {
      console.error('Template download error:', err)
      alert('حدث خطأ أثناء تنزيل النموذج، يرجى المحاولة مرة أخرى.')
    } finally {
      setIsDownloadingTemplate(false)
    }
  }

  function handleSubmit() {
    if (parsedRows.length === 0) return
    onImport(parsedRows, targetWarehouseId, importMode)
  }

  const totalQuantity = useMemo(() => {
    return parsedRows.reduce((sum, item) => sum + (item.quantity || 0), 0)
  }, [parsedRows])

  const totalEstimatedValue = useMemo(() => {
    return parsedRows.reduce((sum, item) => sum + (item.value || 0), 0)
  }, [parsedRows])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-import" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'var(--badge-success-bg)', color: 'var(--accent)' }}>
              <FileUp size={18} />
            </div>
            <div>
              <h3>استيراد كشف العهدة والأصول من Excel / CSV</h3>
              <span className="modal-subtitle">مطابق لقالب النموذج الرسمي للعهدة الحكومية والمخزنية (13 عموداً)</span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body-scroll modal-body-padded">
          {/* 1. Template Download & Instructions Strip */}
          <div className="modal-banner-strip">
            <div className="modal-banner-text">
              <Sparkles size={16} className="text-accent shrink-0" />
              <span>
                يدعم رفع الشيت مباشرة بكافة بياناته الـ 13 (الكود، اسم الصنف، التصنيف، أمين العهدة، الكمية، الوحدة، سعر الوحدة، النوع، الحالة، المكان، تاريخ القيد، السيريال، والملاحظات).
              </span>
            </div>
            <button
              type="button"
              className="template-download-btn"
              onClick={handleDownloadTemplate}
              disabled={isDownloadingTemplate}
              title="تحميل قالب Excel رسمي يحتوي على الأعمدة والأمثلة الاسترشادية"
            >
              <Download size={15} />
              <span>{isDownloadingTemplate ? 'جاري تجهيز القالب...' : 'تحميل قالب الشيت الجاهز (.xlsx)'}</span>
            </button>
          </div>

          {/* 2. Destination Warehouse & Import Mode */}
          <div className="form-grid-2col mb-3">
            <label className="form-label-block">
              المخزن المراد إضافة العهدة إليه:
              <select
                value={targetWarehouseId}
                onChange={(e) => handleWarehouseChange(e.target.value)}
                className="form-input-themed"
              >
                {WAREHOUSES.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name} {wh.isHub ? '(المخزن الرئيسي المغذي)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-label-block">
              <span>طريقة الاستيراد والتحديث:</span>
              <div className="import-mode-pill">
                <CheckCircle2 size={18} className="text-accent shrink-0" />
                <div>
                  <div className="text-accent font-bold font-sm">دمج وتحديث آمن (تلقائي)</div>
                  <div className="text-muted font-xs">
                    إضافة أصناف جديدة وتحديث المطابق بالكود دون مسح أو فقد أي بيانات قديمة.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Drag and Drop Zone or File Summary */}
          {!file ? (
            <div
              className={`custody-import-dropzone ${isDragging ? 'drag-active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const droppedFile = e.dataTransfer.files?.[0]
                if (droppedFile) void handleFileSelected(droppedFile)
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <div className="custody-import-icon-wrap">
                <Upload size={28} />
              </div>
              <div className="custody-import-label">اسحب وأفلت شيت Excel هنا، أو اضغط للتصفح من جهازك</div>
              <div className="custody-import-hint">الصيغ المدعومة: XLSX و XLS و CSV (يدعم كشوف العهدة الكبيرة)</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0]
                  if (selectedFile) void handleFileSelected(selectedFile)
                }}
                style={{ display: 'none' }}
                id="input-custody-excel-file"
              />
            </div>
          ) : (
            <div className="custody-import-file-card">
              <div className="custody-import-file-info">
                <FileSpreadsheet size={22} />
                <div>
                  <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{fileName}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {isParsing ? 'جاري قراءة وتحليل الأعمدة والصفوف...' : `${parsedRows.length} صنف صالح للقيد في ${targetWh.name}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleResetFile}
                style={{ padding: '6px 14px', fontSize: '0.84rem' }}
              >
                تغيير الملف
              </button>
            </div>
          )}

          {/* 4. Parsing / Error / Warning Notices */}
          {isParsing && (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)', fontSize: '0.92rem' }}>
              <div className="loading-spinner" style={{ margin: '0 auto 10px auto' }} />
              جاري فحص ومطابقة الأعمدة وتوليد القيود المخزنية...
            </div>
          )}

          {parseError && (
            <div className="inline-message error" style={{ marginTop: '14px' }}>
              <AlertTriangle size={16} />
              <span>{parseError}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="inline-message info mt-3">
              <AlertTriangle size={16} />
              <div className="flex flex-col gap-1">
                {warnings.slice(0, 3).map((w, idx) => (
                  <span key={idx}>{w}</span>
                ))}
                {warnings.length > 3 && (
                  <span className="font-xs">...و {warnings.length - 3} تنبيهات أخرى تم التعامل معها وتنسيقها تلقائياً.</span>
                )}
              </div>
            </div>
          )}

          {/* 5. Metrics Stat Bar */}
          {parsedRows.length > 0 && (
            <>
              <div className="custody-import-meta-bar">
                <div className="custody-import-meta-card">
                  <span className="custody-import-meta-label">عدد الأصناف المقروءة</span>
                  <span className="custody-import-meta-val text-accent">
                    {parsedRows.length} صنف
                  </span>
                </div>
                <div className="custody-import-meta-card">
                  <span className="custody-import-meta-label">إجمالي الوحدات والأجهزة</span>
                  <span className="custody-import-meta-val tabular-nums">{totalQuantity}</span>
                </div>
                <div className="custody-import-meta-card">
                  <span className="custody-import-meta-label">إجمالي القيمة التقديرية</span>
                  <span className="custody-import-meta-val text-accent">
                    {formatCurrency(totalEstimatedValue, currency)}
                  </span>
                </div>
                <div className="custody-import-meta-card">
                  <span className="custody-import-meta-label">المخزن المستهدف</span>
                  <span className="custody-import-meta-val text-base">
                    {targetWh.name}
                  </span>
                </div>
              </div>

              {/* Quick Action Bar (Top Button) */}
              <div className="custody-import-quick-action-bar">
                <div>
                  <strong>جاهز للاستيراد: {parsedRows.length} صنف صالح للقيد في "{targetWh.name}"</strong>
                  <span>
                    إجمالي الوحدات: {totalQuantity.toLocaleString('ar-EG')} • إجمالي القيمة المحسوبة تلقائياً: {formatCurrency(totalEstimatedValue, currency)}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-btn px-6 py-2"
                  onClick={handleSubmit}
                  disabled={parsedRows.length === 0 || isParsing}
                  id="btn-confirm-custody-import-top"
                >
                  <CheckCircle2 size={18} />
                  <span>اعتماد وحفظ الاستيراد في النظام الآن ({parsedRows.length} صنف)</span>
                </button>
              </div>

              {/* 6. Live Preview Table */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-sm font-semibold text-ink">
                    معاينة البيانات المستخرجة (أول {Math.min(10, parsedRows.length)} أصناف):
                  </span>
                  <span className="font-xs text-accent font-semibold">
                    💡 إجمالي القيمة محسوب تلقائياً في النظام (الكمية × سعر القطعة) دون الحاجة لإدخال الإجمالي بالشيت.
                  </span>
                </div>

                <div className="custody-import-preview-wrapper table-responsive">
                  <table className="custody-import-preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>كود العهدة</th>
                        <th>اسم الصنف</th>
                        <th>التصنيف</th>
                        <th>أمين العهدة</th>
                        <th>الكمية</th>
                        <th>الوحدة</th>
                        <th>سعر القطعة</th>
                        <th>إجمالي القيمة (محسوبة: الكمية × السعر)</th>
                        <th>نوع العهدة</th>
                        <th>الحالة الفنية</th>
                        <th>المكان / القاعة</th>
                        <th>تاريخ القيد</th>
                        <th>الرقم المسلسل</th>
                        <th>ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 10).map((row, idx) => (
                        <tr key={row.id || idx}>
                          <td>{idx + 1}</td>
                          <td><code>{row.code}</code></td>
                          <td className="font-semibold">{row.name}</td>
                          <td>{row.category}</td>
                          <td>{row.custodian || '—'}</td>
                          <td className="font-bold tabular-nums">{row.quantity}</td>
                          <td>{row.unit}</td>
                          <td>{row.unitPrice ? formatCurrency(row.unitPrice, currency) : '—'}</td>
                          <td className="text-accent font-bold tabular-nums">{formatCurrency(row.value, currency)}</td>
                          <td>{row.custodyType}</td>
                          <td>
                            {row.condition === 'excellent' && 'ممتازة'}
                            {row.condition === 'good' && 'جيدة'}
                            {row.condition === 'maintenance' && 'تحتاج صيانة'}
                            {row.condition === 'damaged' && 'تالفة / كهنة'}
                          </td>
                          <td>{row.roomLocation || '—'}</td>
                          <td>{row.acquisitionDate || '—'}</td>
                          <td>{row.serialNumber || '—'}</td>
                          <td className="truncate-cell">{row.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {parsedRows.length > 10 && (
                  <div className="text-center p-2 font-xs text-muted">
                    يتم عرض أول 10 أصناف فقط في المعاينة من إجمالي {parsedRows.length} صنف.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="modal-footer">
          <button type="button" className="secondary-btn" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="primary-btn px-6 py-2"
            onClick={handleSubmit}
            disabled={parsedRows.length === 0 || isParsing}
            id="btn-confirm-custody-import"
          >
            <CheckCircle2 size={18} />
            <span>
              {parsedRows.length > 0
                ? `اعتماد وحفظ استيراد ${parsedRows.length} صنف إلى ${targetWh.name}`
                : 'بانتظار تحديد الملف'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

function NewDisbursementModal({
  items,
  currency,
  onClose,
  onSubmit,
}: {
  items: CustodyItem[]
  currency: AppSettings['currency']
  onClose: () => void
  onSubmit: (movement: FixtureMovement) => Promise<void>
}) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState<string>('main')
  const [destType, setDestType] = useState<'warehouse' | 'custodian'>('warehouse')
  const [destWarehouseId, setDestWarehouseId] = useState<string>('fci')
  const [custodianName, setCustodianName] = useState<string>('')

  // Available items in source warehouse
  const sourceItems = useMemo(() => {
    return items.filter((i) => i.warehouseId === sourceWarehouseId && i.quantity > 0)
  }, [items, sourceWarehouseId])

  const [selectedItemName, setSelectedItemName] = useState<string>(() => sourceItems[0]?.name || '')

  useEffect(() => {
    if (sourceItems.length > 0 && !sourceItems.some((i) => i.name === selectedItemName)) {
      setSelectedItemName(sourceItems[0].name)
    }
  }, [sourceWarehouseId, sourceItems, selectedItemName])

  const currentItem = useMemo(() => {
    return sourceItems.find((i) => i.name === selectedItemName)
  }, [sourceItems, selectedItemName])

  const availableQty = currentItem ? currentItem.quantity : 0

  const [quantity, setQuantity] = useState<number>(1)
  const [unitPrice, setUnitPrice] = useState<number>(() => currentItem?.unitPrice || 0)

  useEffect(() => {
    if (currentItem) {
      setUnitPrice(currentItem.unitPrice || 0)
    }
  }, [currentItem])

  const [permitNo, setPermitNo] = useState<string>(() => {
    return `DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  })
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const sourceWh = WAREHOUSES.find((w) => w.id === sourceWarehouseId) || WAREHOUSES[0]
  const targetWh = WAREHOUSES.find((w) => w.id === destWarehouseId)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErrorMsg('')

    const cleanItem = selectedItemName.trim()
    if (!cleanItem) {
      setErrorMsg('يرجى اختيار أو تحديد الصنف المراد صرفه.')
      return
    }

    if (quantity <= 0) {
      setErrorMsg('الكمية المراد صرفها يجب أن تكون أكبر من الصفر.')
      return
    }

    if (availableQty > 0 && quantity > availableQty) {
      setErrorMsg(`الكمية المطلوبة (${quantity}) تتجاوز الرصيد المتوفر في ${sourceWh.name} (${availableQty} قطعة).`)
      return
    }

    if (destType === 'warehouse') {
      if (!destWarehouseId) {
        setErrorMsg('يرجى اختيار المخزن المستلم.')
        return
      }
      if (destWarehouseId === sourceWarehouseId) {
        setErrorMsg('لا يمكن التحويل لنفس المخزن المصدر.')
        return
      }
    } else {
      if (!custodianName.trim()) {
        setErrorMsg('يرجى إدخال اسم أمين العهدة أو الموظف المستلم.')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const targetName = destType === 'warehouse' ? (targetWh?.name || 'مخزن فرعي') : custodianName.trim()
      const newMovement: FixtureMovement = {
        id: Date.now(),
        date: date || new Date().toISOString().slice(0, 10),
        inv: '',
        from: sourceWh.name,
        to: targetName,
        permit: permitNo.trim(),
        issue: date || new Date().toISOString().slice(0, 10),
        item: cleanItem,
        price: unitPrice || 0,
        qin: 0,
        qout: quantity,
        notes: notes.trim(),
        sourceWarehouseId,
        destType,
        destWarehouseId: destType === 'warehouse' ? destWarehouseId : undefined,
        custodianName: destType === 'custodian' ? custodianName.trim() : undefined,
      }
      await onSubmit(newMovement)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ إذن الصرف.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="disbursement-modal-backdrop" onClick={onClose}>
      <div className="disbursement-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon" style={{ background: 'rgba(14, 124, 134, 0.12)', color: 'var(--accent)' }}>
              <ArrowLeftRight size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--ink)' }}>
                إنشاء إذن صرف / تحويل عهدة جديد
              </h3>
              <span className="modal-subtitle">
                خصم الكمية من المخزن المصدر وتحويلها ذرياً إلى الوجهة المستهدفة
              </span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body-scroll modal-body-padded">
            {errorMsg && (
              <div className="inline-message error" role="alert">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="form-grid-2col">
              <label className="form-label-block">
                المخزن المصدر:
                <select
                  value={sourceWarehouseId}
                  onChange={(e) => setSourceWarehouseId(e.target.value)}
                  className="form-input-themed"
                >
                  {WAREHOUSES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.isHub ? '(المخزن الرئيسي)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-label-block">
                الصنف المراد صرفه:
                {sourceItems.length > 0 ? (
                  <select
                    value={selectedItemName}
                    onChange={(e) => setSelectedItemName(e.target.value)}
                    className="form-input-themed"
                  >
                    {sourceItems.map((it) => (
                      <option key={it.id} value={it.name}>
                        {it.name} (المتاح: {it.quantity} {it.unit})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={selectedItemName}
                    onChange={(e) => setSelectedItemName(e.target.value)}
                    placeholder="اسم الصنف المراد صرفه..."
                    className="form-input-themed"
                  />
                )}
              </label>
            </div>

            {currentItem && (
              <div className="custody-balance-badge">
                <span>الرصيد المتوفر في {sourceWh.shortName}: <strong>{availableQty} {currentItem.unit}</strong></span>
                <span className="text-muted">سعر الوحدة المقدر: {formatCurrency(currentItem.unitPrice || 0, currency)}</span>
              </div>
            )}

            <div className="form-label-block">
              <span>نوع الوجهة المستلمة:</span>
              <div className="radio-group-row">
                <label className="radio-label-inline">
                  <input
                    type="radio"
                    name="destType"
                    checked={destType === 'warehouse'}
                    onChange={() => setDestType('warehouse')}
                  />
                  <span>مخزن فرعي / كلية</span>
                </label>
                <label className="radio-label-inline">
                  <input
                    type="radio"
                    name="destType"
                    checked={destType === 'custodian'}
                    onChange={() => setDestType('custodian')}
                  />
                  <span>أمين عهدة / موظف محدد</span>
                </label>
              </div>
            </div>

            {destType === 'warehouse' ? (
              <label className="form-label-block">
                المخزن المستلم (الكلية):
                <select
                  value={destWarehouseId}
                  onChange={(e) => setDestWarehouseId(e.target.value)}
                  className="form-input-themed"
                >
                  {WAREHOUSES.filter((w) => w.id !== sourceWarehouseId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="form-label-block">
                اسم أمين العهدة / الموظف المستلم:
                <input
                  type="text"
                  value={custodianName}
                  onChange={(e) => setCustodianName(e.target.value)}
                  placeholder="مثال: د. أحمد مصطفى / معمل الحاسب..."
                  className="form-input-themed"
                  required
                />
              </label>
            )}

            <div className="form-grid-3col">
              <label className="form-label-block">
                الكمية المنصرفة:
                <input
                  type="number"
                  min={1}
                  max={availableQty > 0 ? availableQty : undefined}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="form-input-themed"
                  required
                />
              </label>

              <label className="form-label-block">
                سعر الوحدة ({currency}):
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(Number(e.target.value))}
                  className="form-input-themed"
                />
              </label>

              <label className="form-label-block">
                تاريخ الصرف:
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="form-input-themed"
                  required
                />
              </label>
            </div>

            <div className="form-grid-2col">
              <label className="form-label-block">
                رقم إذن الصرف / المستند:
                <input
                  type="text"
                  value={permitNo}
                  onChange={(e) => setPermitNo(e.target.value)}
                  className="form-input-themed"
                />
              </label>

              <label className="form-label-block">
                الغرض / ملاحظات الصرف:
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: تجهيز معمل الذكاء الاصطناعي للعام الجديد..."
                  className="form-input-themed"
                />
              </label>
            </div>

            <div className="modal-summary-box">
              <span>إجمالي قيمة إذن الصرف:</span>
              <span className="text-accent text-base font-bold">{formatCurrency(quantity * unitPrice, currency)}</span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-btn" onClick={onClose} disabled={isSubmitting}>
              إلغاء
            </button>
            <button type="submit" className="primary-btn" disabled={isSubmitting} id="btn-submit-new-disbursement">
              <CheckCircle2 size={17} />
              <span>{isSubmitting ? 'جاري الصرف والتحويل...' : 'اعتماد وحفظ إذن الصرف'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


