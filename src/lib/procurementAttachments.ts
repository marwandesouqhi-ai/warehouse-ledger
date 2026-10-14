/**
 * src/lib/procurementAttachments.ts
 *
 * خدمة إدارة المرفقات السحابية لموديول المشتريات (Supabase Storage: procurement-attachments).
 * تنبيه أمني: هذه الخدمة مكتملة ومختبرة في طبقة الكود، وموقوفة في واجهات المستخدم (Standby)
 * بانتظار الموافقة الصريحة لتفعيل أزرار الرفع.
 */

import { supabase } from './supabase'

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]

export interface AttachmentValidationResult {
  isValid: boolean
  error?: string
}

/**
 * التحقق من نوع وحجم الملف قبل محاولة الرفع
 */
export function validateAttachmentFile(file: File): AttachmentValidationResult {
  if (!file) {
    return { isValid: false, error: 'لم يتم تحديد أي ملف.' }
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      isValid: false,
      error: `حجم الملف (${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به (10 ميجابايت).`,
    }
  }

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type)) {
    return {
      isValid: false,
      error: 'نوع الملف غير مدعوم. الأنواع المسموح بها فقط: مستندات PDF أو صور (JPEG, PNG, WebP).',
    }
  }

  return { isValid: true }
}

/**
 * رفع ملف مرفق إلى الـ Bucket السحابي
 */
export async function uploadProcurementAttachment(
  entityFolder: 'requests' | 'quotes' | 'orders',
  entityId: string,
  file: File
): Promise<{ path: string }> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const validation = validateAttachmentFile(file)
  if (!validation.isValid) {
    throw new Error(validation.error)
  }

  const fileExt = file.name.split('.').pop() || 'bin'
  const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`
  const filePath = `${entityFolder}/${entityId}/${safeFileName}`

  const { data, error } = await supabase.storage
    .from('procurement-attachments')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error || !data) {
    throw new Error(error?.message || 'تعذر رفع الملف المرفق إلى التخزين السحابي.')
  }

  return { path: data.path }
}

/**
 * إنشاء رابط مؤقت موقع لقراءة / تحميل المرفق بأمان
 */
export async function getSignedAttachmentUrl(path: string, expiresInSeconds = 300): Promise<string> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { data, error } = await supabase.storage
    .from('procurement-attachments')
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'تعذر استخراج رابط التحميل المؤقت للملف.')
  }

  return data.signedUrl
}
