import { useEffect, useState, type FormEvent } from 'react'
import {
    CheckCircle2,
    Eye,
    EyeOff,
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
import { validateChosenUsername, validateChosenPassword } from '../lib/employeeIdentity'
import { getInviteProfile, completeAccountActivation, sendPasswordRecovery, type InviteProfile } from '../lib/registrationService'
import { ROLE_LABELS } from '../lib/permissions'

function getEmailFromUrl(): string {
    if (typeof window === 'undefined') return ''
    try {
        const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : ''
        const hashParams = new URLSearchParams(hash)
        const emailFromHash = hashParams.get('email')
        if (emailFromHash) return decodeURIComponent(emailFromHash).trim()

        const searchParams = new URLSearchParams(window.location.search)
        const emailFromSearch = searchParams.get('email')
        if (emailFromSearch) return decodeURIComponent(emailFromSearch).trim()
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

    // Check for errors returned in the URL hash
    useEffect(() => {
        if (typeof window === 'undefined') return
        const hash = window.location.hash || ''
        if (hash.includes('error=')) {
            const params = new URLSearchParams(hash.replace(/^#/, ''))
            const code = params.get('error_code') || ''
            const desc = params.get('error_description') || params.get('error') || ''
            if (code === 'otp_expired' || desc.toLowerCase().includes('expired') || desc.toLowerCase().includes('invalid')) {
                setError('⚠️ رابط تفعيل الدعوة أو الاستعادة غير صالح أو انتهت صلاحيته. يُرجى مراجعة مدير النظام (System Admin) لإعادة إرسال الدعوة.')
            } else if (desc) {
                setError(decodeURIComponent(desc.replace(/\+/g, ' ')))
            }
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
        const targetEmail = fallbackEmail || urlEmail || getEmailFromUrl()
        getInviteProfile(targetEmail)
            .then((res) => {
                if (res.success && res.profile) {
                    setInviteProfile(res.profile)
                    if (res.profile.status === 'active') {
                        setNotice('تم تفعيل هذا الحساب بالفعل سابقاً. يمكنك تسجيل الدخول باسم المستخدم وكلمة المرور الخاصة بك.')
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
                const cleanUser = username.trim().toLowerCase()
                const uValidation = validateChosenUsername(cleanUser)
                if (!uValidation.valid) {
                    throw new Error(uValidation.error || 'اسم المستخدم غير مستوفٍ للشروط.')
                }

                const pValidation = validateChosenPassword(password)
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
                await completeAccountActivation(cleanUser)

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
                if (password.length < 12) {
                    throw new Error('كلمة المرور الجديدة يجب ألا تقل عن 12 حرفاً ورموزاً لضمان أمان النظام.')
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

                setNotice('تم تعيين كلمة المرور بنجاح! جاري تحويلك إلى لوحة التحكم...')
                setTimeout(() => {
                    onPasswordSet?.()
                }, 1000)
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
                setNotice('⚠️ يجب تعيين كلمة مرور جديدة لحسابك لأول مرة لمتابعة الدخول (12 حرفاً على الأقل).')
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
            <section className="auth-panel">
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
                    <div className="inline-message error" style={{ marginBottom: '16px' }} role="alert">
                        <ShieldAlert size={18} />
                        <div>
                            <strong>خدمة المصادقة السحابية غير مهيأة:</strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                                تم إيقاف تسجيل الدخول المحلي غير الآمن. يُرجى تهيئة متغيرات البيئة للاتصال بقاعدة بيانات Supabase للمتابعة.
                            </p>
                        </div>
                    </div>
                )}

                {mode === 'activateAccount' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                            <Sparkles size={20} />
                            <strong>تفعيل حساب موظف جديد</strong>
                        </div>
                        <h1>إنشاء حسابك وتفعيله</h1>
                        <p>مرحباً بك ضمن فريق العمل! يُرجى اختيار اسم المستخدم وكلمة المرور الخاصة بك لإتمام تفعيل حسابك والبدء في استخدام النظام.</p>

                        {isLoadingProfile && (
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem' }}>
                                جارٍ التحقق من بيانات الدعوة والملف الوظيفي...
                            </div>
                        )}

                        {profileLoadError && (
                            <div style={{ marginBottom: '16px' }}>
                                <div className="inline-message error" role="alert" style={{ lineHeight: 1.6 }}>
                                    <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <div>
                                        <strong>تعذر التحقق من رابط الدعوة:</strong>
                                        <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>{profileLoadError}</p>
                                        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
                                            إذا كان الرابط منتهياً أو تم استخدامه سابقاً، يُرجى التواصل مع مدير النظام (System Admin) لإعادة إرسال الدعوة إلى بريدك الإلكتروني.
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                    <button
                                        type="button"
                                        className="primary-btn"
                                        style={{ flex: 1 }}
                                        onClick={() => loadInviteProfile()}
                                    >
                                        إعادة المحاولة
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-btn"
                                        style={{ flex: 1 }}
                                        onClick={() => { setMode('signIn'); setError(''); setNotice('') }}
                                    >
                                        <LogIn size={16} /> شاشة تسجيل الدخول
                                    </button>
                                </div>
                            </div>
                        )}

                        {inviteProfile && (
                            <>
                                <div style={{
                                    padding: '14px 16px',
                                    borderRadius: '10px',
                                    background: 'var(--bg)',
                                    border: '1px solid var(--line)',
                                    marginBottom: '16px',
                                    fontSize: '0.86rem',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: 'var(--accent)', fontWeight: 600 }}>
                                        <UserCheck size={18} />
                                        <span>البيانات الوظيفية المعتمدة (للقراءة فقط)</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 14px' }}>
                                        <div>
                                            <span style={{ color: 'var(--muted)', fontSize: '0.75rem', display: 'block' }}>الاسم الكامل:</span>
                                            <strong>{inviteProfile.fullName}</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: 'var(--muted)', fontSize: '0.75rem', display: 'block' }}>البريد الإلكتروني:</span>
                                            <strong style={{ direction: 'ltr', display: 'inline-block' }}>{inviteProfile.email}</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: 'var(--muted)', fontSize: '0.75rem', display: 'block' }}>الرقم الوظيفي الموحد (Unique ID):</span>
                                            <strong style={{ color: 'var(--accent)', letterSpacing: '0.5px' }}>{inviteProfile.employeeId}</strong>
                                        </div>
                                        <div>
                                            <span style={{ color: 'var(--muted)', fontSize: '0.75rem', display: 'block' }}>القسم والدور:</span>
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
                                        اسم المستخدم المختار (Username)
                                        <input
                                            type="text"
                                            dir="ltr"
                                            autoComplete="username"
                                            placeholder="مثال: ahmed.ali أو saleh_k"
                                            value={username}
                                            onChange={(event) => setUsername(event.target.value)}
                                            required
                                        />
                                        <span style={{ fontSize: '0.76rem', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                                            من 3 إلى 30 حرفاً إنجليزياً (أحرف صغيرة، أرقام، . _ -). يُستخدم لتسجيل الدخول لاحقاً.
                                        </span>
                                        {usernameValidation && (
                                            usernameValidation.valid ? (
                                                <span style={{ color: 'var(--good, #10b981)', fontSize: '0.78rem', display: 'block', marginTop: '3px' }}>
                                                    ✓ اسم مستخدم متاح ومستوفٍ للشروط
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--bad, #ef4444)', fontSize: '0.78rem', display: 'block', marginTop: '3px' }}>
                                                    ✕ {usernameValidation.error}
                                                </span>
                                            )
                                        )}
                                    </label>

                                    <label>
                                        كلمة المرور الجديدة
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
                                            <span style={{ color: 'var(--bad, #ef4444)', fontSize: '0.78rem', display: 'block', marginTop: '3px' }}>
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
                                            <span style={{ color: 'var(--bad, #ef4444)', fontSize: '0.78rem', display: 'block', marginTop: '3px' }}>
                                                ✕ كلمتا المرور غير متطابقتين
                                            </span>
                                        )}
                                    </label>

                                    {error && <div className="inline-message error" role="alert">{error}</div>}
                                    {notice && <div className="inline-message success" role="status"><CheckCircle2 size={16} /> {notice}</div>}

                                    <button
                                        type="submit"
                                        className="primary-btn"
                                        disabled={isSubmitting || !isConfigured || Boolean(profileLoadError) || (Boolean(usernameValidation) && !usernameValidation?.valid)}
                                        style={{ marginTop: '8px' }}
                                    >
                                        <Sparkles size={17} />
                                        {isSubmitting ? 'جارٍ حفظ البيانات وتفعيل الحساب...' : 'تفعيل الحساب والدخول للنظام'}
                                    </button>
                                </form>
                            </>
                        )}
                    </>
                ) : mode === 'setNewPassword' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                            <Sparkles size={20} />
                            <strong>تفعيل الحساب وتعيين كلمة المرور</strong>
                        </div>
                        <h1>أهلاً بك في حركة المخزن</h1>
                        <p>يُرجى تعيين كلمة المرور الجديدة لحسابك (12 حرفاً على الأقل) لتتمكن من تسجيل الدخول مستقبلاً.</p>

                        {activeUserEmail && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '12px 14px',
                                borderRadius: '8px',
                                background: 'var(--bg)',
                                border: '1px solid var(--accent)',
                                fontSize: '0.88rem',
                                margin: '4px 0 10px 0',
                            }}>
                                <ShieldCheck size={22} color="var(--accent)" />
                                <div style={{ flex: 1 }}>
                                    <span style={{ color: 'var(--muted)', fontSize: '0.76rem', display: 'block' }}>الحساب المخصص:</span>
                                    <strong style={{ direction: 'ltr', display: 'inline-block' }}>{activeUserEmail}</strong>
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
                                        minLength={12}
                                        placeholder="12 حرفاً ورموزاً على الأقل"
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
                                        minLength={12}
                                        placeholder="أعد كتابة كلمة المرور (12 حرفاً على الأقل)"
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
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
                                className="secondary-btn"
                                style={{ width: '100%', marginTop: '6px' }}
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

                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '10px' }}>
                            <button
                                type="button"
                                className="auth-switch"
                                style={{ color: 'var(--muted)', fontSize: '0.84rem' }}
                                onClick={() => { setMode('forgotPassword'); setError(''); setNotice('') }}
                            >
                                نسيت كلمة المرور؟
                            </button>
                        </div>

                        <div style={{
                            marginTop: '16px',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            background: 'var(--bg)',
                            border: '1px solid var(--line)',
                            fontSize: '0.82rem',
                            color: 'var(--muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            <ShieldCheck size={16} color="var(--accent)" />
                            <span>نظام المصادقة موحّد ومؤمّن بالكامل عبر جلسات Supabase Auth الموثقة.</span>
                        </div>
                    </>
                )}
            </section>
        </main>
    )
}