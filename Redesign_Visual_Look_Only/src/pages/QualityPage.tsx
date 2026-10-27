import { useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Info, Search, ShieldAlert, X } from 'lucide-react'

import type { FixtureMovement } from '../lib/fixture'
import { evaluateQuality } from '../lib/quality'
import { matchesSearch } from '../lib/searchUtils'

type QualityPageProps = {
  movements: FixtureMovement[]
  onInspect: (item: string) => void
}

const ruleLabels: Record<string, string> = {
  future: 'تاريخ وارد لاحق',
  order: 'ترتيب تواريخ غير منطقي',
  noqty: 'تاريخ صرف بلا كمية',
  noto: 'بيانات صرف ناقصة',
  over: 'صرف يتجاوز الوارد',
  baddate: 'تاريخ غير صالح',
  nonum: 'قيمة رقمية غير صالحة',
  ptext: 'سعر محفوظ كنص',
  noinv: 'رقم فاتورة غير مسجل',
}

const ruleMessages: Record<string, string> = {
  future: 'تاريخ الوارد بعد تاريخ اليوم.',
  order: 'تاريخ الصرف يسبق تاريخ الوارد.',
  noqty: 'يوجد تاريخ صرف لكن كمية المنصرف صفر أو غير محددة.',
  noto: 'كمية منصرفة دون تحديد المستلم أو رقم الإذن.',
  over: 'كمية المنصرف أكبر من كمية الوارد.',
  baddate: 'تعذر قراءة التاريخ المدخل.',
  nonum: 'السعر أو الكمية لا يحتوي على قيمة رقمية قابلة للحساب.',
  ptext: 'القيمة مخزنة كنص ويمكن تحويلها رقميًا.',
  noinv: 'رقم الفاتورة غير موجود في الحركة.',
}

export default function QualityPage({ movements, onInspect }: QualityPageProps) {
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const findings = movements.flatMap((movement) => evaluateQuality(movement as unknown as Record<string, unknown>)
    .map((finding) => ({ movement, finding })))
  const counts = {
    error: findings.filter(({ finding }) => finding.level === 'error').length,
    warn: findings.filter(({ finding }) => finding.level === 'warn').length,
    info: findings.filter(({ finding }) => finding.level === 'info').length,
  }

  const visibleFindings = findings.filter(({ movement, finding }) => {
    if (filter !== 'all' && finding.level !== filter) return false
    if (searchTerm.trim()) {
      return matchesSearch(
        [
          movement.item,
          movement.from,
          movement.to,
          ruleLabels[finding.rule],
          ruleMessages[finding.rule],
          finding.message,
          movement.date,
        ],
        searchTerm
      )
    }
    return true
  })

  return (
    <section className="page-stack quality-page">
      <header className="page-intro">
        <div className="page-intro-icon warning"><ShieldAlert size={22} /></div>
        <div>
          <p className="eyebrow">مراجعة السجل</p>
          <h2>مركز جودة البيانات</h2>
          <p>تنبيهات محسوبة مباشرة من الحركات المسجلة.</p>
        </div>
      </header>

      <div className="quality-summary-grid">
        <div className="quality-summary error"><AlertCircle size={18} /><span>أخطاء</span><strong>{counts.error.toLocaleString('ar-EG')}</strong></div>
        <div className="quality-summary warn"><ShieldAlert size={18} /><span>تحذيرات</span><strong>{counts.warn.toLocaleString('ar-EG')}</strong></div>
        <div className="quality-summary info"><Info size={18} /><span>ملاحظات</span><strong>{counts.info.toLocaleString('ar-EG')}</strong></div>
      </div>

      <section className="card-surface quality-findings">
        <div className="section-head quality-findings-head" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3>نتائج الفحص</h3>
            <span>{visibleFindings.length.toLocaleString('ar-EG')} تنبيه مطابق</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: '220px' }}>
              <Search size={15} style={{ position: 'absolute', right: '10px', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث في التنبيهات والأصناف..."
                style={{
                  padding: '7px 32px 7px 28px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--ink)',
                  fontSize: '0.85rem',
                  width: '100%'
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{ position: 'absolute', left: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
                  title="مسح البحث"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <label className="filter-select-label" style={{ margin: 0 }}>
              <span>نوع النتيجة</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="تصفية نتائج الجودة">
                <option value="all">كل النتائج</option>
                <option value="error">الأخطاء</option>
                <option value="warn">التحذيرات</option>
                <option value="info">الملاحظات</option>
              </select>
            </label>
          </div>
        </div>

        {visibleFindings.length === 0 ? (
          <div className="quality-empty"><CheckCircle2 size={24} /><strong>لا توجد نتائج في هذا التصنيف</strong></div>
        ) : (
          <div className="movement-table-wrap">
            <table className="quality-table">
              <thead><tr><th>الدرجة</th><th>الصنف</th><th>القاعدة</th><th>التفاصيل</th><th>التاريخ</th><th>إجراء</th></tr></thead>
              <tbody>
                {visibleFindings.map(({ movement, finding }) => (
                  <tr key={finding.id}>
                    <td><span className={`quality-level ${finding.level}`}>{finding.level === 'error' ? 'خطأ' : finding.level === 'warn' ? 'تحذير' : 'ملاحظة'}</span></td>
                    <td>{movement.item || '—'}</td>
                    <td>{ruleLabels[finding.rule] ?? finding.rule}</td>
                    <td>{ruleMessages[finding.rule] ?? finding.message}</td>
                    <td>{movement.date || '—'}</td>
                    <td><button type="button" className="text-action" onClick={() => onInspect(movement.item)}>عرض الحركة <ArrowLeft size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}