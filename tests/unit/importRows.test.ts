import { describe, expect, it } from 'vitest'

import { movementFingerprint, parseMovementRows } from '../../src/lib/importRows'

describe('Excel movement row mapping', () => {
    it('maps Arabic headers and preserves invalid numeric values for quality review', () => {
        const movements = parseMovementRows([
            {
                'تاريخ الوارد': '2025-02-10',
                'رقم الفاتورة': 12,
                'اسم الصنف': 'أجهزة معملية',
                'سعر الوحدة': 'سعر غير معروف',
                'كمية الوارد': '٣',
                'كمية المنصرف': 1,
                'المورد': 'شركة النور',
            },
        ], 500)

        expect(movements).toEqual([{
            id: 500,
            date: '2025-02-10',
            inv: 12,
            from: 'شركة النور',
            to: '',
            permit: '',
            issue: '',
            item: 'أجهزة معملية',
            price: 'سعر غير معروف',
            qin: '٣',
            qout: 1,
            notes: '',
        }])
    })

    it('skips blank rows and rejects workbooks without an item column', () => {
        expect(parseMovementRows([{ item: 'صنف', qin: 1 }, { item: '', qin: 2 }], 10)).toHaveLength(1)
        expect(() => parseMovementRows([{ date: '2025-01-01', qin: 1 }])).toThrow('لم أجد عمود الصنف')
    })

    it('creates stable fingerprints for duplicate imports', () => {
        const row = parseMovementRows([{ item: 'صنف', date: '2025-01-01', qin: 1 }], 1)[0]
        expect(movementFingerprint(row)).toBe(movementFingerprint({ ...row, id: 99 }))
    })
})