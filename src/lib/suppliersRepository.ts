import { assertDepartmentWrite } from './accessContext'
/**
 * src/lib/suppliersRepository.ts
 *
 * مستودع إدارة الموردين وإحصائياتهم وعلاقاتهم بفواتير الشراء.
 * يتصل مباشرة بقاعدة البيانات الحقيقية Supabase مع استخراج الموردين الفعليين
 * من حركات التوريد المسجلة في حال عدم وجود سجلات مسبقة.
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

const USER_SUPPLIERS_KEY = 'warehouse_custom_suppliers'

function loadUserCustomSuppliers(): SupplierStats[] {
  try {
    const raw = localStorage.getItem(USER_SUPPLIERS_KEY)
    if (raw) return JSON.parse(raw) as SupplierStats[]
  } catch {
    // ignore
  }
  return []
}

function saveUserCustomSuppliers(list: SupplierStats[]) {
  try {
    localStorage.setItem(USER_SUPPLIERS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

/**
 * استخراج الموردين الفعليين المسجلين في حركات التوريد بالمخزن
 */
export function extractSuppliersFromMovements(): SupplierStats[] {
  try {
    const raw = localStorage.getItem('warehouse-ledger-movements')
    if (raw) {
      const movements = JSON.parse(raw) as FixtureMovement[]
      if (Array.isArray(movements)) {
        const supMap = new Map<string, SupplierStats>()
        for (const m of movements) {
          const name = String(m.from || '').trim()
          if (!name || name === 'رصيد أول المدة' || name === 'مخزن' || name === 'المخزن الرئيسي') continue
          const key = normalizeArabicName(name)
          if (!key) continue
          const spend = (Number(m.qin) || 0) * (Number(m.price) || 0)

          if (!supMap.has(key)) {
            supMap.set(key, {
              id: `sup-${key}`,
              name,
              name_key: key,
              category: 'مورد حركات معتمد',
              commercial_register: '',
              contact_name: '',
              phone: '',
              status: 'active',
              rating: 5,
              notes: 'مستخرج تلقائياً من فواتير وحركات التوريد الفعلية في النظام',
              created_at: m.date || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_by: 'سجل الحركات الفعلي',
              po_count: 0,
              invoices_count: 1,
              total_spend: spend,
            })
          } else {
            const existing = supMap.get(key)!
            existing.invoices_count++
            existing.total_spend += spend
          }
        }
        return Array.from(supMap.values())
      }
    }
  } catch {
    // ignore
  }
  return []
}

/**
 * دمج الموردين الفعليين من الحركات مع الموردين الذين أضافهم المستخدم
 */
function getLocalRealSuppliers(): SupplierStats[] {
  const fromMovements = extractSuppliersFromMovements()
  const custom = loadUserCustomSuppliers()

  const map = new Map<string, SupplierStats>()
  for (const s of fromMovements) {
    map.set(s.name_key, s)
  }
  for (const s of custom) {
    map.set(s.name_key, s)
  }
  return Array.from(map.values())
}

/**
 * جلب قائمة الموردين مع إحصائياتهم
 */
export async function fetchSupplierStatsList(): Promise<SupplierStats[]> {
  if (!supabase) return getLocalRealSuppliers()

  try {
    // المحاولة الأولى: القراءة من supplier_stats view
    const { data, error } = await supabase
      .from('supplier_stats')
      .select('*')
      .order('name', { ascending: true })

    if (!error && data && data.length > 0) {
      return data as SupplierStats[]
    }

    // المحاولة الثانية: القراءة من جدول suppliers العادي
    const { data: rawSuppliers, error: supErr } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true })

    if (!supErr && rawSuppliers && rawSuppliers.length > 0) {
      return rawSuppliers.map((s: Supplier) => ({
        ...s,
        po_count: 0,
        invoices_count: 0,
        total_spend: 0,
      }))
    }
  } catch (err) {
    console.warn('Could not fetch suppliers from Supabase, falling back to real movements:', err)
  }

  return getLocalRealSuppliers()
}

/**
 * جلب قائمة الموردين النشطين
 */
export async function fetchActiveSuppliers(): Promise<Supplier[]> {
  if (!supabase) return getLocalRealSuppliers().filter((s) => s.status === 'active')

  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('status', 'active')
      .order('name', { ascending: true })

    if (!error && data && data.length > 0) {
      return data as Supplier[]
    }
  } catch (err) {
    console.warn('Could not fetch active suppliers from Supabase:', err)
  }

  return getLocalRealSuppliers().filter((s) => s.status === 'active')
}

/**
 * إنشاء مورد جديد مع منع التكرار بالاسم المطبّع
 */
