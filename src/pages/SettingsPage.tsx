import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
    ArrowLeft,
    CheckCircle2,
    Clock,
    CloudUpload,
    Database,
    Download,
    ExternalLink,
    FileCheck,
    FileUp,
    HardDrive,
    ImagePlus,
    Info,
    Moon,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldAlert,
    Sun,
    Trash2,
    Upload,
    Warehouse,
} from 'lucide-react'

import type { AppSettings } from '../lib/settings'
import { checkIsSystemAdmin } from '../lib/supabase'
import {
    backupToSupabaseCloud,
    exportLocalBackup,
    formatBackupTimestamp,
    getLastCloudBackupTime,
    getLastLocalBackupTime,
    validateBackupPayload,
    restoreLocalBackup,
    restoreFromCloud,
    type SystemBackupPayload,
} from '../lib/backup'

type SettingsPageProps = {
    settings: AppSettings
    darkMode: boolean
    session?: Session | null
    onSave: (settings: AppSettings) => void
    onToggleTheme: () => void
}

async function processImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement('canvas')
                const MAX_DIM = 350
                let { width, height } = img
                if (width > height) {
                    if (width > MAX_DIM) {
                        height = Math.round((height * MAX_DIM) / width)
                        width = MAX_DIM
                    }
                } else {
                    if (height > MAX_DIM) {
                        width = Math.round((width * MAX_DIM) / height)
                        height = MAX_DIM
                    }
                }
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    resolve(reader.result as string)
                    return
                }
                ctx.drawImage(img, 0, 0, width, height)
                const isPng = file.type === 'image/png'
                const compressedDataUrl = isPng
                    ? canvas.toDataURL('image/png')
                    : canvas.toDataURL('image/jpeg', 0.88)
                resolve(compressedDataUrl)
            }
            img.onerror = () => resolve(reader.result as string)
            img.src = reader.result as string
        }
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'))
        reader.readAsDataURL(file)
    })
}

