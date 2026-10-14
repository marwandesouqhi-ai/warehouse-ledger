import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSupplier,
  deleteSupplierSafe,
  syncSuppliersFromMovements,
} from '../../src/lib/suppliersRepository'
import { supabase } from '../../src/lib/supabase'

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

describe('Suppliers Management & Safety Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createSupplier requires non-empty name', async () => {
    await expect(createSupplier({ name: '   ' })).rejects.toThrow('اسم المورد مطلوب')
  })

  it('createSupplier checks for duplicate normalized name before inserting', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'sup-1', name: 'شركة الأمل للتوريدات' },
      error: null,
    })

    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mockMaybeSingle,
      }),
    })

    vi.mocked(supabase!.from).mockReturnValue({
      select: mockSelect,
    } as any)

    await expect(
      createSupplier({ name: '  شركة   الامل  للتوريدات  ' })
    ).rejects.toThrow('هذا المورد مسجل مسبقاً')
  })

  it('createSupplier inserts new supplier with correct normalized name_key', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })

    const mockSelectCheck = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mockMaybeSingle,
      }),
    })

    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sup-new',
        name: 'مؤسسة الشروق',
        name_key: 'مؤسسة الشروق',
        status: 'under_review',
      },
      error: null,
    })

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    })

    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table === 'suppliers') {
        return {
          select: mockSelectCheck,
          insert: mockInsert,
        } as any
      }
      return {} as any
    })

    const res = await createSupplier({
      name: 'مؤسسة الشروق',
      category: 'أجهزة مكتبية',
    })

    expect(res.id).toBe('sup-new')
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'مؤسسة الشروق',
        name_key: 'مؤسسة الشروق',
        category: 'أجهزة مكتبية',
        status: 'under_review',
      }),
    ])
  })

  it('deleteSupplierSafe prevents deleting supplier with existing movements', async () => {
    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table === 'movements') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              count: 3,
              error: null,
            }),
          }),
        } as any
      }
      return {} as any
    })

    await expect(deleteSupplierSafe('sup-with-invoices')).rejects.toThrow(
      'لا يمكن حذف مورد مسجل له فواتير شراء سابقة'
    )
  })

  it('deleteSupplierSafe allows deletion for unused supplier', async () => {
    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table === 'movements' || table === 'supplier_quotes' || table === 'purchase_orders') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              count: 0,
              error: null,
            }),
          }),
        } as any
      }
      if (table === 'suppliers') {
        return {
          delete: mockDelete,
        } as any
      }
      return {} as any
    })

    await expect(deleteSupplierSafe('sup-clean')).resolves.toBeUndefined()
    expect(mockDelete).toHaveBeenCalled()
  })

  it('syncSuppliersFromMovements processes distinct suppliers idempotently', async () => {
    const mockMovements = [
      { id: '1', item: 'صنف 1', from: 'شركة الأمل' },
      { id: '2', item: 'صنف 2', from: 'شركة الأمل' },
      { id: '3', item: 'صنف 3', from: 'مكتبة الفجر' },
    ] as any

    const inserted: any[] = []

    vi.mocked(supabase!.from).mockImplementation((table: string) => {
      if (table === 'suppliers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn().mockImplementation((rows) => {
            inserted.push(...rows)
            return Promise.resolve({ error: null })
          }),
        } as any
      }
      return {} as any
    })

    const count = await syncSuppliersFromMovements(mockMovements)
    expect(count).toBe(2) // 2 distinct suppliers
    expect(inserted.length).toBe(2)
  })
})
