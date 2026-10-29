/**
 * src/lib/chatbotLiveContext.ts
 *
 * مزامنة بيانات الشات بوت المباشرة مع قاعدة البيانات (Supabase & Local):
 * العهدة، الحركات، طلبات الصرف، العقود، والميزانية.
 */

import { loadCustodyItems, WAREHOUSES, type CustodyItem } from './custody'
import { fetchDisbursementRequests, type DisbursementRequest } from './disbursementRequestsRepository'
import { fetchContracts, type SupplierContract } from './contractsRepository'
import { fetchBudgetPlans, type BudgetPlan } from './budgetRepository'
import { fetchMovements } from './movementsRepository'
import type { FixtureMovement } from './fixture'

export type LiveWarehouseContext = {
  totalItemsCount: number
  totalCustodyUnits: number
  totalCustodyValue: number
  warehouses: Array<{
    id: string
    name: string
    itemsCount: number
    totalUnits: number
    itemsSample: string[]
  }>
  pendingRequestsCount: number
  pendingRequests: Array<{
    requestNumber: string
    item: string
    dept: string
    qty: number
  }>
  activeContractsCount: number
  expiringContractsCount: number
  contractsSample: Array<{
    title: string
    supplier: string
    value: number
    endDate: string
  }>
  budgetOverview: Array<{
    dept: string
    allocated: number
    spent: number
    remaining: number
  }>
  recentMovements: Array<{
    item: string
    date: string
    type: 'in' | 'out'
    qty: number
    party: string
  }>
}

/**
 * جمع لقطة بيانات حية ومباشرة من قاعدة البيانات لتغذية الشات بوت ونموذج Gemini
 */
export async function getLiveWarehouseContext(): Promise<LiveWarehouseContext> {
  // 1. العهدة والأصناف
  let custodyList: CustodyItem[] = []
  try {
    custodyList = loadCustodyItems()
  } catch {
    custodyList = []
  }

  const totalCustodyUnits = custodyList.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
  const totalCustodyValue = custodyList.reduce((sum, i) => sum + (Number(i.value) || 0), 0)

  const warehouseStats = WAREHOUSES.map((w) => {
    const items = custodyList.filter((i) => i.warehouseId === w.id)
    return {
      id: w.id,
      name: w.name,
      itemsCount: items.length,
      totalUnits: items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
      itemsSample: items.slice(0, 5).map((i) => `${i.name} (${i.quantity} قطعة)`),
    }
  })

  // 2. طلبات الصرف
  let requests: DisbursementRequest[] = []
  try {
    requests = await fetchDisbursementRequests()
  } catch {
    requests = []
  }
  const pendingRequests = requests.filter((r) => r.status === 'pending')

  // 3. العقود
  let contracts: SupplierContract[] = []
  try {
    contracts = await fetchContracts()
  } catch {
    contracts = []
  }
  const activeContracts = contracts.filter((c) => c.status === 'active')
  const now = Date.now()
  const expiringContracts = activeContracts.filter((c) => {
    const diff = Math.ceil((new Date(c.end_date).getTime() - now) / (1000 * 60 * 60 * 24))
    return diff <= 30 && diff >= 0
  })

  // 4. الميزانية
  let budgets: BudgetPlan[] = []
  try {
    budgets = await fetchBudgetPlans(2026)
  } catch {
    budgets = []
  }

  // 5. أحدث الحركات
  let recentMovementsData: Array<{
    item: string
    date: string
    type: 'in' | 'out'
    qty: number
    party: string
  }> = []
  try {
    const moves = await fetchMovements()
    recentMovementsData = (moves as FixtureMovement[]).slice(-8).reverse().map((m) => {
      const qin = Number(m.qin) || 0
      const qout = Number(m.qout) || 0
      return {
        item: m.item,
        date: m.date || 'مؤخراً',
        type: qin > 0 ? ('in' as const) : ('out' as const),
        qty: qin > 0 ? qin : qout,
        party: qin > 0 ? (m.from || 'مورد') : (m.to || 'كلية'),
      }
    })
  } catch {
    recentMovementsData = []
  }

  return {
    totalItemsCount: custodyList.length,
    totalCustodyUnits,
    totalCustodyValue,
    warehouses: warehouseStats,
    pendingRequestsCount: pendingRequests.length,
    pendingRequests: pendingRequests.slice(0, 6).map((r) => ({
      requestNumber: r.request_number,
      item: r.item_name,
      dept: r.requester_department,
      qty: r.quantity_requested,
    })),
    activeContractsCount: activeContracts.length,
    expiringContractsCount: expiringContracts.length,
    contractsSample: activeContracts.slice(0, 5).map((c) => ({
      title: c.contract_title,
      supplier: c.supplier_name,
      value: c.contract_value,
      endDate: c.end_date,
    })),
    budgetOverview: budgets.slice(0, 6).map((b) => ({
      dept: b.department,
      allocated: b.allocated_amount,
      spent: b.spent_amount,
      remaining: b.remaining_amount,
    })),
    recentMovements: recentMovementsData,
  }
}

