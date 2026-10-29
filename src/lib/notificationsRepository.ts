import { supabase } from './supabase'
import { purgeLocalDemoData } from './purgeDemoData'

export type AppNotification = {
  id: string
  user_id?: string
  title: string
  body: string
  type: 'info' | 'warning' | 'success' | 'error' | 'request' | 'ticket'
  is_read: boolean
  action_url?: string
  related_id?: string
  related_type?: string
  created_at: string
}

const LOCAL_STORAGE_KEY = 'app_notifications_local'

// Empty default - no mock or demo items
const DEFAULT_NOTIFICATIONS: AppNotification[] = []

const DEMO_NOTIF_IDS = new Set(['notif-1', 'notif-2', 'notif-3'])

export function getLocalNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return DEFAULT_NOTIFICATIONS
    const parsed: AppNotification[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_NOTIFICATIONS
    const cleaned = parsed.filter((n) => !DEMO_NOTIF_IDS.has(n.id))
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleaned))
    }
    return cleaned
  } catch {
    return DEFAULT_NOTIFICATIONS
  }
}

export function saveLocalNotifications(items: AppNotification[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error && Array.isArray(data)) {
        const cleaned = data.filter((n: AppNotification) => !DEMO_NOTIF_IDS.has(n.id))
        saveLocalNotifications(cleaned)
        return cleaned
      }
    } catch {
      // fallback
    }
  }
  return getLocalNotifications()
}

export async function markNotificationAsRead(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalNotifications()
  saveLocalNotifications(local.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
}

export async function markAllNotificationsAsRead(): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    } catch {
      // fallback
    }
  }
  const local = getLocalNotifications()
  saveLocalNotifications(local.map((n) => ({ ...n, is_read: true })))
}

export async function createNotification(
  item: Omit<AppNotification, 'id' | 'created_at' | 'is_read'>
): Promise<AppNotification> {
  const newNotif: AppNotification = {
    ...item,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    is_read: false,
    created_at: new Date().toISOString(),
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('notifications').insert([newNotif]).select().single()
      if (!error && data) {
        const local = getLocalNotifications()
        saveLocalNotifications([data, ...local])
        return data
      }
    } catch {
      // fallback
    }
  }

  const local = getLocalNotifications()
  saveLocalNotifications([newNotif, ...local])
  return newNotif
}

export async function deleteNotification(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('notifications').delete().eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalNotifications()
  saveLocalNotifications(local.filter((n) => n.id !== id))
}
