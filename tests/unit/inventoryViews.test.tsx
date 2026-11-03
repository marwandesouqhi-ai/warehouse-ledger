import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from '../../src/pages/ReportsPage'
import { CustodyItemHistoryModal } from '../../src/components/CustodyItemHistoryModal'
import { executeInventoryOperation } from '../../src/lib/inventoryRepository'
import { readInventoryState, writeInventoryState } from '../../src/lib/inventoryStorage'
import { useInventory } from '../../src/lib/useInventory'
import type { CustodyItem } from '../../src/lib/custody'

vi.mock('../../src/lib/supabase', () => ({ supabase: null, checkIsSystemAdmin: () => false }))
const stock: CustodyItem = { id: 'a', warehouseId: 'main', name: 'جهاز قديم', code: 'A', category: 'أجهزة إلكترونية وحواسب', condition: 'maintenance', quantity: 1, value: 100, unitPrice: 100, unit: 'قطعة', custodian: '', roomLocation: '', custodyType: 'مستديمة', acquisitionDate: '2020-01-01', notes: 'صرف قديم • صيانة قديمة' }
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('warehouse-ledger-custody-items', JSON.stringify([stock]))
})
afterEach(cleanup)
it('updates mounted reports from the shared reactive inventory store', async () => {
  render(<MemoryRouter><ReportsPage /></MemoryRouter>)
  expect(screen.getAllByText('جهاز قديم').length).toBeGreaterThan(0)
  await act(async () => { await executeInventoryOperation({ kind: 'item_save', item: { ...stock, name: 'جهاز محدث' } }) })
  expect(screen.queryByText('جهاز قديم')).not.toBeInTheDocument()
  expect(screen.getAllByText('جهاز محدث').length).toBeGreaterThan(0)
})
it('does not fabricate historical events from legacy notes and displays new structured notes', async () => {
  function History() {
    const state = useInventory()
    return <CustodyItemHistoryModal item={state.items[0]} currency="EGP" onClose={vi.fn()} onUpdateItem={async (item, note) => { await executeInventoryOperation({ kind: 'item_save', item, note }) }} />
  }
  render(<History />)
  expect(screen.getByText(/لا توجد أحداث مخزنية موثقة/)).toBeInTheDocument()
  expect(screen.queryByText('قيد وتوريد الأصل لأول مرة')).not.toBeInTheDocument()
  // Simulate a shared-store commit while the modal is mounted.
  await act(async () => {
    const state = readInventoryState()
    writeInventoryState({ ...state, revision: state.revision + 1, items: [{ ...stock, history: [{ id: 'event', at: '2026-11-03T12:00:00Z', kind: 'item_save', title: 'فحص موثق', description: 'تم فحص الجهاز', effects: [] }] }] })
  })
  await waitFor(() => expect(screen.getByText('تم فحص الجهاز')).toBeInTheDocument())
  fireEvent.change(screen.getByPlaceholderText('اكتب الإجراء (مثلاً: تم الفحص الفني الدوري ويعمل بكفاءة)'), { target: { value: 'ملاحظة جديدة موثقة' } })
  fireEvent.click(screen.getByRole('button', { name: 'حفظ في سجل الأصل' }))
  await waitFor(() => expect(screen.getByText('ملاحظة جديدة موثقة')).toBeInTheDocument())
  expect(readInventoryState().items[0].notes).toBe(stock.notes)
})
it('uses Cairo dates for structured events, without replacing acquisition dates', () => {
  render(<CustodyItemHistoryModal item={{ ...stock, history: [{ id: 'e', at: '2026-11-02T22:30:00Z', kind: 'item_save', title: 'فحص', description: 'فحص موثق', effects: [] }] }} currency="EGP" onClose={vi.fn()} onUpdateItem={vi.fn()} />)
  expect(screen.getByText('2026-11-03')).toBeInTheDocument()
  expect(stock.acquisitionDate).toBe('2020-01-01')
})

it('refuses a mutation when cross-tab locking is unavailable', async () => {
  const locks = navigator.locks
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  try {
    await expect(executeInventoryOperation({ kind: 'item_save', item: stock })).rejects.toThrow(/لا يدعم قفل/)
    expect(readInventoryState().items).toEqual([stock])
  } finally { Object.defineProperty(navigator, 'locks', { configurable: true, value: locks }) }
})
