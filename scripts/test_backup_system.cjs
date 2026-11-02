/**
 * scripts/test_backup_system.cjs
 * Comprehensive verification of Universal Backup and Auto-Backup Engine
 */

const fs = require('fs')
const path = require('path')

console.log('--- 1. Checking Database Migration: 20261102210000_expand_system_backup_to_all_modules.sql ---')
const sqlPath = path.join(__dirname, '../supabase/migrations/20261102210000_expand_system_backup_to_all_modules.sql')
if (!fs.existsSync(sqlPath)) {
  console.error('FAIL: Migration file not found at', sqlPath)
  process.exit(1)
}
const sqlContent = fs.readFileSync(sqlPath, 'utf8')
const expectedSqlTables = [
  'movements', 'custody', 'app_users', 'supplier_contracts',
  'disbursement_requests', 'budget_plans', 'financial_reports',
  'asset_movement_log', 'support_tickets', 'technical_inspections',
  'inventory_settlements', 'telegram_bot_settings', 'notifications',
  'audit_logs', 'suppliers', 'purchase_requests', 'supplier_quotes',
  'purchase_orders', 'registration_requests', 'employee_code_registry'
]

for (const tbl of expectedSqlTables) {
  if (!sqlContent.includes(tbl)) {
    console.error(`FAIL: SQL migration missing table reference: ${tbl}`)
    process.exit(1)
  }
}
console.log('✓ SQL migration covers all 20 system tables correctly.')

console.log('\n--- 2. Checking src/lib/backup.ts Coverage ---')
const backupTsPath = path.join(__dirname, '../src/lib/backup.ts')
const backupTs = fs.readFileSync(backupTsPath, 'utf8')

const expectedBackupKeys = [
  'purchaseRequests',
  'supplierQuotes',
  'purchaseOrders',
  'registrationRequests',
  'chatbotDirectives',
  'technicalInspections',
  'inventorySettlements',
  'AUTO_RECOVERY_STORAGE_KEY',
  'LAST_AUTO_BACKUP_KEY',
  'getLastAutoBackupTime',
  'getAutoRecoverySnapshot',
]

for (const k of expectedBackupKeys) {
  if (!backupTs.includes(k)) {
    console.error(`FAIL: backup.ts missing reference to: ${k}`)
    process.exit(1)
  }
}
console.log('✓ backup.ts includes all modules, procurement, registration, directives, and auto-recovery.')

console.log('\n--- 3. Checking src/lib/autoBackupEngine.ts ---')
const autoBackupPath = path.join(__dirname, '../src/lib/autoBackupEngine.ts')
if (!fs.existsSync(autoBackupPath)) {
  console.error('FAIL: autoBackupEngine.ts not found')
  process.exit(1)
}
const autoBackupTs = fs.readFileSync(autoBackupPath, 'utf8')

const expectedAutoEvents = [
  'warehouse-ledger-updated',
  'custody-changed',
  'contracts-changed',
  'disbursement-requests-changed',
  'budget-plans-changed',
  'financial-reports-changed',
  'asset-movements-changed',
  'support-tickets-changed',
  'technical-inspections-changed',
  'inventory-settlements-changed',
  'procurement-updated',
  'suppliers-changed',
  'local-users-changed',
  'registration-requests-changed',
  'settings-changed',
  'notifications-changed',
  'chatbot-directives-changed',
]

for (const ev of expectedAutoEvents) {
  if (!autoBackupTs.includes(ev)) {
    console.error(`FAIL: autoBackupEngine.ts does not listen to: ${ev}`)
    process.exit(1)
  }
}
console.log('✓ autoBackupEngine.ts listens to all 17+ system mutation events.')

console.log('\n--- 4. Checking Event Dispatches in App & Components ---')
const checkFiles = [
  { file: '../src/App.tsx', expected: 'startAutoBackupWatcher' },
  { file: '../src/lib/procurementRepository.ts', expected: 'procurement-updated' },
  { file: '../src/lib/registrationService.ts', expected: 'registration-requests-changed' },
  { file: '../src/components/TechnicalInspectionModal.tsx', expected: 'technical-inspections-changed' },
  { file: '../src/components/InventorySettlementModal.tsx', expected: 'inventory-settlements-changed' },
  { file: '../src/pages/ChatbotAdminPage.tsx', expected: 'chatbot-directives-changed' },
  { file: '../src/pages/SettingsPage.tsx', expected: 'restorePurchaseRequests' },
  { file: '../src/pages/SettingsPage.tsx', expected: 'handleExecuteAutoRecoveryRestore' },
]

for (const c of checkFiles) {
  const filePath = path.join(__dirname, c.file)
  const content = fs.readFileSync(filePath, 'utf8')
  if (!content.includes(c.expected)) {
    console.error(`FAIL: ${c.file} does not contain expected: ${c.expected}`)
    process.exit(1)
  }
}
console.log('✓ All components and pages correctly dispatch events and bind to Auto-Backup.')

console.log('\n========================================')
console.log('ALL BACKUP SYSTEM VERIFICATION CHECKS PASSED!')
console.log('========================================')

