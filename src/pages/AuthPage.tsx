import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
    CheckCircle2,
    Eye,
    EyeOff,
    Headphones,
    KeyRound,
    LogIn,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    UserCheck,
    Warehouse,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import type { AppSettings } from '../lib/settings'
import { logAuditEvent } from '../lib/auditLogger'
import { isSupabaseConfigured } from '../lib/authMode'
import { validateChosenUsername, validateChosenPassword, validateChosenPasswordAsync } from '../lib/employeeIdentity'
import { getInviteProfile, completeAccountActivation, sendPasswordRecovery, type InviteProfile } from '../lib/registrationService'
import { ROLE_LABELS } from '../lib/permissions'

function getEmailFromUrl(): string {
    if (typeof window === 'undefined') return ''
    try {
        const searchParams = new URLSearchParams(window.location.search)
        let emailFromSearch = searchParams.get('email')
        if (emailFromSearch) {
            emailFromSearch = decodeURIComponent(emailFromSearch).trim()
            if (emailFromSearch.includes('#')) emailFromSearch = emailFromSearch.split('#')[0]
            if (emailFromSearch.includes('?')) emailFromSearch = emailFromSearch.split('?')[0]
            if (emailFromSearch) return emailFromSearch
        }

        const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : ''
        const hashParts = hash.split('#')
        for (const part of hashParts) {
            const hashParams = new URLSearchParams(part)
            let emailFromHash = hashParams.get('email')
            if (emailFromHash) {
                emailFromHash = decodeURIComponent(emailFromHash).trim()
                if (emailFromHash.includes('#')) emailFromHash = emailFromHash.split('#')[0]
                if (emailFromHash.includes('?')) emailFromHash = emailFromHash.split('?')[0]
                if (emailFromHash) return emailFromHash
            }
        }
    } catch {
        // ignore
    }
    return ''
}

type AuthMode = 'signIn' | 'forgotPassword' | 'setNewPassword' | 'activateAccount'

type AuthPageProps = {
    initialMode?: AuthMode
    onPasswordSet?: () => void
    settings?: AppSettings
}

