import { supabase } from './supabase'

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

const DEFAULT_BUDGET_PLANS: BudgetPlan[] = [
  {
    id: 'bg-1',
    fiscal_year: 2026,
    department: 'كلية الهندسة',
    category: 'أجهزة ومعدات معملية',
    allocated_amount: 1200000,
    spent_amount: 850000,
    remaining_amount: 350000,
    status: 'active',
    notes: 'معامل الميكاترونكس والذكاء الاصطناعي',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bg-2',
    fiscal_year: 2026,
    department: 'كلية الطب البشري',
    category: 'مستلزمات وأجهزة طبية',
    allocated_amount: 1500000,
    spent_amount: 980000,
    remaining_amount: 520000,
    status: 'active',
    notes: 'معامل التشريح والأنسجة والتحاليل',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bg-3',
    fiscal_year: 2026,
    department: 'المستودعات والمخازن',
    category: 'مستلزمات مكتبية وتعبئة',
    allocated_amount: 300000,
    spent_amount: 210000,
    remaining_amount: 90000,
    status: 'active',
    notes: 'أدوات مكتبية ومستلزمات إدارية وتشغيلية',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bg-4',
    fiscal_year: 2026,
    department: 'إدارة تكنولوجيا المعلومات (IT)',
    category: 'شبكات وسيرفرات وحواسيب',
    allocated_amount: 950000,
    spent_amount: 720000,
    remaining_amount: 230000,
    status: 'active',
    notes: 'تحديث البنية التحتية وتجهيز قاعات الامتحانات',
    created_at: '2026-01-01T00:00:00Z',
  },
]

function getLocalBudgetPlans(): BudgetPlan[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return DEFAULT_BUDGET_PLANS
}

function saveLocalBudgetPlans(items: BudgetPlan[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchBudgetPlans(fiscalYear?: number): Promise<BudgetPlan[]> {
  if (supabase) {
    try {
      let query = supabase.from('budget_plans').select('*').order('allocated_amount', { ascending: false })
      if (fiscalYear) {
        query = query.eq('fiscal_year', fiscalYear)
      }
      const { data, error } = await query
      if (!error && data && data.length > 0) {
        saveLocalBudgetPlans(data)
        return data
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

