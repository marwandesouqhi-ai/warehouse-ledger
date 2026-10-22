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
    UserPlus,
    X,
} from 'lucide-react'

import { fetchAuditLogs, type AuditLogEntry } from '../lib/auditLogger'
import { matchesSearch } from '../lib/searchUtils'
import { checkIsSystemAdmin } from '../lib/supabase'

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

    async function loadLogs() {
        if (!isSystemAdmin) return
        setLoading(true)
        setError('')
        try {
            const data = (await fetchAuditLogs(200)).filter(
                (log) => log.user_email?.toLowerCase() !== 'marwandesouqhi@gmail.com'
            )
            setLogs(data)
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر تحميل سجل العمليات.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (isSystemAdmin) {
            void loadLogs()
        }
    }, [isSystemAdmin])

    const filteredLogs = logs.filter((log) => {
        const matchesType =
            filterType === 'all' ||
            (filterType === 'movement' && (log.entity_type === 'movement' || log.action.includes('حركة'))) ||
            (filterType === 'invitation' && (log.entity_type === 'invitation' || log.action.includes('دعوة'))) ||
            (filterType === 'import' && (log.entity_type === 'import' || log.action.includes('استيراد'))) ||
            (filterType === 'auth' && (log.entity_type === 'auth' || log.action.includes('دخول')))

        if (!matchesType) return false
        if (!searchTerm.trim()) return true

        return matchesSearch(
            [
                log.user_email,
                log.action,
                log.ip_address,
                log.entity_type,
                JSON.stringify(log.details ?? {}),
            ],
            searchTerm
        )
    })

    const todayStr = new Date().toISOString().slice(0, 10)
    const todayCount = logs.filter((l) => l.created_at?.slice(0, 10) === todayStr).length
    const movementsCount = logs.filter((l) => l.entity_type === 'movement' || l.action.includes('حركة')).length
    const invitesCount = logs.filter((l) => l.entity_type === 'invitation' || l.action.includes('دعوة')).length

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

    function getActionTone(action: string, entityType: string) {
        if (action.includes('حذف')) return 'bad'
        if (action.includes('إضافة') || action.includes('دعوة') || entityType === 'invitation') return 'good'
        if (action.includes('تعديل') || action.includes('استيراد')) return 'warn'
        return 'neutral'
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
                    <span className="kpi-label">عمليات الحركات</span>
                    <strong>{movementsCount.toLocaleString('ar-EG')}</strong>
                </div>
                <div className="kpi-item tone-info">
                    <span className="kpi-icon"><UserPlus size={18} /></span>
                    <span className="kpi-label">دعوات ومستخدمين</span>
                    <strong>{invitesCount.toLocaleString('ar-EG')}</strong>
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
                                placeholder="ابحث بالمستخدم، العملية، أو عنوان الـ IP..."
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
                        >
                            <option value="all">كل العمليات</option>
                            <option value="movement">حركات المخزن</option>
                            <option value="invitation">الدعوات والمستخدمين</option>
                            <option value="import">الاستيراد</option>
                            <option value="auth">تسجيل الدخول</option>
                        </select>
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
                                    <th>العملية</th>
                                    <th>عنوان IP الجهاز</th>
                                    <th>الجهاز</th>
                                    <th>التفاصيل</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLogs.map((log) => {
                                    const tone = getActionTone(log.action, log.entity_type)
                                    const isAdmin =
                                        log.user_email === 'marwan-desouky' ||
                                        log.user_email.includes('admin')

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
                                                    <strong>{log.user_email || 'غير مسجل'}</strong>
                                                    {isAdmin && (
                                                        <span className="self-badge">مدير</span>
                                                    )}
                                                </div>
                                            </td>

                                            <td>
                                                <span
                                                 className={`quality-item ${tone} quality-item ${tone} audit-action-pill`}>
                                                    {log.action}
                                                </span>
                                            </td>

                                            <td className="text-ltr">
                                                <span className="audit-ip-tag">
                                                    <Globe size={13} color="var(--accent)" />
                                                    {log.ip_address || '—'}
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
                                                    title={JSON.stringify(log.details)}
                                                >
                                                    {log.details && Object.keys(log.details).length > 0 ? (
                                                        Object.entries(log.details)
                                                            .map(([k, v]) => `${k}: ${String(v)}`)
                                                            .join(' | ')
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
