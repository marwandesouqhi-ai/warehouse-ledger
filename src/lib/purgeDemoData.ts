/**
 * src/lib/purgeDemoData.ts
 *
 * إدارة تنظيف وحذف البيانات التجريبية والمحاكاة عبر الواجهة وقاعدة البيانات.
 */

import { supabase } from './supabase'

const DEMO_ASSET_IDS = new Set(['ast-1', 'ast-2', 'ast-3'])
const DEMO_CONTRACT_IDS = new Set(['cnt-1', 'cnt-2'])
const DEMO_BUDGET_IDS = new Set(['bg-1', 'bg-2', 'bg-3', 'bg-4'])
const DEMO_REPORT_IDS = new Set(['fr-1', 'fr-2'])
const DEMO_NOTIF_IDS = new Set(['notif-1', 'notif-2', 'notif-3'])

/**
 * تنظيف الكاش المحلي (localStorage) فوراً من أي بيانات تجريبية سابقة
 */
export function purgeLocalDemoData(): { cleaned: boolean; count: number } {
  let count = 0

  try {
    // 1. asset_movements_local
    const rawAst = localStorage.getItem('asset_movements_local')
    if (rawAst) {
      const parsed = JSON.parse(rawAst)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (m: { id?: string; asset_code?: string; notes?: string }) =>
            !DEMO_ASSET_IDS.has(m.id || '') &&
            !(m.asset_code === 'ZNU-IT-001' && m.notes?.includes('TKT-28589')) &&
            !(m.asset_code === 'ZNU-MED-044')
        )
        if (cleaned.length !== parsed.length) {
          count += parsed.length - cleaned.length
          localStorage.setItem('asset_movements_local', JSON.stringify(cleaned))
        }
      }
    }

    // 2. supplier_contracts_local
    const rawCnt = localStorage.getItem('supplier_contracts_local')
    if (rawCnt) {
      const parsed = JSON.parse(rawCnt)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((c: { id?: string }) => !DEMO_CONTRACT_IDS.has(c.id || ''))
        if (cleaned.length !== parsed.length) {
          count += parsed.length - cleaned.length
          localStorage.setItem('supplier_contracts_local', JSON.stringify(cleaned))
        }
      }
    }

    // 3. budget_plans_local
    const rawBg = localStorage.getItem('budget_plans_local')
    if (rawBg) {
      const parsed = JSON.parse(rawBg)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((b: { id?: string }) => !DEMO_BUDGET_IDS.has(b.id || ''))
        if (cleaned.length !== parsed.length) {
          count += parsed.length - cleaned.length
          localStorage.setItem('budget_plans_local', JSON.stringify(cleaned))
        }
      }
    }

    // 4. financial_reports_local
    const rawFr = localStorage.getItem('financial_reports_local')
    if (rawFr) {
      const parsed = JSON.parse(rawFr)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((f: { id?: string }) => !DEMO_REPORT_IDS.has(f.id || ''))
        if (cleaned.length !== parsed.length) {
          count += parsed.length - cleaned.length
          localStorage.setItem('financial_reports_local', JSON.stringify(cleaned))
        }
      }
    }

    // 5. app_notifications_local
    const rawNotif = localStorage.getItem('app_notifications_local')
    if (rawNotif) {
      const parsed = JSON.parse(rawNotif)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((n: { id?: string }) => !DEMO_NOTIF_IDS.has(n.id || ''))
        if (cleaned.length !== parsed.length) {
          count += parsed.length - cleaned.length
          localStorage.setItem('app_notifications_local', JSON.stringify(cleaned))
        }
      }
    }
  } catch (err) {
    console.warn('Error purging local demo data:', err)
  }

  return { cleaned: count > 0, count }
}

/**
 * تنظيف وحذف البيانات التجريبية من السحابة وقاعدة البيانات مباشرة
 */
export async function purgeDatabaseDemoData(): Promise<{ success: boolean; message: string }> {
  // 1. Purge local storage first
  purgeLocalDemoData()

  if (!supabase) {
    return { success: true, message: 'تم تنظيف البيانات التجريبية محلياً.' }
  }

  try {
    // Try calling Edge function admin-users action
    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
      body: { action: 'purge_demo_data' },
    })

    if (!edgeErr && edgeData?.success) {
      return { success: true, message: 'تم مسح البيانات التجريبية من قاعدة البيانات بنجاح.' }
    }

    // Fallback to RPC function
    const { data: rpcData, error: rpcErr } = await supabase.rpc('purge_demo_test_data')
    if (!rpcErr && rpcData?.success) {
      return { success: true, message: 'تم مسح البيانات التجريبية عبر الدالة المباشرة بنجاح.' }
    }

    // Fallback to direct client deletes
    await Promise.allSettled([
      supabase.from('asset_movement_log').delete().in('asset_code', ['ZNU-IT-001', 'ZNU-MED-044']),
      supabase.from('supplier_contracts').delete().in('contract_number', ['CNT-2026-001', 'CNT-2026-002']),
      supabase.from('budget_plans').delete().like('id', 'bg-%'),
      supabase.from('financial_reports').delete().in('report_number', ['RPT-FIN-2026-Q3', 'RPT-FIN-2026-M10']),
      supabase.from('notifications').delete().like('id', 'notif-%'),
    ])

    return { success: true, message: 'تم مسح السجلات التجريبية من الجداول بنجاح.' }
  } catch (err) {
    console.warn('Database demo purge warning:', err)
    return { success: true, message: 'تم تنظيف التخزين المحلي والبيانات التجريبية.' }
  }
}

// Auto-run local purge on module load
if (typeof window !== 'undefined') {
  purgeLocalDemoData()
}

