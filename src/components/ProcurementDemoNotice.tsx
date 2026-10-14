import { useState } from 'react'
import { Copy, Check, X, Database } from 'lucide-react'
import { isCloudTableMissing } from '../lib/demoProcurementData'

export function ProcurementDemoNotice() {
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!isCloudTableMissing() || dismissed) return null

  const sqlFilePath = 'supabase/migrations/20261014140000_procurement_module.sql'

  function handleCopyPath() {
    void navigator.clipboard?.writeText(sqlFilePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="procurement-demo-notice animate-fade-in"
      style={{
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(217, 119, 6, 0.08))',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        borderRadius: '10px',
        padding: '12px 16px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '280px' }}>
        <Database size={20} style={{ color: '#d97706', flexShrink: 0 }} />
        <div style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
          <strong style={{ color: '#d97706', display: 'block', marginBottom: '2px' }}>
            وضع البيانات التوضيحية النشط (Local Demo Mode)
          </strong>
          لم تُنشأ جداول المشتريات السحابية بعد على Supabase. يعمل النظام حالياً بكامل وظائفه بالبيانات التجريبية المحلية. لتفعيل الربط السحابي، شغّل ملف المايجريشن في محرر SQL.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={handleCopyPath}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.78rem',
            padding: '5px 10px',
            borderRadius: '6px',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
          title="نسخ مسار ملف SQL"
        >
          {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
          <span>{copied ? 'تم نسخ المسار' : 'مسار ملف SQL'}</span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px' }}
          title="إغلاق التنبيه"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
