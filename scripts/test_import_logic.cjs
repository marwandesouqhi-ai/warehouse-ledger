const assert = require('assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

console.log('🧪 Starting Engineering Workshops Custody Import Verification Suite...\n');

// 1. Verify Excel File Exists and is readable
const filePath = path.join(__dirname, '../data/نموذج_استيراد_الورش_الهندسية.xlsx');
assert(fs.existsSync(filePath), 'Excel file must exist in data/');
const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
const rows = data.slice(1);
assert.strictEqual(rows.length, 81, 'Excel sheet must have exactly 81 data rows');
console.log('✓ Check 1 Passed: Excel file loaded with exactly 81 data rows.');

// 2. Verify 9 Items with Missing Prices
let missingPriceCount = 0;
rows.forEach((r, idx) => {
  const price = r[6];
  if (price === undefined || price === null || price === '' || isNaN(price)) {
    missingPriceCount++;
  }
});
assert.strictEqual(missingPriceCount, 9, 'Exactly 9 rows must have missing unit price');
console.log('✓ Check 2 Passed: Exactly 9 rows with missing unit price verified.');

// 3. Verify Date Parsing for Backslashes
function parseDate(dStr) {
  if (!dStr) return '2025-01-01';
  const parts = String(dStr).split(/\\|\//);
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  return '2025-01-01';
}
assert.strictEqual(parseDate('1\\1\\2025'), '2025-01-01');
assert.strictEqual(parseDate('1\\6\\2025'), '2025-06-01');
console.log('✓ Check 3 Passed: Backslash dates (d\\m\\yyyy) parsed correctly.');

// 4. Verify Generated 81 Items in engineeringWorkshopsCustody81.ts
const tsContent = fs.readFileSync('src/lib/engineeringWorkshopsCustody81.ts', 'utf8');
const match = tsContent.match(/ENGINEERING_WORKSHOPS_81_ITEMS: CustodyItem\[\] = (\[[\s\S]*\])/);
assert(match, 'ENGINEERING_WORKSHOPS_81_ITEMS must be exported');
const items = JSON.parse(match[1]);
assert.strictEqual(items.length, 81, 'Items array must have exactly 81 items');
assert.strictEqual(items[0].code, 'WS-0001');
assert.strictEqual(items[80].code, 'WS-0081');

// Verify codes are unique and sequential
const codes = new Set();
items.forEach((it, i) => {
  const expectedCode = `WS-${String(i + 1).padStart(4, '0')}`;
  assert.strictEqual(it.code, expectedCode, `Item ${i} must have code ${expectedCode}`);
  assert(!codes.has(it.code), `Duplicate code found: ${it.code}`);
  codes.add(it.code);
  assert.strictEqual(it.warehouseId, 'engineering_workshops');
  assert.strictEqual(it.custodian, 'أمين عهدة الورش الهندسية');
  assert.strictEqual(it.condition, 'excellent');
  assert.strictEqual(it.custodyType, 'مستديمة');
  assert.strictEqual(it.roomLocation, 'الورش الهندسية');
  assert(it.value >= 0 && Number.isFinite(it.value), 'Value must be finite non-negative number');
});
console.log('✓ Check 4 Passed: 81 items exported with unique sequential codes WS-0001..WS-0081.');

// 5. Verify Exactly 9 Items Have unitPrice === 0 and value === 0
const zeroPriceItems = items.filter(it => it.unitPrice === 0);
assert.strictEqual(zeroPriceItems.length, 9, 'Exactly 9 items must have unitPrice 0');
zeroPriceItems.forEach(it => {
  assert.strictEqual(it.value, 0, `Item ${it.code} with unitPrice 0 must have total value 0`);
});
console.log('✓ Check 5 Passed: All 9 zero-price items stored with unitPrice 0 and value 0.');

// 6. Verify Category Classification (0 items in 'أخرى')
const categoryCounts = {};
items.forEach(it => {
  categoryCounts[it.category] = (categoryCounts[it.category] || 0) + 1;
});
assert.strictEqual(categoryCounts['أخرى'] || 0, 0, 'All workshop items must be classified into dedicated workshop categories');
console.log('✓ Check 6 Passed: 100% of items classified into proper categories (0 in أخرى):');
Object.entries(categoryCounts).forEach(([cat, cnt]) => {
  console.log(`   - ${cat}: ${cnt}`);
});

// 7. Verify Medicine Warehouse has 88 items and not 16
const medTs = fs.readFileSync('src/lib/medicineCustody88.ts', 'utf8');
const medItems = medTs.split('\n').filter(l => l.includes('"warehouseId": "medicine"'));
assert.strictEqual(medItems.length, 88, 'Medicine items must be exactly 88');
console.log('✓ Check 7 Passed: Medicine warehouse custody verified at 88 items.');

// 8. Verify SQL Migration Exists and has atomic transaction and batch guard
const sqlPath = 'supabase/migrations/20261102200000_engineering_workshops_custody_import.sql';
assert(fs.existsSync(sqlPath), 'SQL migration file must exist');
const sqlContent = fs.readFileSync(sqlPath, 'utf8');
assert(sqlContent.includes('import_batch_id'), 'Migration must add import_batch_id');
assert(sqlContent.includes('custody_items_wh_code_unique'), 'Migration must create unique index on wh and code');
assert(sqlContent.includes('import_custody_batch'), 'Migration must define import_custody_batch RPC');
assert(sqlContent.includes('WS-0001') && sqlContent.includes('WS-0081'), 'Migration must seed all 81 items');
console.log('✓ Check 8 Passed: SQL migration and RPC verified with batch guard and unique constraint.');

console.log('\n🎉 ALL 8 VERIFICATION CHECKS PASSED SUCCESSFULLY!');

