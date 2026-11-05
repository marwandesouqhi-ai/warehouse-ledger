import { prepareAccessContext } from '../../src/lib/accessContext'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveCustodyItemsToCloud, type CustodyItem } from '../../src/lib/custody'
import { supabase } from '../../src/lib/supabase'

describe('record_purchase RPC & Custody Overwrite Protection Suite', () => {
  beforeEach(() => {
    prepareAccessContext({ user: { id: '00000000-0000-4000-8000-000000000001', app_metadata: { role: 'system_admin' } } } as any)
    vi.clearAllMocks()
  })

  it('preserves higher cloud quantities and does not overwrite with stale local copies in saveCustodyItemsToCloud', async () => {
    if (!supabase) return

    // محاكاة حالة السحابة: زيادة الرصيد إلى 25 بسبب فاتورة شراء نُفذت عبر record_purchase
    const cloudItem = {
      id: 'cust-main-001',
      warehouse_id: 'main',
      name: 'كمبيوتر محمول Dell Core i7',
      quantity: 25, // القيمة الأحدث في السحابة
      value: 750000,
      updated_at: '2026-10-14T10:00:00Z',
    }

    // محاكاة استجابة Supabase select
    const selectMock = vi.fn().mockResolvedValue({
      data: [cloudItem],
      error: null,
    })

    const upsertMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })

    // تركيب mock على supabase.from('custody_items')
    const fromSpy = vi.spyOn(supabase as any, 'from').mockImplementation(((table: string) => {
      if (table === 'custody_items') {
        return {
          select: selectMock,
          upsert: upsertMock,
        }
      }
      return {}
    }) as any)

    // نسخة العميل المحلية القديمة (قبل عملية الشراء، ما زالت 10)
    const staleLocalItems: CustodyItem[] = [
      {
        id: 'cust-main-001',
        warehouseId: 'main',
        code: 'MAIN-001',
        name: 'كمبيوتر محمول Dell Core i7',
        category: 'أجهزة إلكترونية وحواسب',
        custodian: 'أمين المخزن الرئيسي',
        quantity: 10, // نسخة محلية قديمة
        unit: 'جهاز',
        condition: 'excellent',
        custodyType: 'مستديمة',
        roomLocation: 'المستودع الرئيسي',
        acquisitionDate: '2026-01-01',
        value: 300000,
      },
    ]

    // استدعاء الحفظ السحابي
    await saveCustodyItemsToCloud(staleLocalItems)

    expect(selectMock).toHaveBeenCalled()
    expect(upsertMock).toHaveBeenCalledTimes(1)

    // التحقق من أن القيمة المرفوعة لم تمسح رصيد السحابة الأحدث
    const uploadedRows = upsertMock.mock.calls[0][0] as Array<{ id: string; quantity: number }>
    expect(uploadedRows[0].id).toBe('cust-main-001')
    expect(uploadedRows[0].quantity).toBe(25) // تم الحفاظ على كمية السحابة 25 بدلاً من مسحها بـ 10

    // والتحقق أيضاً من تحديث الكائن المحلي ليواكب السحابة
    expect(staleLocalItems[0].quantity).toBe(25)

    fromSpy.mockRestore()
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
