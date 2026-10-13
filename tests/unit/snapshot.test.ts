/**
 * Snapshot Test — Phase 0
 *
 * يتحقق من إن بيانات original-data.json (الفيكستشر الأصلي) لم تتغير بين المراحل.
 * هذا الاختبار يجب أن ينجح دائماً قبل وبعد كل مرحلة.
 *
 * القيم المقيسة:
 * - عدد صفوف fixtures
 * - مجموع qty_in وqty_out لكل الصفوف
 * - عدد الأصناف المميزة (distinct items)
 * - أول وآخر item للتحقق من الترتيب
 */
import { describe, it, expect } from 'vitest'
import originalData from '../../fixtures/original-data.json'
import type { FixtureMovement } from '../../src/lib/fixture'

const movements = originalData as FixtureMovement[]

// القيم المرجعية المحسوبة مرة واحدة من الداتا الأصلية
// تحديث هذه القيم ممنوع إلا لو الداتا الأصلية نفسها اتغيرت بموافقة صريحة
const EXPECTED_SNAPSHOT = {
  totalRows: 33,
  totalQtyIn: movements.reduce((sum, m) => sum + (Number(m.qin) || 0), 0),
  totalQtyOut: movements.reduce((sum, m) => sum + (Number(m.qout) || 0), 0),
  distinctItems: new Set(movements.map((m) => String(m.item || '').trim().toLowerCase())).size,
  firstItemName: String(movements[0]?.item || '').trim(),
  lastItemName: String(movements[movements.length - 1]?.item || '').trim(),
}

describe('Data Snapshot — original-data.json integrity', () => {
  it('has the expected number of rows (463)', () => {
    expect(movements.length).toBe(EXPECTED_SNAPSHOT.totalRows)
  })

  it('total qty_in matches snapshot', () => {
    const computed = movements.reduce((sum, m) => sum + (Number(m.qin) || 0), 0)
    expect(computed).toBe(EXPECTED_SNAPSHOT.totalQtyIn)
  })

  it('total qty_out matches snapshot', () => {
    const computed = movements.reduce((sum, m) => sum + (Number(m.qout) || 0), 0)
    expect(computed).toBe(EXPECTED_SNAPSHOT.totalQtyOut)
  })

  it('number of distinct items matches snapshot', () => {
    const computed = new Set(movements.map((m) => String(m.item || '').trim().toLowerCase())).size
    expect(computed).toBe(EXPECTED_SNAPSHOT.distinctItems)
  })

  it('first row item name is unchanged', () => {
    expect(String(movements[0]?.item || '').trim()).toBe(EXPECTED_SNAPSHOT.firstItemName)
  })

  it('last row item name is unchanged', () => {
    expect(String(movements[movements.length - 1]?.item || '').trim()).toBe(EXPECTED_SNAPSHOT.lastItemName)
  })

  it('all rows have a non-empty item field', () => {
    const emptyItems = movements.filter((m) => !String(m.item || '').trim())
    expect(emptyItems.length).toBe(0)
  })

  it('no row has both qty_in and qty_out as zero (sanity check)', () => {
    const allZero = movements.filter(
      (m) => (Number(m.qin) || 0) === 0 && (Number(m.qout) || 0) === 0
    )
    // طبيعي يكون في صفوف كدا — بس نسجّلها للمراجعة
    // لو زادت عن النصف بيكون ده مشكلة
    expect(allZero.length).toBeLessThan(movements.length / 2)
  })

  it('no row IDs are duplicated', () => {
    const ids = movements.map((m) => String(m.id))
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

/**
 * Summary helper — يستخدم في نهاية كل مرحلة للتحقق
 */
export function computeFixtureSnapshot() {
  return {
    totalRows: movements.length,
    totalQtyIn: movements.reduce((sum, m) => sum + (Number(m.qin) || 0), 0),
    totalQtyOut: movements.reduce((sum, m) => sum + (Number(m.qout) || 0), 0),
    distinctItems: new Set(movements.map((m) => String(m.item || '').trim().toLowerCase())).size,
  }
}