/**
 * فحص سريع لتوافر صنف معين مباشرة من قاعدة البيانات المحدثة
 */
export function queryLiveItemAvailability(itemName: string): string | null {
  try {
    const custodyList = loadCustodyItems()
    const cleanSearch = itemName.trim().toLowerCase()
    
    // تجنب المطابقة إذا كان البحث عاماً جداً أو يخص المخازن عموماً
    if (cleanSearch.includes('مخازن') || cleanSearch.includes('كليات') || cleanSearch.length < 2) {
      return null
    }

    const matches = custodyList.filter((i) =>
      i.name.toLowerCase().includes(cleanSearch)
    )

    if (matches.length === 0) return null

    let reply = `🔍 **نتائج الاستعلام الحي عن الصنف «${itemName}» بقاعدة البيانات:**\n`
    let totalFound = 0

    matches.forEach((item) => {
      totalFound += Number(item.quantity) || 0
      const wh = WAREHOUSES.find((w) => w.id === item.warehouseId)
      const whName = wh ? wh.name : item.warehouseId
      reply += `- **${item.name}**: رصيد متاح **(${item.quantity} وحدة)** في **${whName}** (الموقع: ${item.roomLocation || 'المخزن الرئيسي'}).\n`
    })

    reply += `\n📊 إجمالي الوحدات المتوفرة حالياً بالمنظومة: **${totalFound} وحدة**.`
    return reply
  } catch {
    return null
  }
}

/**
 * استعلام فوري فائق السرعة عن أرصدة المخازن والكليات الـ 8 من البيانات المحدثة
 */
export function queryLiveWarehouseBalances(): string {
  try {
    const custodyList = loadCustodyItems()
    const totalUnits = custodyList.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
    const totalValue = custodyList.reduce((sum, i) => sum + (Number(i.value) || 0), 0)

    let reply = `🏢 **أرصدة مخازن وكليات جامعة الزقازيق الأهلية (8 مخازن متزامنة لحظياً):**\n\n`

    WAREHOUSES.forEach((w) => {
      const items = custodyList.filter((i) => i.warehouseId === w.id)
      const units = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
      reply += `📍 **${w.name}** (${w.shortName}):\n`
      reply += `   - عدد الأصناف: **${items.length} صنف** | إجمالي الرصيد: **${units.toLocaleString('ar-EG')} وحدة**\n`
      if (items.length > 0) {
        const sample = items.slice(0, 3).map((it) => `${it.name} (${it.quantity})`).join('، ')
        reply += `   - أبرز العهد: ${sample}\n`
      } else {
        reply += `   - الرصيد الحالي: لا توجد أصناف مقيدة حالياً أو بانتظار التوريد.\n`
      }
      reply += `\n`
    })

    reply += `📊 **الإجمالي العام للجامعة:**\n`
    reply += `- إجمالي الأصناف المسجلة: **${custodyList.length} صنف**\n`
    reply += `- إجمالي وحدات العهدة: **${totalUnits.toLocaleString('ar-EG')} وحدة**\n`
    reply += `- القيمة التقديرية الإجمالية: **${totalValue.toLocaleString('ar-EG')} جنيه مصري**`

    return reply
  } catch {
    return 'تعذر قراءة أرصدة المخازن لحظياً، يُرجى المحاولة بعد قليل.'
  }
}

