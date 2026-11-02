const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('data/نموذج_استيراد_الورش_الهندسية.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1);

function normalize(t) {
  if (!t) return '';
  return String(t)
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ');
}

function classifyWorkshopItem(name) {
  const n = normalize(name);
  if (!n) return 'أخرى';
  if (
    n.includes('قدم') || n.includes('ميكروميتر') || n.includes('زاوي') || n.includes('فيلر') ||
    n.includes('قياس') || n.includes('متر') || n.includes('gauge') || n.includes('geuge') ||
    n.includes('protractor') || n.includes('protraltor') || n.includes('بلوكات') || n.includes('برجل') ||
    n.includes('علام') || n.includes('زنبه') || n.includes('زمبه') || n.includes('شوكه') ||
    n.includes('شوكة') || n.includes('تخطيط') || n.includes('استعدال')
  ) return 'أدوات وأجهزة قياس';
  if (
    n.includes('بوتقه') || n.includes('سباك') || n.includes('روازق') || n.includes('سندال') ||
    n.includes('سداق') || n.includes('نماذج') || n.includes('شباك بوتقه') || n.includes('شيال') ||
    (n.includes('زهر') && !n.includes('تخطيط'))
  ) return 'سباكة وقوالب ومعادن';
  if (n.includes('لحام') || n.includes('ميج') || n.includes('فاز') || n.includes('شاشه لحام') || n.includes('fume') || n.includes('efu')) return 'معدات ولوازم لحام';
  if (n.includes('نظار') || n.includes('جوانتي') || n.includes('كمام') || n.includes('خوذ') || n.includes('امان')) return 'مهمات وسلامة مهنية';
  if (n.includes('خشب') || n.includes('ترابيز') || n.includes('اركت') || n.includes('تخانه') || n.includes('رابوه') || n.includes('فاره')) return 'نجارة وأخشاب';
  if (n.includes('فرن') || n.includes('مكبس') || n.includes('هيدروليك')) return 'أفران ومكابس';
  if (n.includes('مثقاب') || n.includes('شانيور') || n.includes('قلاووظ') || n.includes('قلاوظ') || n.includes('بلص') || n.includes('بنط') || n.includes('فريز') || n.includes('تفريز')) return 'ثقب وتفريز وقلاووظ';
  if (n.includes('منشار يدوي') || n.includes('قوس منشار') || n.includes('سلاح منشار')) return 'عدد وأدوات يدوية';
  if (n.includes('ماكين') || n.includes('مخرط') || n.includes('تجليخ') || n.includes('تني') || n.includes('ثني') || n.includes('مقص') || n.includes('منشار') || n.includes('كمبروسر') || n.includes('مقشط') || n.includes('صاروخ') || n.includes('صنيه دواره')) return 'ماكينات ومعدات ورش';
  if (n.includes('كماش') || n.includes('شاكوش') || n.includes('مفك') || n.includes('ازميل') || n.includes('مبرد') || n.includes('مرزب') || n.includes('طقم عدد') || n.includes('عده') || n.includes('مفتاح') || n.includes('زرادي') || n.includes('بنس') || n.includes('منجله') || n.includes('لقط') || n.includes('تثبيت') || n.includes('استاند')) return 'عدد وأدوات يدوية';
  return 'أخرى';
}

function parseDate(dStr) {
  if (!dStr) return '2025-01-01';
  const parts = String(dStr).split(/\\|\//);
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return y + '-' + m + '-' + d;
  }
  return '2025-01-01';
}

const items = rows.map((r, i) => {
  const code = 'WS-' + String(i + 1).padStart(4, '0');
  const name = String(r[1] || '').trim().replace(/\s+/g, ' ');
  const category = classifyWorkshopItem(name);
  const custodian = String(r[3] || 'أمين عهدة الورش الهندسية').trim();
  const quantity = typeof r[4] === 'number' ? r[4] : (parseInt(r[4], 10) || 1);
  const unit = String(r[5] || 'قطعة').trim() || 'قطعة';
  const rawPrice = r[6];
  const unitPrice = (rawPrice !== undefined && rawPrice !== null && rawPrice !== '' && !isNaN(rawPrice)) ? Number(rawPrice) : 0;
  const value = quantity * unitPrice;
  const custodyType = 'مستديمة';
  const condition = 'excellent';
  const roomLocation = String(r[9] || 'الورش الهندسية').trim();
  const acquisitionDate = parseDate(r[10]);
  const serialNumber = '';
  const notes = '';
  return {
    id: 'cust-ws-' + String(i + 1).padStart(3, '0'),
    warehouseId: 'engineering_workshops',
    code,
    name,
    category,
    custodian,
    quantity,
    unit,
    unitPrice,
    value,
    condition,
    custodyType,
    roomLocation,
    acquisitionDate,
    serialNumber,
    notes,
    importBatchId: 'ws-import-2026-11-02'
  };
});

const tsCode = `import type { CustodyItem } from './custody'

export const WORKSHOP_IMPORT_BATCH_ID = 'ws-import-2026-11-02'

export const ENGINEERING_WORKSHOPS_81_ITEMS: CustodyItem[] = ` + JSON.stringify(items, null, 2) + `
`;

fs.writeFileSync('src/lib/engineeringWorkshopsCustody81.ts', tsCode, 'utf8');
console.log('Saved src/lib/engineeringWorkshopsCustody81.ts successfully with ' + items.length + ' items!');

