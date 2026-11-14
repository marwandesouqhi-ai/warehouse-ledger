/**
 * خدمة المزامنة اللحظية مع Google Sheets (Real-time Google Sheets Sync)
 * تصدير كافة حركات المخزن فور تسجيلها إلى تبويب AppSheet_DB في شيت جوجل لحظياً
 */

import type { FixtureMovement } from './fixture'
import { WAREHOUSES, guessCategory } from './custody'
import { getCairoDateString } from './dateUtils'

const DEFAULT_WEBHOOK_URL =
  import.meta.env?.VITE_GOOGLE_SHEETS_WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbxqwUjJAaxEKoweSjDtdGTZvfda9AJbj1THAgIk8PWyPdE6nZL8BpIxmHg26inpeAWg/exec'
const STORAGE_KEY = 'google_sheets_webhook_url'
const QUEUE_KEY = 'google_sheets_pending_sync_queue'

function isAllowedAppsScriptWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'script.google.com' &&
      parsed.pathname.startsWith('/macros/s/')
    )
  } catch {
    return false
  }
}

/**
 * الحصول على رابط الويبهوك الحالي (من الإعدادات أو متغيرات البيئة)
 */
export function getGoogleSheetsWebhookUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_WEBHOOK_URL
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored && isAllowedAppsScriptWebhookUrl(stored)) {
    return stored.trim()
  }
  if (stored) {
    window.localStorage.removeItem(STORAGE_KEY)
  }
  return DEFAULT_WEBHOOK_URL
}

/**
 * حفظ أو تحديث رابط الويبهوك (مقيد بنطاق Google Apps Script الرسمي فقط)
 */
export function setGoogleSheetsWebhookUrl(url: string): void {
  if (typeof window === 'undefined') return
  if (!url || url.trim() === '') {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  if (!isAllowedAppsScriptWebhookUrl(url)) {
    throw new Error('عنوان Webhook غير صالح: يسمح فقط بروابط Google Apps Script الرسمية.')
  }
  window.localStorage.setItem(STORAGE_KEY, url.trim())
}

/**
 * تحويل معرف المخزن الداخلي إلى الاسم العربي المعتمد في شيت جوجل
 */
export function resolveWarehouseArabicName(warehouseId?: string): string {
  if (!warehouseId) return 'طب بشري أ'
  
  const cleanId = warehouseId.toLowerCase().trim()
  if (cleanId === 'medicine_a' || cleanId === 'بشري أ' || cleanId === 'طب بشري أ') return 'طب بشري أ'
  if (cleanId === 'medicine' || cleanId === 'طب بشري وتمريض' || cleanId === 'طب بشري و تمريض') return 'طب بشري و تمريض'
  if (cleanId === 'nursing' || cleanId === 'تمريض') return 'تمريض'
  if (cleanId === 'engineering' || cleanId === 'هندسة') return 'هندسة'
  if (cleanId === 'fci' || cleanId === 'حاسبات و معلومات' || cleanId === 'حاسبات') return 'حاسبات و معلومات'
  if (cleanId === 'central_lab' || cleanId === 'معامل مركزية') return 'معامل مركزية'
  if (cleanId === 'engineering_workshops' || cleanId === 'ورش هندسية') return 'ورش هندسية'
  
  const found = WAREHOUSES.find(w => w.id === cleanId)
  return found?.name || 'طب بشري أ'
}

export type SheetMovementPayload = {
  id: string
  warehouse: string
  date: string
  type: 'وارد' | 'منصرف'
  permit: string
  party: string
  item: string
  category: string
  price: number
  qty: number
  total: number
  notes: string
}

/**
 * تحويل حركة من النظام إلى صيغة صف AppSheet_DB
 */
export function formatMovementForSheet(movement: Partial<FixtureMovement>, explicitWarehouse?: string): SheetMovementPayload {
  const isIncoming = Boolean(movement.qin && Number(movement.qin) > 0)
  const qty = Number(isIncoming ? movement.qin : movement.qout) || 0
  const price = typeof movement.price === 'number' ? movement.price : Number(movement.price || 0)
  const total = price * qty
  
  const targetWhId = explicitWarehouse || movement.destWarehouseId || movement.sourceWarehouseId
  const warehouseName = resolveWarehouseArabicName(targetWhId)
  
  const dateStr = String(movement.date || movement.issue || getCairoDateString())
  const party = isIncoming ? String(movement.from || '') : String(movement.to || movement.custodianName || '')
  const category = (movement as { category?: string }).category || guessCategory(movement.item || '')
  
  return {
    id: movement.id ? `TRX-${String(movement.id).slice(-6)}` : `TRX-${Date.now().toString().slice(-6)}`,
    warehouse: warehouseName,
    date: dateStr,
    type: isIncoming ? 'وارد' : 'منصرف',
    permit: String(movement.permit || movement.inv || ''),
    party,
    item: String(movement.item || ''),
    category,
    price,
    qty,
    total,
    notes: String(movement.notes || ''),
  }
}

/**
 * إرسال حركة أو مصفوفة حركات إلى شيت جوجل لحظياً في الخلفية
 */
export async function pushMovementToGoogleSheet(
  movements: Partial<FixtureMovement> | Partial<FixtureMovement>[],
  explicitWarehouse?: string
): Promise<boolean> {
  const webhookUrl = getGoogleSheetsWebhookUrl()
  if (!webhookUrl) {
    // لم يتم إعداد الويبهوك بعد
    return false
  }

  const list = Array.isArray(movements) ? movements : [movements]
  if (list.length === 0) return true

  const payloads = list.map(m => formatMovementForSheet(m, explicitWarehouse))

  try {
    // نستخدم mode: 'no-cors' لتجاوز إعادة توجيه Google Apps Script (302 Redirect) في المتصفح
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloads.length === 1 ? payloads[0] : payloads),
    })
    return true
  } catch (err) {
    console.warn('Google Sheets live sync failed, queuing for offline retry:', err)
    queueFailedPayloads(payloads)
    return false
  }
}

function queueFailedPayloads(payloads: SheetMovementPayload[]): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    const existing: SheetMovementPayload[] = raw ? JSON.parse(raw) : []
    const updated = [...existing, ...payloads]
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(updated.slice(-500)))
  } catch {
    // ignore local storage errors
  }
}

/**
 * إعادة إرسال الحركات المعلقة عند استعادة الاتصال
 */
export async function flushPendingSheetQueue(): Promise<void> {
  if (typeof window === 'undefined') return
  const webhookUrl = getGoogleSheetsWebhookUrl()
  if (!webhookUrl) return

  const raw = window.localStorage.getItem(QUEUE_KEY)
  if (!raw) return

  try {
    const queue: SheetMovementPayload[] = JSON.parse(raw)
    if (!Array.isArray(queue) || queue.length === 0) return

    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queue),
    })

    window.localStorage.removeItem(QUEUE_KEY)
  } catch {
    // keep in queue
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushPendingSheetQueue()
  })
}

