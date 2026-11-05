import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  formatMovementForSheet,
  resolveWarehouseArabicName,
  pushMovementToGoogleSheet,
  getGoogleSheetsWebhookUrl,
  setGoogleSheetsWebhookUrl,
} from '../../src/lib/googleSheetsRealtimeSync'
import type { FixtureMovement } from '../../src/lib/fixture'

describe('Google Sheets Real-time Sync Suite', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('resolves internal warehouse IDs to exact Arabic sheet tab names', () => {
    expect(resolveWarehouseArabicName('medicine_a')).toBe('طب بشري أ')
    expect(resolveWarehouseArabicName('medicine')).toBe('طب بشري و تمريض')
    expect(resolveWarehouseArabicName('nursing')).toBe('تمريض')
    expect(resolveWarehouseArabicName('engineering')).toBe('هندسة')
    expect(resolveWarehouseArabicName('fci')).toBe('حاسبات و معلومات')
    expect(resolveWarehouseArabicName('central_lab')).toBe('معامل مركزية')
    expect(resolveWarehouseArabicName('engineering_workshops')).toBe('ورش هندسية')
  })

  it('formats incoming movement payload to match AppSheet_DB columns', () => {
    const move: Partial<FixtureMovement> = {
      id: 'mov-123456',
      date: '2026-11-05',
      inv: 'فاتورة-55',
      permit: 'إذن-101',
      from: 'شركة الأمل للتوريدات الطبية',
      item: 'ميكروسكوب ضوئي',
      price: 5000,
      qin: 10,
      qout: '',
      notes: 'توريد معمل الباثولوجي',
      destWarehouseId: 'medicine_a',
    }

    const payload = formatMovementForSheet(move)
    expect(payload.id).toBe('TRX-123456')
    expect(payload.warehouse).toBe('طب بشري أ')
    expect(payload.date).toBe('2026-11-05')
    expect(payload.type).toBe('وارد')
    expect(payload.permit).toBe('إذن-101')
    expect(payload.party).toBe('شركة الأمل للتوريدات الطبية')
    expect(payload.item).toBe('ميكروسكوب ضوئي')
    expect(payload.price).toBe(5000)
    expect(payload.qty).toBe(10)
    expect(payload.total).toBe(50000)
    expect(payload.notes).toBe('توريد معمل الباثولوجي')
  })

  it('formats outgoing movement payload to match AppSheet_DB columns', () => {
    const move: Partial<FixtureMovement> = {
      id: 'mov-654321',
      date: '2026-11-05',
      permit: 'إذن-102',
      to: 'قسم التشريح والباثولوجي',
      item: 'ميكروسكوب ضوئي',
      price: 5000,
      qin: '',
      qout: 2,
      notes: 'صرف لتدريب الطلاب',
      sourceWarehouseId: 'medicine_a',
    }

    const payload = formatMovementForSheet(move)
    expect(payload.type).toBe('منصرف')
    expect(payload.party).toBe('قسم التشريح والباثولوجي')
    expect(payload.qty).toBe(2)
    expect(payload.total).toBe(10000)
  })

  it('gets and sets webhook URL in localStorage', () => {
    expect(getGoogleSheetsWebhookUrl()).toBe('')
    setGoogleSheetsWebhookUrl('https://script.google.com/macros/s/xyz/exec')
    expect(getGoogleSheetsWebhookUrl()).toBe('https://script.google.com/macros/s/xyz/exec')
    setGoogleSheetsWebhookUrl('')
    expect(getGoogleSheetsWebhookUrl()).toBe('')
  })

  it('dispatches fetch POST request when webhook URL is set', async () => {
    setGoogleSheetsWebhookUrl('https://script.google.com/macros/s/test/exec')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    const move: Partial<FixtureMovement> = {
      id: 'test-1',
      item: 'صنف تجريبي',
      qin: 5,
      price: 100,
    }

    const result = await pushMovementToGoogleSheet(move, 'medicine_a')
    expect(result).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://script.google.com/macros/s/test/exec',
      expect.objectContaining({
        method: 'POST',
        mode: 'no-cors',
      })
    )
  })
})

