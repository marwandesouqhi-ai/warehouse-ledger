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
import {
    authenticateLocalUser,
    activateLocalUserWithCode,
    syncUsersWithCloud,
} from '../lib/localUsers'
import { logAuditEvent } from '../lib/auditLogger'
import { isAuthSecureMode, toSyntheticEmail } from '../lib/authMode'

type AuthMode = 'signIn' | 'activateAccount' | 'forgotPassword' | 'setNewPassword'

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
    const [activationCode, setActivationCode] = useState('')
    const [isPendingActivation, setIsPendingActivation] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [activeUserEmail, setActiveUserEmail] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Check for errors returned in the URL hash (legacy invite token error)
    useEffect(() => {
        if (typeof window === 'undefined') return
        const hash = window.location.hash || ''
        if (hash.includes('error=')) {
            const params = new URLSearchParams(hash.replace(/^#/, ''))
            const code = params.get('error_code') || ''
            const desc = params.get('error_description') || params.get('error') || ''
            if (code === 'otp_expired' || desc.toLowerCase().includes('expired') || desc.toLowerCase().includes('invalid')) {
                setError('⚠️ رابط تفعيل الدعوة هذا غير صالح أو انتهت صلاحيته. يمكنك تسجيل الدخول باسم المستخدم وكلمة المرور مباشرة.')
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

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError('')
        setNotice('')
        setIsSubmitting(true)

        try {
            if (mode === 'activateAccount') {
                const cleanUser = username.trim().toLowerCase()
                const cleanCode = activationCode.trim()

                if (!cleanUser) {
                    throw new Error('يرجى إدخال اسم المستخدم.')
                }
                if (!cleanCode) {
                    throw new Error('يرجى إدخال كود تأكيد التفعيل (PIN).')
                }

                activateLocalUserWithCode(cleanUser, cleanCode)
                setNotice(`تم تفعيل حساب "${cleanUser}" بنجاح! يمكنك الآن تسجيل الدخول مباشرة.`)
                setMode('signIn')
                setIsPendingActivation(false)
                setActivationCode('')
                return
            }

            if (mode === 'setNewPassword') {
                if (password.length < 8) {
                    throw new Error('كلمة المرور يجب أن لا تقل عن 8 أحرف وأرقام للأمان.')
                }
                if (password !== confirmPassword) {
                    throw new Error('كلمتا المرور غير متطابقتين.')
                }

                if (supabase) {
                    const { error: updateError } = await supabase.auth.updateUser({ password })
                    if (updateError) throw updateError
                }

                setNotice('تم تعيين كلمة المرور بنجاح! جاري تحويلك إلى لوحة التحكم...')
                setTimeout(() => {
                    onPasswordSet?.()
                }, 1000)
                return
            }

            if (mode === 'forgotPassword') {
                if (supabase && username.includes('@')) {
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(username, {
                        redirectTo: `${window.location.origin}/#type=recovery`,
                    })
                    if (resetError) throw resetError
                    setNotice('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.')
                } else {
                    throw new Error('في النظام المحلي، يُرجى التواصل مع مدير النظام (System Admin) لإعادة تعيين كلمة المرور أو كود التفعيل لحسابك مباشرة.')
                }
                return
            }

            // Mode: signIn
            const cleanUser = username.trim().toLowerCase()
            if (!cleanUser) {
                throw new Error('يرجى إدخال اسم المستخدم.')
            }
            if (cleanUser === 'marwandesouqhi@gmail.com') {
                throw new Error('تم حذف هذا الحساب نهائياً من النظام ومحظور تسجيل الدخول به.')
            }
            if (!password) {
                throw new Error('يرجى إدخال كلمة المرور.')
            }

            // If account was flagged as pending activation, verify the activation code first
            if (isPendingActivation || activationCode.trim()) {
                if (!activationCode.trim()) {
                    throw new Error('يرجى إدخال كود تأكيد التفعيل الممنوح لك من مدير النظام لإكمال تفعيل الحساب.')
                }
                activateLocalUserWithCode(cleanUser, activationCode.trim())
                setIsPendingActivation(false)
            }

            // 1. In secure auth mode, authenticate strictly via Supabase Auth
            if (isAuthSecureMode()) {
                if (!supabase) {
                    throw new Error('خدمة Supabase Auth غير مهيأة على هذا الجهاز.')
                }
                const syntheticEmail = toSyntheticEmail(cleanUser)
                const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                    email: syntheticEmail,
                    password,
                })

                if (signInError) {
                    if (signInError.message.toLowerCase().includes('invalid login credentials')) {
                        throw new Error('بيانات الدخول غير صحيحة: يُرجى التأكد من صحة اسم المستخدم وكلمة المرور.')
                    }
                    if (signInError.message.toLowerCase().includes('email not confirmed')) {
                        throw new Error('الحساب قيد الانتظار أو غير مفعّل. يرجى التواصل مع مدير النظام.')
                    }
                    throw signInError
                }

                // If user is required to change password on first login
                const userAppMeta = (signInData.user?.app_metadata as Record<string, unknown>) || {}
                if (userAppMeta.must_change_password === true) {
                    setActiveUserEmail(signInData.user?.email || syntheticEmail)
                    setMode('setNewPassword')
                    setNotice('⚠️ يجب تعيين كلمة مرور جديدة لحسابك لأول مرة لمتابعة الدخول (8 أحرف على الأقل).')
                    return
                }

                void logAuditEvent({
                    action: 'تسجيل دخول موثّق إلى النظام (وضع الحماية)',
                    entity_type: 'auth',
                    user: { id: signInData.user?.id, email: signInData.user?.email || cleanUser },
                })

                setNotice('تم تسجيل الدخول بنجاح! جاري الدخول...')
                setTimeout(() => {
                    onPasswordSet?.()
                }, 500)
                return
            }

            // 2. Legacy auth mode: Try local authentication with cloud fallback
            try {
                let res: { user: import('../lib/localUsers').LocalUser; needsActivation?: boolean }
                try {
                    res = authenticateLocalUser(cleanUser, password)
                } catch (firstErr) {
                    if (firstErr instanceof Error && firstErr.message.includes('غير مسجل')) {
                        // User might be created on another device; sync from cloud and retry
                        await syncUsersWithCloud()
                        res = authenticateLocalUser(cleanUser, password)
                    } else {
                        throw firstErr
                    }
                }

                if (res.needsActivation) {
                    setIsPendingActivation(true)
                    setNotice('⚠️ هذا الحساب يتطلب إدخال كود تأكيد التفعيل لأول مرة. يرجى كتابة كود التفعيل الممنوح لك من المدير في الحقل أدناه ثم الضغط على تسجيل الدخول.')
                    return
                }

                void logAuditEvent({
                    action: 'تسجيل دخول محلي إلى النظام',
                    entity_type: 'auth',
                    user: { id: res.user.id, email: res.user.username },
                })

                setNotice('تم تسجيل الدخول بنجاح! جاري الدخول...')
                setTimeout(() => {
                    onPasswordSet?.()
                }, 500)
                return
            } catch (localErr) {
                // If username was found but password was wrong, display error directly
                if (localErr instanceof Error && localErr.message.includes('كلمة المرور غير صحيحة')) {
                    throw localErr
                }

                // If not found in local users and Supabase is configured, try Supabase fallback
                if (supabase) {
                    const { error: signInError } = await supabase.auth.signInWithPassword({
                        email: cleanUser,
                        password,
                    })
                    if (signInError) {
                        if (signInError.message.toLowerCase().includes('invalid login credentials')) {
                            throw new Error('بيانات الدخول غير صحيحة: يُرجى التأكد من صحة اسم المستخدم وكلمة المرور.')
                        }
                        throw signInError
                    }
                    return
                }

                throw localErr
            }
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

                {mode === 'activateAccount' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                            <UserCheck size={20} />
                            <strong>تأكيد تفعيل الحساب</strong>
                        </div>
                        <h1>تفعيل حساب جديد</h1>
                        <p>أدخل اسم المستخدم وكود تأكيد التفعيل (PIN) الممنوح لك من مدير النظام لتنشيط حسابك.</p>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <label>
                                اسم المستخدم
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="اسم المستخدم (مثال: user123)"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    required
                                />
                            </label>

                            <label>
                                كود تأكيد التفعيل (PIN)
                                <input
                                    type="text"
                                    placeholder="أدخل كود التفعيل (مثال: 649201)"
                                    value={activationCode}
                                    onChange={(event) => setActivationCode(event.target.value)}
                                    required
                                />
                            </label>

                            {error && <div className="inline-message error" role="alert">{error}</div>}
                            {notice && <div className="inline-message success" role="status"><CheckCircle2 size={16} /> {notice}</div>}

                            <button type="submit" className="primary-btn" disabled={isSubmitting}>
                                <UserCheck size={17} />
                                {isSubmitting ? 'جارٍ تأكيد التفعيل...' : 'تأكيد التفعيل'}
                            </button>
                        </form>

                        <button
                            type="button"
                            className="auth-switch"
                            onClick={() => { setMode('signIn'); setError(''); setNotice(''); setIsPendingActivation(false) }}
                        >
                            <LogIn size={15} /> العودة لتسجيل الدخول
                        </button>
                    </>
                ) : mode === 'setNewPassword' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                            <Sparkles size={20} />
                            <strong>تفعيل الحساب وتعيين كلمة المرور</strong>
                        </div>
                        <h1>أهلاً بك في حركة المخزن</h1>
                        <p>يُرجى تعيين كلمة المرور الجديدة لحسابك لتتمكن من تسجيل الدخول مستقبلاً.</p>

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
                                        minLength={8}
                                        placeholder="8 أحرف على الأقل"
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
                                        minLength={8}
                                        placeholder="أعد كتابة كلمة المرور (8 أحرف على الأقل)"
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

                            <button type="submit" className="primary-btn" disabled={isSubmitting}>
                                <KeyRound size={17} />
                                {isSubmitting ? 'جارٍ الحفظ والتفعيل...' : 'حفظ كلمة المرور والدخول'}
                            </button>
                        </form>
                    </>
                ) : mode === 'forgotPassword' ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                            <ShieldAlert size={20} />
                            <strong>استعادة كلمة المرور</strong>
                        </div>
                        <h1>نسيت كلمة المرور؟</h1>

                        <div style={{
                            padding: '16px',
                            borderRadius: '12px',
                            background: 'rgba(14, 124, 134, 0.08)',
                            border: '1px solid var(--accent)',
                            margin: '12px 0 16px 0',
                            lineHeight: 1.7,
                            fontSize: '0.93rem',
                            color: 'var(--ink)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                <ShieldCheck size={26} color="var(--accent)" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                    <strong style={{ display: 'block', marginBottom: '6px', fontSize: '1rem', color: 'var(--accent)' }}>
                                        يُرجى مراجعة مدير النظام (System Admin)
                                    </strong>
                                    <p style={{ margin: 0, color: 'var(--ink)' }}>
                                        في هذا النظام المحلي، تُدار الحسابات وكلمات المرور مركزياً لحماية البيانات. يُرجى مراجعة <strong>مدير النظام</strong> مباشرةً لتزويدك بكلمة المرور الجديدة أو كود تأكيد التفعيل لحسابك.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="primary-btn"
                            style={{ width: '100%', marginTop: '6px' }}
                            onClick={() => { setMode('signIn'); setError(''); setNotice('') }}
                        >
                            <LogIn size={17} /> العودة لتسجيل الدخول
                        </button>
                    </>
                ) : (
                    <>
                        <h1>تسجيل الدخول</h1>
                        <p>سجّل الدخول باسم المستخدم وكلمة المرور للوصول إلى النظام.</p>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <label>
                                اسم المستخدم
                                <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="اسم المستخدم (مثال: user123)"
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

                            {/* تظهر خانة كود التفعيل عند الحاجة لتأكيد تفعيل الحساب */}
                            {isPendingActivation && (
                                <label style={{ background: 'rgba(14, 124, 134, 0.06)', padding: '10px 12px', borderRadius: '8px', border: '1px dashed var(--accent)' }}>
                                    <span style={{ color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <KeyRound size={15} /> كود تأكيد التفعيل (PIN)
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="أدخل كود تأكيد التفعيل الممنوح لك"
                                        value={activationCode}
                                        onChange={(event) => setActivationCode(event.target.value)}
                                        required
                                        style={{ marginTop: '4px' }}
                                    />
                                </label>
                            )}

                            {error && <div className="inline-message error" role="alert">{error}</div>}
                            {notice && <div className="inline-message success" role="status">{notice}</div>}

                            <button type="submit" className="primary-btn" disabled={isSubmitting}>
                                <LogIn size={17} />
                                {isSubmitting ? 'جارٍ التحقق...' : isPendingActivation ? 'تأكيد التفعيل والدخول' : 'تسجيل الدخول'}
                            </button>
                        </form>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', gap: '6px' }}>
                            <button
                                type="button"
                                className="auth-switch"
                                style={{ color: 'var(--accent)', fontSize: '0.84rem', fontWeight: 600 }}
                                onClick={() => { setMode('activateAccount'); setError(''); setNotice('') }}
                            >
                                <UserCheck size={14} /> تفعيل حساب جديد بكود التفعيل
                            </button>

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
                            <ShieldAlert size={16} color="var(--accent)" />
                            <span>نظام الحسابات محلي ومؤمّن: يتم إنشاء الحسابات وإدارتها بواسطة مدير النظام.</span>
                        </div>
                    </>
                )}
            </section>
        </main>
    )
}