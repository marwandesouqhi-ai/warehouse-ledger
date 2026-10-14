/**
 * src/lib/procurementRepository.ts
 *
 * مستودع طلبات الشراء، بنودها، دورة الاعتمادات، عروض الأسعار، وأوامر الشراء.
 * يعتمد على استدعاءات Supabase والدوال الذرية RPC مع دعم الوضع التجريبي المحلي
 * التلقائي في حال عدم تطبيق المايجريشن بعد.
 */

import { supabase } from './supabase'
import type { FixtureMovement } from './fixture'
import { normalizeArabicName } from './arabicUtils'
import {
  isTableMissingError,
  setCloudTableMissing,
  isCloudTableMissing,
  loadDemoRequests,
  saveDemoRequests,
  loadDemoQuotes,
  saveDemoQuotes,
  loadDemoOrders,
  saveDemoOrders,
  loadDemoSuppliers,
} from './demoProcurementData'
import { DEFAULT_APPROVAL_PATH } from './approvalPaths'

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
  // Aggregated fields
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
 * جلب قائمة طلبات الشراء مع حساب الإجمالي ودمج أسماء البنود
 */
export async function fetchPurchaseRequests(): Promise<PurchaseRequest[]> {
  if (!supabase) return loadDemoRequests()

  try {
    const { data: requests, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        items:purchase_request_items(*),
        approvals:purchase_request_approvals(*)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return loadDemoRequests()
      }
      throw new Error(error.message || 'تعذر تحميل طلبات الشراء من السحابة.')
    }

    setCloudTableMissing(false)
    return (requests || []).map((r) => {
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
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoRequests()
    }
    throw err
  }
}

/**
 * جلب تفاصيل طلب شراء محدد بالمعرف
 */
export async function fetchPurchaseRequestById(id: string): Promise<PurchaseRequest | null> {
  if (!supabase) {
    return loadDemoRequests().find((r) => r.id === id) || null
  }

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

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return loadDemoRequests().find((r) => r.id === id) || null
      }
      return null
    }

    if (!data) return null

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
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoRequests().find((r) => r.id === id) || null
    }
    return null
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
  if (!payload.department.trim()) throw new Error('يرجى تحديد أو كتابة اسم القسم الطالب.')
  if (items.length === 0) throw new Error('يجب إضافة بند واحد على الأقل في طلب الشراء.')
  for (const item of items) {
    if (!item.item_name.trim()) throw new Error('اسم الصنف مطلوب لكل البنود.')
    if (item.quantity <= 0) throw new Error(`الكمية للصنف «${item.item_name}» يجب أن تكون أكبر من صفر.`)
  }

  // Fallback إذا كان في وضع Demo
  if (!supabase) {
    return createDemoRequestLocal(payload, items, submitImmediately)
  }

  try {
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

    if (reqErr) {
      if (isTableMissingError(reqErr)) {
        setCloudTableMissing(true)
        return createDemoRequestLocal(payload, items, submitImmediately)
      }
      throw new Error(reqErr.message || 'تعذر إنشاء طلب الشراء.')
    }

    if (!createdReq) throw new Error('تعذر إنشاء طلب الشراء.')

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
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return createDemoRequestLocal(payload, items, submitImmediately)
    }
    throw err
  }
}

