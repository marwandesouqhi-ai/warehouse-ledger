import { useState, useEffect, useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bell,
  Check,
  CheckCheck,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ClipboardList,
  RotateCw,
  ExternalLink,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { isSafeInternalRoute } from '../lib/security'
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type AppNotification,
} from '../lib/notificationsRepository'

type NotificationsPageProps = {
  session?: Session | null
}

const TYPE_CONFIG = {
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40', label: 'معلومة' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', label: 'تنبيه' },
  success: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', label: 'نجاح' },
  error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/40', label: 'خطأ' },
  request: { icon: ClipboardList, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/40', label: 'طلب صرف' },
  ticket: { icon: Bell, color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/40', label: 'دعم فني' },
}

export default function NotificationsPage(_props: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'important'>('all')

  const loadNotifications = async () => {
    setIsLoading(true)
    try {
      const data = await fetchNotifications()
      setNotifications(data)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadNotifications()
  }, [])

  const handleMarkAsRead = async (id: string) => {
    await markNotificationAsRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
  }

  const handleMarkAllRead = async () => {
    await markAllNotificationsAsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (activeTab === 'unread') return !n.is_read
      if (activeTab === 'important') return n.type === 'warning' || n.type === 'error'
      return true
    })
  }, [notifications, activeTab])

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.is_read).length
  }, [notifications])

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <Bell size={24} />
        </div>
        <div>
          <p className="eyebrow">التنبيهات والمتابعة • جامعة الزقازيق الأهلية</p>
          <h2>نظام الإشعارات والتنبيهات</h2>
          <p>متابعة التحديثات، طلبات الصرف الجديدة، تذاكر الدعم، وتنبيهات المخزون والجرد</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button type="button" className="secondary-btn" onClick={loadNotifications} disabled={isLoading}>
            <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} /> تحديث
          </button>
          {unreadCount > 0 && (
            <button type="button" className="primary-btn" onClick={handleMarkAllRead}>
              <CheckCheck size={16} /> تحديد الكل كمقروء
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between border-b pb-3 mb-4 flex-wrap gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              className={`filter-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              جميع الإشعارات ({notifications.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeTab === 'unread' ? 'active' : ''}`}
              onClick={() => setActiveTab('unread')}
            >
              غير المقروءة ({unreadCount})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeTab === 'important' ? 'active' : ''}`}
              onClick={() => setActiveTab('important')}
            >
              الهامة والحرجة
            </button>
          </div>

          <span className="text-sm text-muted">
            {unreadCount > 0 ? `لديك ${unreadCount} إشعار جديد بحاجة للمتابعة` : 'جميع الإشعارات مقروءة'}
          </span>
        </div>

        {/* Notifications List */}
        <div className="space-y-3">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <Bell size={36} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد إشعارات لعرضها في هذا التبويب.</p>
            </div>
          ) : (
            filteredNotifications.map((notif) => {
              const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.info
              const IconComponent = cfg.icon

              return (
                <div
                  key={notif.id}
                  className={`p-4 rounded-xl border transition-all flex items-start gap-4 ${
                    notif.is_read
                      ? 'bg-card border-border/60 opacity-80'
                      : 'bg-primary/5 border-primary/20 shadow-sm'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 ${cfg.bg}`}>
                    <IconComponent size={20} className={cfg.color} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-base">{notif.title}</h4>
                        {!notif.is_read && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" title="إشعار غير مقروء" />
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted/30 text-muted">{cfg.label}</span>
                      </div>
                      <time className="text-xs text-muted whitespace-nowrap">
                        {new Date(notif.created_at).toLocaleString('ar-EG')}
                      </time>
                    </div>

                    <p className="text-sm text-muted leading-relaxed mb-3">{notif.body}</p>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                      {notif.action_url && isSafeInternalRoute(notif.action_url) ? (
                        <Link
                          to={notif.action_url}
                          onClick={() => handleMarkAsRead(notif.id)}
                          className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
                        >
                          <span>عرض التفاصيل والانتقال</span>
                          <ExternalLink size={13} />
                        </Link>
                      ) : (
                        <span />
                      )}

                      {!notif.is_read && (
                        <button
                          type="button"
                          onClick={() => handleMarkAsRead(notif.id)}
                          className="text-muted hover:text-foreground inline-flex items-center gap-1"
                        >
                          <Check size={14} /> تحديد كمقروء
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