export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  assertDepartmentWrite('procurement', 'create')
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

  if (supabase) {
    // 1. التحقق من عدم التكرار على السحابة
    const { data: existing, error: checkErr } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('name_key', nameKey)
      .maybeSingle()

    if (!checkErr && existing) {
      throw new Error(`هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع («${existing.name}»).`)
    }

    if (!checkErr || checkErr.code !== 'PGRST205') {
      try {
        const { data, error } = await supabase
          .from('suppliers')
          .insert([payload])
          .select()
          .single()

        if (error) {
          if (error.code === '23505' || error.message.includes('unique constraint') || error.message.includes('name_key')) {
            throw new Error('هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع.')
          }
          if (error.code !== 'PGRST205') {
            throw new Error(error.message || 'فشل تسجيل المورد الجديد.')
          }
        } else if (data) {
          return data as Supplier
        }
      } catch (insertErr) {
        if (insertErr instanceof Error && insertErr.message.includes('مسجل مسبقاً')) {
          throw insertErr
        }
      }
    }
  }

  // حفظ محلي في الموردين الفعليين
  const custom = loadUserCustomSuppliers()
  if (custom.some((s) => s.name_key === nameKey)) {
    throw new Error('هذا المورد مسجل مسبقاً بنفس الاسم أو اسم مطابق بعد التطبيع.')
  }

  const newSup: SupplierStats = {
    ...payload,
    id: `sup-${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    po_count: 0,
    invoices_count: 0,
    total_spend: 0,
  }

  saveUserCustomSuppliers([newSup, ...custom])
  return newSup
}

/**
 * تعديل بيانات مورد قائم
 */
export async function updateSupplier(id: string, updates: UpdateSupplierInput): Promise<Supplier> {
  assertDepartmentWrite('procurement', 'update')
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
      } catch {
        // ignore
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

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (!error && data) {
        return data as Supplier
      }
    } catch {
      // ignore
    }
  }

  const custom = loadUserCustomSuppliers()
  const target = custom.find((s) => s.id === id)
  if (!target) {
    // Could be from movements
    const updated = {
      id,
      name: (updatePayload.name as string) || 'مورد',
      name_key: (updatePayload.name_key as string) || normalizeArabicName((updatePayload.name as string) || 'مورد'),
      category: (updatePayload.category as string) || 'عام',
      commercial_register: (updatePayload.commercial_register as string) || '',
      contact_name: (updatePayload.contact_name as string) || '',
      phone: (updatePayload.phone as string) || '',
      status: (updatePayload.status as SupplierStatus) || 'active',
      rating: (updatePayload.rating as number | null) ?? null,
      notes: (updatePayload.notes as string) || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: 'مستخدم',
      po_count: 0,
      invoices_count: 0,
      total_spend: 0,
    }
    saveUserCustomSuppliers([updated, ...custom])
    return updated
  }

  const updated = { ...target, ...updatePayload } as SupplierStats
  saveUserCustomSuppliers(custom.map((s) => (s.id === id ? updated : s)))
  return updated
}

/**
 * حذف مورد — مسموح فقط إذا لم يكن للمورد أي فواتير مسجلة
 */
export async function deleteSupplierSafe(id: string): Promise<void> {
  assertDepartmentWrite('procurement', 'delete')
  if (supabase) {
    try {
      // 1. فحص وجود فواتير مرتبطة
      const { count: invoicesCount, error: invErr } = await supabase
        .from('movements')
        .select('id', { count: 'exact', head: true })
        .eq('supplier_id', id)

      if (!invErr && invoicesCount && invoicesCount > 0) {
        throw new Error('لا يمكن حذف مورد مسجل له فواتير شراء سابقة. يمكنك تغيير حالته إلى «موقوف» بدلاً من ذلك.')
      }

      // 2. الحذف من السحابة
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id)

      if (!error) return
    } catch (err) {
      if (err instanceof Error && err.message.includes('لا يمكن حذف مورد')) {
        throw err
      }
    }
  }

  const custom = loadUserCustomSuppliers()
  saveUserCustomSuppliers(custom.filter((s) => s.id !== id))
}

/**
 * مزامنة الموردين من الحركات التاريخية
 */
export async function syncSuppliersFromMovements(movements: FixtureMovement[]): Promise<number> {
  if (!supabase) return 0

  const supplierNames = new Set<string>()
  for (const m of movements) {
    const raw = (m.from || '').trim()
    if (raw && raw !== 'رصيد أول المدة' && raw !== 'مخزن' && raw !== 'المخزن الرئيسي') {
      supplierNames.add(raw)
    }
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

      if (error && error.code === 'PGRST205') {
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
