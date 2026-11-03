import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NewDisbursementModal } from '../../src/pages/CustodyPage'
import NotFoundPage from '../../src/pages/NotFoundPage'
import type { CustodyItem } from '../../src/lib/custody'

vi.mock('../../src/lib/supabase', () => ({ supabase: null, checkIsSystemAdmin: () => false }))
const stock: CustodyItem = {
  id: 'source-a', warehouseId: 'main', code: 'A', name: 'حاسوب', quantity: 5,
  unit: 'قطعة', unitPrice: 100, value: 500, condition: 'good', category: 'أجهزة إلكترونية وحواسب',
  custodian: 'أمين المخزن', custodyType: 'مستديمة', roomLocation: 'المخزن', acquisitionDate: '2026-01-01',
}
afterEach(cleanup)
beforeEach(() => localStorage.clear())

describe('Phase 1 source item selection', () => {
  it('clears dependent state and disables submission when switching to an empty source', async () => {
    const submit = vi.fn()
    render(<NewDisbursementModal items={[stock]} currency="EGP" onClose={vi.fn()} onSubmit={submit} />)
    expect(screen.getByRole('button', { name: 'اعتماد وحفظ إذن الصرف' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('المخزن المصدر:'), { target: { value: 'engineering' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'اعتماد وحفظ إذن الصرف' })).toBeDisabled())
    expect(screen.getByLabelText('الصنف المراد صرفه')).toBeDisabled()
    fireEvent.submit(document.querySelector('form')!)
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('المخزن المصدر:'), { target: { value: 'main' } })
    expect(screen.getByRole('button', { name: 'اعتماد وحفظ إذن الصرف' })).toBeDisabled()
  })
  it('submits the source record ID when two items share a name', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(<NewDisbursementModal items={[stock, { ...stock, id: 'source-b' }]} currency="EGP" onClose={vi.fn()} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText('الصنف المراد صرفه:'), { target: { value: 'source-b' } })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ sourceItemId: 'source-b', item: stock.name })))
  })
})

it('shows an Arabic recovery route for unknown URLs', () => {
  render(<MemoryRouter initialEntries={['/unknown']}><Routes><Route path="*" element={<NotFoundPage />} /></Routes></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'العودة إلى الرئيسية' })).toHaveAttribute('href', '/')
})
