/**
 * src/lib/procurementRepository.ts
 *
 * مستودع طلبات الشراء، عروض الأسعار، وأوامر الشراء.
 * يعتمد على استدعاءات Supabase والدوال الذرية RPC مباشرة بدون داتا وهمية.
 */

import { supabase } from './supabase'
import type { FixtureMovement } from './fixture'
import { normalizeArabicName } from './arabicUtils'

const LOCAL_STORAGE_KEY_PR = 'warehouse_purchase_requests_cache'

export function getLocalPurchaseRequests(): PurchaseRequest[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_PR)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveLocalPurchaseRequests(items: PurchaseRequest[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_PR, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export type PurchaseType = 'direct' | 'practice' | 'tender'
export type PurchasePriority = 'normal' | 'urgent'
export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected'
export type ApprovalDecision = 'pending' | 'approved' | 'rejected'
export type PurchaseOrderStatus = 'open' | 'received' | 'invoiced' | 'cancelled'

export interface PurchaseRequestItem {
  id?: string
  request_id?: string
  item_name: string
  specifications?: string
  quantity: number
  unit: string
  estimated_price?: number
  estimated_unit_price?: number
  estimated_total?: number
  custody_item_ref?: string | null
  created_at?: string
}

export interface PurchaseRequestApproval {
  id: string
  request_id: string
  step_no: number
  step_name: string
  approver_name?: string
  decision: ApprovalDecision
  decided_by: string | null
  decided_at: string | null
  notes?: string | null
  note?: string
  created_at?: string
}

export interface PurchaseRequest {
  id: string
  request_no: string
  department: string
  purchase_type: PurchaseType
  budget_line: string
  priority: PurchasePriority
  needed_by: string | null
  requested_by: string
  justification: string
  status: PurchaseRequestStatus
  quote_deadline: string | null
  selected_quote_id: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  created_by: string
  created_by_id?: string | null
  items_count?: number
  total_estimated_value?: number
  items_summary?: string
  items?: PurchaseRequestItem[]
  approvals?: PurchaseRequestApproval[]
}

export interface SupplierQuote {
  id: string
  request_id: string
  supplier_id: string
  supplier_name?: string
  supplier_status?: string
  supplier_rating?: number | null
  total_price: number
  delivery_days: number
  payment_terms: string
  warranty_months: number
  notes: string
  is_selected?: boolean
  created_at: string
  created_by: string
}

export interface PurchaseOrder {
  id: string
  po_no: string
  request_id: string
  request_no?: string
  department?: string
  quote_id: string
  supplier_id: string
  supplier_name?: string
  total: number
  expected_delivery_date: string | null
  status: PurchaseOrderStatus
  received_on: string | null
  invoiced_on: string | null
  notes: string
  created_at: string
  created_by: string
}

/**
 * جلب قائمة طلبات الشراء
 */
export async function fetchPurchaseRequests(): Promise<PurchaseRequest[]> {
  if (!supabase) return getLocalPurchaseRequests()

  try {
    const { data: requests, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        items:purchase_request_items(*),
        approvals:purchase_request_approvals(*)
      `)
      .order('created_at', { ascending: false })

    if (error || !requests) return getLocalPurchaseRequests()

    const mapped = requests.map((r) => {
      const items = (r.items || []) as PurchaseRequestItem[]
      const total_estimated_value = items.reduce(
        (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_price || item.estimated_unit_price) || 0),
        0
      )
      let items_summary = '—'
      if (items.length === 1) {
        items_summary = items[0].item_name
      } else if (items.length > 1) {
        items_summary = `${items[0].item_name} و ${items.length - 1} أخرى`
      }

      return {
        ...r,
        items,
        approvals: (r.approvals || []).sort((a: PurchaseRequestApproval, b: PurchaseRequestApproval) => a.step_no - b.step_no),
        total_estimated_value,
        items_summary,
      }
    })
    saveLocalPurchaseRequests(mapped)
    return mapped
  } catch {
    return getLocalPurchaseRequests()
  }
}

/**
 * جلب تفاصيل طلب شراء محدد
 */
export async function fetchPurchaseRequestById(id: string): Promise<PurchaseRequest | null> {
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        items:purchase_request_items(*),
        approvals:purchase_request_approvals(*)
      `)
      .eq('id', id)
      .single()

    if (error || !data) return null

    const items = (data.items || []) as PurchaseRequestItem[]
    const total_estimated_value = items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_price || item.estimated_unit_price) || 0),
      0
    )

    return {
      ...data,
      items,
      approvals: (data.approvals || []).sort((a: PurchaseRequestApproval, b: PurchaseRequestApproval) => a.step_no - b.step_no),
      total_estimated_value,
    }
  } catch {
    return null
  }
}

