import { assertDepartmentWrite } from './accessContext'
import { supabase } from './supabase'
import { purgeLocalDemoData } from './purgeDemoData'

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

// Empty default - no mock or demo items
const DEFAULT_MOVEMENTS: AssetMovement[] = []

const DEMO_IDS = new Set(['ast-1', 'ast-2', 'ast-3'])

export function getLocalAssetMovements(): AssetMovement[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return DEFAULT_MOVEMENTS
    const parsed: AssetMovement[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_MOVEMENTS
    // Filter out any stale mock demo records automatically
    const cleaned = parsed.filter(
      (m) =>
        !DEMO_IDS.has(m.id) &&
        !(m.asset_code === 'ZNU-IT-001' && m.notes?.includes('TKT-28589')) &&
        !(m.asset_code === 'ZNU-MED-044')
    )
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned))
    }
    return cleaned
  } catch {
    return DEFAULT_MOVEMENTS
  }
}

export function saveLocalAssetMovements(items: AssetMovement[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchAssetMovements(assetCode?: string): Promise<AssetMovement[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      let query = supabase.from('asset_movement_log').select('*').order('performed_at', { ascending: false })
      if (assetCode) {
        query = query.eq('asset_code', assetCode)
      }
      const { data, error } = await query
      if (!error && Array.isArray(data)) {
        // Filter out demo records if any exist in the database
        const cleaned = data.filter(
          (m: AssetMovement) =>
            !DEMO_IDS.has(m.id) &&
            !(m.asset_code === 'ZNU-IT-001' && m.notes?.includes('TKT-28589')) &&
            !(m.asset_code === 'ZNU-MED-044')
        )
        saveLocalAssetMovements(cleaned)
        return cleaned
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
  assertDepartmentWrite('warehouse', 'create')
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

export async function deleteAssetMovement(_id: string): Promise<boolean> {
  throw new Error('سجل حركات الأصول محفوظ بشكل دائم وغير قابل للحذف نهائياً لضمان النزاهة والامتثال الرقابي.')
}

export async function clearAllAssetMovements(): Promise<void> {
  throw new Error('سجل حركات الأصول محفوظ بشكل دائم وغير قابل للمسح الجماعي.')
}
