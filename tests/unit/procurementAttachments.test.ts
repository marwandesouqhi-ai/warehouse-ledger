import { describe, it, expect, vi } from 'vitest'
import {
  validateAttachmentFile,
  uploadProcurementAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../../src/lib/procurementAttachments'
import { supabase } from '../../src/lib/supabase'

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(),
    },
  },
}))

describe('Procurement Attachments Validation & Storage Suite', () => {
  it('rejects files larger than 10MB', () => {
    const largeFile = new File(['x'.repeat(100)], 'test.pdf', { type: 'application/pdf' })
    Object.defineProperty(largeFile, 'size', { value: MAX_ATTACHMENT_SIZE_BYTES + 1024 })

    const res = validateAttachmentFile(largeFile)
    expect(res.isValid).toBe(false)
    expect(res.error).toContain('يتجاوز الحد الأقصى')
  })

  it('rejects unsupported file mime types (e.g. executables or zip files)', () => {
    const exeFile = new File(['bin'], 'malware.exe', { type: 'application/x-msdownload' })
    const res = validateAttachmentFile(exeFile)
    expect(res.isValid).toBe(false)
    expect(res.error).toContain('نوع الملف غير مدعوم')
  })

  it('accepts valid PDF, PNG, and JPEG files within size limits', () => {
    const validPdf = new File(['pdf-content'], 'quotation.pdf', { type: 'application/pdf' })
    const validJpg = new File(['jpg-content'], 'scan.jpg', { type: 'image/jpeg' })
    const validPng = new File(['png-content'], 'stamp.png', { type: 'image/png' })

    expect(validateAttachmentFile(validPdf).isValid).toBe(true)
    expect(validateAttachmentFile(validJpg).isValid).toBe(true)
    expect(validateAttachmentFile(validPng).isValid).toBe(true)
  })

  it('uploadProcurementAttachment invokes storage bucket upload', async () => {
    const mockUpload = vi.fn().mockResolvedValue({
      data: { path: 'requests/req-1/sample.pdf' },
      error: null,
    })

    vi.mocked(supabase!.storage.from).mockReturnValue({
      upload: mockUpload,
    } as any)

    const validPdf = new File(['pdf-content'], 'quotation.pdf', { type: 'application/pdf' })
    const res = await uploadProcurementAttachment('requests', 'req-1', validPdf)

    expect(res.path).toBe('requests/req-1/sample.pdf')
    expect(supabase!.storage.from).toHaveBeenCalledWith('procurement-attachments')
  })
})