function createDemoRequestLocal(
  payload: {
    department: string
    purchase_type: PurchaseType
    budget_line?: string
    priority: PurchasePriority
    needed_by?: string | null
    requested_by: string
    justification: string
    created_by: string
  },
  items: Array<{
    item_name: string
    quantity: number
    unit: string
    estimated_price: number
    custody_item_ref?: string | null
  }>,
  submitImmediately = false
): PurchaseRequest {
  const currentRequests = loadDemoRequests()
  const nextSeq = currentRequests.length + 1
  const reqNo = `PR-${String(nextSeq).padStart(4, '0')}`
  const reqId = `pr-demo-${Date.now()}`

  const reqItems: PurchaseRequestItem[] = items.map((i, idx) => ({
    id: `pri-demo-${Date.now()}-${idx}`,
    request_id: reqId,
    item_name: i.item_name.trim(),
    quantity: Number(i.quantity),
    unit: i.unit.trim() || 'قطعة',
    estimated_price: Number(i.estimated_price) || 0,
    estimated_total: Number(i.quantity) * (Number(i.estimated_price) || 0),
    custody_item_ref: i.custody_item_ref || null,
  }))

  const approvals: PurchaseRequestApproval[] = submitImmediately
    ? DEFAULT_APPROVAL_PATH.map((step) => ({
        id: `app-demo-${Date.now()}-${step.stepNo}`,
        request_id: reqId,
        step_no: step.stepNo,
        step_name: step.stepName,
        decision: 'pending',
        decided_by: null,
        decided_at: null,
        notes: null,
      }))
    : []

  const total_estimated_value = reqItems.reduce((acc, i) => acc + (i.estimated_total || 0), 0)

  const newReq: PurchaseRequest = {
    id: reqId,
    request_no: reqNo,
    department: payload.department.trim(),
    purchase_type: payload.purchase_type,
    budget_line: (payload.budget_line || '').trim(),
    priority: payload.priority,
    needed_by: payload.needed_by || null,
    requested_by: payload.requested_by.trim(),
    justification: payload.justification.trim(),
    status: submitImmediately ? 'pending' : 'draft',
    quote_deadline: null,
    selected_quote_id: null,
    submitted_at: submitImmediately ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: payload.created_by,
    items: reqItems,
    approvals,
    items_count: reqItems.length,
    total_estimated_value,
    items_summary: reqItems[0]?.item_name || '—',
  }

  saveDemoRequests([newReq, ...currentRequests])
  return newReq
}

/**
 * استدعاء RPC لإرسال طلب الشراء للاعتماد
 */
export async function submitPurchaseRequestRpc(requestId: string): Promise<void> {
  if (!supabase) {
    submitDemoRequestLocal(requestId)
    return
  }

  try {
    const { data, error } = await supabase.rpc('submit_purchase_request', {
      p_request_id: requestId,
    })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        submitDemoRequestLocal(requestId)
        return
      }
      throw new Error(error.message || 'تعذر إرسال طلب الشراء للاعتماد.')
    }

    if (data && data.success === false) {
      throw new Error(data.message || 'فشلت عملية إرسال الطلب.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      submitDemoRequestLocal(requestId)
      return
    }
    throw err
  }
}

function submitDemoRequestLocal(requestId: string) {
  const list = loadDemoRequests()
  const req = list.find((r) => r.id === requestId)
  if (!req) return

  req.status = 'pending'
  req.submitted_at = new Date().toISOString()
  req.approvals = DEFAULT_APPROVAL_PATH.map((step) => ({
    id: `app-demo-${Date.now()}-${step.stepNo}`,
    request_id: requestId,
    step_no: step.stepNo,
    step_name: step.stepName,
    decision: 'pending',
    decided_by: null,
    decided_at: null,
    notes: null,
  }))
  saveDemoRequests(list)
}

