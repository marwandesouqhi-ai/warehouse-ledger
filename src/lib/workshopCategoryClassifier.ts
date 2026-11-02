/**
 * Specialized Keyword-based Category Classifier for Engineering Workshops Custody Items.
 *
 * Rules are evaluated in specific-to-general order:
 * 1. Measuring & Marking tools (أدوات وأجهزة قياس)
 * 2. Foundry, casting & metallurgy (سباكة وقوالب ومعادن)
 * 3. Welding equipment & supplies (معدات ولوازم لحام)
 * 4. Safety gear & occupational health (مهمات وسلامة مهنية)
 * 5. Woodworking & carpentry (نجارة وأخشاب)
 * 6. Furnaces, ovens & presses (أفران ومكابس)
 * 7. Drilling, milling & threading (ثقب وتفريز وقلاووظ)
 * 8. Workshop Machinery & power saws (ماكينات ومعدات ورش)
 * 9. Hand tools & fixtures (عدد وأدوات يدوية)
 * Fallback: 'أخرى'
 */

export const WORKSHOP_CATEGORIES = [
  'أدوات وأجهزة قياس',
  'ماكينات ومعدات ورش',
  'عدد وأدوات يدوية',
  'ثقب وتفريز وقلاووظ',
  'سباكة وقوالب ومعادن',
  'معدات ولوازم لحام',
  'نجارة وأخشاب',
  'أفران ومكابس',
  'مهمات وسلامة مهنية',
  'أخرى',
] as const

export type WorkshopCategory = typeof WORKSHOP_CATEGORIES[number]

function normalizeWorkshopText(text?: string | null): string {
  if (!text) return ''
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '') // remove arabic tashkeel diacritics
    .replace(/\s+/g, ' ')
}

export function classifyWorkshopItem(itemName?: string | null): WorkshopCategory {
  const n = normalizeWorkshopText(itemName)
  if (!n) return 'أخرى'

  // 1. Measuring & Marking tools (أدوات وأجهزة قياس)
  if (
    n.includes('قدم') ||
    n.includes('ميكروميتر') ||
    n.includes('زاوي') ||
    n.includes('فيلر') ||
    n.includes('قياس') ||
    n.includes('متر') ||
    n.includes('gauge') ||
    n.includes('geuge') ||
    n.includes('protractor') ||
    n.includes('protraltor') ||
    n.includes('بلوكات') ||
    n.includes('برجل') ||
    n.includes('علام') ||
    n.includes('زنبه') ||
    n.includes('زمبه') ||
    n.includes('شوكه') ||
    n.includes('شوكة') ||
    n.includes('تخطيط') ||
    n.includes('استعدال')
  ) {
    return 'أدوات وأجهزة قياس'
  }

  // 2. Foundry, casting & metallurgy (سباكة وقوالب ومعادن)
  if (
    n.includes('بوتقه') ||
    n.includes('سباك') ||
    n.includes('روازق') ||
    n.includes('سندال') ||
    n.includes('سداق') ||
    n.includes('نماذج') ||
    n.includes('شباك بوتقه') ||
    n.includes('شيال') ||
    (n.includes('زهر') && !n.includes('تخطيط'))
  ) {
    return 'سباكة وقوالب ومعادن'
  }

  // 3. Welding equipment & supplies (معدات ولوازم لحام)
  if (
    n.includes('لحام') ||
    n.includes('ميج') ||
    n.includes('فاز') ||
    n.includes('شاشه لحام') ||
    n.includes('fume') ||
    n.includes('efu')
  ) {
    return 'معدات ولوازم لحام'
  }

  // 4. Safety gear & occupational health (مهمات وسلامة مهنية)
  if (
    n.includes('نظار') ||
    n.includes('جوانتي') ||
    n.includes('كمام') ||
    n.includes('خوذ') ||
    n.includes('امان')
  ) {
    return 'مهمات وسلامة مهنية'
  }

  // 5. Woodworking & carpentry (نجارة وأخشاب)
  if (
    n.includes('خشب') ||
    n.includes('ترابيز') ||
    n.includes('اركت') ||
    n.includes('تخانه') ||
    n.includes('رابوه') ||
    n.includes('فاره')
  ) {
    return 'نجارة وأخشاب'
  }

  // 6. Furnaces, ovens & presses (أفران ومكابس)
  if (
    n.includes('فرن') ||
    n.includes('مكبس') ||
    n.includes('هيدروليك')
  ) {
    return 'أفران ومكابس'
  }

  // 7. Drilling, milling & threading (ثقب وتفريز وقلاووظ)
  if (
    n.includes('مثقاب') ||
    n.includes('شانيور') ||
    n.includes('قلاووظ') ||
    n.includes('قلاوظ') ||
    n.includes('بلص') ||
    n.includes('بنط') ||
    n.includes('فريز') ||
    n.includes('تفريز')
  ) {
    return 'ثقب وتفريز وقلاووظ'
  }

  // Hand saws vs machine saws
  if (n.includes('منشار يدوي') || n.includes('قوس منشار') || n.includes('سلاح منشار')) {
    return 'عدد وأدوات يدوية'
  }

  // 8. Workshop Machinery & power saws (ماكينات ومعدات ورش)
  if (
    n.includes('ماكين') ||
    n.includes('مخرط') ||
    n.includes('تجليخ') ||
    n.includes('تني') ||
    n.includes('ثني') ||
    n.includes('مقص') ||
    n.includes('منشار') ||
    n.includes('كمبروسر') ||
    n.includes('مقشط') ||
    n.includes('صاروخ') ||
    n.includes('صنيه دواره')
  ) {
    return 'ماكينات ومعدات ورش'
  }

  // 9. Hand tools & fixtures (عدد وأدوات يدوية)
  if (
    n.includes('كماش') ||
    n.includes('شاكوش') ||
    n.includes('مفك') ||
    n.includes('ازميل') ||
    n.includes('مبرد') ||
    n.includes('مرزب') ||
    n.includes('طقم عدد') ||
    n.includes('عده') ||
    n.includes('مفتاح') ||
    n.includes('زرادي') ||
    n.includes('بنس') ||
    n.includes('منجله') ||
    n.includes('لقط') ||
    n.includes('تثبيت') ||
    n.includes('استاند')
  ) {
    return 'عدد وأدوات يدوية'
  }

  return 'أخرى'
}

