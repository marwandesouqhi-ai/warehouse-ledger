/**
 * src/lib/suppliersRepository.ts
 *
 * مستودع إدارة الموردين وإحصائياتهم وعلاقاتهم بفواتير الشراء.
 * يتعامل مع قاعدة البيانات السحابية Supabase مع توفير Fallback تجريبي محلي ذكي
 * في حال لم تُنفّذ المايجريشن بعد، لمنع توقف الشاشات بأخطاء schema cache.
 */

import { supabase } from './supabase'
import { normalizeArabicName } from './arabicUtils'
import type { FixtureMovement } from './fixture'
import {
  isTableMissingError,
  setCloudTableMissing,
  loadDemoSuppliers,
  saveDemoSuppliers,
} from './demoProcurementData'

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
  if (!supabase) return loadDemoSuppliers()

  try {
    // المحاولة الأولى: القراءة من supplier_stats view
    const { data, error } = await supabase
      .from('supplier_stats')
      .select('*')
      .order('name', { ascending: true })

    if (!error && data) {
      setCloudTableMissing(false)
      return data as SupplierStats[]
    }

    if (error && isTableMissingError(error)) {
      setCloudTableMissing(true)
      return loadDemoSuppliers()
    }

    // Fallback: القراءة من جدول suppliers العادي
    const { data: rawSuppliers, error: supErr } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true })

    if (supErr) {
      if (isTableMissingError(supErr)) {
        setCloudTableMissing(true)
        return loadDemoSuppliers()
      }
      throw new Error(supErr.message || error?.message || 'تعذر تحميل بيانات الموردين من السحابة.')
    }

    if (rawSuppliers) {
      setCloudTableMissing(false)
      return rawSuppliers.map((s: Supplier) => ({
        ...s,
        po_count: 0,
        invoices_count: 0,
        total_spend: 0,
      }))
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoSuppliers()
    }
    throw err
  }

  return loadDemoSuppliers()
}

/**
 * جلب قائمة الموردين النشطين (المصرح باختيارهم في عروض الأسعار وأوامر الشراء)
 */
export async function fetchActiveSuppliers(): Promise<Supplier[]> {
  if (!supabase) return loadDemoSuppliers().filter((s) => s.status === 'active')

  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('status', 'active')
      .order('name', { ascending: true })

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        return loadDemoSuppliers().filter((s) => s.status === 'active')
      }
      throw new Error(error.message || 'تعذر جلب قائمة الموردين النشطين.')
    }

    setCloudTableMissing(false)
    return (data || []) as Supplier[]
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      return loadDemoSuppliers().filter((s) => s.status === 'active')
    }
    throw err
  }
}

/**
 * إنشاء مورد جديد مع منع التكرار بالاسم المطبّع
 */
export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  const rawName = (input.name || '').trim()
  if (!rawName) {
    throw new Error('اسم المورد مطلوب ولا يمكن تركه فارغاً.')
  }

  const nameKey = normalizeArabicName(rawName)
  if (!nameKey) {
    throw new Error('اسم المورد غير صالح.')
  }

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

  if (!supabase) {
    const list = loadDemoSuppliers()
    if (list.some((s) => s.name_key === nameKey)) {
      throw new Error('هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع.')
    }
    const newSup: SupplierStats = {
      ...payload,
      id: `sup-demo-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      po_count: 0,
      invoices_count: 0,
      total_spend: 0,
    }
    saveDemoSuppliers([newSup, ...list])
    return newSup
  }

  try {
    // 1. فحص التكرار المسبق محلياً أو سحابياً
    const { data: existing, error: checkErr } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('name_key', nameKey)
      .maybeSingle()

    if (checkErr && isTableMissingError(checkErr)) {
      setCloudTableMissing(true)
      const list = loadDemoSuppliers()
      if (list.some((s) => s.name_key === nameKey)) {
        throw new Error(`هذا المورد مسجل مسبقاً باسم «${rawName}» (تطابق الاسم بعد التطبيع).`)
      }
      const newSup: SupplierStats = {
        ...payload,
        id: `sup-demo-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        po_count: 0,
        invoices_count: 0,
        total_spend: 0,
      }
      saveDemoSuppliers([newSup, ...list])
      return newSup
    }

    if (existing) {
      throw new Error(`هذا المورد مسجل مسبقاً باسم «${existing.name}» (تطابق الاسم بعد التطبيع).`)
    }

    // 2. إدراج المورد الجديد
    const { data, error } = await supabase
      .from('suppliers')
      .insert([payload])
      .select()
      .single()

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        const list = loadDemoSuppliers()
        const newSup: SupplierStats = {
          ...payload,
          id: `sup-demo-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          po_count: 0,
          invoices_count: 0,
          total_spend: 0,
        }
        saveDemoSuppliers([newSup, ...list])
        return newSup
      }
      if (error.code === '23505' || error.message.includes('unique constraint') || error.message.includes('name_key')) {
        throw new Error('هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع.')
      }
      throw new Error(error.message || 'فشل تسجيل المورد الجديد.')
    }

    return data as Supplier
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      const list = loadDemoSuppliers()
      const newSup: SupplierStats = {
        ...payload,
        id: `sup-demo-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        po_count: 0,
        invoices_count: 0,
        total_spend: 0,
      }
      saveDemoSuppliers([newSup, ...list])
      return newSup
    }
    throw err
  }
}

