import { supabase } from './supabase'

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

const DEFAULT_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'مرحباً بك في منظومة مخازن جامعة الزقازيق الأهلية',
    body: 'تم تفعيل جميع الموديولات وإتاحة طلبات الصرف المباشرة والمساعد الذكي.',
    type: 'success',
    is_read: false,
    action_url: '/',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'notif-2',
    title: 'تنبيه جرد دوري ربع سنوي',
    body: 'يرجى مراجعة محاضر الجرد والتسوية لجميع المخازن والكليات وتدقيق الفروق.',
    type: 'warning',
    is_read: false,
    action_url: '/reports',
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'notif-3',
    title: 'تحديث بيانات الموردين وعقود التوريد',
    body: 'تمت إضافة موديول إدارة العقود مع إمكانية متابعة تواريخ التجديد والانتهاء.',
    type: 'info',
    is_read: true,
    action_url: '/purchases/contracts',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
]

function getLocalNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return DEFAULT_NOTIFICATIONS
}

function saveLocalNotifications(items: AppNotification[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error && data && data.length > 0) {
        saveLocalNotifications(data)
        return data
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

