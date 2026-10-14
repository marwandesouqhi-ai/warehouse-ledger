/**
 * src/lib/procurementRepository.ts
 *
 * مستودع طلبات الشراء، بنودها، دورة الاعتمادات، عروض الأسعار، وأوامر الشراء.
 * يعتمد على استدعاءات Supabase والدوال الذرية RPC.
 */

import { supabase } from './supabase'
import type { FixtureMovement } from './fixture'
import { normalizeArabicName } from './arabicUtils'

export type PurchaseType = 'direct' | 'practice' | 'tender'
export type PurchasePriority = 'normal' | 'urgent'
export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected'
export type ApprovalDecision = 'pending' | 'approved' | 'rejected'
export type PurchaseOrderStatus = 'open' | 'received' | 'invoiced' | 'cancelled'

export interface PurchaseRequestItem {
  id?: string
  request_id?: string
  item_name: string
  quantity: number
  unit: string
  estimated_price: number
  custody_item_ref?: string | null
  created_at?: string
}

export interface PurchaseRequestApproval {
  id: string
  request_id: string
  step_no: number
  step_name: string
  approver_name: string
  decision: ApprovalDecision
  decided_by: string
  decided_at: string | null
  note: string
  created_at: string
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
  // Aggregated fields
  items?: PurchaseRequestItem[]
  approvals?: PurchaseRequestApproval[]
  total_estimated_value?: number
  items_summary?: string
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
  received_on: string
  notes: string
  is_selected: boolean
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
 * جلب قائمة طلبات الشراء مع حساب الإجمالي ودمج أسماء البنود
 */
export async function fetchPurchaseRequests(): Promise<PurchaseRequest[]> {
  if (!supabase) return []

  const { data: requests, error } = await supabase
    .from('purchase_requests')
    .select(`
      *,
      items:purchase_request_items(*),
      approvals:purchase_request_approvals(*)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'تعذر تحميل طلبات الشراء من السحابة.')
  }

  return (requests || []).map((r) => {
    const items = (r.items || []) as PurchaseRequestItem[]
    const total_estimated_value = items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_price) || 0),
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
}

/**
 * جلب تفاصيل طلب شراء محدد بالمعرف
 */
export async function fetchPurchaseRequestById(id: string): Promise<PurchaseRequest | null> {
  if (!supabase) return null

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
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_price) || 0),
    0
  )

  return {
    ...data,
    items,
    approvals: (data.approvals || []).sort((a: PurchaseRequestApproval, b: PurchaseRequestApproval) => a.step_no - b.step_no),
    total_estimated_value,
  }
}

/**
 * إنشاء طلب شراء جديد (مسودة أو إرسال فوري)
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
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  if (!payload.department.trim()) throw new Error('يرجى تحديد أو كتابة اسم القسم الطالب.')
  if (items.length === 0) throw new Error('يجب إضافة بند واحد على الأقل في طلب الشراء.')
  for (const item of items) {
    if (!item.item_name.trim()) throw new Error('اسم الصنف مطلوب لكل البنود.')
    if (item.quantity <= 0) throw new Error(`الكمية للصنف «${item.item_name}» يجب أن تكون أكبر من صفر.`)
  }

  // 1. إدراج رأس الطلب
  const reqData = {
    department: payload.department.trim(),
    purchase_type: payload.purchase_type,
    budget_line: (payload.budget_line || '').trim(),
    priority: payload.priority,
    needed_by: payload.needed_by || null,
    requested_by: payload.requested_by.trim(),
    justification: payload.justification.trim(),
    status: 'draft',
    created_by: payload.created_by,
    created_by_id: payload.created_by_id || null,
  }

  const { data: createdReq, error: reqErr } = await supabase
    .from('purchase_requests')
    .insert([reqData])
    .select()
    .single()

  if (reqErr || !createdReq) {
    throw new Error(reqErr?.message || 'تعذر إنشاء طلب الشراء.')
  }

  // 2. إدراج بنود الطلب
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

  // 3. الإرسال الفوري إذا تم اختياره
  if (submitImmediately) {
    await submitPurchaseRequestRpc(createdReq.id)
    const updated = await fetchPurchaseRequestById(createdReq.id)
    return updated || createdReq
  }

  return createdReq
}

/**
 * تحديث مسودة طلب الشراء وبنودها
 */
export async function updatePurchaseRequestDraft(
  id: string,
  payload: {
    department?: string
    purchase_type?: PurchaseType
    budget_line?: string
    priority?: PurchasePriority
    needed_by?: string | null
    justification?: string
  },
  items?: Array<{
    item_name: string
    quantity: number
    unit: string
    estimated_price: number
    custody_item_ref?: string | null
  }>
): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  // التأكد أولاً من أن الطلب مسودة
  const { data: current } = await supabase
    .from('purchase_requests')
    .select('status')
    .eq('id', id)
    .single()

  if (!current || current.status !== 'draft') {
    throw new Error('لا يمكن تعديل الطلب إلا وهو في حالة مسودة (Draft).')
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.department !== undefined) updates.department = payload.department.trim()
  if (payload.purchase_type !== undefined) updates.purchase_type = payload.purchase_type
  if (payload.budget_line !== undefined) updates.budget_line = payload.budget_line.trim()
  if (payload.priority !== undefined) updates.priority = payload.priority
  if (payload.needed_by !== undefined) updates.needed_by = payload.needed_by
  if (payload.justification !== undefined) updates.justification = payload.justification.trim()

  const { error: updateErr } = await supabase
    .from('purchase_requests')
    .update(updates)
    .eq('id', id)

  if (updateErr) throw new Error(updateErr.message || 'تعذر تحديث طلب الشراء.')

  // إذا تم تمرير بنود جديدة، نستبدلها
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
}

/**
 * استدعاء RPC لإرسال طلب الشراء للاعتماد
 */
export async function submitPurchaseRequestRpc(requestId: string): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

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
 * استدعاء RPC لتسجيل قرار اعتماد / رفض في مسار الموافقة
 */
export async function recordApprovalRpc(
  requestId: string,
  stepNo: number,
  decision: 'approved' | 'rejected',
  note = ''
): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

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
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

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

  const { data, error } = await supabase
    .from('supplier_quotes')
    .select(`
      *,
      supplier:suppliers(name, status, rating)
    `)
    .eq('request_id', requestId)
    .order('total_price', { ascending: true })

  if (error) {
    throw new Error(error.message || 'تعذر تحميل عروض الأسعار.')
  }

  return (data || []).map((q) => ({
    ...q,
    supplier_name: q.supplier?.name || 'مورد غير معروف',
    supplier_status: q.supplier?.status || 'active',
    supplier_rating: q.supplier?.rating,
  }))
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
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  if (payload.total_price < 0) throw new Error('إجمالي السعر لا يمكن أن يكون سالباً.')
  if (payload.delivery_days < 0) throw new Error('مدة التوريد لا يمكن أن تكون سالبة.')

  const { data, error } = await supabase
    .from('supplier_quotes')
    .insert([{
      request_id: payload.request_id,
      supplier_id: payload.supplier_id,
      total_price: payload.total_price,
      delivery_days: payload.delivery_days,
      payment_terms: (payload.payment_terms || '').trim(),
      warranty_months: payload.warranty_months || 0,
      notes: (payload.notes || '').trim(),
      created_by: payload.created_by || '',
    }])
    .select()
    .single()

  if (error) {
    throw new Error(error.message || 'تعذر تسجيل عرض السعر.')
  }

  return data as SupplierQuote
}

/**
 * اختيار عرض سعر محدد لطلب شراء عبر RPC select_quote
 */
export async function selectQuoteRpc(requestId: string, quoteId: string): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { data, error } = await supabase.rpc('select_quote', {
    p_request_id: requestId,
    p_quote_id: quoteId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر اختيار عرض السعر.')
  }

  if (data && data.success === false) {
    throw new Error(data.message || 'فشلت عملية اختيار العرض.')
  }
}

/**
 * إصدار أمر شراء من العرض المختار عبر RPC create_purchase_order
 */
export async function createPurchaseOrderRpc(quoteId: string): Promise<{ po_id: string; po_no: string }> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_quote_id: quoteId,
  })

  if (error) {
    throw new Error(error.message || 'تعذر إنشاء أمر الشراء.')
  }

  return { po_id: data.po_id, po_no: data.po_no }
}

/**
 * جلب قائمة أوامر الشراء
 */
export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      request:purchase_requests(request_no, department),
      supplier:suppliers(name)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'تعذر جلب أوامر الشراء.')
  }

  return (data || []).map((p) => ({
    ...p,
    request_no: p.request?.request_no || '—',
    department: p.request?.department || '—',
    supplier_name: p.supplier?.name || 'مورد غير معروف',
  }))
}

/**
 * تعليم أمر الشراء كمستلم (بدون أثر على المخزون)
 */
export async function markPoReceivedRpc(poId: string): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { error } = await supabase.rpc('mark_po_received', { p_po_id: poId })
  if (error) throw new Error(error.message || 'تعذر تحديث حالة أمر الشراء إلى مستلم.')
}

/**
 * تعليم أمر الشراء كمفوتر (بدون أثر على المخزون)
 */
export async function markPoInvoicedRpc(poId: string): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { error } = await supabase.rpc('mark_po_invoiced', { p_po_id: poId })
  if (error) throw new Error(error.message || 'تعذر تحديث حالة أمر الشراء إلى مفوتر.')
}

/**
 * اقتراح آخر سعر شراء لصنف من الحركات التاريخية والجديدة
 */
export function suggestLastPurchasePrice(itemName: string, movements: FixtureMovement[]): number | null {
  if (!itemName.trim() || movements.length === 0) return null
  const cleanTarget = normalizeArabicName(itemName)

  // نبحث من الأحدث للأقدم
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i]
    if ((Number(m.qin) || 0) > 0 && normalizeArabicName(m.item) === cleanTarget) {
      const price = Number(m.price)
      if (!isNaN(price) && price > 0) return price
    }
  }

  return null
}