/**
 * تعديل بيانات مورد قائم
 */
export async function updateSupplier(id: string, updates: UpdateSupplierInput): Promise<Supplier> {
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (updates.name !== undefined) {
    const rawName = updates.name.trim()
    if (!rawName) throw new Error('اسم المورد لا يمكن أن يكون فارغاً.')
    const nameKey = normalizeArabicName(rawName)

    if (supabase) {
      try {
        const { data: existing, error: checkErr } = await supabase
          .from('suppliers')
          .select('id, name')
          .eq('name_key', nameKey)
          .neq('id', id)
          .maybeSingle()

        if (!checkErr && existing) {
          throw new Error(`يوجد مورد آخر مسجل بالفعل بنفس الاسم «${existing.name}».`)
        }
      } catch (err) {
        if (!isTableMissingError(err)) throw err
      }
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

  if (!supabase) {
    const list = loadDemoSuppliers()
    const target = list.find((s) => s.id === id)
    if (!target) throw new Error('المورد غير موجود.')
    const updated = { ...target, ...updatePayload } as SupplierStats
    saveDemoSuppliers(list.map((s) => (s.id === id ? updated : s)))
    return updated
  }

  try {
    const { data, error } = await supabase
      .from('suppliers')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        const list = loadDemoSuppliers()
        const target = list.find((s) => s.id === id)
        if (!target) throw new Error('المورد غير موجود.')
        const updated = { ...target, ...updatePayload } as SupplierStats
        saveDemoSuppliers(list.map((s) => (s.id === id ? updated : s)))
        return updated
      }
      throw new Error(error.message || 'فشل تحديث بيانات المورد.')
    }

    return data as Supplier
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      const list = loadDemoSuppliers()
      const target = list.find((s) => s.id === id)
      if (!target) throw new Error('المورد غير موجود.')
      const updated = { ...target, ...updatePayload } as SupplierStats
      saveDemoSuppliers(list.map((s) => (s.id === id ? updated : s)))
      return updated
    }
    throw err
  }
}

/**
 * حذف مورد — مسموح فقط إذا لم يكن للمورد أي فواتير أو عروض أسعار أو أوامر شراء
 */
export async function deleteSupplierSafe(id: string): Promise<void> {
  if (!supabase) {
    const list = loadDemoSuppliers()
    saveDemoSuppliers(list.filter((s) => s.id !== id))
    return
  }

  try {
    // 1. فحص وجود فواتير مرتبطة
    const { count: invoicesCount, error: invErr } = await supabase
      .from('movements')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)

    if (!invErr && invoicesCount && invoicesCount > 0) {
      throw new Error('لا يمكن حذف مورد مسجل له فواتير شراء سابقة. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
    }

    // 2. فحص وجود عروض أسعار
    const { count: quotesCount, error: qErr } = await supabase
      .from('supplier_quotes')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)

    if (!qErr && quotesCount && quotesCount > 0) {
      throw new Error('لا يمكن حذف مورد مسجل له عروض أسعار. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
    }

    // 3. فحص وجود أوامر شراء
    const { count: poCount, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)

    if (!poErr && poCount && poCount > 0) {
      throw new Error('لا يمكن حذف مورد مسجل له أوامر شراء. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
    }

    // 4. الحذف
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', id)

    if (error) {
      if (isTableMissingError(error)) {
        setCloudTableMissing(true)
        const list = loadDemoSuppliers()
        saveDemoSuppliers(list.filter((s) => s.id !== id))
        return
      }
      throw new Error(error.message || 'تعذر حذف المورد.')
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      setCloudTableMissing(true)
      const list = loadDemoSuppliers()
      saveDemoSuppliers(list.filter((s) => s.id !== id))
      return
    }
    throw err
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

    try {
      const { data: existing, error } = await supabase
        .from('suppliers')
        .select('id')
        .eq('name_key', nameKey)
        .maybeSingle()

      if (error && isTableMissingError(error)) {
        setCloudTableMissing(true)
        return 0
      }

      if (!existing) {
        const { error: insErr } = await supabase
          .from('suppliers')
          .insert([{
            name,
            name_key: nameKey,
            category: 'مورد عام',
            status: 'active',
            created_by: 'system_sync',
          }])
        if (!insErr) addedCount++
      }
    } catch {
      // ignore
    }
  }

  return addedCount
}
