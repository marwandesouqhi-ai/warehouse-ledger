import { useState, type ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, RotateCcw, ShieldAlert } from 'lucide-react'

import type { FixtureMovement } from '../lib/fixture'
import {
    validateAndClassifyMovementRows,
    generateMovementErrorReportCsv,
    MAX_IMPORT_ROWS,
    MAX_IMPORT_FILE_SIZE,
    type RowValidationError,
} from '../lib/importRows'
import { normalizeHeader } from '../lib/parse'
import { isSystemAdmin } from '../lib/permissions'
import { getDashboardScope } from '../lib/permissions'

type ImportResult = { added: number; skipped: number }

type ImportPageProps = {
    onImport: (movements: FixtureMovement[]) => Promise<ImportResult>
    session?: Session | null
}

const dateHeaders = new Set([
    'date', 'receipt date', 'issue date', 'issue', 'التاريخ', 'تاريخ الوارد', 'تاريخ', 'تاريخ الصرف',
].map(normalizeHeader))

function normalizeExcelDates(rows: Array<Record<string, unknown>>, XLSX: typeof import('xlsx')) {
    return rows.map((row) => Object.fromEntries(Object.entries(row).map(([header, value]) => {
        if (!dateHeaders.has(normalizeHeader(header))) return [header, value]
        if (value instanceof Date) {
            const year = value.getFullYear()
            const month = String(value.getMonth() + 1).padStart(2, '0')
            const day = String(value.getDate()).padStart(2, '0')
            return [header, `${year}-${month}-${day}`]
        }
        if (typeof value === 'number') return [header, XLSX.SSF.format('yyyy-mm-dd', value)]
        return [header, value]
    })))
}

