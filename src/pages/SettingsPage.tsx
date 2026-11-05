import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Clock,
    CloudUpload,
    Database,
    Download,
    ExternalLink,
    FileCheck,
    FileSpreadsheet,
    FileUp,
    HardDrive,
    ImagePlus,
    Info,
    Moon,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldAlert,
    Sparkles,
    Sun,
    Trash2,
    Upload,
    Warehouse,
} from 'lucide-react'

import type { AppSettings, PersistenceOutcome } from '../lib/settings'
import { checkIsSystemAdmin } from '../lib/supabase'
import {
    backupToSupabaseCloud,
    exportLocalBackup,
    formatBackupTimestamp,
    getLastCloudBackupTime,
    getLastLocalBackupTime,
    getLastAutoBackupTime,
    validateBackupPayload,
    restoreLocalBackup,
    restoreFromCloud,
    type SystemBackupPayload,
    type RestoreOptions,
    type SystemBackupCounts,
} from '../lib/backup'
import {
    isAutoBackupEnabled,
    setAutoBackupEnabled,
    restoreFromAutoRecovery,
    getAutoBackupScheduleConfig,
    saveAutoBackupScheduleConfig,
    computeNextScheduledRun,
    formatNextScheduledRunArabic,
    ARABIC_DAYS_OF_WEEK,
    type AutoBackupScheduleConfig,
} from '../lib/autoBackupEngine'
import {
    getGoogleSheetsWebhookUrl,
    setGoogleSheetsWebhookUrl,
    pushMovementToGoogleSheet,
} from '../lib/googleSheetsRealtimeSync'

