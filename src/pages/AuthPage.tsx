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
    Warehouse,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import type { AppSettings } from '../lib/settings'
import { logAuditEvent } from '../lib/auditLogger'
import { isSupabaseConfigured, toSyntheticEmail } from '../lib/authMode'

type AuthMode = 'signIn' | 'forgotPassword' | 'setNewPassword'

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
                setError('⚠️ رابط تفعيل الدعوة أو الاستعادة غير صالح أو انتهت صلاحيته. يمكنك تسجيل الدخول باسم المستخدم وكلمة المرور مباشرة.')
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
            if (!isConfigured || !supabase) {
                throw new Error('خدمة Supabase Auth غير مهيأة أو غير متصلة. يرجى تهيئة متغيرات البيئة VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY.')
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
                if (username.includes('@')) {
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(username, {
                        redirectTo: `${window.location.origin}/#type=recovery`,
                    })
                    if (resetError) throw resetError
                    setNotice('تم إرسال رابط إعادة تعيين كلمة المرور إلى البريد الإلكتروني المسجل.')
                } else {
                    throw new Error('في نظام المخزن الداخلي، يُرجى مراجعة مدير النظام (System Admin) لإنشاء كلمة مرور مؤقتة لحسابك، وسيطلب منك النظام تغييرها فور تسجيل الدخول.')
                }
                return
            }

            // Mode: signIn
            const cleanUser = username.trim().toLowerCase()
            if (!cleanUser) {
                throw new Error('يرجى إدخال اسم المستخدم أو البريد الإلكتروني.')
            }
            if (!password) {
                throw new Error('يرجى إدخال كلمة المرور.')
            }

            let targetEmail = toSyntheticEmail(cleanUser)
            let { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email: targetEmail,
                password,
            })

            // If sign-in failed and user entered username or email alias, try alternate address
            if (signInError && (cleanUser === 'marwan-desouky' || cleanUser === 'marwandesouqhi@gmail.com')) {
                const alternateEmail = cleanUser === 'marwan-desouky' ? 'marwandesouqhi@gmail.com' : 'marwan-desouky@warehouse.local'
                const retry = await supabase.auth.signInWithPassword({
                    email: alternateEmail,
                    password,
                })
                if (!retry.error) {
                    signInData = retry.data
                    signInError = null
                }
            }

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
                setActiveUserEmail(signInData.user?.email || targetEmail)
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

                {mode === 'setNewPassword' ? (
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
                                        مراجعة مدير النظام (System Admin)
                                    </strong>
                                    <p style={{ margin: 0, color: 'var(--ink)' }}>
                                        تُدار الحسابات وكلمات المرور مركزياً عبر خادم Supabase Auth. يُرجى مراجعة <strong>مدير النظام</strong> مباشرةً لتزويدك بكلمة مرور مؤقتة لحسابك، وسيطلب منك النظام تعيين كلمة مرور جديدة قوية فور تسجيل الدخول.
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
                        <p>سجّل الدخول باسم المستخدم وكلمة المرور للوصول إلى النظام عبر Supabase Auth.</p>

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