export default function ImportPage({ onImport, session }: ImportPageProps) {
    const canEdit = isSystemAdmin(session)
    const scope = getDashboardScope(session)
    const [preview, setPreview] = useState<FixtureMovement[]>([])
    const [fileName, setFileName] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [isReading, setIsReading] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [validationStats, setValidationStats] = useState<{
        totalRows: number
        validCount: number
        rejectedRows: RowValidationError[]
    } | null>(null)

    if (!canEdit) {
        return (
            <section className="page-stack import-page">
                <header className="page-intro">
                    <div className="page-intro-icon modal-icon-danger">
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow text-bad">صلاحية وصول مقيدة</p>
                        <h2>استيراد حركات المخزن من Excel</h2>
                        <p>خاص ومقتصر على المحررين ومديري النظام لإضافة وتحديث بيانات المخزن.</p>
                    </div>
                </header>

                <div className="card-surface audit-restricted-card">
                    <div className="audit-restricted-icon">
                        <ShieldAlert size={34} />
                    </div>
                    <h3 className="m-0 mb-2 text-lg text-ink">
                        صلاحية العرض فقط (Viewer)
                    </h3>
                    <p className="text-muted font-sm leading-normal mb-5">
                        عذراً، استيراد وتعديل حركات المخزن متاح حصرياً لحسابات <strong>المحررين (Editors)</strong> و<strong>مديري النظام (Admins)</strong>. حسابك الحالي يملك صلاحية المشاهدة والاستعراض فقط.
                    </p>
                </div>
            </section>
        )
    }

    async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return

        if (file.size > MAX_IMPORT_FILE_SIZE) {
            setError(`حجم الملف كبير جداً (${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت). الحد الأقصى المسموح به هو 10 ميجابايت.`)
            event.target.value = ''
            return
        }

        setError('')
        setNotice('')
        setPreview([])
        setValidationStats(null)
        setFileName(file.name)
        setIsReading(true)

        try {
            const XLSX = await import('xlsx')
            const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            if (!firstSheet) throw new Error('الملف لا يحتوي على ورقة عمل.')

            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true })
            if (rows.length > MAX_IMPORT_ROWS) {
                throw new Error(`عدد صفوف الملف (${rows.length.toLocaleString('ar-EG')}) يتجاوز الحد الأقصى المسموح به (${MAX_IMPORT_ROWS.toLocaleString('ar-EG')} صف).`)
            }

            const normalized = normalizeExcelDates(rows, XLSX)
            const { validMovements, rejectedRows, totalRows } = validateAndClassifyMovementRows(normalized)

            setValidationStats({
                totalRows,
                validCount: validMovements.length,
                rejectedRows,
            })

            if (validMovements.length === 0) {
                throw new Error(rejectedRows.length > 0 ? 'لم يتم العثور على أي صف صالح للإضافة. يرجى مراجعة تقرير الأخطاء وتنزيله أدناه.' : 'لم أجد صفوفًا تحتوي على أسماء أصناف.')
            }

            setPreview(validMovements)
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر قراءة الملف. تأكد من صيغة Excel.')
        } finally {
            setIsReading(false)
            event.target.value = ''
        }
    }

    function handleDownloadErrorReport() {
        if (!validationStats || validationStats.rejectedRows.length === 0) return
        const csvContent = generateMovementErrorReportCsv(validationStats.rejectedRows)
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `تقرير-أخطاء-استيراد-الحركات-${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    async function confirmImport() {
        setError('')
        setIsImporting(true)
        try {
            const result = await onImport(preview)
            setNotice(`تمت الإضافة: ${result.added.toLocaleString('ar-EG')} حركة. الصفوف المكررة التي تم تخطيها: ${result.skipped.toLocaleString('ar-EG')}.`)
            setPreview([])
            setValidationStats(null)
            setFileName('')
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر استيراد الحركات.')
        } finally {
            setIsImporting(false)
        }
    }

    async function handleDownloadTemplate() {
        try {
            const XLSX = await import('xlsx')
            const isPurchases = scope === 'purchases_only'
            const sampleRows = isPurchases ? [
                {
                    'الصنف': 'أجهزة حاسب آلي مكتبي Lenovo Core i7',
                    'التاريخ': '2026-10-11',
                    'المورد': 'شركة تكنولوجيا المعلومات المتقدمة',
                    'المستلم': 'المخزن الرئيسي',
                    'الوارد': 25,
                    'السعر': 14500,
                    'رقم الفاتورة': 'INV-2026-901',
                    'ملاحظات': 'توريد أجهزة لمعامل الحاسب',
                },
                {
                    'الصنف': 'طابعات ليزر شبكية HP LaserJet',
                    'التاريخ': '2026-10-10',
                    'المورد': 'شركة النيل للحلول المكتبية',
                    'المستلم': 'المخزن الرئيسي',
                    'الوارد': 10,
                    'السعر': 8900,
                    'رقم الفاتورة': 'INV-2026-902',
                    'ملاحظات': 'فاتورة شراء معتمدة ومسددة',
                },
            ] : [
                {
                    'الصنف': 'أجهزة حاسب آلي مكتبي Lenovo Core i7',
                    'التاريخ': '2026-10-11',
                    'المورد': 'شركة تكنولوجيا المعلومات',
                    'المستلم': 'المخزن الرئيسي',
                    'الوارد': 25,
                    'المنصرف': '',
                    'السعر': 14500,
                    'رقم الفاتورة': 'INV-2026-901',
                    'رقم الاذن': 'PRM-441',
                    'تاريخ الصرف': '',
                    'ملاحظات': 'توريد عهدة مستديمة جديدة معتمدة',
                },
                {
                    'الصنف': 'شاشات عرض ذكية 65 بوصة 4K',
                    'التاريخ': '2026-10-10',
                    'المورد': 'المخزن الرئيسي',
                    'المستلم': 'معمل الحاسبات المركزي',
                    'الوارد': '',
                    'المنصرف': 3,
                    'السعر': 22000,
                    'رقم الفاتورة': '',
                    'رقم الاذن': 'DISP-882',
                    'تاريخ الصرف': '2026-10-10',
                    'ملاحظات': 'صرف عهدة لمعامل الكلية',
                },
            ]

            const worksheet = XLSX.utils.json_to_sheet(sampleRows)
            const workbook = XLSX.utils.book_new()
            const sheetName = isPurchases ? 'فواتير الشراء' : 'حركات المخزن'
            const fileName = isPurchases ? 'نموذج_استيراد_فواتير_المشتريات.xlsx' : 'نموذج_استيراد_حركات_المخزن.xlsx'
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
            XLSX.writeFile(workbook, fileName)
        } catch (err) {
            console.error('Failed to download template:', err)
        }
    }

    return (
        <section className="page-stack import-page">
            <header className="page-intro">
                <div className="page-intro-icon"><FileSpreadsheet size={22} /></div>
                <div>
                    <p className="eyebrow">{scope === 'purchases_only' ? 'إدارة المشتريات والتوريدات' : scope === 'warehouse_only' ? 'إدارة المخازن والتشغيل' : 'إدارة البيانات'}</p>
                    <h2>{scope === 'purchases_only' ? 'استيراد فواتير وتوريدات الشراء من Excel' : scope === 'warehouse_only' ? 'استيراد حركات وأرصدة المخزن من Excel' : 'استيراد الحركات وفواتير الشراء من Excel'}</h2>
                    <p>{scope === 'purchases_only' ? 'ارفع ملف Excel بفواتير المشتريات وبيانات الموردين، راجع المعاينة، ثم أضفها إلى السجل.' : 'ارفع ملف Excel، راجع معاينة الصفوف، ثم أضفها إلى السجل الحالي.'}</p>
                </div>
            </header>

            <label className="import-dropzone">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} disabled={isReading} />
                <span className="dropzone-icon"><FileUp size={23} /></span>
                <strong>{isReading ? 'جارٍ قراءة الملف...' : fileName || 'اختر ملف Excel للاستيراد'}</strong>
                <span>{isReading ? 'يتم تجهيز المعاينة' : 'الصيغ المدعومة: XLSX وXLS وCSV'}</span>
                <span className="secondary-btn import-select">اختيار ملف</span>
            </label>

            {error && <div className="inline-message error"><AlertCircle size={18} />{error}</div>}
            {notice && <div className="inline-message success"><CheckCircle2 size={18} />{notice}</div>}

            {validationStats && (
                <div className="card-surface p-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <span>إجمالي صفوف الملف: <strong>{validationStats.totalRows.toLocaleString('ar-EG')}</strong></span>
                            <span className="text-good font-bold">المقبولة: {validationStats.validCount.toLocaleString('ar-EG')}</span>
                            {validationStats.rejectedRows.length > 0 && (
                                <span className="text-bad font-bold">المرفوضة: {validationStats.rejectedRows.length.toLocaleString('ar-EG')}</span>
                            )}
                        </div>
                        {validationStats.rejectedRows.length > 0 && (
                            <button
                                type="button"
                                className="secondary-btn btn-sm"
                                onClick={handleDownloadErrorReport}
                                title="تحميل تقرير تفصيلي بأرقام الصفوف وأسباب الرفض بصيغة CSV"
                            >
                                <Download size={15} /> تحميل تقرير الصفوف المرفوضة ({validationStats.rejectedRows.length.toLocaleString('ar-EG')})
                            </button>
                        )}
                    </div>
                </div>
            )}

            {preview.length > 0 && (
                <section className="card-surface import-preview">
                    <div className="section-head import-preview-head">
                        <div>
                            <h3>معاينة قبل الدمج</h3>
                            <span>{preview.length.toLocaleString('ar-EG')} صف صالح للإضافة، والسجل الحالي لن يُستبدل</span>
                        </div>
                        <div className="headline-actions">
                            <button type="button" className="secondary-btn" onClick={() => { setPreview([]); setFileName('') }}>
                                <RotateCcw size={16} /> اختيار ملف آخر
                            </button>
                            <button type="button" className="primary-btn" onClick={() => { void confirmImport() }} disabled={isImporting}>
                                <CheckCircle2 size={17} /> {isImporting ? 'جارٍ الحفظ...' : 'دمج في السجل'}
                            </button>
                        </div>
                    </div>
                    <div className="movement-table-wrap">
                        <table>
                            <thead>
                                <tr><th>التاريخ</th><th>الصنف</th><th>المورد</th><th>المستلم</th><th>الوارد</th><th>المنصرف</th><th>السعر</th></tr>
                            </thead>
                            <tbody>
                                {preview.slice(0, 8).map((movement: FixtureMovement) => (
                                    <tr key={movement.id}>
                                        <td>{movement.date || '—'}</td>
                                        <td>{movement.item}</td>
                                        <td>{movement.from || '—'}</td>
                                        <td>{movement.to || '—'}</td>
                                        <td>{movement.qin || '—'}</td>
                                        <td>{movement.qout || '—'}</td>
                                        <td>{movement.price || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {preview.length > 8 && <p className="preview-footnote">تظهر أول 8 صفوف من المعاينة؛ سيتم دمج الصفوف كلها.</p>}
                </section>
            )}

            {/* بطاقة تحميل نموذج Excel الجاهز للاستيراد */}
            <div className="card-surface template-download-banner">
                <div className="template-banner-info">
                    <div className="template-banner-icon">
                        <FileSpreadsheet size={24} />
                    </div>
                    <div>
                        <h3 className="template-banner-title">نموذج Excel جاهز للاستيراد</h3>
                        <p className="template-banner-desc">
                            حمّل النموذج المعتمد المجهّز بكافة الأعمدة المطلوبة، املأ بياناتك فيه، ثم ارفعه هنا مباشرة.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    className="primary-btn template-download-btn"
                    onClick={() => void handleDownloadTemplate()}
                    title="تحميل ملف Excel استرشادي جاهز يحتوي على الأعمدة وأمثلة للتعبئة"
                    id="btn-download-import-template"
                >
                    <Download size={18} /> تحميل نموذج Excel جاهز (.xlsx)
                </button>
            </div>
        </section>
    )
}