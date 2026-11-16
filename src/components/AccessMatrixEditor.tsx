import { MATRIX_PAGES, type AccessAction, type AccessMatrix, type PageAccess } from '../lib/permissions'

type Props = {
  value: AccessMatrix | null
  onChange: (next: AccessMatrix | null) => void
  disabled?: boolean
}

const ACTIONS: Array<{ key: AccessAction; label: string }> = [
  { key: 'view', label: 'عرض' },
  { key: 'create', label: 'إضافة' },
  { key: 'update', label: 'تعديل' },
  { key: 'delete', label: 'حذف' },
]

function emptyMatrix(): AccessMatrix {
  return { v: 1, pages: {} }
}

/** مصفوفة صلاحيات المستخدم: الصفحات والتبويبات والإضافة/التعديل/الحذف. يحددها مدير النظام فقط. */
export default function AccessMatrixEditor({ value, onChange, disabled }: Props) {
  const customized = value !== null

  function setPage(key: string, patch: Partial<PageAccess>) {
    const base = value ?? emptyMatrix()
    const current: PageAccess = base.pages[key] ?? {}
    const next: PageAccess = { ...current, ...patch }
    if (!next.view) { next.create = next.update = next.delete = false }
    onChange({ v: 1, pages: { ...base.pages, [key]: next } })
  }

  function toggleTab(key: string, tab: string, allTabs: string[], on: boolean) {
    const current = value?.pages[key]?.tabs ?? allTabs
    const next = on ? Array.from(new Set([...current, tab])) : current.filter((t) => t !== tab)
    setPage(key, { tabs: next })
  }

  return (
    <fieldset className="access-matrix" disabled={disabled}>
      <legend className="access-matrix-title">صلاحيات الصفحات والإجراءات</legend>

      <label className="access-matrix-toggle">
        <input
          type="checkbox"
          checked={customized}
          onChange={(e) => onChange(e.target.checked ? emptyMatrix() : null)}
        />
        <span>تخصيص الصلاحيات لهذا المستخدم يدويًا</span>
      </label>
      <p className="access-matrix-hint">
        {customized
          ? 'لا يرى المستخدم إلا ما تحدده هنا. الصفحات الإدارية (المستخدمون والسجل والإعدادات) لمدير النظام فقط.'
          : 'غير مخصصة: تُطبَّق الصلاحيات الافتراضية للدور الوظيفي.'}
      </p>

      {customized && (
        <div className="access-matrix-scroll">
          <table className="access-matrix-table">
            <thead>
              <tr>
                <th scope="col">الصفحة</th>
                {ACTIONS.map((a) => <th key={a.key} scope="col">{a.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX_PAGES.map((page) => {
                const entry = value?.pages[page.key] ?? {}
                const allTabs = (page.tabs ?? []).map((t) => t.key)
                return (
                  <tr key={page.key}>
                    <th scope="row">
                      <span>{page.label}</span>
                      {page.tabs && entry.view && (
                        <span className="access-matrix-tabs">
                          {page.tabs.map((t) => (
                            <label key={t.key} className="access-matrix-tab">
                              <input
                                type="checkbox"
                                checked={entry.tabs === undefined || entry.tabs.includes(t.key)}
                                onChange={(e) => toggleTab(page.key, t.key, allTabs, e.target.checked)}
                              />
                              <span>{t.label}</span>
                            </label>
                          ))}
                        </span>
                      )}
                    </th>
                    {ACTIONS.map((a) => (
                      <td key={a.key}>
                        <input
                          type="checkbox"
                          aria-label={`${a.label} — ${page.label}`}
                          checked={Boolean(entry[a.key])}
                          disabled={a.key !== 'view' && !entry.view}
                          onChange={(e) => setPage(page.key, { [a.key]: e.target.checked })}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  )
}