/**
 * تعديل مسودة طلب شراء وبنوده
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
  if (isCloudTableMissing() || !supabase) {
    return updateDemoRequestLocal(id, payload, items)
  }

  try {
    // 1. التحقق من حالة المسودة
    const { data: current, error: checkErr } = await supabase!
      .from('purchase_requests')
      .select('status')
      .eq('id', id)
      .single()

    if (checkErr) {
      if (isTableMissingError(checkErr)) {
        setCloudTableMissing(true)
        return updateDemoRequestLocal(id, payload, items)
      }
      throw new Error(checkErr.message || 'تعذر التحقق من حالة الطلب.')
    }

    if (current?.status && current.status !== 'draft') {
      throw new Error('لا يمكن تعديل الطلب إلا وهو في حالة مسودة (draft).')
    }

    // 2. تحديث الحقول الرئيسية
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }
    if (payload.department !== undefined) updateData.department = payload.department.trim()
    if (payload.purchase_type !== undefined) updateData.purchase_type = payload.purchase_type
    if (payload.budget_line !== undefined) updateData.budget_line = payload.budget_line
    if (payload.priority !== undefined) updateData.priority = payload.priority
    if (payload.needed_by !== undefined) updateData.needed_by = payload.needed_by
    if (payload.requested_by !== undefined) updateData.requested_by = payload.requested_by
    if (payload.justification !== undefined) updateData.justification = payload.justification

    const { data: updatedReq, error: updateErr } = await supabase!
      .from('purchase_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      throw new Error(updateErr.message || 'تعذر تحديث طلب الشراء.')
    }

    // 3. إذا تم تقديم بنود جديدة، استبدال القديمة
    if (items && items.length > 0) {
      await supabase!.from('purchase_request_items').delete().eq('request_id', id)
      const itemsToInsert = items.map((i) => ({
        request_id: id,
        item_name: i.item_name.trim(),
        quantity: Number(i.quantity),
        unit: i.unit.trim() || 'قطعة',
        estimated_price: Number(i.estimated_price) || 0,
        custody_item_ref: i.custody_item_ref || null,
      }))
      await supabase!.from('purchase_request_items').insert(itemsToInsert)
    }

    const finalReq = await fetchPurchaseRequestById(id)
    return finalReq || (updatedReq as PurchaseRequest)
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return updateDemoRequestLocal(id, payload, items)
    }
    throw err
  }
}

function updateDemoRequestLocal(
  id: string,
  payload: Partial<PurchaseRequest>,
  items?: Array<{
    item_name: string
    quantity: number
    unit: string
    estimated_price?: number
    custody_item_ref?: string | null
  }>
): PurchaseRequest {
  const list = loadDemoRequests()
  const req = list.find((r) => r.id === id)
  if (!req) {
    throw new Error('طلب الشراء غير موجود.')
  }
  if (req.status !== 'draft') {
    throw new Error('لا يمكن تعديل الطلب إلا وهو في حالة مسودة (draft).')
  }

  Object.assign(req, payload, { updated_at: new Date().toISOString() })

  if (items && items.length > 0) {
    req.items = items.map((i, idx) => ({
      id: `item-demo-${Date.now()}-${idx}`,
      request_id: id,
      item_name: i.item_name.trim(),
      quantity: Number(i.quantity),
      unit: i.unit.trim() || 'قطعة',
      estimated_price: Number(i.estimated_price) || 0,
      estimated_total: Number(i.quantity) * (Number(i.estimated_price) || 0),
      custody_item_ref: i.custody_item_ref || null,
    }))
    req.items_count = req.items.length
    req.total_estimated_value = req.items.reduce((acc, it) => acc + (it.estimated_total || 0), 0)
    req.items_summary = req.items.map((it) => it.item_name).join('، ')
  }

  saveDemoRequests(list)
  return req
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
  if (!supabase) {
    recordDemoApprovalLocal(requestId, stepNo, decision, note)
    return
  }

  try {
    const { data, error } = await supabase.rpc('record_approval', {
      p_request_id: requestId,
      p_step_no: stepNo,
      p_decision: decision,
      p_note: note.trim(),
    })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        recordDemoApprovalLocal(requestId, stepNo, decision, note)
        return
      }
      throw new Error(error.message || 'تعذر تسجيل قرار الاعتماد.')
    }

    if (data && data.success === false) {
      throw new Error(data.message || 'فشلت عملية تسجيل القرار.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      recordDemoApprovalLocal(requestId, stepNo, decision, note)
      return
    }
    throw err
  }
}

function recordDemoApprovalLocal(
  requestId: string,
  stepNo: number,
  decision: 'approved' | 'rejected',
  note: string
) {
  const list = loadDemoRequests()
  const req = list.find((r) => r.id === requestId)
  if (!req || !req.approvals) return

  const step = req.approvals.find((a) => a.step_no === stepNo)
  if (step) {
    step.decision = decision
    step.decided_by = 'المعتمد المسؤول'
    step.decided_at = new Date().toISOString()
    step.notes = note
  }

  if (decision === 'rejected') {
    req.status = 'rejected'
  } else {
    const allApproved = req.approvals.every((a) => a.decision === 'approved')
    if (allApproved) {
      req.status = 'approved'
    }
  }

  saveDemoRequests(list)
}

/**
 * حذف مسودة طلب الشراء
 */
export async function deletePurchaseRequest(requestId: string): Promise<void> {
  if (!supabase) {
    const list = loadDemoRequests()
    saveDemoRequests(list.filter((r) => r.id !== requestId))
    return
  }

  try {
    const { error } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', requestId)

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        const list = loadDemoRequests()
        saveDemoRequests(list.filter((r) => r.id !== requestId))
        return
      }
      throw new Error(error.message || 'تعذر حذف طلب الشراء.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      const list = loadDemoRequests()
      saveDemoRequests(list.filter((r) => r.id !== requestId))
      return
    }
    throw err
  }
}