/**
 * إنشاء طلب شراء جديد
 */
export async function createPurchaseRequest(
  payload: {
    department: string
    purchase_type: PurchaseType
    budget_line?: string
    priority: PurchasePriority
    needed_by?: string | null
    requested_by: string
    justification: string
    created_by: string
    created_by_id?: string | null
  },
  items: Array<{
    item_name: string
    quantity: number
    unit: string
    estimated_price: number
    custody_item_ref?: string | null
  }>,
  submitImmediately = false
): Promise<PurchaseRequest> {
  if (!payload.department || !payload.department.trim()) {
    throw new Error('يرجى تحديد أو كتابة اسم القسم الطالب.')
  }
  if (!payload.justification || !payload.justification.trim()) {
    throw new Error('يرجى توضيح مبررات وأسباب طلب الشراء.')
  }
  if (!items || items.length === 0) {
    throw new Error('يجب إضافة بند واحد على الأقل في طلب الشراء.')
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    if (!item.item_name || !item.item_name.trim()) {
      throw new Error(`البند رقم ${idx + 1}: اسم الصنف مطلوب.`)
    }
    if (!item.quantity || Number(item.quantity) <= 0) {
      throw new Error(`البند رقم ${idx + 1} (${item.item_name}): الكمية يجب أن تكون أكبر من صفر.`)
    }
    if (Number(item.estimated_price) < 0) {
      throw new Error(`البند رقم ${idx + 1} (${item.item_name}): السعر التقديري لا يمكن أن يكون سالباً.`)
    }
  }

  if (!supabase) {
    throw new Error('اتصال قاعدة البيانات غير متوفر.')
  }

  const { data: createdReq, error: reqErr } = await supabase
    .from('purchase_requests')
    .insert([
      {
        department: payload.department.trim(),
        purchase_type: payload.purchase_type,
        budget_line: (payload.budget_line || '').trim(),
        priority: payload.priority,
        needed_by: payload.needed_by || null,
        requested_by: payload.requested_by.trim(),
        justification: payload.justification.trim(),
        created_by: payload.created_by.trim(),
        created_by_id: payload.created_by_id || null,
        status: 'draft',
      },
    ])
    .select()
    .single()

  if (reqErr || !createdReq) {
    throw new Error(reqErr?.message || 'تعذر إنشاء طلب الشراء.')
  }

  const itemsToInsert = items.map((i) => ({
    request_id: createdReq.id,
    item_name: i.item_name.trim(),
    quantity: Number(i.quantity),
    unit: i.unit.trim() || 'قطعة',
    estimated_price: Number(i.estimated_price) || 0,
    custody_item_ref: i.custody_item_ref || null,
  }))

  const { error: itemsErr } = await supabase
    .from('purchase_request_items')
    .insert(itemsToInsert)

  if (itemsErr) {
    throw new Error(itemsErr.message || 'تعذر إضافة بنود طلب الشراء.')
  }

  let resultReq: PurchaseRequest = createdReq
  if (submitImmediately) {
    try {
      await submitPurchaseRequestRpc(createdReq.id)
      const updated = await fetchPurchaseRequestById(createdReq.id)
      if (updated) resultReq = updated
    } catch {
      // ignore
    }
  }

  if (!resultReq.items_summary) {
    resultReq.items = items.map((i, idx) => ({
      id: `it-${Date.now()}-${idx}`,
      request_id: resultReq.id,
      item_name: i.item_name,
      quantity: i.quantity,
      unit: i.unit,
      estimated_price: i.estimated_price,
    }))
    resultReq.total_estimated_value = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.estimated_price) || 0), 0)
    resultReq.items_summary = items.length === 1 ? items[0].item_name : `${items[0].item_name} و ${items.length - 1} أخرى`
  }

  const localList = getLocalPurchaseRequests()
  saveLocalPurchaseRequests([resultReq, ...localList.filter((r) => r.id !== resultReq.id)])
  return resultReq
}

