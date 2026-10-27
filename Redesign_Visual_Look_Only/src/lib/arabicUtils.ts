/**
 * src/lib/arabicUtils.ts
 *
 * دالة تطبيع الأسماء العربية المتطابقة تماماً مع دالة SQL normalize_arabic_name(text).
 * تستخدم لتوليد name_key للموردين ومنع التكرار والبحث المتطابق.
 * المواصفات المحددة:
 * trim + مسافات مفردة + توحيد أ/إ/آ→ا وى→ي وإزالة التشكيل
 */

export function normalizeArabicName(text: unknown): string {
  if (text == null) return ''
  let normalized = String(text).trim()

  // 1. إزالة التشكيل والحركات (tashkeel / harakat)
  normalized = normalized.replace(/[\u064B-\u065F\u0670]/g, '')

  // 2. إزالة التطويل (tatweel)
  normalized = normalized.replace(/ـ/g, '')

  // 3. توحيد الألفات (أ, إ, آ, ٱ -> ا)
  normalized = normalized.replace(/[أإآٱ]/g, 'ا')

  // 4. توحيد الألف المقصورة (ى -> ي)
  normalized = normalized.replace(/ى/g, 'ي')

  // 5. دمج المسافات المتعددة وتحويل للحروف الصغيرة (للتوافق مع أي كلمات أجنبية مختلطة)
  normalized = normalized.replace(/\s+/g, ' ').toLowerCase().trim()

  return normalized
}
