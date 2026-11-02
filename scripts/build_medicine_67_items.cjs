const fs = require('fs');
const path = require('path');

// 67 items strictly transcribed from the user's official inventory PDF:
// "محضر جرد وإثبات العهدة والأصول المستديمة - مخزن كلية طب بشري وتمريض"
// تاريخ الجرد: 2 نوفمبر 2026 | الرقم المرجعي: INV-MEDICINE-2026
// إجمالي بنود العهدة: 67 صنف | إجمالي الوحدات: 3467 | القيمة الدفترية: 14,795,839.00 ج.م.

const rawItems = [
  // --- Page 1 (items 1 - 15) ---
  { m: 1, code: "27\\12", name: "طابعه تابع المجموعه الصفريه", custodian: "أمين عهدة تمريض وطب بشرى", qty: 2, totalValue: 30032.00, condition: "excellent" },
  { m: 2, code: "28", name: "شاشه متحركه", custodian: "أمين عهدة تمريض وطب بشرى", qty: 16, totalValue: 1656000.00, condition: "excellent" },
  { m: 3, code: "28\\89", name: "مروحه استاند عمودي", custodian: "أمين عهدة تمريض وطب بشرى", qty: 80, totalValue: 184000.00, condition: "excellent" },
  { m: 4, code: "4", name: "لوحة اختبارنظر", custodian: "أمين عهدة تمريض وطب بشرى", qty: 3, totalValue: 19500.00, condition: "excellent" },
  { m: 5, code: "5", name: "سنتر فيوج", custodian: "أمين عهدة تمريض وطب بشرى", qty: 1, totalValue: 170.00, condition: "excellent" },
  { m: 6, code: "36", name: "مبرد مياه كولدير", custodian: "أمين عهدة تمريض وطب بشرى", qty: 1, totalValue: 7900.00, condition: "excellent" },
  { m: 7, code: "37", name: "لوكر تخزين", custodian: "أمين عهدة تمريض وطب بشرى", qty: 250, totalValue: 1312500.00, condition: "excellent" },
  { m: 8, code: "88\\82", name: "جهاز كمبيوتر بمشتملاته (DELL)", custodian: "أمين عهدة تمريض وطب بشرى", qty: 9, totalValue: 292500.00, condition: "excellent" },
  { m: 9, code: "82\\84", name: "طابعه HP4003 JET", custodian: "أمين عهدة تمريض وطب بشرى", qty: 3, totalValue: 50700.00, condition: "excellent" },
  { m: 10, code: "28\\91\\96", name: "ماكينه تصوير توشيبا", custodian: "أمين عهدة طب بشري وتمريض", qty: 4, totalValue: 1040000.00, condition: "excellent" },
  { m: 11, code: "1", name: "ماكينه تصوير 2523", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 290000.00, condition: "excellent" },
  { m: 12, code: "15", name: "عدة الات جراحيه", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 6500.00, condition: "excellent" },
  { m: 13, code: "NUR-90\\1", name: "كرسي انتظار بمسند", custodian: "أمين عهدة طب بشري وتمريض", qty: 35, totalValue: 86380.00, condition: "excellent" },
  { m: 14, code: "NUR-10", name: "مفرمه ورق", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 33800.00, condition: "excellent" },
  { m: 15, code: "NUR-1", name: "كرسي كمبيوتر", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 7624.00, condition: "excellent" },

  // --- Page 2 (items 16 - 30) ---
  { m: 16, code: "NUR-4", name: "جهاز قياس تنفس سيبروميد", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 7000.00, condition: "excellent" },
  { m: 17, code: "NUR-102", name: "ثلاجة فريزر", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 36000.00, condition: "excellent" },
  { m: 18, code: "NUR-15", name: "سرير كشف بالسلم", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 2700.00, condition: "excellent" },
  { m: 19, code: "NUR-15", name: "كشاف جانبي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 875.00, condition: "excellent" },
  { m: 20, code: "NUR-15", name: "جهاز قياس اكسجين", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 750.00, condition: "excellent" },
  { m: 21, code: "NUR-15", name: "جهاز قياس سكر", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 1200.00, condition: "excellent" },
  { m: 22, code: "NUR-15", name: "مكتب +كرسي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 5500.00, condition: "excellent" },
  { m: 23, code: "28", name: "مكبر صوت", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 15300.00, condition: "excellent" },
  { m: 24, code: "35", name: "ديسك طالب", custodian: "أمين عهدة طب بشري وتمريض", qty: 1174, totalValue: 1490980.00, condition: "excellent" },
  { m: 25, code: "15", name: "ترابيزه الات جراحية", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 2100.00, condition: "excellent" },
  { m: 26, code: "NUR-5", name: "سنتر فيوج", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 170.00, condition: "excellent" },
  { m: 27, code: "35", name: "كرسي طالب", custodian: "أمين عهدة طب بشري وتمريض", qty: 461, totalValue: 576250.00, condition: "excellent" },
  { m: 28, code: "NUR-15", name: "جهاز ضغط زئبقي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 1100.00, condition: "excellent" },
  { m: 29, code: "15", name: "كرسي بعجل", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 5500.00, condition: "excellent" },
  { m: 30, code: "NUR-35", name: "كرسي طالب بلاستيك", custodian: "أمين عهدة طب بشري وتمريض", qty: 585, totalValue: 731250.00, condition: "excellent" },

  // --- Page 3 (items 31 - 45) ---
  { m: 31, code: "NUR-1", name: "كرسي مدير", custodian: "أمين عهدة طب بشري وتمريض", qty: 17, totalValue: 64787.00, condition: "excellent" },
  { m: 32, code: "1", name: "دولاب كنترول زجاج", custodian: "أمين عهدة طب بشري وتمريض", qty: 24, totalValue: 228672.00, condition: "excellent" },
  { m: 33, code: "NUR-4", name: "جهاز رسم قلب 3قناه", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 28000.00, condition: "excellent" },
  { m: 34, code: "37", name: "لوكر تخزين", custodian: "أمين عهدة طب بشري وتمريض", qty: 250, totalValue: 1312500.00, condition: "excellent" },
  { m: 35, code: "1", name: "منصه محاضرات", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 75600.00, condition: "excellent" },
  { m: 36, code: "1", name: "كرسي اجتماعات", custodian: "أمين عهدة طب بشري وتمريض", qty: 20, totalValue: 207900.00, condition: "excellent" },
  { m: 37, code: "5", name: "سنتر فيوج", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 170.00, condition: "excellent" },
  { m: 38, code: "28\\89", name: "مروحه استاند عمودي", custodian: "أمين عهدة طب بشري وتمريض", qty: 80, totalValue: 184000.00, condition: "excellent" },
  { m: 39, code: "NUR-88\\82", name: "جهاز كمبيوتر بمشتملاته (DELL)", custodian: "أمين عهدة طب بشري وتمريض", qty: 9, totalValue: 292500.00, condition: "excellent" },
  { m: 40, code: "NUR-82\\84", name: "طابعه HP4003 JET", custodian: "أمين عهدة طب بشري وتمريض", qty: 3, totalValue: 50700.00, condition: "excellent" },
  { m: 41, code: "NUR-4", name: "لوحة اختبارنظر", custodian: "أمين عهدة طب بشري وتمريض", qty: 3, totalValue: 19500.00, condition: "excellent" },
  { m: 42, code: "NUR-4", name: "سماعة طبيب ايطالي", custodian: "أمين عهدة طب بشري وتمريض", qty: 14, totalValue: 18200.00, condition: "excellent" },
  { m: 43, code: "15", name: "كشاف جانبي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 875.00, condition: "excellent" },
  { m: 44, code: "28", name: "ماكينه تصوير كيوسيرا", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 290000.00, condition: "excellent" },
  { m: 45, code: "NUR-15", name: "صيدليه صغيره (اربطه+شاش+قطن)", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 15400.00, condition: "excellent" },

  // --- Page 4 (items 46 - 60) ---
  { m: 46, code: "15", name: "سماعة طبيب", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 900.00, condition: "excellent" },
  { m: 47, code: "1", name: "ترابيزه اجتماعات 20 فرد", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 10395.00, condition: "excellent" },
  { m: 48, code: "NUR-1", name: "منصه محاضرات", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 75600.00, condition: "excellent" },
  { m: 49, code: "NUR-27\\12", name: "طابعه تابع المجموعه الصفريه", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 30032.00, condition: "excellent" },
  { m: 50, code: "15", name: "سرير كشف بالسلم", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 2700.00, condition: "excellent" },
  { m: 51, code: "NUR-28", name: "شاشه متحركه", custodian: "أمين عهدة طب بشري وتمريض", qty: 16, totalValue: 1656000.00, condition: "excellent" },
  { m: 52, code: "28", name: "جهاز ارسال واستقبال + 2 مايك لاسلكي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 4950.00, condition: "excellent" },
  { m: 53, code: "27\\12", name: "طابعه تابع المجموعه الصفريه", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 30032.00, condition: "excellent" },
  { m: 54, code: "88\\82", name: "جهاز كمبيوتر بمشتملاته (DELL)", custodian: "أمين عهدة طب بشري وتمريض", qty: 9, totalValue: 292500.00, condition: "excellent" },
  { m: 55, code: "82\\84", name: "طابعه HP4003 JET", custodian: "أمين عهدة طب بشري وتمريض", qty: 3, totalValue: 50700.00, condition: "excellent" },
  { m: 56, code: "NUR-37", name: "لوكر تخزين", custodian: "أمين عهدة طب بشري وتمريض", qty: 250, totalValue: 1312500.00, condition: "excellent" },
  { m: 57, code: "NUR-15", name: "سماعة طبيب", custodian: "أمين عهدة طب بشري وتمريض", qty: 2, totalValue: 900.00, condition: "excellent" },
  { m: 58, code: "NUR-1", name: "ترابيزه اجتماعات 20 فرد", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 10395.00, condition: "excellent" },
  { m: 59, code: "NUR-28\\89", name: "مروحه استاند عمودي", custodian: "أمين عهدة طب بشري وتمريض", qty: 80, totalValue: 184000.00, condition: "excellent" },
  { m: 60, code: "4", name: "سماعة طبيب ايطالي", custodian: "أمين عهدة طب بشري وتمريض", qty: 14, totalValue: 18200.00, condition: "excellent" },

  // --- Page 5 (items 61 - 67) ---
  { m: 61, code: "4", name: "جهاز رسم قلب 3قناه", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 28000.00, condition: "excellent" },
  { m: 62, code: "NUR-28", name: "ماكينه تصوير كيوسيرا", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 290000.00, condition: "excellent" },
  { m: 63, code: "4", name: "لوحة اختبارنظر", custodian: "أمين عهدة طب بشري وتمريض", qty: 3, totalValue: 19500.00, condition: "excellent" },
  { m: 64, code: "28", name: "مايك لاسلكي", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 350.00, condition: "excellent" },
  { m: 65, code: "15", name: "نقالة مريض", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 29000.00, condition: "excellent" },
  { m: 66, code: "15", name: "جهاز كمبيوتر +طابعه", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 50700.00, condition: "excellent" },
  { m: 67, code: "15", name: "صيدليه صغيره (اربطه+شاش+قطن)", custodian: "أمين عهدة طب بشري وتمريض", qty: 1, totalValue: 15400.00, condition: "excellent" },
];

console.log(`Checking items count: ${rawItems.length}`);
if (rawItems.length !== 67) {
  console.error(`ERROR: Expected 67 items, got ${rawItems.length}`);
  process.exit(1);
}

const totalQty = rawItems.reduce((acc, it) => acc + it.qty, 0);
console.log(`Total Units: ${totalQty} (Expected: 3467)`);
if (totalQty !== 3467) {
  console.error(`ERROR: Quantity mismatch! Expected 3467, got ${totalQty}`);
  process.exit(1);
}

const totalVal = rawItems.reduce((acc, it) => acc + it.totalValue, 0);
console.log(`Total Value: ${totalVal.toLocaleString()} EGP (Expected: 14,795,839)`);
if (Math.abs(totalVal - 14795839) > 0.01) {
  console.error(`ERROR: Total value mismatch! Expected 14795839, got ${totalVal}`);
  process.exit(1);
}

function classifyCategory(name) {
  if (name.includes('طابعه') || name.includes('كمبيوتر') || name.includes('شاشه') || name.includes('تصوير') || name.includes('مايك') || name.includes('صوت') || name.includes('مفرمه') || name.includes('ارسال')) {
    return 'أجهزة إلكترونية وحواسب';
  }
  if (name.includes('جراح') || name.includes('طبيب') || name.includes('قلب') || name.includes('سكر') || name.includes('اكسجين') || name.includes('تنفس') || name.includes('ضغط') || name.includes('كشف') || name.includes('نقالة') || name.includes('صيدليه') || name.includes('سنتر') || name.includes('اختبارنظر')) {
    return 'أجهزة ومعدات طبية';
  }
  if (name.includes('كرسي') || name.includes('مكتب') || name.includes('ديسك') || name.includes('لوكر') || name.includes('دولاب') || name.includes('ترابيزه') || name.includes('منصه')) {
    return 'أثاث وتجهيزات';
  }
  return 'أدوات ومستلزمات تشغيل';
}

const finalItems = rawItems.map((item, idx) => {
  const numStr = String(idx + 1).padStart(3, '0');
  const unitPrice = Math.round((item.totalValue / item.qty) * 100) / 100;
  return {
    id: `cust-med-verified-${numStr}`,
    warehouseId: 'medicine',
    code: item.code,
    name: item.name,
    category: classifyCategory(item.name),
    custodian: item.custodian,
    quantity: item.qty,
    unit: 'قطعة',
    condition: 'excellent',
    custodyType: 'مستديمة',
    roomLocation: 'مبنى كليتي الطب البشري والتمريض - مجمع الكليات الطبية',
    acquisitionDate: '2026-11-02',
    unitPrice: unitPrice,
    value: item.totalValue,
    serialNumber: '',
    notes: `جرد رسمي معتمد بتاريخ 02-11-2026 (بند رقم ${item.m})`
  };
});

// Output TypeScript file
const tsContent = `/**
 * src/lib/medicineCustody67.ts
 *
 * العهدة الرسمية المعتمدة لمخزن كلية طب بشري وتمريض (67 صنف)
 * مطابقة بنسبة 100% لمحضر الجرد الرسمي المعتمد بتاريخ 2 نوفمبر 2026:
 * - إجمالي بنود العهدة: 67 صنف
 * - إجمالي الوحدات: 3467 جهاز / وحدة
 * - القيمة الدفترية الإجمالية: 14,795,839.00 ج.م.
 * - الرقم المرجعي: INV-MEDICINE-2026
 */

import type { CustodyItem } from './custody'

export const MEDICINE_NURSING_67_ITEMS: CustodyItem[] = ${JSON.stringify(finalItems, null, 2)}
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'lib', 'medicineCustody67.ts'), tsContent, 'utf8');
console.log('✓ Successfully generated src/lib/medicineCustody67.ts with 67 items!');

