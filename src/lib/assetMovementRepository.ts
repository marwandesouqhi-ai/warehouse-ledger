import { supabase } from './supabase'

export type AssetMovement = {
  id: string
  asset_code: string
  asset_name: string
  from_location?: string
  to_location: string
  movement_type: 'inward' | 'outward' | 'transfer' | 'inspection' | 'maintenance' | 'writeoff'
  quantity: number
  condition_before?: string
  condition_after?: string
  notes?: string
  performed_by?: string
  performed_by_email?: string
  performed_at: string
  created_by?: string
  created_at: string
}

const LOCAL_STORAGE_KEY = 'asset_movements_local'

const DEFAULT_MOVEMENTS: AssetMovement[] = [
  {
    id: 'ast-1',
    asset_code: 'ZNU-IT-001',
    asset_name: 'جهاز حاسب آلي مكتبي Core i7 Dell',
    from_location: 'المخزن الرئيسي',
    to_location: 'كلية الحاسبات والمعلومات - معمل 1',
    movement_type: 'transfer',
    quantity: 15,
    condition_before: 'جديد بالكرتونة',
    condition_after: 'ممتاز - تم التثبيت والتشغيل',
    notes: 'تم التسليم بموجب محضر فحص واستلام',
    performed_by: 'م. حسام علي',
    performed_at: '2026-10-15T10:30:00Z',
    created_at: '2026-10-15T10:30:00Z',
  },
  {
    id: 'ast-2',
    asset_code: 'ZNU-MED-044',
    asset_name: 'ميكروسكوب ضوئي إكلينيكي ثنائي العدسات',
    from_location: 'المخزن الرئيسي',
    to_location: 'كلية الطب البشري - قسم الباثولوجي',
    movement_type: 'transfer',
    quantity: 10,
    condition_before: 'جديد معتمد',
    condition_after: 'جاهز للتشغيل والتدريس',
    notes: 'توريد شركة التوريدات الطبية',
    performed_by: 'د. خالد عبد الرحمن',
    performed_at: '2026-10-20T11:00:00Z',
    created_at: '2026-10-20T11:00:00Z',
  },
  {
    id: 'ast-3',
    asset_code: 'ZNU-IT-001',
    asset_name: 'جهاز حاسب آلي مكتبي Core i7 Dell',
    from_location: 'كلية الحاسبات والمعلومات - معمل 1',
    to_location: 'ورشة الصيانة والدعم الفني',
    movement_type: 'maintenance',
    quantity: 1,
    condition_before: 'عطل في وحدة التغذية (Power Supply)',
    condition_after: 'قيد الإصلاح والفحص',
    notes: 'تذكرة دعم فني رقم TKT-28589',
    performed_by: 'فني الصيانة محمود إبراهيم',
    performed_at: '2026-10-26T09:15:00Z',
    created_at: '2026-10-26T09:15:00Z',
  },
]

function getLocalAssetMovements(): AssetMovement[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return DEFAULT_MOVEMENTS
}

function saveLocalAssetMovements(items: AssetMovement[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchAssetMovements(assetCode?: string): Promise<AssetMovement[]> {
  if (supabase) {
    try {
      let query = supabase.from('asset_movement_log').select('*').order('performed_at', { ascending: false })
      if (assetCode) {
        query = query.eq('asset_code', assetCode)
      }
      const { data, error } = await query
      if (!error && data && data.length > 0) {
        saveLocalAssetMovements(data)
        return data
      }
    } catch {
      // fallback
    }
  }
  const local = getLocalAssetMovements()
  if (assetCode) {
    return local.filter((m) => m.asset_code.toLowerCase() === assetCode.toLowerCase())
  }
  return local
}

export async function createAssetMovement(
  item: Omit<AssetMovement, 'id' | 'created_at'>
): Promise<AssetMovement> {
  const newRecord: AssetMovement = {
    ...item,
    id: `ast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('asset_movement_log').insert([item]).select().single()
      if (!error && data) {
        const local = getLocalAssetMovements()
        saveLocalAssetMovements([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalAssetMovements()
  saveLocalAssetMovements([newRecord, ...local])
  return newRecord
}

