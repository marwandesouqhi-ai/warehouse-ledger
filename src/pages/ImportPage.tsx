import { useState, type ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, RotateCcw, ShieldAlert } from 'lucide-react'

import type { FixtureMovement } from '../lib/fixture'
import { parseMovementRows } from '../lib/importRows'
import { normalizeHeader } from '../lib/parse'
import { canEditInventory } from '../lib/supabase'

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
    const canEdit = canEditInventory(session)
    const [preview, setPreview] = useState<FixtureMovement[]>([])
    const [fileName, setFileName] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [isReading, setIsReading] = useState(false)
    const [isImporting, setIsImporting] = useState(false)

    if (!canEdit) {
        return (
            <section className="page-stack import-page">
                <header className="page-intro">
                    <div className="page-intro-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--bad, #ef4444)' }}>
                        <ShieldAlert size={22} />
                    </div>
                    <div>
                        <p className="eyebrow" style={{ color: 'var(--bad, #ef4444)' }}>صلاحية وصول مقيدة</p>
                        <h2>استيراد حركات المخزن من Excel</h2>
                        <p>خاص ومقتصر على المحررين ومديري النظام لإضافة وتحديث بيانات المخزن.</p>
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
                        صلاحية العرض فقط (Viewer)
                    </h3>
                    <p style={{ color: 'var(--muted)', fontSize: '0.92rem', lineHeight: '1.6', margin: '0 0 24px 0' }}>
                        عذراً، استيراد وتعديل حركات المخزن متاح حصرياً لحسابات <strong>المحررين (Editors)</strong> و<strong>مديري النظام (Admins)</strong>. حسابك الحالي يملك صلاحية المشاهدة والاستعراض فقط.
                    </p>
                </div>
            </section>
        )
    }

    async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return

        setError('')
        setNotice('')
        setPreview([])
        setFileName(file.name)
        setIsReading(true)

        try {
            const XLSX = await import('xlsx')
            const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            if (!firstSheet) throw new Error('الملف لا يحتوي على ورقة عمل.')

            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true })
            const parsedRows = parseMovementRows(normalizeExcelDates(rows, XLSX))
            if (parsedRows.length === 0) throw new Error('لم أجد صفوفًا تحتوي على أسماء أصناف.')

            setPreview(parsedRows)
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : 'تعذر قراءة الملف. تأكد من صيغة Excel.')
        } finally {
            setIsReading(false)
            event.target.value = ''
        }
    }

    async function confirmImport() {
        setError('')
        setIsImporting(true)
        try {
            const result = await onImport(preview)
            setNotice(`تمت الإضافة: ${result.added.toLocaleString('ar-EG')} حركة. الصفوف المكررة التي تم تخطيها: ${result.skipped.toLocaleString('ar-EG')}.`)
            setPreview([])
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
            const sampleRows = [
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
                {
                    'الصنف': 'طابعات ليزر شبكية HP LaserJet',
                    'التاريخ': '2026-10-09',
                    'المورد': 'شركة النيل للحلول المكتبية',
                    'المستلم': 'إدارة الشؤون المالية',
                    'الوارد': 5,
                    'المنصرف': 2,
                    'السعر': 8900,
                    'رقم الفاتورة': 'INV-5542',
                    'رقم الاذن': 'PRM-112',
                    'تاريخ الصرف': '2026-10-09',
                    'ملاحظات': 'توريد وصرف فوري للقطاع المالي',
                },
            ]

            const worksheet = XLSX.utils.json_to_sheet(sampleRows)
            const workbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(workbook, worksheet, 'حركات المخزن')
            XLSX.writeFile(workbook, 'نموذج_استيراد_حركات_المخزن.xlsx')
        } catch (err) {
            console.error('Failed to download template:', err)
        }
    }

    return (
        <section className="page-stack import-page">
            <header className="page-intro">
                <div className="page-intro-icon"><FileSpreadsheet size={22} /></div>
                <div>
                    <p className="eyebrow">إدارة البيانات</p>
                    <h2>استيراد الحركات</h2>
                    <p>ارفع ملف Excel، راجع معاينة الصفوف، ثم أضفها إلى السجل الحالي.</p>
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