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

type CloudNotification = Omit<AppNotification, 'is_read'> & { read_by?: string[] | null }

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase!.auth.getSession()
    return data.session?.user.id ?? null
  } catch {
    return null
  }
}

/** Notifications are created server-side by database triggers on real events (see app_notifications migration). */
export async function fetchNotifications(): Promise<AppNotification[]> {
  // Always clean local demo cache first
  purgeLocalDemoData()

  if (supabase) {
    try {
      const uid = await currentUserId()
      const { data, error } = await supabase
        .from('app_notifications')
        .select('id, user_id, title, body, type, action_url, related_id, related_type, created_at, read_by')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error && Array.isArray(data)) {
        const mapped: AppNotification[] = (data as CloudNotification[]).map(({ read_by, ...n }) => ({
          ...n,
          is_read: Boolean(uid && Array.isArray(read_by) && read_by.includes(uid)),
        }))
        saveLocalNotifications(mapped)
        return mapped
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
      await supabase.rpc('mark_notification_read', { p_id: id })
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
      await supabase.rpc('mark_all_notifications_read')
    } catch {
      // fallback
    }
  }
  const local = getLocalNotifications()
  saveLocalNotifications(local.map((n) => ({ ...n, is_read: true })))
}

/** Local-only notice (e.g. offline feedback). Server events are created by database triggers. */
export async function createNotification(
  item: Omit<AppNotification, 'id' | 'created_at' | 'is_read'>
): Promise<AppNotification> {
  const newNotif: AppNotification = {
    ...item,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    is_read: false,
    created_at: new Date().toISOString(),
  }
  const local = getLocalNotifications()
  saveLocalNotifications([newNotif, ...local])
  return newNotif
}

export async function deleteNotification(id: string): Promise<void> {
  if (supabase) {
    try {
      await supabase.from('app_notifications').delete().eq('id', id)
    } catch {
      // fallback
    }
  }
  const local = getLocalNotifications()
  saveLocalNotifications(local.filter((n) => n.id !== id))
}
