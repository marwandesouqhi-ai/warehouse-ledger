import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
    Check,
    CheckCircle2,
    Clock,
    Copy,
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
    generateActivationPin,
    getLocalSession,
    isLastActiveSystemAdmin,
    loadLocalUsers,
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
import type { RegistrationRequest } from '../lib/employeeIdentity'
import { formatEmployeeId } from '../lib/employeeIdentity'

type UsersPageProps = {
    session?: Session | null
}

export default function UsersPage({ session }: UsersPageProps) {
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

    // Check if current caller is marwan-desouky (protected System Admin)
    const isCallerProtected = isProtectedUsername(activeUserEmail) || isProtectedUsername(session?.user?.email)

    const activeUserRole = ((session?.user?.app_metadata as any)?.role as string) || ((localSess?.user?.app_metadata as any)?.role as string) || ''
    const isDepartmentAdmin = activeUserRole === 'admin'
    const userDepartment = ((session?.user?.app_metadata as any)?.department as string) || ((localSess?.user?.app_metadata as any)?.department as string) || ''

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
    const visibleLocalUsers = useMemo(() => {
        return localUsers.filter((u) => {
            if (isProtectedUsername(u.username)) {
                return isCallerProtected
            }
            return true
        })
    }, [localUsers, isCallerProtected])

    // Add User Form State
    const [newUsername, setNewUsername] = useState('')
    const [newDisplayName, setNewDisplayName] = useState('')
    const [newDepartment, setNewDepartment] = useState<'المخازن' | 'المشتريات' | 'الإدارة العامة'>('المخازن')
    const [newEmail, setNewEmail] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [newRole, setNewRole] = useState<UserRole>('warehouse_employee')
    const [newPermissions, setNewPermissions] = useState<string[]>([])
    const [newActivationCode, setNewActivationCode] = useState(() => generateActivationPin())
    const [newRequirePasswordChange, setNewRequirePasswordChange] = useState(true)
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

    function reloadUsers() {
        setLocalUsers(loadLocalUsers())
        void loadRequests()
    }

    useEffect(() => {
        void loadRequests()
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
        setCopiedPin(false)

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
                activationCode: newActivationCode,
                requireActivation: false,
                notes: newNotes,
                permissions: newPermissions,
            })

            reloadUsers()
            setAddSuccess(`تمت إضافة وتفعيل المستخدم "${added.username}" بنجاح! يمكنه تسجيل الدخول فوراً باستخدام اسم المستخدم وكلمة المرور.`)
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
        setEditPermissions(user.permissions || [])
        setEditPassword('')
        setEditActivationCode(user.activationCode)
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
                if (editPassword.length < 12) {
                    setEditError('كلمة المرور الجديدة يجب ألا تقل عن 12 حرفاً للأمان.')
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
                            permissions: editPermissions,
                        },
                    })
                } catch (edgeCatch) {
                    console.warn('admin-users update_user fallback:', edgeCatch)
                }
            }

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

        if (!modalNewPassword || modalNewPassword.length < 12) {
            setPwdModalError('كلمة المرور يجب أن لا تقل عن 12 حرفاً للأمان.')
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
        if (selfPassword.length < 12) {
            setSelfPasswordError('كلمة المرور يجب ألا تقل عن 12 حرفاً للأمان.')
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

    function copyToClipboard(text: string) {
        void navigator.clipboard.writeText(text).then(() => {
            setCopiedPin(true)
            setTimeout(() => setCopiedPin(false), 2000)
        })
    }

    const filteredUsers = useMemo(() => {
        return visibleLocalUsers.filter((u) => {
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
                u.activationCode,
                statusArabic,
            ], userSearchTerm)
        })
    }, [visibleLocalUsers, userSearchTerm, deptFilter, roleFilter, statusFilter])

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

    const activeUsersCount = visibleLocalUsers.filter((u) => u.status === 'active').length

    if (!isSystemAdmin && !isDepartmentAdmin) {
        return (
            <section className="page-stack users-page">
                <header className="page-intro">
                    <div className="page-intro-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--bad, #ef4444)' }}>
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow" style={{ color: 'var(--bad, #ef4444)' }}>منطقة إدارة مقيدة</p>
                        <h2>المستخدمون والصلاحيات</h2>
                        <p>خاص ومقتصر على مدير النظام (System Admin) ومدراء الأقسام المصرح لهم.</p>
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
                    <p className="eyebrow">إدارة الوصول والأمان والهوية الموحدة</p>
                    <h2>المستخدمون وسجل الموظفين</h2>
                    <p>إدارة حسابات الموظفين، أكواد الهوية الفريدة (Unique ID)، الصلاحيات، وطلبات تسجيل بوت تيليجرام.</p>
                </div>
            </header>

            {/* KPI Summary Block */}
            <div className="kpi-block" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                <div className="kpi-item tone-primary">
                    <span className="kpi-icon"><UsersRound size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">إجمالي الموظفين</span>
                        <strong className="kpi-val">{visibleLocalUsers.length}</strong>
                        <span className="kpi-sub">حسابات مسجلة بالنظام</span>
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

                <div className="kpi-item tone-warn" style={{ cursor: 'pointer' }} onClick={() => setMainTab('requests')}>
                    <span className="kpi-icon"><Send size={18} /></span>
                    <div className="kpi-data">
                        <span className="kpi-label">طلبات تيليجرام بانتظار الاعتماد</span>
                        <strong className="kpi-val" style={{ color: pendingRequestsCount > 0 ? '#ef4444' : 'inherit' }}>
                            {pendingRequestsCount}
                        </strong>
                        <span className="kpi-sub">اضغط لعرض الطلبات واعتمادها</span>
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

            {/* Action Feedback Banner */}
            {actionFeedback && (
                <div
                    className={`inline-message ${actionFeedback.type === 'success' ? 'success' : 'error'}`}
                    style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {actionFeedback.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                        <span>{actionFeedback.message}</span>
                    </div>
                    <button type="button" onClick={() => setActionFeedback(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
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
                    <span className="badge-pill">{visibleLocalUsers.length}</span>
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
                        <span className="badge-pill" style={{ background: '#ef4444', color: '#fff' }}>
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
                <div className="card-surface settings-section" style={{ padding: '26px', marginBottom: '24px', borderRadius: '14px', border: '1px solid var(--line)' }}>
                    <div className="section-head" style={{ marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                            <div>
                                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.12rem', margin: 0 }}>
                                    <UserPlus size={20} color="var(--accent)" />
                                    إضافة وتعيين موظف جديد مباشرة
                                </h3>
                                <span style={{ display: 'block', marginTop: '4px', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                    إنشاء حساب موظف جديد باسم مستخدم، قسم، دور وظيفي، كلمة مرور، وتوليد كود التفعيل
                                </span>
                            </div>
                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => setMainTab('employees')}
                                style={{ height: '36px', padding: '0 16px', fontSize: '0.84rem' }}
                            >
                                العودة لدليل الموظفين
                            </button>
                        </div>
                    </div>

                    <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div className="user-form-grid">
                            <label className="user-field-group">
                                <span>اسم المستخدم (Username) <span style={{ color: 'var(--accent)' }}>*</span></span>
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
                                <span>القسم التابع له <span style={{ color: 'var(--accent)' }}>*</span></span>
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
                                <span>الدور والصلاحية في النظام <span style={{ color: 'var(--accent)' }}>*</span></span>
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
                                    className="user-field-input"
                                    style={{ direction: 'ltr', textAlign: 'right' }}
                                />
                            </label>

                            <label className="user-field-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>كلمة المرور <span style={{ color: 'var(--accent)' }}>*</span></span>
                                    <button
                                        type="button"
                                        onClick={generateRandomPassword}
                                        style={{
                                            background: 'rgba(14, 124, 134, 0.1)',
                                            border: '1px solid rgba(14, 124, 134, 0.25)',
                                            borderRadius: '6px',
                                            color: 'var(--accent)',
                                            cursor: 'pointer',
                                            fontSize: '0.78rem',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '2px 8px'
                                        }}
                                    >
                                        <Sparkles size={13} /> توليد عشوائي
                                    </button>
                                </div>
                                <div style={{ position: 'relative', width: '100%' }}>
                                    <input
                                        type={showNewPassword ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="أدخل كلمة المرور"
                                        required
                                        className="user-field-input"
                                        style={{ paddingRight: '12px', paddingLeft: '40px' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        style={{
                                            position: 'absolute',
                                            left: '10px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: 'var(--muted)',
                                            padding: '4px',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}
                                        title={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </label>
                        </div>

                        <div style={{
                            background: 'var(--panel, rgba(14, 124, 134, 0.04))',
                            padding: '16px 20px',
                            borderRadius: '10px',
                            border: '1px solid var(--line)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px'
                        }}>
                            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--ink)' }}>
                                صلاحيات استثنائية إضافية:
                            </span>
                            <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap' }}>
                                {(['view_audit', 'view_settings', 'manage_records'] as Permission[]).map((p) => (
                                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem', cursor: 'pointer', color: 'var(--ink)' }}>
                                        <input
                                            type="checkbox"
                                            checked={newPermissions.includes(p)}
                                            onChange={(e) => {
                                                if (e.target.checked) setNewPermissions([...newPermissions, p])
                                                else setNewPermissions(newPermissions.filter(x => x !== p))
                                            }}
                                            style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }}
                                        />
                                        <span>{PERMISSION_LABELS[p]}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                            <button type="submit" className="primary-btn" style={{ height: '44px', padding: '0 26px', fontSize: '0.92rem', fontWeight: 600 }}>
                                <UserPlus size={17} /> حفظ وتفعيل الموظف
                            </button>
                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => setMainTab('employees')}
                                style={{ height: '44px', padding: '0 20px', fontSize: '0.88rem' }}
                            >
                                إلغاء
                            </button>
                        </div>
                    </form>

                    {addSuccess && (
                        <div className="inline-message success" role="status" style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle2 size={18} />
                                <span>{addSuccess}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <button
                                    type="button"
                                    className="text-link-btn"
                                    onClick={() => copyToClipboard(addSuccess.split('كود تأكيد التفعيل: ')[1] || '')}
                                    style={{ fontSize: '0.82rem' }}
                                >
                                    <Copy size={14} /> {copiedPin ? 'تم النسخ!' : 'نسخ الكود'}
                                </button>
                                <button
                                    type="button"
                                    className="primary-btn"
                                    onClick={() => setMainTab('employees')}
                                    style={{ height: '32px', padding: '0 12px', fontSize: '0.8rem' }}
                                >
                                    عرض في دليل الموظفين
                                </button>
                            </div>
                        </div>
                    )}

                    {addError && (
                        <div className="inline-message error" role="alert" style={{ marginTop: '16px' }}>
                            {addError}
                        </div>
                    )}
                </div>
            )}

            {/* Tab 1: Employee Directory */}
            {mainTab === 'employees' && (
                <div className="card-surface settings-section" style={{ padding: '20px' }}>
                    <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                        <div>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <UsersRound size={19} color="var(--accent)" />
                                دليل الموظفين والحسابات المسجلة
                            </h3>
                            <span>قائمة الحسابات، الأقسام، أكواد الموظفين الفريدة (Unique ID)، وحالة التفعيل</span>
                        </div>

                        {/* Search & Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <select
                                    value={deptFilter}
                                    onChange={(e) => setDeptFilter(e.target.value)}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                                >
                                    <option value="all">كل الأقسام</option>
                                    <option value="المخازن">المخازن</option>
                                    <option value="المشتريات">المشتريات</option>
                                    <option value="الإدارة العامة">الإدارة العامة</option>
                                </select>

                                <select
                                    value={roleFilter}
                                    onChange={(e) => setRoleFilter(e.target.value)}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                                >
                                    <option value="all">كل الصلاحيات</option>
                                    {ASSIGNABLE_ROLES.map((r) => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>

                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                                >
                                    <option value="all">كل الحالات</option>
                                    <option value="active">نشط ومفعل</option>
                                    <option value="pending_activation">معلق / بانتظار التفعيل</option>
                                    <option value="suspended">موقوف مؤقتاً</option>
                                </select>

                                <div style={{ position: 'relative', minWidth: '220px' }}>
                                    <input
                                        type="search"
                                        placeholder="بحث بالاسم، الكود، المعرف..."
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
                                        <th>كود الموظف (Unique ID)</th>
                                        <th>اسم المستخدم</th>
                                        <th>الاسم والبريد</th>
                                        <th>القسم والصلاحية</th>
                                        <th>كود التفعيل (PIN)</th>
                                        <th>حالة الحساب</th>
                                        <th>تاريخ الإنشاء</th>
                                        {isSystemAdmin && <th className="actions-header">الإجراءات</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.length === 0 ? (
                                        <tr>
                                            <td colSpan={isSystemAdmin ? 9 : 8} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
                                                لا توجد حسابات موظفين مطابقة للبحث أو الفلتر
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredUsers.map((user, idx) => (
                                            <tr key={user.id}>
                                                <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{idx + 1}</td>
                                                <td>
                                                    {user.employeeId ? (
                                                        <span style={{
                                                            fontFamily: 'monospace',
                                                            fontWeight: 700,
                                                            fontSize: '0.86rem',
                                                            padding: '2px 8px',
                                                            borderRadius: '6px',
                                                            background: 'rgba(14, 124, 134, 0.08)',
                                                            color: 'var(--accent)',
                                                            border: '1px solid rgba(14, 124, 134, 0.2)',
                                                            display: 'inline-block',
                                                            direction: 'ltr',
                                                        }}>
                                                            {formatEmployeeId(user.employeeId)}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <strong style={{ direction: 'ltr', display: 'inline-block', color: 'var(--ink)', fontSize: '0.92rem' }}>
                                                        {user.username}
                                                    </strong>
                                                    {(user.username === currentSession?.user?.email || user.username === activeUserEmail) && (
                                                        <span style={{ marginRight: '6px', fontSize: '0.72rem', background: 'var(--accent-wash)', color: 'var(--accent)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                                            أنت
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <span style={{ fontWeight: 500 }}>{user.displayName || '—'}</span>
                                                        {user.email && (
                                                            <span style={{ fontSize: '0.76rem', color: 'var(--muted)', direction: 'ltr', textAlign: 'right' }}>
                                                                {user.email}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
                                                            {user.department || 'المخازن'}
                                                        </span>
                                                        <span style={{
                                                            fontSize: '0.78rem',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            fontWeight: 600,
                                                            background: (user.role === 'system_admin' || user.role === 'admin')
                                                                ? 'rgba(14, 124, 134, 0.12)'
                                                                : (user.role === 'warehouse_staff' || user.role === 'editor' || user.role === 'warehouse_employee' || user.role === 'warehouse_admin')
                                                                    ? 'rgba(59, 130, 246, 0.12)'
                                                                    : 'rgba(16, 185, 129, 0.12)',
                                                            color: (user.role === 'system_admin' || user.role === 'admin')
                                                                ? 'var(--accent)'
                                                                : (user.role === 'warehouse_staff' || user.role === 'editor' || user.role === 'warehouse_employee' || user.role === 'warehouse_admin')
                                                                    ? '#2563eb'
                                                                    : '#059669',
                                                        }}>
                                                            {ROLE_LABELS[user.role as EffectiveRole] || user.role}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(0, 0, 0, 0.04)', padding: '2px 8px', borderRadius: '6px' }}>
                                                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.88rem', color: 'var(--ink)' }}>
                                                            {user.activationCode || '—'}
                                                        </span>
                                                        {user.activationCode && (
                                                            <button
                                                                type="button"
                                                                onClick={() => copyToClipboard(user.activationCode)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex' }}
                                                                title="نسخ كود التفعيل"
                                                            >
                                                                <Copy size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span style={{
                                                        fontSize: '0.78rem',
                                                        padding: '3px 9px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: user.status === 'active'
                                                            ? 'rgba(16, 185, 129, 0.12)'
                                                            : user.status === 'suspended'
                                                                ? 'rgba(239, 68, 68, 0.12)'
                                                                : 'rgba(245, 158, 11, 0.14)',
                                                        color: user.status === 'active'
                                                            ? '#059669'
                                                            : user.status === 'suspended'
                                                                ? '#dc2626'
                                                                : '#d97706',
                                                        border: `1px solid ${user.status === 'active'
                                                            ? 'rgba(16, 185, 129, 0.25)'
                                                            : user.status === 'suspended'
                                                                ? 'rgba(239, 68, 68, 0.25)'
                                                                : 'rgba(245, 158, 11, 0.3)'}`,
                                                    }}>
                                                        {user.status === 'active'
                                                            ? 'نشط مفعل'
                                                            : user.status === 'suspended'
                                                                ? 'موقوف مؤقتاً'
                                                                : 'بانتظار التفعيل'}
                                                    </span>
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
                                                                    style={{ color: '#2563eb' }}
                                                                >
                                                                    <Send size={15} />
                                                                </button>
                                                            )}
                                                            {!isProtectedUsername(user.username) && (
                                                                <button
                                                                    type="button"
                                                                    className="action-icon-btn"
                                                                    onClick={() => {
                                                                        if (user.status === 'suspended') {
                                                                            void handleSetStatus(user, 'active')
                                                                        } else {
                                                                            setSuspendingUser(user)
                                                                        }
                                                                    }}
                                                                    title={user.status === 'suspended' ? 'إعادة تنشيط الحساب' : 'تعليق وإيقاف الحساب'}
                                                                    style={{ color: user.status === 'suspended' ? '#059669' : '#d97706' }}
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
                <div className="card-surface settings-section" style={{ padding: '20px' }}>
                    <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                        <div>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Send size={19} color="var(--accent)" />
                                طلبات التسجيل الواردة عبر بوت تيليجرام
                            </h3>
                            <span>مراجعة بيانات الموظفين المتقدمين، التحقق من البريد الإلكتروني، والاعتماد وتخصيص كود فريد</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <select
                                value={requestStatusFilter}
                                onChange={(e) => setRequestStatusFilter(e.target.value)}
                                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
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
                                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                            >
                                <option value="all">كل الأقسام</option>
                                <option value="المخازن">المخازن</option>
                                <option value="المشتريات">المشتريات</option>
                            </select>

                            <select
                                value={requestRoleFilter}
                                onChange={(e) => setRequestRoleFilter(e.target.value)}
                                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', fontSize: '0.84rem' }}
                            >
                                <option value="all">كل الأدوار المطلوبة</option>
                                <option value="warehouse_employee">موظف مخازن</option>
                                <option value="warehouse_admin">مدير مخازن</option>
                                <option value="procurement_employee">موظف مشتريات</option>
                                <option value="procurement_admin">مدير مشتريات</option>
                            </select>

                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => void loadRequests()}
                                disabled={requestsLoading}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', fontSize: '0.84rem' }}
                            >
                                <RefreshCw size={14} className={requestsLoading ? 'animate-spin' : ''} />
                                تحديث
                            </button>

                            {isSystemAdmin && (
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={() => void handleOpenConsistencyReport()}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', fontSize: '0.84rem' }}
                                    title="فحص تشخيصي للقراءة فقط لتكامل حسابات الموظفين والهويات"
                                >
                                    <ShieldCheck size={14} color="var(--accent)" />
                                    تقرير تكامل الهويات
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Delegation Control Banner */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        background: 'var(--panel, rgba(255,255,255,0.03))',
                        border: '1px solid var(--line)',
                        borderRadius: '10px',
                        marginBottom: '16px',
                        gap: '12px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <ShieldCheck size={20} color="var(--accent)" />
                            <div>
                                <strong style={{ fontSize: '0.9rem', display: 'block', color: 'var(--ink)' }}>
                                    تفويض مراجعة واعتماد طلبات الموظفين لمدراء الأقسام
                                </strong>
                                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                    {deptDelegationEnabled
                                        ? 'مفعّل: يحق لمدير القسم مراجعة واعتماد موظفي قسمه فقط وتخصيص أكوادهم.'
                                        : 'معطّل (الافتراضي): اعتماد الموظفين مقتصر حصرياً على مدير النظام الرئيسي.'}
                                </span>
                            </div>
                        </div>
                        {isSystemAdmin && (
                            <button
                                type="button"
                                className={deptDelegationEnabled ? 'secondary-btn' : 'primary-btn'}
                                onClick={() => void handleToggleDelegation()}
                                disabled={delegationLoading}
                                style={{ height: '34px', padding: '0 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                            >
                                {delegationLoading
                                    ? 'جاري الحفظ...'
                                    : deptDelegationEnabled
                                        ? 'تعطيل تفويض الأقسام'
                                        : 'تفعيل تفويض الأقسام'}
                            </button>
                        )}
                    </div>

                    <div className="table-scroll-container">
                        <table className="custody-table">
                            <thead>
                                <tr>
                                    <th>م</th>
                                    <th>معرف الطلب (ID)</th>
                                    <th>اسم المتقدم</th>
                                    <th>البريد الإلكتروني</th>
                                    <th>التحقق (OTP)</th>
                                    <th>القسم المطلوب</th>
                                    <th>الدور المطلوب / المعتمد</th>
                                    <th>حالة الدعوة</th>
                                    <th>تيليجرام ID</th>
                                    <th>تاريخ التقديم</th>
                                    <th>حالة الطلب</th>
                                    <th className="actions-header">الإجراءات والقرار</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRequests.length === 0 ? (
                                    <tr>
                                        <td colSpan={12} style={{ textAlign: 'center', padding: '36px', color: 'var(--muted)' }}>
                                            {requestsLoading ? 'جارٍ تحميل طلبات التسجيل...' : 'لا توجد طلبات تسجيل مطابقة لهذا الفلتر حالياً.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRequests.map((req, idx) => (
                                        <tr key={req.id}>
                                            <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{idx + 1}</td>
                                            <td style={{ fontSize: '0.74rem', fontFamily: 'monospace', color: 'var(--muted)' }} title={req.id}>
                                                {req.id.slice(0, 8)}...
                                            </td>
                                            <td>
                                                <strong style={{ color: 'var(--ink)' }}>{req.fullName}</strong>
                                            </td>
                                            <td style={{ direction: 'ltr', textAlign: 'right', fontSize: '0.86rem' }}>
                                                {req.email}
                                            </td>
                                            <td>
                                                {req.verificationStatus === 'verified' ? (
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: 'rgba(16, 185, 129, 0.12)',
                                                        color: '#059669',
                                                        border: '1px solid rgba(16, 185, 129, 0.25)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}>
                                                        <CheckCircle2 size={12} /> تم التحقق
                                                    </span>
                                                ) : (
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: 'rgba(245, 158, 11, 0.12)',
                                                        color: '#d97706',
                                                        border: '1px solid rgba(245, 158, 11, 0.25)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}>
                                                        <Clock size={12} /> بانتظار OTP
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                                                    {req.requestedDepartment}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '0.8rem' }}>
                                                    <span style={{ color: 'var(--ink)' }}>
                                                        {ROLE_LABELS[req.requestedRole as EffectiveRole] || req.requestedRole}
                                                    </span>
                                                    {req.approvedRole && req.approvedRole !== req.requestedRole && (
                                                        <strong style={{ color: 'var(--accent)', display: 'block', marginTop: '2px' }}>
                                                            ← {ROLE_LABELS[req.approvedRole as EffectiveRole] || req.approvedRole}
                                                        </strong>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                {req.invitationStatus === 'accepted' ? (
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: 'rgba(16, 185, 129, 0.12)',
                                                        color: '#059669',
                                                        border: '1px solid rgba(16, 185, 129, 0.25)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}>
                                                        <CheckCircle2 size={12} /> تم تفعيل الحساب
                                                    </span>
                                                ) : req.invitationStatus === 'sent' ? (
                                                    <div style={{ display: 'grid', gap: '2px' }}>
                                                        <span style={{
                                                            fontSize: '0.74rem',
                                                            padding: '2px 8px',
                                                            borderRadius: '999px',
                                                            fontWeight: 600,
                                                            background: 'rgba(37, 99, 235, 0.12)',
                                                            color: '#2563eb',
                                                            border: '1px solid rgba(37, 99, 235, 0.25)',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}>
                                                            <Mail size={12} /> تم إرسال الدعوة
                                                        </span>
                                                        {req.invitationSentAt && (
                                                            <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                                                                {new Date(req.invitationSentAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : req.invitationStatus === 'failed' ? (
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: 'rgba(239, 68, 68, 0.12)',
                                                        color: '#dc2626',
                                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}>
                                                        <ShieldAlert size={12} /> فشل الإرسال
                                                    </span>
                                                ) : req.invitationStatus === 'cancelled' ? (
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        fontWeight: 600,
                                                        background: 'rgba(107, 114, 128, 0.12)',
                                                        color: '#6b7280',
                                                        border: '1px solid rgba(107, 114, 128, 0.25)',
                                                    }}>
                                                        دعوة ملغاة
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
                                                        {req.approvalStatus === 'approved' ? 'بانتظار الإرسال' : '—'}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--muted)' }}>
                                                {req.telegramUserId || '—'}
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                                {new Date(req.createdAt).toLocaleDateString('ar-EG')}
                                            </td>
                                            <td>
                                                <span style={{
                                                    fontSize: '0.76rem',
                                                    padding: '3px 9px',
                                                    borderRadius: '999px',
                                                    fontWeight: 600,
                                                    background: req.approvalStatus === 'approved'
                                                        ? 'rgba(16, 185, 129, 0.12)'
                                                        : req.approvalStatus === 'rejected'
                                                            ? 'rgba(239, 68, 68, 0.12)'
                                                            : 'rgba(59, 130, 246, 0.12)',
                                                    color: req.approvalStatus === 'approved'
                                                        ? '#059669'
                                                        : req.approvalStatus === 'rejected'
                                                            ? '#dc2626'
                                                            : '#2563eb',
                                                    border: `1px solid ${req.approvalStatus === 'approved'
                                                        ? 'rgba(16, 185, 129, 0.25)'
                                                        : req.approvalStatus === 'rejected'
                                                            ? 'rgba(239, 68, 68, 0.25)'
                                                            : 'rgba(59, 130, 246, 0.25)'}`,
                                                }}>
                                                    {req.approvalStatus === 'approved'
                                                        ? 'معتمد'
                                                        : req.approvalStatus === 'rejected'
                                                            ? 'مرفوض'
                                                            : 'بانتظار الاعتماد'}
                                                </span>
                                            </td>
                                            <td className="actions-cell">
                                                {req.approvalStatus === 'pending' || req.approvalStatus === 'pending_approval' || !req.approvalStatus ? (
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <button
                                                            type="button"
                                                            className="primary-btn"
                                                            onClick={() => {
                                                                setApprovingReq(req)
                                                                setSelectedApprovedRole(req.requestedRole || 'warehouse_employee')
                                                            }}
                                                            style={{ height: '32px', padding: '0 12px', fontSize: '0.78rem' }}
                                                        >
                                                            <CheckCircle2 size={13} /> قبول وإرسال الدعوة
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="secondary-btn"
                                                            onClick={() => {
                                                                setRejectingReq(req)
                                                                setRejectionReasonInput('')
                                                            }}
                                                            style={{ height: '32px', padding: '0 10px', fontSize: '0.78rem', color: '#dc2626' }}
                                                        >
                                                            <UserX size={13} /> رفض
                                                        </button>
                                                    </div>
                                                ) : req.approvalStatus === 'approved' ? (
                                                    req.invitationStatus === 'accepted' ? (
                                                        <span style={{ fontSize: '0.78rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Check size={14} /> مفعّل ({req.employeeId || req.approvedRole})
                                                        </span>
                                                    ) : req.invitationStatus === 'cancelled' ? (
                                                        <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                                                            ملغاة
                                                        </span>
                                                    ) : (
                                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                            <button
                                                                type="button"
                                                                className="secondary-btn"
                                                                onClick={() => void handleResendInvite(req)}
                                                                disabled={isActionLoading}
                                                                style={{ height: '30px', padding: '0 8px', fontSize: '0.76rem' }}
                                                                title="إعادة إرسال رابط الدعوة إلى البريد الإلكتروني"
                                                            >
                                                                <RefreshCw size={12} className={isActionLoading ? 'animate-spin' : ''} /> إعادة إرسال
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="secondary-btn"
                                                                onClick={() => setCancellingReq(req)}
                                                                disabled={isActionLoading}
                                                                style={{ height: '30px', padding: '0 8px', fontSize: '0.76rem', color: '#dc2626' }}
                                                                title="إلغاء الدعوة وتعليق الحساب"
                                                            >
                                                                <UserX size={12} /> إلغاء
                                                            </button>
                                                        </div>
                                                    )
                                                ) : (
                                                    <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }} title={req.rejectionReason || ''}>
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
                <div className="card-surface settings-section" style={{ padding: '24px', borderRadius: '14px', border: '1px solid var(--line)' }}>
                    <div className="section-head" style={{ marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '14px' }}>
                        <div>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.12rem', margin: 0 }}>
                                <KeyRound size={20} color="var(--accent)" />
                                أمان الحساب وتغيير كلمة المرور
                            </h3>
                            <span style={{ display: 'block', marginTop: '4px', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                إدارة أمان حسابك الشخصي ({activeUserEmail}) وتعيين كلمة مرور جديدة لتسجيل الدخول بها لاحقاً
                            </span>
                        </div>
                    </div>

                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px',
                        padding: '14px 18px',
                        background: 'var(--panel, rgba(255,255,255,0.03))',
                        border: '1px solid var(--line)',
                        borderRadius: '10px',
                        marginBottom: '22px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                background: 'rgba(16, 185, 129, 0.12)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--accent)'
                            }}>
                                <ShieldCheck size={22} />
                            </div>
                            <div>
                                <strong style={{ fontSize: '0.92rem', display: 'block', color: 'var(--ink)' }}>
                                    {activeUserEmail}
                                </strong>
                                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                    الدور الحالي: {isSystemAdmin ? 'مدير النظام الرئيسي' : (ROLE_LABELS[activeUserRole as EffectiveRole] || activeUserRole || 'موظف')}
                                </span>
                            </div>
                        </div>
                        <span style={{
                            fontSize: '0.76rem',
                            padding: '4px 12px',
                            borderRadius: '999px',
                            fontWeight: 600,
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#059669',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            <CheckCircle2 size={13} /> جلسة موثقة ونشطة
                        </span>
                    </div>

                    <div style={{ maxWidth: '640px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '18px' }}>
                            <label className="user-field-group">
                                <span>كلمة المرور الجديدة <span style={{ color: 'var(--accent)' }}>*</span></span>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type={showSelfPassword ? 'text' : 'password'}
                                        value={selfPassword}
                                        onChange={(e) => setSelfPassword(e.target.value)}
                                        placeholder="أدخل كلمة المرور الجديدة"
                                        className="user-field-input"
                                        style={{ paddingLeft: '40px' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowSelfPassword(!showSelfPassword)}
                                        style={{ position: 'absolute', left: '10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center' }}
                                    >
                                        {showSelfPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </label>

                            <label className="user-field-group">
                                <span>تأكيد كلمة المرور <span style={{ color: 'var(--accent)' }}>*</span></span>
                                <input
                                    type={showSelfPassword ? 'text' : 'password'}
                                    value={selfConfirm}
                                    onChange={(e) => setSelfConfirm(e.target.value)}
                                    placeholder="أعد كتابة كلمة المرور"
                                    className="user-field-input"
                                />
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="primary-btn"
                                onClick={handleSaveSelfPassword}
                                disabled={selfPasswordSaving || !selfPassword}
                                style={{ height: '42px', padding: '0 24px', fontSize: '0.88rem', fontWeight: 600 }}
                            >
                                <Lock size={16} />
                                {selfPasswordSaving ? 'جارٍ الحفظ...' : 'تحديث كلمة المرور الآن'}
                            </button>
                        </div>
                    </div>

                    {selfPasswordSuccess && (
                        <div className="inline-message success" role="status" style={{ marginTop: '16px', maxWidth: '640px' }}>
                            <CheckCircle2 size={16} /> {selfPasswordSuccess}
                        </div>
                    )}

                    {selfPasswordError && (
                        <div className="inline-message error" role="alert" style={{ marginTop: '16px', maxWidth: '640px' }}>
                            {selfPasswordError}
                        </div>
                    )}
                </div>
            )}

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
                                    الصلاحية {editingUser && isLastActiveSystemAdmin(editingUser.id, localUsers) && <span style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>(آخر مدير نظام نشط محمي ضد خفض الصلاحيات)</span>}
                                    <select
                                        value={editRole}
                                        onChange={(e) => setEditRole(e.target.value as UserRole)}
                                        disabled={editingUser ? isLastActiveSystemAdmin(editingUser.id, localUsers) : false}
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
                                    حالة الحساب {editingUser && isLastActiveSystemAdmin(editingUser.id, localUsers) && <span style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>(نشط دائماً ومحمي ضد التعطيل)</span>}
                                    <select
                                        value={editStatus}
                                        onChange={(e) => setEditStatus(e.target.value as 'active' | 'pending_activation')}
                                        disabled={editingUser ? isLastActiveSystemAdmin(editingUser.id, localUsers) : false}
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

            {/* Approve Registration Request Modal */}
            {approvingReq && (
                <div className="modal-backdrop" onClick={() => !isActionLoading && setApprovingReq(null)}>
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#059669' }}>
                                    <CheckCircle2 size={18} />
                                </div>
                                <div>
                                    <h3>اعتماد طلب تسجيل الموظف</h3>
                                    <span className="modal-subtitle">المتقدم: {approvingReq.fullName}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setApprovingReq(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '16px', fontSize: '0.86rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', alignItems: 'center' }}>
                                    <span style={{ color: 'var(--muted)' }}>البريد الإلكتروني:</span>
                                    <strong style={{ direction: 'ltr', textAlign: 'right' }}>{approvingReq.email}</strong>

                                    <span style={{ color: 'var(--muted)' }}>القسم المطلوب:</span>
                                    <span>{approvingReq.requestedDepartment}</span>

                                    <span style={{ color: 'var(--muted)' }}>الدور المطلوب:</span>
                                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                        {ROLE_LABELS[approvingReq.requestedRole as EffectiveRole] || approvingReq.requestedRole}
                                    </span>

                                    <span style={{ color: 'var(--muted)' }}>حالة التحقق:</span>
                                    <span>
                                        {approvingReq.verificationStatus === 'verified'
                                            ? 'تم التحقق من البريد الإلكتروني بنجاح'
                                            : 'بانتظار رمز OTP'}
                                    </span>
                                </div>
                            </div>

                            <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem', marginBottom: '16px' }}>
                                <span>الدور النهائي المُعتمد للموظف <span style={{ color: 'var(--accent)' }}>*</span></span>
                                <select
                                    value={selectedApprovedRole}
                                    onChange={(e) => setSelectedApprovedRole(e.target.value)}
                                    style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
                                >
                                    {ASSIGNABLE_ROLES.filter((r) => r.value !== 'system_admin').map((r) => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>
                                <span style={{ fontSize: '0.76rem', color: 'var(--muted)', lineHeight: '1.5' }}>
                                    سيتم توليد الرقم الوظيفي الموحد (Unique ID) فورياً، وإنشاء ملف الموظف بحالة بانتظار التفعيل، وإرسال رابط دعوة إلى بريده الإلكتروني ({approvingReq.email}) عبر Google SMTP لاختيار اسم المستخدم وكلمة المرور.
                                </span>
                            </label>

                            <div className="form-actions" style={{ marginTop: '16px' }}>
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
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' }}>
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>رفض طلب التسجيل</h3>
                                    <span className="modal-subtitle">المتقدم: {rejectingReq.fullName}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setRejectingReq(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink)' }}>
                                هل أنت متأكد من رغبتك في رفض طلب التسجيل للمتقدم <strong>"{rejectingReq.fullName}"</strong>؟
                            </p>

                            <label style={{ display: 'grid', gap: '6px', fontSize: '0.88rem', marginBottom: '16px' }}>
                                <span>سبب الرفض (سيتم حفظه في السجل وإبلاغ المتقدم):</span>
                                <textarea
                                    value={rejectionReasonInput}
                                    onChange={(e) => setRejectionReasonInput(e.target.value)}
                                    placeholder="مثال: لم يتم استيفاء شروط الانضمام، أو بيانات الاتصال غير مطابقة..."
                                    rows={3}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: '0.86rem' }}
                                />
                            </label>

                            <div className="form-actions" style={{ marginTop: '16px' }}>
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
                                    className="primary-btn"
                                    onClick={handleRejectRequest}
                                    disabled={isActionLoading}
                                    style={{ background: '#dc2626', borderColor: '#dc2626' }}
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
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' }}>
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>إلغاء دعوة الموظف</h3>
                                    <span className="modal-subtitle">{cancellingReq.fullName} ({cancellingReq.email})</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setCancellingReq(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '20px' }}>
                            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--ink)', margin: '0 0 12px 0' }}>
                                هل أنت متأكد من إلغاء دعوة الموظف <strong>"{cancellingReq.fullName}"</strong>؟
                            </p>
                            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: '1.5', margin: 0 }}>
                                سيتم إبطال رابط الدعوة فورياً ووضع الحساب في حالة تعليق، مع الحفاظ على كافة السجلات والأكواد في قاعدة البيانات بصورة آمنة ودون حذف أي بيانات.
                            </p>
                            <div className="form-actions" style={{ marginTop: '20px' }}>
                                <button type="button" className="secondary-btn" onClick={() => setCancellingReq(null)} disabled={isActionLoading}>
                                    تراجع
                                </button>
                                <button type="button" className="primary-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={handleConfirmCancelInvite} disabled={isActionLoading}>
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
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(14, 124, 134, 0.12)', color: 'var(--accent)' }}>
                                    <ShieldCheck size={18} />
                                </div>
                                <div>
                                    <h3>تقرير مطابقة وتكامل الهويات الوظيفية</h3>
                                    <span className="modal-subtitle">فحص تشخيصي للقراءة فقط — لا يتم تعديل أو حذف أي سجلات</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => setConsistencyModalOpen(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
                            {consistencyLoading ? (
                                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
                                    جارٍ فحص ومطابقة جداول المصادقة والهويات...
                                </div>
                            ) : consistencyReport ? (
                                <div style={{ display: 'grid', gap: '14px', fontSize: '0.88rem' }}>
                                    <div style={{
                                        padding: '12px 16px',
                                        borderRadius: '8px',
                                        background: consistencyReport.has_issues ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                        border: `1px solid ${consistencyReport.has_issues ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                    }}>
                                        {consistencyReport.has_issues ? <ShieldAlert size={20} color="#d97706" /> : <CheckCircle2 size={20} color="#059669" />}
                                        <div>
                                            <strong>{consistencyReport.has_issues ? 'تم رصد حالات تباين تتطلب مراجعة الإدارة' : 'كافة الهويات متطابقة ومنتظمة بالكامل'}</strong>
                                            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)' }}>
                                                تاريخ الفحص: {new Date(consistencyReport.generated_at).toLocaleString('ar-EG')}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                                        <strong>حسابات Auth بدون سجل app_users:</strong>
                                        <p style={{ margin: '4px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                                            {consistencyReport.missing_app_users.length === 0
                                                ? 'لا يوجد أي تباين (0)'
                                                : `${consistencyReport.missing_app_users.length} حساب: ${consistencyReport.missing_app_users.map(u => u.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                                        <strong>سجلات app_users بدون حساب Auth:</strong>
                                        <p style={{ margin: '4px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                                            {consistencyReport.missing_auth_users.length === 0
                                                ? 'لا يوجد أي تباين (0)'
                                                : `${consistencyReport.missing_auth_users.length} سجل: ${consistencyReport.missing_auth_users.map(u => u.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                                        <strong>طلبات تسجيل معتمدة بدون إرسال دعوة:</strong>
                                        <p style={{ margin: '4px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                                            {consistencyReport.approved_without_invitation.length === 0
                                                ? 'لا توجد طلبات معلقة بدون دعوة (0)'
                                                : `${consistencyReport.approved_without_invitation.length} طلب: ${consistencyReport.approved_without_invitation.map(r => r.email).join(', ')}`}
                                        </p>
                                    </div>

                                    <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                                        <strong>حسابات نشطة بدون اسم مستخدم:</strong>
                                        <p style={{ margin: '4px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                                            {consistencyReport.active_without_username.length === 0
                                                ? 'جميع الحسابات النشطة تمتلك أسماء مستخدمين صحيحة (0)'
                                                : `${consistencyReport.active_without_username.length} حساب`}
                                        </p>
                                    </div>

                                    <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                                        <strong>عناوين بريد إلكتروني مكررة:</strong>
                                        <p style={{ margin: '4px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                                            {consistencyReport.duplicate_emails.length === 0
                                                ? 'لا يوجد أي بريد إلكتروني مكرر (0)'
                                                : `${consistencyReport.duplicate_emails.length} مكرر`}
                                        </p>
                                    </div>
                                </div>
                            ) : null}

                            <div className="form-actions" style={{ marginTop: '20px' }}>
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
                    <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
                        <div className="modal-header">
                            <div className="modal-title-wrap">
                                <div className="modal-title-icon" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#d97706' }}>
                                    <UserX size={18} />
                                </div>
                                <div>
                                    <h3>تعليق حساب الموظف</h3>
                                    <span className="modal-subtitle">المستخدم: {suspendingUser.username}</span>
                                </div>
                            </div>
                            <button type="button" className="modal-close-btn" onClick={() => !isActionLoading && setSuspendingUser(null)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: '20px' }}>
                            <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--ink)' }}>
                                هل أنت متأكد من رغبتك في إيقاف وتعليق حساب الموظف <strong>"{suspendingUser.displayName || suspendingUser.username}"</strong>؟
                            </p>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: '1.5' }}>
                                لن يتمكن الموظف من تسجيل الدخول إلى النظام أو إجراء أي عمليات حتى يتم رفع التعليق وإعادة تنشيطه من قِبل مدير النظام.
                            </p>

                            <div className="form-actions" style={{ marginTop: '20px' }}>
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
                                    className="primary-btn"
                                    onClick={() => handleSetStatus(suspendingUser, 'suspended')}
                                    disabled={isActionLoading}
                                    style={{ background: '#d97706', borderColor: '#d97706' }}
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
