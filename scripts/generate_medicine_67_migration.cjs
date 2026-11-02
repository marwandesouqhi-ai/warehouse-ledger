const fs = require('fs');
const path = require('path');

const tsFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'medicineCustody67.ts'), 'utf8');
const jsonMatch = tsFile.match(/MEDICINE_NURSING_67_ITEMS:\s*CustodyItem\[\]\s*=\s*(\[[\s\S]*?\])\s*$/m);
if (!jsonMatch) {
  console.error('Could not parse items array from medicineCustody67.ts');
  process.exit(1);
}

const items = JSON.parse(jsonMatch[1]);

let sql = `-- ==============================================================================
-- Migration: 20261102230000_sync_medicine_nursing_67_items.sql
-- Sync official verified Human Medicine & Nursing custody items (Exact 67 items)
-- Total units: 3,467 | Total book value: 14,795,839.00 EGP
-- Reference: INV-MEDICINE-2026 (Dated: 2026-11-02)
-- ==============================================================================

-- 1. Remove old/deprecated medicine and nursing custody items to eliminate phantom deleted items
DELETE FROM public.custody_items WHERE warehouse_id IN ('medicine', 'nursing');

-- 2. Insert the exact 67 verified official inventory items
INSERT INTO public.custody_items (
  id,
  warehouse_id,
  code,
  name,
  category,
  custodian,
  quantity,
  unit,
  condition,
  custody_type,
  room_location,
  unit_price,
  value,
  notes,
  created_at
) VALUES
`;

const valueRows = items.map((it, idx) => {
  const safeName = it.name.replace(/'/g, "''");
  const safeCat = it.category.replace(/'/g, "''");
  const safeCustodian = it.custodian.replace(/'/g, "''");
  const safeRoom = (it.roomLocation || '').replace(/'/g, "''");
  const safeNotes = (it.notes || '').replace(/'/g, "''");
  const safeCode = it.code ? `'${it.code.replace(/'/g, "''")}'` : 'NULL';

  return `  (
    '${it.id}',
    'medicine',
    ${safeCode},
    '${safeName}',
    '${safeCat}',
    '${safeCustodian}',
    ${it.quantity},
    '${it.unit}',
    '${it.condition}',
    '${it.custodyType}',
    '${safeRoom}',
    ${it.unitPrice},
    ${it.value},
    '${safeNotes}',
    '2026-11-02 00:00:00+02'
  )`;
});

sql += valueRows.join(',\n') + ';\n\nNOTIFY pgrst, \'reload schema\';\n';

fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261102230000_sync_medicine_nursing_67_items.sql'), sql, 'utf8');
console.log('✓ Generated supabase/migrations/20261102230000_sync_medicine_nursing_67_items.sql successfully!');

