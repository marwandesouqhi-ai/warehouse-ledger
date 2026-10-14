import { NavLink } from 'react-router-dom'
import {
  Building2,
  FileSpreadsheet,
  Receipt,
} from 'lucide-react'

export interface ProcurementSubNavProps {
  activeTab?: 'invoices' | 'suppliers' | 'quotes'
}

export default function ProcurementSubNav({ activeTab }: ProcurementSubNavProps) {
  const tabs = [
    {
      to: '/purchases',
      id: 'invoices',
      label: 'فواتير وتوريدات الشراء',
      icon: Receipt,
      end: true,
    },
    {
      to: '/purchases/suppliers',
      id: 'suppliers',
      label: 'إدارة الموردين والشركات',
      icon: Building2,
      end: false,
    },
    {
      to: '/purchases/quotes',
      id: 'quotes',
      label: 'عروض الأسعار وأوامر الشراء',
      icon: FileSpreadsheet,
      end: false,
    },
  ]

  return (
    <nav className="procurement-subnav" aria-label="أقسام موديول المشتريات" style={{ marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
      <div className="procurement-subnav-container" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isExplicitActive = activeTab ? activeTab === tab.id : undefined

          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => {
                const active = isExplicitActive !== undefined ? isExplicitActive : isActive
                return `procurement-tab-pill ${active ? 'active' : ''}`
              }}
              style={({ isActive }) => {
                const active = isExplicitActive !== undefined ? isExplicitActive : isActive
                return {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '10px 20px',
                  borderRadius: '10px',
                  fontSize: '0.94rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  minHeight: '44px',
                  boxSizing: 'border-box',
                  transition: 'all 0.2s ease',
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#ffffff' : 'var(--ink)',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
                  boxShadow: active ? '0 4px 12px rgba(8, 127, 104, 0.25)' : 'none',
                }
              }}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