/**
 * تعديل مسودة طلب شراء
 */
export async function updatePurchaseRequestDraft(
  id: string,
  payload: Partial<PurchaseRequest>,
  items?: Array<{
    item_name: string
    quantity: number
    unit: string
    estimated_price?: number
    custody_item_ref?: string | null
  }>
): Promise<PurchaseRequest> {
  if (!supabase) throw new Error('اتصال قاعدة البيانات غير متوفر.')

  const { data: current, error: checkErr } = await supabase
    .from('purchase_requests')
    .select('status')
    .eq('id', id)
    .single()

  if (checkErr) throw new Error(checkErr.message || 'تعذر التحقق من حالة الطلب.')

  if (current?.status && current.status !== 'draft') {
    throw new Error('لا يمكن تعديل الطلب إلا وهو في حالة مسودة (draft).')
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (payload.department !== undefined) updateData.department = payload.department.trim()
  if (payload.purchase_type !== undefined) updateData.purchase_type = payload.purchase_type
  if (payload.budget_line !== undefined) updateData.budget_line = payload.budget_line
  if (payload.priority !== undefined) updateData.priority = payload.priority
  if (payload.needed_by !== undefined) updateData.needed_by = payload.needed_by
  if (payload.requested_by !== undefined) updateData.requested_by = payload.requested_by
  if (payload.justification !== undefined) updateData.justification = payload.justification

  const { data: updatedReq, error: updateErr } = await supabase
    .from('purchase_requests')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (updateErr) throw new Error(updateErr.message || 'تعذر تحديث طلب الشراء.')

  if (items && items.length > 0) {
    await supabase.from('purchase_request_items').delete().eq('request_id', id)
    const itemsToInsert = items.map((i) => ({
      request_id: id,
      item_name: i.item_name.trim(),
      quantity: Number(i.quantity),
      unit: i.unit.trim() || 'قطعة',
      estimated_price: Number(i.estimated_price) || 0,
      custody_item_ref: i.custody_item_ref || null,
    }))
    await supabase.from('purchase_request_items').insert(itemsToInsert)
  }

  const finalReq = await fetchPurchaseRequestById(id)
  return finalReq || (updatedReq as PurchaseRequest)
}

/**
 * إرسال طلب الشراء للاعتماد عبر RPC
 */
export async function submitPurchaseRequestRpc(requestId: string): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('submit_purchase_request', {
    p_request_id: requestId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر إرسال طلب الشراء للاعتماد.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت عملية إرسال الطلب.')
  }
}

/**
 * تسجيل قرار اعتماد / رفض عبر RPC
 */
export async function recordApprovalRpc(
  requestId: string,
  stepNo: number,
  decision: 'approved' | 'rejected',
  note = ''
): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('record_approval', {
    p_request_id: requestId,
    p_step_no: stepNo,
    p_decision: decision,
    p_note: note.trim(),
  })

  if (error) {
    throw new Error(error.message || 'تعذر تسجيل قرار الاعتماد.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت عملية تسجيل القرار.')
  }
}

/**
 * حذف مسودة طلب الشراء
 */
export async function deletePurchaseRequest(requestId: string): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('purchase_requests')
    .delete()
    .eq('id', requestId)

  if (error) {
    throw new Error(error.message || 'تعذر حذف طلب الشراء.')
  }
}

/**
 * جلب عروض الأسعار المرتبطة بطلب شراء معين
 */
export async function fetchSupplierQuotes(requestId: string): Promise<SupplierQuote[]> {
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from('supplier_quotes')
      .select(`
        *,
        supplier:suppliers(name, status, rating)
      `)
      .eq('request_id', requestId)
      .order('total_price', { ascending: true })

    if (error || !data) return []

    return data.map((q) => ({
      ...q,
      supplier_name: q.supplier?.name || 'مورد غير معروف',
      supplier_status: q.supplier?.status || 'active',
      supplier_rating: q.supplier?.rating,
    }))
  } catch {
    return []
  }
}

