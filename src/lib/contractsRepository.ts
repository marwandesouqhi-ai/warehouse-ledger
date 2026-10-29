import { supabase } from './supabase'
import { purgeLocalDemoData } from './purgeDemoData'

export type ContractAttachment = {
  id: string
  name: string
  size: number
  type: string
  dataUrl?: string
  storagePath?: string
  uploadedAt: string
}

export type SupplierContract = {
  id: string
  contract_number: string
  supplier_id?: string
  supplier_name: string
  contract_title: string
  contract_type: 'supply' | 'service' | 'maintenance' | 'consulting'
  start_date: string
  end_date: string
  contract_value: number
  currency: string
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'renewed'
  auto_renewal: boolean
  renewal_notice_days: number
  terms?: string
  attachments?: ContractAttachment[]
  linked_po_ids?: string[]
  created_by?: string
  created_by_email?: string
  created_at: string
  updated_at: string
}

const LOCAL_STORAGE_KEY = 'supplier_contracts_local'

// Empty default - no mock or demo items
const DEFAULT_CONTRACTS: SupplierContract[] = []

const DEMO_CONTRACT_IDS = new Set(['cnt-1', 'cnt-2'])

export function getLocalContracts(): SupplierContract[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return DEFAULT_CONTRACTS
    const parsed: SupplierContract[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_CONTRACTS
    const cleaned = parsed.filter((c) => !DEMO_CONTRACT_IDS.has(c.id))
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned))
    }
    return cleaned
  } catch {
    return DEFAULT_CONTRACTS
  }
}

export function saveLocalContracts(items: SupplierContract[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchContracts(): Promise<SupplierContract[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('supplier_contracts')
        .select('*')
        .order('created_at', { ascending: false })
      if (!error && Array.isArray(data)) {
        const cleaned = data.filter((c: SupplierContract) => !DEMO_CONTRACT_IDS.has(c.id))
        saveLocalContracts(cleaned)
        return cleaned
      }
    } catch {
      // fallback
    }
  }
  return getLocalContracts()
}

export async function createContract(
  contract: Omit<SupplierContract, 'id' | 'created_at' | 'updated_at'>
): Promise<SupplierContract> {
  const newContract: SupplierContract = {
    ...contract,
    attachments: contract.attachments || [],
    id: `cnt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('supplier_contracts')
        .insert([{
          ...contract,
          attachments: contract.attachments || [],
        }])
        .select()
        .single()
      if (!error && data) {
        const local = getLocalContracts()
        saveLocalContracts([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalContracts()
  const updated = [newContract, ...local]
  saveLocalContracts(updated)
  return newContract
}

export async function updateContract(
  id: string,
  updates: Partial<SupplierContract>
): Promise<SupplierContract> {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('supplier_contracts')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (!error && data) {
        const local = getLocalContracts()
        saveLocalContracts(local.map((c) => (c.id === id ? data : c)))
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalContracts()
  const updated = local.map((c) => (c.id === id ? { ...c, ...payload } : c))
  saveLocalContracts(updated)
  return updated.find((c) => c.id === id)!
}

export async function deleteContract(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('supplier_contracts').delete().eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalContracts()
  saveLocalContracts(local.filter((c) => c.id !== id))
}
