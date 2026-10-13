import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
    Check,
    CheckCircle2,
    Copy,
    Edit2,
    Eye,
    EyeOff,
    KeyRound,
    Lock,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Trash2,
    UserCheck,
    UserPlus,
    UsersRound,
    X,
} from 'lucide-react'

import { matchesSearch } from '../lib/searchUtils'
import { checkIsSystemAdmin } from '../lib/supabase'
import { logAuditEvent } from '../lib/auditLogger'
import {
    ASSIGNABLE_ROLES,
    ROLE_LABELS,
    PERMISSION_LABELS,
    type Permission,
    type EffectiveRole,
} from '../lib/permissions'
import {
    addLocalUser,
    changeUserPassword,
    deleteLocalUser,
    generateActivationPin,
    getLocalSession,
    isProtectedUser,
    loadLocalUsers,
    purgeDeletedAccount,
    updateLocalUser,
    type LocalUser,
    type UserRole,
} from '../lib/localUsers'

type UsersPageProps = {
    session?: Session | null
}

export default function UsersPage({ session }: UsersPageProps) {
    purgeDeletedAccount('marwandesouqhi@gmail.com')
    const isSystemAdmin = checkIsSystemAdmin(session)
    const localSess = getLocalSession()
    const activeUserEmail = (
        localSess?.user?.user_metadata?.username ||
        localSess?.user?.email ||
        session?.user?.user_metadata?.username ||
        session?.user?.email ||
        'marwan-desouky'
    )
    const currentSession = localSess || session

    // Local Users State
    const [localUsers, setLocalUsers] = useState<LocalUser[]>(loadLocalUsers)
    const [userSearchTerm, setUserSearchTerm] = useState('')

    // Add User Form State
    const [newUsername, setNewUsername] = useState('')
    const [newDisplayName, setNewDisplayName] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [newRole, setNewRole] = useState<UserRole>('editor')
    const [newPermissions, setNewPermissions] = useState<string[]>([])
    const [newActivationCode, setNewActivationCode] = useState(() => generateActivationPin())
    const [newRequireActivation, setNewRequireActivation] = useState(false)
    const [newNotes, setNewNotes] = useState('')
    const [addSuccess, setAddSuccess] = useState('')
    const [addError, setAddError] = useState('')
    const [copiedPin, setCopiedPin] = useState(false)

    // Edit User Modal State
    const [editingUser, setEditingUser] = useState<LocalUser | null>(null)
    const [editDisplayName, setEditDisplayName] = useState('')
    const [editRole, setEditRole] = useState<UserRole>('editor')
    const [editPermissions, setEditPermissions] = useState<string[]>([])
    const [editPassword, setEditPassword] = useState('')
    const [showEditPassword, setShowEditPassword] = useState(false)
    const [editActivationCode, setEditActivationCode] = useState('')
    const [editStatus, setEditStatus] = useState<'active' | 'pending_activation'>('active')
    const [editError, setEditError] = useState('')

    // Delete confirmation modal state
    const [deletingUser, setDeletingUser] = useState<LocalUser | null>(null)

    // Quick Admin Password Change Modal State
    const [pwdModalUser, setPwdModalUser] = useState<LocalUser | null>(null)
    const [modalNewPassword, setModalNewPassword] = useState('')
    const [showModalNewPassword, setShowModalNewPassword] = useState(false)
    const [pwdModalError, setPwdModalError] = useState('')
    const [pwdModalSuccess, setPwdModalSuccess] = useState('')
    const [pwdModalSaving, setPwdModalSaving] = useState(false)

    // Self Password Change State
    const [selfPassword, setSelfPassword] = useState('')
    const [selfConfirm, setSelfConfirm] = useState('')
    const [showSelfPassword, setShowSelfPassword] = useState(false)
    const [selfPasswordSaving, setSelfPasswordSaving] = useState(false)
    const [selfPasswordSuccess, setSelfPasswordSuccess] = useState('')
    const [selfPasswordError, setSelfPasswordError] = useState('')

    function reloadUsers() {
        setLocalUsers(loadLocalUsers())
    }

    useEffect(() => {
        window.addEventListener('local-users-changed', reloadUsers)
        return () => window.removeEventListener('local-users-changed', reloadUsers)
    }, [])

    function generateRandomPassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
        let pwd = ''
        for (let i = 0; i < 8; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setNewPassword(pwd)
    }

    function handleAddUser(e: React.FormEvent) {
        e.preventDefault()
        setAddError('')
        setAddSuccess('')
        setCopiedPin(false)

        try {
            const added = addLocalUser({
                username: newUsername,
                displayName: newDisplayName,
                password: newPassword,
                role: newRole,
                activationCode: newActivationCode,
                requireActivation: newRequireActivation,
                notes: newNotes,
                permissions: newPermissions,
            })

            reloadUsers()
            setAddSuccess(`تمت إضافة المستخدم "${added.username}" بنجاح! كود تأكيد التفعيل: ${added.activationCode}`)
            void logAuditEvent({
                action: `إضافة مستخدم جديد: ${added.username} (الدور: ${ROLE_LABELS[added.role as EffectiveRole] || added.role})`,
                entity_type: 'user',
                details: { username: added.username, role: added.role, permissions: added.permissions },
                user: currentSession?.user,
            })
            setNewUsername('')
            setNewDisplayName('')
            setNewPassword('')
            setNewNotes('')
            setNewPermissions([])
            setNewActivationCode(generateActivationPin())
            setNewRequireActivation(false)
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'تعذر إضافة المستخدم.')
        }
    }

    function handleOpenEdit(user: LocalUser) {
        setEditingUser(user)
        setEditDisplayName(user.displayName)
        setEditRole(user.role)
        setEditPermissions(user.permissions || [])
        setEditPassword('')
        setEditActivationCode(user.activationCode)
        setEditStatus(user.status)
        setEditError('')
        setShowEditPassword(false)
    }

    function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault()
        if (!editingUser) return
        setEditError('')

        try {
            updateLocalUser(editingUser.id, {
                displayName: editDisplayName,
                role: editRole,
                permissions: editPermissions,
                activationCode: editActivationCode.trim(),
                status: editStatus,
                ...(editPassword ? { password: editPassword } : {}),
            })

            reloadUsers()
            void logAuditEvent({
                action: `تعديل بيانات وصلاحيات المستخدم: ${editingUser.username}`,
                entity_type: 'user',
                details: {
                    username: editingUser.username,
                    oldRole: editingUser.role,
                    newRole: editRole,
                    oldPermissions: editingUser.permissions,
                    newPermissions: editPermissions,
                    passwordUpdated: Boolean(editPassword),
                },
                user: currentSession?.user,
            })
            setEditingUser(null)
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'تعذر حفظ التعديلات.')
        }
    }

    function handleToggleStatus(user: LocalUser) {
        try {
            const nextStatus = user.status === 'active' ? 'pending_activation' : 'active'
            updateLocalUser(user.id, {
                status: nextStatus,
                ...(nextStatus === 'active' ? { activatedAt: new Date().toISOString() } : {}),
            })
            reloadUsers()
        } catch (err) {
            alert(err instanceof Error ? err.message : 'تعذر تحديث الحالة.')
        }
    }

    function handleDelete(user: LocalUser) {
        try {
            deleteLocalUser(user.id)
            reloadUsers()
            void logAuditEvent({
                action: `حذف المستخدم: ${user.username}`,
                entity_type: 'user',
                details: { username: user.username, role: user.role },
                user: currentSession?.user,
            })
            setDeletingUser(null)
        } catch (err) {
            alert(err instanceof Error ? err.message : 'تعذر حذف المستخدم.')
        }
    }

    function handleOpenChangePassword(user: LocalUser) {
        setPwdModalUser(user)
        setModalNewPassword('')
        setPwdModalError('')
        setPwdModalSuccess('')
        setShowModalNewPassword(false)
    }

    function handleGenerateModalPassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
        let pwd = ''
        for (let i = 0; i < 8; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setModalNewPassword(pwd)
    }

    function handleSaveUserPassword(e: React.FormEvent) {
        e.preventDefault()
        if (!pwdModalUser) return
        setPwdModalError('')
        setPwdModalSuccess('')

        if (!modalNewPassword || modalNewPassword.length < 3) {
            setPwdModalError('كلمة المرور يجب أن لا تقل عن 3 أحرف.')
            return
        }

        try {
            setPwdModalSaving(true)
            changeUserPassword(pwdModalUser.id, modalNewPassword)
            reloadUsers()
            setPwdModalSuccess(`تم تحديث كلمة المرور للمستخدم "${pwdModalUser.username}" بنجاح!`)
            void logAuditEvent({
                action: `تغيير كلمة مرور المستخدم: ${pwdModalUser.username}`,
                entity_type: 'user',
                details: { username: pwdModalUser.username },
                user: currentSession?.user,
            })
            setTimeout(() => {
                setPwdModalUser(null)
            }, 1200)
        } catch (err) {
            setPwdModalError(err instanceof Error ? err.message : 'تعذر تغيير كلمة المرور.')
        } finally {
            setPwdModalSaving(false)
        }
    }

    function handleSaveSelfPassword() {
        setSelfPasswordError('')
        setSelfPasswordSuccess('')
        if (!selfPassword) {
            setSelfPasswordError('يرجى كتابة كلمة المرور الجديدة.')
            return
        }
        if (selfPassword.length < 3) {
            setSelfPasswordError('كلمة المرور يجب ألا تقل عن 3 أحرف.')
            return
        }
        if (selfPassword !== selfConfirm) {
            setSelfPasswordError('كلمة المرور وتأكيدها غير متطابقين.')
            return
        }

        setSelfPasswordSaving(true)
        try {
            const currentId = currentSession?.user?.id
            const currentEmail = currentSession?.user?.email || 'admin'

            // Find matching user in localUsers
            const found = localUsers.find(
                (u) =>
                    (u.id === currentId && u.username.toLowerCase() !== 'marwandesouqhi@gmail.com') ||
                    (u.username.toLowerCase() === currentEmail.toLowerCase() && currentEmail.toLowerCase() !== 'marwandesouqhi@gmail.com')
            ) || localUsers.find((u) => u.username.toLowerCase() === 'marwan-desouky')

            if (found) {
                updateLocalUser(found.id, { password: selfPassword })
                setSelfPasswordSuccess('تم حفظ وتحديث كلمة المرور الجديدة لحسابك بنجاح!')
                void logAuditEvent({
                    action: `تغيير كلمة المرور الشخصية للمستخدم الحالي`,
                    entity_type: 'user',
                    details: { username: activeUserEmail },
                    user: currentSession?.user,
                })
                setSelfPassword('')
                setSelfConfirm('')
                reloadUsers()
            } else {
                setSelfPasswordError('لم يتم العثور على سجل حسابك المحلي.')
            }
        } catch (err) {
            setSelfPasswordError(err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور.')
        } finally {
            setSelfPasswordSaving(false)
        }
    }

    function copyToClipboard(text: string) {
        void navigator.clipboard.writeText(text).then(() => {
            setCopiedPin(true)
            setTimeout(() => setCopiedPin(false), 2000)
        })
    }

    const filteredUsers = useMemo(() => {
        if (!userSearchTerm.trim()) return localUsers
        return localUsers.filter((u) => {
            const roleArabic =
                u.role === 'admin' ? 'مدير نظام مشرف ادمن' : u.role === 'editor' ? 'محرر كاتب' : 'مشاهد عرض'
            const statusArabic = u.status === 'active' ? 'نشط مفعل' : 'بانتظار التفعيل'
            return matchesSearch([u.username, u.displayName, u.role, roleArabic, u.activationCode, statusArabic], userSearchTerm)
        })
    }, [localUsers, userSearchTerm])

    const activeUsersCount = localUsers.filter((u) => u.status === 'active').length
    const pendingUsersCount = localUsers.filter((u) => u.status === 'pending_activation').length

    if (!isSystemAdmin) {
        return (
            <section className="page-stack users-page">
                <header className="page-intro">
                    <div className="page-intro-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--bad, #ef4444)' }}>
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow" style={{ color: 'var(--bad, #ef4444)' }}>منطقة إدارة مقيدة</p>
                        <h2>المستخدمون والصلاحيات</h2>
                        <p>خاص ومقتصر على مدير النظام (System Admin) لإدارة الحسابات وتغيير كلمات المرور.</p>
                    </div>
                </header>

                <div className="card-surface" style={{ textAlign: 'center', padding: '48px 24px', maxWidth: '600px', margin: '30px auto', borderRadius: '14px' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '16px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--bad, #ef4444)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 18px',
                    }}>
                        <ShieldAlert size={34} />
                    </div>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: '1.25rem', color: 'var(--ink)' }}>
                        صلاحية وصول مقيدة لمدير النظام فقط
                    </h3>
                    <p style={{ color: 'var(--muted)', fontSize: '0.92rem', lineHeight: '1.6', margin: '0 0 24px 0' }}>
                        عذراً، إدارة المستخدمين والاطلاع على حساباتهم وتغيير كلمات المرور مخصصة حصرياً لحسابات <strong>مدير النظام (System Administrator)</strong> لحماية سرية وأمان الحسابات.
                    </p>
                </div>
            </section>
        )
    }

    return (
        <section className="page-stack users-page">
            <header className="page-intro">
                <div className="page-intro-icon">
                    <UsersRound size={22} />
                </div>
                <div>
                    <p className="eyebrow">إدارة الوصول المحلي والأمان</p>
                    <h2>المستخدمون والصلاحيات</h2>
                    <p>إدارة حسابات المستخدمين محلياً، الصلاحيات، أكواد تأكيد التفعيل، وكلمات المرور دون الحاجة لبريد إلكتروني.</p>
                </div>
            </header>

            {/* KPI Summary Block */}
            <div className="kpi-block" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                <div className="kpi-item tone-primary">
                    <span className="kpi-icon"><UsersRound size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">إجمالي المستخدمين</span>
                        <strong className="kpi-val">{localUsers.length}</strong>
                        <span className="kpi-sub">حسابات محلية مسجلة</span>
                    </div>
                </div>

                <div className="kpi-item tone-good">
                    <span className="kpi-icon"><UserCheck size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">الحسابات المفعلة</span>
                        <strong className="kpi-val">{activeUsersCount}</strong>
                        <span className="kpi-sub">حسابات نشطة وجاهزة للدخول</span>
                    </div>
                </div>

                <div className="kpi-item tone-warn">
                    <span className="kpi-icon"><KeyRound size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">بانتظار كود التفعيل</span>
                        <strong className="kpi-val">{pendingUsersCount}</strong>
                        <span className="kpi-sub">تتطلب إدخال كود التفعيل (PIN)</span>
                    </div>
                </div>

                <div className="kpi-item tone-neutral">
                    <span className="kpi-icon"><ShieldCheck size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">صلاحية حسابك الحالي</span>
                        <strong className="kpi-val" style={{ fontSize: '1.05rem', whiteSpace: 'nowrap' }}>
                            {isSystemAdmin ? 'مدير النظام (Admin)' : 'مستخدم مسجل'}
                        </strong>
                        <span className="kpi-sub">{currentSession?.user?.email ?? 'غير مسجل'}</span>
                    </div>
                </div>
            </div>

            {/* Add User Section (Admin Only) */}
            {isSystemAdmin && (
                <div className="card-surface settings-section" style={{ padding: '22px' }}>
                    <div className="section-head" style={{ marginBottom: '16px' }}>
                        <div>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <UserPlus size={19} color="var(--accent)" />
                                إضافة مستخدم محلي جديد
                            </h3>
                            <span>إنشاء حساب محلي باسم مستخدم وكلمة مرور وكود تأكيد تفعيل مخصص</span>
                        </div>
                    </div>

                    <form onSubmit={handleAddUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', alignItems: 'start' }}>
                        <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                            اسم المستخدم (Username) <span style={{ color: 'var(--accent)' }}>*</span>
                            <input
                                type="text"
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                placeholder="مثال: store_keeper أو ahmed"
                                required
                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                            />
                        </label>

                        <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                            الاسم الكامل / المسمى الوظيفي
                            <input
                                type="text"
                                value={newDisplayName}
                                onChange={(e) => setNewDisplayName(e.target.value)}
                                placeholder="مثال: م. أحمد عبد الرحمن - أمين العهدة"
                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                            />
                        </label>

                        <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                            الصلاحية في النظام <span style={{ color: 'var(--accent)' }}>*</span>
                            <select
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value as UserRole)}
                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                            >
                                {ASSIGNABLE_ROLES.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </label>

                        <div style={{ gridColumn: '1 / -1', background: 'rgba(14, 124, 134, 0.05)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(14, 124, 134, 0.15)' }}>
                            <span style={{ fontSize: '0.88rem', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--ink)' }}>
                                صلاحيات استثنائية إضافية (تمنح للمستخدم بصرف النظر عن دوره):
                            </span>
                            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                                {(['view_audit', 'view_settings', 'manage_records'] as Permission[]).map((p) => (
                                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', cursor: 'pointer', color: 'var(--ink)' }}>
                                        <input
                                            type="checkbox"
                                            checked={newPermissions.includes(p)}
                                            onChange={(e) => {
                                                if (e.target.checked) setNewPermissions([...newPermissions, p])
                                                else setNewPermissions(newPermissions.filter(x => x !== p))
                                            }}
                                            style={{ accentColor: 'var(--accent)' }}
                                        />
                                        <span>{PERMISSION_LABELS[p]}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>كلمة المرور <span style={{ color: 'var(--accent)' }}>*</span></span>
                                <button
                                    type="button"
                                    onClick={generateRandomPassword}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                                >
                                    <Sparkles size={13} /> توليد عشوائي
                                </button>
                            </div>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                    type={showNewPassword ? 'text' : 'password'}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="أدخل كلمة المرور"
                                    required
                                    style={{ width: '100%', padding: '10px 38px 10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                    style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px' }}
                                    title={showNewPassword ? 'إخفاء' : 'إظهار'}
                                >
                                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </label>

                        <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>كود تأكيد التفعيل (PIN) <span style={{ color: 'var(--accent)' }}>*</span></span>
                                <button
                                    type="button"
                                    onClick={() => setNewActivationCode(generateActivationPin())}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                                >
                                    <RefreshCw size={13} /> رمز جديد
                                </button>
                            </div>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={newActivationCode}
                                    onChange={(e) => setNewActivationCode(e.target.value)}
                                    placeholder="كود التفعيل"
                                    required
                                    style={{ width: '100%', padding: '10px 38px 10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'monospace', fontWeight: 700 }}
                                />
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(newActivationCode)}
                                    style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px' }}
                                    title="نسخ الكود"
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                        </label>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center', height: '100%', paddingTop: '18px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem' }}>
                                <input
                                    type="checkbox"
                                    checked={newRequireActivation}
                                    onChange={(e) => setNewRequireActivation(e.target.checked)}
                                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
                                />
                                <span>طلب إدخال كود التفعيل عند تسجيل الدخول لأول مرة</span>
                            </label>
                            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                                {newRequireActivation
                                    ? 'سيبقى الحساب معلقاً حتى يدخل المستخدم كود التفعيل أعلاه.'
                                    : 'سيتم تفعيل الحساب فوراً ويمكن للمستخدم الدخول بكلمة المرور مباشرة.'}
                            </span>
                        </div>

                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                            <button type="submit" className="primary-btn" style={{ height: '42px', padding: '0 24px' }}>
                                <UserPlus size={16} /> حفظ وإضافة المستخدم
                            </button>
                        </div>
                    </form>

                    {addSuccess && (
                        <div className="inline-message success" role="status" style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle2 size={18} />
                                <span>{addSuccess}</span>
                            </div>
                            <button
                                type="button"
                                className="text-link-btn"
                                onClick={() => copyToClipboard(addSuccess.split('كود تأكيد التفعيل: ')[1] || '')}
                                style={{ fontSize: '0.82rem' }}
                            >
                                <Copy size={14} /> {copiedPin ? 'تم النسخ!' : 'نسخ الكود'}
                            </button>
                        </div>
                    )}

                    {addError && (
                        <div className="inline-message error" role="alert" style={{ marginTop: '16px' }}>
                            {addError}
                        </div>
                    )}
                </div>
            )}

            {/* Local Users Table Section */}
            <div className="card-surface settings-section" style={{ padding: '20px' }}>
                <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <UsersRound size={19} color="var(--accent)" />
                            سجل المستخدمين وأكواد التفعيل
                        </h3>
                        <span>قائمة الحسابات المحلية النشطة وأكواد تفعيلها</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
                        <div style={{ position: 'relative', width: '100%' }}>
                            <input
                                type="search"
                                placeholder="ابحث باسم المستخدم، الكود، أو الصلاحية..."
                                value={userSearchTerm}
                                onChange={(e) => setUserSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '8px 32px 8px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                            />
                            <Search size={15} style={{ position: 'absolute', right: '10px', top: '10px', color: 'var(--muted)' }} />
                        </div>
                    </div>
                </div>

                <div className="table-scroll-container">
                    <table className="custody-table">
                        <thead>
                            <tr>
                                <th>م</th>
                                <th>اسم المستخدم (Username)</th>
                                <th>الاسم الكامل / الصفة</th>
                                <th>الصلاحية</th>
                                <th>كود تأكيد التفعيل (PIN)</th>
                                <th>حالة الحساب</th>
                                <th>تاريخ الإنشاء</th>
                                {isSystemAdmin && <th className="actions-header">الإجراءات</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={isSystemAdmin ? 8 : 7} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
                                        لا توجد حسابات مطابقة للبحث
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((user, idx) => (
                                    <tr key={user.id}>
                                        <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{idx + 1}</td>
                                        <td>
                                            <strong style={{ direction: 'ltr', display: 'inline-block', color: 'var(--ink)', fontSize: '0.92rem' }}>
                                                {user.username}
                                            </strong>
                                            {user.username === currentSession?.user?.email && (
                                                <span style={{ marginRight: '6px', fontSize: '0.72rem', background: 'var(--accent-wash)', color: 'var(--accent)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                                    أنت
                                                </span>
                                            )}
                                        </td>
                                        <td>{user.displayName || '—'}</td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                                                <span style={{
                                                    fontSize: '0.78rem',
                                                    padding: '3px 8px',
                                                    borderRadius: '6px',
                                                    fontWeight: 600,
                                                    background: (user.role === 'system_admin' || user.role === 'admin')
                                                        ? 'rgba(14, 124, 134, 0.12)'
                                                        : (user.role === 'warehouse_staff' || user.role === 'editor')
                                                            ? 'rgba(59, 130, 246, 0.12)'
                                                            : user.role === 'purchasing_staff'
                                                                ? 'rgba(16, 185, 129, 0.12)'
                                                                : 'rgba(107, 114, 128, 0.12)',
                                                    color: (user.role === 'system_admin' || user.role === 'admin')
                                                        ? 'var(--accent)'
                                                        : (user.role === 'warehouse_staff' || user.role === 'editor')
                                                            ? '#2563eb'
                                                            : user.role === 'purchasing_staff'
                                                                ? '#059669'
                                                                : 'var(--muted)',
                                                }}>
                                                    {ROLE_LABELS[user.role as EffectiveRole] || user.role}
                                                </span>
                                                {Array.isArray(user.permissions) && user.permissions.length > 0 && (
                                                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                                        {user.permissions.map((p) => (
                                                            <span
                                                                key={p}
                                                                style={{
                                                                    fontSize: '0.68rem',
                                                                    padding: '1px 5px',
                                                                    borderRadius: '4px',
                                                                    background: 'rgba(245, 158, 11, 0.12)',
                                                                    color: '#d97706',
                                                                    fontWeight: 500,
                                                                }}
                                                                title={PERMISSION_LABELS[p as Permission] || p}
                                                            >
                                                                +{p === 'view_audit' ? 'سجل' : p === 'view_settings' ? 'إعدادات' : 'تعديل/حذف'}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(0, 0, 0, 0.04)', padding: '2px 8px', borderRadius: '6px' }}>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: 'var(--ink)' }}>
                                                    {user.activationCode}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => copyToClipboard(user.activationCode)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex' }}
                                                    title="نسخ كود التفعيل"
                                                >
                                                    <Copy size={13} />
                                                </button>
                                            </div>
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                onClick={() => isSystemAdmin && !isProtectedUser(user.username) && handleToggleStatus(user)}
                                                disabled={!isSystemAdmin || isProtectedUser(user.username)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: isSystemAdmin && !isProtectedUser(user.username) ? 'pointer' : 'default',
                                                    padding: 0,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                }}
                                                title={isProtectedUser(user.username) ? 'حساب مدير النظام الرئيسي نشط دائماً ومحمي' : isSystemAdmin ? 'انقر لتغيير حالة التفعيل' : ''}
                                            >
                                                <span style={{
                                                    fontSize: '0.78rem',
                                                    padding: '2px 8px',
                                                    borderRadius: '999px',
                                                    fontWeight: 600,
                                                    background: user.status === 'active' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.14)',
                                                    color: user.status === 'active' ? '#059669' : '#d97706',
                                                    border: `1px solid ${user.status === 'active' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.3)'}`,
                                                }}>
                                                    {user.status === 'active' ? 'مفعل نشط' : 'بانتظار التفعيل'}
                                                </span>
                                            </button>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString('ar-EG') : '—'}
                                        </td>
                                        {isSystemAdmin && (
                                            <td className="actions-cell">
                                                <div className="action-buttons-wrap">
                                                    <button
                                                        type="button"
                                                        className="action-icon-btn edit-btn"
                                                        onClick={() => handleOpenChangePassword(user)}
                                                        title="تغيير كلمة المرور لهذا المستخدم"
                                                        style={{ color: '#0e7c86' }}
                                                    >
                                                        <KeyRound size={15} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="action-icon-btn edit-btn"
                                                        onClick={() => handleOpenEdit(user)}
                                                        title="تعديل المستخدم وكود التفعيل"
                                                    >
                                                        <Edit2 size={15} />
                                                    </button>
                                                    {!isProtectedUser(user.username) ? (
                                                        <button
                                                            type="button"
                                                            className="action-icon-btn delete-btn"
                                                            onClick={() => setDeletingUser(user)}
                                                            title="حذف المستخدم"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    ) : (
                                                        <span
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                width: '28px',
                                                                height: '28px',
                                                                borderRadius: '6px',
                                                                background: 'rgba(14, 124, 134, 0.12)',
                                                                color: 'var(--accent)',
                                                            }}
                                                            title="حساب مدير النظام الرئيسي محمي بشكل دائم ضد الحذف"
                                                        >
                                                            <ShieldCheck size={16} />
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Current User Password Change Section */}
            <div className="card-surface settings-section" style={{ padding: '20px' }}>
                <div className="section-head" style={{ marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <KeyRound size={19} color="var(--accent)" />
                            تغيير كلمة المرور الخاصة بحسابك ({activeUserEmail})
                        </h3>
                        <span>تعيين كلمة مرور جديدة لحسابك لتسجيل الدخول بها لاحقاً</span>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'end' }}>
                    <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                        كلمة المرور الجديدة
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                                type={showSelfPassword ? 'text' : 'password'}
                                value={selfPassword}
                                onChange={(e) => setSelfPassword(e.target.value)}
                                placeholder="كلمة المرور الجديدة"
                                style={{ width: '100%', padding: '10px 38px 10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowSelfPassword(!showSelfPassword)}
                                style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px' }}
                            >
                                {showSelfPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </label>

                    <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                        تأكيد كلمة المرور
                        <input
                            type={showSelfPassword ? 'text' : 'password'}
                            value={selfConfirm}
                            onChange={(e) => setSelfConfirm(e.target.value)}
                            placeholder="أعد كتابة كلمة المرور"
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                        />
                    </label>

                    <button
                        type="button"
                        className="primary-btn"
                        onClick={handleSaveSelfPassword}
                        disabled={selfPasswordSaving || !selfPassword}
                        style={{ height: '42px', minWidth: '160px' }}
                    >
                        <Lock size={16} />
                        {selfPasswordSaving ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
                    </button>
                </div>

                {selfPasswordSuccess && (
                    <div className="inline-message success" role="status" style={{ marginTop: '12px' }}>
                        <CheckCircle2 size={16} /> {selfPasswordSuccess}
                    </div>
                )}

                {selfPasswordError && (
                    <div className="inline-message error" role="alert" style={{ marginTop: '12px' }}>
                        {selfPasswordError}
                    </div>
                )}
            </div>

            {/* Edit User Modal */}
            {editingUser && (
                <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
                    <div className="modal-dialog modal-dialog-form" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon">
                                    <Edit2 size={18} />
                                </div>
                                <div>
                                    <h3>تعديل بيانات المستخدم: {editingUser.username}</h3>
                                    <span className="modal-subtitle">تعديل الصلاحيات، كلمة المرور، أو كود التفعيل</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setEditingUser(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body">
                            <form onSubmit={handleSaveEdit} style={{ display: 'grid', gap: '14px' }}>
                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    الاسم الكامل / الصفة
                                    <input
                                        type="text"
                                        value={editDisplayName}
                                        onChange={(e) => setEditDisplayName(e.target.value)}
                                        style={{ padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}
                                    />
                                </label>

                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    الصلاحية {isProtectedUser(editingUser?.username) && <span style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>(حساب مدير النظام الرئيسي محمي)</span>}
                                    <select
                                        value={editRole}
                                        onChange={(e) => setEditRole(e.target.value as UserRole)}
                                        disabled={isProtectedUser(editingUser?.username)}
                                        style={{ padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}
                                    >
                                        {ASSIGNABLE_ROLES.map((r) => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <div style={{ background: 'rgba(14, 124, 134, 0.05)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(14, 124, 134, 0.15)' }}>
                                    <span style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--ink)' }}>
                                        صلاحيات استثنائية إضافية:
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {(['view_audit', 'view_settings', 'manage_records'] as Permission[]).map((p) => (
                                            <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--ink)' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editPermissions.includes(p)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setEditPermissions([...editPermissions, p])
                                                        else setEditPermissions(editPermissions.filter(x => x !== p))
                                                    }}
                                                    style={{ accentColor: 'var(--accent)' }}
                                                />
                                                <span>{PERMISSION_LABELS[p]}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    تغيير كلمة المرور (اتركه فارغاً للإبقاء على الحالية)
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type={showEditPassword ? 'text' : 'password'}
                                            value={editPassword}
                                            onChange={(e) => setEditPassword(e.target.value)}
                                            placeholder="اتركه فارغاً لعدم التغيير"
                                            style={{ width: '100%', padding: '9px 36px 9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowEditPassword(!showEditPassword)}
                                            style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                                        >
                                            {showEditPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </label>

                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    كود تأكيد التفعيل (PIN)
                                    <input
                                        type="text"
                                        value={editActivationCode}
                                        onChange={(e) => setEditActivationCode(e.target.value)}
                                        required
                                        style={{ padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontFamily: 'monospace', fontWeight: 700 }}
                                    />
                                </label>

                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    حالة الحساب {isProtectedUser(editingUser?.username) && <span style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>(نشط دائماً ومحمي)</span>}
                                    <select
                                        value={editStatus}
                                        onChange={(e) => setEditStatus(e.target.value as 'active' | 'pending_activation')}
                                        disabled={isProtectedUser(editingUser?.username)}
                                        style={{ padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}
                                    >
                                        <option value="active">مفعل ونشط فوراً (Active)</option>
                                        <option value="pending_activation">معلق بانتظار إدخال كود التفعيل (Pending Activation)</option>
                                    </select>
                                </label>

                                {editError && <div className="inline-message error">{editError}</div>}

                                <div className="form-actions" style={{ marginTop: '8px' }}>
                                    <button type="button" className="secondary-btn" onClick={() => setEditingUser(null)}>
                                        إلغاء
                                    </button>
                                    <button type="submit" className="primary-btn">
                                        حفظ التعديلات
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deletingUser && (
                <div className="modal-backdrop" onClick={() => setDeletingUser(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' }}>
                                    <Trash2 size={18} />
                                </div>
                                <div>
                                    <h3>تأكيد حذف المستخدم</h3>
                                    <span className="modal-subtitle">إلغاء وصول المستخدم للنظام</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setDeletingUser(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <p style={{ margin: '0 0 16px 0', fontSize: '0.92rem', color: 'var(--ink)' }}>
                                هل أنت متأكد من رغبتك في حذف حساب المستخدم <strong>"{deletingUser.username}"</strong>؟
                            </p>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
                                لن يتمكن هذا المستخدم من تسجيل الدخول إلى النظام بعد الحذف.
                            </p>

                            <div className="form-actions" style={{ marginTop: '20px' }}>
                                <button type="button" className="secondary-btn" onClick={() => setDeletingUser(null)}>
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn"
                                    onClick={() => handleDelete(deletingUser)}
                                    style={{ background: '#dc2626', borderColor: '#dc2626' }}
                                >
                                    تأكيد الحذف
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Admin Password Change Modal */}
            {pwdModalUser && (
                <div className="modal-backdrop" onClick={() => setPwdModalUser(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(14, 124, 134, 0.12)', color: 'var(--accent)' }}>
                                    <KeyRound size={18} />
                                </div>
                                <div>
                                    <h3>تغيير كلمة مرور المستخدم</h3>
                                    <span className="modal-subtitle">المستخدم: {pwdModalUser.username} ({pwdModalUser.displayName})</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setPwdModalUser(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <form onSubmit={handleSaveUserPassword} style={{ display: 'grid', gap: '14px' }}>
                                <label style={{ display: 'grid', gap: '5px', fontSize: '0.88rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>كلمة المرور الجديدة</span>
                                        <button
                                            type="button"
                                            onClick={handleGenerateModalPassword}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--accent)',
                                                fontSize: '0.78rem',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontWeight: 600,
                                            }}
                                        >
                                            <Sparkles size={13} />
                                            توليد كلمة مرور
                                        </button>
                                    </div>
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type={showModalNewPassword ? 'text' : 'password'}
                                            value={modalNewPassword}
                                            onChange={(e) => setModalNewPassword(e.target.value)}
                                            required
                                            placeholder="أدخل كلمة المرور الجديدة"
                                            style={{ width: '100%', padding: '9px 36px 9px 11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowModalNewPassword(!showModalNewPassword)}
                                            style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                                        >
                                            {showModalNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </label>

                                {pwdModalError && <div className="inline-message error">{pwdModalError}</div>}
                                {pwdModalSuccess && (
                                    <div className="inline-message success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Check size={16} />
                                        {pwdModalSuccess}
                                    </div>
                                )}

                                <div className="form-actions" style={{ marginTop: '10px' }}>
                                    <button type="button" className="secondary-btn" onClick={() => setPwdModalUser(null)}>
                                        إلغاء
                                    </button>
                                    <button type="submit" className="primary-btn" disabled={pwdModalSaving}>
                                        {pwdModalSaving ? 'جاري الحفظ...' : 'تحديث كلمة المرور'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}
