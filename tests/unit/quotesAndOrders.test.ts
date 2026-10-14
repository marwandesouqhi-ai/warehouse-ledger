import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSupplierQuote,
  selectQuoteRpc,
  createPurchaseOrderRpc,
  markPoReceivedRpc,
  markPoInvoicedRpc,
} from '../../src/lib/procurementRepository'
import { supabase } from '../../src/lib/supabase'

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

describe('Quotes Comparison and Purchase Orders Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createSupplierQuote rejects negative price or negative delivery days', async () => {
    await expect(
      createSupplierQuote({
        request_id: 'req-1',
        supplier_id: 'sup-1',
        total_price: -500,
        delivery_days: 5,
      })
    ).rejects.toThrow('إجمالي السعر لا يمكن أن يكون سالباً.')

    await expect(
      createSupplierQuote({
        request_id: 'req-1',
        supplier_id: 'sup-1',
        total_price: 1000,
        delivery_days: -2,
      })
    ).rejects.toThrow('مدة التوريد لا يمكن أن تكون سالبة.')
  })

  it('createSupplierQuote inserts valid quote into supplier_quotes', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'quote-123',
        request_id: 'req-1',
        supplier_id: 'sup-1',
        total_price: 25000,
        delivery_days: 5,
      },
      error: null,
    })

    vi.mocked(supabase!.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSingle,
        }),
      }),
    } as any)

    const quote = await createSupplierQuote({
      request_id: 'req-1',
      supplier_id: 'sup-1',
      total_price: 25000,
      delivery_days: 5,
      payment_terms: 'شيك بعد الاستلام',
      warranty_months: 24,
    })

    expect(quote.id).toBe('quote-123')
    expect(quote.total_price).toBe(25000)
  })

  it('selectQuoteRpc invokes select_quote RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { success: true },
      error: null,
    } as any)

    await expect(selectQuoteRpc('req-1', 'quote-123')).resolves.toBeUndefined()
    expect(supabase!.rpc).toHaveBeenCalledWith('select_quote', {
      p_request_id: 'req-1',
      p_quote_id: 'quote-123',
    })
  })

  it('createPurchaseOrderRpc invokes create_purchase_order and returns po_no', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: {
        success: true,
        po_id: 'po-999',
        po_no: 'PO-0001',
      },
      error: null,
    } as any)

    const res = await createPurchaseOrderRpc('quote-123')
    expect(res.po_no).toBe('PO-0001')
    expect(res.po_id).toBe('po-999')
    expect(supabase!.rpc).toHaveBeenCalledWith('create_purchase_order', {
      p_quote_id: 'quote-123',
    })
  })

  it('markPoReceivedRpc and markPoInvoicedRpc trigger server state update without side-effects on inventory', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { success: true },
      error: null,
    } as any)

    await expect(markPoReceivedRpc('po-999')).resolves.toBeUndefined()
    expect(supabase!.rpc).toHaveBeenCalledWith('mark_po_received', { p_po_id: 'po-999' })

    await expect(markPoInvoicedRpc('po-999')).resolves.toBeUndefined()
    expect(supabase!.rpc).toHaveBeenCalledWith('mark_po_invoiced', { p_po_id: 'po-999' })
  })
})
