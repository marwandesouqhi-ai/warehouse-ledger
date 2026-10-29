import { supabase } from './supabase'

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

const DEFAULT_FINANCIAL_REPORTS: FinancialReport[] = [
  {
    id: 'fr-1',
    report_number: 'RPT-FIN-2026-Q3',
    report_title: 'تقرير المشتريات والتسويات المالية للربع الثالث 2026',
    report_type: 'quarterly',
    period_from: '2026-07-01',
    period_to: '2026-09-30',
    total_purchases: 1850000,
    total_disbursements: 1420000,
    budget_allocated: 2500000,
    budget_remaining: 650000,
    status: 'approved',
    approved_by: 'أ.د. نائب رئيس الجامعة للشؤون المالية',
    approved_at: '2026-10-05T12:00:00Z',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
  },
  {
    id: 'fr-2',
    report_number: 'RPT-FIN-2026-M10',
    report_title: 'تقرير المصروفات والتوريدات لشهر أكتوبر 2026',
    report_type: 'monthly',
    period_from: '2026-10-01',
    period_to: '2026-10-31',
    total_purchases: 770000,
    total_disbursements: 615000,
    budget_allocated: 900000,
    budget_remaining: 130000,
    status: 'finalized',
    created_at: '2026-10-27T08:00:00Z',
    updated_at: '2026-10-28T14:30:00Z',
  },
]

function getLocalReports(): FinancialReport[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return DEFAULT_FINANCIAL_REPORTS
}

function saveLocalReports(items: FinancialReport[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchFinancialReports(): Promise<FinancialReport[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('financial_reports')
        .select('*')
        .order('created_at', { ascending: false })
      if (!error && data && data.length > 0) {
        saveLocalReports(data)
        return data
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

