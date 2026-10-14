/**
 * src/lib/suppliersRepository.ts
 *
 * مستودع إدارة الموردين وإحصائياتهم وعلاقاتهم بفواتير الشراء.
 * يتعامل حصرياً مع قاعدة البيانات السحابية Supabase مع منع التكرار بالاسم المطبع.
 */

import { supabase } from './supabase'
import { normalizeArabicName } from './arabicUtils'
import type { FixtureMovement } from './fixture'

export type SupplierStatus = 'active' | 'under_review' | 'suspended'

export interface Supplier {
  id: string
  name: string
  name_key: string
  category: string
  commercial_register: string
  contact_name: string
  phone: string
  status: SupplierStatus
  rating: number | null
  notes: string
  created_at: string
  updated_at: string
  created_by: string
}

export interface SupplierStats extends Supplier {
  po_count: number
  invoices_count: number
  total_spend: number
}

export interface CreateSupplierInput {
  name: string
  category?: string
  commercial_register?: string
  contact_name?: string
  phone?: string
  status?: SupplierStatus
  rating?: number | null
  notes?: string
  created_by?: string
}

export interface UpdateSupplierInput {
  name?: string
  category?: string
  commercial_register?: string
  contact_name?: string
  phone?: string
  status?: SupplierStatus
  rating?: number | null
  notes?: string
}

/**
 * جلب قائمة الموردين مع إحصائياتهم من View supplier_stats
 */
export async function fetchSupplierStatsList(): Promise<SupplierStats[]> {
  if (!supabase) return []

  // المحاولة الأولى: القراءة من supplier_stats view
  const { data, error } = await supabase
    .from('supplier_stats')
    .select('*')
    .order('name', { ascending: true })

  if (!error && data) {
    return data as SupplierStats[]
  }

  // Fallback: القراءة من جدول suppliers العادي
  const { data: rawSuppliers, error: supErr } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true })

  if (supErr || !rawSuppliers) {
    throw new Error(supErr?.message || error?.message || 'تعذر تحميل بيانات الموردين من السحابة.')
  }

  return rawSuppliers.map((s: Supplier) => ({
    ...s,
    po_count: 0,
    invoices_count: 0,
    total_spend: 0,
  }))
}

/**
 * جلب قائمة الموردين النشطين (المصرح باختيارهم في عروض الأسعار وأوامر الشراء)
 */
export async function fetchActiveSuppliers(): Promise<Supplier[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'تعذر جلب قائمة الموردين النشطين.')
  }

  return (data || []) as Supplier[]
}

/**
 * إنشاء مورد جديد مع منع التكرار بالاسم المطبّع
 */
export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const rawName = (input.name || '').trim()
  if (!rawName) {
    throw new Error('اسم المورد مطلوب ولا يمكن تركه فارغاً.')
  }

  const nameKey = normalizeArabicName(rawName)
  if (!nameKey) {
    throw new Error('اسم المورد غير صالح.')
  }

  // 1. فحص التكرار المسبق محلياً أو سحابياً
  const { data: existing } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('name_key', nameKey)
    .maybeSingle()

  if (existing) {
    throw new Error(`هذا المورد مسجل مسبقاً باسم «${existing.name}» (تطابق الاسم بعد التطبيع).`)
  }

  // 2. إدراج المورد الجديد
  const payload = {
    name: rawName,
    name_key: nameKey,
    category: (input.category || 'عام').trim(),
    commercial_register: (input.commercial_register || '').trim(),
    contact_name: (input.contact_name || '').trim(),
    phone: (input.phone || '').trim(),
    status: input.status || 'under_review',
    rating: input.rating ?? null,
    notes: (input.notes || '').trim(),
    created_by: input.created_by || '',
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert([payload])
    .select()
    .single()

  if (error) {
    if (error.code === '23505' || error.message.includes('unique constraint') || error.message.includes('name_key')) {
      throw new Error('هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع.')
    }
    throw new Error(error.message || 'فشل تسجيل المورد الجديد.')
  }

  return data as Supplier
}

/**
 * تعديل بيانات مورد قائم
 */
export async function updateSupplier(id: string, updates: UpdateSupplierInput): Promise<Supplier> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (updates.name !== undefined) {
    const rawName = updates.name.trim()
    if (!rawName) throw new Error('اسم المورد لا يمكن أن يكون فارغاً.')
    const nameKey = normalizeArabicName(rawName)

    // التحقق من عدم وجود مورد آخر بنفس الاسم المطبع
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('name_key', nameKey)
      .neq('id', id)
      .maybeSingle()

    if (existing) {
      throw new Error(`يوجد مورد آخر مسجل بالفعل بنفس الاسم «${existing.name}».`)
    }

    updatePayload.name = rawName
    updatePayload.name_key = nameKey
  }

  if (updates.category !== undefined) updatePayload.category = updates.category.trim()
  if (updates.commercial_register !== undefined) updatePayload.commercial_register = updates.commercial_register.trim()
  if (updates.contact_name !== undefined) updatePayload.contact_name = updates.contact_name.trim()
  if (updates.phone !== undefined) updatePayload.phone = updates.phone.trim()
  if (updates.status !== undefined) updatePayload.status = updates.status
  if (updates.rating !== undefined) updatePayload.rating = updates.rating
  if (updates.notes !== undefined) updatePayload.notes = updates.notes.trim()

  const { data, error } = await supabase
    .from('suppliers')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(error.message || 'فشل تحديث بيانات المورد.')
  }

  return data as Supplier
}

/**
 * حذف مورد — مسموح فقط إذا لم يكن للمورد أي فواتير أو عروض أسعار أو أوامر شراء
 */
export async function deleteSupplierSafe(id: string): Promise<void> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  // 1. فحص وجود فواتير مرتبطة
  const { count: invoicesCount } = await supabase
    .from('movements')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', id)

  if (invoicesCount && invoicesCount > 0) {
    throw new Error('لا يمكن حذف مورد مسجل له فواتير شراء سابقة. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
  }

  // 2. فحص وجود عروض أسعار
  const { count: quotesCount } = await supabase
    .from('supplier_quotes')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', id)

  if (quotesCount && quotesCount > 0) {
    throw new Error('لا يمكن حذف مورد مسجل له عروض أسعار. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
  }

  // 3. فحص وجود أوامر شراء
  const { count: poCount } = await supabase
    .from('purchase_orders')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', id)

  if (poCount && poCount > 0) {
    throw new Error('لا يمكن حذف مورد مسجل له أوامر شراء. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
  }

  // 4. الحذف
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(error.message || 'تعذر حذف المورد.')
  }
}

/**
 * مزامنة الموردين من الحركات التاريخية (Idempotent client seeder fallback)
 */
export async function syncSuppliersFromMovements(movements: FixtureMovement[]): Promise<number> {
  if (!supabase) return 0

  const supplierNames = new Set<string>()
  for (const m of movements) {
    const raw = (m.from || '').trim()
    if (raw) supplierNames.add(raw)
  }

  if (supplierNames.size === 0) return 0

  let addedCount = 0
  for (const name of supplierNames) {
    const nameKey = normalizeArabicName(name)
    if (!nameKey) continue

    const { data: existing } = await supabase
      .from('suppliers')
      .select('id')
      .eq('name_key', nameKey)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase
        .from('suppliers')
        .insert([{
          name,
          name_key: nameKey,
          category: 'مورد عام',
          status: 'active',
          created_by: 'system_sync',
        }])
      if (!error) addedCount++
    }
  }

  return addedCount
}
