import { describe, it, expect } from 'vitest'
import { normalizeArabicName } from '../../src/lib/arabicUtils'

describe('Arabic Name Normalization Equivalence Suite', () => {
  it('strips tashkeel and diacritics', () => {
    const raw = 'شَرِكَةُ الأَمَلِ لِلتَّوْرِيدَاتِ'
    expect(normalizeArabicName(raw)).toBe('شركة الامل للتوريدات')
  })

  it('normalizes alef variants to bare alef', () => {
    expect(normalizeArabicName('أحمد إبراهيم آمنة')).toBe('احمد ابراهيم امنة')
  })

  it('preserves teh marbuta as specified', () => {
    expect(normalizeArabicName('مؤسسة الصفا الحديثة')).toBe('مؤسسة الصفا الحديثة')
  })

  it('normalizes alef maksura to ya', () => {
    expect(normalizeArabicName('مستشفى مصطفى')).toBe('مستشفي مصطفي')
  })

  it('removes tatweel / kashida', () => {
    expect(normalizeArabicName('شـــركــة التـــــوريد')).toBe('شركة التوريد')
  })

  it('collapses multiple whitespace characters and trims', () => {
    expect(normalizeArabicName('   شركة    الزقازيق   للتجارة   ')).toBe('شركة الزقازيق للتجارة')
  })

  it('handles null and undefined gracefully', () => {
    expect(normalizeArabicName(null)).toBe('')
    expect(normalizeArabicName(undefined)).toBe('')
    expect(normalizeArabicName('')).toBe('')
  })

  it('is completely idempotent (normalizing twice gives same key)', () => {
    const samples = [
      'مؤسسة النور الهندسية للتجهيزات',
      'شركة الأهرام للتوريدات الطبية والمخبرية',
      'مستودع الشرق الأوسط التجاري',
    ]
    for (const sample of samples) {
      const once = normalizeArabicName(sample)
      const twice = normalizeArabicName(once)
      expect(twice).toBe(once)
    }
  })
})