/**
 * تسجيل عرض سعر جديد من مورد
 */
export async function createSupplierQuote(payload: {
  request_id: string
  supplier_id: string
  total_price: number
  delivery_days: number
  payment_terms?: string
  warranty_months?: number
  notes?: string
  created_by?: string
}): Promise<SupplierQuote> {
  if (!payload.supplier_id) {
    throw new Error('يرجى تحديد المورد مقدم العرض.')
  }
  if (Number(payload.total_price) < 0) {
    throw new Error('إجمالي السعر لا يمكن أن يكون سالباً.')
  }
  if (Number(payload.delivery_days) < 0) {
    throw new Error('مدة التوريد لا يمكن أن تكون سالبة.')
  }

  if (!supabase) throw new Error('اتصال قاعدة البيانات غير متوفر.')

  const { data, error } = await supabase
    .from('supplier_quotes')
    .insert([
      {
        request_id: payload.request_id,
        supplier_id: payload.supplier_id,
        total_price: Number(payload.total_price),
        delivery_days: Number(payload.delivery_days) || 0,
        payment_terms: (payload.payment_terms || '').trim(),
        warranty_months: Number(payload.warranty_months) || 0,
        notes: (payload.notes || '').trim(),
        created_by: payload.created_by || '',
      },
    ])
    .select()
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'تعذر تسجيل عرض السعر.')
  }

  return data as SupplierQuote
}

/**
 * اختيار العرض الفائز وترسيته عبر RPC
 */
export async function selectQuoteRpc(requestId: string, quoteId: string): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('select_quote', {
    p_request_id: requestId,
    p_quote_id: quoteId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر ترسية عرض السعر.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت عملية الترسية.')
  }
}

/**
 * إصدار أمر شراء رسمي عبر RPC
 */
export async function createPurchaseOrderRpc(quoteId: string): Promise<{ po_id: string; po_no: string }> {
  if (!supabase) throw new Error('اتصال قاعدة البيانات غير متوفر.')

  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_quote_id: quoteId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر إصدار أمر الشراء.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت عملية إصدار أمر الشراء.')
  }

  return {
    po_id: data.po_id,
    po_no: data.po_no,
  }
}

/**
 * جلب قائمة أوامر الشراء الصادرة
 */
export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        request:purchase_requests(request_no, department),
        supplier:suppliers(name)
      `)
      .order('created_at', { ascending: false })

    if (error || !data) return []

    return data.map((po) => ({
      ...po,
      request_no: po.request?.request_no,
      department: po.request?.department,
      supplier_name: po.supplier?.name || 'مورد غير محدد',
    }))
  } catch {
    return []
  }
}

/**
 * تحديث حالة أمر الشراء إلى "تم الاستلام" عبر RPC
 */
export async function markPoReceivedRpc(poId: string): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('mark_po_received', {
    p_po_id: poId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر تحديث حالة استلام أمر الشراء.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت العملية.')
  }
}

/**
 * تحديث حالة أمر الشراء إلى "مفوتر" عبر RPC
 */
export async function markPoInvoicedRpc(poId: string): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('mark_po_invoiced', {
    p_po_id: poId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر تحديث حالة فوترة أمر الشراء.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت العملية.')
  }
}

/**
 * اقتراح آخر سعر شراء لصنف معين من سجل حركات المخزن
 */
export function suggestLastPurchasePrice(itemName: string, movements: FixtureMovement[]): number | null {
  const targetKey = normalizeArabicName(itemName)
  if (!targetKey) return null

  for (let idx = movements.length - 1; idx >= 0; idx--) {
    const m = movements[idx]
    const qin = Number(m.qin) || 0
    if (qin <= 0) continue

    const currentKey = normalizeArabicName(m.item || '')
    if (currentKey === targetKey) {
      const price = Number(m.price) || 0
      if (price > 0) return price
    }
  }

  return null
}
