import { supabase } from './supabase'
import { purgeLocalDemoData } from './purgeDemoData'

export type BudgetPlan = {
  id: string
  fiscal_year: number
  department: string
  category: string
  allocated_amount: number
  spent_amount: number
  remaining_amount: number
  notes?: string
  status: 'draft' | 'active' | 'closed'
  created_by?: string
  created_by_email?: string
  created_at: string
  updated_at?: string
}

const LOCAL_STORAGE_KEY = 'budget_plans_local'

// Empty default - no mock or demo items
const DEFAULT_BUDGET_PLANS: BudgetPlan[] = []

const DEMO_BUDGET_IDS = new Set(['bg-1', 'bg-2', 'bg-3', 'bg-4'])

export function getLocalBudgetPlans(): BudgetPlan[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return DEFAULT_BUDGET_PLANS
    const parsed: BudgetPlan[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_BUDGET_PLANS
    const cleaned = parsed.filter((b) => !DEMO_BUDGET_IDS.has(b.id))
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned))
    }
    return cleaned
  } catch {
    return DEFAULT_BUDGET_PLANS
  }
}

export function saveLocalBudgetPlans(items: BudgetPlan[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchBudgetPlans(fiscalYear?: number): Promise<BudgetPlan[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      let query = supabase.from('budget_plans').select('*').order('allocated_amount', { ascending: false })
      if (fiscalYear) {
        query = query.eq('fiscal_year', fiscalYear)
      }
      const { data, error } = await query
      if (!error && Array.isArray(data)) {
        const cleaned = data.filter((b: BudgetPlan) => !DEMO_BUDGET_IDS.has(b.id))
        saveLocalBudgetPlans(cleaned)
        return cleaned
      }
    } catch {
      // fallback
    }
  }
  const local = getLocalBudgetPlans()
  if (fiscalYear) {
    return local.filter((p) => p.fiscal_year === fiscalYear)
  }
  return local
}

export async function createBudgetPlan(
  plan: Omit<BudgetPlan, 'id' | 'remaining_amount' | 'created_at' | 'updated_at'>
): Promise<BudgetPlan> {
  const remaining = Number(plan.allocated_amount) - Number(plan.spent_amount || 0)
  const newPlan: BudgetPlan = {
    ...plan,
    id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    remaining_amount: remaining,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('budget_plans').insert([plan]).select().single()
      if (!error && data) {
        const local = getLocalBudgetPlans()
        saveLocalBudgetPlans([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalBudgetPlans()
  saveLocalBudgetPlans([newPlan, ...local])
  return newPlan
}

export async function updateBudgetPlan(
  id: string,
  updates: Partial<BudgetPlan>
): Promise<BudgetPlan> {
  const local = getLocalBudgetPlans()
  const existing = local.find((p) => p.id === id)
  const allocated = updates.allocated_amount !== undefined ? updates.allocated_amount : existing?.allocated_amount || 0
  const spent = updates.spent_amount !== undefined ? updates.spent_amount : existing?.spent_amount || 0
  const remaining = allocated - spent

  const payload = {
    ...updates,
    remaining_amount: remaining,
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('budget_plans')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (!error && data) {
        saveLocalBudgetPlans(local.map((p) => (p.id === id ? data : p)))
        return data
      }
    } catch {
      // fallback
    }
  }

  const updatedList = local.map((p) => (p.id === id ? { ...p, ...payload } : p))
  saveLocalBudgetPlans(updatedList)
  return updatedList.find((p) => p.id === id)!
}

export async function deleteBudgetPlan(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('budget_plans').delete().eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalBudgetPlans()
  saveLocalBudgetPlans(local.filter((p) => p.id !== id))
}