export default function SettingsPage({ settings, darkMode, session, onSave, onToggleTheme }: SettingsPageProps) {
    const isSystemAdmin = checkIsSystemAdmin(session)
    const [draft, setDraft] = useState(settings)
    const [saved, setSaved] = useState(false)
    const [saveNotice, setSaveNotice] = useState('')
    const [logoMode, setLogoMode] = useState<'file' | 'url'>(settings.logoUrl && !settings.logoDataUrl ? 'url' : 'file')
    const [logoError, setLogoError] = useState('')
    const [logoPreviewFailed, setLogoPreviewFailed] = useState(false)
    const [isProcessingFile, setIsProcessingFile] = useState(false)

    // Backup state
    const [isBackingUpCloud, setIsBackingUpCloud] = useState(false)
    const [isBackingUpLocal, setIsBackingUpLocal] = useState(false)
    const [cloudBackupNotice, setCloudBackupNotice] = useState('')
    const [localBackupNotice, setLocalBackupNotice] = useState('')
    const [cloudBackupError, setCloudBackupError] = useState('')
    const [localBackupError, setLocalBackupError] = useState('')
    const [lastCloudTime, setLastCloudTime] = useState<string | null>(getLastCloudBackupTime)
    const [lastLocalTime, setLastLocalTime] = useState<string | null>(getLastLocalBackupTime)

    // Backup tab navigation
    const [backupTab, setBackupTab] = useState<'create' | 'restore'>('create')

    // Restore state
    const [restoreFile, setRestoreFile] = useState<File | null>(null)
    const [parsedBackup, setParsedBackup] = useState<SystemBackupPayload | null>(null)
    const [restoreValidationError, setRestoreValidationError] = useState('')
    const [restoreOptions, setRestoreOptions] = useState({
        restoreMovements: true,
        restoreCustody: true,
        restoreUsers: true,
        restoreSettings: true,
        restoreAuditLogs: true,
        restoreSuppliers: true,
    })
    const [isRestoringLocal, setIsRestoringLocal] = useState(false)
    const [isRestoringCloud, setIsRestoringCloud] = useState(false)
    const [restoreSuccessNotice, setRestoreSuccessNotice] = useState('')
    const [restoreError, setRestoreError] = useState('')

    async function handleRestoreFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        setRestoreFile(file)
        setRestoreValidationError('')
        setRestoreSuccessNotice('')
        setRestoreError('')
        setParsedBackup(null)

        try {
            const text = await file.text()
            const validation = validateBackupPayload(text)
            if (!validation.valid || !validation.payload) {
                setRestoreValidationError(validation.error || 'الملف المختار غير صالح.')
                return
            }
            setParsedBackup(validation.payload)
        } catch {
            setRestoreValidationError('تعذر قراءة محتوى الملف المختار.')
        }
    }

    async function handleExecuteLocalRestore() {
        if (!isSystemAdmin || !parsedBackup) return
        setIsRestoringLocal(true)
        setRestoreError('')
        setRestoreSuccessNotice('')

        try {
            const result = await restoreLocalBackup(parsedBackup, session, restoreOptions)
            if (restoreOptions.restoreSettings && parsedBackup.data.settings) {
                setDraft(parsedBackup.data.settings)
                onSave(parsedBackup.data.settings)
            }
            const parts: string[] = []
            if (result.counts.movements) parts.push(`${result.counts.movements} حركة`)
            if (result.counts.custody) parts.push(`${result.counts.custody} صنف عهدة`)
            if (result.counts.users) parts.push(`${result.counts.users} مستخدم`)
            if (result.counts.auditLogs) parts.push(`${result.counts.auditLogs} عملية بسجل التدقيق`)
            if (result.counts.suppliers) parts.push(`${result.counts.suppliers} مورد`)
            if (result.counts.settings) parts.push('إعدادات وشعار المؤسسة')

            setRestoreSuccessNotice(
                `✓ تم استعادة النسخة الاحتياطية بنجاح! تم استرجاع: ${parts.length > 0 ? parts.join('، ') : 'كافة البيانات المحددة'}.`
            )
            setParsedBackup(null)
            setRestoreFile(null)
        } catch (err) {
            console.error('Local restore error:', err)
            setRestoreError(err instanceof Error ? err.message : 'تعذر إتمام عملية استعادة النسخة الاحتياطية.')
        } finally {
            setIsRestoringLocal(false)
        }
    }

    async function handleExecuteCloudRestore() {
        if (!isSystemAdmin) return
        setIsRestoringCloud(true)
        setRestoreError('')
        setRestoreSuccessNotice('')

        try {
            const result = await restoreFromCloud(session)
            const parts: string[] = []
            if (result.counts.movements) parts.push(`${result.counts.movements} حركة`)
            if (result.counts.custody) parts.push(`${result.counts.custody} صنف عهدة`)
            if (result.counts.users) parts.push(`${result.counts.users} مستخدم`)
            if (result.counts.auditLogs) parts.push(`${result.counts.auditLogs} عملية بسجل التدقيق`)
            if (result.counts.suppliers) parts.push(`${result.counts.suppliers} مورد`)
            if (result.counts.settings) parts.push('إعدادات وشعار المؤسسة')

            setRestoreSuccessNotice(
                `✓ تم استعادة وتحديث البيانات من سحابة Supabase بنجاح! تم جلب: ${parts.length > 0 ? parts.join('، ') : 'كافة البيانات المزامنة'}.`
            )
        } catch (err) {
            console.error('Cloud restore error:', err)
            setRestoreError(err instanceof Error ? err.message : 'تعذر إتمام الاستعادة من Supabase.')
        } finally {
            setIsRestoringCloud(false)
        }
    }

    async function handleCloudBackup() {
        if (!isSystemAdmin) return
        setCloudBackupError('')
        setCloudBackupNotice('')
        setIsBackingUpCloud(true)
        try {
            const result = await backupToSupabaseCloud(session)
            setLastCloudTime(result.timestamp)
            const parts: string[] = []
            if (result.counts.movements) parts.push(`${result.counts.movements} حركة`)
            if (result.counts.custody) parts.push(`${result.counts.custody} صنف عهدة`)
            if (result.counts.users) parts.push(`${result.counts.users} مستخدم`)
            if (result.counts.auditLogs) parts.push(`${result.counts.auditLogs} عملية تدقيق`)
            setCloudBackupNotice(`تم النسخ السحابي بنجاح! تم تأكيد حفظ ومزامنة: ${parts.join(' و')} في Supabase.`)
            setTimeout(() => setCloudBackupNotice(''), 7000)
        } catch (err) {
            console.error('Cloud backup error:', err)
            setCloudBackupError(err instanceof Error ? err.message : 'تعذر إتمام النسخ السحابي إلى Supabase.')
        } finally {
            setIsBackingUpCloud(false)
        }
    }

    async function handleLocalBackup() {
        if (!isSystemAdmin) return
        setLocalBackupError('')
        setLocalBackupNotice('')
        setIsBackingUpLocal(true)
        try {
            const result = await exportLocalBackup(session)
            setLastLocalTime(result.timestamp)
            setLocalBackupNotice(
                `تم تنزيل النسخة الاحتياطية الشاملة (${result.fileName}) متضمنة كافة الحركات (${result.counts.movements}) والعهدة (${result.counts.custody}) والمستخدمين (${result.counts.users}) وسجل العمليات (${result.counts.auditLogs}) بنجاح!`
            )
            setTimeout(() => setLocalBackupNotice(''), 7000)
        } catch (err) {
            console.error('Local backup error:', err)
            setLocalBackupError(err instanceof Error ? err.message : 'تعذر إنشاء وتنزيل النسخة الاحتياطية.')
        } finally {
            setIsBackingUpLocal(false)
        }
    }

    useEffect(() => {
        setDraft(settings)
        if (settings.logoUrl && !settings.logoDataUrl) {
            setLogoMode('url')
        } else if (settings.logoDataUrl) {
            setLogoMode('file')
        }
    }, [settings])

    const logoPreview = logoMode === 'file' ? draft.logoDataUrl : draft.logoUrl
    const hasSelectedLogo = Boolean(logoPreview?.trim())

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const nextSettings = { ...draft }

        if (logoMode === 'url') {
            const logoUrl = draft.logoUrl?.trim() ?? ''
            if (logoUrl) {
                try {
                    const parsedUrl = new URL(logoUrl)
                    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error()
                } catch {
                    setLogoError('أدخل رابط صورة صحيحًا يبدأ بـ http أو https.')
                    return
                }
            }
            nextSettings.logoUrl = logoUrl
            nextSettings.logoDataUrl = ''
        } else {
            nextSettings.logoUrl = ''
        }

        setLogoError('')
        onSave(nextSettings)
        setSaved(true)
        setSaveNotice('تم حفظ وتطبيق كافة الإعدادات والشعار بنجاح.')
    }

    async function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return

        if (!file.type.startsWith('image/')) {
            setLogoError('اختَر ملف صورة بصيغة مدعومة (PNG, JPG, SVG, WebP).')
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            setLogoError('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.')
            return
        }

        setIsProcessingFile(true)
        setLogoError('')

        try {
            const compressed = await processImageFile(file)
            const nextSettings: AppSettings = {
                ...draft,
                logoDataUrl: compressed,
                logoUrl: '',
            }
            setDraft(nextSettings)
            setLogoPreviewFailed(false)
            onSave(nextSettings)
            setSaved(true)
            setSaveNotice('✓ تم حفظ وتطبيق شعار المؤسسة بنجاح في النظام ومطبوعات الكشوفات.')
        } catch {
            setLogoError('تعذر معالجة ملف الصورة. جرّب ملفًا آخر.')
        } finally {
            setIsProcessingFile(false)
        }
    }

    function handleApplyUrl() {
        const logoUrl = draft.logoUrl?.trim() ?? ''
        if (logoUrl) {
            try {
                const parsedUrl = new URL(logoUrl)
                if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error()
            } catch {
                setLogoError('أدخل رابط صورة صحيحًا يبدأ بـ http أو https.')
                return
            }
        }
        const nextSettings: AppSettings = {
            ...draft,
            logoUrl,
            logoDataUrl: '',
        }
        setDraft(nextSettings)
        setLogoError('')
        setLogoPreviewFailed(false)
        onSave(nextSettings)
        setSaved(true)
        setSaveNotice('✓ تم حفظ وتطبيق رابط الشعار بنجاح.')
    }

    function removeLogo() {
        const nextSettings: AppSettings = {
            ...draft,
            logoDataUrl: '',
            logoUrl: '',
        }
        setDraft(nextSettings)
        setLogoError('')
        setLogoPreviewFailed(false)
        onSave(nextSettings)
        setSaved(true)
        setSaveNotice('✓ تمت إزالة الشعار بنجاح.')
    }

    if (!isSystemAdmin) {
        return (
            <section className="page-stack settings-page">
                <header className="page-intro">
                    <div className="page-intro-icon modal-icon-danger">
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow text-bad">صلاحية وصول مقيدة</p>
                        <h2>إعدادات المؤسسة</h2>
                        <p>خاص ومقتصر على مدير النظام (System Admin).</p>
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
                        عذراً، صفحة إعدادات المؤسسة وتخصيص الشعار مخصصة حصرياً لحسابات <strong>مدير النظام (System Administrator)</strong>. لا يملك حسابك الحالي الصلاحيات الكافية للوصول إلى هذه الإعدادات.
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
        <section className="page-stack settings-page">
            <header className="page-intro">
                <div className="page-intro-icon"><Info size={22} /></div>
                <div>
                    <p className="eyebrow">تخصيص التطبيق</p>
                    <h2>إعدادات المؤسسة</h2>
                    <p>بيانات المؤسسة، الشعار الرسمي، وطريقة العرض على هذا الجهاز وفي الطباعة.</p>
                </div>
            </header>

            {saveNotice && (
                <div className="inline-message success flex items-center gap-2 mb-4 font-sm">
                    <CheckCircle2 size={18} />
                    <span>{saveNotice}</span>
                </div>
            )}

            <form className="settings-layout" onSubmit={handleSubmit}>
                <section className="card-surface settings-section">
                    <div className="section-head">
                        <div>
                            <h3>بيانات المؤسسة</h3>
                            <span>تظهر في رأس لوحة المخزن وفي التقارير ومحاضر الجرد المطبوعة</span>
                        </div>
                    </div>
                    <div className="settings-fields">
                        <label>
                            اسم المؤسسة / الكلية
                            <input
                                value={draft.organization}
                                required
                                disabled={!isSystemAdmin}
                                onChange={(event) => {
                                    setDraft({ ...draft, organization: event.target.value })
                                    setSaved(false)
                                    setSaveNotice('')
                                }}
                            />
                        </label>
                        <label>
                            القسم / الإدارة
                            <input
                                value={draft.department}
                                required
                                disabled={!isSystemAdmin}
                                onChange={(event) => {
                                    setDraft({ ...draft, department: event.target.value })
                                    setSaved(false)
                                    setSaveNotice('')
                                }}
                            />
                        </label>
                        <label>
                            اختصار / رمز المؤسسة (مثال: ZNU)
                            <input
                                value={draft.organizationCode ?? 'ZNU'}
                                disabled={!isSystemAdmin}
                                placeholder="ZNU"
                                onChange={(event) => {
                                    const code = event.target.value.trim().toUpperCase()
                                    setDraft({
                                        ...draft,
                                        organizationCode: code,
                                        systemName: code ? `${code}-Warehouse-Ledger` : 'Warehouse-Ledger',
                                    })
                                    setSaved(false)
                                    setSaveNotice('')
                                }}
                            />
                        </label>
                        <label>
                            اسم المنظومة المعروض (اسم السيستم)
                            <input
                                value={draft.systemName ?? (draft.organizationCode ? `${draft.organizationCode}-Warehouse-Ledger` : 'ZNU-Warehouse-Ledger')}
                                disabled={!isSystemAdmin}
                                placeholder="ZNU-Warehouse-Ledger"
                                onChange={(event) => {
                                    setDraft({ ...draft, systemName: event.target.value })
                                    setSaved(false)
                                    setSaveNotice('')
                                }}
                            />
                        </label>
                        <label>
                            العملة المعتمدة
                            <select
                                value={draft.currency}
                                disabled={!isSystemAdmin}
                                onChange={(event) => {
                                    setDraft({ ...draft, currency: event.target.value as AppSettings['currency'] })
                                    setSaved(false)
                                    setSaveNotice('')
                                }}
                            >
                                <option value="EGP">جنيه مصري (EGP)</option>
                                <option value="SAR">ريال سعودي (SAR)</option>
                                <option value="AED">درهم إماراتي (AED)</option>
                                <option value="USD">دولار أمريكي (USD)</option>
                            </select>
                        </label>
                    </div>
                    <div className="settings-actions">
                        {isSystemAdmin ? (
                            <button type="submit" className="primary-btn"><Save size={17} /> حفظ بيانات المؤسسة</button>
                        ) : (
                            <div className="inline-message info m-0 flex items-center gap-2">
                                <Info size={16} /> هذه الإعدادات للعرض فقط — تعديل إعدادات وشعار المؤسسة مقتصر على مدير النظام (System Admin).
                            </div>
                        )}
                        {saved && <span className="saved-state">تم الحفظ بنجاح</span>}
                    </div>
                </section>

                <section className="card-surface settings-section logo-settings-section">
                    <div className="section-head">
                        <div>
                            <h3><ImagePlus size={18} /> شعار المؤسسة</h3>
                            <span>ارفع صورة شعار المؤسسة لتظهر تلقائياً في الشريط الجانبي وأعلى النظام ومطبوعات كشوفات العهدة</span>
                        </div>
                        {hasSelectedLogo && !logoPreviewFailed && (
                            <div className="badge badge-success inline-flex items-center gap-1 font-xs">
                                <CheckCircle2 size={14} /> الشعار مفعل في النظام والطباعة
                            </div>
                        )}
                    </div>

                    <div className="logo-source-switch" role="group" aria-label="طريقة إضافة الشعار">
                        <button
                            type="button"
                            className={logoMode === 'file' ? 'active' : ''}
                            onClick={() => {
                                setLogoMode('file')
                                setLogoError('')
                                setLogoPreviewFailed(false)
                            }}
                        >
                            <Upload size={16} /> رفع ملف صورة
                        </button>
                        <button
                            type="button"
                            className={logoMode === 'url' ? 'active' : ''}
                            onClick={() => {
                                setLogoMode('url')
                                setLogoError('')
                                setLogoPreviewFailed(false)
                            }}
                        >
                            <ExternalLink size={16} /> رابط URL مباشر
                        </button>
                    </div>

                    <div className="logo-settings-grid">
                        <div className="logo-source-panel">
                            {logoMode === 'file' ? (
                                <label className="logo-file-picker">
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                        onChange={handleLogoFileChange}
                                        disabled={isProcessingFile || !isSystemAdmin}
                                    />
                                    <Upload size={19} />
                                    <strong>
                                        {!isSystemAdmin
                                            ? 'تغيير الشعار مقتصر على مدير النظام'
                                            : isProcessingFile
                                            ? 'جارٍ معالجة وضغط الصورة...'
                                            : draft.logoDataUrl
                                            ? 'اختيار صورة بديلة من الجهاز'
                                            : 'اختيار صورة الشعار من الجهاز'}
                                    </strong>
                                    <span>صيغ PNG أو JPG أو SVG أو WebP (يتم حفظها وضغطها تلقائياً)</span>
                                </label>
                            ) : (
                                <div className="logo-url-field">
                                    <span>رابط صورة الشعار</span>
                                    <div className="flex gap-2 items-center">
                                        <span className="logo-url-input-wrap flex-1">
                                            <ExternalLink size={16} />
                                            <input
                                                dir="ltr"
                                                type="url"
                                                value={draft.logoUrl ?? ''}
                                                placeholder="https://example.com/logo.png"
                                                disabled={!isSystemAdmin}
                                                onChange={(event) => {
                                                    setDraft({ ...draft, logoUrl: event.target.value, logoDataUrl: '' })
                                                    setLogoError('')
                                                    setLogoPreviewFailed(false)
                                                    setSaved(false)
                                                    setSaveNotice('')
                                                }}
                                            />
                                        </span>
                                        {isSystemAdmin && (
                                            <button
                                                type="button"
                                                onClick={handleApplyUrl}
                                             className="secondary-btn nowrap">
                                                <Save size={15} /> تطبيق وحفظ الرابط
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <p className="logo-help">
                                يظهر الشعار المحفوظ في:
                                <strong> الشريط الجانبي</strong>،
                                <strong> شريط العنوان العلوي</strong>،
                                <strong> نموذج طباعة كشف حصر العهدة الرسمي A4</strong>،
                                و<strong> شاشة الدخول</strong>.
                            </p>
                            {logoError && <div className="logo-error" role="alert">{logoError}</div>}
                        </div>

                        <div className="logo-preview-column">
                            <span className="logo-preview-label">معاينة الشعار المعتمد</span>
                            <div className="logo-preview">
                                {hasSelectedLogo && !logoPreviewFailed ? (
                                    <img
                                        src={logoPreview}
                                        alt="معاينة شعار المؤسسة"
                                        onError={() => {
                                            setLogoPreviewFailed(true)
                                            setLogoError('تعذر تحميل الصورة. تحقق من الملف أو الرابط.')
                                        }}
                                    />
                                ) : (
                                    <div className="logo-preview-empty">
                                        <Warehouse size={24} />
                                        <span>{logoPreviewFailed ? 'تعذر عرض الصورة' : 'لا يوجد شعار مخصص'}</span>
                                    </div>
                                )}
                            </div>
                            {isSystemAdmin && Boolean(draft.logoDataUrl || draft.logoUrl) && (
                                <button type="button" className="logo-remove-button" onClick={removeLogo}>
                                    <Trash2 size={15} /> إزالة الشعار
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                <section className="card-surface settings-section">
                    <div className="section-head">
                        <div><h3>المظهر</h3><span>تغيير ألوان مساحة العمل بين الفاتح والداكن</span></div>
                    </div>
                    <button type="button" className="appearance-toggle" onClick={onToggleTheme}>
                        {darkMode ? <Sun size={19} /> : <Moon size={19} />}
                        <span>{darkMode ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}</span>
                    </button>
                </section>

                {/* System Backup Section (Strictly System Admin only) */}
                {isSystemAdmin && (
                    <section className="card-surface settings-section backup-settings-section">
                        <div className="section-head mb-3">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h3><Database size={19} /> النسخ الاحتياطي وحماية البيانات</h3>
                                    <span className="admin-only-badge">خاص بمدير النظام</span>
                                </div>
                                <span>حفظ وأرشفة واستعادة بيانات المستودع والحركات والعهدة والمستخدمين سحابياً على Supabase أو محلياً على جهازك.</span>
                            </div>
                        </div>

                        <div className="backup-tabs" role="tablist" aria-label="خيارات النسخ الاحتياطي">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={backupTab === 'create'}
                                className={`backup-tab-btn ${backupTab === 'create' ? 'active' : ''}`}
                                onClick={() => setBackupTab('create')}
                                id="tab-backup-create"
                            >
                                <CloudUpload size={16} />
                                <span>إنشاء نسخة احتياطية</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={backupTab === 'restore'}
                                className={`backup-tab-btn ${backupTab === 'restore' ? 'active' : ''}`}
                                onClick={() => setBackupTab('restore')}
                                id="tab-backup-restore"
                            >
                                <RotateCcw size={16} />
                                <span>استعادة النسخة الاحتياطية</span>
                            </button>
                        </div>

                        {backupTab === 'create' ? (
                            <div className="backup-cards-grid">
                                {/* 1. Cloud Backup (Supabase) Card */}
                                <div className="backup-card cloud-backup-card">
                                    <div className="backup-card-head">
                                        <div className="backup-card-icon cloud">
                                            <CloudUpload size={24} />
                                        </div>
                                        <div>
                                            <h4>نسخ احتياطي سحابي (Supabase)</h4>
                                            <span className="backup-card-desc">
                                                حفظ وتأكيد مزامنة كافة جداول النظام (الحركات، العهد، الإعدادات، المستخدمين) سحابياً فورياً في Supabase.
                                            </span>
                                        </div>
                                    </div>

                                    <div className="backup-card-meta">
                                        <Clock size={14} />
                                        <span>آخر نسخ سحابي: <strong>{formatBackupTimestamp(lastCloudTime)}</strong></span>
                                    </div>

                                    {cloudBackupNotice && (
                                        <div className="inline-message success my-2 font-xs">
                                            <CheckCircle2 size={16} />
                                            <span>{cloudBackupNotice}</span>
                                        </div>
                                    )}

                                    {cloudBackupError && (
                                        <div className="inline-message error my-2 font-xs">
                                            <ShieldAlert size={16} />
                                            <span>{cloudBackupError}</span>
                                        </div>
                                    )}

                                    <div className="backup-card-actions">
                                        <button
                                            type="button"
                                            className="highlight-action-btn"
                                            onClick={handleCloudBackup}
                                            disabled={isBackingUpCloud}
                                            id="btn-settings-backup-cloud"
                                            title="بدء المزامنة والنسخ الاحتياطي الكامل إلى Supabase"
                                        >
                                            {isBackingUpCloud ? (
                                                <>
                                                    <RefreshCw size={16} className="spin-animation" />
                                                    <span>جارٍ النسخ السحابي...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CloudUpload size={16} />
                                                    <span>نسخ احتياطي سحابي إلى Supabase</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* 2. Device Local Backup (JSON) Card */}
                                <div className="backup-card local-backup-card">
                                    <div className="backup-card-head">
                                        <div className="backup-card-icon local">
                                            <HardDrive size={24} />
                                        </div>
                                        <div>
                                            <h4>نسخ احتياطي على الجهاز نفسه (JSON)</h4>
                                            <span className="backup-card-desc">
                                                تنزيل ملف نسخة احتياطية كاملة وشاملة لكافة بيانات النظام على جهازك للاحتفاظ بها خارجياً والرجوع إليها دون اتصال.
                                            </span>
                                        </div>
                                    </div>

                                    <div className="backup-card-meta">
                                        <Clock size={14} />
                                        <span>آخر تنزيل محلي: <strong>{formatBackupTimestamp(lastLocalTime)}</strong></span>
                                    </div>

                                    {localBackupNotice && (
                                        <div className="inline-message success my-2 font-xs">
                                            <CheckCircle2 size={16} />
                                            <span>{localBackupNotice}</span>
                                        </div>
                                    )}

                                    {localBackupError && (
                                        <div className="inline-message error my-2 font-xs">
                                            <ShieldAlert size={16} />
                                            <span>{localBackupError}</span>
                                        </div>
                                    )}

                                    <div className="backup-card-actions">
                                        <button
                                            type="button"
                                            className="primary-btn"
                                            onClick={handleLocalBackup}
                                            disabled={isBackingUpLocal}
                                            id="btn-settings-backup-local"
                                            title="تنزيل ملف النسخة الاحتياطية الشاملة على جهاز الكمبيوتر"
                                        >
                                            {isBackingUpLocal ? (
                                                <>
                                                    <RefreshCw size={16} className="spin-animation" />
                                                    <span>جارٍ تحضير الملف...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Download size={16} />
                                                    <span>تحميل نسخة احتياطية على الجهاز</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Restore Tab Content */
                            <div className="mt-4 flex flex-col gap-4">
                                {restoreSuccessNotice && (
                                    <div className="inline-message success m-0 font-sm">
                                        <CheckCircle2 size={18} />
                                        <span>{restoreSuccessNotice}</span>
                                    </div>
                                )}

                                {restoreError && (
                                    <div className="inline-message error m-0 font-sm">
                                        <ShieldAlert size={18} />
                                        <span>{restoreError}</span>
                                    </div>
                                )}

                                <div className="backup-cards-grid">
                                    {/* 1. Local JSON File Restore Card */}
                                    <div className="backup-card local-backup-card gap-4">
                                        <div className="backup-card-head">
                                            <div className="backup-card-icon local">
                                                <FileUp size={24} />
                                            </div>
                                            <div>
                                                <h4>استعادة من ملف نسخة احتياطية (.json)</h4>
                                                <span className="backup-card-desc">
                                                    ارفع ملف النسخة الاحتياطية الذي تم تنزيله سابقاً من النظام لمعاينة محتواه واسترجاع الحركات والعهدة والمستخدمين بأمان.
                                                </span>
                                            </div>
                                        </div>

                                        {!parsedBackup ? (
                                            <label className="restore-dropzone-label">
                                                <FileUp size={32} className="text-accent" />
                                                <div>
                                                    <strong className="block font-sm text-ink">
                                                        اضغط لاختيار ملف النسخة الاحتياطية (.json)
                                                    </strong>
                                                    <span className="font-xs text-muted">
                                                        أو اسحب وأفلت الملف هنا
                                                    </span>
                                                </div>
                                                <input
                                                    type="file"
                                                    accept=".json,application/json"
                                                    onChange={handleRestoreFileChange}
                                                    id="input-restore-backup-file"
                                                />
                                            </label>
                                        ) : (
                                            <div className="restore-preview-card">
                                                <div className="restore-preview-head">
                                                    <div>
                                                        <strong className="font-sm text-ink flex items-center gap-1">
                                                            <FileCheck size={16} className="text-good" />
                                                            ملف صالح: {restoreFile?.name}
                                                        </strong>
                                                        <span className="font-xs text-muted">
                                                            تاريخ النسخة: {formatBackupTimestamp(parsedBackup.backupDate)}
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="secondary-btn btn-sm"
                                                        onClick={() => {
                                                            setParsedBackup(null)
                                                            setRestoreFile(null)
                                                        }}
                                                    >
                                                        اختيار ملف آخر
                                                    </button>
                                                </div>

                                                <div className="restore-preview-stats">
                                                    <div className="restore-stat-item">
                                                        <span>الحركات المسجلة</span>
                                                        <strong>{parsedBackup.metadata.counts.movements} حركة</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>أصناف العهدة</span>
                                                        <strong>{parsedBackup.metadata.counts.custody} صنف</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>المستخدمون</span>
                                                        <strong>{parsedBackup.metadata.counts.users} مستخدم</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>سجل العمليات والتدقيق</span>
                                                        <strong>{parsedBackup.metadata.counts.auditLogs || 0} عملية</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>الموردون المعتمدون</span>
                                                        <strong>{parsedBackup.metadata.counts.suppliers || 0} مورد</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>المؤسسة والعملة</span>
                                                        <strong>{parsedBackup.metadata.organization} ({parsedBackup.metadata.currency})</strong>
                                                    </div>
                                                </div>

                                                <div className="border-top-line">
                                                    <span className="font-xs font-semibold text-ink block mb-2">
                                                        حدد البيانات التي ترغب في استعادتها:
                                                    </span>
                                                    <div className="restore-options-grid">
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreMovements}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreMovements: e.target.checked })}
                                                            />
                                                            سجل الحركات ({parsedBackup.metadata.counts.movements})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreCustody}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreCustody: e.target.checked })}
                                                            />
                                                            أصناف العهدة ({parsedBackup.metadata.counts.custody})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreUsers}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreUsers: e.target.checked })}
                                                            />
                                                            المستخدمون وحسابات الدخول ({parsedBackup.metadata.counts.users})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreAuditLogs}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreAuditLogs: e.target.checked })}
                                                            />
                                                            سجل العمليات والتدقيق ({parsedBackup.metadata.counts.auditLogs || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreSuppliers}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSuppliers: e.target.checked })}
                                                            />
                                                            سجل الموردين المعتمدين ({parsedBackup.metadata.counts.suppliers || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={restoreOptions.restoreSettings}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSettings: e.target.checked })}
                                                            />
                                                            إعدادات وشعار المؤسسة
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {restoreValidationError && (
                                            <div className="inline-message error m-0 font-xs">
                                                <ShieldAlert size={16} />
                                                <span>{restoreValidationError}</span>
                                            </div>
                                        )}

                                        {parsedBackup && (
                                            <div className="backup-card-actions">
                                                <button
                                                    type="button"
                                                    className="highlight-action-btn"
                                                    onClick={handleExecuteLocalRestore}
                                                    disabled={isRestoringLocal}
                                                    id="btn-confirm-restore-local"
                                                    title="تأكيد واستعادة بيانات النسخة المحددة إلى النظام"
                                                >
                                                    {isRestoringLocal ? (
                                                        <>
                                                            <RefreshCw size={16} className="spin-animation" />
                                                            <span>جارٍ استعادة البيانات وتطبيقها...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <RotateCcw size={16} />
                                                            <span>تأكيد واستعادة البيانات من الملف</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* 2. Cloud Supabase Restore Card */}
                                    <div className="backup-card cloud-backup-card">
                                        <div className="backup-card-head">
                                            <div className="backup-card-icon cloud">
                                                <CloudUpload size={24} />
                                            </div>
                                            <div>
                                                <h4>استعادة ومزامنة من سحابة Supabase</h4>
                                                <span className="backup-card-desc">
                                                    إعادة جلب ومزامنة كافة السجلات المخزنة في قاعدة بيانات Supabase إلى جهازك فورياً (الحركات، العهد، الإعدادات، المستخدمين، وسجل العمليات).
                                                </span>
                                            </div>
                                        </div>

                                        <div className="backup-card-meta">
                                            <Clock size={14} />
                                            <span>آخر نسخ سحابي مسجل: <strong>{formatBackupTimestamp(lastCloudTime)}</strong></span>
                                        </div>

                                        <div className="backup-card-actions">
                                            <button
                                                type="button"
                                                className="primary-btn"
                                                onClick={handleExecuteCloudRestore}
                                                disabled={isRestoringCloud}
                                                id="btn-confirm-restore-cloud"
                                                title="استرجاع كافة البيانات المخزنة على Supabase محلياً"
                                            >
                                                {isRestoringCloud ? (
                                                    <>
                                                        <RefreshCw size={16} className="spin-animation" />
                                                        <span>جارٍ جلب البيانات من Supabase...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <RotateCcw size={16} />
                                                        <span>استعادة ومزامنة من Supabase</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                )}
            </form>
        </section>
    )
}