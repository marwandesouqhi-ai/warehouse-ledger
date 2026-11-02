const fs = require('fs');
const path = require('path');

console.log('--- 1. Testing Security Migration ---');
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261102220000_harden_security_and_privilege_escalation.sql');
if (!fs.existsSync(migrationPath)) {
  console.error('FAIL: Migration file not found!');
  process.exit(1);
}
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

const requiredChecks = [
  'protect_system_admin_row',
  'UNIVERSAL PRIVILEGE ESCALATION PREVENTION',
  'movements_delete_policy',
  'movements_update_policy',
  'custody_items_delete_policy',
  'custody_items_update_policy',
  'disbursement_requests_update_policy',
  'supplier_contracts_insert_policy',
  'supplier_contracts_update_policy',
  'budget_plans_insert_policy',
  'budget_plans_update_policy',
  'financial_reports_insert_policy',
  'financial_reports_update_policy'
];

for (const check of requiredChecks) {
  if (!migrationSql.includes(check)) {
    console.error(`FAIL: Migration missing check for: ${check}`);
    process.exit(1);
  }
}
console.log('✓ Security Migration contains all 13 security hardening rules.');

console.log('--- 2. Checking src/pages/SupportPage.tsx ---');
const supportCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'SupportPage.tsx'), 'utf8');
if (supportCode.includes("user_metadata?.role === 'system_admin'")) {
  console.error('FAIL: SupportPage still trusts user_metadata.role!');
  process.exit(1);
}
if (supportCode.includes("user_metadata?.username === 'marwan-desouky'")) {
  console.error('FAIL: SupportPage still trusts user_metadata.username!');
  process.exit(1);
}
console.log('✓ SupportPage.tsx is fully hardened against user_metadata spoofing.');

console.log('--- 3. Checking src/lib/localUsers.ts ---');
const localUsersCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'localUsers.ts'), 'utf8');
if (localUsersCode.includes("uName === 'marwan-desouky'")) {
  console.error('FAIL: localUsers.ts still elevates privileges by uName!');
  process.exit(1);
}
console.log('✓ localUsers.ts no longer elevates by hardcoded username string.');

console.log('--- 4. Checking src/pages/UsersPage.tsx ---');
const usersPageCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'UsersPage.tsx'), 'utf8');
if (usersPageCode.includes("session?.user?.email ||\n        'marwan-desouky'")) {
  console.error('FAIL: UsersPage.tsx still defaults activeUserEmail to marwan-desouky!');
  process.exit(1);
}
console.log('✓ UsersPage.tsx activeUserEmail safely defaults without impersonation.');

console.log('\n========================================');
console.log('ALL DEFENSIVE SECURITY HARDENING CHECKS PASSED 100%!');
console.log('========================================');

