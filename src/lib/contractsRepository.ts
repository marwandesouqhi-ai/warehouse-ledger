import { supabase } from './supabase'

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
  attachments?: unknown[]
  linked_po_ids?: string[]
  created_by?: string
  created_by_email?: string
  created_at: string
  updated_at: string
}

const LOCAL_STORAGE_KEY = 'supplier_contracts_local'

const DEFAULT_CONTRACTS: SupplierContract[] = [
  {
    id: 'cnt-1',
    contract_number: 'CNT-2026-001',
    supplier_name: 'شركة مصر للأجهزة والحلول التقنية',
    contract_title: 'عقد توريد وصيانة أجهزة معامل الحاسب الآلي',
    contract_type: 'supply',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    contract_value: 450000,
    currency: 'EGP',
    status: 'active',
    auto_renewal: true,
    renewal_notice_days: 30,
    terms: 'توريد قطع غيار أصلية والالتزام بالصيانة الدورية كل شهرين.',
    created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
  {
    id: 'cnt-2',
    contract_number: 'CNT-2026-002',
    supplier_name: 'مؤسسة الدلتا للتجهيزات المعملية',
    contract_title: 'عقد توريد كيماويات ومستهلكات معامل كلية العلوم',
    contract_type: 'supply',
    start_date: '2026-02-15',
    end_date: '2026-11-15',
    contract_value: 280000,
    currency: 'EGP',
    status: 'active',
    auto_renewal: false,
    renewal_notice_days: 45,
    terms: 'التوريد طبقا لمحاضر الفحص الفني المعتمدة من الكلية.',
    created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 15).toISOString(),
  },
]

function getLocalContracts(): SupplierContract[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return DEFAULT_CONTRACTS
}

function saveLocalContracts(items: SupplierContract[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchContracts(): Promise<SupplierContract[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('supplier_contracts')
        .select('*')
        .order('created_at', { ascending: false })
      if (!error && data && data.length > 0) {
        saveLocalContracts(data)
        return data
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
    id: `cnt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('supplier_contracts')
        .insert([contract])
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

