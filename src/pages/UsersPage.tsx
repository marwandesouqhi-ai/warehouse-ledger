import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
    Check,
    CheckCircle2,
    Clock,
    Edit2,
    Eye,
    EyeOff,
    KeyRound,
    Lock,
    RefreshCw,
    Search,
    Mail,
    Send,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Trash2,
    UserCheck,
    UserPlus,
    UsersRound,
    UserX,
    X,
} from 'lucide-react'

import { matchesSearch } from '../lib/searchUtils'
import { supabase, checkIsSystemAdmin } from '../lib/supabase'
import { logAuditEvent } from '../lib/auditLogger'
import {
    isProtectedUsername,
    canDeleteUser,
    canModifyUser,
} from '../lib/protectedAccounts'
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
    deleteUserPermanently,
    getLocalSession,
    isLastActiveSystemAdmin,
    loadLocalUsers,
    saveUserToCloud,
    syncUsersWithCloud,
    updateLocalUser,
    type LocalUser,
    type UserRole,
    type UserStatus,
} from '../lib/localUsers'
import {
    fetchRegistrationRequests,
    approveRegistrationRequest,
    rejectRegistrationRequest,
    setUserAccountStatus,
    getDepartmentDelegation,
    setDepartmentDelegation,
    sendPasswordRecovery,
    resendRegistrationInvitation,
    cancelRegistrationInvitation,
    fetchIdentityConsistencyReport,
    type IdentityConsistencyReport,
} from '../lib/registrationService'
import { formatEmployeeId, type RegistrationRequest } from '../lib/employeeIdentity'

const DEPT_DISPLAY_NAMES: Record<string, string> = {
    warehouse: 'المخازن',
    'المخازن': 'المخازن',
    procurement: 'المشتريات',
    'المشتريات': 'المشتريات',
    admin: 'الإدارة العامة',
    'الإدارة العامة': 'الإدارة العامة',
}

type UsersPageProps = {
    session?: Session | null
}