/**
 * جلب عروض الأسعار المرتبطة بطلب شراء معين
 */
export async function fetchSupplierQuotes(requestId: string): Promise<SupplierQuote[]> {
  if (!supabase) {
    return loadDemoQuotes().filter((q) => q.request_id === requestId)
  }

  try {
    const { data, error } = await supabase
      .from('supplier_quotes')
      .select(`
        *,
        supplier:suppliers(name, status, rating)
      `)
      .eq('request_id', requestId)
      .order('total_price', { ascending: true })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return loadDemoQuotes().filter((q) => q.request_id === requestId)
      }
      throw new Error(error.message || 'تعذر تحميل عروض الأسعار.')
    }

    setCloudTableMissing(false)
    return (data || []).map((q) => ({
      ...q,
      supplier_name: q.supplier?.name || 'مورد غير معروف',
      supplier_status: q.supplier?.status || 'active',
      supplier_rating: q.supplier?.rating,
    }))
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoQuotes().filter((q) => q.request_id === requestId)
    }
    throw err
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
  if (payload.total_price < 0) throw new Error('إجمالي السعر لا يمكن أن يكون سالباً.')
  if (payload.delivery_days < 0) throw new Error('مدة التوريد لا يمكن أن تكون سالبة.')

  if (!supabase) {
    return createDemoQuoteLocal(payload)
  }

  try {
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
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return createDemoQuoteLocal(payload)
      }
      throw new Error(error.message || 'تعذر تسجيل عرض السعر.')
    }

    return data as SupplierQuote
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return createDemoQuoteLocal(payload)
    }
    throw err
  }
}

function createDemoQuoteLocal(payload: {
  request_id: string
  supplier_id: string
  total_price: number
  delivery_days: number
  payment_terms?: string
  warranty_months?: number
  notes?: string
  created_by?: string
}): SupplierQuote {
  const currentQuotes = loadDemoQuotes()
  const suppliers = loadDemoSuppliers()
  const sup = suppliers.find((s) => s.id === payload.supplier_id)

  const newQuote: SupplierQuote = {
    id: `quote-demo-${Date.now()}`,
    request_id: payload.request_id,
    supplier_id: payload.supplier_id,
    supplier_name: sup?.name || 'مورد تجريبي',
    supplier_status: sup?.status || 'active',
    supplier_rating: sup?.rating,
    total_price: payload.total_price,
    delivery_days: payload.delivery_days,
    payment_terms: payload.payment_terms || 'دفع بعد الفحص والاستلام',
    warranty_months: payload.warranty_months || 12,
    notes: payload.notes || '',
    is_selected: false,
    created_at: new Date().toISOString(),
    created_by: payload.created_by || 'موظف المشتريات',
  }

  saveDemoQuotes([newQuote, ...currentQuotes])
  return newQuote
}

/**
 * اختيار عرض سعر محدد لطلب شراء عبر RPC select_quote
 */
export async function selectQuoteRpc(requestId: string, quoteId: string): Promise<void> {
  if (!supabase) {
    selectDemoQuoteLocal(requestId, quoteId)
    return
  }

  try {
    const { data, error } = await supabase.rpc('select_quote', {
      p_request_id: requestId,
      p_quote_id: quoteId,
    })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        selectDemoQuoteLocal(requestId, quoteId)
        return
      }
      throw new Error(error.message || 'تعذر اختيار عرض السعر.')
    }

    if (data && data.success === false) {
      throw new Error(data.message || 'فشلت عملية اختيار العرض.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      selectDemoQuoteLocal(requestId, quoteId)
      return
    }
    throw err
  }
}

function selectDemoQuoteLocal(requestId: string, quoteId: string) {
  const quotes = loadDemoQuotes()
  for (const q of quotes) {
    if (q.request_id === requestId) {
      q.is_selected = q.id === quoteId
    }
  }
  saveDemoQuotes(quotes)

  const requests = loadDemoRequests()
  const req = requests.find((r) => r.id === requestId)
  if (req) {
    req.selected_quote_id = quoteId
    req.status = 'approved'
    saveDemoRequests(requests)
  }
}

/**
 * إصدار أمر شراء من العرض المختار عبر RPC create_purchase_order
 */
