import { isSystemAdmin } from '../lib/permissions'
import { useState, useMemo } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'

import type { Session } from '@supabase/supabase-js'
import type { FixtureMovement } from '../lib/fixture'
import { evaluateLedgerQuality, type QualityFinding } from '../lib/quality'
import { matchesSearch } from '../lib/searchUtils'
import { runDataQualityAutoRepair } from '../lib/dataQualityAutoRepair'

type QualityPageProps = {
  movements: FixtureMovement[]
  onInspect: (item: string) => void
  session?: Session | null
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

export default function QualityPage({ movements, onInspect, session }: QualityPageProps) {
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isRepairing, setIsRepairing] = useState(false)
  const [repairNotice, setRepairNotice] = useState('')

  const findings: Array<{ movement: FixtureMovement; finding: QualityFinding }> = useMemo(() => {
    return evaluateLedgerQuality(movements as unknown as Array<Record<string, unknown>>).flatMap(
      ({ row, findings: rowFindings }) =>
        rowFindings.map((finding) => ({
          movement: row as unknown as FixtureMovement,
          finding,
        }))
    )
  }, [movements])

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

  const handleAutoRepair = async () => {
    if (!isSystemAdmin(session)) return
    setIsRepairing(true)
    try {
      const res = await runDataQualityAutoRepair(session?.user?.id)
      setRepairNotice(res.message)
    } catch (err: unknown) {
      console.error('Quality auto-repair failed:', err)
      setRepairNotice('حدث خطأ أثناء تشغيل أداة الإصلاح الذاتي.')
    } finally {
      setIsRepairing(false)
    }
  }

  return (
    <section className="page-stack quality-page">
      <header className="page-intro">
        <div className="page-intro-icon warning">
          <ShieldAlert size={22} />
        </div>
        <div>
          <p className="eyebrow">مراجعة السجل</p>
          <h2>مركز جودة البيانات</h2>
          <p>تنبيهات محسوبة مباشرة من الحركات المسجلة.</p>
        </div>
        <div className="headline-actions mr-auto flex gap-2">
          <button hidden={!isSystemAdmin(session)}
            type="button"
            className="primary-btn flex items-center gap-2"
            onClick={handleAutoRepair}
            disabled={isRepairing || findings.length === 0}
            title="تشغيل أداة الإصلاح الذاتي لمعالجة الأسعار المحفوظة كنص وتوليد الفواتير الناقصة"
          >
            <Sparkles size={16} className={isRepairing ? 'animate-spin' : ''} />
            <span>{isRepairing ? 'جارٍ الإصلاح الذاتي...' : 'إصلاح جميع المشاكل آلياً 🛠️'}</span>
          </button>
        </div>
      </header>

      {repairNotice && (
        <div className="inline-message success flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} />
            <span>{repairNotice}</span>
          </div>
          <button type="button" className="input-action-btn" onClick={() => setRepairNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="quality-summary-grid">
        <div className="quality-summary error">
          <AlertCircle size={18} />
          <span>أخطاء</span>
          <strong>{counts.error === 0 ? '0' : counts.error.toLocaleString('ar-EG')}</strong>
        </div>
        <div className="quality-summary warn">
          <ShieldAlert size={18} />
          <span>تحذيرات</span>
          <strong>{counts.warn === 0 ? '0' : counts.warn.toLocaleString('ar-EG')}</strong>
        </div>
        <div className="quality-summary info">
          <Info size={18} />
          <span>ملاحظات</span>
          <strong>{counts.info === 0 ? '0' : counts.info.toLocaleString('ar-EG')}</strong>
        </div>
      </div>

      <section className="card-surface quality-findings">
        <div className="section-head quality-findings-head flex-wrap gap-3">
          <div>
            <h3>نتائج الفحص</h3>
            <span>{visibleFindings.length.toLocaleString('ar-EG')} تنبيه مطابق</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="input-search-wrap">
              <Search size={15} className="input-search-icon" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث في التنبيهات والأصناف..."
                aria-label="بحث في التنبيهات والأصناف"
                className="search-input-field w-full"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="input-action-btn"
                  title="مسح البحث"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <label className="filter-select-label m-0">
              <span>نوع النتيجة</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="تصفية نتائج الجودة"
              >
                <option value="all">كل النتائج</option>
                <option value="error">الأخطاء</option>
                <option value="warn">التحذيرات</option>
                <option value="info">الملاحظات</option>
              </select>
            </label>
          </div>
        </div>

        {visibleFindings.length === 0 ? (
          <div className="quality-empty py-12 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
            <strong className="block text-base text-foreground mb-1">
              سجل الحركات سليم 100% ولا توجد أي مشاكل أو تنبيهات!
            </strong>
            <span className="text-sm text-muted">
              تم فحص جميع قيم الأسعار، أرقام الفواتير، التواريخ، وأذون الصرف والتأكد من مطابقتها للمعايير النظامية.
            </span>
          </div>
        ) : (
          <div className="movement-table-wrap">
            <table className="quality-table">
              <thead>
                <tr>
                  <th>الدرجة</th>
                  <th>الصنف</th>
                  <th>القاعدة</th>
                  <th>التفاصيل</th>
                  <th>التاريخ</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {visibleFindings.map(({ movement, finding }) => (
                  <tr key={finding.id}>
                    <td>
                      <span className={`quality-level ${finding.level}`}>
                        {finding.level === 'error'
                          ? 'خطأ'
                          : finding.level === 'warn'
                            ? 'تحذير'
                            : 'ملاحظة'}
                      </span>
                    </td>
                    <td>{movement.item || '—'}</td>
                    <td>{ruleLabels[finding.rule] ?? finding.rule}</td>
                    <td>{ruleMessages[finding.rule] ?? finding.message}</td>
                    <td>{movement.date || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => onInspect(movement.item)}
                      >
                        عرض الحركة <ArrowLeft size={14} />
                      </button>
                    </td>
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