type SettingsPageProps = {
    settings: AppSettings
    darkMode: boolean
    session?: Session | null
    onSave: (settings: AppSettings) => Promise<PersistenceOutcome> | PersistenceOutcome | void
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
    const [saveError, setSaveError] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [persistenceOutcome, setPersistenceOutcome] = useState<PersistenceOutcome | null>(null)
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
    const [lastAutoTime, setLastAutoTime] = useState<string | null>(getLastAutoBackupTime)
    const [autoBackupEnabled, setAutoBackupEnabledState] = useState<boolean>(isAutoBackupEnabled)
    const [isRestoringAuto, setIsRestoringAuto] = useState(false)

    useEffect(() => {
        function handleAutoBackupCompleted(e: Event) {
            const detail = (e as CustomEvent).detail
            if (detail?.timestamp) {
                setLastAutoTime(detail.timestamp)
            }
        }
        window.addEventListener('auto-backup-completed', handleAutoBackupCompleted)
        return () => window.removeEventListener('auto-backup-completed', handleAutoBackupCompleted)
    }, [])

    function handleToggleAutoBackup(enabled: boolean) {
        setAutoBackupEnabled(enabled)
        setAutoBackupEnabledState(enabled)
    }

    // Auto-backup schedule state
    const [scheduleConfig, setScheduleConfig] = useState<AutoBackupScheduleConfig>(getAutoBackupScheduleConfig)
    const [scheduleSavedNotice, setScheduleSavedNotice] = useState('')

    useEffect(() => {
        function handleScheduleChanged(e: Event) {
            const detail = (e as CustomEvent).detail
            if (detail) {
                setScheduleConfig(detail)
            }
        }
        window.addEventListener('auto-backup-schedule-changed', handleScheduleChanged)
        return () => window.removeEventListener('auto-backup-schedule-changed', handleScheduleChanged)
    }, [])

    function handleSaveSchedule(updated: AutoBackupScheduleConfig) {
        saveAutoBackupScheduleConfig(updated)
        setScheduleConfig(updated)
        setScheduleSavedNotice('تم حفظ وتحديث جدول النسخ الاحتياطي التلقائي بنجاح.')
        setTimeout(() => setScheduleSavedNotice(''), 4000)
    }

    // Google Sheets Real-time sync state
    const [sheetsWebhook, setSheetsWebhook] = useState(getGoogleSheetsWebhookUrl)
    const [sheetsSavedNotice, setSheetsSavedNotice] = useState('')
    const [isTestingSheet, setIsTestingSheet] = useState(false)
    const [sheetTestOutcome, setSheetTestOutcome] = useState<{ status: 'success' | 'error'; message: string } | null>(null)

    function handleSaveSheetsWebhook() {
        setGoogleSheetsWebhookUrl(sheetsWebhook)
        setSheetsSavedNotice('✓ تم حفظ وتفعيل رابط المزامنة اللحظية مع Google Sheets بنجاح.')
        setTimeout(() => setSheetsSavedNotice(''), 5000)
    }

    async function handleTestSheet() {
        if (!sheetsWebhook || !sheetsWebhook.trim()) return
        setIsTestingSheet(true)
        setSheetTestOutcome(null)
        try {
            setGoogleSheetsWebhookUrl(sheetsWebhook)
            const success = await pushMovementToGoogleSheet({
                id: 'TEST-' + Date.now().toString().slice(-4),
                item: 'تجربة اتصال المزامنة اللحظية مع شيت جوجل',
                qin: 1,
                price: 100,
                notes: 'حركة اختبارية للتحقق من المزامنة اللحظية في شيت AppSheet_DB',
            }, 'medicine_a')

            if (success) {
                setSheetTestOutcome({
                    status: 'success',
                    message: '✓ تم إرسال حركة اختبارية للشيت بنجاح! افتح تبويب AppSheet_DB في جوجل شيت لتراها فوراً.',
                })
            } else {
                setSheetTestOutcome({
                    status: 'error',
                    message: 'تعذر الاتصال برابط الويبهوك. تأكد من نشر الـ Web app بصلاحية Anyone.',
                })
            }
        } catch (err) {
            setSheetTestOutcome({
                status: 'error',
                message: 'حدث خطأ أثناء الاتصال: ' + (err instanceof Error ? err.message : String(err)),
            })
        } finally {
            setIsTestingSheet(false)
        }
    }

    function toggleDayOfWeek(dayVal: number) {
        const currentDays = scheduleConfig.daysOfWeek || []
        let nextDays: number[]
        if (currentDays.includes(dayVal)) {
            if (currentDays.length === 1) {
                alert('يجب تحديد يوم واحد على الأقل للنسخ الاحتياطي.')
                return
            }
            nextDays = currentDays.filter((d) => d !== dayVal)
        } else {
            nextDays = [...currentDays, dayVal]
        }
        handleSaveSchedule({
            ...scheduleConfig,
            daysOfWeek: nextDays,
        })
    }

    // Backup tab navigation
    const [backupTab, setBackupTab] = useState<'create' | 'restore'>('create')

    // Restore state
    const [restoreFile, setRestoreFile] = useState<File | null>(null)
    const [parsedBackup, setParsedBackup] = useState<SystemBackupPayload | null>(null)
    const [restoreValidationError, setRestoreValidationError] = useState('')
    const [restoreOptions, setRestoreOptions] = useState<RestoreOptions>({
        restoreMovements: true,
        restoreCustody: true,
        restoreUsers: true,
        restoreSettings: true,
        restoreAuditLogs: true,
        restoreSuppliers: true,
        restoreContracts: true,
        restoreDisbursementRequests: true,
        restoreBudgetPlans: true,
        restoreFinancialReports: true,
        restoreAssetMovements: true,
        restoreSupportTickets: true,
        restoreTechnicalInspections: true,
        restoreInventorySettlements: true,
        restoreTelegramSettings: true,
        restoreNotifications: true,
        restorePurchaseRequests: true,
        restoreSupplierQuotes: true,
        restorePurchaseOrders: true,
        restoreRegistrationRequests: true,
        restoreChatbotDirectives: true,
    })
    const [isRestoringLocal, setIsRestoringLocal] = useState(false)
    const [isRestoringCloud, setIsRestoringCloud] = useState(false)
    const [restoreSuccessNotice, setRestoreSuccessNotice] = useState('')
    const [restoreError, setRestoreError] = useState('')

    function toggleAllRestoreOptions(select: boolean) {
        setRestoreOptions({
            restoreMovements: select,
            restoreCustody: select,
            restoreUsers: select,
            restoreSettings: select,
            restoreAuditLogs: select,
            restoreSuppliers: select,
            restoreContracts: select,
            restoreDisbursementRequests: select,
            restoreBudgetPlans: select,
            restoreFinancialReports: select,
            restoreAssetMovements: select,
            restoreSupportTickets: select,
            restoreTechnicalInspections: select,
            restoreInventorySettlements: select,
            restoreTelegramSettings: select,
            restoreNotifications: select,
            restorePurchaseRequests: select,
            restoreSupplierQuotes: select,
            restorePurchaseOrders: select,
            restoreRegistrationRequests: select,
            restoreChatbotDirectives: select,
        })
    }

    function formatCountsSummary(counts: SystemBackupCounts): string {
        const parts: string[] = []
        if (counts.movements) parts.push(`${counts.movements} حركة`)
        if (counts.custody) parts.push(`${counts.custody} صنف عهدة`)
        if (counts.contracts) parts.push(`${counts.contracts} عقد مورد بالمرفقات`)
        if (counts.disbursementRequests) parts.push(`${counts.disbursementRequests} طلب صرف`)
        if (counts.budgetPlans) parts.push(`${counts.budgetPlans} بند موازنة`)
        if (counts.financialReports) parts.push(`${counts.financialReports} تقرير مالي`)
        if (counts.assetMovements) parts.push(`${counts.assetMovements} حركة أصول`)
        if (counts.supportTickets) parts.push(`${counts.supportTickets} تذكرة دعم`)
        if (counts.technicalInspections) parts.push(`${counts.technicalInspections} محضر فحص`)
        if (counts.inventorySettlements) parts.push(`${counts.inventorySettlements} تسوية جردية`)
        if (counts.purchaseRequests) parts.push(`${counts.purchaseRequests} طلب شراء`)
        if (counts.supplierQuotes) parts.push(`${counts.supplierQuotes} عرض سعر`)
        if (counts.purchaseOrders) parts.push(`${counts.purchaseOrders} أمر توريد`)
        if (counts.registrationRequests) parts.push(`${counts.registrationRequests} طلب تسجيل موظف`)
        if (counts.users) parts.push(`${counts.users} مستخدم`)
        if (counts.auditLogs) parts.push(`${counts.auditLogs} عملية تدقيق`)
        if (counts.suppliers) parts.push(`${counts.suppliers} مورد`)
        if (counts.notifications) parts.push(`${counts.notifications} إشعار`)
        if (counts.settings) parts.push('إعدادات وشعار المؤسسة')
        return parts.length > 0 ? parts.join('، ') : 'كافة البيانات المحددة'
    }

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
            setRestoreSuccessNotice(
                `✓ تم استعادة النسخة الاحتياطية بنجاح! تم استرجاع: ${formatCountsSummary(result.counts)}.`
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
            setRestoreSuccessNotice(
                `✓ تم استعادة وتحديث البيانات من سحابة Supabase بنجاح! تم جلب: ${formatCountsSummary(result.counts)}.`
            )
        } catch (err) {
            console.error('Cloud restore error:', err)
            setRestoreError(err instanceof Error ? err.message : 'تعذر إتمام الاستعادة من Supabase.')
        } finally {
            setIsRestoringCloud(false)
        }
    }

    async function handleExecuteAutoRecoveryRestore() {
        if (!isSystemAdmin) return
        setIsRestoringAuto(true)
        setRestoreError('')
        setRestoreSuccessNotice('')

        try {
            const result = await restoreFromAutoRecovery(session)
            setRestoreSuccessNotice(
                `✓ تم استعادة البيانات من أحدث لقطة تعافي تلقائية بنجاح! تم استرجاع: ${formatCountsSummary(result.counts)}.`
            )
        } catch (err) {
            console.error('Auto recovery restore error:', err)
            setRestoreError(err instanceof Error ? err.message : 'تعذر إتمام الاستعادة التلقائية.')
        } finally {
            setIsRestoringAuto(false)
        }
    }

    async function handleCloudBackup() {
        if (!isSystemAdmin) return
        setCloudBackupError('')
        setCloudBackupNotice('')
        setIsBackingUpCloud(true)
        try {
            const result = await backupToSupabaseCloud(session, 'manual')
            setLastCloudTime(result.timestamp)
            setCloudBackupNotice(`تم النسخ السحابي الشامل بنجاح! تم حفظ ومزامنة: ${formatCountsSummary(result.counts)} في سحابة Supabase.`)
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
                `تم تنزيل النسخة الاحتياطية الشاملة (${result.fileName}) متضمنة: ${formatCountsSummary(result.counts)} بنجاح!`
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

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
        setSaveError('')
        setIsSaving(true)
        try {
            const outcome = await onSave(nextSettings)
            if (outcome && typeof outcome === 'object') {
                setPersistenceOutcome(outcome)
                if (outcome.status === 'saved_to_cloud') {
                    setSaved(true)
                    setSaveNotice('✓ تم حفظ وتطبيق كافة الإعدادات والشعار سحابياً ومحلياً بنجاح.')
                } else if (outcome.status === 'saved_locally') {
                    setSaved(true)
                    setSaveNotice(outcome.error ? `✓ تم الحفظ محلياً بنجاح (${outcome.error})` : '✓ تم حفظ الإعدادات محلياً بنجاح (في انتظار المزامنة مع السحابة).')
                } else {
                    setSaveError(outcome.error || 'تعذر حفظ الإعدادات.')
                }
            } else {
                setSaved(true)
                setSaveNotice('تم حفظ وتطبيق كافة الإعدادات والشعار بنجاح.')
            }
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.')
        } finally {
            setIsSaving(false)
        }
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
                <div className="inline-message success flex items-center justify-between gap-2 mb-4 font-sm">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 size={18} />
                        <span>{saveNotice}</span>
                    </div>
                    {persistenceOutcome?.status === 'saved_to_cloud' && (
                        <span className="badge badge-success text-xs px-2 py-0.5 rounded">محفوظ سحابياً</span>
                    )}
                    {persistenceOutcome?.status === 'saved_locally' && (
                        <div className="flex items-center gap-2">
                            <span className="badge badge-warning text-xs px-2 py-0.5 rounded">محفوظ محلياً فقط</span>
                            <button
                                type="button"
                                className="text-xs text-blue-500 underline hover:text-blue-600"
                                onClick={(e) => {
                                    e.preventDefault()
                                    void handleSubmit(e as unknown as FormEvent<HTMLFormElement>)
                                }}
                            >
                                إعادة محاولة المزامنة
                            </button>
                        </div>
                    )}
                </div>
            )}

            {saveError && (
                <div className="inline-message error flex items-center justify-between gap-2 mb-4 font-sm">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={18} />
                        <span>{saveError}</span>
                    </div>
                    <button
                        type="button"
                        className="text-xs text-red-500 underline hover:text-red-600"
                        onClick={(e) => {
                            e.preventDefault()
                            void handleSubmit(e as unknown as FormEvent<HTMLFormElement>)
                        }}
                    >
                        إعادة المحاولة
                    </button>
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
                            <button type="submit" className="primary-btn" disabled={isSaving}>
                                <Save size={17} /> {isSaving ? 'جارٍ الحفظ والمزامنة...' : 'حفظ بيانات المؤسسة'}
                            </button>
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

                                {/* 3. Automatic Real-Time Auto-Backup Card */}
                                <div className="backup-card auto-backup-card border border-emerald-500/30 bg-emerald-500/5">
                                    <div className="backup-card-head">
                                        <div className="backup-card-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                                            <Sparkles size={24} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4>الربط والنسخ التلقائي الشامل (Real-Time Auto-Backup)</h4>
                                                <span className="badge badge-success text-[10px] px-2 py-0.5 rounded-full font-bold">
                                                    {autoBackupEnabled ? '● نشط وتلقائي' : 'متوقف'}
                                                </span>
                                            </div>
                                            <span className="backup-card-desc">
                                                نظام المراقبة الحية يربط كل التعديلات والإضافات المستقبلية في جميع صفحات ووحدات النظام تلقائياً (حركات، عهد، عقود، مشتريات، محاضر جرد وفحص، تقارير، مستخدمين) ويولد لقطة تعافي فورية ومزامنة سحابية هادئة.
                                            </span>
                                        </div>
                                    </div>

                                    <div className="backup-card-meta">
                                        <Clock size={14} />
                                        <span>آخر مزامنة ونسخ تلقائي: <strong>{formatBackupTimestamp(lastAutoTime)}</strong></span>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-lg bg-surface-subtle border border-border/40 text-xs">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 size={15} className="text-emerald-500" />
                                            <span>الربط التلقائي لكل عملية إضافة أو تعديل جديدة بالنظام</span>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={autoBackupEnabled}
                                                onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                                            />
                                            <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                                        </label>
                                    </div>
                                </div>

                                {/* 4. Scheduled Backup Planner Card */}
                                <div className="backup-card auto-backup-card border border-blue-500/30 bg-blue-500/5 mt-4">
                                    <div className="backup-card-head">
                                        <div className="backup-card-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
                                            <Calendar size={24} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4>جدول ومواعيد النسخ الاحتياطي التلقائي (Scheduled Planner)</h4>
                                                <span className={`badge text-[10px] px-2 py-0.5 rounded-full font-bold ${scheduleConfig.enabled ? 'badge-success bg-blue-600 text-white' : 'badge-neutral'}`}>
                                                    {scheduleConfig.enabled ? 'مجدول ونشط' : 'الجدولة معطلة'}
                                                </span>
                                            </div>
                                            <span className="backup-card-desc">
                                                حدد اليوم والساعة المناسبة لمؤسستك ليقوم النظام بأخذ نسخة احتياطية شاملة تلقائياً في الموعد المحدد.
                                            </span>
                                        </div>
                                    </div>

                                    {scheduleSavedNotice && (
                                        <div className="inline-message success font-sm my-1">
                                            <CheckCircle2 size={16} />
                                            <span>{scheduleSavedNotice}</span>
                                        </div>
                                    )}

                                    {/* Next Run Banner */}
                                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-subtle border border-blue-500/20 text-xs">
                                        <div className="flex items-center gap-2.5">
                                            <Clock size={16} className="text-blue-500 shrink-0" />
                                            <div>
                                                <span className="text-muted-foreground block text-[11px]">موعد النسخ الاحتياطي التلقائي القادم:</span>
                                                <strong className="text-sm text-foreground mt-0.5 block">
                                                    {formatNextScheduledRunArabic(computeNextScheduledRun(scheduleConfig))}
                                                </strong>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer shrink-0" title="تفعيل / تعطيل الجدولة الزمنية">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={scheduleConfig.enabled}
                                                onChange={(e) => handleSaveSchedule({ ...scheduleConfig, enabled: e.target.checked })}
                                            />
                                            <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                    </div>

                                    {scheduleConfig.enabled && (
                                        <div className="mt-3 flex flex-col gap-3.5 border-t border-border/30 pt-3 text-xs">
                                            {/* Mode selection */}
                                            <div>
                                                <label className="font-semibold block mb-1.5 text-foreground">طريقة عمل النسخ الاحتياطي:</label>
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSchedule({ ...scheduleConfig, mode: 'realtime_and_scheduled' })}
                                                        className={`p-2.5 rounded-lg border text-right transition-all flex flex-col gap-1 ${scheduleConfig.mode === 'realtime_and_scheduled' ? 'border-blue-500 bg-blue-500/10 font-bold text-blue-400' : 'border-border/50 bg-surface hover:bg-surface-hover'}`}
                                                    >
                                                        <span>نسخ فوري + مجدول (موصى به)</span>
                                                        <span className="text-[10px] opacity-75 font-normal">لقطة فورية عند التعديل + نسخة شاملة في الموعد المجدول</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSchedule({ ...scheduleConfig, mode: 'scheduled_only' })}
                                                        className={`p-2.5 rounded-lg border text-right transition-all flex flex-col gap-1 ${scheduleConfig.mode === 'scheduled_only' ? 'border-blue-500 bg-blue-500/10 font-bold text-blue-400' : 'border-border/50 bg-surface hover:bg-surface-hover'}`}
                                                    >
                                                        <span>نسخ مجدول فقط (بالساعة)</span>
                                                        <span className="text-[10px] opacity-75 font-normal">نسخ فقط في اليوم والساعة المحددة دون نسخ فوري مستمر</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSchedule({ ...scheduleConfig, mode: 'realtime_only' })}
                                                        className={`p-2.5 rounded-lg border text-right transition-all flex flex-col gap-1 ${scheduleConfig.mode === 'realtime_only' ? 'border-blue-500 bg-blue-500/10 font-bold text-blue-400' : 'border-border/50 bg-surface hover:bg-surface-hover'}`}
                                                    >
                                                        <span>نسخ فوري فقط</span>
                                                        <span className="text-[10px] opacity-75 font-normal">نسخ فوري لحظي فقط عند حفظ الحركات وتعديل البيانات</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {scheduleConfig.mode !== 'realtime_only' && (
                                                <>
                                                    {/* Time picker */}
                                                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-border/40">
                                                        <div>
                                                            <span className="font-semibold block text-foreground">وقت تنفيذ النسخة الاحتياطية:</span>
                                                            <span className="text-muted-foreground text-[11px]">حدد الساعة والدقيقة التي يبدأ فيها النسخ التلقائي</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="time"
                                                                value={scheduleConfig.time || '23:00'}
                                                                onChange={(e) => handleSaveSchedule({ ...scheduleConfig, time: e.target.value })}
                                                                className="input-field text-center font-bold text-sm px-3 py-1.5 rounded-md border border-border bg-background focus:ring-1 focus:ring-blue-500"
                                                                style={{ minWidth: '120px' }}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Frequency selection */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <label className="font-semibold text-foreground">أيام الأسبوع المحددة للنسخ:</label>
                                                            <div className="flex gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveSchedule({ ...scheduleConfig, frequency: 'daily', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })}
                                                                    className={`px-2 py-0.5 rounded text-[11px] font-medium border ${scheduleConfig.daysOfWeek.length === 7 ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-muted-foreground'}`}
                                                                >
                                                                    يومياً (كل الأيام)
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveSchedule({ ...scheduleConfig, frequency: 'custom_days', daysOfWeek: [6, 0, 1, 2, 3, 4] })}
                                                                    className={`px-2 py-0.5 rounded text-[11px] font-medium border ${scheduleConfig.daysOfWeek.length === 6 && !scheduleConfig.daysOfWeek.includes(5) ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface border-border text-muted-foreground'}`}
                                                                >
                                                                    أيام العمل (السبت - الخميس)
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Days buttons */}
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {ARABIC_DAYS_OF_WEEK.map((day) => {
                                                                const isSelected = scheduleConfig.daysOfWeek?.includes(day.value)
                                                                return (
                                                                    <button
                                                                        key={day.value}
                                                                        type="button"
                                                                        onClick={() => toggleDayOfWeek(day.value)}
                                                                        className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all flex items-center gap-1.5 ${isSelected ? 'bg-blue-500/15 border-blue-500 text-blue-400' : 'bg-surface border-border/50 text-muted-foreground hover:bg-surface-hover'}`}
                                                                    >
                                                                        <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-blue-500' : 'bg-border'}`}></span>
                                                                        {day.label}
                                                                    </button>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
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
                                                        <span>الحركات وسجل المخزن</span>
                                                        <strong>{parsedBackup.metadata.counts.movements || 0} حركة</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>أصناف العهدة</span>
                                                        <strong>{parsedBackup.metadata.counts.custody || 0} صنف</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>عقود الموردين والمرفقات</span>
                                                        <strong>{parsedBackup.metadata.counts.contracts || 0} عقد</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>طلبات الصرف الداخلي</span>
                                                        <strong>{parsedBackup.metadata.counts.disbursementRequests || 0} طلب</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>الميزانية والتخطيط</span>
                                                        <strong>{parsedBackup.metadata.counts.budgetPlans || 0} بند</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>التقارير المالية الدورية</span>
                                                        <strong>{parsedBackup.metadata.counts.financialReports || 0} تقرير</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>سجل حركة الأصول</span>
                                                        <strong>{parsedBackup.metadata.counts.assetMovements || 0} أصل</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>تذاكر وبلاغات الدعم</span>
                                                        <strong>{parsedBackup.metadata.counts.supportTickets || 0} تذكرة</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>محاضر الفحص الفني</span>
                                                        <strong>{parsedBackup.metadata.counts.technicalInspections || 0} محضر</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>محاضر التسوية الجردية</span>
                                                        <strong>{parsedBackup.metadata.counts.inventorySettlements || 0} تسوية</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>المستخدمون وحسابات الدخول</span>
                                                        <strong>{parsedBackup.metadata.counts.users || 0} مستخدم</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>سجل العمليات والتدقيق</span>
                                                        <strong>{parsedBackup.metadata.counts.auditLogs || 0} عملية</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>الموردون والشركات</span>
                                                        <strong>{parsedBackup.metadata.counts.suppliers || 0} مورد</strong>
                                                    </div>
                                                    <div className="restore-stat-item">
                                                        <span>المؤسسة والعملة</span>
                                                        <strong>{parsedBackup.metadata.organization} ({parsedBackup.metadata.currency})</strong>
                                                    </div>
                                                </div>

                                                <div className="border-top-line">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="font-xs font-semibold text-ink block">
                                                            حدد البيانات التي ترغب في استعادتها من النسخة الاحتياطية:
                                                        </span>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                className="text-xs text-primary underline hover:opacity-80"
                                                                onClick={() => toggleAllRestoreOptions(true)}
                                                            >
                                                                تحديد الكل
                                                            </button>
                                                            <span className="text-muted text-xs">|</span>
                                                            <button
                                                                type="button"
                                                                className="text-xs text-muted underline hover:text-foreground"
                                                                onClick={() => toggleAllRestoreOptions(false)}
                                                            >
                                                                إلغاء التحديد
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="restore-options-grid">
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreMovements}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreMovements: e.target.checked })}
                                                            />
                                                            سجل الحركات ({parsedBackup.metadata.counts.movements || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreCustody}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreCustody: e.target.checked })}
                                                            />
                                                            أصناف العهدة ({parsedBackup.metadata.counts.custody || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreContracts}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreContracts: e.target.checked })}
                                                            />
                                                            عقود الموردين والمرفقات ({parsedBackup.metadata.counts.contracts || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreDisbursementRequests}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreDisbursementRequests: e.target.checked })}
                                                            />
                                                            طلبات الصرف الداخلي ({parsedBackup.metadata.counts.disbursementRequests || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreBudgetPlans}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreBudgetPlans: e.target.checked })}
                                                            />
                                                            الميزانية والتخطيط ({parsedBackup.metadata.counts.budgetPlans || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreFinancialReports}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreFinancialReports: e.target.checked })}
                                                            />
                                                            التقارير المالية ({parsedBackup.metadata.counts.financialReports || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreAssetMovements}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreAssetMovements: e.target.checked })}
                                                            />
                                                            سجل حركة الأصول ({parsedBackup.metadata.counts.assetMovements || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreSupportTickets}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSupportTickets: e.target.checked })}
                                                            />
                                                            تذاكر الدعم الفني ({parsedBackup.metadata.counts.supportTickets || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreTechnicalInspections}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreTechnicalInspections: e.target.checked })}
                                                            />
                                                            محاضر الفحص الفني ({parsedBackup.metadata.counts.technicalInspections || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreInventorySettlements}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreInventorySettlements: e.target.checked })}
                                                            />
                                                            محاضر التسوية الجردية ({parsedBackup.metadata.counts.inventorySettlements || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreTelegramSettings}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreTelegramSettings: e.target.checked })}
                                                            />
                                                            إعدادات بوت التيليجرام
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreNotifications}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreNotifications: e.target.checked })}
                                                            />
                                                            نظام الإشعارات والتنبيهات ({parsedBackup.metadata.counts.notifications || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreUsers}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreUsers: e.target.checked })}
                                                            />
                                                            المستخدمون وحسابات الدخول ({parsedBackup.metadata.counts.users || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreAuditLogs}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreAuditLogs: e.target.checked })}
                                                            />
                                                            سجل العمليات والتدقيق ({parsedBackup.metadata.counts.auditLogs || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreSuppliers}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSuppliers: e.target.checked })}
                                                            />
                                                            سجل الموردين المعتمدين ({parsedBackup.metadata.counts.suppliers || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreSettings}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSettings: e.target.checked })}
                                                            />
                                                            إعدادات وشعار المؤسسة
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restorePurchaseRequests}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restorePurchaseRequests: e.target.checked })}
                                                            />
                                                            طلبات الشراء والبنود ({parsedBackup.metadata.counts.purchaseRequests || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreSupplierQuotes}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreSupplierQuotes: e.target.checked })}
                                                            />
                                                            عروض أسعار الموردين ({parsedBackup.metadata.counts.supplierQuotes || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restorePurchaseOrders}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restorePurchaseOrders: e.target.checked })}
                                                            />
                                                            أوامر الشراء والتوريد ({parsedBackup.metadata.counts.purchaseOrders || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreRegistrationRequests}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreRegistrationRequests: e.target.checked })}
                                                            />
                                                            طلبات تسجيل الموظفين ({parsedBackup.metadata.counts.registrationRequests || 0})
                                                        </label>
                                                        <label className="restore-checkbox-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!restoreOptions.restoreChatbotDirectives}
                                                                onChange={(e) => setRestoreOptions({ ...restoreOptions, restoreChatbotDirectives: e.target.checked })}
                                                            />
                                                            توجيهات المساعد الذكي للمخازن
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

                                    {/* 3. Hot Auto-Recovery Snapshot Restore Card */}
                                    <div className="backup-card auto-backup-card">
                                        <div className="backup-card-head">
                                            <div className="backup-card-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                                                <Sparkles size={24} />
                                            </div>
                                            <div>
                                                <h4>استعادة من لقطة التعافي التلقائية (Hot Auto-Recovery)</h4>
                                                <span className="backup-card-desc">
                                                    استرجاع فوري لآخر لقطة تم حفظها تلقائياً عند آخر تعديل أو إضافة تم تسجيلها في أي صفحة من صفحات النظام.
                                                </span>
                                            </div>
                                        </div>

                                        <div className="backup-card-meta">
                                            <Clock size={14} />
                                            <span>آخر لقطة تلقائية: <strong>{formatBackupTimestamp(lastAutoTime)}</strong></span>
                                        </div>

                                        <div className="backup-card-actions">
                                            <button
                                                type="button"
                                                className="secondary-btn"
                                                onClick={handleExecuteAutoRecoveryRestore}
                                                disabled={isRestoringAuto}
                                                id="btn-confirm-restore-auto"
                                                title="استعادة فورية من لقطة التعافي التلقائية"
                                            >
                                                {isRestoringAuto ? (
                                                    <>
                                                        <RefreshCw size={16} className="spin-animation" />
                                                        <span>جارٍ استرجاع اللقطة...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <RotateCcw size={16} />
                                                        <span>استعادة لقطة التعافي التلقائية</span>
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

                {/* 5. Real-Time Google Sheets Sync Section */}
                <section className="card-surface settings-section google-sheets-sync-section">
                    <div className="section-head">
                        <div>
                            <h3>
                                <FileSpreadsheet size={18} className="text-emerald-500" /> المزامنة اللحظية مع Google Sheets
                            </h3>
                            <span>
                                تصدير حركات المخازن فور تسجيلها في المنظومة تلقائياً إلى شيت جوجل المركزي المعتمد (AppSheet_DB).
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`badge text-[10px] px-2.5 py-1 rounded-full font-bold ${sheetsWebhook.trim() ? 'badge-success bg-emerald-600 text-white' : 'badge-neutral'}`}>
                                {sheetsWebhook.trim() ? '● المزامنة اللحظية مفعلة' : 'المزامنة متوقفة (أدخل الرابط)'}
                            </span>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-4">
                        <div className="space-y-1">
                            <label className="font-semibold text-sm block text-foreground">
                                رابط تطبيق الويب للـ Google Apps Script (Webhook URL):
                            </label>
                            <span className="text-xs text-muted-foreground block">
                                الرابط الذي حصلت عليه بعد نشر السكريبت داخل الشيت كـ Web App ينتهي بـ <code>/exec</code>:
                            </span>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                dir="ltr"
                                type="url"
                                value={sheetsWebhook}
                                onChange={(e) => setSheetsWebhook(e.target.value)}
                                placeholder="https://script.google.com/macros/s/.../exec"
                                className="input-field flex-1 text-xs font-mono p-2.5 rounded-lg border border-border bg-background"
                                disabled={!isSystemAdmin}
                            />
                            {isSystemAdmin && (
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleSaveSheetsWebhook}
                                        className="primary-btn nowrap px-4 py-2"
                                    >
                                        <Save size={16} /> حفظ الرابط
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleTestSheet}
                                        disabled={isTestingSheet || !sheetsWebhook.trim()}
                                        className="secondary-btn nowrap px-4 py-2"
                                        title="إرسال حركة تجريبية للتأكد من وصولها إلى الشيت فوراً"
                                    >
                                        {isTestingSheet ? (
                                            <>
                                                <RefreshCw size={15} className="spin-animation" />
                                                <span>جارٍ الاختبار...</span>
                                            </>
                                        ) : (
                                            <>
                                                <ExternalLink size={15} />
                                                <span>اختبار الربط</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        {sheetsSavedNotice && (
                            <div className="inline-message success font-xs my-1 flex items-center gap-2">
                                <CheckCircle2 size={16} />
                                <span>{sheetsSavedNotice}</span>
                            </div>
                        )}

                        {sheetTestOutcome && (
                            <div className={`inline-message ${sheetTestOutcome.status === 'success' ? 'success' : 'error'} font-xs my-1 flex items-center gap-2`}>
                                {sheetTestOutcome.status === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                                <span>{sheetTestOutcome.message}</span>
                            </div>
                        )}

                        <div className="text-[11px] text-muted-foreground bg-surface p-3 rounded-lg border border-border/40 space-y-1">
                            <strong className="block text-foreground">💡 كيف تعمل المزامنة اللحظية؟</strong>
                            <p>
                                بمجرد تسجيل أو حفظ أي حركة جديدة (إضافة رصيد، توريد، صرف إذن عهدة) في أي مخزن، يرسلها النظام في الخلفية خلال أجزاء من الثانية إلى تبويب <code>AppSheet_DB</code>، فتقوم معادلات الشيت بتحديث كشف الكلية المعنية والأرصدة ولوحة المؤشرات تلقائياً.
                            </p>
                        </div>
                    </div>
                </section>
            </form>
        </section>
    )
}