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
      label: 'إدارة الموردين',
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
    <nav className="procurement-subnav" aria-label="أقسام موديول المشتريات">
      <div className="procurement-subnav-container">
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
            >
              <Icon size={17} />
              <span>{tab.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