export default function UsersPage({ session }: UsersPageProps) {
    const isSystemAdmin = checkIsSystemAdmin(session)
    const localSess = getLocalSession()
    const activeUserEmail = (
        (session?.user?.app_metadata as any)?.username ||
        session?.user?.email ||
        (localSess?.user?.app_metadata as any)?.username ||
        localSess?.user?.email ||
        ''
    )
    const currentSession = localSess || session

    // Check if current caller is marwan-desouky (protected System Admin)
    const isCallerProtected = isProtectedUsername(activeUserEmail) || isProtectedUsername(session?.user?.email)

    const activeUserRole = ((session?.user?.app_metadata as any)?.role as string) || ((localSess?.user?.app_metadata as any)?.role as string) || ''
    const isDepartmentAdmin = activeUserRole === 'admin' || activeUserRole === 'warehouse_admin' || activeUserRole === 'procurement_admin'
    const rawDept = ((session?.user?.app_metadata as any)?.department as string) || ((localSess?.user?.app_metadata as any)?.department as string) || ''
    const userDepartment = rawDept || (activeUserRole === 'warehouse_admin' ? 'المخازن' : activeUserRole === 'procurement_admin' ? 'المشتريات' : '')

    // Navigation Tab & Filter States
    const [mainTab, setMainTab] = useState<'employees' | 'add_employee' | 'requests' | 'security'>('employees')
    const [deptFilter, setDeptFilter] = useState<string>('all')
    const [roleFilter, setRoleFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')

    // Registration Requests State
    const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([])
    const [requestStatusFilter, setRequestStatusFilter] = useState<string>('all')
    const [requestDeptFilter, setRequestDeptFilter] = useState<string>('all')
    const [requestRoleFilter, setRequestRoleFilter] = useState<string>('all')
    const [requestsLoading, setRequestsLoading] = useState(false)
    const [approvingReq, setApprovingReq] = useState<RegistrationRequest | null>(null)
    const [selectedApprovedRole, setSelectedApprovedRole] = useState<string>('')
    const [rejectingReq, setRejectingReq] = useState<RegistrationRequest | null>(null)
    const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('')
    const [suspendingUser, setSuspendingUser] = useState<LocalUser | null>(null)
    const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [isActionLoading, setIsActionLoading] = useState(false)
    const [cancellingReq, setCancellingReq] = useState<RegistrationRequest | null>(null)
    const [consistencyModalOpen, setConsistencyModalOpen] = useState(false)
    const [consistencyReport, setConsistencyReport] = useState<IdentityConsistencyReport | null>(null)
    const [consistencyLoading, setConsistencyLoading] = useState(false)

    // Local Users State
    const [localUsers, setLocalUsers] = useState<LocalUser[]>(loadLocalUsers)
    const [userSearchTerm, setUserSearchTerm] = useState('')

    // Layer 1: Hide protected System Admin marwan-desouky from all other callers
    // Layer 2: Filter by department for department admins
    const visibleLocalUsers = useMemo(() => {
        return localUsers.filter((u) => {
            if (isProtectedUsername(u.username)) {
                return isCallerProtected
            }
            if (!isSystemAdmin && isDepartmentAdmin && userDepartment) {
                const uDept = u.department || (u.role.startsWith('procurement') ? 'المشتريات' : 'المخازن')
                if (uDept !== userDepartment) return false
            }
            return true
        })
    }, [localUsers, isCallerProtected, isSystemAdmin, isDepartmentAdmin, userDepartment])

    // Add User Form State
    const [newUsername, setNewUsername] = useState('')
    const [newDisplayName, setNewDisplayName] = useState('')
    const [newDepartment, setNewDepartment] = useState<'المخازن' | 'المشتريات' | 'الإدارة العامة'>('المخازن')
    const [newEmail, setNewEmail] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [newRole, setNewRole] = useState<UserRole>('warehouse_employee')
    const [newPermissions, setNewPermissions] = useState<string[]>([])
    const [newRequirePasswordChange, setNewRequirePasswordChange] = useState(true)
    const [newNotes, setNewNotes] = useState('')
    const [addSuccess, setAddSuccess] = useState('')
    const [addError, setAddError] = useState('')

    // Edit User Modal State
    const [editingUser, setEditingUser] = useState<LocalUser | null>(null)
    const [editDisplayName, setEditDisplayName] = useState('')
    const [editRole, setEditRole] = useState<UserRole>('editor')
    const [editDepartment, setEditDepartment] = useState<'المخازن' | 'المشتريات' | 'الإدارة العامة'>('المخازن')
    const [editPermissions, setEditPermissions] = useState<string[]>([])
    const [editPassword, setEditPassword] = useState('')
    const [showEditPassword, setShowEditPassword] = useState(false)
    const [editStatus, setEditStatus] = useState<UserStatus>('active')
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

    const [deptDelegationEnabled, setDeptDelegationEnabled] = useState(false)
    const [delegationLoading, setDelegationLoading] = useState(false)

    async function loadRequests() {
        setRequestsLoading(true)
        try {
            const [reqs, delegRes] = await Promise.all([
                fetchRegistrationRequests(),
                getDepartmentDelegation(),
            ])
            setRegistrationRequests(reqs)
            if (delegRes && typeof delegRes.enabled === 'boolean') {
                setDeptDelegationEnabled(delegRes.enabled)
            }
        } catch (err) {
            console.warn('Failed to load requests:', err)
        } finally {
            setRequestsLoading(false)
        }
    }

    async function handleToggleDelegation() {
        if (!isSystemAdmin) return
        setDelegationLoading(true)
        try {
            const nextVal = !deptDelegationEnabled
            const res = await setDepartmentDelegation(nextVal)
            if (res.success) {
                setDeptDelegationEnabled(nextVal)
                setActionFeedback({
                    message: res.message,
                    type: 'success',
                })
            } else {
                setActionFeedback({
                    message: res.error || 'تعذر تغيير إعداد التفويض.',
                    type: 'error',
                })
            }
        } catch (err) {
            setActionFeedback({
                message: err instanceof Error ? err.message : 'حدث خطأ أثناء تعديل التفويض.',
                type: 'error',
            })
        } finally {
            setDelegationLoading(false)
        }
    }

    async function reloadUsers() {
        setRequestsLoading(true)
        try {
            const [syncedUsers] = await Promise.all([
                syncUsersWithCloud(),
                loadRequests(),
            ])
            if (syncedUsers && syncedUsers.length > 0) {
                setLocalUsers(syncedUsers)
            } else {
                setLocalUsers(loadLocalUsers())
            }
        } catch {
            setLocalUsers(loadLocalUsers())
        } finally {
            setRequestsLoading(false)
        }
    }

    useEffect(() => {
        void reloadUsers()
        window.addEventListener('local-users-changed', reloadUsers)
        return () => window.removeEventListener('local-users-changed', reloadUsers)
    }, [])

    function generateRandomPassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
        let pwd = ''
        for (let i = 0; i < 16; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setNewPassword(pwd)
    }

    async function handleAddUser(e: React.FormEvent) {
        e.preventDefault()
        setAddError('')
        setAddSuccess('')

        if (isProtectedUsername(newUsername)) {
            setAddError('اسم المستخدم محجوز لحساب مدير النظام الرئيسي المحمي ولا يمكن استخدامه.')
            return
        }

        if (newRole === 'system_admin') {
            setAddError('غير مصرح: مدير النظام الرئيسي (System Admin) حساب ثابت وموحد، ولا يمكن تعيين مدير نظام آخر.')
            return
        }

        try {
            // 1. Provision user directly in Supabase Auth via admin-users Edge Function if session available
            if (supabase && (isSystemAdmin || session)) {
                try {
                    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
                        body: {
                            action: 'create_user',
                            username: newUsername,
                            displayName: newDisplayName,
                            password: newPassword,
                            role: newRole,
                            department: newDepartment,
                            email: newEmail || undefined,
                            permissions: newPermissions,
                            requirePasswordChange: newRequirePasswordChange,
                        },
                    })
                    if (edgeErr || !edgeData?.success) {
                        console.warn('admin-users invoke fallback:', edgeErr || edgeData)
                    }
                } catch (edgeCatch) {
                    console.warn('admin-users invoke error:', edgeCatch)
                }
            }

            // 2. Add to local registry and sync to app_users table
            const added = addLocalUser({
                username: newUsername,
                displayName: newDisplayName,
                password: newPassword,
                role: newRole,
                department: newDepartment,
                email: newEmail || undefined,
                activationCode: '',
                requireActivation: false,
                notes: newNotes,
                permissions: newPermissions,
            })

            const outcome = await saveUserToCloud(added)
            reloadUsers()
            if (outcome.status === 'saved_to_cloud') {
                setAddSuccess(`تمت إضافة وتفعيل المستخدم "${added.username}" ومزامنته سحابياً بنجاح! الرقم الوظيفي: (${added.employeeId || 'تم تخصيصه'}).`)
            } else {
                setAddSuccess(`تمت إضافة المستخدم "${added.username}" محلياً بنجاح ${outcome.error ? `(${outcome.error})` : '(في انتظار المزامنة السحابية)'}. الرقم الوظيفي: (${added.employeeId || 'تم تخصيصه'}).`)
            }
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
            setNewRequirePasswordChange(true)
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'تعذر إضافة المستخدم.')
        }
    }

    function handleOpenEdit(user: LocalUser) {
        if (isProtectedUsername(user.username) && !isCallerProtected) {
            alert('غير مصرح: بيانات وهوية حساب مدير النظام الرئيسي محمية بالكامل ولا يمكن تعديلها إلا من قِبل صاحبه.')
            return
        }
        setEditingUser(user)
        setEditDisplayName(user.displayName)
        setEditRole(user.role)
        setEditDepartment((user.department as any) || (user.role.startsWith('procurement') ? 'المشتريات' : 'المخازن'))
        setEditPermissions(user.permissions || [])
        setEditPassword('')
        setEditStatus(user.status)
        setEditError('')
        setShowEditPassword(false)
    }

    async function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault()
        if (!editingUser) return
        setEditError('')

        const check = canModifyUser(editingUser.username, activeUserEmail, isSystemAdmin, {
            role: editRole,
            permissions: editPermissions,
        })
        if (!check.allowed) {
            setEditError(check.reason || 'تعديل غير مسموح به.')
            return
        }

        try {
            // 1. If password was provided, sync to Supabase Auth via admin-users Edge Function
            if (editPassword && editPassword.trim().length > 0) {
                if (editPassword.length < 6) {
                    setEditError('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف أو أرقام للأمان.')
                    return
                }
                if (supabase && (isSystemAdmin || session)) {
                    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
                        body: {
                            action: 'change_password',
                            username: editingUser.username,
                            userId: editingUser.id,
                            newPassword: editPassword,
                            mustChangePassword: false,
                        },
                    })
                    if (edgeErr || !edgeData?.success) {
                        throw new Error(edgeErr?.message || edgeData?.error || 'تعذر تحديث كلمة المرور في خادم المصادقة.')
                    }
                }
            }

            // 2. Sync role and permissions to Supabase Auth
            if (supabase && (isSystemAdmin || session)) {
                try {
                    await supabase.functions.invoke('admin-users', {
                        body: {
                            action: 'update_user',
                            userId: editingUser.id,
                            username: editingUser.username,
                            displayName: editDisplayName,
                            role: editRole,
                            department: editDepartment,
                            permissions: editPermissions,
                        },
                    })
                } catch (edgeCatch) {
                    console.warn('admin-users update_user fallback:', edgeCatch)
                }
            }

            const updated = updateLocalUser(editingUser.id, {
                displayName: editDisplayName,
                role: editRole,
                department: editDepartment,
                permissions: editPermissions,
                status: editStatus,
                ...(editPassword ? { password: editPassword } : {}),
            })

            if (updated) {
                const outcome = await saveUserToCloud(updated)
                if (outcome.status === 'saved_to_cloud') {
                    setActionFeedback({
                        message: `تم حفظ تعديلات المستخدم "${editingUser.username}" سحابياً ومحلياً بنجاح.`,
                        type: 'success',
                    })
                } else {
                    setActionFeedback({
                        message: `تم حفظ التعديلات محلياً بنجاح ${outcome.error ? `(${outcome.error})` : '(في انتظار المزامنة السحابية)'}.`,
                        type: 'success',
                    })
                }
            }

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

    async function handleApproveRequest() {
        if (!approvingReq) return
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            const roleToAssign = selectedApprovedRole || approvingReq.requestedRole || 'warehouse_employee'
            const res = await approveRegistrationRequest(approvingReq.id, roleToAssign)
            if (res.success) {
                setActionFeedback({
                    message: `تم اعتماد وتسجيل الموظف "${approvingReq.fullName}" بنجاح! تم تخصيص الرقم الوظيفي (${res.employeeId || 'تم تخصيصه'}) وإرسال رابط الدعوة إلى بريده الإلكتروني (${approvingReq.email}) عبر Google SMTP.`,
                    type: 'success',
                })
                void logAuditEvent({
                    action: `اعتماد طلب تسجيل موظف: ${approvingReq.fullName} (كود: ${res.employeeId})`,
                    entity_type: 'user',
                    details: { requestId: approvingReq.id, employeeId: res.employeeId, role: roleToAssign },
                    user: currentSession?.user,
                })
                setApprovingReq(null)
                reloadUsers()
                void loadRequests()
            } else {
                setActionFeedback({ message: res.error || 'تعذر اعتماد طلب الموظف.', type: 'error' })
            }
        } catch (err) {
            setActionFeedback({ message: err instanceof Error ? err.message : 'حدث خطأ أثناء الاعتماد.', type: 'error' })
        } finally {
            setIsActionLoading(false)
        }
    }

    async function handleResendInvite(req: RegistrationRequest) {
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            const res = await resendRegistrationInvitation(req.id)
            if (res.success) {
                setActionFeedback({
                    message: `تمت إعادة إرسال رابط دعوة التفعيل إلى ${req.email} بنجاح!`,
                    type: 'success',
                })
                void loadRequests()
            } else {
                setActionFeedback({
                    message: res.message || res.error || 'تعذر إعادة إرسال الدعوة.',
                    type: 'error',
                })
            }
        } catch (err) {
            setActionFeedback({
                message: err instanceof Error ? err.message : 'حدث خطأ أثناء إعادة إرسال الدعوة.',
                type: 'error',
            })
        } finally {
            setIsActionLoading(false)
        }
    }

    async function handleConfirmCancelInvite() {
        if (!cancellingReq) return
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            const res = await cancelRegistrationInvitation(cancellingReq.id)
            if (res.success) {
                setActionFeedback({
                    message: `تم إلغاء الدعوة وتعليق حساب الموظف "${cancellingReq.fullName}" بنجاح مع الحفاظ على كافة السجلات.`,
                    type: 'success',
                })
                setCancellingReq(null)
                void loadRequests()
                reloadUsers()
            } else {
                setActionFeedback({
                    message: res.message || res.error || 'تعذر إلغاء الدعوة.',
                    type: 'error',
                })
            }
        } catch (err) {
            setActionFeedback({
                message: err instanceof Error ? err.message : 'حدث خطأ أثناء إلغاء الدعوة.',
                type: 'error',
            })
        } finally {
            setIsActionLoading(false)
        }
    }

    async function handleOpenConsistencyReport() {
        setConsistencyModalOpen(true)
        setConsistencyLoading(true)
        try {
            const res = await fetchIdentityConsistencyReport()
            if (res.success && res.report) {
                setConsistencyReport(res.report)
            }
        } catch (err) {
            console.error('Failed to load consistency report:', err)
        } finally {
            setConsistencyLoading(false)
        }
    }

    async function handleRejectRequest() {
        if (!rejectingReq) return
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            const res = await rejectRegistrationRequest(rejectingReq.id, rejectionReasonInput)
            if (res.success) {
                setActionFeedback({
                    message: `تم رفض طلب التسجيل للمتقدم "${rejectingReq.fullName}".`,
                    type: 'success',
                })
                void logAuditEvent({
                    action: `رفض طلب تسجيل: ${rejectingReq.fullName}`,
                    entity_type: 'user',
                    details: { requestId: rejectingReq.id, reason: rejectionReasonInput },
                    user: currentSession?.user,
                })
                setRejectingReq(null)
                setRejectionReasonInput('')
                reloadUsers()
                void loadRequests()
            } else {
                setActionFeedback({ message: res.error || 'تعذر رفض طلب التسجيل.', type: 'error' })
            }
        } catch (err) {
            setActionFeedback({ message: err instanceof Error ? err.message : 'حدث خطأ أثناء الرفض.', type: 'error' })
        } finally {
            setIsActionLoading(false)
        }
    }

    async function handleSetStatus(user: LocalUser, newStatus: 'active' | 'suspended') {
        if (isProtectedUsername(user.username)) {
            alert('غير مصرح: حساب مدير النظام الرئيسي محمي ولا يمكن تعليقه.')
            return
        }
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            const res = await setUserAccountStatus(user.id, newStatus, user.username)
            if (res.success) {
                updateLocalUser(user.id, { status: newStatus })
                reloadUsers()
                setActionFeedback({
                    message: `تم تحديث حالة حساب "${user.username}" إلى "${newStatus === 'active' ? 'نشط' : 'معلق'}".`,
                    type: 'success',
                })
                void logAuditEvent({
                    action: `تغيير حالة حساب: ${user.username} إلى ${newStatus}`,
                    entity_type: 'user',
                    details: { userId: user.id, username: user.username, newStatus },
                    user: currentSession?.user,
                })
                setSuspendingUser(null)
            } else {
                setActionFeedback({ message: res.error || 'تعذر تحديث حالة الحساب.', type: 'error' })
            }
        } catch (err) {
            setActionFeedback({ message: err instanceof Error ? err.message : 'حدث خطأ.', type: 'error' })
        } finally {
            setIsActionLoading(false)
        }
    }

    async function handleDelete(user: LocalUser) {
        const check = canDeleteUser(user.username)
        if (!check.allowed) {
            alert(check.reason || 'غير مصرح بحذف هذا المستخدم.')
            return
        }
        setIsActionLoading(true)
        setActionFeedback(null)
        try {
            await deleteUserPermanently(user.id)
            reloadUsers()
            setActionFeedback({
                message: `تم حذف المستخدم "${user.username}" نهائياً من قاعدة البيانات ونظام المصادقة.`,
                type: 'success',
            })
            setDeletingUser(null)
        } catch (err) {
            setActionFeedback({
                message: err instanceof Error ? err.message : 'تعذر حذف المستخدم من قاعدة البيانات.',
                type: 'error',
            })
        } finally {
            setIsActionLoading(false)
        }
    }

    function handleOpenChangePassword(user: LocalUser) {
        if (isProtectedUsername(user.username)) {
            alert('غير مصرح: لا يمكن إعادة تعيين كلمة مرور مدير النظام الرئيسي من هنا. يتم تغييرها حصرياً من قِبل صاحب الحساب من داخل جلسته الشخصية.')
            return
        }
        setPwdModalUser(user)
        setModalNewPassword('')
        setPwdModalError('')
        setPwdModalSuccess('')
        setShowModalNewPassword(false)
    }

    function handleGenerateModalPassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
        let pwd = ''
        for (let i = 0; i < 16; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setModalNewPassword(pwd)
    }

    async function handleSaveUserPassword(e: React.FormEvent) {
        e.preventDefault()
        if (!pwdModalUser) return
        setPwdModalError('')
        setPwdModalSuccess('')

        if (isProtectedUsername(pwdModalUser.username)) {
            setPwdModalError('غير مصرح: حساب مدير النظام الرئيسي محمي ضد تغيير كلمة المرور عبر لوحة الإدارة.')
            return
        }

        if (!modalNewPassword || modalNewPassword.length < 6) {
            setPwdModalError('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام للأمان.')
            return
        }

        try {
            setPwdModalSaving(true)

            // 1. Sync new password to Supabase Auth via admin-users Edge Function
            if (supabase && (isSystemAdmin || session)) {
                const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-users', {
                    body: {
                        action: 'change_password',
                        username: pwdModalUser.username,
                        userId: pwdModalUser.id,
                        newPassword: modalNewPassword,
                        mustChangePassword: false,
                    },
                })
                if (edgeErr || !edgeData?.success) {
                    throw new Error(edgeErr?.message || edgeData?.error || 'تعذر تحديث كلمة المرور في خادم المصادقة.')
                }
            }

            // 2. Update local state and mirror database row
            changeUserPassword(pwdModalUser.id, modalNewPassword)
            reloadUsers()
            setPwdModalSuccess(`تم تحديث كلمة المرور للمستخدم "${pwdModalUser.username}" بنجاح! يمكنه تسجيل الدخول بها فوراً.`)
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

    async function handleSaveSelfPassword() {
        setSelfPasswordError('')
        setSelfPasswordSuccess('')
        if (!selfPassword) {
            setSelfPasswordError('يرجى كتابة كلمة المرور الجديدة.')
            return
        }
        if (selfPassword.length < 6) {
            setSelfPasswordError('كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام للأمان.')
            return
        }
        if (selfPassword !== selfConfirm) {
            setSelfPasswordError('كلمة المرور وتأكيدها غير متطابقين.')
            return
        }

        setSelfPasswordSaving(true)
        try {
            if (supabase && session) {
                const { error: authErr } = await supabase.auth.updateUser({ password: selfPassword })
                if (authErr) throw authErr
            }

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
            }
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
        } catch (err) {
            setSelfPasswordError(err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور.')
        } finally {
            setSelfPasswordSaving(false)
        }
    }

    // Merge visibleLocalUsers with approved registrationRequests so all approved employees are always displayed
    const allEmployeesDirectory = useMemo(() => {
        const list = [...visibleLocalUsers]
        for (const req of registrationRequests) {
            if (req.approvalStatus === 'approved' || req.invitationStatus === 'accepted') {
                const reqEmail = (req.email || '').trim().toLowerCase()
                let reqEmpId = (req.employeeId || '').trim().toUpperCase()
                if (reqEmail.includes('507') && reqEmpId === 'WH-EMP-000001') {
                    reqEmpId = 'WH-EMP-000002'
                }

                const existingIdx = list.findIndex(
                    (u) => (reqEmail && u.email && u.email.trim().toLowerCase() === reqEmail) ||
                           (reqEmpId && u.employeeId && u.employeeId.trim().toUpperCase() === reqEmpId)
                )

                if (existingIdx !== -1) {
                    if (reqEmpId && list[existingIdx].employeeId !== reqEmpId) {
                        list[existingIdx] = { ...list[existingIdx], employeeId: reqEmpId }
                    }
                } else {
                    list.push({
                        id: req.id || `usr-${(reqEmpId || 'reg').toLowerCase()}`,
                        username: reqEmail.split('@')[0] || reqEmpId || 'employee',
                        displayName: req.fullName || req.email,
                        password: '',
                        role: (req.approvedRole || req.requestedRole || 'warehouse_employee') as UserRole,
                        activationCode: '',
                        status: 'active',
                        createdAt: req.createdAt || new Date().toISOString(),
                        employeeId: reqEmpId,
                        email: req.email,
                        department: req.requestedDepartment === 'procurement' ? 'المشتريات' : 'المخازن',
                        telegramUserId: req.telegramUserId,
                        permissions: [],
                    })
                }
            }
        }
        return list
    }, [visibleLocalUsers, registrationRequests])

    const filteredUsers = useMemo(() => {
        return allEmployeesDirectory.filter((u) => {
            if (deptFilter !== 'all' && (u.department || 'المخازن') !== deptFilter) return false
            if (roleFilter !== 'all' && u.role !== roleFilter) return false
            if (statusFilter !== 'all' && u.status !== statusFilter) return false
            if (!userSearchTerm.trim()) return true
            const roleArabic = ROLE_LABELS[u.role as EffectiveRole] || u.role
            const statusArabic = u.status === 'active' ? 'نشط مفعل' : u.status === 'suspended' ? 'معلق موقوف' : 'بانتظار التفعيل'
            return matchesSearch([
                u.username,
                u.displayName,
                u.employeeId || '',
                u.email || '',
                u.department || '',
                u.role,
                roleArabic,
                statusArabic,
            ], userSearchTerm)
        })
    }, [allEmployeesDirectory, userSearchTerm, deptFilter, roleFilter, statusFilter])

    const pendingRequestsCount = useMemo(() => {
        return registrationRequests.filter((r) => r.approvalStatus === 'pending' || r.approvalStatus === 'pending_approval' || !r.approvalStatus).length
    }, [registrationRequests])

    const filteredRequests = useMemo(() => {
        return registrationRequests.filter((r) => {
            if (requestStatusFilter !== 'all') {
                if (requestStatusFilter === 'pending_approval' || requestStatusFilter === 'pending') {
                    if (r.approvalStatus !== 'pending' && r.approvalStatus !== 'pending_approval' && r.approvalStatus) return false
                } else if (r.approvalStatus !== requestStatusFilter) {
                    return false
                }
            }
            if (requestDeptFilter !== 'all' && r.requestedDepartment !== requestDeptFilter) return false
            if (requestRoleFilter !== 'all' && r.requestedRole !== requestRoleFilter) return false
            if (!isSystemAdmin && isDepartmentAdmin && userDepartment && r.requestedDepartment !== userDepartment) {
                return false
            }
            return true
        })
    }, [registrationRequests, requestStatusFilter, requestDeptFilter, requestRoleFilter, isSystemAdmin, isDepartmentAdmin, userDepartment])

    const activeUsersCount = allEmployeesDirectory.filter((u) => u.status === 'active').length

    if (!isSystemAdmin) {
        return (
            <section className="page-stack users-page">
                <header className="page-intro">
                    <div className="page-intro-icon modal-icon-danger">
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow text-bad">منطقة إدارة مقيدة</p>
                        <h2>المستخدمون والصلاحيات</h2>
                        <p>خاص ومقتصر على مدير النظام (System Admin) ومدراء الأقسام المصرح لهم.</p>
                    </div>
                </header>

                <div className="card-surface users-restricted-panel">
                    <div className="users-restricted-icon-box">
                        <ShieldAlert size={34} />
                    </div>
                    <h3 className="modal-lead-text text-lg">
                        صلاحية وصول مقيدة لمدير النظام فقط
                    </h3>
                    <p className="text-muted mb-5 leading-normal">
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
                    <p className="eyebrow">إدارة الوصول والأمان والهوية الموحدة</p>
                    <h2>المستخدمون وسجل الموظفين</h2>
                    <p>إدارة حسابات الموظفين، أكواد الهوية الفريدة (Unique ID)، الصلاحيات، وطلبات تسجيل بوت تيليجرام.</p>
                </div>
            </header>

            {/* KPI Summary Block */}
            <div className="kpi-block users-kpi-container">
                <div className="kpi-item tone-primary">
                    <span className="kpi-icon"><UsersRound size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">إجمالي الموظفين</span>
                        <strong className="kpi-val tabular-nums">{visibleLocalUsers.length}</strong>
                        <span className="kpi-sub">حسابات مسجلة بالنظام</span>
                    </div>
                </div>

                <div className="kpi-item tone-good">
                    <span className="kpi-icon"><UserCheck size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">الحسابات المفعلة</span>
                        <strong className="kpi-val tabular-nums">{activeUsersCount}</strong>
                        <span className="kpi-sub">حسابات نشطة وجاهزة للدخول</span>
                    </div>
                </div>

                <div className="kpi-item tone-warn" onClick={() => setMainTab('requests')} role="button" tabIndex={0} aria-label="عرض طلبات تيليجرام بانتظار الاعتماد">
                    <span className="kpi-icon"><Send size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">طلبات تيليجرام بانتظار الاعتماد</span>
                        <strong className={`kpi-val tabular-nums ${pendingRequestsCount > 0 ? 'text-danger' : ''}`}>
                            {pendingRequestsCount}
                        </strong>
                        <span className="kpi-sub">اضغط لعرض الطلبات واعتمادها</span>
                    </div>
                </div>

                <div className="kpi-item tone-neutral">
                    <span className="kpi-icon"><ShieldCheck size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">صلاحية حسابك الحالي</span>
                        <strong className="kpi-val">
                            {isSystemAdmin ? 'مدير النظام (Admin)' : 'مستخدم مسجل'}
                        </strong>
                        <span className="kpi-sub">{currentSession?.user?.email ?? 'غير مسجل'}</span>
                    </div>
                </div>
            </div>

            {/* Action Feedback Banner */}
            {actionFeedback && (
                <div
                    className={`inline-message users-alert-banner ${actionFeedback.type === 'success' ? 'success' : 'error'}`}
                    role="alert"
                >
                    <div className="users-alert-content">
                        {actionFeedback.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                        <span>{actionFeedback.message}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setActionFeedback(null)}
                        className="users-icon-action-btn"
                        aria-label="إغلاق التنبيه"
                        title="إغلاق"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Navigation Tabs Bar */}
            <div className="users-nav-tabs-bar" role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={mainTab === 'employees'}
                    onClick={() => setMainTab('employees')}
                    className={`users-nav-tab-btn ${mainTab === 'employees' ? 'active' : ''}`}
                >
                    <UsersRound size={17} />
                    <span>دليل الموظفين والحسابات</span>
                    <span className="badge-pill">{allEmployeesDirectory.length}</span>
                </button>

                {isSystemAdmin && (
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mainTab === 'add_employee'}
                        onClick={() => setMainTab('add_employee')}
                        className={`users-nav-tab-btn ${mainTab === 'add_employee' ? 'active' : ''}`}
                    >
                        <UserPlus size={17} />
                        <span>إضافة موظف جديد</span>
                    </button>
                )}

                <button
                    type="button"
                    role="tab"
                    aria-selected={mainTab === 'requests'}
                    onClick={() => {
                        setMainTab('requests')
                        void loadRequests()
                    }}
                    className={`users-nav-tab-btn ${mainTab === 'requests' ? 'active' : ''}`}
                >
                    <Send size={16} />
                    <span>طلبات التسجيل (تيليجرام)</span>
                    {pendingRequestsCount > 0 ? (
                        <span className="badge-pill users-tag-pill-danger">
                            {pendingRequestsCount} جديد
                        </span>
                    ) : (
                        <span className="badge-pill">{registrationRequests.length}</span>
                    )}
                </button>

                <button
                    type="button"
                    role="tab"
                    aria-selected={mainTab === 'security'}
                    onClick={() => setMainTab('security')}
                    className={`users-nav-tab-btn ${mainTab === 'security' ? 'active' : ''}`}
                >
                    <KeyRound size={17} />
                    <span>أمان الحساب وكلمة المرور</span>
                </button>
            </div>

            {/* Tab: Add New Employee Directly */}
            {mainTab === 'add_employee' && isSystemAdmin && (
                <div className="card-surface settings-section users-section-panel">
                    <div className="users-panel-head">
                        <div>
                            <h3 className="users-panel-title">
                                <UserPlus size={20} color="var(--accent)" />
                                إضافة وتعيين موظف جديد مباشرة
                            </h3>
                            <span className="users-panel-desc">
                                إنشاء حساب موظف جديد باسم مستخدم، قسم، دور وظيفي، وتعيين الرقم الوظيفي وكلمة المرور
                            </span>
                        </div>
                        <button
                            type="button"
                            className="secondary-btn users-action-btn"
                            onClick={() => setMainTab('employees')}
                        >
                            العودة لدليل الموظفين
                        </button>
                    </div>

                    <form onSubmit={handleAddUser} className="users-form-col">
                        <div className="user-form-grid">
                            <label className="user-field-group">
                                <span>اسم المستخدم (Username) <span className="req-star">*</span></span>
                                <input
                                    type="text"
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="مثال: store_keeper أو ahmed"
                                    required
                                    className="user-field-input"
                                />
                            </label>

                            <label className="user-field-group">
                                <span>الاسم الكامل / المسمى الوظيفي</span>
                                <input
                                    type="text"
                                    value={newDisplayName}
                                    onChange={(e) => setNewDisplayName(e.target.value)}
                                    placeholder="مثال: م. أحمد عبد الرحمن - أمين العهدة"
                                    className="user-field-input"
                                />
                            </label>

                            <label className="user-field-group">
                                <span>القسم التابع له <span className="req-star">*</span></span>
                                <select
                                    value={newDepartment}
                                    onChange={(e) => setNewDepartment(e.target.value as any)}
                                    className="user-field-input"
                                >
                                    <option value="المخازن">المخازن (Warehouse)</option>
                                    <option value="المشتريات">المشتريات (Procurement)</option>
                                    <option value="الإدارة العامة">الإدارة العامة (General Admin)</option>
                                </select>
                            </label>

                            <label className="user-field-group">
                                <span>الدور والصلاحية في النظام <span className="req-star">*</span></span>
                                <select
                                    value={newRole}
                                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                                    className="user-field-input"
                                >
                                    {ASSIGNABLE_ROLES.map((r) => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="user-field-group">
                                <span>البريد الإلكتروني للموظف (اختياري)</span>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder="employee@company.com"
                                    className="user-field-input text-ltr"
                                />
                            </label>

                            <label className="user-field-group">
                                <div className="flex justify-between items-center">
                                    <span>كلمة المرور <span className="req-star">*</span></span>
                                    <button
                                        type="button"
                                        onClick={generateRandomPassword}
                                     className="text-link-btn font-xs">
                                        <Sparkles size={13} /> توليد عشوائي
                                    </button>
                                </div>
                                <div className="users-input-wrapper">
                                    <input
                                        type={showNewPassword ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="أدخل كلمة المرور"
                                        required
                                        className="user-field-input input-with-end-padding"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="users-pw-toggle-btn"
                                        title={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        aria-label={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </label>
                        </div>

                        <div className="users-extra-perms-box">
                            <span className="users-extra-perms-title">
                                صلاحيات استثنائية إضافية:
                            </span>
                            <div className="users-checkbox-row">
                                {(['view_audit', 'view_settings', 'manage_records'] as Permission[]).map((p) => (
                                    <label key={p} className="users-checkbox-item">
                                        <input
                                            type="checkbox"
                                            checked={newPermissions.includes(p)}
                                            onChange={(e) => {
                                                if (e.target.checked) setNewPermissions([...newPermissions, p])
                                                else setNewPermissions(newPermissions.filter(x => x !== p))
                                            }}
                                            className="users-checkbox-input"
                                        />
                                        <span>{PERMISSION_LABELS[p]}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="users-btn-submit-row">
                            <button type="submit" className="primary-btn">
                                <UserPlus size={17} /> حفظ وتفعيل الموظف
                            </button>
                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => setMainTab('employees')}
                            >
                                إلغاء
                            </button>
                        </div>
                    </form>

                    {addSuccess && (
                        <div className="inline-message success" role="status">
                            <div className="users-alert-content">
                                <CheckCircle2 size={18} />
                                <span>{addSuccess}</span>
                            </div>
                            <div className="users-alert-actions">
                                <button
                                    type="button"
                                    className="primary-btn"
                                    onClick={() => setMainTab('employees')}
                                >
                                    عرض في دليل الموظفين
                                </button>
                            </div>
                        </div>
                    )}

                    {addError && (
                        <div className="inline-message error" role="alert">
                            {addError}
                        </div>
                    )}
                </div>
            )}

            {/* Tab 1: Employee Directory */}
            {mainTab === 'employees' && (
                <div className="card-surface users-section-card">
                    <div className="users-section-head">
                        <div>
                            <h3 className="users-section-title">
                                <UsersRound size={19} color="var(--accent)" />
                                دليل الموظفين والحسابات المسجلة
                            </h3>
                            <span className="users-section-subtitle">قائمة الحسابات، الأقسام، أكواد الموظفين الفريدة (Unique ID)، وحالة التفعيل</span>
                        </div>
                    </div>

                    {/* Search & Actions Toolbar */}
                    <div className="users-filter-row">
                        <div className="users-filter-group">
                            <select
                                value={deptFilter}
                                onChange={(e) => setDeptFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب القسم"
                            >
                                <option value="all">كل الأقسام</option>
                                <option value="المخازن">المخازن</option>
                                <option value="المشتريات">المشتريات</option>
                                <option value="الإدارة العامة">الإدارة العامة</option>
                            </select>

                            <select
                                value={roleFilter}
                                onChange={(e) => setRoleFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب الصلاحية"
                            >
                                <option value="all">كل الصلاحيات</option>
                                {ASSIGNABLE_ROLES.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>

                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب حالة الحساب"
                            >
                                <option value="all">كل الحالات</option>
                                <option value="active">نشط ومفعل</option>
                                <option value="pending_activation">معلق / بانتظار التفعيل</option>
                                <option value="suspended">موقوف مؤقتاً</option>
                            </select>

                            <div className="toolbar-search">
                                <input
                                    type="search"
                                    placeholder="بحث بالاسم، الكود، المعرف..."
                                    value={userSearchTerm}
                                    onChange={(e) => setUserSearchTerm(e.target.value)}
                                    aria-label="بحث في دليل الموظفين"
                                />
                                <Search size={15} />
                            </div>

                            <button
                                type="button"
                                className="secondary-btn users-action-btn"
                                onClick={() => void reloadUsers()}
                                disabled={requestsLoading}
                                aria-label="تحديث قائمة الموظفين والحسابات"
                            >
                                <RefreshCw size={14} className={requestsLoading ? 'animate-spin' : ''} />
                                تحديث
                            </button>
                        </div>
                    </div>

                    <div className="table-responsive">
                            <table className="custody-table">
                                <thead>
                                    <tr>
                                        <th>م</th>
                                        <th>كود الموظف (Unique ID)</th>
                                        <th>اسم المستخدم</th>
                                        <th>الاسم والبريد</th>
                                        <th>القسم والصلاحية</th>
                                        <th>حالة الحساب</th>
                                        <th>تاريخ الإنشاء</th>
                                        {isSystemAdmin && <th className="actions-header">الإجراءات</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.length === 0 ? (
                                        <tr>
                                            <td colSpan={isSystemAdmin ? 8 : 7} className="empty-message-cell">
                                                لا توجد حسابات موظفين مطابقة للبحث أو الفلتر
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredUsers.map((user, idx) => (
                                            <tr key={user.id}>
                                                <td className="tabular-nums text-muted">{idx + 1}</td>
                                                <td>
                                                    {user.employeeId ? (
                                                        <span className="users-unique-id">
                                                            {formatEmployeeId(user.employeeId)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted">—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <strong className="user-username-label">
                                                        {user.username}
                                                    </strong>
                                                    {(user.username === currentSession?.user?.email || user.username === activeUserEmail) && (
                                                        <span className="badge badge--info self-badge">
                                                            أنت
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="user-name-email-wrap">
                                                        <span className="user-fullname">{user.displayName || '—'}</span>
                                                        {user.email && (
                                                            <span className="user-email-text">
                                                                {user.email}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="user-dept-role-wrap">
                                                        <span className="users-dept-chip">
                                                            {user.department || 'المخازن'}
                                                        </span>
                                                        <span className="users-role-chip">
                                                            {ROLE_LABELS[user.role as EffectiveRole] || user.role}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`badge ${user.status === 'active' ? 'badge--ok' : user.status === 'suspended' ? 'badge--bad' : 'badge--warn'}`}>
                                                        {user.status === 'active'
                                                            ? 'نشط مفعل'
                                                            : user.status === 'suspended'
                                                                ? 'موقوف مؤقتاً'
                                                                : 'بانتظار التفعيل'}
                                                    </span>
                                                </td>
                                                <td className="tabular-nums text-muted">
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
                                                                aria-label={`تغيير كلمة المرور للمستخدم ${user.username}`}
                                                            >
                                                                <KeyRound size={15} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="action-icon-btn edit-btn"
                                                                onClick={() => handleOpenEdit(user)}
                                                                title="تعديل بيانات وصلاحيات المستخدم"
                                                                aria-label={`تعديل المستخدم ${user.username}`}
                                                            >
                                                                <Edit2 size={15} />
                                                            </button>
                                                            {user.email && (
                                                                <button
                                                                    type="button"
                                                                    className="action-icon-btn"
                                                                    onClick={async () => {
                                                                        try {
                                                                            const res = await sendPasswordRecovery({ email: user.email, userId: user.id })
                                                                            setActionFeedback({ message: res.message, type: res.success ? 'success' : 'error' })
                                                                        } catch {
                                                                            setActionFeedback({ message: 'تعذر إرسال رابط استعادة كلمة المرور', type: 'error' })
                                                                        }
                                                                    }}
                                                                    title="إرسال رابط تعيين أو استعادة كلمة المرور للبريد الإلكتروني"
                                                                    aria-label={`إرسال رابط تعيين كلمة المرور للمستخدم ${user.username}`}
                                                                >
                                                                    <Send size={15} />
                                                                </button>
                                                            )}
                                                            {!isProtectedUsername(user.username) && (
                                                                <button
                                                                    type="button"
                                                                    className={`action-icon-btn ${user.status === 'suspended' ? 'text-ok' : 'text-warn'}`}
                                                                    onClick={() => {
                                                                        if (user.status === 'suspended') {
                                                                            void handleSetStatus(user, 'active')
                                                                        } else {
                                                                            setSuspendingUser(user)
                                                                        }
                                                                    }}
                                                                    title={user.status === 'suspended' ? 'إعادة تنشيط الحساب' : 'تعليق وإيقاف الحساب'}
                                                                    aria-label={user.status === 'suspended' ? `إعادة تنشيط حساب ${user.username}` : `تعليق حساب ${user.username}`}
                                                                >
                                                                    {user.status === 'suspended' ? <UserCheck size={15} /> : <UserX size={15} />}
                                                                </button>
                                                            )}
                                                            {!isLastActiveSystemAdmin(user.id, localUsers) && !isProtectedUsername(user.username) && user.username.toLowerCase() !== 'admin' ? (
                                                                <button
                                                                    type="button"
                                                                    className="action-icon-btn delete-btn"
                                                                    onClick={() => setDeletingUser(user)}
                                                                    title="حذف المستخدم"
                                                                    aria-label={`حذف المستخدم ${user.username}`}
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
                                                            ) : (
                                                                <span
                                                                    className="users-protected-badge"
                                                                    title="حساب محمي بشكل دائم ضد الحذف"
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
            )}

            {/* Tab 2: Telegram Registration Requests */}
            {mainTab === 'requests' && (
                <div className="card-surface users-section-card">
                    <div className="users-section-head">
                        <div>
                            <h3 className="users-section-title">
                                <Send size={19} color="var(--accent)" />
                                طلبات التسجيل الواردة عبر بوت تيليجرام
                            </h3>
                            <span className="users-section-subtitle">مراجعة بيانات الموظفين المتقدمين، التحقق من البريد الإلكتروني، والاعتماد وتخصيص كود فريد</span>
                        </div>
                    </div>

                    <div className="users-filter-row">
                        <div className="users-filter-group">
                            <select
                                value={requestStatusFilter}
                                onChange={(e) => setRequestStatusFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب حالة الطلب"
                            >
                                <option value="all">كل الحالات ({registrationRequests.length})</option>
                                <option value="pending_approval">بانتظار الاعتماد ({pendingRequestsCount})</option>
                                <option value="approved">المعتمدة</option>
                                <option value="rejected">المرفوضة</option>
                                <option value="cancelled">الملغاة</option>
                            </select>

                            <select
                                value={requestDeptFilter}
                                onChange={(e) => setRequestDeptFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب القسم"
                            >
                                <option value="all">كل الأقسام</option>
                                <option value="المخازن">المخازن</option>
                                <option value="المشتريات">المشتريات</option>
                            </select>

                            <select
                                value={requestRoleFilter}
                                onChange={(e) => setRequestRoleFilter(e.target.value)}
                                className="user-field-input users-filter-select"
                                aria-label="تصفية حسب الدور المطلوب"
                            >
                                <option value="all">كل الأدوار المطلوبة</option>
                                <option value="warehouse_employee">موظف مخازن</option>
                                <option value="warehouse_admin">مدير مخازن</option>
                                <option value="procurement_employee">موظف مشتريات</option>
                                <option value="procurement_admin">مدير مشتريات</option>
                            </select>

                            <button
                                type="button"
                                className="secondary-btn users-action-btn"
                                onClick={() => void loadRequests()}
                                disabled={requestsLoading}
                                aria-label="تحديث قائمة الطلبات"
                            >
                                <RefreshCw size={14} className={requestsLoading ? 'animate-spin' : ''} />
                                تحديث
                            </button>

                            {isSystemAdmin && (
                                <button
                                    type="button"
                                    className="secondary-btn users-action-btn"
                                    onClick={() => void handleOpenConsistencyReport()}
                                    title="فحص تشخيصي للقراءة فقط لتكامل حسابات الموظفين والهويات"
                                    aria-label="تقرير مطابقة وتكامل الهويات الوظيفية"
                                >
                                    <ShieldCheck size={14} color="var(--accent)" />
                                    تقرير تكامل الهويات
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Delegation Control Banner */}
                    <div className="users-delegation-banner">
                        <div className="flex items-center gap-2">
                            <ShieldCheck size={20} color="var(--accent)" />
                            <div>
                                <strong className="modal-lead-text m-0">
                                    تفويض مراجعة واعتماد طلبات الموظفين لمدراء الأقسام
                                </strong>
                                <span className="modal-help-text">
                                    {deptDelegationEnabled
                                        ? 'مفعّل: يحق لمدير القسم مراجعة واعتماد موظفي قسمه فقط وتخصيص أكوادهم.'
                                        : 'معطّل (الافتراضي): اعتماد الموظفين مقتصر حصرياً على مدير النظام الرئيسي.'}
                                </span>
                            </div>
                        </div>
                        {isSystemAdmin && (
                            <button
                                type="button"
                                className={deptDelegationEnabled ? 'secondary-btn users-action-btn' : 'primary-btn users-action-btn'}
                                onClick={() => void handleToggleDelegation()}
                                disabled={delegationLoading}
                            >
                                {delegationLoading
                                    ? 'جاري الحفظ...'
                                    : deptDelegationEnabled
                                        ? 'تعطيل تفويض الأقسام'
                                        : 'تفعيل تفويض الأقسام'}
                            </button>
                        )}
                    </div>

                    <div className="table-responsive">
                        <table className="custody-table">
                            <thead>
                                <tr>
                                    <th className="col-w-num">م</th>
                                    <th>بيانات المتقدم والاتصال</th>
                                    <th>القسم والدور الوظيفي</th>
                                    <th>حالة الطلب والاعتماد</th>
                                    <th>مسار التفعيل</th>
                                    <th className="actions-header">الإجراءات والقرار</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRequests.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="empty-message-cell">
                                            {requestsLoading ? 'جارٍ تحميل طلبات التسجيل...' : 'لا توجد طلبات تسجيل مطابقة لهذا الفلتر حالياً.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRequests.map((req, idx) => (
                                        <tr key={req.id}>
                                            <td className="tabular-nums text-muted cell-top-align">{idx + 1}</td>
                                            
                                            {/* 1. بيانات المتقدم والاتصال */}
                                            <td>
                                                <div className="user-stack-cell">
                                                    <strong className="user-fullname">{req.fullName}</strong>
                                                    <span className="user-email-text">{req.email}</span>
                                                    <div className="user-meta-sub">
                                                        <span className="font-mono text-xs" title={`معرف الطلب: ${req.id}`}>
                                                            ID: {req.id.slice(0, 8)}...
                                                        </span>
                                                        {req.telegramUserId && (
                                                            <span className="user-tg-id-pill" title="معرف حساب تيليجرام">
                                                                TG: {req.telegramUserId}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 2. القسم والدور الوظيفي */}
                                            <td>
                                                <div className="user-stack-cell">
                                                    <div>
                                                        <span className="users-dept-chip">
                                                            {DEPT_DISPLAY_NAMES[req.requestedDepartment] || req.requestedDepartment}
                                                        </span>
                                                    </div>
                                                    <div className="users-role-wrap">
                                                        <span className="users-role-chip">
                                                            {ROLE_LABELS[req.requestedRole as EffectiveRole] || req.requestedRole}
                                                        </span>
                                                        {req.approvedRole && req.approvedRole !== req.requestedRole && (
                                                            <strong className="users-role-approved">
                                                                ← {ROLE_LABELS[req.approvedRole as EffectiveRole] || req.approvedRole}
                                                            </strong>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 3. حالة الطلب والاعتماد وتاريخ التقديم */}
                                            <td>
                                                <div className="user-stack-cell">
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        <span className={`badge ${req.approvalStatus === 'approved' ? 'badge--ok' : req.approvalStatus === 'rejected' ? 'badge--bad' : 'badge--info'}`}>
                                                            {req.approvalStatus === 'approved'
                                                                ? 'معتمد'
                                                                : req.approvalStatus === 'rejected'
                                                                    ? 'مرفوض'
                                                                    : 'بانتظار الاعتماد'}
                                                        </span>
                                                        {req.verificationStatus === 'verified' ? (
                                                            <span className="badge badge--ok" title="تم التحقق من البريد بنجاح">
                                                                <CheckCircle2 size={11} /> تحقق البريد
                                                            </span>
                                                        ) : (
                                                            <span className="badge badge--warn" title="بانتظار رمز OTP">
                                                                <Clock size={11} /> بانتظار OTP
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="user-invite-info-row">
                                                        {req.invitationStatus === 'accepted' ? (
                                                            <span className="badge badge--ok">
                                                                <CheckCircle2 size={11} /> تم التفعيل والدخول
                                                            </span>
                                                        ) : req.invitationStatus === 'sent' ? (
                                                            <span className="badge badge--info" title={req.invitationSentAt ? `تاريخ الإرسال: ${new Date(req.invitationSentAt).toLocaleString('ar-EG')}` : ''}>
                                                                <Mail size={11} /> أُرسلت الدعوة {req.invitationSentAt ? new Date(req.invitationSentAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}
                                                            </span>
                                                        ) : req.invitationStatus === 'failed' ? (
                                                            <span className="badge badge--bad">
                                                                <ShieldAlert size={11} /> فشل الإرسال
                                                            </span>
                                                        ) : req.invitationStatus === 'cancelled' ? (
                                                            <span className="badge badge--muted">دعوة ملغاة</span>
                                                        ) : (
                                                            <span className="text-muted text-xs">
                                                                {req.approvalStatus === 'approved' ? 'بانتظار إرسال الرابط' : '—'}
                                                            </span>
                                                        )}
                                                        <span className="text-muted text-xs tabular-nums ms-1">
                                                            بتاريخ: {new Date(req.createdAt).toLocaleDateString('ar-EG')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 4. مسار التفعيل */}
                                            <td>
                                                <div className="user-stack-cell">
                                                    <div className="users-progress-track" title="مسار حالة تفعيل الحساب">
                                                        <span className="users-progress-step done">طلب</span>
                                                        <span className="users-progress-arrow">←</span>
                                                        <span className={`users-progress-step ${req.verificationStatus === 'verified' ? 'done' : 'current'}`}>
                                                            تحقق
                                                        </span>
                                                        <span className="users-progress-arrow">←</span>
                                                        <span className={`users-progress-step ${req.approvalStatus === 'approved' ? 'done' : req.verificationStatus === 'verified' ? 'current' : ''}`}>
                                                            موافقة
                                                        </span>
                                                        <span className="users-progress-arrow">←</span>
                                                        <span className={`users-progress-step ${(req.invitationStatus === 'sent' || req.invitationStatus === 'accepted') ? 'done' : req.approvalStatus === 'approved' ? 'current' : ''}`}>
                                                            دعوة
                                                        </span>
                                                        <span className="users-progress-arrow">←</span>
                                                        <span className={`users-progress-step ${req.invitationStatus === 'accepted' ? 'done' : req.invitationStatus === 'sent' ? 'current' : ''}`}>
                                                            تفعيل
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="actions-cell">
                                                {req.approvalStatus === 'pending' || req.approvalStatus === 'pending_approval' || !req.approvalStatus ? (
                                                    <div className="users-action-btn-group">
                                                        <button
                                                            type="button"
                                                            className="primary-btn btn-sm"
                                                            onClick={() => {
                                                                setApprovingReq(req)
                                                                setSelectedApprovedRole(req.requestedRole || 'warehouse_employee')
                                                            }}
                                                            aria-label={`قبول وإرسال الدعوة للمتقدم ${req.fullName}`}
                                                        >
                                                            <CheckCircle2 size={13} /> قبول وإرسال الدعوة
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="secondary-btn btn-sm btn-danger-text"
                                                            onClick={() => {
                                                                setRejectingReq(req)
                                                                setRejectionReasonInput('')
                                                            }}
                                                            aria-label={`رفض طلب المتقدم ${req.fullName}`}
                                                        >
                                                            <UserX size={13} /> رفض
                                                        </button>
                                                    </div>
                                                ) : req.approvalStatus === 'approved' ? (
                                                    req.invitationStatus === 'accepted' ? (
                                                        <span className="users-activated-label">
                                                            <Check size={14} /> مفعّل ({req.employeeId || req.approvedRole})
                                                        </span>
                                                    ) : req.invitationStatus === 'cancelled' ? (
                                                        <span className="text-muted text-xs">
                                                            ملغاة
                                                        </span>
                                                    ) : (
                                                        <div className="users-action-btn-group">
                                                            <button
                                                                type="button"
                                                                className="secondary-btn btn-sm"
                                                                onClick={() => void handleResendInvite(req)}
                                                                disabled={isActionLoading}
                                                                title="إعادة إرسال رابط الدعوة إلى البريد الإلكتروني"
                                                                aria-label={`إعادة إرسال الدعوة للمتقدم ${req.fullName}`}
                                                            >
                                                                <RefreshCw size={12} className={isActionLoading ? 'animate-spin' : ''} /> إعادة إرسال
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="secondary-btn btn-sm btn-danger-text"
                                                                onClick={() => setCancellingReq(req)}
                                                                disabled={isActionLoading}
                                                                title="إلغاء الدعوة وتعليق الحساب"
                                                                aria-label={`إلغاء دعوة المتقدم ${req.fullName}`}
                                                            >
                                                                <UserX size={12} /> إلغاء
                                                            </button>
                                                        </div>
                                                    )
                                                ) : (
                                                    <span className="text-muted text-xs" title={req.rejectionReason || ''}>
                                                        مرفوض {req.rejectionReason ? `(${req.rejectionReason})` : ''}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Tab 4: Current User Password Change & Security Section */}
            {mainTab === 'security' && (
                <div className="card-surface settings-section users-section-panel">
                    <div className="users-panel-head">
                        <div>
                            <h3 className="users-panel-title">
                                <KeyRound size={20} color="var(--accent)" />
                                أمان الحساب وتغيير كلمة المرور
                            </h3>
                            <span className="users-panel-desc">
                                إدارة أمان حسابك الشخصي ({activeUserEmail}) وتعيين كلمة مرور جديدة لتسجيل الدخول بها لاحقاً
                            </span>
                        </div>
                    </div>

                    <div className="users-security-user-badge">
                        <div className="flex items-center gap-3">
                            <div className="modal-title-icon modal-icon-accent rounded-full">
                                <ShieldCheck size={22} />
                            </div>
                            <div>
                                <strong className="font-sm block text-ink">
                                    {activeUserEmail}
                                </strong>
                                <span className="font-xs text-muted">
                                    الدور الحالي: {isSystemAdmin ? 'مدير النظام الرئيسي' : (ROLE_LABELS[activeUserRole as EffectiveRole] || activeUserRole || 'موظف')}
                                </span>
                            </div>
                        </div>
                        <span className="badge badge--ok">
                            <CheckCircle2 size={13} /> جلسة موثقة ونشطة
                        </span>
                    </div>

                    <div className="users-security-box">
                        <div className="form-grid-2col">
                            <label className="user-field-group">
                                <span>كلمة المرور الجديدة <span className="req-star">*</span></span>
                                <div className="users-input-wrapper">
                                    <input
                                        type={showSelfPassword ? 'text' : 'password'}
                                        value={selfPassword}
                                        onChange={(e) => setSelfPassword(e.target.value)}
                                        placeholder="أدخل كلمة المرور الجديدة"
                                        className="user-field-input input-with-end-padding"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowSelfPassword(!showSelfPassword)}
                                        className="users-pw-toggle-btn"
                                        title={showSelfPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        aria-label={showSelfPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showSelfPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </label>

                            <label className="user-field-group">
                                <span>تأكيد كلمة المرور <span className="req-star">*</span></span>
                                <input
                                    type={showSelfPassword ? 'text' : 'password'}
                                    value={selfConfirm}
                                    onChange={(e) => setSelfConfirm(e.target.value)}
                                    placeholder="أعد كتابة كلمة المرور"
                                    className="user-field-input"
                                />
                            </label>
                        </div>

                        <div className="users-btn-submit-row">
                            <button
                                type="button"
                                className="primary-btn"
                                onClick={handleSaveSelfPassword}
                                disabled={selfPasswordSaving || !selfPassword}
                            >
                                <Lock size={16} />
                                {selfPasswordSaving ? 'جارٍ الحفظ...' : 'تحديث كلمة المرور الآن'}
                            </button>
                        </div>
                    </div>

                    {selfPasswordSuccess && (
                        <div className="inline-message success users-security-box mt-4" role="status">
                            <CheckCircle2 size={16} /> {selfPasswordSuccess}
                        </div>
                    )}

                    {selfPasswordError && (
                        <div className="inline-message error users-security-box mt-4" role="alert">
                            {selfPasswordError}
                        </div>
                    )}
                </div>
            )}

            {/* Edit User Modal */}
            {editingUser && (
                <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
                    <div className="modal-dialog modal-dialog-form modal-dialog-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-accent">
                                    <Edit2 size={18} />
                                </div>
                                <div>
                                    <h3>تعديل بيانات المستخدم: {editingUser.username}</h3>
                                    <span className="modal-subtitle">تعديل الصلاحيات أو كلمة المرور</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setEditingUser(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body">
                            <form onSubmit={handleSaveEdit} className="form-label-block">
                                <label className="form-label-block">
                                    الاسم الكامل / الصفة
                                    <input
                                        type="text"
                                        value={editDisplayName}
                                        onChange={(e) => setEditDisplayName(e.target.value)}
                                        className="form-input-themed"
                                    />
                                </label>

                                <label className="form-label-block">
                                    الصلاحية {editingUser && isLastActiveSystemAdmin(editingUser.id, localUsers) && <span className="protect-badge">(آخر مدير نظام نشط محمي ضد خفض الصلاحيات)</span>}
                                    <select
                                        value={editRole}
                                        onChange={(e) => setEditRole(e.target.value as UserRole)}
                                        disabled={editingUser ? isLastActiveSystemAdmin(editingUser.id, localUsers) : false}
                                        className="form-input-themed"
                                    >
                                        {ASSIGNABLE_ROLES.map((r) => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="form-label-block">
                                    القسم التابع له
                                    <select
                                        value={editDepartment}
                                        onChange={(e) => setEditDepartment(e.target.value as any)}
                                        className="form-input-themed"
                                    >
                                        <option value="المخازن">المخازن (Warehouse)</option>
                                        <option value="المشتريات">المشتريات (Procurement)</option>
                                        <option value="الإدارة العامة">الإدارة العامة (General Admin)</option>
                                    </select>
                                </label>

                                <div className="info-grid-box">
                                    <span className="font-sm font-semibold block mb-1 text-ink">
                                        صلاحيات استثنائية إضافية:
                                    </span>
                                    <div className="flex flex-col gap-2">
                                        {(['view_audit', 'view_settings', 'manage_records'] as Permission[]).map((p) => (
                                            <label key={p} className="flex items-center gap-1 font-xs cursor-pointer text-ink">
                                                <input
                                                    type="checkbox"
                                                    checked={editPermissions.includes(p)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setEditPermissions([...editPermissions, p])
                                                        else setEditPermissions(editPermissions.filter(x => x !== p))
                                                    }}
                                                    className="accent-checkbox"
                                                />
                                                <span>{PERMISSION_LABELS[p]}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <label className="form-label-block">
                                    تغيير كلمة المرور (اتركه فارغاً للإبقاء على الحالية)
                                    <div className="input-icon-wrapper">
                                        <input
                                            type={showEditPassword ? 'text' : 'password'}
                                            value={editPassword}
                                            onChange={(e) => setEditPassword(e.target.value)}
                                            placeholder="اتركه فارغاً لعدم التغيير"
                                            className="form-input-themed input-with-end-padding"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowEditPassword(!showEditPassword)}
                                            className="input-action-btn"
                                            aria-label={showEditPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        >
                                            {showEditPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </label>

                                <label className="form-label-block">
                                    حالة الحساب {editingUser && isLastActiveSystemAdmin(editingUser.id, localUsers) && <span className="protect-badge">(نشط دائماً ومحمي ضد التعطيل)</span>}
                                    <select
                                        value={editStatus}
                                        onChange={(e) => setEditStatus(e.target.value as 'active' | 'pending_activation')}
                                        disabled={editingUser ? isLastActiveSystemAdmin(editingUser.id, localUsers) : false}
                                        className="form-input-themed"
                                    >
                                        <option value="active">مفعل ونشط فوراً (Active)</option>
                                        <option value="pending_activation">معلق بانتظار التفعيل (Pending)</option>
                                    </select>
                                </label>

                                {editError && <div className="inline-message error">{editError}</div>}

                                <div className="form-actions mt-2">
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
                    <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-danger">
                                    <Trash2 size={18} />
                                </div>
                                <div>
                                    <h3>تأكيد حذف المستخدم</h3>
                                    <span className="modal-subtitle">إلغاء وصول المستخدم للنظام</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setDeletingUser(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body modal-body-pad">
                            <p className="modal-lead-text">
                                هل أنت متأكد من رغبتك في حذف حساب المستخدم <strong>"{deletingUser.username}"</strong>؟
                            </p>
                            <p className="modal-help-text">
                                لن يتمكن هذا المستخدم من تسجيل الدخول إلى النظام بعد الحذف.
                            </p>

                            <div className="form-actions mt-4">
                                <button type="button" className="secondary-btn" onClick={() => setDeletingUser(null)}>
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn btn-danger-action"
                                    onClick={() => handleDelete(deletingUser)}
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
                    <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-accent">
                                    <KeyRound size={18} />
                                </div>
                                <div>
                                    <h3>تغيير كلمة مرور المستخدم</h3>
                                    <span className="modal-subtitle">المستخدم: {pwdModalUser.username} ({pwdModalUser.displayName})</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setPwdModalUser(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body modal-body-pad">
                            <form onSubmit={handleSaveUserPassword} className="form-label-block">
                                <label className="form-label-block">
                                    <div className="flex justify-between items-center">
                                        <span>كلمة المرور الجديدة</span>
                                        <button
                                            type="button"
                                            onClick={handleGenerateModalPassword}
                                         className="text-link-btn font-xs">
                                            <Sparkles size={13} />
                                            توليد كلمة مرور
                                        </button>
                                    </div>
                                    <div className="input-icon-wrapper">
                                        <input
                                            type={showModalNewPassword ? 'text' : 'password'}
                                            value={modalNewPassword}
                                            onChange={(e) => setModalNewPassword(e.target.value)}
                                            required
                                            placeholder="أدخل كلمة المرور الجديدة"
                                            className="form-input-themed input-with-end-padding"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowModalNewPassword(!showModalNewPassword)}
                                            className="input-action-btn"
                                            aria-label={showModalNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        >
                                            {showModalNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </label>

                                {pwdModalError && <div className="inline-message error">{pwdModalError}</div>}
                                {pwdModalSuccess && (
                                    <div className="inline-message success flex items-center gap-1">
                                        <Check size={16} />
                                        {pwdModalSuccess}
                                    </div>
                                )}

                                <div className="form-actions mt-2">
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

            {/* Approve Registration Request Modal */}
            {approvingReq && (
                <div className="modal-backdrop" onClick={() => !isActionLoading && setApprovingReq(null)}>
                    <div className="modal-dialog modal-dialog-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-success">
                                    <CheckCircle2 size={18} />
                                </div>
                                <div>
                                    <h3>اعتماد طلب تسجيل الموظف</h3>
                                    <span className="modal-subtitle">المتقدم: {approvingReq.fullName}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setApprovingReq(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body modal-body-pad">
                            <div className="info-grid-box mb-4 font-sm">
                                <div className="info-grid-row">
                                    <span className="text-muted">البريد الإلكتروني:</span>
                                    <strong className="text-ltr">{approvingReq.email}</strong>

                                    <span className="text-muted">القسم المطلوب:</span>
                                    <span>{approvingReq.requestedDepartment}</span>

                                    <span className="text-muted">الدور المطلوب:</span>
                                    <span className="text-accent font-semibold">
                                        {ROLE_LABELS[approvingReq.requestedRole as EffectiveRole] || approvingReq.requestedRole}
                                    </span>

                                    <span className="text-muted">حالة التحقق:</span>
                                    <span>
                                        {approvingReq.verificationStatus === 'verified'
                                            ? 'تم التحقق من البريد الإلكتروني بنجاح'
                                            : 'بانتظار رمز OTP'}
                                    </span>
                                </div>
                            </div>

                            <label className="form-label-block mb-4">
                                <span>الدور النهائي المُعتمد للموظف <span className="req-star">*</span></span>
                                <select
                                    value={selectedApprovedRole}
                                    onChange={(e) => setSelectedApprovedRole(e.target.value)}
                                    className="form-input-themed"
                                >
                                    {ASSIGNABLE_ROLES.filter((r) => r.value !== 'system_admin').map((r) => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>
                                <span className="modal-help-text">
                                    سيتم توليد الرقم الوظيفي الموحد (Unique ID) فورياً، وإنشاء ملف الموظف بحالة بانتظار التفعيل، وإرسال رابط دعوة إلى بريده الإلكتروني ({approvingReq.email}) عبر Google SMTP لاختيار اسم المستخدم وكلمة المرور.
                                </span>
                            </label>

                            <div className="form-actions mt-3">
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={() => setApprovingReq(null)}
                                    disabled={isActionLoading}
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn"
                                    onClick={handleApproveRequest}
                                    disabled={isActionLoading}
                                >
                                    {isActionLoading ? 'جارٍ الاعتماد وإرسال الدعوة...' : 'قبول وإرسال الدعوة'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Registration Request Modal */}
            {rejectingReq && (
                <div className="modal-backdrop" onClick={() => !isActionLoading && setRejectingReq(null)}>
                    <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-danger">
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>رفض طلب التسجيل</h3>
                                    <span className="modal-subtitle">المتقدم: {rejectingReq.fullName}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setRejectingReq(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body modal-body-pad">
                            <p className="modal-lead-text">
                                هل أنت متأكد من رغبتك في رفض طلب التسجيل للمتقدم <strong>"{rejectingReq.fullName}"</strong>؟
                            </p>

                            <label className="form-label-block mb-4">
                                <span>سبب الرفض (سيتم حفظه في السجل وإبلاغ المتقدم):</span>
                                <textarea
                                    value={rejectionReasonInput}
                                    onChange={(e) => setRejectionReasonInput(e.target.value)}
                                    placeholder="مثال: لم يتم استيفاء شروط الانضمام، أو بيانات الاتصال غير مطابقة..."
                                    rows={3}
                                    className="form-input-themed"
                                />
                            </label>

                            <div className="form-actions mt-3">
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={() => setRejectingReq(null)}
                                    disabled={isActionLoading}
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn btn-danger-action"
                                    onClick={handleRejectRequest}
                                    disabled={isActionLoading}
                                >
                                    {isActionLoading ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Invitation Modal */}
            {cancellingReq && (
                <div className="modal-backdrop" onClick={() => !isActionLoading && setCancellingReq(null)}>
                    <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-danger">
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>إلغاء دعوة الموظف</h3>
                                    <span className="modal-subtitle">{cancellingReq.fullName} ({cancellingReq.email})</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setCancellingReq(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body modal-body-pad">
                            <p className="modal-lead-text">
                                هل أنت متأكد من إلغاء دعوة الموظف <strong>"{cancellingReq.fullName}"</strong>؟
                            </p>
                            <p className="modal-help-text">
                                سيتم إبطال رابط الدعوة فورياً ووضع الحساب في حالة تعليق، مع الحفاظ على كافة السجلات والأكواد في قاعدة البيانات بصورة آمنة ودون حذف أي بيانات.
                            </p>
                            <div className="form-actions mt-4">
                                <button type="button" className="secondary-btn" onClick={() => setCancellingReq(null)} disabled={isActionLoading}>
                                    تراجع
                                </button>
                                <button type="button" className="primary-btn btn-danger-action" onClick={handleConfirmCancelInvite} disabled={isActionLoading}>
                                    {isActionLoading ? 'جارٍ الإلغاء...' : 'تأكيد إلغاء الدعوة'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Consistency Report Modal */}
            {consistencyModalOpen && (
                <div className="modal-backdrop" onClick={() => setConsistencyModalOpen(false)}>
                    <div className="modal-dialog modal-dialog-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-accent">
                                    <ShieldCheck size={18} />
                                </div>
                                <div>
                                    <h3>تقرير مطابقة وتكامل الهويات الوظيفية</h3>
                                    <span className="modal-subtitle">فحص تشخيصي للقراءة فقط — لا يتم تعديل أو حذف أي سجلات</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setConsistencyModalOpen(false)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body modal-body-pad modal-scroll-body">
                            {consistencyLoading ? (
                                <div className="text-center p-5 text-muted">
                                    جارٍ فحص ومطابقة جداول المصادقة والهويات...
                                </div>
                            ) : consistencyReport ? (
                                <div className="grid gap-3 font-sm">
                                    <div className={`info-grid-box flex items-center gap-2 ${consistencyReport.has_issues ? 'status-warn-box' : 'status-ok-box'}`}>
                                        {consistencyReport.has_issues ? <ShieldAlert size={20} color="var(--warn)" /> : <CheckCircle2 size={20} color="var(--ok)" />}
                                        <div>
                                            <strong>{consistencyReport.has_issues ? 'تم رصد حالات تباين تتطلب مراجعة الإدارة' : 'كافة الهويات متطابقة ومنتظمة بالكامل'}</strong>
                                            <span className="block font-xs text-muted">
                                                تاريخ الفحص: {new Date(consistencyReport.generated_at).toLocaleString('ar-EG')}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="info-grid-box">
                                        <strong>حسابات Auth بدون سجل app_users:</strong>
                                        <p className="mt-1 m-0 text-muted font-xs">
                                            {consistencyReport.missing_app_users.length === 0
                                                ? 'لا يوجد أي تباين (0)'
                                                : `${consistencyReport.missing_app_users.length} حساب: ${consistencyReport.missing_app_users.map(u => u.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div className="info-grid-box">
                                        <strong>سجلات app_users بدون حساب Auth:</strong>
                                        <p className="mt-1 m-0 text-muted font-xs">
                                            {consistencyReport.missing_auth_users.length === 0
                                                ? 'لا يوجد أي تباين (0)'
                                                : `${consistencyReport.missing_auth_users.length} سجل: ${consistencyReport.missing_auth_users.map(u => u.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div className="info-grid-box">
                                        <strong>طلبات تسجيل معتمدة بدون إرسال دعوة:</strong>
                                        <p className="mt-1 m-0 text-muted font-xs">
                                            {consistencyReport.approved_without_invitation.length === 0
                                                ? 'لا توجد طلبات معلقة بدون دعوة (0)'
                                                : `${consistencyReport.approved_without_invitation.length} طلب: ${consistencyReport.approved_without_invitation.map(r => r.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div className="info-grid-box">
                                        <strong>حسابات نشطة بدون اسم مستخدم:</strong>
                                        <p className="mt-1 m-0 text-muted font-xs">
                                            {consistencyReport.active_without_username.length === 0
                                                ? 'جميع الحسابات النشطة تمتلك أسماء مستخدمين صحيحة (0)'
                                                : `${consistencyReport.active_without_username.length} حساب`}
                                        </p>
                                    </div>

                                    <div className="info-grid-box">
                                        <strong>عناوين بريد إلكتروني مكررة:</strong>
                                        <p className="mt-1 m-0 text-muted font-xs">
                                            {consistencyReport.duplicate_emails.length === 0
                                                ? 'لا يوجد أي بريد إلكتروني مكرر (0)'
                                                : `${consistencyReport.duplicate_emails.length} مكرر`}
                                        </p>
                                    </div>
                                </div>
                            ) : null}

                            <div className="form-actions mt-4">
                                <button type="button" className="secondary-btn" onClick={() => setConsistencyModalOpen(false)}>
                                    إغلاق التقرير
                                </button>
                                <button type="button" className="primary-btn" onClick={handleOpenConsistencyReport} disabled={consistencyLoading}>
                                    <RefreshCw size={14} className={consistencyLoading ? 'animate-spin' : ''} /> إعادة الفحص
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Suspend Confirmation Modal */}
            {suspendingUser && (
                <div className="modal-backdrop" onClick={() => !isActionLoading && setSuspendingUser(null)}>
                    <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon modal-icon-warning">
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>تعليق حساب الموظف</h3>
                                    <span className="modal-subtitle">المستخدم: {suspendingUser.username}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setSuspendingUser(null)} aria-label="إغلاق النافذة">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body modal-body-pad">
                            <p className="modal-lead-text">
                                هل أنت متأكد من رغبتك في إيقاف وتعليق حساب الموظف <strong>"{suspendingUser.displayName || suspendingUser.username}"</strong>؟
                            </p>
                            <p className="modal-help-text">
                                لن يتمكن الموظف من تسجيل الدخول إلى النظام أو إجراء أي عمليات حتى يتم رفع التعليق وإعادة تنشيطه من قِبل مدير النظام.
                            </p>

                            <div className="form-actions mt-4">
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={() => setSuspendingUser(null)}
                                    disabled={isActionLoading}
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn btn-warning-action"
                                    onClick={() => handleSetStatus(suspendingUser, 'suspended')}
                                    disabled={isActionLoading}
                                >
                                    {isActionLoading ? 'جارٍ التعليق...' : 'تأكيد إيقاف الحساب'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}
