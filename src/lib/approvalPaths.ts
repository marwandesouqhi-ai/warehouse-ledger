/**
 * src/lib/approvalPaths.ts
 *
 * تعريف مسار الموافقات الافتراضي لطلبات الشراء في المؤسسة.
 * ملف مركزي واحد لتسهيل أي تعديل مستقبلي عند ورود لائحة المشتريات المالية المحدثة.
 */

export interface ApprovalStepDef {
  stepNo: number
  stepName: string
  defaultRole: string
  description?: string
}

export const DEFAULT_APPROVAL_PATH: ApprovalStepDef[] = [
  {
    stepNo: 1,
    stepName: 'مدير القسم الطالب',
    defaultRole: 'مدير القسم / الكلية',
    description: 'التحقق من الاحتياج الفعلي ومطابقة المواصفات المطلوبة.',
  },
  {
    stepNo: 2,
    stepName: 'مسؤول المشتريات',
    defaultRole: 'رئيس قسم المشتريات',
    description: 'مراجعة نوع الشراء والأسعار التقديرية وتحديد طريقة الشراء.',
  },
  {
    stepNo: 3,
    stepName: 'الإدارة المالية والمراجعة',
    defaultRole: 'المراقب المالي',
    description: 'التأكد من مطابقة اللائحة وتوفر الاعتماد المالي.',
  },
  {
    stepNo: 4,
    stepName: 'لجنة البت والاعتماد النهائي',
    defaultRole: 'لجنة البت / السلطة المختصة',
    description: 'الاعتماد النهائي وإصدار الإذن ببدء جمع العروض وإصدار أمر الشراء.',
  },
]
