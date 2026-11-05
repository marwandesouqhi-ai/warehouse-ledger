import { assertDepartmentWrite } from './accessContext'
import { supabase } from './supabase'

export type DisbursementRequest = {
  id: string
  request_number: string
  requester_name: string
  requester_department: string
  item_name: string
  quantity_requested: number
  unit: string
  purpose: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'approved' | 'rejected' | 'issued'
  notes?: string
  rejection_reason?: string
  approved_by?: string
  approved_at?: string
  issued_at?: string
  created_by?: string
  created_by_email?: string
  warehouse_id: string
  created_at: string
  updated_at: string
}

const LOCAL_STORAGE_KEY = 'disbursement_requests_local'

export function getLocalRequests(): DisbursementRequest[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveLocalRequests(items: DisbursementRequest[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchDisbursementRequests(): Promise<DisbursementRequest[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('disbursement_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (!error && data) {
        saveLocalRequests(data)
        return data
      }
    } catch {
      // fallback to local
    }
  }
  return getLocalRequests()
}

export async function createDisbursementRequest(
  item: Omit<DisbursementRequest, 'id' | 'created_at' | 'updated_at'>
): Promise<DisbursementRequest> {
  assertDepartmentWrite('warehouse', 'create')
  const newRecord: DisbursementRequest = {
    ...item,
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('disbursement_requests')
        .insert([item])
        .select()
        .single()
      if (!error && data) {
        const local = getLocalRequests()
        saveLocalRequests([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalRequests()
  const updated = [newRecord, ...local]
  saveLocalRequests(updated)
  return newRecord
}

export async function updateDisbursementRequestStatus(
  id: string,
  status: DisbursementRequest['status'],
  extra: {
    approved_by?: string
    approved_at?: string
    issued_at?: string
    rejection_reason?: string
  }
): Promise<void> {
  assertDepartmentWrite('warehouse', 'update')
  const updates = {
    status,
    ...extra,
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      await supabase.from('disbursement_requests').update(updates).eq('id', id)
    } catch {
      // fallback
    }
  }

  const local = getLocalRequests()
  const updated = local.map((r) => (r.id === id ? { ...r, ...updates } : r))
  saveLocalRequests(updated)
}

