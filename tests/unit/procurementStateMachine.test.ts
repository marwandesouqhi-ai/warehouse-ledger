import { prepareAccessContext } from '../../src/lib/accessContext'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createPurchaseRequest,
  updatePurchaseRequestDraft,
  submitPurchaseRequestRpc,
  recordApprovalRpc,
  suggestLastPurchasePrice,
} from '../../src/lib/procurementRepository'
import { supabase } from '../../src/lib/supabase'

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

describe('Procurement State Machine & Request Workflow Suite', () => {
  beforeEach(() => {
    prepareAccessContext({ user: { id: '00000000-0000-4000-8000-000000000001', app_metadata: { role: 'system_admin' } } } as any)
    vi.clearAllMocks()
  })

  it('createPurchaseRequest requires department and at least one item', async () => {
    await expect(
      createPurchaseRequest(
        {
          department: '',
          purchase_type: 'direct',
          priority: 'normal',
          requested_by: 'مستخدم',
          justification: 'مبررات',
          created_by: 'مستخدم',
        },
        []
      )
    ).rejects.toThrow('يرجى تحديد أو كتابة اسم القسم الطالب.')

    await expect(
      createPurchaseRequest(
        {
          department: 'المخزن الرئيسي',
          purchase_type: 'direct',
          priority: 'normal',
          requested_by: 'مستخدم',
          justification: 'مبررات',
          created_by: 'مستخدم',
        },
        []
      )
    ).rejects.toThrow('يجب إضافة بند واحد على الأقل')
  })

  it('createPurchaseRequest validates each item has name and quantity > 0', async () => {
    await expect(
      createPurchaseRequest(
        {
          department: 'المخزن الرئيسي',
          purchase_type: 'direct',
          priority: 'normal',
          requested_by: 'مستخدم',
          justification: 'مبررات',
          created_by: 'مستخدم',
        },
        [{ item_name: 'ورق A4', quantity: 0, unit: 'باقة', estimated_price: 150 }]
      )
    ).rejects.toThrow('أكبر من صفر')
  })

  it('updatePurchaseRequestDraft rejects editing non-draft requests', async () => {
    vi.mocked(supabase!.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { status: 'pending' },
            error: null,
          }),
        }),
      }),
    } as any)

    await expect(
      updatePurchaseRequestDraft('req-pending-123', { department: 'القسم المالي' })
    ).rejects.toThrow('لا يمكن تعديل الطلب إلا وهو في حالة مسودة')
  })

  it('submitPurchaseRequestRpc invokes submit_purchase_request server RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { success: true },
      error: null,
    } as any)

    await expect(submitPurchaseRequestRpc('req-1')).resolves.toBeUndefined()
    expect(supabase!.rpc).toHaveBeenCalledWith('submit_purchase_request', {
      p_request_id: 'req-1',
    })
  })

  it('recordApprovalRpc invokes record_approval server RPC with parameters', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { success: true },
      error: null,
    } as any)

    await expect(recordApprovalRpc('req-1', 1, 'approved', 'معتمد')).resolves.toBeUndefined()
    expect(supabase!.rpc).toHaveBeenCalledWith('record_approval', {
      p_request_id: 'req-1',
      p_step_no: 1,
      p_decision: 'approved',
      p_note: 'معتمد',
    })
  })

  it('suggestLastPurchasePrice retrieves unit price of matching historical purchase', () => {
    const mockMovements = [
      { id: '1', item: 'طابعة ليزر HP', qin: '2', price: '4500' },
      { id: '2', item: 'ورق تصوير A4', qin: '50', price: '180' },
      { id: '3', item: 'ورق تصوير A4', qin: '20', price: '210' }, // latest price
      { id: '4', item: 'طابعة ليزر HP', qout: '1', price: '4500' }, // outward, not purchase
    ] as any

    const suggested = suggestLastPurchasePrice('  ورق   تصوير   a4  ', mockMovements)
    expect(suggested).toBe(210)

    const notFound = suggestLastPurchasePrice('صنف غير موجود مطلقاً', mockMovements)
    expect(notFound).toBeNull()
  })
})
