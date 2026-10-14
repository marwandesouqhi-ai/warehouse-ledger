import type { Session } from '@supabase/supabase-js'
import { BarChart3 } from 'lucide-react'
import ProcurementSubNav from '../../components/ProcurementSubNav'
import { ProcurementAnalyticsDashboard } from '../../components/ProcurementAnalyticsDashboard'
import type { FixtureMovement } from '../../lib/fixture'
import type { AppSettings } from '../../lib/settings'

interface ProcurementAnalyticsPageProps {
  session?: Session | null
  movements: FixtureMovement[]
  currency: AppSettings['currency']
}

export default function ProcurementAnalyticsPage({
  session: _session,
  movements,
  currency,
}: ProcurementAnalyticsPageProps) {
  return (
    <section className="movement-page card-surface purchases-page procurement-analytics-page">
      {/* Sub navigation connecting the 5 procurement sub-pages */}
      <ProcurementSubNav activeTab="analytics" />

      {/* Page Header */}
      <div className="section-head movement-heading" style={{ marginTop: '14px', marginBottom: '20px' }}>
        <div>
          <h2>
            <BarChart3 size={20} />
            {' '}
            تحليلات ومسار إدارة المشتريات
          </h2>
          <span>مؤشرات الأداء اللحظية، مسار المراحل الخمس، تنبيهات التوريد، ومتابعة الإنفاق المالي</span>
        </div>
      </div>

      {/* Main Analytics Dashboard */}
      <ProcurementAnalyticsDashboard movements={movements} currency={currency} isDashboardEmbed={false} />
    </section>
  )
}