export default function AuthPage({ initialMode = 'signIn', onPasswordSet, settings }: AuthPageProps) {
    const [mode, setMode] = useState<AuthMode>(initialMode)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [activeUserEmail, setActiveUserEmail] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Invite profile state
    const [urlEmail] = useState<string>(getEmailFromUrl)
    const [inviteProfile, setInviteProfile] = useState<InviteProfile | null>(null)
    const [isLoadingProfile, setIsLoadingProfile] = useState(false)
    const [profileLoadError, setProfileLoadError] = useState('')

    const isConfigured = Boolean(supabase && isSupabaseConfigured())

    // Check for errors returned in the URL hash or query string
    useEffect(() => {
        if (typeof window === 'undefined') return
        const hash = window.location.hash || ''
        const search = window.location.search || ''
        if (hash.includes('error=') || search.includes('error=')) {
            const raw = hash.includes('error=') ? hash.replace(/^#/, '') : search.replace(/^\?/, '')
            const params = new URLSearchParams(raw)
            const code = params.get('error_code') || ''
            const desc = params.get('error_description') || params.get('error') || ''
            if (code === 'otp_expired' || desc.toLowerCase().includes('expired') || desc.toLowerCase().includes('invalid')) {
                setError('⚠️ رابط تفعيل الحساب أو استعادة كلمة المرور غير صالح أو انتهت صلاحيته (الروابط صالحة للاستخدام لمرة واحدة فقط). إذا كنت بحاجة لرابط جديد، يمكنك طلبه مجدداً.')
            } else if (desc) {
                setError(decodeURIComponent(desc.replace(/\+/g, ' ')))
            }
            // Clean URL hash so back/refresh doesn't re-trigger error state
            window.history.replaceState(null, '', window.location.pathname)
        }
    }, [])

    useEffect(() => {
        if (mode === 'setNewPassword' && supabase) {
            void supabase.auth.getUser().then(({ data }) => {
                if (data.user?.email) {
                    setActiveUserEmail(data.user.email)
                }
            })
        }
    }, [mode])

    const loadInviteProfile = (fallbackEmail?: string) => {
        if (!supabase) return
        setIsLoadingProfile(true)
        setProfileLoadError('')
        let targetEmail = fallbackEmail || urlEmail || getEmailFromUrl()
        if (targetEmail.includes('#')) targetEmail = targetEmail.split('#')[0]
        if (targetEmail.includes('?')) targetEmail = targetEmail.split('?')[0]
        targetEmail = targetEmail.trim()

        getInviteProfile(targetEmail)
            .then((res) => {
                if (res.success && res.profile) {
                    setInviteProfile(res.profile)
                    if (res.profile.status === 'active') {
                        setNotice('عذراً، تم استخدام رابط التفعيل هذا مسبقاً وتفعيل الحساب بالفعل. رابط التفعيل صالح للاستخدام لمرة واحدة فقط.')
                    }
                } else {
                    setProfileLoadError(res.error || 'تعذر تحميل بيانات الدعوة الخاصة بك.')
                }
            })
            .catch((err) => {
                const msg = err instanceof Error ? err.message : 'تعذر تحميل بيانات الدعوة.'
                setProfileLoadError(msg)
            })
            .finally(() => {
                setIsLoadingProfile(false)
            })
    }

    // Load invite profile when in activateAccount mode
    useEffect(() => {
        if (mode === 'activateAccount' && supabase) {
            // Recover session if URL has double-hash from legacy links
            const hash = typeof window !== 'undefined' ? window.location.hash || '' : ''
            if (hash.includes('access_token=') && hash.lastIndexOf('#') > 0) {
                try {
                    const secondHash = hash.substring(hash.lastIndexOf('#') + 1)
                    const params = new URLSearchParams(secondHash)
                    const access_token = params.get('access_token')
                    const refresh_token = params.get('refresh_token')
                    if (access_token && refresh_token) {
                        void supabase.auth.setSession({ access_token, refresh_token }).then(({ data }) => {
                            if (data.session?.user?.email) {
                                loadInviteProfile(data.session.user.email)
                            }
                        })
                    }
                } catch {
                    // ignore
                }
            }

            loadInviteProfile()

            // Also listen to onAuthStateChange in case session tokens in hash are resolved shortly after mount
            const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
                if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
                    if (newSession?.user) {
                        loadInviteProfile(newSession.user.email)
                    }
                }
            })

            return () => {
                subscription.unsubscribe()
            }
        }
    }, [mode])

    const usernameValidation = mode === 'activateAccount' && username.trim()
        ? validateChosenUsername(username)
        : null
    const passwordValidation = mode === 'activateAccount' && password
        ? validateChosenPassword(password)
        : null

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError('')
        setNotice('')
        setIsSubmitting(true)

        try {
            if (!isConfigured || !supabase) {
                throw new Error('خدمة Supabase Auth غير مهيأة أو غير متصلة. يرجى تهيئة متغيرات البيئة VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY.')
            }

            if (mode === 'activateAccount') {
                if (inviteProfile?.status === 'active') {
                    throw new Error('رابط التفعيل صالح للاستخدام لمرة واحدة فقط، وقد تم تفعيل هذا الحساب بالفعل مسبقاً. يُرجى تسجيل الدخول مباشرة.')
                }

                const cleanUser = username.trim().toLowerCase()
                const uValidation = validateChosenUsername(cleanUser)
                if (!uValidation.valid) {
                    throw new Error(uValidation.error || 'اسم المستخدم غير مستوفٍ للشروط.')
                }

                const pValidation = await validateChosenPasswordAsync(password)
                if (!pValidation.valid) {
                    throw new Error(pValidation.error || 'كلمة المرور غير مستوفية للشروط.')
                }

                if (password !== confirmPassword) {
                    throw new Error('كلمتا المرور غير متطابقتين.')
                }

                // 1. Update password in Supabase Auth via authenticated invite session
                const { error: updateError } = await supabase.auth.updateUser({
                    password,
                    data: { must_change_password: false },
                })
                if (updateError) {
                    throw new Error(`تعذر حفظ كلمة المرور في خادم المصادقة: ${updateError.message}`)
                }

                // 2. Finalize activation atomically in database & metadata via complete-activation Edge Function
                const actRes = await completeAccountActivation(cleanUser)
                if (!actRes.success) {
                    throw new Error(actRes.error || actRes.message || 'تعذر إتمام تفعيل الحساب.')
                }

                // Clean URL hash and search params immediately so reload doesn't replay invite
                if (typeof window !== 'undefined') {
                    window.history.replaceState(null, '', window.location.pathname)
                }

                void logAuditEvent({
                    action: 'تفعيل حساب موظف جديد واختيار اسم المستخدم',
                    entity_type: 'auth',
                    details: {
                        employee_id: inviteProfile?.employeeId,
                        username: cleanUser,
                        role: inviteProfile?.role,
                    },
                    user: { id: inviteProfile?.authUserId || 'employee', email: inviteProfile?.email },
                })

                setNotice('تهانينا! تم تفعيل حسابك بنجاح. جاري تحويلك إلى لوحة التحكم...')
                setTimeout(() => {
                    onPasswordSet?.()
                }, 1000)
                return
            }

            if (mode === 'setNewPassword') {
                const pValidation = await validateChosenPasswordAsync(password)
                if (!pValidation.valid) {
                    throw new Error(pValidation.error || 'كلمة المرور غير مستوفية للشروط.')
                }
                if (password !== confirmPassword) {
                    throw new Error('كلمتا المرور غير متطابقتين.')
                }

                const { error: updateError } = await supabase.auth.updateUser({
                    password,
                    data: { must_change_password: false },
                })
                if (updateError) throw updateError

                void logAuditEvent({
                    action: 'تعيين كلمة مرور جديدة للمستخدم بنجاح',
                    entity_type: 'auth',
                    user: { id: activeUserEmail || 'user-pwd-reset', email: activeUserEmail },
                })

                // Immediately clean URL hash and query string so recovery token cannot be re-used
                if (typeof window !== 'undefined') {
                    window.history.replaceState(null, '', window.location.pathname)
                }

                // Explicitly sign out of recovery session so single-use is strictly enforced
                if (supabase) {
                    await supabase.auth.signOut().catch(() => {})
                }

                setNotice('تم تعيين كلمة المرور بنجاح! انتهت صلاحية رابط الاستعادة لمرة واحدة، يُرجى تسجيل الدخول بكلمة المرور الجديدة.')
                setTimeout(() => {
                    setMode('signIn')
                    onPasswordSet?.()
                }, 1200)
                return
            }

            if (mode === 'forgotPassword') {
                const identifier = username.trim()
                if (!identifier) {
                    throw new Error('يرجى إدخال اسم المستخدم أو الرقم الوظيفي أو البريد الإلكتروني.')
                }

                const res = await sendPasswordRecovery({ identifier })
                if (!res.success) {
                    throw new Error(res.error || res.message || 'تعذر إرسال رابط تعيين كلمة المرور.')
                }

                setNotice(res.message || 'إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني بنجاح. يُرجى مراجعة صندوق الوارد والبريد غير الهام (Spam).')
                return
            }

            // Mode: signIn
            const cleanUser = username.trim()
            if (!cleanUser) {
                throw new Error('يرجى إدخال اسم المستخدم أو الرقم الوظيفي أو البريد الإلكتروني.')
            }
            if (!password) {
                throw new Error('يرجى إدخال كلمة المرور.')
            }

            let signInData: any = null
            let signInError: any = null

            // 1. Direct sign-in: If user entered an email OR a username, attempt direct Supabase Auth sign-in
            const targetAuthEmail = cleanUser.includes('@')
                ? cleanUser.toLowerCase()
                : `${cleanUser.toLowerCase()}@warehouse.local`

            const directRes = await supabase.auth.signInWithPassword({
                email: targetAuthEmail,
                password,
            })

            if (!directRes.error && directRes.data?.session) {
                signInData = directRes.data
                signInError = null
            } else {
                signInError = directRes.error
            }

            // 2. If direct sign-in failed (e.g. employee-id entered like SYS-ADM-000001 or needs server bridge), invoke secure login-bridge
            if (!signInData && supabase) {
                try {
                    const { data: bridgeData, error: bridgeError } = await supabase.functions.invoke('login-bridge', {
                        body: {
                            identifier: cleanUser,
                            username: cleanUser,
                            password,
                        },
                    })

                    if (bridgeError) {
                        let parsedMsg = ''
                        if (bridgeError && typeof bridgeError === 'object' && 'context' in bridgeError) {
                            try {
                                const ctxJson = await (bridgeError as any).context.json()
                                if (ctxJson?.error) parsedMsg = ctxJson.error
                            } catch {
                                // ignore
                            }
                        }

                        const status = (bridgeError as { status?: number; context?: { status?: number } }).status ||
                                       (bridgeError as { context?: { status?: number } }).context?.status
                        if (status === 429 || bridgeError.message?.includes('429')) {
                            throw new Error('تم تجاوز الحد الأقصى للمحاولات الفاشلة. تم تعليق المحاولة مؤقتاً لمدة 15 دقيقة لحماية الحساب.')
                        }
                        throw new Error(parsedMsg || 'بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم أو الرقم الوظيفي وكلمة المرور.')
                    }

                    if (bridgeData?.session) {
                        // Establish authoritative Supabase session
                        const { data: sessData, error: sessErr } = await supabase.auth.setSession(bridgeData.session)
                        if (sessErr) throw sessErr
                        signInData = sessData
                        signInError = null
                    } else if (bridgeData?.error) {
                        throw new Error(bridgeData.error)
                    } else {
                        throw new Error('تعذر تسجيل الدخول. تحقق من بيانات الدخول أو تواصل مع الإدارة.')
                    }
                } catch (bridgeCatch) {
                    if (bridgeCatch instanceof Error) {
                        throw bridgeCatch
                    }
                    throw new Error('تعذر تسجيل الدخول. تحقق من بيانات الدخول أو تواصل مع الإدارة.')
                }
            }

            if (signInError) {
                if (signInError.message.toLowerCase().includes('invalid login credentials')) {
                    throw new Error('بيانات الدخول غير صحيحة: يُرجى التأكد من صحة اسم المستخدم أو الرقم الوظيفي وكلمة المرور.')
                }
                if (signInError.message.toLowerCase().includes('email not confirmed')) {
                    throw new Error('الحساب قيد الانتظار أو لم يتم تأكيد بريده. يرجى مراجعة إدارة النظام.')
                }
                throw signInError
            }

            // Verify account status in authenticated metadata
            const appMetadata = (signInData.user?.app_metadata as Record<string, unknown>) || {}
            if (appMetadata.status === 'suspended' || appMetadata.status === 'disabled') {
                await supabase.auth.signOut()
                throw new Error('تم تعليق هذا الحساب. يرجى مراجعة إدارة النظام.')
            }

            // If user is required to change password on first login
            const userAppMeta = (signInData.user?.app_metadata as Record<string, unknown>) || {}
            if (userAppMeta.must_change_password === true) {
                setActiveUserEmail(signInData.user?.email || cleanUser)
                setMode('setNewPassword')
                setNotice('⚠️ يجب تعيين كلمة مرور جديدة لحسابك لأول مرة لمتابعة الدخول (6 أحرف على الأقل).')
                return
            }

            void logAuditEvent({
                action: 'تسجيل دخول موثّق إلى النظام عبر Supabase Auth',
                entity_type: 'auth',
                user: { id: signInData.user?.id || 'auth-user', email: signInData.user?.email || cleanUser },
            })

            setNotice('تم تسجيل الدخول بنجاح! جاري الدخول...')
            setTimeout(() => {
                onPasswordSet?.()
            }, 500)
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر إتمام العملية.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <main className="auth-shell" dir="rtl">
            <section className={`auth-panel ${mode === 'activateAccount' ? 'auth-panel-wide' : ''}`}>
                <div className="auth-brand">
                    {settings?.logoDataUrl || settings?.logoUrl ? (
                        <img
                            src={settings.logoDataUrl || settings.logoUrl}
                            alt={`شعار ${settings.organization || 'المؤسسة'}`}
                            className="auth-brand-custom-logo"
                            onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none'
                            }}
                        />
                    ) : (
                        <Warehouse size={24} />
                    )}
                    <span>{settings?.organization || 'حركة المخزن'}</span>
                </div>

                {!isConfigured && (
                    <div className="inline-message error mb-4" role="alert">
                        <ShieldAlert size={18} />
                        <div>
                            <strong>خدمة المصادقة السحابية غير مهيأة:</strong>
                            <p className="mt-1 m-0 font-sm">
                                تم إيقاف تسجيل الدخول المحلي غير الآمن. يُرجى تهيئة متغيرات البيئة للاتصال بقاعدة بيانات Supabase للمتابعة.
                            </p>
                        </div>
                    </div>
                )}

                {mode === 'activateAccount' ? (
                    <>
                        <div className="auth-badge-icon">
                            <Sparkles size={20} />
                            <strong>تفعيل حساب موظف جديد</strong>
                        </div>
                        <h1>إنشاء حسابك وتفعيله</h1>
                        <p>مرحباً بك ضمن فريق العمل! يُرجى مراجعة بياناتك، ثم اختيار اسم المستخدم وكلمة المرور الخاصة بك لإتمام تفعيل حسابك والبدء في استخدام النظام.</p>

                        {isLoadingProfile && (
                            <div className="auth-loading-state">
                                جارٍ التحقق من بيانات الدعوة والملف الوظيفي...
                            </div>
                        )}

                        {profileLoadError && (
                            <div className="mb-4">
                                <div className="inline-message error" role="alert">
                                    <ShieldAlert size={20} className="mt-1 shrink-0" />
                                    <div>
                                        <strong>تعذر التحقق من رابط الدعوة:</strong>
                                        <p className="mt-1 mb-2 font-sm">{profileLoadError}</p>
                                        <p className="modal-help-text">
                                            إذا كان الرابط منتهياً أو تم استخدامه سابقاً، يُرجى التواصل مع مدير النظام (System Admin) لإعادة إرسال الدعوة إلى بريدك الإلكتروني.
                                        </p>
                                    </div>
                                </div>
                                <div className="auth-btn-row">
                                    <button
                                        type="button"
                                        className="primary-btn flex-1"
                                        onClick={() => loadInviteProfile()}
                                    >
                                        إعادة المحاولة
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-btn flex-1"
                                        onClick={() => { setMode('signIn'); setError(''); setNotice('') }}
                                    >
                                        <LogIn size={16} /> شاشة تسجيل الدخول
                                    </button>
                                </div>
                            </div>
                        )}

                        {inviteProfile && inviteProfile.status === 'active' ? (
                            <div className="auth-step-box">
                                <div className="inline-message warning mb-4" role="alert">
                                    <ShieldAlert size={22} className="shrink-0 text-amber-500" />
                                    <div>
                                        <strong className="text-base">تم استخدام رابط التفعيل مسبقاً:</strong>
                                        <p className="mt-1 mb-2 font-sm">
                                            رابط التفعيل صالح للاستخدام لمرة واحدة فقط. الحساب الخاص بالموظف <strong>{inviteProfile.fullName}</strong> ({inviteProfile.employeeId}) تم تفعيله بالفعل وهو نشط في المنظومة.
                                        </p>
                                        <p className="font-xs text-muted mb-0">
                                            لأسباب أمنية، لا يمكن إعادة استخدام رابط التفعيل لتغيير البيانات. يُرجى تسجيل الدخول مباشرة باستخدام اسم المستخدم وكلمة المرور الخاصة بك.
                                        </p>
                                    </div>
                                </div>
                                <div className="auth-btn-row">
                                    <button
                                        type="button"
                                        className="primary-btn flex-1"
                                        onClick={() => {
                                            if (typeof window !== 'undefined') {
                                                window.history.replaceState(null, '', window.location.pathname)
                                            }
                                            setMode('signIn')
                                            setError('')
                                            setNotice('الحساب مفعل بالفعل. يرجى تسجيل الدخول باسم المستخدم وكلمة المرور.')
                                        }}
                                    >
                                        <LogIn size={16} /> الانتقال إلى تسجيل الدخول
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={() => {
                                            if (typeof window !== 'undefined') {
                                                window.history.replaceState(null, '', window.location.pathname)
                                            }
                                            setMode('forgotPassword')
                                            setError('')
                                            setNotice('')
                                        }}
                                    >
                                        نسيت كلمة المرور؟
                                    </button>
                                </div>
                            </div>
                        ) : inviteProfile ? (
                            <>
                                <div className="auth-step-box">
                                    <div className="auth-step-box-header">
                                        <UserCheck size={18} />
                                        <span>1. بياناتك الوظيفية المعتمدة (للقراءة فقط)</span>
                                    </div>
                                    <div className="auth-step-grid">
                                        <div>
                                            <span className="auth-step-label">الاسم الكامل:</span>
                                            <strong>{inviteProfile.fullName}</strong>
                                        </div>
                                        <div>
                                            <span className="auth-step-label">البريد الإلكتروني:</span>
                                            <strong className="text-ltr auth-account-value">{inviteProfile.email}</strong>
                                        </div>
                                        <div>
                                            <span className="auth-step-label">الرقم الوظيفي الموحد (Unique ID):</span>
                                            <strong className="tabular-nums text-accent">{inviteProfile.employeeId}</strong>
                                        </div>
                                        <div>
                                            <span className="auth-step-label">القسم والدور:</span>
                                            <span>
                                                {inviteProfile.department === 'warehouse' ? 'المخازن' : inviteProfile.department === 'procurement' ? 'المشتريات' : inviteProfile.department}
                                                {' — '}
                                                {ROLE_LABELS[inviteProfile.role as keyof typeof ROLE_LABELS] || inviteProfile.role}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <form className="auth-form" onSubmit={handleSubmit}>
                                    <label>
                                        2. اسم المستخدم المختار (Username)
                                        <input
                                            type="text"
                                            dir="ltr"
                                            autoComplete="username"
                                            placeholder="مثال: ahmed.ali أو saleh_k"
                                            value={username}
                                            onChange={(event) => setUsername(event.target.value)}
                                            required
                                        />
                                        <span className="font-xs text-muted block mt-1">
                                            من 3 إلى 30 حرفاً إنجليزياً (أحرف صغيرة، أرقام، . _ -). يُستخدم لتسجيل الدخول لاحقاً.
                                        </span>
                                        {usernameValidation && (
                                            usernameValidation.valid ? (
                                                <span className="auth-validation-ok">
                                                    ✓ اسم مستخدم متاح ومستوفٍ للشروط
                                                </span>
                                            ) : (
                                                <span className="auth-validation-err">
                                                    ✕ {usernameValidation.error}
                                                </span>
                                            )
                                        )}
                                    </label>

                                    <label>
                                        3. كلمة المرور الجديدة
                                        <div className="password-input-wrap">
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                autoComplete="new-password"
                                                minLength={10}
                                                placeholder="10 أحرف ورموز على الأقل"
                                                value={password}
                                                onChange={(event) => setPassword(event.target.value)}
                                                required
                                            />
                                            <button
                                                type="button"
                                                className="password-toggle-btn"
                                                onClick={() => setShowPassword((prev) => !prev)}
                                                title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                            >
                                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {passwordValidation && !passwordValidation.valid && (
                                            <span className="auth-validation-err">
                                                ✕ {passwordValidation.error}
                                            </span>
                                        )}
                                    </label>

                                    <label>
                                        تأكيد كلمة المرور
                                        <div className="password-input-wrap">
                                            <input
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                autoComplete="new-password"
                                                minLength={10}
                                                placeholder="أعد كتابة كلمة المرور للتأكيد"
                                                value={confirmPassword}
                                                onChange={(event) => setConfirmPassword(event.target.value)}
                                                required
                                            />
                                            <button
                                                type="button"
                                                className="password-toggle-btn"
                                                onClick={() => setShowConfirmPassword((prev) => !prev)}
                                                title={showConfirmPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                                aria-label={showConfirmPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                            >
                                                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {confirmPassword && password !== confirmPassword && (
                                            <span className="auth-validation-err">
                                                ✕ كلمتا المرور غير متطابقتين
                                            </span>
                                        )}
                                    </label>

                                    {error && <div className="inline-message error" role="alert">{error}</div>}
                                    {notice && <div className="inline-message success" role="status"><CheckCircle2 size={16} /> {notice}</div>}

                                    <button
                                        type="submit"
                                        className="primary-btn mt-2"
                                        disabled={isSubmitting || !isConfigured || Boolean(profileLoadError) || (Boolean(usernameValidation) && !usernameValidation?.valid)}
                                    >
                                        <Sparkles size={17} />
                                        {isSubmitting ? 'جارٍ حفظ البيانات وتفعيل الحساب...' : 'تفعيل الحساب والدخول للنظام'}
                                    </button>
                                </form>
                            </>
                        ) : null}
                    </>
                ) : mode === 'setNewPassword' ? (
                    <>
                        <div className="auth-badge-icon">
                            <Sparkles size={20} />
                            <strong>تفعيل الحساب وتعيين كلمة المرور</strong>
                        </div>
                        <h1>أهلاً بك في حركة المخزن</h1>
                        <p>يُرجى تعيين كلمة المرور الجديدة لحسابك (6 أحرف أو أرقام على الأقل) لتتمكن من تسجيل الدخول مستقبلاً.</p>

                        {activeUserEmail && (
                            <div className="auth-account-badge">
                                <ShieldCheck size={22} color="var(--accent)" />
                                <div className="flex-1">
                                    <span className="auth-account-label">الحساب المخصص:</span>
                                    <strong className="auth-account-value">{activeUserEmail}</strong>
                                </div>
                            </div>
                        )}

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <label>
                                كلمة المرور الجديدة
                                <div className="password-input-wrap">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        minLength={6}
                                        placeholder="6 أحرف أو أرقام على الأقل"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle-btn"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </label>

                            <label>
                                تأكيد كلمة المرور
                                <div className="password-input-wrap">
                                    <input
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        minLength={6}
                                        placeholder="أعد كتابة كلمة المرور (6 أحرف على الأقل)"
                                        value={confirmPassword}
                                        onChange={(event) => setConfirmPassword(event.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle-btn"
                                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                                        title={showConfirmPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        aria-label={showConfirmPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </label>

                            {error && <div className="inline-message error" role="alert">{error}</div>}
                            {notice && <div className="inline-message success" role="status"><CheckCircle2 size={16} /> {notice}</div>}

                            <button type="submit" className="primary-btn" disabled={isSubmitting || !isConfigured}>
                                <KeyRound size={17} />
                                {isSubmitting ? 'جارٍ الحفظ والتفعيل...' : 'حفظ كلمة المرور والدخول'}
                            </button>
                        </form>
                    </>
                ) : mode === 'forgotPassword' ? (
                    <>
                        <div className="auth-badge-icon">
                            <KeyRound size={20} />
                            <strong>استعادة كلمة المرور</strong>
                        </div>
                        <h1>نسيت كلمة المرور؟</h1>
                        <p>أدخل اسم المستخدم أو الرقم الوظيفي أو البريد الإلكتروني المسجل في المنظومة، وسيقوم النظام بالتحقق وإرسال رابط آمن لإعادة تعيين كلمة المرور إلى بريدك الإلكتروني (Gmail) فوراً.</p>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <label>
                                اسم المستخدم، الرقم الوظيفي، أو البريد الإلكتروني
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="مثال: marwan-desouky أو WH-EMP-000001 أو name@gmail.com"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    required
                                />
                            </label>

                            {error && <div className="inline-message error" role="alert">{error}</div>}
                            {notice && <div className="inline-message success" role="status"><CheckCircle2 size={16} /> {notice}</div>}

                            <button type="submit" className="primary-btn" disabled={isSubmitting || !isConfigured}>
                                <KeyRound size={17} />
                                {isSubmitting ? 'جارٍ الإرسال إلى بريدك...' : 'إرسال رابط إعادة تعيين كلمة المرور'}
                            </button>

                            <button
                                type="button"
                                className="secondary-btn w-full mt-2"
                                onClick={() => { setMode('signIn'); setError(''); setNotice('') }}
                            >
                                <LogIn size={16} /> العودة لشاشة تسجيل الدخول
                            </button>
                        </form>
                    </>
                ) : (
                    <>
                        <h1>تسجيل الدخول</h1>
                        <p>سجّل الدخول باسم المستخدم أو الرقم الوظيفي وكلمة المرور للوصول إلى النظام عبر Supabase Auth.</p>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <label>
                                اسم المستخدم أو الرقم الوظيفي
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="اسم المستخدم أو الرقم الوظيفي (مثال: marwan-desouky أو WH-EMP-000001)"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    required
                                />
                            </label>

                            <label>
                                كلمة المرور
                                <div className="password-input-wrap">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        placeholder="أدخل كلمة المرور"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle-btn"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </label>

                            {error && <div className="inline-message error" role="alert">{error}</div>}
                            {notice && <div className="inline-message success" role="status">{notice}</div>}

                            <button type="submit" className="primary-btn" disabled={isSubmitting || !isConfigured}>
                                <LogIn size={17} />
                                {isSubmitting ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
                            </button>
                        </form>

                        <div className="auth-forgot-row">
                            <button
                                type="button"
                                className="auth-switch auth-forgot-btn"
                                onClick={() => { setMode('forgotPassword'); setError(''); setNotice('') }}
                            >
                                نسيت كلمة المرور؟
                            </button>
                        </div>

                        <div style={{ textAlign: 'center', margin: '14px 0 6px' }}>
                            <Link
                                to="/support"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    color: '#4f46e5',
                                    textDecoration: 'none',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    backgroundColor: 'rgba(79, 70, 229, 0.08)'
                                }}
                            >
                                <Headphones size={15} />
                                <span>تواجه مشكلة أو عطل فني؟ الدعم الفني وفتح تذكرة</span>
                            </Link>
                        </div>

                        <div className="auth-security-footer">
                            <ShieldCheck size={16} color="var(--accent)" />
                            <span>نظام المصادقة موحّد ومؤمّن بالكامل عبر جلسات Supabase Auth الموثقة.</span>
                        </div>
                    </>
                )}
            </section>
        </main>
    )
}