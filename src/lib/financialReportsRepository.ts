import { supabase } from './supabase'
import { purgeLocalDemoData } from './purgeDemoData'

export type FinancialReport = {
  id: string
  report_number: string
  report_title: string
  report_type: 'monthly' | 'quarterly' | 'annual' | 'custom'
  period_from: string
  period_to: string
  total_purchases: number
  total_disbursements: number
  budget_allocated: number
  budget_remaining: number
  summary_data?: Record<string, unknown>
  status: 'draft' | 'finalized' | 'approved'
  created_by?: string
  created_by_email?: string
  approved_by?: string
  approved_at?: string
  created_at: string
  updated_at: string
}

const LOCAL_STORAGE_KEY = 'financial_reports_local'

// Empty default - no mock or demo items
const DEFAULT_FINANCIAL_REPORTS: FinancialReport[] = []

const DEMO_REPORT_IDS = new Set(['fr-1', 'fr-2'])

export function getLocalReports(): FinancialReport[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return DEFAULT_FINANCIAL_REPORTS
    const parsed: FinancialReport[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_FINANCIAL_REPORTS
    const cleaned = parsed.filter((f) => !DEMO_REPORT_IDS.has(f.id))
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned))
    }
    return cleaned
  } catch {
    return DEFAULT_FINANCIAL_REPORTS
  }
}

export function saveLocalReports(items: FinancialReport[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchFinancialReports(): Promise<FinancialReport[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('financial_reports')
        .select('*')
        .order('created_at', { ascending: false })
      if (!error && Array.isArray(data)) {
        const cleaned = data.filter((f: FinancialReport) => !DEMO_REPORT_IDS.has(f.id))
        saveLocalReports(cleaned)
        return cleaned
      }
    } catch {
      // fallback
    }
  }
  return getLocalReports()
}

export async function createFinancialReport(
  report: Omit<FinancialReport, 'id' | 'created_at' | 'updated_at'>
): Promise<FinancialReport> {
  const newReport: FinancialReport = {
    ...report,
    id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('financial_reports').insert([report]).select().single()
      if (!error && data) {
        const local = getLocalReports()
        saveLocalReports([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalReports()
  saveLocalReports([newReport, ...local])
  return newReport
}

export async function updateFinancialReportStatus(
  id: string,
  status: FinancialReport['status'],
  approvedBy?: string
): Promise<void> {
  const updates: Partial<FinancialReport> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'approved' && approvedBy) {
    updates.approved_by = approvedBy
    updates.approved_at = new Date().toISOString()
  }

  if (supabase) {
    try {
      await supabase.from('financial_reports').update(updates).eq('id', id)
    } catch {
      // fallback
    }
  }

  const local = getLocalReports()
  saveLocalReports(local.map((r) => (r.id === id ? { ...r, ...updates } : r)))
}

export async function deleteFinancialReport(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('financial_reports').delete().eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalReports()
  saveLocalReports(local.filter((r) => r.id !== id))
}
