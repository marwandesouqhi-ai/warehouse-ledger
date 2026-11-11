import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
    Activity,
    ArrowLeft,
    Clock,
    Globe,
    History,
    Laptop,
    Package,
    RefreshCw,
    Search,
    ShieldAlert,
    User,
    X,
    ShoppingCart,
    HardDriveDownload,
} from 'lucide-react'

import { fetchAuditLogs, type AuditLogEntry } from '../lib/auditLogger'
import { matchesSearch } from '../lib/searchUtils'
import { checkIsSystemAdmin, supabase } from '../lib/supabase'
import { getCairoDateString } from '../lib/dateUtils'

type AuditLogPageProps = {
    session?: Session | null
}

export default function AuditLogPage({ session }: AuditLogPageProps) {
    const isSystemAdmin = checkIsSystemAdmin(session)
    const [logs, setLogs] = useState<AuditLogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [searchTerm, setSearchTerm] = useState('')
    const [filterType, setFilterType] = useState('all')
    const [filterSeverity, setFilterSeverity] = useState<'all' | 'info' | 'warning' | 'critical'>('all')
    const [filterUser, setFilterUser] = useState('all')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    async function loadLogs() {
        if (!isSystemAdmin) return
        setLoading(true)
        setError('')
        try {
            const data = await fetchAuditLogs(1000)
            setLogs(data)
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر تحميل سجل العمليات.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!isSystemAdmin) return
        void loadLogs()

        // 1. استماع فوري لأي أحداث داخلية متزامنة في نفس اللحظة
        const handleLogChange = () => {
            void loadLogs()
        }
        window.addEventListener('audit-logs-changed', handleLogChange)

        // 2. اشتراك لحظي في قناة Supabase Realtime لسجل المراقبة
        let channel: any = null
        if (supabase) {
            try {
                channel = supabase
                    .channel('audit-logs-live-sync')
                    .on(
                        'postgres_changes',
                        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
                        () => {
                            void loadLogs()
                        }
                    )
                    .subscribe()
            } catch (err) {
                console.warn('Realtime subscription failed:', err)
            }
        }

        return () => {
            window.removeEventListener('audit-logs-changed', handleLogChange)
            if (channel && supabase) {
                supabase.removeChannel(channel)
            }
        }
    }, [isSystemAdmin])

    const distinctUsers = Array.from(
        new Set(
            logs
                .map((l) => (l.user_email || l.user_id || l.actor_id || '').trim())
                .filter(Boolean)
        )
    ).sort((a, b) => a.localeCompare(b))

    function getLogDateYmd(createdAt?: string): string {
        if (!createdAt) return ''
        const parsed = new Date(createdAt)
        if (Number.isNaN(parsed.getTime())) return createdAt.slice(0, 10)
        return getCairoDateString(parsed)
    }

    const filteredLogs = logs.filter((log) => {
        const ev = (log.event_type || '').toLowerCase()
        const act = (log.action || '').toLowerCase()
        const ent = (log.entity_type || '').toLowerCase()
        const sev = (log.severity || 'info').toLowerCase()

        const matchesType =
            filterType === 'all' ||
            (filterType === 'movement' && (ent === 'movement' || ent === 'disbursement' || ev.includes('movements') || ev.includes('disbursement') || act.includes('حركة') || act.includes('صرف') || act.includes('إذن'))) ||
            (filterType === 'procurement' && (ent === 'procurement' || ent === 'purchase_request' || ent === 'contract' || ent === 'quote' || ev.includes('purchase') || ev.includes('supplier') || act.includes('شراء') || act.includes('مورد') || act.includes('عقد') || act.includes('عرض أسعار'))) ||
            (filterType === 'repair' && (ent === 'repair' || ent === 'quality' || act.includes('إصلاح') || act.includes('جودة') || act.includes('تنظيف'))) ||
            (filterType === 'backup' && (ent === 'backup' || act.includes('نسخ') || act.includes('استعادة'))) ||
            (filterType === 'invitation' && (ent === 'invitation' || ent === 'user' || ent === 'user_management' || ev.includes('app_users') || act.includes('دعوة') || act.includes('مستخدم'))) ||
            (filterType === 'import' && (ent === 'import' || act.includes('استيراد'))) ||
            (filterType === 'auth' && (ent === 'auth' || ev.includes('login') || ev.includes('logout') || act.includes('دخول') || act.includes('خروج'))) ||
            (filterType === 'failed_login' && (ev.includes('failed_login') || ev.includes('brute_force') || act.includes('دخول فاشل') || act.includes('تخمين'))) ||
            (filterType === 'role_change' && (ev.includes('role_permission') || ev.includes('delegation_setting') || act.includes('صلاحيات') || act.includes('دور'))) ||
            (filterType === 'unauthorized' && (ev.includes('unauthorized') || ev.includes('cross_user') || act.includes('غير مصرح') || act.includes('مرفوض'))) ||
            (filterType === 'mass_delete' && (ev === 'mass_delete' || ev.startsWith('delete_') || act.includes('حذف')))

        if (!matchesType) return false

        if (filterSeverity !== 'all' && sev !== filterSeverity) return false

        const actorValue = (log.user_email || log.user_id || log.actor_id || '').trim()
        if (filterUser !== 'all' && actorValue !== filterUser) return false

        if (dateFrom || dateTo) {
            const logDay = getLogDateYmd(log.created_at)
            if (dateFrom && (!logDay || logDay < dateFrom)) return false
            if (dateTo && (!logDay || logDay > dateTo)) return false
        }

        if (!searchTerm.trim()) return true

        return matchesSearch(
            [
                log.user_email,
                log.user_id ?? '',
                log.actor_id ?? '',
                log.actor_role ?? '',
                log.event_type ?? '',
                log.table_name ?? '',
                log.record_id ?? '',
                log.action,
                log.ip || log.ip_address,
                log.entity_type,
                log.severity ?? '',
                JSON.stringify(log.details ?? {}),
                JSON.stringify(log.old_data ?? {}),
                JSON.stringify(log.new_data ?? {}),
            ],
            searchTerm
        )
    })

    const hasActiveFilters = Boolean(
        searchTerm.trim() ||
        filterType !== 'all' ||
        filterSeverity !== 'all' ||
        filterUser !== 'all' ||
        dateFrom ||
        dateTo
    )

    function resetFilters() {
        setSearchTerm('')
        setFilterType('all')
        setFilterSeverity('all')
        setFilterUser('all')
        setDateFrom('')
        setDateTo('')
    }

    const todayStr = getCairoDateString()
    const todayCount = logs.filter((l) => getLogDateYmd(l.created_at) === todayStr).length
    const movementsCount = logs.filter((l) => l.entity_type === 'movement' || l.entity_type === 'disbursement' || l.action.includes('حركة') || l.action.includes('صرف')).length
    const procurementCount = logs.filter((l) => l.entity_type === 'procurement' || l.entity_type === 'purchase_request' || l.entity_type === 'contract' || l.action.includes('شراء') || l.action.includes('عقد')).length
    const backupRepairCount = logs.filter((l) => l.entity_type === 'backup' || l.entity_type === 'repair' || l.action.includes('نسخ') || l.action.includes('إصلاح')).length
    const criticalCount = logs.filter((l) => (l.severity || '').toLowerCase() === 'critical').length

    function formatTime(isoString: string) {
        try {
            const date = new Date(isoString)
            return new Intl.DateTimeFormat('ar-EG', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }).format(date)
        } catch {
            return isoString
        }
    }

    function formatDevice(userAgent: string) {
        if (!userAgent) return 'غير محدد'
        if (userAgent.includes('Windows')) return 'Windows PC'
        if (userAgent.includes('Macintosh')) return 'Mac'
        if (userAgent.includes('Android')) return 'Android'
        if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS'
        if (userAgent.includes('Linux')) return 'Linux'
        return 'متصفح ويب'
    }

    function getActionTone(action: string, entityType: string, severity?: string) {
        if (severity === 'critical') return 'bad'
        if (severity === 'warning') return 'warn'
        if (action.includes('حذف')) return 'bad'
        if (action.includes('إضافة') || action.includes('دعوة') || entityType === 'invitation') return 'good'
        if (action.includes('تعديل') || action.includes('استيراد')) return 'warn'
        return 'neutral'
    }

    function getSeverityLabel(severity?: string) {
        switch ((severity || 'info').toLowerCase()) {
            case 'critical':
                return { text: 'حرج', tone: 'bad' }
            case 'warning':
                return { text: 'تحذير', tone: 'warn' }
            default:
                return { text: 'عادي', tone: 'info' }
        }
    }

    if (!isSystemAdmin) {
        return (
            <section className="page-stack audit-page">
                <header className="page-intro">
                    <div className="page-intro-icon modal-icon-danger">
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow text-bad">منطقة مراقبة مقيدة</p>
                        <h2>سجل العمليات والتدقيق (Audit Log)</h2>
                        <p>خاص ومقتصر على إدارة النظام لحماية سرية وأمان العمليات.</p>
                    </div>
                </header>

                <div className="card-surface audit-restricted-card">
                    <div className="audit-restricted-icon">
                        <ShieldAlert size={34} />
                    </div>
                    <h3 className="m-0 mb-2 text-lg text-ink">
                        صلاحية وصول مقيدة لمدير النظام فقط
                    </h3>
                    <p className="text-muted font-sm leading-normal mb-5">
                        عذراً، سجل المراقبة والتدقيق مخصص حصرياً لحسابات <strong>مدير النظام (System Administrator)</strong> للاطلاع على العمليات والأنشطة الإدارية. لا يملك حسابك الحالي الصلاحيات الكافية لاستعراض هذا السجل.
                    </p>
                    <Link to="/" className="primary-btn inline-flex items-center gap-2">
                        العودة إلى لوحة التحكم
                        <ArrowLeft size={16} />
                    </Link>
                </div>
            </section>
        )
    }

    return (
        <section className="page-stack audit-page">
            <header className="page-intro">
                <div className="page-intro-icon">
                    <History size={22} />
                </div>
                <div>
                    <p className="eyebrow">الأمان والرقابة</p>
                    <h2>سجل العمليات والتدقيق (Audit Log)</h2>
                    <p>تتبع فوري لكافة حركات النظام، المستخدمين، وعناوين IP للأجهزة المنفذة للعمليات.</p>
                </div>
            </header>

            <div className="kpi-block kpi-grid-fit">
                <div className="kpi-item tone-primary">
                    <span className="kpi-icon"><Activity size={18} /></span>
                    <span className="kpi-label">إجمالي العمليات</span>
                    <strong>{logs.length.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-success">
                    <span className="kpi-icon"><Clock size={18} /></span>
                    <span className="kpi-label">عمليات اليوم</span>
                    <strong>{todayCount.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-neutral">
                    <span className="kpi-icon"><Package size={18} /></span>
                    <span className="kpi-label">المخزن وحركات الصرف</span>
                    <strong>{movementsCount.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-info">
                    <span className="kpi-icon"><ShoppingCart size={18} /></span>
                    <span className="kpi-label">المشتريات والتعاقدات</span>
                    <strong>{procurementCount.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-primary">
                    <span className="kpi-icon"><HardDriveDownload size={18} /></span>
                    <span className="kpi-label">النسخ الاحتياطي والإصلاح</span>
                    <strong>{backupRepairCount.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-warning">
                    <span className="kpi-icon"><ShieldAlert size={18} /></span>
                    <span className="kpi-label">أحداث أمنية حرجة</span>
                    <strong>{criticalCount.toLocaleString('ar-EG')}</strong>
                </div>
            </div>

            <div className="card-surface audit-table-wrapper p-5">
                <div className="section-head mb-4 flex-wrap gap-3">
                    <div className="audit-toolbar">
                        <div className="toolbar-search audit-search-box">
                            <Search size={16} />
                            <input
                                type="search"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="ابحث بالمستخدم، العملية، الجدول، أو عنوان الـ IP..."
                                aria-label="ابحث في سجل العمليات"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    className="audit-clear-btn"
                                    title="مسح البحث"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <select
                            value={filterType}
                            onChange={(event) => setFilterType(event.target.value)}
                            className="audit-type-select"
                            aria-label="تصفية حسب نوع الحدث"
                        >
                            <option value="all">كل العمليات والأحداث</option>
                            <option value="auth">تسجيل الدخول والخروج</option>
                            <option value="failed_login">محاولات الدخول الفاشلة</option>
                            <option value="role_change">تغييرات الأدوار والصلاحيات</option>
                            <option value="unauthorized">محاولات الوصول غير المصرح</option>
                            <option value="mass_delete">عمليات الحذف</option>
                            <option value="movement">حركات المخزن وأذونات الصرف</option>
                            <option value="procurement">إدارة المشتريات والعروض والعقود</option>
                            <option value="repair">الإصلاح الذاتي وفحص الجودة</option>
                            <option value="backup">النسخ الاحتياطي والاستعادة</option>
                            <option value="invitation">المستخدمون والدعوات</option>
                            <option value="import">استيراد البيانات</option>
                        </select>

                        <select
                            value={filterSeverity}
                            onChange={(event) => setFilterSeverity(event.target.value as 'all' | 'info' | 'warning' | 'critical')}
                            className="audit-type-select"
                            aria-label="تصفية حسب درجة الخطورة"
                        >
                            <option value="all">كل درجات الخطورة</option>
                            <option value="critical">حرج (Critical)</option>
                            <option value="warning">تحذير (Warning)</option>
                            <option value="info">عادي (Info)</option>
                        </select>

                        <select
                            value={filterUser}
                            onChange={(event) => setFilterUser(event.target.value)}
                            className="audit-type-select"
                            aria-label="تصفية حسب المستخدم"
                        >
                            <option value="all">كل المستخدمين</option>
                            {distinctUsers.map((u) => (
                                <option key={u} value={u}>
                                    {u}
                                </option>
                            ))}
                        </select>

                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(event) => setDateFrom(event.target.value)}
                            className="audit-type-select"
                            aria-label="من تاريخ"
                            title="من تاريخ"
                        />

                        <input
                            type="date"
                            value={dateTo}
                            onChange={(event) => setDateTo(event.target.value)}
                            className="audit-type-select"
                            aria-label="إلى تاريخ"
                            title="إلى تاريخ"
                        />

                        {hasActiveFilters && (
                            <button
                                type="button"
                                onClick={resetFilters}
                                className="secondary-btn btn-sm inline-flex items-center gap-1"
                            >
                                <X size={14} />
                                مسح الفلاتر
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={loadLogs}
                        disabled={loading}
                     className="secondary-btn btn-sm inline-flex items-center gap-1">
                        <RefreshCw size={15} className={loading ? 'spin' : ''} />
                        تحديث السجل
                    </button>
                </div>

                {error && <div className="inline-message error mb-3" role="alert">{error}</div>}

                {loading ? (
                    <div className="text-center p-8 text-muted">
                        <RefreshCw size={24} className="spin mx-auto mb-2 block" />
                        <p>جارٍ تحميل سجل العمليات...</p>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="text-center p-8 text-muted">
                        <History size={36} className="mx-auto mb-2 block opacity-50" />
                        <h3>لا توجد عمليات مطابقة</h3>
                        <p>سيبدأ تسجيل العمليات تلقائياً فور تنفيذ أي إجراء في النظام.</p>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="audit-table">
                            <thead>
                                <tr>
                                    <th>الوقت والتاريخ</th>
                                    <th>المستخدم</th>
                                    <th>درجة الخطورة</th>
                                    <th>العملية / الحدث</th>
                                    <th>عنوان IP الجهاز</th>
                                    <th>الجهاز</th>
                                    <th>التفاصيل والبيانات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLogs.map((log) => {
                                    const tone = getActionTone(log.action, log.entity_type, log.severity)
                                    const sevBadge = getSeverityLabel(log.severity)
                                    const isAdmin =
                                        log.user_email === 'marwan-desouky' ||
                                        log.user_email.includes('admin') ||
                                        log.actor_role === 'system_admin'
                                    const displayIp = log.ip || log.ip_address || '—'
                                    const summaryParts: string[] = []
                                    if (log.event_type) summaryParts.push(`type=${log.event_type}`)
                                    if (log.table_name) summaryParts.push(`table=${log.table_name}`)
                                    if (log.record_id) summaryParts.push(`id=${log.record_id}`)
                                    if (log.details && Object.keys(log.details).length > 0) {
                                        for (const [k, v] of Object.entries(log.details)) {
                                            summaryParts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                        }
                                    }
                                    if (log.old_data) summaryParts.push(`old: ${JSON.stringify(log.old_data)}`)
                                    if (log.new_data) summaryParts.push(`new: ${JSON.stringify(log.new_data)}`)

                                    return (
                                        <tr key={log.id}>
                                            <td className="nowrap text-muted">
                                                <span className="inline-flex items-center gap-1">
                                                    <Clock size={13} />
                                                    {formatTime(log.created_at)}
                                                </span>
                                            </td>

                                            <td>
                                                <div className="flex items-center gap-1">
                                                    <User size={15} color="var(--accent)" />
                                                    <strong>{log.user_email || log.user_id || 'غير مسجل'}</strong>
                                                    {log.actor_role && (
                                                        <span className="text-muted font-xs">({log.actor_role})</span>
                                                    )}
                                                    {isAdmin && (
                                                        <span className="self-badge">مدير</span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="nowrap">
                                                <span className={`quality-item ${sevBadge.tone} audit-action-pill`}>
                                                    {sevBadge.text}
                                                </span>
                                            </td>

                                            <td>
                                                <span className={`quality-item ${tone} audit-action-pill`}>
                                                    {log.action}
                                                </span>
                                            </td>

                                            <td className="text-ltr">
                                                <span className="audit-ip-tag">
                                                    <Globe size={13} color="var(--accent)" />
                                                    {displayIp}
                                                </span>
                                            </td>

                                            <td className="text-muted nowrap">
                                                <span className="inline-flex items-center gap-1">
                                                    <Laptop size={14} />
                                                    {formatDevice(log.user_agent)}
                                                </span>
                                            </td>

                                            <td className="truncate-cell">
                                                <div
                                                    className="audit-details-text"
                                                    title={summaryParts.join(' | ')}
                                                >
                                                    {summaryParts.length > 0 ? (
                                                        summaryParts.join(' | ')
                                                    ) : (
                                                        <span className="text-muted">—</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    )
}
