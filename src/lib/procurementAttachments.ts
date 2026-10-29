/**
 * src/lib/procurementAttachments.ts
 *
 * خدمة إدارة المرفقات السحابية والمحلية لموديولات المشتريات والعقود والعهدة.
 * تدعم الرفع إلى Supabase Storage والتخزين الذاتي Base64 للحفظ بدون إنترنت أو في النسخ الاحتياطية.
 */

import { supabase } from './supabase'

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

export interface AttachmentValidationResult {
  isValid: boolean
  error?: string
}

/**
 * التحقق من نوع وحجم الملف قبل محاولة الرفع أو المعالجة
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

  // السماح بملفات الصور والمستندات
  if (
    !ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type) &&
    !file.type.startsWith('image/') &&
    !file.name.match(/\.(pdf|doc|docx|xls|xlsx|txt|png|jpg|jpeg|webp)$/i)
  ) {
    return {
      isValid: false,
      error: 'نوع الملف غير مدعوم. يرجى اختيار ملف مستند (PDF, Word, Excel) أو صورة (JPG, PNG, WebP).',
    }
  }

  return { isValid: true }
}

/**
 * تحويل الملف إلى Base64 Data URL لحفظه محلياً وفي النسخ الاحتياطية
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('تعذر قراءة محتوى الملف'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('فشلت قراءة الملف'))
    reader.readAsDataURL(file)
  })
}

/**
 * تنزيل المرفق تلقائياً إلى جهاز المستخدم
 */
export function downloadAttachment(urlOrDataUrl: string, fileName: string): void {
  if (typeof document === 'undefined') return
  const anchor = document.createElement('a')
  anchor.href = urlOrDataUrl
  anchor.download = fileName || 'مستند_مرفق'
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

/**
 * رفع ملف مرفق إلى الـ Bucket السحابي (procurement-attachments)
 */
export async function uploadProcurementAttachment(
  entityFolder: 'requests' | 'quotes' | 'orders' | 'contracts',
  entityId: string,
  file: File
): Promise<{ path: string; publicUrl?: string }> {
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

  let publicUrl: string | undefined
  try {
    const { data: publicData } = supabase.storage.from('procurement-attachments').getPublicUrl(data.path)
    publicUrl = publicData.publicUrl
  } catch {
    // ignore
  }

  return { path: data.path, publicUrl }
}

/**
 * إنشاء رابط مؤقت موقع لقراءة / تحميل المرفق بأمان
 */
export async function getSignedAttachmentUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  if (!supabase) throw new Error('لا يوجد اتصال بقاعدة البيانات السحابية.')

  const { data, error } = await supabase.storage
    .from('procurement-attachments')
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'تعذر استخراج رابط التحميل المؤقت للملف.')
  }

  return data.signedUrl
}
