import { describe, it, expect } from 'vitest'
import {
    canAccessProcurementModule,
    canCreatePurchase,
    canCreateDisbursement,
    canViewPage,
    getDashboardScope,
} from '../../src/lib/permissions'

describe('Department Isolation & Role-Based Access Control Suite', () => {
    it('isolates procurement module access by department role', () => {
        // Warehouse staff cannot access procurement module
        expect(canAccessProcurementModule('warehouse_employee')).toBe(false)
        expect(canAccessProcurementModule('warehouse_admin')).toBe(false)

        // Procurement staff can access procurement module
        expect(canAccessProcurementModule('procurement_employee')).toBe(true)
        expect(canAccessProcurementModule('procurement_admin')).toBe(true)

        // System Admin has full cross-department access
        expect(canAccessProcurementModule('system_admin')).toBe(true)
    })

    it('isolates purchase creation to procurement roles and system admin', () => {
        expect(canCreatePurchase('warehouse_employee')).toBe(false)
        expect(canCreatePurchase('warehouse_admin')).toBe(false)
        expect(canCreatePurchase('procurement_employee')).toBe(true)
        expect(canCreatePurchase('procurement_admin')).toBe(false)
        expect(canCreatePurchase('system_admin')).toBe(true)
    })

    it('isolates warehouse disbursement creation to warehouse roles and system admin', () => {
        expect(canCreateDisbursement('warehouse_employee')).toBe(true)
        expect(canCreateDisbursement('warehouse_admin')).toBe(false)
        expect(canCreateDisbursement('procurement_employee')).toBe(false)
        expect(canCreateDisbursement('procurement_admin')).toBe(false)
        expect(canCreateDisbursement('system_admin')).toBe(true)
    })

    it('enforces page view authorization strictly', () => {
        // Procurement page
        expect(canViewPage('procurement', 'warehouse_employee')).toBe(false)
        expect(canViewPage('procurement', 'procurement_employee')).toBe(true)
        expect(canViewPage('procurement', 'system_admin')).toBe(true)

        // Admin/Users page
        expect(canViewPage('users', 'warehouse_employee')).toBe(false)
        expect(canViewPage('users', 'procurement_employee')).toBe(false)
        expect(canViewPage('users', 'system_admin')).toBe(true)
    })

    it('partitions dashboard scope by department', () => {
        expect(getDashboardScope('warehouse_employee')).toBe('warehouse_only')
        expect(getDashboardScope('warehouse_admin')).toBe('warehouse_only')
        expect(getDashboardScope('procurement_employee')).toBe('purchases_only')
        expect(getDashboardScope('procurement_admin')).toBe('purchases_only')
        expect(getDashboardScope('system_admin')).toBe('full')
    })
})