export async function createPurchaseOrderRpc(quoteId: string): Promise<{ po_id: string; po_no: string }> {
  if (!supabase) {
    return createDemoOrderLocal(quoteId)
  }

  try {
    const { data, error } = await supabase.rpc('create_purchase_order', {
      p_quote_id: quoteId,
    })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return createDemoOrderLocal(quoteId)
      }
      throw new Error(error.message || 'تعذر إنشاء أمر الشراء.')
    }

    return { po_id: data.po_id, po_no: data.po_no }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return createDemoOrderLocal(quoteId)
    }
    throw err
  }
}

function createDemoOrderLocal(quoteId: string): { po_id: string; po_no: string } {
  const quotes = loadDemoQuotes()
  const quote = quotes.find((q) => q.id === quoteId)
  if (!quote) throw new Error('عرض السعر غير موجود.')

  const orders = loadDemoOrders()
  const poNo = `PO-${String(orders.length + 1).padStart(4, '0')}`
  const poId = `po-demo-${Date.now()}`

  const requests = loadDemoRequests()
  const req = requests.find((r) => r.id === quote.request_id)

  const newOrder: PurchaseOrder = {
    id: poId,
    po_no: poNo,
    request_id: quote.request_id,
    request_no: req?.request_no || '—',
    department: req?.department || '—',
    quote_id: quoteId,
    supplier_id: quote.supplier_id,
    supplier_name: quote.supplier_name,
    total: quote.total_price,
    expected_delivery_date: new Date(Date.now() + (quote.delivery_days || 7) * 86400000).toISOString().slice(0, 10),
    status: 'open',
    received_on: null,
    invoiced_on: null,
    notes: quote.notes || '',
    created_at: new Date().toISOString(),
    created_by: 'موظف المشتريات',
  }

  saveDemoOrders([newOrder, ...orders])
  return { po_id: poId, po_no: poNo }
}

/**
 * جلب قائمة أوامر الشراء
 */
export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  if (!supabase) return loadDemoOrders()

  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        request:purchase_requests(request_no, department),
        supplier:suppliers(name)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return loadDemoOrders()
      }
      throw new Error(error.message || 'تعذر جلب أوامر الشراء.')
    }

    setCloudTableMissing(false)
    return (data || []).map((p) => ({
      ...p,
      request_no: p.request?.request_no || '—',
      department: p.request?.department || '—',
      supplier_name: p.supplier?.name || 'مورد غير معروف',
    }))
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoOrders()
    }
    throw err
  }
}

/**
 * تعليم أمر الشراء كمستلم (بدون أثر على المخزون)
 */
export async function markPoReceivedRpc(poId: string): Promise<void> {
  if (!supabase) {
    markDemoOrderReceived(poId)
    return
  }

  try {
    const { error } = await supabase.rpc('mark_po_received', { p_po_id: poId })
    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        markDemoOrderReceived(poId)
        return
      }
      throw new Error(error.message || 'تعذر تحديث حالة أمر الشراء إلى مستلم.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      markDemoOrderReceived(poId)
      return
    }
    throw err
  }
}

function markDemoOrderReceived(poId: string) {
  const orders = loadDemoOrders()
  const po = orders.find((o) => o.id === poId)
  if (po) {
    po.status = 'received'
    po.received_on = new Date().toISOString().slice(0, 10)
    saveDemoOrders(orders)
  }
}

/**
 * تعليم أمر الشراء كمفوتر (بدون أثر على المخزون)
 */
export async function markPoInvoicedRpc(poId: string): Promise<void> {
  if (!supabase) {
    markDemoOrderInvoiced(poId)
    return
  }

  try {
    const { error } = await supabase.rpc('mark_po_invoiced', { p_po_id: poId })
    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        markDemoOrderInvoiced(poId)
        return
      }
      throw new Error(error.message || 'تعذر تحديث حالة أمر الشراء إلى مفوتر.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      markDemoOrderInvoiced(poId)
      return
    }
    throw err
  }
}

function markDemoOrderInvoiced(poId: string) {
  const orders = loadDemoOrders()
  const po = orders.find((o) => o.id === poId)
  if (po) {
    po.status = 'invoiced'
    po.invoiced_on = new Date().toISOString().slice(0, 10)
    saveDemoOrders(orders)
  }
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
