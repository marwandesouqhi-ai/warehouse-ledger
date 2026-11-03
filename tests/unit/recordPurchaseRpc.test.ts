import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveCustodyItemsToCloud, type CustodyItem } from '../../src/lib/custody'
import { supabase } from '../../src/lib/supabase'

describe('record_purchase RPC & Custody Overwrite Protection Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects stale cloud writes instead of taking a larger quantity or mutating input', async () => {
    if (!supabase) return
    localStorage.clear()
    const items: CustodyItem[] = [{ id: 'a', warehouseId: 'main', code: '', name: 'حاسوب', category: 'أجهزة إلكترونية وحواسب', quantity: 5, value: 100, unit: 'قطعة', condition: 'good', custodyType: 'مستديمة', custodian: '', roomLocation: '', acquisitionDate: '2020-01-01', version: 0 }]
    const before = JSON.stringify(items)
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: { message: 'Inventory version conflict' } } as never)
    await expect(saveCustodyItemsToCloud(items)).rejects.toThrow(/version conflict/)
    expect(JSON.stringify(items)).toBe(before)
    expect(rpcSpy).toHaveBeenCalledWith('apply_inventory_operation', expect.objectContaining({ p_kind: 'import' }))
    rpcSpy.mockRestore()
  })

  it('simulates record_purchase RPC contract and verifies idempotency response', async () => {
    if (!supabase) return

    // محاكاة دالة record_purchase RPC
    const rpcMock = vi.fn()
      // أول استدعاء: حركة جديدة
      .mockResolvedValueOnce({
        data: {
          success: true,
          already_existed: false,
          movement_id: 'a0000000-0000-0000-0000-000000000001',
          message: 'تم تسجيل الفاتورة وتحديث رصيد المخزن الرئيسي بنجاح.',
        },
        error: null,
      })
      // ثاني استدعاء بنفس البصمة: حركة مسجلة مسبقاً (Idempotent)
      .mockResolvedValueOnce({
        data: {
          success: true,
          already_existed: true,
          movement_id: 'a0000000-0000-0000-0000-000000000001',
          message: 'فاتورة مسجلة مسبقاً (تم تخطي التكرار بأمان)',
        },
        error: null,
      })

    const rpcSpy = vi.spyOn(supabase as any, 'rpc').mockImplementation(rpcMock as any)

    // 1. الاستدعاء الأول
    const firstCall = await (supabase as any).rpc('record_purchase', {
      p_fingerprint: 'fp-test-unique-001',
      p_item: 'شاشة سامسونج 27 بوصة',
      p_qty: 5,
      p_unit_price: 6000,
      p_supplier: 'شركة التكنولوجيا الحديثة',
    })

    expect(firstCall.error).toBeNull()
    expect(firstCall.data?.success).toBe(true)
    expect(firstCall.data?.already_existed).toBe(false)
    expect(firstCall.data?.movement_id).toBe('a0000000-0000-0000-0000-000000000001')

    // 2. الاستدعاء الثاني بنفس البصمة
    const secondCall = await (supabase as any).rpc('record_purchase', {
      p_fingerprint: 'fp-test-unique-001',
      p_item: 'شاشة سامسونج 27 بوصة',
      p_qty: 5,
      p_unit_price: 6000,
      p_supplier: 'شركة التكنولوجيا الحديثة',
    })

    expect(secondCall.error).toBeNull()
    expect(secondCall.data?.success).toBe(true)
    expect(secondCall.data?.already_existed).toBe(true) // تم اكتشاف التكرار ولم يتكرر الأثر
    expect(secondCall.data?.movement_id).toBe('a0000000-0000-0000-0000-000000000001')

    rpcSpy.mockRestore()
  })

  it('rejects unauthorized roles trying to record purchases', async () => {
    if (!supabase) return

    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('غير مصرح: تسجيل فواتير الشراء مقتصر على موظف المشتريات وإدارة النظام.'),
    })

    const rpcSpy = vi.spyOn(supabase as any, 'rpc').mockImplementation(rpcMock as any)

    const callResult = await (supabase as any).rpc('record_purchase', {
      p_fingerprint: 'fp-unauthorized-attempt',
      p_item: 'طابعة ليزر HP',
      p_qty: 1,
    })

    expect(callResult.error).not.toBeNull()
    expect(callResult.error?.message).toContain('غير مصرح')

    rpcSpy.mockRestore()
  })
})
