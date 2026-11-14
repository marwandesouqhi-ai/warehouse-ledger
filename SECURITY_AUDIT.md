# Security Audit Report — Warehouse Ledger (`warehouse-ledger`)

> **Audit Mode:** Strictly Read-Only Evidence-Based Assessment (no source code, migrations, manifests, dependencies, or configurations modified; creating this report is the sole workspace write).

---

## 1. Executive Summary

| Metadata | Value |
|---|---|
| **Audit Date** | `2026-11-12` |
| **Project Root** | `c:\Users\NewAdmin\OneDrive\Desktop\warehouse-ledger` |
| **Git `HEAD` Revision** | `92121239181270cb7a935d25a8c61386847b0bae` |
| **Initial Working Tree** | Dirty (`15` modified tracked files incl. `package.json`, `package-lock.json`, `vercel.json`, `supabase/functions/complete-activation/index.ts`, repositories, unit tests; `14` untracked `*-pablo.*` & `src/App-DESKTOP-O2AF58P.tsx` conflict copy) |
| **Pre-Existing Audit Note** | Found `reports/security-audit-report.md` (`2026-11-06`), which preceded the Nov 6–11 migrations, omitted recent regressions, and retained redacted prefixes of `.env` secrets. |
| **Overall Risk Rating** | **CRITICAL** |

### Finding Counts by Severity

| Severity | Verified Active Findings | Immediate Posture Summary |
|---|---:|---|
| **Critical** | **5** (`CRIT-01` – `CRIT-05`) | Admin Stored XSS via ticket printing; stale JWT `app_metadata` bypass on audit/purge SQL policies; Telegram OTP bypass + raw recovery/invite link hijack; unsigned `localStorage` session & plaintext `password` column reads/writes; forced-password-change bypass via client `user_metadata`. |
| **High** | **12** (`HIGH-01` – `HIGH-12`) | Live credentials in `.env`/`.env.local`; open `support_tickets` RLS & public storage bucket + hardcoded email backdoors; browser-bundled Gemini key; self-approval on `disbursement_requests`; open `security_monitor_config` read; client-forged security events; fail-open n8n ban & unauth webhook; PostgREST `.or()` injection; protected-admin suspension bypass; SVG XSS/URL schemes; unescaped spreadsheet exports; missing in-handler/page auth guards. |
| **Medium** | **9** (`MED-01` – `MED-09`) | Broken `SECURITY INVOKER` `create_purchase_order`; trigger exception/GUC leak; spoofable IP/missing per-IP throttle in `login-bridge`; unthrottled recovery & `Origin` poisoning; fail-open activation & `Math.random()` passwords; unauth Google Sheets webhook; missing CSP/pinned Actions; dangerous historical rollbacks/pending drift; `verify-email` unpeppered hash/HTML injection. |
| **Low** | **5** (`LOW-01` – `LOW-05`) | Wildcard CORS & raw error reflection; unbounded alert/daily queries & `listUsers` truncation; hardcoded Supabase prod URL/anon key in unit tests; PII/`localStorage` backup exposure; owner PII literals in code/docs/prebuilt bundle. |
| **Total** | **31** | **All 31 verified directly from repository source, migrations, configs, and test files.** |

### Immediate Blockers Before Production Sign-Off
1. **Rotate compromised credentials** present on disk in `.env` / `.env.local` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_PASS`, `VERCEL_OIDC_TOKEN`, `VITE_GEMINI_API_KEY`) and scrub historical secrets documented in `docs/SECRETS_ROTATION_REQUIRED.md` and `reports/security-audit-report.md`.
2. **Patch database regressions (`CRIT-02`, `HIGH-02`, `HIGH-04`, `HIGH-05`, `HIGH-06`)** restoring `app_effective_role()`-only checks on `audit_logs`/`security_events`/`security_monitor_config`, locking `support_tickets`, blocking `disbursement_requests` self-approval, and revoking public `record_security_event()` / `audit_logs` direct writes.
3. **Fix authentication & XSS entry points (`CRIT-01`, `CRIT-03`, `CRIT-04`, `CRIT-05`)** in `SupportPage.tsx`, `telegram-bot/index.ts`, `admin-users/index.ts`, `localUsers.ts`/`App.tsx`, and `permissions.ts`.

---

## 2. Scope, Detected Stack, and Attack Surface

### Detected Stack & Evidence Paths
- **Frontend SPA / PWA:** React `19.3.0` (`package-lock.json`), TypeScript `~6.0.2`, Vite `^8.3.0` (`8.3.4` resolved), React Router DOM `^7.18.4`, TanStack React Query `^5.104.1`, Zod `4.6.7`, SheetJS `xlsx@0.20.3` (from third-party CDN URL `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), Custom Service Worker (`public/sw.js`). Evidence: `package.json:1-62`, `package-lock.json`, `vite.config.ts:1-21`, `src/App.tsx`.
- **Database, Auth & Backend-as-a-Service:** Supabase (`@supabase/supabase-js@2.117.3`, PostgreSQL migrations + RLS + RPCs in `supabase/migrations/**`, Deno Edge Functions in `supabase/functions/**`, config in `supabase/config.toml`).
- **Automation / Monitoring / Integrations:** n8n workflow (`automation/n8n/supabase-security-monitor.workflow.json`) with `pg_net` DB webhook trigger (`20261111163000_n8n_security_events_bridge.sql`), pg_cron schedules (`20261111162000_security_retention_and_cron_schedules.sql`), Telegram Bot API, Gmail SMTP (`nodemailer`/raw SMTP or Edge integration), Google Gemini API (`src/lib/geminiService.ts`), Google Apps Script webhook (`src/lib/googleSheetsRealtimeSync.ts`).
- **Hosting & CI/CD:** Vercel static SPA (`vercel.json`, `.vercel/output/config.json`, `.vercel/project.json`), GitHub Actions (`.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`), Vitest `^5.0.3`, PGlite `^0.5.15`, Playwright/Puppeteer.

### Deployed vs. Repository Distinction
This audit examined repository files, `.vercel/` build outputs, and `.env`/`.env.local` present in the local workspace. **Live Supabase remote schema, Edge Function secrets/deployments, Vercel Dashboard env vars, and live n8n instance workflows were not queried** (offline read-only posture). Specifically:
- `supabase/pending/**` contains unapplied SQL migrations (e.g., `app_users.status` `CHECK` constraint, `telegram_user_sessions` cleanup/revoke) absent from `supabase/migrations/**`.
- Local `dist/` (`131` files), `supabase/functions/complete-activation/index.ts`, `tests/unit/procurementStateMachine.test.ts`, and `8` files in `src/` are dehydrated Windows OneDrive stubs (`BLOCKED` offline); their state on Supabase/Vercel remote deployments must be verified separately.

### Attack-Surface Table

| Entry Point / Surface | Handler / Implementation | Caller Identity | Authorization Control | Key Inputs | Sensitive Operations |
|---|---|---|---|---|---|
| **SPA Browser UI Routes** | `src/App.tsx`, `src/pages/**` | Public + authenticated staff + `system_admin` | Client role helpers (`permissions.ts`), `userMustChangePassword`, router gates + **fallback `getLocalSession()`** | Form inputs, query/hash params, localStorage, Excel/CSV uploads, SVG/file attachments | Reads/mutates ledger, custody, budgets, users, audit logs, AI chat, printable DOM |
| **PostgREST Data & Storage API** | Supabase RLS (`supabase/migrations/**`) + `support-attachments` / `procurement-attachments` buckets | `anon`, `authenticated`, `service_role` | `app_effective_role()`, `app_can_modify_records()`, table RLS policies | JSON row payloads, PostgREST filters, uploaded files | Inventory/custody/disbursement/procurement mutations, `audit_logs`, `support_tickets`, `security_monitor_config` |
| **PostgreSQL Security / Business RPCs** | `record_purchase`, `record_warehouse_issue`, `create_purchase_order`, `import_custody_batch`, `record_security_event`, `purge_expired_audit_logs` | `authenticated`, `service_role` | `SECURITY DEFINER` / `SECURITY INVOKER` + in-RPC role checks + `pg_advisory_xact_lock` | UUIDs, quantities, JSON `p_details`, retention days | Financial POs, stock counts, custody wipes (`p_force`), audit log inserts/purges |
| **Public / Semi-Public Edge Functions** | `telegram-bot`, `login-bridge`, `admin-users` (`send_password_recovery`), `complete-activation`, `verify-email` | Unauthenticated HTTP / Telegram / internal service | `verify_jwt = false`; `TELEGRAM_WEBHOOK_SECRET` timing-safe check; `SERVICE_ROLE_KEY` check in `verify-email` | Telegram updates, `identifier`/`password`, `email`/`token`, OTP codes, `Origin` headers | Registration approval triggers, login bridging, password recovery link gen, Auth user creation |
| **Admin / Cron Edge Functions** | `admin-users`, `invite-user`, `migrate-users`, `critical-alerts`, `daily-report` | `system_admin` JWT (`verify_jwt = true` for `invite-user`/`migrate-users`; internal role checks) or `CRON_WEBHOOK_SECRET` | JWT verification + `app_metadata`/`app_users` checks | User IDs, roles, departments, status, request IDs | Create/delete/suspend users, reset passwords, approve registrations, send Telegram/SMTP alerts |
| **n8n Automation Webhook & Telegram Callback** | `automation/n8n/supabase-security-monitor.workflow.json` | DB `pg_net` trigger / **Any HTTP client (no auth)** / Telegram user | No webhook auth; `chatIds` filter (`callback_query.from.id` unchecked) | `security_events` JSON, `email`, `ip`, `changed_by`, `block:<uuid>` callback | Auth Admin `PUT` (`ban_duration: "876000h"`), LLM summary generation, Telegram alerts |
| **External Third-Party Calls (Client-Side)** | `geminiService.ts`, `googleSheetsRealtimeSync.ts` | Browser user | None (`VITE_GEMINI_API_KEY` / `localStorage` key; Google Apps Script URL in env/`localStorage`) | Chat prompts, business contracts/budgets, warehouse movement rows | External Gemini inference + financial context egress; movement export to external webhook |

---

## 3. Method and Category Coverage

The audit enumerated all `30,591` filesystem entries across the workspace (`910` repository/output files, `2,636` `.git/**` files, `27,045` `node_modules/**` files), inspected readable files in bounded chunks, verified git `HEAD` counterparts where OneDrive placeholders blocked disk reads, and evaluated applicable controls across all `checklist.md` categories:

| Checklist Category | Coverage Status | Summary Notes |
|---|---|---|
| **Authentication & Account Recovery** | **Covered (Gaps Found)** | Audited `login-bridge`, `telegram-bot`, `admin-users`, `complete-activation`, `verify-email`, `AuthPage.tsx`, `localUsers.ts` (`CRIT-03`, `CRIT-04`, `CRIT-05`, `HIGH-08`, `MED-03`–`MED-05`). |
| **Session Management** | **Covered (Gaps Found)** | Reviewed Supabase Auth JWT usage vs. unsigned `localStorage` fallback, URL token extraction (`authSessionUtils.ts`), and sign-out cleanup (`CRIT-02`, `CRIT-04`, `LOW-04`). |
| **Authorization / RBAC / Multi-Tenant Isolation** | **Covered (Gaps Found)** | Audited all 60 SQL migrations, `pending/`, `rollbacks/`, Edge Functions, and `src/pages/**` (`CRIT-02`, `HIGH-02`, `HIGH-04`, `HIGH-09`, `HIGH-12`, `MED-01`). |
| **Input Validation, XSS, SQLi & Filter/Formula Injection** | **Covered (Gaps Found)** | Checked React rendering, `document.write`, SVG handling, PostgREST `.or()` filters, SQL dynamic `EXECUTE`, and Excel/CSV exports (`CRIT-01`, `HIGH-08`, `HIGH-10`, `HIGH-11`, `MED-09`). |
| **Cryptography & Secrets Management** | **Covered (Gaps Found)** | Audited `.env`, `.env.local`, `.env.example`, `.vercel/.env.production.local`, `reports/security-audit-report.md`, OTP/password handling (`HIGH-01`, `HIGH-03`, `CRIT-04`, `MED-05`, `MED-09`). |
| **File Upload, Storage & Egress** | **Covered (Gaps Found)** | Audited `support-attachments`, `procurementAttachments.ts`, `SettingsPage.tsx`, `googleSheetsRealtimeSync.ts` (`HIGH-02`, `HIGH-10`, `MED-06`). |
| **AI / LLM Security & Automation Workflows** | **Covered (Gaps Found)** | Audited `geminiService.ts`, `ChatbotAdminPage.tsx`, `supabase-security-monitor.workflow.json`, `scripts/audit-uiux.mjs` (`HIGH-03`, `HIGH-07`). |
| **Monitoring, Audit Logging & Incident Response** | **Covered (Gaps Found)** | Audited Nov 11 security monitoring migrations, `critical-alerts`, `daily-report`, `AuditLogPage.tsx` (`CRIT-02`, `HIGH-05`, `HIGH-06`, `MED-02`, `LOW-02`). |
| **Dependencies, CI/CD, Hosting Headers & Build Artifacts** | **Covered Offline** | Reviewed `package.json`, `package-lock.json` v3, `.github/workflows/**`, `vercel.json`, `.vercel/output/config.json`, `public/sw.js`, `vite.config.ts` (`MED-07`, `LOW-03`); online `npm audit` skipped (offline read-only). |

---

## 4. Verified Findings

Findings are ordered **Critical → High → Medium → Low**, with all credentials, tokens, passwords, phone numbers, Telegram chat IDs, and personal email addresses redacted.

---

### CRITICAL Findings

#### CRIT-01: Stored XSS via `window.open` + `document.write` in Support Ticket Printing
- **Severity:** Critical
- **Confidence / Status:** Verified from code
- **Category:** Cross-Site Scripting (OWASP A03:2021 / CWE-79)
- **Locations:**
  - `src/pages/SupportPage.tsx:433-498` (`handlePrintTicket`)
- **Redacted Evidence:**
  ```tsx
  // src/pages/SupportPage.tsx:433-491
  function handlePrintTicket(ticket: SupportTicket) {
    const printWindow = window.open('', '_blank', 'width=700,height=800')
    if (!printWindow) return
    printWindow.document.write(`
      ...
      <title>تذكرة دعم فني #${ticket.ticket_number}</title>
      ...
      <td>${ticket.employee_name}</td>
      <td>${ticket.employee_code || 'غير محدد'}</td>
      ...
      <td colspan="3"><strong>${ticket.subject}</strong></td>
      <div class="content-box">${ticket.description}</div>
      ${ticket.attachment_name ? `<p><strong>المرفق:</strong> ${ticket.attachment_name}</p>` : ''}
      ${ticket.admin_notes ? `<p><strong>رد وملاحظات الدعم الفني:</strong> ${ticket.admin_notes}</p>` : ''}
  ```
- **Attack Path & Prerequisites:** Any authenticated user—or unauthenticated attacker exploiting open `support_tickets` INSERT RLS (**HIGH-02**)—submits a ticket containing `<img src=x onerror=...>` or `<script>` inside `subject`, `description`, `employee_name`, or `attachment_name`. When a `system_admin` clicks Print in `SupportPage`, `printWindow` runs on the same origin (`about:blank` inherits opener origin) and executes the script with full access to admin Supabase tokens and `localStorage` data.
- **Existing Controls & Why Insufficient:** None; values are interpolated verbatim into HTML without escaping, and `window.open` omits `noopener,noreferrer`.
- **Impact:** Full `system_admin` browser session hijack, privilege abuse via Edge Functions (`admin-users`), and data exfiltration.
- **Concrete Fix:** Replace `window.open` + `document.write` with declarative React JSX + `window.print()` via `@media print` CSS (`safePrint()`), or apply strict HTML entity encoding (`escapeHtml`) to every interpolated ticket field and build DOM nodes with `textContent` instead of `document.write`.

---

#### CRIT-02: Stale JWT `app_metadata` Claims Bypass `app_effective_role()` Revocation on Security/Audit Tables & Purge RPC
- **Severity:** Critical
- **Confidence / Status:** Verified from code
- **Category:** Broken Access Control / Session Revocation (OWASP A01:2021 / CWE-613, CWE-284)
- **Locations:**
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:101-115` (`security_monitor_config_modify`)
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:139-151` (`audit_alert_deliveries_service_only`)
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:186-193` (`audit_logs_archive_select`)
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:245-248` (`purge_expired_audit_logs`)
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:412-420` (`audit_logs_admin_select`)
  - `supabase/migrations/20261111161000_security_triggers_and_detection_rules.sql:117-121` (`audit_table_change`)
  - `supabase/migrations/20261111163000_n8n_security_events_bridge.sql:42-50` (`security_events_select_admin`)
- **Redacted Evidence:**
  ```sql
  -- supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:104-112 & 245-248
  COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
  OR COALESCE((SELECT auth.jwt())->'app_metadata'->>'role', '') = 'system_admin'
  OR COALESCE(public.app_effective_role(), '') = 'system_admin'
  OR (SELECT auth.role()) = 'service_role'
  ```
- **Attack Path & Prerequisites:** `20261104203023_role_authority_freshness.sql` intentionally removed JWT fallbacks so `app_effective_role()` rejects suspended/demoted admins immediately. However, Nov 11 migrations re-added `auth.jwt()->'app_metadata'` `OR` branches. A demoted or suspended admin holding an unexpired JWT can still read `audit_logs`, `audit_logs_archive`, and `security_events`, overwrite `security_monitor_config.n8n_webhook_url` to redirect security alerts, and call `purge_expired_audit_logs(1)` to bypass `trg_prevent_audit_log_tamper` (`set_config('app.audit_retention_purge', 'on', true)`) and wipe audit history >1 day old.
- **Existing Controls & Why Insufficient:** `app_effective_role()` returns null for suspended/demoted users, but the `OR` clause short-circuits to `true` via stale JWT claims.
- **Impact:** Complete audit-log destruction (`DELETE` bypass), security-monitor redirection/blindness, and post-revocation access to sensitive security telemetry.
- **Concrete Fix:** Drop all `auth.jwt()->'app_metadata'` `OR` branches in those policies and `purge_expired_audit_logs()`; enforce strictly `public.app_effective_role() = 'system_admin' OR (SELECT auth.role()) = 'service_role'`, and enforce a minimum retention floor (e.g., `GREATEST(p_retention_days, 30)`) or read retention solely from `security_monitor_config`.

---

#### CRIT-03: Email Ownership Verification Bypass & Telegram Activation/Recovery Link Hijacking
- **Severity:** Critical
- **Confidence / Status:** Verified from code
- **Category:** Broken Authentication / Account Takeover (OWASP A07:2021 / CWE-287, CWE-640)
- **Locations:**
  - `supabase/functions/telegram-bot/index.ts:480-485, 504-518`
  - `supabase/functions/admin-users/index.ts:1843, 2015-2071, 2113-2121, 2145-2153`
- **Redacted Evidence:**
  ```ts
  // supabase/functions/telegram-bot/index.ts:507-516
  const insertPayload: Record<string, any> = {
    full_name: fullName, email: email, telegram_user_id: tgUserId, ...
    verification_status: "verified", // hardcoded without email OTP check
    approval_status: "pending",
  }
  ```
  ```ts
  // supabase/functions/admin-users/index.ts:2036-2048, 2145-2153
  if (!actionLink.includes("verify?token=")) {
    const { data: recData } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery", email: targetEmail, ...
    })
  }
  const tgRes = await sendActivationInviteTelegram({ telegramUserId: regReq.telegram_user_id, ..., actionLink })
  ```
- **Attack Path & Prerequisites:** An unauthenticated Telegram user submits an arbitrary email (including an existing Auth user's real email whose `app_users.email` is `null` or `@warehouse.local`, evading `L480-484`). Because `telegram-bot` hardcodes `verification_status: "verified"` without calling `sendOtpEmail` (`L108`), reviewers see a verified request. Upon admin approval (`admin-users:1843`), `generateLink({ type: "invite" })` fails on pre-existing Auth users and falls back to `type: "recovery"` / `"magiclink"`, sending the one-time Auth `actionLink` directly to the attacker's `telegram_user_id`.
- **Existing Controls & Why Insufficient:** `admin-users` verifies `regReq.verification_status === "verified"` (forged by `telegram-bot`) and checks `caller.email === regReq.email` (only blocks self-approval).
- **Impact:** Unauthorized account provisioning and takeover of existing Auth accounts whose Auth email is absent from `app_users.email`.
- **Concrete Fix:** (1) Enforce `verification_status: "pending"` in `telegram-bot` until `/verify <otp>` succeeds against `OTP_PEPPER`-salted hashes (`sendOtpEmail` enabled). (2) Never send Auth `actionLink` tokens over Telegram; deliver `actionLink` strictly to the verified email inbox and send only a status notice on Telegram. (3) Fail closed in `approve_registration_request` if `generateLink({ type: "invite" })` fails rather than falling back to `recovery`/`magiclink` on existing Auth users.

---

#### CRIT-04: Unsigned Client-Storage Session (`getLocalSession`) & Plaintext `password` Column Handling
- **Severity:** Critical
- **Confidence / Status:** Verified from code
- **Category:** Authentication & Cryptographic Storage Failures (OWASP A02/A07:2021 / CWE-287, CWE-256, CWE-602)
- **Locations:**
  - `src/App.tsx:272-276`
  - `src/lib/localUsers.ts:124-141, 733-797`
  - `src/pages/UsersPage.tsx:315-329`
  - `supabase/migrations/20261011220000_create_app_users_table.sql:8, 10`
  - `supabase/migrations/20261030020000_fix_duplicate_employee_ids.sql:13, 50, 83, 109, 115, 124`
- **Redacted Evidence:**
  ```ts
  // src/App.tsx:272-276 (conceptual pattern verified in App.tsx)
  const local = getLocalSession()
  // Unsigned localStorage session object accepted into React session state
  ```
  - `localUsers.ts:124-141, 733-797` & `UsersPage.tsx:315-329`: create/persist `password` in local user objects and `app_users` upsert payloads (`saveUserToCloud`).
  - `20261030020000:13`: retains a hardcoded plaintext password `[REDACTED]` in SQL migration history; `20261011220000:10` `activation_code` column remains selectable by `authenticated` (`20261013213000:21`).
- **Attack Path & Prerequisites:** Any script (XSS via `CRIT-01`/`HIGH-10`) or local browser user editing `localStorage` sets an unsigned `LocalUserSession` containing `app_metadata: { role: 'system_admin', system_admin: true }`, which `App.tsx` treats as an authenticated admin session for UI routing and locally cached ledger/audit inspection. Separately, plaintext `password` fields handled in `localUsers.ts` and legacy migrations increase credential exposure risk in browser storage and SQL dumps.
- **Existing Controls & Why Insufficient:** Supabase RLS rejects backend RPC/API calls without a valid signed JWT, but UI guards, cached backups, and client state honor the forged `localStorage` session.
- **Impact:** Client-side admin UI bypass & cached data disclosure; plaintext credential exposure in client/DB artifacts.
- **Concrete Fix:** Remove `getLocalSession()` fallback from authentication state (`App.tsx`) and use strictly verified Supabase Auth `getSession()` / `onAuthStateChange()` sessions. Strip `password` and `activationCode` from `localUsers.ts` / `UsersPage.tsx` (`saveUserToCloud`), drop/nullify legacy `app_users.password` and `app_users.activation_code` columns via migration, and rotate any user affected by `20261030020000`.

---

#### CRIT-05: Forced Password Change Bypass via Client-Writable `user_metadata`
- **Severity:** Critical
- **Confidence / Status:** Verified from code
- **Category:** Broken Access Control / Client Trust Boundary Violation (OWASP A01:2021 / CWE-807, CWE-602)
- **Locations:**
  - `src/lib/permissions.ts:359-376` (`userMustChangePassword`)
  - `tests/unit/phase3_workflows.test.ts:31-37`
- **Redacted Evidence:**
  ```ts
  // src/lib/permissions.ts:359-376
  export function userMustChangePassword(session: AnySession): boolean {
    if (!session || typeof session !== 'object' || !('user' in session)) return false
    const user = session.user
    if (!user) return false
    const userMeta = user.user_metadata as Record<string, unknown> | undefined
    const appMeta = user.app_metadata as Record<string, unknown> | undefined
    if (userMeta?.must_change_password === false) {
      return false
    }
    return Boolean(appMeta?.must_change_password === true || userMeta?.must_change_password === true)
  }
  ```
- **Attack Path & Prerequisites:** An authenticated user whose account was flagged `app_metadata.must_change_password = true` calls `supabase.auth.updateUser({ data: { must_change_password: false } })` from browser devtools/API using their active JWT. Because `user_metadata` is user-writable in Supabase Auth and `permissions.ts:365` gives `user_metadata.must_change_password === false` precedence over `app_metadata`, the forced rotation screen is skipped (`phase3_workflows.test.ts:31-37` mistakenly asserts this unsafe behavior).
- **Existing Controls & Why Insufficient:** `app_metadata` is server-signed, yet client code allows `user_metadata` to override it.
- **Impact:** Complete bypass of mandatory temporary-password / first-login / admin-forced password resets.
- **Concrete Fix:** Check strictly `appMeta?.must_change_password === true` (remove `userMeta` override in `permissions.ts`), update `complete-activation` / password-change flows to clear `app_metadata.must_change_password` solely from the server/Edge Function after `updateUser({ password })`, and fix `tests/unit/phase3_workflows.test.ts:31-37`.

---

### HIGH Findings

#### HIGH-01: Live Plaintext Secrets on Disk (`.env`, `.env.local`), Prefix Leaks in Pre-Existing Report & Unscoped CI Secret Scanner
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Cryptographic Failures / Secrets Exposure (OWASP A02:2021 / CWE-798, CWE-312)
- **Locations:**
  - `.env` (non-empty `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_USER`, `SMTP_PASS`, `VERCEL_OIDC_TOKEN`, `VITE_GOOGLE_SHEETS_WEBHOOK_URL`)
  - `.env.local` (non-empty `VITE_GEMINI_API_KEY`, `VERCEL_OIDC_TOKEN`)
  - `.vercel/.env.production.local` (`VERCEL_OIDC_TOKEN`)
  - `reports/security-audit-report.md:84-88, 121` (committed/unignored pre-existing report revealing secret prefixes from `.env`/`.env.local`)
  - `tests/unit/noHardcodedPasswords.test.ts:69` (reconstructs previously exposed admin password via char array join)
  - `.github/workflows/secret-scan.yml:25-26` (excludes `.sql`, `.md`, `.yml`, `tests/`, `.github/`, root, and uses regex matching without covering key formats)
- **Attack Path & Prerequisites:** Any developer workstation backup, OneDrive sync copy, or repo consumer with access to `.env`/`.env.local` or `reports/security-audit-report.md` obtains live service credentials or partial tokens; historical commits documented in `docs/SECRETS_ROTATION_REQUIRED.md` & `docs/STATUS_AND_REMAINING_TASKS.md` already leaked prior credentials into Git history. Meanwhile CI's secret-scan workflow skips tests, migrations, workflows, and docs.
- **Existing Controls & Why Insufficient:** `.env`/`.env.local` are `.gitignore`d, but `reports/security-audit-report.md` and `tests/unit/noHardcodedPasswords.test.ts` remain tracked/unignored, and `.github/workflows/secret-scan.yml` only scans `src` + `supabase/functions` `.ts/.tsx/.js`.
- **Impact:** Compromise of Telegram bot control, Gmail SMTP relay, Gemini API billing quota, and temporary Vercel OIDC tokens.
- **Concrete Fix:** Immediately rotate `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_PASS`, `VITE_GEMINI_API_KEY`, and `VERCEL_OIDC_TOKEN`; remove `.env` server secrets into Supabase Secrets Vault / Vercel Server Env Vars; redact prefixes from `reports/security-audit-report.md`; remove password reconstruction from `tests/unit/noHardcodedPasswords.test.ts:69`; expand `.github/workflows/secret-scan.yml` to scan all tracked extensions and run `gitleaks`/`trufflehog`.

---

#### HIGH-02: `support_tickets` Open RLS & Public Storage Bucket + Hardcoded Admin Email Backdoors
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Broken Access Control (OWASP A01:2021 / CWE-284, CWE-862, CWE-798)
- **Locations:**
  - `supabase/migrations/20261027201500_create_support_tickets_system.sql:43-97`
  - `supabase/migrations/20261029180000_resolve_supabase_linter_security_warnings.sql:457-460`
  - `supabase/migrations/20261102220000_harden_security_and_privilege_escalation.sql:43` (`protect_system_admin_row()`)
  - `supabase/migrations/20261014120000_protected_system_admin.sql:87-95` (also preserved in `20261102220000:68-73` missing `email`/`employee_id`/`activation_code` protection)
  - `src/pages/SupportPage.tsx:48-50, 77-84`
- **Redacted Evidence:**
  ```sql
  -- supabase/migrations/20261027201500_create_support_tickets_system.sql:43-97 & 20261029180000:457-460
  -- GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated, anon;
  -- Public storage bucket: support-attachments (public = true)
  -- Hardcoded email checks: [REDACTED_OWNER_EMAIL_1], [REDACTED_OWNER_EMAIL_2]
  ```
  - `support_tickets` was omitted from `20261104201756_department_role_matrix.sql` and `20261106101500_harden_modules_1_to_7_rls.sql`.
- **Attack Path & Prerequisites:** Any unauthenticated `anon` or authenticated user can insert `support_tickets` with arbitrary `user_id`, pre-set `status`, or `admin_notes` (feeding **CRIT-01** XSS), read/download attachments from the public `support-attachments` bucket URL directly without auth, and mutate `email`/`employee_id`/`activation_code` on protected `system_admin` rows because `protect_system_admin_row()` omits those columns while still authorizing callers matching hardcoded personal Gmail strings (`20261102220000:43`, `SupportPage.tsx:80-81`).
- **Existing Controls & Why Insufficient:** `20261104201756:586-602` added `RESTRICTIVE` storage policies `TO authenticated`, yet `support-attachments` remains `public = true` (direct `/object/public/` access bypasses RLS!) and `support_tickets` table RLS was never migrated to `app_effective_role()`.
- **Impact:** Unauthenticated/cross-user ticket tampering, public exposure of uploaded ticket files, and email-backdoor RBAC bypass.
- **Concrete Fix:** Revoke `anon` grants on `support_tickets`; require `(SELECT auth.uid()) = user_id AND status = 'open'` on `INSERT`, restrict admin ticket `UPDATE`/`SELECT` to `public.app_effective_role() = 'system_admin'`; set `support-attachments` bucket `public = false` and use signed URLs; remove all hardcoded email checks from `protect_system_admin_row()` and `SupportPage.tsx`; add `email`/`employee_id`/`activation_code` immutability checks in `protect_system_admin_row()`.

---

#### HIGH-03: Client-Side Gemini API Key Exposure (`VITE_GEMINI_API_KEY` / `localStorage`), Key in Query String & Stored Prompt Injection
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Secrets Exposure & LLM Security (OWASP A02:2021, LLM01/LLM06 / CWE-200, CWE-598)
- **Locations:**
  - `src/lib/geminiService.ts` (key resolution from `VITE_GEMINI_API_KEY` / `localStorage`, `fetch(...?key=...)`, live contract/budget context injection)
  - `src/pages/ChatbotAdminPage.tsx` (reads/stores Gemini API key in browser `localStorage`)
  - `.env.local` (`VITE_GEMINI_API_KEY` present)
- **Attack Path & Prerequisites:** Any `VITE_GEMINI_API_KEY` configured at build time is embedded verbatim into public Vite JS bundles; any admin saving a key in `ChatbotAdminPage.tsx` exposes it in `localStorage` to XSS (`CRIT-01`/`HIGH-10`), browser extensions, and shared URL query-string (`?key=`) network telemetry. Additionally, financial contract values, supplier names, and department budgets are injected into the LLM system prompt regardless of caller authorization or prompt-injection defenses.
- **Existing Controls & Why Insufficient:** Only `ADMIN`-level UI renders `ChatbotAdminPage`, which does not prevent Vite `VITE_` inlining into the global client bundle or XSS extraction from `localStorage`.
- **Impact:** Theft/quota exhaustion of the organization's Google Gemini API key and leakage of institutional supplier contracts & budgets via LLM prompt injection.
- **Concrete Fix:** Remove `VITE_GEMINI_API_KEY` and browser-side Gemini calls; proxy all AI chat through a Supabase Edge Function holding `GEMINI_API_KEY` in Deno secrets, passing the key in the `x-goog-api-key` header rather than URL query params, and filtering LLM context strictly by the caller's server-verified role.

---

#### HIGH-04: Self-Approval Privilege Bypass on `disbursement_requests` RLS Policy
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Broken Access Control (OWASP A01:2021 / CWE-284, CWE-840)
- **Locations:**
  - `supabase/migrations/20261106140500_resolve_supabase_linter_warnings.sql:27-38` (`role_update` policy; regression from `20261106101500_harden_modules_1_to_7_rls.sql:29`)
- **Redacted Evidence:**
  ```sql
  -- supabase/migrations/20261106140500_resolve_supabase_linter_warnings.sql:27-38
  CREATE POLICY "role_update" ON public.disbursement_requests
    FOR UPDATE TO authenticated
    USING (... OR (created_by = (SELECT auth.uid()) AND status = 'pending'))
    WITH CHECK (... OR (created_by = (SELECT auth.uid())));
  ```
- **Attack Path & Prerequisites:** `20261106101500:29` restricted creators updating a `pending` request to `AND status = 'rejected'` (self-cancellation only). `20261106140500:37` accidentally dropped `AND status = 'rejected'` from `WITH CHECK`. Any `warehouse_employee` inserts a disbursement request and immediately sends a PostgREST `PATCH` setting `status = 'approved'` or `'issued'` along with `approved_by`/`approved_at`.
- **Existing Controls & Why Insufficient:** `USING` checks `status = 'pending'`, which passes on initial update, while `WITH CHECK` allows any resulting status and fields.
- **Impact:** Unauthorized self-approval of warehouse/internal disbursement requests bypassing finance/admin authorization.
- **Concrete Fix:** Restore `AND status = 'rejected' AND approved_by IS NULL AND approved_at IS NULL AND issued_at IS NULL` in the creator branch of `role_update` `WITH CHECK`.

---

#### HIGH-05: Open Read on `security_monitor_config` Exposing `n8n_webhook_url` & Detection Thresholds
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Information Exposure (OWASP A01/A05:2021 / CWE-200)
- **Locations:**
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:95-98, 117`
  - `supabase/migrations/20261111163000_n8n_security_events_bridge.sql:57-58`
- **Redacted Evidence:**
  ```sql
  -- supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:95-98
  CREATE POLICY "security_monitor_config_select" ON public.security_monitor_config
    FOR SELECT TO authenticated, service_role USING (true);
  ```
- **Attack Path & Prerequisites:** Any low-privilege `authenticated` user (`viewer`, newly activated staff) queries `/rest/v1/security_monitor_config` to extract the live `n8n_webhook_url` (enabling forged webhook spam against n8n — see **HIGH-07**) plus alert thresholds (`failed_login_threshold`, `mass_delete_threshold`, `unusual_hours_start`/`end`) to stay just beneath automated detection limits.
- **Existing Controls & Why Insufficient:** Write operations are restricted, but `SELECT` uses `USING (true)` for all `authenticated` sessions.
- **Impact:** Disclosure of internal webhook infrastructure URL and IDS evasion thresholds.
- **Concrete Fix:** Change `security_monitor_config_select` to `USING (public.app_effective_role() = 'system_admin' OR (SELECT auth.role()) = 'service_role')` and revoke `SELECT` on `security_monitor_config` from non-admin roles if unnecessary client-side.

---

#### HIGH-06: Client-Callable `record_security_event()` & Direct `audit_logs` INSERT Allow Alert Forgery & Attacker-Triggered Lockouts
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Integrity & Availability Abuse (OWASP A04/A09:2021 / CWE-290, CWE-840)
- **Locations:**
  - `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql:377-384, 424-430`
  - `supabase/migrations/20261111161000_security_triggers_and_detection_rules.sql:373-506` (`record_security_event`)
  - `supabase/migrations/20261111163000_n8n_security_events_bridge.sql:200-389` (`sync_audit_log_to_security_events`)
- **Redacted Evidence:**
  - `audit_logs_authenticated_insert` allows any `authenticated` user to `INSERT` into `audit_logs`; `sync_audit_log_fields()` only downgrades `'critical'` to `'warning'`, leaving `event_type` unrestricted, while `sync_audit_log_to_security_events()` promotes rows by `event_type` regardless of `severity`.
  - `record_security_event()` (`SECURITY DEFINER`, granted `authenticated`) sets `app.trusted_security_writer = 'on'` and blindly trusts client `p_event_type`, `p_ip`, and `p_details`, emitting `'critical'` `brute_force_failed_logins` / `mass_delete` / `role_permission_change` events.
- **Attack Path & Prerequisites:** Any `authenticated` `viewer` invokes `rpc/record_security_event` 5 times naming a victim's username/UUID or inserts forged `audit_logs` with `event_type = 'role_permission_change'`, flooding `security_events` and n8n/Telegram with fake `CRITICAL` alerts and ban prompts (**HIGH-07**).
- **Existing Controls & Why Insufficient:** Downgrading `'critical'` in `sync_audit_log_fields()` does not block bridging by `event_type`, nor does it restrict `record_security_event()` parameters/callers.
- **Impact:** False-flag admin alerts, automated-ban social engineering / DoS against legitimate users, and poisoned forensic audit logs.
- **Concrete Fix:** Revoke `EXECUTE ON FUNCTION public.record_security_event` from `anon, authenticated` (restrict to `service_role`); remove `audit_logs_authenticated_insert` (or allowlist harmless UI navigation events with strict non-critical `event_type` enforcement and skip bridging for non-trigger `authenticated` inserts).

---

#### HIGH-07: Fail-Open Protected-Account Guard, Unauthenticated Webhook & Indirect Prompt Injection in n8n Security Monitor
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Fail-Open Access Control & AI/Automation Abuse (OWASP A01/A07:2021, LLM01 / CWE-636, CWE-306)
- **Locations:**
  - `automation/n8n/supabase-security-monitor.workflow.json:4-19` (`Supabase security_events INSERT` unauthenticated webhook)
  - `automation/n8n/supabase-security-monitor.workflow.json:129, 154-169, 832-847` (prompt injection in Gemini agents)
  - `automation/n8n/supabase-security-monitor.workflow.json:501-524, 565, 599, 623` (`Lookup target in app_users` `alwaysOutputData: true`, `Safe to Ban?`, Telegram callback)
- **Redacted Evidence:**
  - `Lookup target in app_users` sets `"alwaysOutputData": true`; when 0 rows match (e.g., `auth_user_id` null/mismatched), n8n passes `{}`. `Safe to Ban?` checks `String($json.role || '').toLowerCase() !== 'system_admin'`, evaluating to `true` on `undefined` and calling Supabase Auth Admin `PUT` with `ban_duration: "876000h"` (~100 years).
  - Rule 3 (`L129`) issues a `CRITICAL` ban-button alert whenever `login_success` follows 3 failed logins.
  - Webhook (`L5-9`) has no `headerAuth`/HMAC; `Incident Summary Agent` (`L156`) interpolates untrusted `$json.email`, `$json.ip`, `changed_by` raw into LLM prompts.
- **Attack Path & Prerequisites:** (1) An attacker triggers 3 failed logins on a victim email; when the victim successfully logs in, Rule 3 prompts the admin with a `block:<uuid>` button; or if `app_users` lookup fails/returns empty, `Safe to Ban?` fails open even for `system_admin`. (2) External callers hitting `/webhook/supabase-security-events` exhaust Supabase/Gemini quotas; crafted identifiers/spoofed IP headers manipulate LLM incident summaries.
- **Existing Controls & Why Insufficient:** Overwriting webhook body in `Thresholds` protects downstream DB calls from direct payload injection, and HTML escaping protects Telegram output from tag injection, but neither prevents unauthenticated triggers, prompt manipulation, nor empty-lookup fail-open bans.
- **Impact:** Denial of Service / 100-year Auth lockout of legitimate or protected admin accounts, workflow quota exhaustion, and deceptive Telegram security summaries.
- **Concrete Fix:** (1) Require `$json.id` present AND query Auth Admin `GET /auth/v1/admin/users/{{target_user_id}}` verifying `app_metadata?.system_admin !== true` & `role !== 'system_admin'` before banning; disable `alwaysOutputData`. (2) Enforce `headerAuth` / shared secret on the n8n webhook. (3) Isolate untrusted event fields in strict JSON/data delimiters inside LLM prompts and verify `callback_query.from.id` on Telegram callbacks.

---

#### HIGH-08: PostgREST `.or()` Filter Injection & Account Enumeration / Recovery Side-Effects
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Injection & Account Enumeration (OWASP A03:2021 / CWE-943, CWE-204)
- **Locations:**
  - `supabase/functions/admin-users/index.ts:491, 575-627, 651-681` (unauthenticated `send_password_recovery`), `1386` (`delete_user`), `2727` (`set_user_status`)
  - `supabase/functions/complete-activation/index-pablo.ts:221, 361` (matching `HEAD:complete-activation/index.ts:221, 361`)
  - `src/lib/registrationService.ts:585`
- **Redacted Evidence:**
  ```ts
  // supabase/functions/admin-users/index.ts:594-598
  const { data: dbUser } = await supabaseAdmin
    .from("app_users")
    .select("display_name, email, employee_id, username, status")
    .or(`email.ilike.${cleanIdent},username.ilike.${cleanIdent},employee_id.ilike.${cleanIdent}`)
    .maybeSingle()
  ```
- **Attack Path & Prerequisites:** An unauthenticated caller invokes `admin-users` `send_password_recovery` (`verify_jwt = false`, `L491` exempts action) with PostgREST `.or()` predicates in `identifier` (e.g. `,and(role.eq.system_admin,username.ilike.m*)`). Single-row matches trigger `ensureAuthUserForRecovery` (`L122-178, 654`) + `generateLink` + SMTP send (measurable latency/400/500 oracle) while 0/>1 matches return immediately; `dbUser.status` is not even checked (`suspended` accounts trigger on-demand Auth creation with `email_confirm: true`).
- **Existing Controls & Why Insufficient:** `.maybeSingle()` suppresses multi-row return values rather than validating filter syntax; `registrationService.ts:585` has the same unquoted `.or()` interpolation pattern.
- **Impact:** Unauthenticated blind enumeration of `app_users` / `registration_requests` fields and unauthorized Auth recovery/account-creation side effects.
- **Concrete Fix:** Validate `identifier` against strict character allowlists (no `,`, `(`, `)`, `*`, `%`, `.` filter metacharacters) or replace `.or(...)` string interpolation with exact `.eq(...)` / parameterized PostgreSQL RPC queries; verify `dbUser.status === "active"` before `ensureAuthUserForRecovery`.

---

#### HIGH-09: Protected `system_admin` Suspension/Lockout Bypass & Missing Protected Guard in `invite-user`
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Broken Authorization & Availability (OWASP A01:2021 / CWE-863, CWE-284)
- **Locations:**
  - `supabase/functions/admin-users/index.ts:97-113, 2671-2750` (`set_user_status`)
  - `supabase/functions/invite-user/index.ts:151-189` (`reset-password`)
- **Redacted Evidence:**
  ```ts
  // supabase/functions/admin-users/index.ts:2689-2693, 2724-2727
  const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const targetUsername = targetUser?.user?.email?.replace(/@warehouse\.local$/, "") || ""
  const isTargetProtected = isProtectedUsername(targetUsername) || isProtectedUsername(targetUser?.user?.email)
  if (isTargetProtected && status === "suspended") { ... return 403 }
  ...
  await supabaseAdmin.from("app_users").update({ status }).or(`auth_user_id.eq.${userId},id.eq.${userId}`)
  ```
- **Attack Path & Prerequisites:** (1) Passing the `system_admin`'s `app_users.id` (`usr-...`) instead of Auth UUID causes `getUserById` to return `null` (`isTargetProtected = false`), yet `.or(auth_user_id.eq.${userId},id.eq.${userId})` still updates `app_users.status`, locking the `system_admin` out of `login-bridge` (`L483` requires `status === "active"`). Passing `status: "pending_activation"` with their Auth UUID also bypasses `status === "suspended"`. (2) `invite-user`'s `reset-password` action omits `isProtectedUsername` checks enforced in `admin-users:1122`, allowing an admin token to reset the protected admin's password.
- **Existing Controls & Why Insufficient:** `set_user_status` only checks `getUserById` and `status === "suspended"`; `isProtectedUsername` (`L97-113`) ignores env bootstrap overrides (`L507-508`).
- **Impact:** Denial of Service / lockout of the canonical `system_admin` account and inconsistent protected-account password reset guard.
- **Concrete Fix:** Resolve both `app_users` (by `id`/`auth_user_id`) and `auth.users` before checking `role === "system_admin"` / `system_admin === true` / `isProtectedUsername`, block any `status !== "active"` on protected accounts, and replicate `admin-users`'s protected-account guard in `invite-user` `reset-password`.

---

#### HIGH-10: SVG Stored XSS in Attachment/Logo Handling & Unvalidated URL Schemes
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Stored XSS & Unsafe File/URL Handling (OWASP A03:2021 / CWE-79, CWE-434)
- **Locations:**
  - `src/lib/procurementAttachments.ts:48, 81-91`
  - `src/lib/supportTicketsRepository-pablo.ts:96-125` (plus `HEAD:src/lib/supportTicketsRepository.ts`)
  - `src/pages/SettingsPage.tsx:106, 818`
  - `src/App.tsx:338` (dynamically applies `logoSource` to DOM favicon/icon)
- **Redacted Evidence:**
  - `procurementAttachments.ts:48` allows `'image/svg+xml'` uploads; `L81-91` only checks extensions/prefixes without content sniffing or stripping active `<script>`/`onload=` SVG tags.
  - `SettingsPage.tsx:106, 818` permits `data:image/svg+xml` / unvalidated image URLs and stores them into institutional settings (`App.tsx:338`).
  - Support ticket attachments (`supportTicketsRepository-pablo.ts:96-125`) lack strict MIME/extension allowlists and Content-Disposition isolation when served directly.
- **Attack Path & Prerequisites:** A user uploads a crafted `.svg` containing `<script>` or event handlers to procurement/support attachments or admin logo settings. Opening the attachment directly or rendering an unvalidated URL in browser contexts executes arbitrary JavaScript under the storage/app context.
- **Existing Controls & Why Insufficient:** File-extension checks are spoofable and `'image/svg+xml'` is inherently executable markup in browsers.
- **Impact:** Stored XSS via uploaded SVG files and phishing/redirection via unvalidated media/`Link` targets.
- **Concrete Fix:** Remove `'image/svg+xml'` from all user upload allowlists (`procurementAttachments.ts`, `SettingsPage.tsx`, `supportTicketsRepository.ts`), allow strictly raster MIME types (`image/png`, `image/jpeg`, `image/webp`) + `application/pdf`, verify magic bytes, serve downloads with `Content-Disposition: attachment` / private signed URLs, and validate `https:`/`data:image/(png|jpeg|webp);base64,` URLs strictly.

---

#### HIGH-11: CSV & XLSX Formula Injection Across Multiple Exports
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Spreadsheet Formula Injection (OWASP A03:2021 / CWE-1236)
- **Locations:**
  - `src/pages/ReportsPage.tsx:109-146` (`exportProcurementInvoicesExcel`, `exportSuppliersStatementExcel` — **zero** sanitization)
  - `src/lib/custody.ts:1324-1402`
  - `src/lib/importRows.ts:160-164`
  - `src/pages/PurchasesPage.tsx:47-52` (`sanitizeExcelCell` only checks `/^[=+\-@]/`, missing `\t`, `\r`, leading whitespace)
- **Redacted Evidence:**
  ```tsx
  // src/pages/ReportsPage.tsx:114-121
  'رقم الفاتورة': m.inv || '—',
  'المورد / الشركة': m.from || '—',
  'الصنف': m.item || '—',
  ...
  'ملاحظات': m.notes || '', // Passed directly to XLSX.utils.json_to_sheet(rows) without sanitization
  ```
- **Attack Path & Prerequisites:** Any staff user or supplier record containing `=cmd|' /C ...'!A0`, `+HYPERLINK(...)`, `@SUM(...)`, or `\t=1+1` in item names, supplier names, invoice numbers, or notes is exported unsanitized into `.xlsx`/`.csv`. Opening the exported report in Microsoft Excel / LibreOffice triggers active formula evaluation or external data exfiltration (`WEBSERVICE`/`HYPERLINK`).
- **Existing Controls & Why Insufficient:** `custodyImport.ts:43-50` and `PurchasesPage.tsx:47-52` sanitize selectively (and `PurchasesPage` misses leading tabs/CR/spaces), while `ReportsPage.tsx`, `custody.ts`, and `importRows.ts` omit neutralization.
- **Impact:** Arbitrary spreadsheet command execution or data leakage on staff workstations when opening exported reports.
- **Concrete Fix:** Create one shared `sanitizeSpreadsheetCell(val)` helper (`if (/^[\s]*[=+\-@\t\r]/.test(str)) return `'${str}``) and apply it universally to every string field across all CSV and XLSX exports (`ReportsPage`, `PurchasesPage`, `CustodyPage`/`custody.ts`, `importRows.ts`).

---

#### HIGH-12: Missing In-Page / In-Handler Authorization Guards, Fail-Open `login-bridge` Fallback & Client `app_users` Mutations
- **Severity:** High
- **Confidence / Status:** Verified from code
- **Category:** Defense-in-Depth Access Control & Client State Integrity (OWASP A01/A04:2021 / CWE-284, CWE-602)
- **Locations:**
  - `src/pages/TelegramBotPage.tsx:29, 70-84` (no role gate on page/save)
  - `src/pages/DisbursementRequestsPage.tsx:177-255` (missing handler-level role checks before approve/issue/reject/delete mutations)
  - `src/pages/CustodyPage.tsx:190-223, 479-519` (client-mount auto-seeding of fixtures + missing handler role guards)
  - `src/pages/AssetHistoryPage.tsx:156-174` (`handlePurgeDemo` guarded by `canModify` + `window.confirm`)
  - `src/pages/AuthPage.tsx:405-470` (fail-open fallback from `login-bridge` to client `signInWithPassword` + direct `app_users` client update)
- **Attack Path & Prerequisites:** (1) If component rendering/routing is reached directly or permissions drift, `TelegramBotPage`, `DisbursementRequestsPage`, `CustodyPage`, and `AssetHistoryPage` attempt privileged mutations without verifying caller role inside the handler. (2) In `AuthPage.tsx`, if `login-bridge` returns non-lockout errors or is unreachable, login falls back to direct client `signInWithPassword` + client `app_users` mutation, bypassing centralized rate-limiting, audit logging, and active-status checks enforced by `login-bridge`.
- **Existing Controls & Why Insufficient:** Relies primarily on parent route checks / CSS `hidden` DOM attributes and DB RLS (which itself has regressions noted in **CRIT-02**, **HIGH-02**, **HIGH-04**).
- **Impact:** Unauthorized UI actions, inconsistent lockout/audit enforcement during login, and unintended client-side fixture seeding or bulk purge triggers.
- **Concrete Fix:** Enforce explicit role/department checks inside both UI components and every mutation handler (removing CSS `hidden` attribute reliance); remove `signInWithPassword` fallback when `login-bridge` fails or rejects; move demo-purge and fixture seeding out of client SPA mounts into admin-only server RPCs/migrations.

---

### MEDIUM Findings

#### MED-01: `create_purchase_order(uuid)` Changed to `SECURITY INVOKER` Breaks Procurement PO Creation
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Broken Business Authorization / Misconfiguration (OWASP A05:2021 / CWE-276)
- **Locations:**
  - `supabase/migrations/20261106144500_harden_security_definer_and_search_paths.sql:44-47`
  - `supabase/migrations/20261104201756_department_role_matrix.sql:290-381, 490-491`
- **Redacted Evidence:** `20261106144500:44` sets `ALTER FUNCTION public.create_purchase_order(uuid) SECURITY INVOKER;`, whereas `20261104201756:490-491` restricts `INSERT ON public.purchase_orders` strictly to `public.app_can_modify_records()` (`system_admin` only).
- **Impact:** Procurement employees pass the function's internal `app_can_add_department('procurement')` check and then hit RLS failure on `purchase_orders` `INSERT`, breaking PO workflows (and creating pressure to weaken `purchase_orders` table RLS, which would bypass quote/PR state validation).
- **Concrete Fix:** Restore `create_purchase_order(uuid)` to `SECURITY DEFINER` with `SET search_path = public, pg_temp`, preserve strict `app_can_modify_records()` table RLS on `purchase_orders`, and enforce the exact authorized procurement/admin role inside the RPC.

---

#### MED-02: Trigger Audit-Swallow, GUC State Leak, Shallow JSON Sanitization, Unrevoked Triggers & Plaintext `http://` Webhook
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Security Logging & Configuration Weaknesses (OWASP A09/A05:2021 / CWE-778, CWE-319)
- **Locations:**
  - `supabase/migrations/20261111161000_security_triggers_and_detection_rules.sql:54-60` (`sanitize_audit_json` only masks top-level JSONB keys), `316-364` (`audit_table_change` catches `WHEN OTHERS` with `RAISE WARNING` without resetting `app.trusted_security_writer`)
  - `supabase/migrations/20261111163000_n8n_security_events_bridge.sql:63-151, 167-442` (`notify_n8n_security_event` regex `^https?://` permits plaintext `http://`; `SECURITY DEFINER` trigger functions omit `REVOKE ALL FROM PUBLIC`)
  - `supabase/migrations/20261106144500_harden_security_definer_and_search_paths.sql:84` (widens `app_effective_role()` `search_path` from `''` to `public, auth, pg_temp`)
  - `supabase/migrations/20261111162000_security_retention_and_cron_schedules.sql:36-63` (no `p_function_name` allowlist; sends `service_role_key` via `pg_net` header)
- **Concrete Fix:** Fail closed on audit errors for sensitive tables (`app_users`, `organization_members`, `registration_approval_settings`) and reset `app.trusted_security_writer` in `EXCEPTION`; enforce `^https://` for `n8n_webhook_url`; `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` on trigger functions; recursively redact nested JSONB keys in `sanitize_audit_json()`; restore `SET search_path = ''` on `app_effective_role()`.

---

#### MED-03: `login-bridge` Spoofable IP Headers (`CF-Connecting-IP`/`X-Real-IP`), Missing Per-IP Rate Limit & Timing Enumeration
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Authentication / Rate-Limit Bypass (OWASP A07:2021 / CWE-290, CWE-307)
- **Locations:** `supabase/functions/login-bridge/index.ts:44-52, 224-272, 353-380, 406-571`
- **Attack Path & Prerequisites:** `extractClientIp` trusts attacker-controlled `cf-connecting-ip` and `x-real-ip` headers for forensic logs (`login_attempts`), while brute-force lockout (`L357-362`) queries failed attempts solely by `.eq("username", normalizedIdentifier)` with zero per-IP rate limit—allowing password spraying across all accounts and targeted denial-of-service lockout of individual usernames.
- **Concrete Fix:** Add per-IP sliding-window throttling (preferring `x-forwarded-for` rightmost proxy-appended IP or platform-verified connection IP), equalize failure response timings, and use CAPTCHA/progressive backoff rather than pure username-based permanent lockouts.

---

#### MED-04: Unthrottled `send_password_recovery` & Spoofable `Origin`/`Referer` Redirect URL Fallback
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Abuse / Open Redirect Fallback (OWASP A04/A05:2021 / CWE-799, CWE-601)
- **Locations:**
  - `supabase/functions/admin-users/index.ts:180-190, 575-794` (`resolveAppBaseUrl` trusts arbitrary non-localhost `Origin` if `APP_BASE_URL`/`SITE_URL` unset)
  - `supabase/functions/invite-user/index.ts:115-126, 192-198` (trusts `origin`/`referer`)
- **Concrete Fix:** Enforce strict origin allowlist (`https://warehouse-ledger-vert.vercel.app`) instead of trusting `Origin`/`Referer`, and apply per-IP and per-identifier rate limits on `send_password_recovery`.

---

#### MED-05: Fail-Open Password Check, Non-Atomic Activation Fallback & Weak Password Generation / Minimum Length
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Authentication & Weak Randomness (OWASP A07/A02:2021 / CWE-636, CWE-338, CWE-521)
- **Locations:**
  - `supabase/functions/complete-activation/index-pablo.ts:308-368` (plus `HEAD:complete-activation/index.ts`: `!pwdCheckErr && hasPwd === false` fails open when RPC errors; fallback update omits `.eq("status", "pending_activation")`; propagates `userRow.role` including `system_admin` while only setting `system_admin: false`)
  - `src/pages/UsersPage.tsx:266-273` (`generateRandomPassword()` uses `Math.random()` instead of `crypto.getRandomValues()`)
  - `src/pages/AuthPage.tsx:743, 807` (`activateAccount` enforces `minLength={10}` while `setNewPassword` allows `minLength={6}`)
- **Concrete Fix:** Fail closed (`if (pwdCheckErr || hasPwd !== true) return 400`), reject `userRow.role === "system_admin"` in `complete-activation`, make fallback updates conditional on `.eq("status", "pending_activation")`, replace `Math.random()` in `UsersPage.tsx` with `crypto.getRandomValues()` + unbiased modulo rejection, and align `setNewPassword` to `minLength={10}`–`12`.

---

#### MED-06: Unauthenticated Movement Data Exfiltration & Mutable `localStorage` Google Sheets Webhook
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Sensitive Data Exposure & Integrity (OWASP A01/A08:2021 / CWE-200, CWE-918)
- **Locations:** `src/lib/googleSheetsRealtimeSync.ts:10-33`
- **Attack Path & Prerequisites:** Warehouse inventory/pricing/recipient movements are pushed client-side in `no-cors` mode directly to an unauthenticated `VITE_GOOGLE_SHEETS_WEBHOOK_URL` or user-mutable `localStorage` override URL. Anyone obtaining or tampering with `localStorage` can redirect all subsequent inventory movement exports to an attacker endpoint.
- **Concrete Fix:** Move Google Sheets export/sync to a server-side Edge Function using an authenticated server secret URL and service-to-service credentials; remove the `localStorage` webhook override.

---

#### MED-07: Missing CSP & Cross-Origin Headers, Broad SW `.js` Caching, `vite.config.ts` `0.0.0.0` Bind, Unpinned CI Actions & Third-Party Tarball Dependency
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Security Misconfiguration & Supply Chain (OWASP A05/A08:2021 / CWE-693, CWE-829, CWE-1104)
- **Locations:**
  - `vercel.json:1-53` & `.vercel/output/config.json:1-60` (both lack `Content-Security-Policy`, `Cross-Origin-Opener-Policy`; `.vercel/output/config.json` also lacks `Strict-Transport-Security`; `vercel.json` runs `npm install` rather than `npm ci`)
  - `public/sw.js:1-137` (stale-while-revalidate caches all `.js` requests without excluding `/sw.js` itself if host headers drift)
  - `vite.config.ts:8` (`server.host: true` exposes Vite dev server on `0.0.0.0`)
  - `.github/workflows/ci.yml:11-39` & `.github/workflows/secret-scan.yml:11-16` (actions use mutable `@v4`/`@v5`/`@v6` tags instead of commit SHAs; missing `permissions:` blocks)
  - `package.json:35` (`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` fetched outside npm registry integrity flow; also bundled in `.vercel/output/static/assets/xlsx-t2wy1lCT.js` at `423,767 B`; note `zod@4.6.7` & `undici@8.12.4` resolved in `package-lock.json` relative to earlier Dependabot advisories)
- **Concrete Fix:** Add strict `Content-Security-Policy` (no `'unsafe-inline'` scripts) and `Cross-Origin-Opener-Policy: same-origin` to `vercel.json`; switch `installCommand` to `npm ci`; pin GitHub Actions to full 40-char commit SHAs with minimal `permissions: { contents: read }`; set Vite dev host to `127.0.0.1` unless explicitly overridden; verify `xlsx` integrity hash or migrate to an audited npm package.

---

#### MED-08: Dangerous Historical Rollbacks, Unapplied `pending/` Hardening & Broken `warehouse_merge_audit_log` RLS
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Configuration & Migration Hygiene (OWASP A05:2021 / CWE-276)
- **Locations:**
  - `supabase/rollbacks/20261013213000_harden_rls_rollback.sql:18-33` (drops `trg_prevent_audit_log_tamper` & grants `ALL TO anon, authenticated` `USING (true)`!)
  - `supabase/rollbacks/20261102220000_harden_security_and_privilege_escalation.rollback.sql:10-89` (reopens `disbursement_requests`, `budget_plans`, `financial_reports` to `USING (true)` / `auth.uid() IS NOT NULL`)
  - `supabase/rollbacks/_proposed_rls_hardening.sql:28, 44, 58, 72` & `supabase/migrations/20261102160000_merge_nursing_and_add_new_warehouses.sql` (`app_users.id = auth.uid()` TEXT vs UUID mismatch; `FOR ALL` policy on `warehouse_merge_audit_log`)
  - `supabase/pending/20261018173000_formalize_app_users_status_check_constraint.sql` & `supabase/pending/20261018130000_harden_telegram_user_sessions.sql` (security constraints never promoted to `migrations/`)
  - `scripts/generate_migration_sql.cjs:1-212`, `scripts/bootstrap-admin.md`, `scripts/bootstrap-system-admin.sql` (insecure/drifted SQL generators)
- **Concrete Fix:** Quarantine or fix dangerous rollback files so they cannot accidentally restore `USING (true)` / `anon` access; fix `warehouse_merge_audit_log` RLS to `FOR SELECT` with `public.app_effective_role() = 'system_admin'`; review and apply missing `app_users.status` CHECK constraint and `telegram_user_sessions` cleanup/revokes from `pending/`.

---

#### MED-09: `verify-email` Unpeppered Hashing / Non-Constant-Time Check / Non-Atomic Attempts + HTML Injection in Emails & Telegram Messages
- **Severity:** Medium
- **Confidence / Status:** Verified from code
- **Category:** Cryptographic & Markup Injection Weaknesses (OWASP A02/A03:2021 / CWE-328, CWE-208, CWE-79)
- **Locations:**
  - `supabase/functions/verify-email/index.ts:9-15, 28-35, 85-127` (`verify_jwt = false`; `!==` on `SUPABASE_SERVICE_ROLE_KEY` & hash; omits `OTP_PEPPER`; non-atomic `verification_attempts + 1`; retains used `verification_token_hash`)
  - `supabase/functions/admin-users/index.ts`, `supabase/functions/invite-user/index.ts`, `supabase/functions/telegram-bot/index.ts` (interpolates user names/reasons into email HTML and Telegram `parse_mode: "HTML"` messages)
- **Concrete Fix:** Use constant-time `timingSafeEqual`, shared `OTP_PEPPER`, and atomic attempt RPCs in `verify-email` (or decommission `verify-email` if superseded by `telegram-bot` RPCs); HTML-escape all user-controlled values before embedding in email or Telegram HTML templates.

---

### LOW Findings

#### LOW-01: Wildcard CORS (`*`) & Raw Error / Environment Name Disclosure
- **Severity:** Low
- **Confidence / Status:** Verified from code
- **Category:** Information Disclosure & Permissive CORS (CWE-942, CWE-209)
- **Locations:**
  - `supabase/functions/*/index.ts` (`Access-Control-Allow-Origin: *` across all Edge Functions; `critical-alerts:147,150` & `daily-report` disclose missing env var names; raw `err.message` returned in responses)
  - `src/pages/QualityPage.tsx:99`, `SettingsPage.tsx:218, 370`, `CustodyPage.tsx:2267, 2433, 2651, 3146`, `SupportPage.tsx:315, 366, 412`, `AuthPage.tsx:89-97` (reflects URL `error_description` & raw backend error strings)
- **Concrete Fix:** Restrict browser-called Edge Function CORS to `APP_BASE_URL` allowlists, strip CORS from non-browser cron/webhook Edge Functions, map frontend/backend errors to fixed localized messages, and validate `AuthPage` URL error codes against an allowlist.

---

#### LOW-02: Unbounded Queries in `critical-alerts` / `daily-report` & Unpaginated `listUsers` Truncation
- **Severity:** Low
- **Confidence / Status:** Verified from code
- **Category:** Availability / Incomplete Security Synchronization (CWE-400, CWE-863)
- **Locations:**
  - `supabase/functions/critical-alerts/index.ts:175-179, 254` (unfiltered query on `audit_alert_deliveries` capped at PostgREST 1,000-row default causes duplicate alert storms once >1,000 deliveries exist)
  - `supabase/functions/daily-report/index.ts:175-179` (unpaginated 24h `audit_logs` query truncates at 1,000 rows)
  - `supabase/functions/admin-users/index.ts:1106, 1223, 1307, 1403` & `supabase/functions/migrate-users/index.ts:120, 135-138, 163` (`listUsers` fetches page 1 only; `@warehouse.local` stripping desyncs real-email users; `migrate-users` propagates `system_admin: true` without `normalizeUsername`)
- **Concrete Fix:** Filter `audit_alert_deliveries` by `.in("audit_log_id", criticalLogIds)`, paginate `daily-report` & `listUsers`, match `app_users` by `auth_user_id`, and forbid `system_admin` migration via `migrate-users`.

---

#### LOW-03: Production Supabase Credentials / Network Calls in Unit Tests & SQL/Unit Test Drift
- **Severity:** Low
- **Confidence / Status:** Verified from code
- **Category:** Test Hygiene & Security Regression Blind Spots (CWE-540)
- **Locations:**
  - `tests/security_verification.test.ts:4-5` (hardcodes live Supabase project URL & publishable key and issues live network calls during `vitest run`)
  - `supabase/tests/dashboard_rpc.sql`, `derive_equivalence.sql`, `rls.sql` (placeholder `SELECT 1;`)
  - `supabase/tests/rls_protected_admin_and_passwords.sql`, `rls_security_matrix.sql`, `procurement_rls_and_rpc.sql` (stale `P0001` / dropped `app_role()` expectations)
  - `tests/unit/backup.test.ts:20`, `enterpriseAuth.test.ts:36-103`, `snapshot.test.ts:31` (mock/test expectations out of sync with hardened architecture)
- **Concrete Fix:** Mock network calls in `tests/security_verification.test.ts` (use env/local test URLs), implement real assertions in placeholder SQL tests, and update stale test assertions.

---

#### LOW-04: Sensitive PII, Audit Logs & Unencrypted Backups in `localStorage`, Incomplete Sign-Out Cleanup & Committed `-pablo` / Report Artifacts
- **Severity:** Low
- **Confidence / Status:** Verified from code
- **Category:** Client Data Hygiene & Repo Bloat (CWE-312, CWE-538)
- **Locations:**
  - `src/lib/localUsers.ts`, `src/lib/backup.ts`, `src/pages/SettingsPage.tsx:351-374` (stores unencrypted local user registries/backups and relies on full client restore)
  - Untracked/committed duplicates: `*-pablo.ts` (`13` files across `src/`, `supabase/`, `tests/`), `src/App-DESKTOP-O2AF58P.tsx`, `reports/*.md|json` (`.gitignore` only ignores `reports/screenshots/`, not `reports/*.md` / `*-pablo.*` / `portfolio-screenshots/`)
- **Concrete Fix:** Clear all application-cached PII/audit keys on `signOut()`, add integrity checksums / server validation on restores, remove stale `*-pablo.*` / conflict copies after merging needed deltas, and harden `.gitignore`.

---

#### LOW-05: Hardcoded Owner PII Literals Across Client Code, Docs & Prebuilt Output
- **Severity:** Low
- **Confidence / Status:** Verified from code
- **Category:** Sensitive Information Exposure (CWE-200)
- **Locations:**
  - `src/pages/SupportPage.tsx:48-50`, `AuditLogPage.tsx:456`, `.vercel/output/static/assets/index-BMPG62Qo.js` (owner email/phone/WhatsApp literals baked into client bundle)
  - `docs/ROLE_ACCESS_MATRIX.md:32` (discloses Supabase project ref `agfvwyycgqhzjbywyzqi`), `EMPLOYEE_REGISTRATION_SETUP.md`, `docs/DEPLOYMENT.md`, `docs/MIGRATION_NOTES.md` (personal emails & local Windows `file:///c:/Users/Glory/...` paths)
- **Concrete Fix:** Replace personal email/phone constants with configurable institutional contact settings (`AppSettings` / server env), scrub internal workstation paths and personal contact literals from docs, and rebuild/redeploy `.vercel/output`.

---

## 5. Hardening Observations and Manual Verification Items

1. **Pre-Existing Audit Artifacts (`reports/security-audit-report.md`):** Superseded early-November vulnerabilities (`supplier_contracts` `USING(true)` in `20261029120000`, `get_system_backup_stats()` `SECURITY DEFINER`, `purge_demo_test_data()` / `repair_movements_data_quality()` exposed to `authenticated`) were genuinely mitigated by `20261101103000`, `20261104201756`, and `20261106101500`—yet `reports/security-audit-report.md` missed `20261106140500`–`20261111163000` regressions (`CRIT-02`, `HIGH-04`, `HIGH-05`, `HIGH-06`) and introduced secret-prefix leakage (`HIGH-01`).
2. **Offline OneDrive Dehydrated Files (`515` files):** Hydrate `supabase/functions/complete-activation/index.ts` (`M`), `tests/unit/procurementStateMachine.test.ts` (`M`), the `7` `src/lib/*Repository.ts` (`M`) files, `src/App-DESKTOP-O2AF58P.tsx`, and `data/نموذج_استيراد_الورش_الهندسية.xlsx` on a machine with active OneDrive sync, then diff against `HEAD` / `-pablo.ts` versions before any deployment.
3. **Live Cloud State Verification (Not Executable Offline):**
   - Confirm in Supabase Dashboard / CLI which migrations (`20261010`–`20261111163000`) and Edge Function versions are actually deployed on `agfvwyycgqhzjbywyzqi`.
   - Confirm `verify_jwt` flags on deployed Edge Functions match `supabase/config.toml` (`telegram-bot`, `login-bridge`, `admin-users`, `verify-email`, `complete-activation`, `daily-report`, `critical-alerts` intentionally use `verify_jwt = false` with internal checks; `invite-user` and `migrate-users` enforce `verify_jwt = true`).
   - Run `npm audit` / `npm outdated` in an online CI environment to verify advisory status of transitive packages beyond lockfile inspection (`zod@4.6.7`, `undici@8.12.4` dev, `xlsx@0.20.3`).
4. **Database Operational Polish:** Fix `set_audit_log_actor()` (`20261013213000:116-127`) so `service_role` calls preserve `NEW.user_id` instead of overwriting with `NULL`; verify `system_backup_snapshots` table presence before running `20261029190000:640` index creation on fresh DB replays; replace `pg_get_functiondef` `regexp_replace(..., '\yBEGIN\y')` patching (`20261104201756`) with declarative SQL definitions.

---

## 6. Prioritized Remediation Checklist

> **Status:** No fixes have been applied. Waiting for explicit user approval specifying which items/files may be modified.

- [ ] **P0 — Rotate Compromised Secrets (`HIGH-01`):** Immediately revoke & rotate `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_PASS`, `VITE_GEMINI_API_KEY`, and `VERCEL_OIDC_TOKEN`; purge secret prefixes from `reports/security-audit-report.md` and `tests/unit/noHardcodedPasswords.test.ts`; audit git history per `docs/SECRETS_ROTATION_REQUIRED.md`.
- [ ] **P0 — Patch Admin XSS & Client Session Bypass (`CRIT-01`, `CRIT-04`, `CRIT-05`):** Eliminate `document.write` in `SupportPage.tsx` (`safePrint()`/React print); remove `getLocalSession()` fallback from `App.tsx` and plaintext `password` handling from `localUsers.ts`/`UsersPage.tsx`; fix `userMustChangePassword()` in `src/lib/permissions.ts` to trust strictly `app_metadata`.
- [ ] **P0 — Fix Critical SQL & Edge Auth Chains (`CRIT-02`, `CRIT-03`, `HIGH-02`, `HIGH-04`, `HIGH-05`, `HIGH-06`):** Write a new forward migration removing all `auth.jwt()->'app_metadata'` `OR` branches on audit/security tables and `purge_expired_audit_logs()`, hardening `support_tickets` & making `support-attachments` private (`public = false`), restoring `AND status = 'rejected'` on `disbursement_requests`, restricting `security_monitor_config` SELECT to `system_admin`/`service_role`, revoking `record_security_event()`/`audit_logs` direct writes from `authenticated`, and re-enabling Telegram email OTP + removing raw `actionLink`/Telegram hijacking in `telegram-bot` & `admin-users`.
- [ ] **P1 — Lock Down n8n, PostgREST Filters, Protected Accounts & AI Proxy (`HIGH-03`, `HIGH-07`, `HIGH-08`, `HIGH-09`, `HIGH-10`, `HIGH-11`, `HIGH-12`):** Enable webhook auth & fail-closed ban guards (`alwaysOutputData: false` + Auth `app_metadata` lookup) in n8n; parameterize all `.or()` filters; enforce protected `system_admin` checks across `set_user_status` & `invite-user`; proxy Gemini via Edge Function; ban SVG uploads; centralize `sanitizeSpreadsheetCell` across all CSV/XLSX exports; add handler-level RBAC guards & remove fail-open `AuthPage` login fallback.
- [ ] **P2 — Hardening, Headers, CI & Rollback Hygiene (`MED-01` – `MED-09`):** Restore `create_purchase_order` `SECURITY DEFINER`, fix trigger error/GUC handling & `https://` webhook check, add per-IP throttling & Origin allowlists to Edge Functions, harden `verify-email`/email HTML escaping, add CSP + SHA-pinned GitHub Actions + `npm ci` in `vercel.json`, move Google Sheets sync server-side, and repair `rollbacks/` + `pending/` migrations.
- [ ] **P3 — Cleanup & Verification (`LOW-01` – `LOW-05`):** Restrict CORS, paginate `listUsers` / `critical-alerts` / `daily-report`, hydrate blocked OneDrive files (`complete-activation`, repositories, `procurementStateMachine.test.ts`), remove `-pablo`/conflict files, update stale tests & docs, and run live `npm audit` + full Vitest + PGlite verification suite.

---

## 7. Complete File Review Ledger

Every discovered file in `c:\Users\NewAdmin\OneDrive\Desktop\warehouse-ledger` (`30,591` total filesystem entries: `910` project/output files inventoried individually below, plus `2,636` files under `.git/**` and `27,045` files under `node_modules/**` accounted for explicitly at the end of the ledger) is recorded below using the standard statuses (`REVIEWED`, `METADATA_ONLY`, `BLOCKED`). Files dehydrated as Windows OneDrive online-only stubs (`Attributes: Offline | RecallOnDataAccess`) returned `The cloud file provider is not running` and are strictly marked `BLOCKED`.

| Metric / Bucket | Count | Status | Notes |
|---|---:|---|---|
| Directly Reviewed Source / SQL / Edge / Config / Tests / Docs / Env | 349 | `REVIEWED` | Full accessible content read and evaluated against checklist categories. |
| Binary Images, PDFs, & Prebuilt Minified Vercel Assets | 46 | `METADATA_ONLY` | File size, type, and (for minified JS bundles) targeted string/secret pattern scans performed. |
| OneDrive Offline / Unhydrated Cloud Stubs | 515 | `BLOCKED` | OS error `The cloud file provider is not running`; `515` unreadable files (`dist/`: 131, `reports/screenshots/responsive/`: 221, `scratch/`: 152, `src/`: 8, `data/`: 1, `supabase/functions/complete-activation/index.ts`: 1, `tests/unit/procurementStateMachine.test.ts`: 1). |
| Repository Non-Vendor / Non-VCS Subtotal | 910 | Mixed | `349 + 46 + 515 = 910` files listed per-file below. |
| `.git/**` (VCS internals) | 2,636 | `METADATA_ONLY` | Git objects/refs/hooks enumerated; `HEAD` and `git status` inspected without reading arbitrary pack blobs. Historical exposed-secret commits are documented in `docs/SECRETS_ROTATION_REQUIRED.md` and `docs/STATUS_AND_REMAINING_TASKS.md`. |
| `node_modules/**` (Third-party dependencies) | 27,045 | `METADATA_ONLY` | Enumerated on disk; resolved versions audited via `package.json` & `package-lock.json` (`152` package folders). |
| **Grand Total Files Inside Project Root** | **30,591** | **Accounted 100%** | Every file discovered on disk accounted for with zero silent omissions. |

> **Ledger Note:** Shorthand tags in per-file `Notes` (e.g., `SQL-*` for database migrations, `F-*` within Edge Functions, `src/pages/**`, `src/lib/**`, or `scripts/tests`) reflect subsystem review tags consolidated into Section 4 (`CRIT-01`–`CRIT-05`, `HIGH-01`–`HIGH-12`, `MED-01`–`MED-09`, `LOW-01`–`LOW-05`).

| Path | Type | Status | Coverage Inspected | Notes |
|---|---|---|---|---|
| `.env` | env | REVIEWED | 18 lines (2182 B) | Live secrets present (key names only: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VERCEL_OIDC_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SMTP_USER, SMTP_PASS, VITE_GOOGLE_SHEETS_WEBHOOK_URL); values redacted; requires secret rotation & removal of VITE_ webhook exposure (AUTH-08 / SEC-01). |
| `.env.example` | env | REVIEWED | 75 lines (3338 B) | Empty secret placeholders (`VITE_GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_PEPPER`, `TELEGRAM_BOT_TOKEN`, `SMTP_PASS`, `GMAIL_APP_PASSWORD`, etc.); minor naming drift vs `docs/DEPLOYMENT.md`. [F-11] |
| `.env.local` | env | REVIEWED | 6 lines (1629 B) | Live client-inlined Gemini API key present (VITE_GEMINI_API_KEY non-empty) + VERCEL_OIDC_TOKEN + Supabase public env; values redacted (AUTH-08 / AI-01). |
| `.gitattributes` | config/other | REVIEWED | 32 lines (667 B) | Text/EOL and binary attributes; clean. |
| `.github/workflows/ci.yml` | config/other | REVIEWED | 22 lines (392 B) | Unpinned actions (`@v4`), missing explicit `permissions:` block. [F-02, F-03] |
| `.github/workflows/secret-scan.yml` | config/other | REVIEWED | 51 lines (1570 B) | Unpinned `@v4`, missing `permissions:`, partial leaked-secret substrings in `PATTERNS`, incomplete `SCAN_DIRS`/`--include` coverage. [F-02, F-03, F-04] |
| `.gitignore` | config/other | REVIEWED | 34 lines (342 B) | Duplicate `.vercel`; missing `*-pablo.*`, `portfolio-screenshots/`, `reports/*.json`, `reports/*.md` (only `reports/screenshots/` ignored). [F-07] |
| `.hintrc` | config/other | REVIEWED | 20 lines (237 B) | Webhint config; clean. |
| `.oxlintrc.json` | json | REVIEWED | 9 lines (253 B) | Oxlint rules; clean. |
| `.role-browser-check.mjs` | javascript | REVIEWED | 12 lines (756 B) | Local Puppeteer smoke check against `http://127.0.0.1:5174/`; no credentials. |
| `.vercel/.env.production.local` | env | REVIEWED | 25 lines (2058 B) | Vercel pulled production env metadata + VERCEL_OIDC_TOKEN + VITE_SUPABASE_URL/PUBLISHABLE_KEY (no server secrets); values redacted. |
| `.vercel/output/builds.json` | json | REVIEWED | 26 lines (750 B) | Vercel build output metadata (`@vercel/static-build`, Vite 8.3.4). |
| `.vercel/output/config.json` | json | REVIEWED | 51 lines (998 B) | Vercel Build Output v3 routing & response headers; includes X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, /sw.js no-cache, but omits CSP/HSTS/COOP compared to vercel.json. |
| `.vercel/output/diagnostics/cli_traces.json` | json | REVIEWED | 1 lines (5066 B) | Vercel CLI telemetry trace JSON; no secrets. |
| `.vercel/output/diagnostics/deploy-manifest.json` | json | REVIEWED | 1 lines (36719 B) | Vercel prebuilt deployment manifest; no secrets. |
| `.vercel/output/diagnostics/project-manifest.json` | json | REVIEWED | 1 lines (36696 B) | Vercel project asset manifest; no secrets. |
| `.vercel/output/static/apple-touch-icon.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2037 B) | Static PWA PNG icon binary in Vercel output. |
| `.vercel/output/static/assets/index-BMPG62Qo.js` | javascript | METADATA_ONLY | Minified build bundle metadata & pattern scan (932298 B) | Built minified app JS bundle (932,298 B); targeted scan found hardcoded admin email literals (`marwandesouq...`) baked into bundle; `AIza`/`generativelanguage` not present in this prebuilt snapshot. |
| `.vercel/output/static/assets/index-CjrFnrWn.css` | config/other | METADATA_ONLY | Minified build bundle metadata & pattern scan (91327 B) | Built minified stylesheet (91,327 B); metadata reviewed. |
| `.vercel/output/static/assets/xlsx-t2wy1lCT.js` | javascript | METADATA_ONLY | Minified build bundle metadata & pattern scan (423767 B) | Built minified SheetJS `xlsx@0.20.3` chunk (423,767 B); metadata reviewed. |
| `.vercel/output/static/favicon.svg` | asset | REVIEWED | 1 lines (9522 B) | Built static SVG icon. |
| `.vercel/output/static/icon-192.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2303 B) | Static PWA PNG icon binary in Vercel output. |
| `.vercel/output/static/icon-512.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (8972 B) | Static PWA PNG icon binary in Vercel output. |
| `.vercel/output/static/icon-maskable-192.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2100 B) | Static PWA PNG icon binary in Vercel output. |
| `.vercel/output/static/icon-maskable-512.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (8981 B) | Static PWA PNG icon binary in Vercel output. |
| `.vercel/output/static/icons.svg` | asset | REVIEWED | 25 lines (5031 B) | Built SVG sprite. |
| `.vercel/output/static/index.html` | config/other | REVIEWED | 30 lines (1331 B) | Built HTML shell (same CSP absence & preconnects as root index.html). |
| `.vercel/output/static/manifest.json` | json | REVIEWED | 51 lines (1205 B) | Built PWA manifest copy. |
| `.vercel/output/static/manifest.webmanifest` | config/other | REVIEWED | 51 lines (1205 B) | Built PWA manifest copy. |
| `.vercel/output/static/sw.js` | javascript | REVIEWED | 111 lines (3339 B) | Built Service Worker copy (same caching semantics as public/sw.js). |
| `.vercel/output/static/warehouse-favicon.svg` | asset | REVIEWED | 9 lines (419 B) | Built warehouse SVG icon. |
| `.vercel/project.json` | json | REVIEWED | 17 lines (402 B) | Vercel project/org link IDs (`warehouse-ledger`); no secrets. |
| `.vercel/README.txt` | config/other | REVIEWED | 12 lines (520 B) | Vercel CLI directory notice. |
| `.vercel/static-build/package-manifest.json` | json | REVIEWED | 2505 lines (55219 B) | Vercel snapshot of npm dependencies; aligns with package-lock.json. |
| `.vscode/settings.json` | json | REVIEWED | 6 lines (101 B) | Benign `typescript.tsdk` / lint configuration; no findings. |
| `automation/n8n/supabase-security-monitor.workflow.json` | json | REVIEWED | 1370 lines (44981 B) | Security monitoring & auto-ban workflow; fail-open ban guard, unauth webhook, prompt injection (`F-04`, `F-05`, `F-08`). |
| `data/نموذج_استيراد_الورش_الهندسية.xlsx` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 13147 B metadata) | OneDrive offline stub; unreadable locally. |
| `dist/apple-touch-icon.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2037 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/arrow-right-left-DFQ_hwom.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 288 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/AssetHistoryPage-BTdfV1NZ.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 14378 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/AssetHistoryPage-NfyiSI_l.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 14535 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/AuditLogPage-BLOSdb90.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11671 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/AuditLogPage-CfTFtInC.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11671 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/BudgetPage-D0SyhKns.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 14403 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/BudgetPage-wdq5n1If.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 14403 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/calendar-CDFiHFM-.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 295 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ChatbotAdminPage-CGE-xsng.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 25651 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ChatbotAdminPage-DG5EuJtq.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 25651 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/check-w98tGRnT.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 164 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/circle-alert-TKyhPTUK.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 315 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/circle-x-UhfWnyPP.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 268 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/cloud-upload-CmPp_2xB.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 316 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ContractsPage-B0od5eqS.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 26906 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ContractsPage-BCGd_jNN.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 26906 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/copy-eZ0_m4MO.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 276 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/createLucideIcon-D_dbBF8B.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 17105 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/custody-C87nKyAE.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 120429 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/custody-CNCxXb6H.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 118982 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/CustodyItemHistoryModal-BHM56d-B.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8357 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/CustodyItemHistoryModal-bLTlPjWz.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8357 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/CustodyPage-BrKnNm4n.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 98160 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/CustodyPage-CneU2xlN.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 98169 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/dateUtils-DT6Fx60X.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 799 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/DisbursementRequestsPage-Bj25fJ16.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22306 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/DisbursementRequestsPage-HUKCtHho.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22306 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/file-check-corner-dhbhTP2p.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 882 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/file-check-PIFv6qAB.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 358 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/file-up-56QUykaK.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 393 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/FinancialReportsPage-Bqcmb2qw.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 16991 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/FinancialReportsPage-wt-eo9V3.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 16991 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/funnel-DPFBFyuW.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 315 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-400-normal-CyU-ddYS.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 42848 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-400-normal-EA1o-u_Q.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44136 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-500-normal-C4MQITzh.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45296 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-500-normal-DPXcppbm.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46924 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-600-normal-0pRdybE_.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45688 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-600-normal-MJZ0liF5.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46780 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-700-normal-9rXc6cUL.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44364 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-arabic-700-normal-DrtBj6UE.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44280 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-400-normal-Bo5KPYvw.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19164 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-400-normal-CFZh1unN.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 17512 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-500-normal-BletK1Hp.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 18640 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-500-normal-Cd6jVIg7.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 20088 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-600-normal-Dk5eISD_.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 18880 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-600-normal-KrqB56Mw.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 20500 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-700-normal-BzSf6GNr.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19504 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-700-normal-Cl4F7CZR.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 17780 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-400-normal-BeVLg08x.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5100 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-400-normal-BpLfq-63.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 6656 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-500-normal-Ck_W4G78.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 6540 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-500-normal-eJxPnL1P.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5116 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-600-normal-DjDAeNQD.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 6680 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-600-normal-DT29Q8HW.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5124 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-700-normal-BSbyEp0V.woff2` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 6564 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ibm-plex-sans-arabic-latin-ext-700-normal-C7GcWn11.woff` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5084 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ImportPage-B8gasaDt.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11825 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ImportPage-CNjVoBn1.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11825 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/importRows-C4Cbnrko.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2223 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-2wkaRs52.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 750332 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-BaviQxJR.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 283208 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-Bfihf1HE.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1724010 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-BSrZ-iGX.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 282142 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-BxhLCGQF.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1737026 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-D5VSF-es.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1725791 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-DaIiU-vl.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 751742 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-DawiQtCd.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 283081 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-Dj7UXTE8.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1724507 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-DqgPecWW.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 287370 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-Dv6gpoKl.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 282202 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/index-K8WeKnfe.css` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 287526 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/InventoryAnalyticsPage-DA-nZqDa.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 9248 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/InventoryAnalyticsPage-DxWi328W.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 9248 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/InventorySettlementModal-D0qlrGHg.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 24420 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/InventorySettlementModal-DhUD6dtu.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 24420 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/mail-BZGBssVG.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 253 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/message-square-BlKVrvQE.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 273 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/NotificationsPage-aBG3Jywr.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5422 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/NotificationsPage-BSsvY__N.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5422 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/OfficialDisbursementPermitModal-CKSsQUgQ.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22602 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/OfficialDisbursementPermitModal-cpC8-6JR.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22602 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/OfficialInventoryReportModal-B7rCwX8r.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11391 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/OfficialInventoryReportModal-Dtpqw5e3.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11391 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/package-check-Ba5VSCE_.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 455 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/paperclip-CQS413vg.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 273 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/parse-aX0YMjrH.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2005 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/preload-helper-BLdHbfdN.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1519 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/printer-DZPYHpY2.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 359 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/printUtils-CAgWQg7r.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 703 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/PurchasesPage-BSFAwBQz.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19537 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/PurchasesPage-BWRBUvNI.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19265 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/purgeDemoData-HPbCfNA1.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2939 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/QualityPage-BJRZcIIm.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7228 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/QualityPage-Bkpw7lIg.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7228 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/QuotesPage-C8llEESS.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 32082 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/QuotesPage-CZYuAQhz.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 32082 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ReportsPage-Bw1PepyY.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 36315 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/ReportsPage-D3G5GlZG.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 36315 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/rotate-cw-PlsS-JaI.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 241 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/save-DuHlZBRX.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 367 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SettingsPage-CNfTgyxD.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 54372 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SettingsPage-tr7NZjKQ.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 54372 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/star-Csf5txnR.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 512 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/supabase-CGbs4KCY.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 216315 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SuppliersPage-B_TBtIKV.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 17041 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SuppliersPage-D3YpECO2.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 17041 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SupportPage-Cc12GYHB.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58312 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/SupportPage-IicjUzU6.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58312 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/TechnicalInspectionModal-Rnc-tHnh.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 25497 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/TechnicalInspectionModal-sXVK76Uq.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 25497 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/TelegramBotPage-BwLDbBzJ.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 16968 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/TelegramBotPage-Cw32-tiz.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 16974 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/user-D_k43zvr.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 236 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/users-EQ3XitbL.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 346 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/UsersPage-CFvsKPTL.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 68187 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/UsersPage-Li1B4Vfk.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 68188 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/xlsx-Bv_pSZNU.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 492120 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/assets/xlsx-t2wy1lCT.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 423767 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/favicon.svg` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 9522 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/icon-192.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2303 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/icon-512.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8972 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/icon-maskable-192.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2100 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/icon-maskable-512.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8981 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/icons.svg` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5031 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/index.html` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1662 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/manifest.json` | json | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1156 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/manifest.webmanifest` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1156 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/sw.js` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4463 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `dist/warehouse-favicon.svg` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 419 B metadata) | OneDrive offline stub in unhydrated Vite `dist/` build output. |
| `docs/DATA_MODEL.md` | markdown | REVIEWED | 240 lines (18510 B) | Schema documentation; clean. |
| `docs/DECISIONS.md` | markdown | REVIEWED | 53 lines (10529 B) | Architecture/security decisions log; clean. |
| `docs/DEPLOYMENT.md` | markdown | REVIEWED | 230 lines (16985 B) | Deployment guide; env var name drift (`REGISTRATION_OTP_PEPPER`, `SMTP_PASSWORD`, `BOOTSTRAP_ADMIN_IDENTITY` vs `.env.example`), hardcoded Windows `file:///c:/Users/Glory/...` links, mentions `[REDACTED_OWNER_EMAIL_1]`. [F-11] |
| `docs/EXECUTION_LOG.md` | markdown | REVIEWED | 16 lines (1273 B) | Historical log; clean. |
| `docs/FINAL_REPORT.md` | markdown | REVIEWED | 89 lines (5653 B) | Historical Oct 14 scaffolding report (read via PowerShell `Get-Content` because `read_file` flagged binary); clean. |
| `docs/LOCAL_VERIFICATION_CHECKLIST.md` | markdown | REVIEWED | 183 lines (16098 B) | Verification checklist; documents `--no-verify-jwt` deploy for `telegram-bot` & `login-bridge` and canonical admin email/username. [F-10, F-12] |
| `docs/MIGRATION_NOTES.md` | markdown | REVIEWED | 100 lines (7664 B) | Migration/rollback notes; `file:///c:/Users/Glory/...` local path links and `marwan-desouky@warehouse.local`. [F-11] |
| `docs/REMEDIATION_PROGRESS.md` | markdown | REVIEWED | 244 lines (28054 B) | Remediation tracker (Sessions A-G); clean. |
| `docs/ROLE_ACCESS_MATRIX.md` | markdown | REVIEWED | 44 lines (5446 B) | Role matrix summary; line 32 discloses Supabase project ref `agfvwyycgqhzjbywyzqi`. [F-08] |
| `docs/SECRETS_ROTATION_REQUIRED.md` | markdown | REVIEWED | 96 lines (4086 B) | Incident doc confirming real `SMTP_PASS` (`[REDACTED_OWNER_EMAIL_1]`), `TELEGRAM_BOT_TOKEN` (`\d+:AAE...`), and `VERCEL_OIDC_TOKEN` were previously in local `.env`/`.vercel/.env.production.local`. [F-04, F-10] |
| `docs/SECURITY_BASELINE.md` | markdown | REVIEWED | 45 lines (4933 B) | Historical baseline; clean. |
| `docs/SECURITY_FINDINGS.md` | markdown | REVIEWED | 65 lines (8027 B) | Oct 14 security findings summary; clean. |
| `docs/SECURITY_REMEDIATION_20261021.md` | markdown | REVIEWED | 157 lines (10621 B) | Oct 21 remediation summary; clean. |
| `docs/STATUS_AND_REMAINING_TASKS.md` | markdown | REVIEWED | 96 lines (9030 B) | Oct 18 status report; confirms previous admin password was exposed in Git commits `8ee6ca8` & `bd3da4b`. [F-10] |
| `docs/UI_AUDIT.md` | markdown | REVIEWED | 89 lines (13044 B) | UI/UX metrics; clean. |
| `docs/UI_CHANGES.md` | markdown | REVIEWED | 107 lines (8885 B) | UI/UX changelog; clean. |
| `EMPLOYEE_REGISTRATION_SETUP.md` | markdown | REVIEWED | 310 lines (26154 B) | Onboarding/Telegram/SMTP setup doc; discloses canonical owner email (`[REDACTED_OWNER_EMAIL_1]`), username (`marwan-desouky`), employee ID (`SYS-ADM-000001`). [F-10] |
| `fixtures/original-data.json` | json | REVIEWED | 464 lines (12600 B) | Appendix A warehouse movement test fixture (33 rows); no secrets. |
| `index.html` | config/other | REVIEWED | 25 lines (932 B) | RTL entry, manifest/SVG icon links; no CSP meta (`F-17`) |
| `package.json` | json | REVIEWED | 63 lines (1935 B) | `xlsx` fetched from external CDN tarball URL (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`); `allowScripts` disables `@google/genai` & `protobufjs`. [F-06] |
| `package-lock.json` | json | REVIEWED | 4880 lines (165465 B) | npm lockfile v3; resolves zod@4.6.7 (prod), undici@8.12.4 (dev), @supabase/supabase-js@2.117.3 (prod), xlsx@0.20.3 (prod via SheetJS CDN tarball), @google/genai@2.32.0 (dev), vite@8.3.4 (dev). Offline audit (no live npm registry audit run). |
| `public/apple-touch-icon.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2037 B) | Static PWA icon binary |
| `public/favicon.svg` | asset | REVIEWED | 1 lines (9522 B) | Static SVG icon; clean |
| `public/icon-192.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2303 B) | Static PWA icon binary |
| `public/icon-512.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (8972 B) | Static PWA icon binary |
| `public/icon-maskable-192.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (2100 B) | Static PWA icon binary |
| `public/icon-maskable-512.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (8981 B) | Static PWA icon binary |
| `public/icons.svg` | asset | REVIEWED | 25 lines (5031 B) | Static SVG sprite; clean |
| `public/manifest.json` | json | REVIEWED | 51 lines (1156 B) | Static PWA manifest; clean |
| `public/manifest.webmanifest` | config/other | REVIEWED | 51 lines (1156 B) | Static PWA manifest; clean |
| `public/sw.js` | javascript | REVIEWED | 138 lines (4463 B) | Service Worker `warehouse-ledger-v2-bounded`; caches same-origin GET 200 without `basic`/`no-store` checks (`F-13`) |
| `public/warehouse-favicon.svg` | asset | REVIEWED | 9 lines (419 B) | Static SVG icon; clean |
| `README.md` | markdown | REVIEWED | 26 lines (1151 B) | Project overview; clean. |
| `reports/responsive-matrix-report.md` | markdown | REVIEWED | 136 lines (9009 B) | Generated Playwright responsive audit Markdown report (unignored in git). |
| `reports/screenshots/responsive/إدارة_العقود_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 254157 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 146637 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 182994 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 122738 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59186 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 66170 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45125 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_العقود_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 208754 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 321805 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 160603 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 191863 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 131108 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 61945 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 62399 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 66198 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 47845 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 82764 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 83935 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إدارة_بوت_تيليجرام_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 242613 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 229625 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 137010 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 153933 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 111685 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 55121 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58767 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65957 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45696 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65106 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 74285 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/استيراد_Excel_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 185483 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 396946 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 136260 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 174059 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 116981 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 55212 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 56605 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59923 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45693 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 68549 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 76791 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/إعدادات_المؤسسة_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 241541 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 375031 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 162817 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 206105 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 132671 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65082 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 70470 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 73631 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 47184 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 85807 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 97702 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_الرسمية_والجرد_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 276261 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 249697 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 145080 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 172393 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 123366 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 57934 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 63150 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44963 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/التقارير_المالية_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 204824 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الدعم_الفني_والتذاكر_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 136940 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الدعم_الفني_والتذاكر_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 97076 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الدعم_الفني_والتذاكر_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 35448 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الدعم_الفني_والتذاكر_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22703 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الدعم_الفني_والتذاكر_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 117940 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 406066 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 173007 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 204720 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 136769 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59069 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 62450 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65948 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 43110 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65263 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 80368 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الرئيسية_ومؤشرات_الأداء_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 260856 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 270604 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 150159 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 179113 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 129765 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59323 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 60663 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65050 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46867 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 74063 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 91347 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المستخدمون_والصلاحيات_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 218268 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 390036 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 155942 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 196372 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 121564 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58976 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 68336 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 43070 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 87088 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/المشتريات_والفواتير_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 265828 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 252406 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 145312 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 175309 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 127164 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58170 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 64510 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46849 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/الميزانية_والتخطيط_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 207600 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 616213 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 319355 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 448598 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 267138 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 68691 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 76974 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 92204 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 34876 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 199456 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 183307 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/بوابة_المصادقة_والدخول_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 512346 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 342176 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 143208 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 188407 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 121561 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 63741 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45141 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تحليلات_المخزون_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 252023 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 277556 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 135147 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 177438 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112554 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 53864 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 52750 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59425 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 41518 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 67952 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 79981 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/تسجيل_فاتورة_وتوريد_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 230169 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 232295 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 136442 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 156015 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112843 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58017 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45079 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 73693 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_العمليات_الأمنية_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 187245 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 253366 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 159689 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 180990 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 115242 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 60160 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 65387 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 43900 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 81257 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_الموردين_والشركات_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 207636 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 238415 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 149735 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 168242 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 131192 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 55864 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46970 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_حركة_الأصول_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 194069 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 542021 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 173977 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 213694 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 147272 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 66055 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 67958 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 77044 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 47748 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 89895 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 109620 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/سجل_عهدة_المخازن_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 299171 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 207539 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 124672 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 140023 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112132 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59382 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 60517 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 92204 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44445 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 199456 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 183307 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/صفحة_الرابط_غير_موجود_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 164869 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 239694 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 142231 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 172814 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 123351 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 55396 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 64281 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 43714 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/طلبات_الصرف_الداخلي_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 196005 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 243933 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 140251 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 168810 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 111369 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 57229 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45990 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/عروض_الأسعار_والأوامر_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 198474 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 415987 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 160012 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 203214 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 131348 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 57419 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_m390_390x844.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 60324 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46880 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 73436 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 102251 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/فحص_الجودة_والتدقيق_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 273848 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 214025 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 121450 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 140130 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 109044 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 55004 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 43885 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/مركز_الإشعارات_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 165050 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_4k_3840x2160.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 272466 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_fhd_1440x900.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 145516 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_fhd1080_1920x1080.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 181367 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_laptop_1280x800.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 128126 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_m375_375x812.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 59508 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_m428_428x926.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 67415 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_se_320x568.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46534 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_tab_l_1024x768.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 79367 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_tab_p_768x1024.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 88744 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/responsive/منصة_المساعد_الذكي_ultrawide_2560x1440.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 220223 B metadata) | OneDrive offline stub PNG screenshot (responsive matrix output). |
| `reports/screenshots/الإعدادات_والمزامنة_desktop.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (319355 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/الإعدادات_والمزامنة_mobile.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (70215 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/الرئيسية_وحركات_المخزن_desktop.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (319355 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/الرئيسية_وحركات_المخزن_mobile.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (70215 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/المشتريات_والموردين_desktop.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (319355 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/المشتريات_والموردين_mobile.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (70215 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/كشف_حصر_العهدة_desktop.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (319355 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/screenshots/كشف_حصر_العهدة_mobile.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (70215 B) | Static Playwright desktop/mobile PNG screenshot. |
| `reports/security-audit-report.md` | markdown | REVIEWED | 334 lines (23955 B) | Pre-existing 2026-11-06 security report containing truncated prefixes of `.env` secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SMTP_PASS`, `VERCEL_OIDC_TOKEN`, Gemini key); missed Nov 6-11 regressions (SEC-01 / MON-01). |
| `reports/uiux-audit-latest.json` | json | REVIEWED | 112 lines (4744 B) | Generated UI/UX Playwright+Gemini JSON audit output (unignored in git). |
| `scratch/approach-p1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5516 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/approach-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 45015 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/app-watermark-render.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 25712 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/bg-p1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 204263 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/bg-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 204263 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/bulk-60-items-report.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 371032 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/bulk-rendered-check.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11961 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/capture-settlement-element.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1536 B metadata) | 1536 bytes; OS error: The cloud file provider is not running` |
| `scratch/check-medicine-duplicates.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1399 B metadata) | 1399 bytes; OS error: The cloud file provider is not running` |
| `scratch/check-nursing-data.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3445 B metadata) | 3445 bytes; OS error: The cloud file provider is not running` |
| `scratch/check-settlement.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1893 B metadata) | 1893 bytes; OS error: The cloud file provider is not running` |
| `scratch/check-wm-position.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3516 B metadata) | 3516 bytes; OS error: The cloud file provider is not running` |
| `scratch/crop_ee5d50b1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 15818 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/cropped-table.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 22981 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-inspection.pdf` | config/other | METADATA_ONLY | Binary/minified asset metadata only (108594 B) | Binary PDF/PNG verification artifact; metadata checked. |
| `scratch/final-inspection-print.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 138047 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-inspection-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 171419 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-inventory-report.pdf` | config/other | METADATA_ONLY | Binary/minified asset metadata only (261544 B) | Binary PDF/PNG verification artifact; metadata checked. |
| `scratch/final-inventory-report-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 298393 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-pdf-view.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (189419 B) | Binary PDF/PNG verification artifact; metadata checked. |
| `scratch/final-permit.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 134648 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-permit-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 130162 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-settlement.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112478 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-settlement-print.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 264294 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/final-settlement-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 481699 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/fixed_table_crop.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 38020 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/fixed-p1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5516 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/fixed-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 137353 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/flex-p1.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44322 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/flex-p2.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 44323 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/flex-p3.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 39357 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inspection-print-preview.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 130312 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inspection-print-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 102071 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inspection-repro.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 138280 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inspection-verified.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 109023 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inspect-permit-print.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3548 B metadata) | 3548 bytes; OS error: The cloud file provider is not running` |
| `scratch/inventory-print-preview.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 310493 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/inventory-report-verified.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 274026 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/live-preview-element.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 140341 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/page-1-only.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 181075 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/page-2-only.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 160225 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/patch-custody.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 6142 B metadata) | 6142 bytes; OS error: The cloud file provider is not running` |
| `scratch/patch-reports-page.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3249 B metadata) | 3249 bytes; OS error: The cloud file provider is not running` |
| `scratch/pdf-page-1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5060 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/pdf-page-2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 34752 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/pdf-rendered-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 122312 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/pdf-viewer-approach.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 33874 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/permit-debug.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3581855 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/permit-modal-screen.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 273283 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/permit-verified.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 134012 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/print-emulated-thead.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 27287 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/print-preview-element.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 101001 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/print-wm-perfect.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 159573 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/print-wm-perfect.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 86827 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/rendered-pdf-view.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 166887 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/render-pdf.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 863 B metadata) | 863 bytes; OS error: The cloud file provider is not running` |
| `scratch/render-permit-view.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2821 B metadata) | 2821 bytes; OS error: The cloud file provider is not running` |
| `scratch/screen-modal-permit.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 296414 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/screen-modal-permit-fixed.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 200418 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/screen-modal-permit-with-items.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 114215 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/screenshot-permit-debug.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 804 B metadata) | 804 bytes; OS error: The cloud file provider is not running` |
| `scratch/screen-wm-perfect.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 125288 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/settlement-direct-element.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 299536 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/settlement-print-preview.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 308043 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/settlement-table-crop.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5115 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/settlement-verified.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112635 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/standalone-full-check.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 42892 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/standalone-rendered.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2728 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-app-real-report.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4168 B metadata) | 4168 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-app-real-report.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 261694 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-approach-fixed.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 31531 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-app-watermark.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 20322 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-body-bg.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 95537 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-deduplicate.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3378 B metadata) | 3378 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-fixed-flex.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2782 B metadata) | 2782 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-fixed-flex.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 60069 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-fixed-fullscreen.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 47763 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-fixed-mm.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5746 B metadata) | 5746 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-inspection.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 137970 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-inspection-and-inv.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4651 B metadata) | 4651 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-inspection-debug.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5117 B metadata) | 5117 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-inspection-print.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 91723 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-inspection-repro.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4283 B metadata) | 4283 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-opt-inset.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58727 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-opt-mm.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58726 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-opt-thead.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 112531 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-opt-vh.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 58727 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-perfect-repeating-bg.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 9182 B metadata) | 9182 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-perfect-watermark.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 513962 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-permit-data.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4388 B metadata) | 4388 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-permit-fixed.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5655 B metadata) | 5655 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-permit-fixed.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 204230 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-permit-inspect.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 137942 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-permit-rendered.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 266349 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-permit-thorough.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5721 B metadata) | 5721 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-png-svg.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2632 B metadata) | 2632 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-print-render.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4011 B metadata) | 4011 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-real-png-watermark.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 63222 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-settlement-print.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 138061 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-settlement-print.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 33747 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-signatures-p2.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 79768 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-sig-p2.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3507 B metadata) | 3507 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-standalone-watermark.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 41719 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-thead-1p.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 66353 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-thead-2p.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 121460 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-thead-3p.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 185260 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-thead-watermark.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2840 B metadata) | 2840 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-thead-watermark.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 100805 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-thead-with-png.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7369 B metadata) | 7369 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-warehouse-matching.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 12827 B metadata) | 12827 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-watermark-options.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3778 B metadata) | 3778 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-watermark-positions.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3760 B metadata) | 3760 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-watermark-standalone.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2179 B metadata) | 2179 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-wm-behavior.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2154 B metadata) | 2154 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-wm-fix.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3646 B metadata) | 3646 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-wm-inset.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19978 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/test-wm-rect.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4361 B metadata) | 4361 bytes; OS error: The cloud file provider is not running` |
| `scratch/test-wm-transform.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 19976 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/thead-p1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7891 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/thead-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 129239 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_insp_table.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 106569 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_row_161_187.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 10095 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_row_187_244.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 46017 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_row_45_161.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 30832 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_table_crop.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 41345 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_wm_bottom.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 89169 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_wm_mid.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 136270 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/user_wm_top.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 102576 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/verify-all-modals.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 11200 B metadata) | 11200 bytes; OS error: The cloud file provider is not running` |
| `scratch/verify-inspection-final.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 103821 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/verify-live.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 1436 B metadata) | 1436 bytes; OS error: The cloud file provider is not running` |
| `scratch/verify-settlement-final.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 306310 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/verify-watermarks-and-print.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4787 B metadata) | 4787 bytes; OS error: The cloud file provider is not running` |
| `scratch/verify-wm-final.mjs` | javascript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 2908 B metadata) | 2908 bytes; OS error: The cloud file provider is not running` |
| `scratch/view-app-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 298358 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-app-real-report.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 292362 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-fixed-flex.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 141891 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-opt-inset.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 124025 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-opt-mm.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 114772 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-opt-thead.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 101381 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-opt-vh.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 124025 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-p2-full.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8832 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-page-1.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5060 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-page-2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7233 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-perfect-p1-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 150834 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-perfect-p2-p3.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 226946 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-permit-debug.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 121659 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-real-png-watermark.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 8022 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-signatures-p2.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 77790 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-thead-2p.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 7839 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-thead-2p-loaded.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 190703 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/view-thead-3p.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 198961 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/wm-debug-2items.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 159462 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/wm-fixed-2items.pdf` | config/other | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 159099 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scratch/wm-fixed-screenshot.png` | asset | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 79360 B metadata) | OneDrive offline stub (untracked local scratch/debug script or artifact; unreadable offline). |
| `scripts/audit-uiux.mjs` | javascript | REVIEWED | 415 lines (14822 B) | Playwright + Gemini UI/UX audit; falls back to live prod URL `https://warehouse-ledger-vert.vercel.app`, sends DOM/screenshots to Gemini using `GEMINI_API_KEY`/`VITE_GEMINI_API_KEY`, writes unignored `reports/uiux-audit-latest.json`. [F-07] |
| `scripts/bootstrap-admin.md` | markdown | REVIEWED | 117 lines (5079 B) | Legacy SQL bootstrap guide inserting directly into `auth.users` via `pgcrypto` + placeholder password; `app_users.role = 'admin'` drifts from `app_metadata.role = 'system_admin'`, email `marwan-desouky@warehouse.local`. [F-11] |
| `scripts/bootstrap-system-admin.md` | markdown | REVIEWED | 64 lines (4780 B) | Hardened bootstrap guide via `public.bootstrap_system_admin('[REDACTED_OWNER_EMAIL_1]', 'marwan-desouky', ...)`. [F-10, F-11] |
| `scripts/bootstrap-system-admin.sql` | sql | REVIEWED | 72 lines (3144 B) | Legacy SQL mutating `auth.users.raw_app_meta_data` for `marwan-desouky@warehouse.local` and inserting `app_users.role = 'admin'` instead of `system_admin`. [F-11] |
| `scripts/build_medicine_67_items.cjs` | javascript | REVIEWED | 164 lines (16239 B) | Generates `src/lib/medicineCustody67.ts` from static array; no secrets. |
| `scripts/build_workshop_items.cjs` | javascript | REVIEWED | 104 lines (5416 B) | Parses local workshop Excel file into `src/lib/engineeringWorkshopsCustody81.ts`; no secrets. |
| `scripts/generate_medicine_67_migration.cjs` | javascript | REVIEWED | 75 lines (2371 B) | Generates destructive `DELETE FROM public.custody_items WHERE warehouse_id IN ('medicine', 'nursing');` + INSERT migration. [F-01b] |
| `scripts/generate_migration_sql.cjs` | javascript | REVIEWED | 213 lines (7599 B) | **CRITICAL**: Generates SQL granting `SELECT, INSERT, UPDATE, DELETE ON public.custody_items TO anon, authenticated` and `GRANT EXECUTE ON FUNCTION public.import_custody_batch TO anon, authenticated` (`SECURITY DEFINER` with `p_force` DELETE). [F-01] |
| `scripts/generate-portfolio-screenshots.js` | javascript | REVIEWED | 1232 lines (43044 B) | Puppeteer script seeding mock session into `localStorage`/`sessionStorage` on localhost; writes to unignored `portfolio-screenshots/`. [F-07] |
| `scripts/import-engineering-workshops.ts` | typescript | REVIEWED | 166 lines (6234 B) | Parses workshop Excel data; no secrets. |
| `scripts/responsive-full-audit.mjs` | javascript | REVIEWED | 749 lines (31419 B) | Serves `dist/` locally on `127.0.0.1:4173`, injects mock `system_admin` session into `localStorage`, writes unignored `reports/responsive-matrix-report.md`. [F-07] |
| `scripts/run_workshop_import.cjs` | javascript | REVIEWED | 153 lines (8142 B) | Console summary of workshop Excel import; no secrets. |
| `scripts/test_backup_system.cjs` | javascript | REVIEWED | 121 lines (4453 B) | String-matching static check on backup files; no secrets. |
| `scripts/test_import_logic.cjs` | javascript | REVIEWED | 107 lines (5330 B) | Static assertions on Excel/TS/SQL outputs; no secrets. |
| `scripts/test_security_audit.cjs` | javascript | REVIEWED | 68 lines (2794 B) | String-matching static check on migration/TSX files; no secrets. |
| `src/App.css` | config/other | REVIEWED | 13243 lines (272659 B) | UI, responsive & `@media print` shield CSS; clean |
| `src/App.tsx` | typescript | REVIEWED | 3934 lines (179887 B) | `getLocalSession` fallback (`F-02`), incomplete `sanitizeExcelCell` & unsanitized `price` (`F-07`), unvalidated `logoSource` into `link.href`/`img.src` (`F-11`), movements in `localStorage` (`F-12`) |
| `src/App-DESKTOP-O2AF58P.tsx` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 175251 B metadata) | OneDrive conflict-copy stub (`??` untracked, 39,944 B); unreadable offline. |
| `src/assets/hero.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (13057 B) | Static image binary |
| `src/assets/react.svg` | asset | REVIEWED | 1 lines (4126 B) | Static SVG asset; clean |
| `src/assets/vite.svg` | asset | REVIEWED | 2 lines (8709 B) | Static SVG asset; clean |
| `src/components/AccessibleDialog.tsx` | typescript | REVIEWED | 215 lines (6386 B) | Focus-trapped accessible modal; clean |
| `src/components/CustodyAnalyticsDashboard.tsx` | typescript | REVIEWED | 336 lines (14343 B) | Read-only custody charts/KPIs; clean |
| `src/components/CustodyItemHistoryModal.tsx` | typescript | REVIEWED | 299 lines (12405 B) | Custody history modal; clean |
| `src/components/ErrorBoundary.tsx` | typescript | REVIEWED | 65 lines (1981 B) | Renders raw `this.state.error?.message` in UI (`F-16`) |
| `src/components/InventorySettlementModal.tsx` | typescript | REVIEWED | 816 lines (35820 B) | Weak `sanitizeExcelCell` missing `.trim()` & `[\t\r\n]` (`F-07`); `localStorage` fallback (`F-12`) |
| `src/components/OfficialDisbursementPermitModal.tsx` | typescript | REVIEWED | 828 lines (39475 B) | Safe React JSX print; unvalidated `logoUrl` (`F-11`), `Math.random()` draft permit ID (`F-17`) |
| `src/components/OfficialInventoryReportModal.tsx` | typescript | REVIEWED | 298 lines (14524 B) | Uses `safePrint` & `exportCustodyToExcel` (inherits `F-07`) |
| `src/components/PageLoadingFallback.tsx` | typescript | REVIEWED | 12 lines (432 B) | Loading spinner; clean |
| `src/components/ProcurementAnalyticsDashboard.tsx` | typescript | REVIEWED | 359 lines (14799 B) | Weak `sanitizeExcelCell` missing `.trim()` & `[\t\r\n]` (`F-07`) |
| `src/components/ProcurementSubNav.tsx` | typescript | REVIEWED | 63 lines (1636 B) | Sub-navigation links; clean |
| `src/components/TechnicalInspectionModal.tsx` | typescript | REVIEWED | 884 lines (36849 B) | Weak `sanitizeExcelCell` missing `.trim()` & `[\t\r\n]` (`F-07`); `localStorage` fallback (`F-12`) |
| `src/components/WarehouseChatBot.tsx` | typescript | REVIEWED | 780 lines (35931 B) | Hardcoded personal Gmail/phone (`F-10`), invokes `runDataQualityAutoRepair` (`F-08`), forwards live DB context to Gemini (`F-04`) |
| `src/index.css` | config/other | REVIEWED | 829 lines (18953 B) | Design tokens & base CSS; clean |
| `src/lib/accessContext.ts` | typescript | REVIEWED | 88 lines (4306 B) | Sign-out cleanup omits `warehouse-ledger-audit-logs`, `settings`, `theme`, `warehouse_ledger_registration_requests`, `znu_*` (`F-12`) |
| `src/lib/approvalPaths.ts` | typescript | REVIEWED | 41 lines (1526 B) | Static workflow definitions; clean |
| `src/lib/arabicUtils.ts` | typescript | REVIEWED | 31 lines (1239 B) | Arabic text normalizer; clean |
| `src/lib/assetMovementRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4089 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/assetMovementRepository-pablo.ts` | typescript | REVIEWED | 147 lines (4142 B) | Missing `assertDepartmentWrite` on `clearAllAssetMovements` (`F-08`), silent `localStorage` fallback (`F-14`), drift vs cloud placeholder (`F-15`) |
| `src/lib/auditLogger.ts` | typescript | REVIEWED | 299 lines (10383 B) | Stores IPs/emails/user agents/details in `localStorage` & queries `api.ipify.org`/`api64.ipify.org` (`F-12`) |
| `src/lib/authMode.ts` | typescript | REVIEWED | 61 lines (2066 B) | Defaults `VITE_AUTH_MODE` to `'transitional'` (`F-02`) |
| `src/lib/authSessionUtils.ts` | typescript | REVIEWED | 109 lines (3183 B) | Strips auth URL fragments via `history.replaceState`; clean |
| `src/lib/autoBackupEngine.ts` | typescript | REVIEWED | 494 lines (17977 B) | Stores unencrypted full system snapshot (`users`, `auditLogs`, etc.) in `localStorage` (`F-12`) |
| `src/lib/backup.ts` | typescript | REVIEWED | 1763 lines (64553 B) | Unencrypted PII/key/log backups & restores `settings`/`users`/`chatbotDirectives` (`F-04`, `F-11`, `F-12`), imports non-`-pablo` placeholders (`F-15`) |
| `src/lib/budgetRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 5058 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/budgetRepository-pablo.ts` | typescript | REVIEWED | 162 lines (4897 B) | Silent `localStorage` fallback (`F-14`), drift vs placeholder (`F-15`) |
| `src/lib/chatbotKnowledge.ts` | typescript | REVIEWED | 278 lines (26169 B) | Hardcoded personal Gmail & phone (`F-10`) |
| `src/lib/chatbotLiveContext.ts` | typescript | REVIEWED | 240 lines (8197 B) | Aggregates live custody/contracts/budgets/movements for Gemini (`F-04`) |
| `src/lib/contractsRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4785 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/contractsRepository-pablo.ts` | typescript | REVIEWED | 175 lines (4611 B) | Base64 contract attachments in `localStorage` (`F-12`), silent `localStorage` fallback (`F-14`), drift (`F-15`) |
| `src/lib/currency.ts` | typescript | REVIEWED | 80 lines (2435 B) | Pure currency formatter; clean |
| `src/lib/custody.ts` | typescript | REVIEWED | 2367 lines (87248 B) | Unsanitized XLSX exports (`F-07`), premature `localStorage` wipe & unguarded custody sync helpers (`F-08`), skips validation for non-system-admins (`F-16`) |
| `src/lib/custodyImport.ts` | typescript | REVIEWED | 509 lines (19469 B) | Weak `sanitizeCsvCell` missing `.trim()` & `\n` (`F-07`) |
| `src/lib/dataQualityAutoRepair.ts` | typescript | REVIEWED | 280 lines (9260 B) | `runDataQualityAutoRepair` mutates `localStorage` & calls `repair_movements_data_quality` RPC without `assertDepartmentWrite` (`F-08`) |
| `src/lib/dateUtils.ts` | typescript | REVIEWED | 87 lines (2570 B) | Cairo timezone helpers; clean |
| `src/lib/derive.ts` | typescript | REVIEWED | 153 lines (5248 B) | Pure movement/summary derivations; clean |
| `src/lib/disbursementRequestsRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 3214 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/disbursementRequestsRepository-pablo.ts` | typescript | REVIEWED | 128 lines (3087 B) | Silent `localStorage` fallback (`F-14`), drift vs placeholder (`F-15`) |
| `src/lib/employeeIdentity.ts` | typescript | REVIEWED | 320 lines (11237 B) | Hardcoded admin username & personal Gmail in `RESERVED_USERNAMES` (`F-10`) |
| `src/lib/engineeringWorkshopsCustody81.ts` | typescript | REVIEWED | 1546 lines (48040 B) | Static 81 workshop custody dataset; clean (bundle bloat noted in C) |
| `src/lib/financialReportsRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4421 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/financialReportsRepository-pablo.ts` | typescript | REVIEWED | 148 lines (4274 B) | Silent `localStorage` fallback (`F-14`), drift vs placeholder (`F-15`) |
| `src/lib/fixture.ts` | typescript | REVIEWED | 28 lines (688 B) | Static fixture wrapper; clean |
| `src/lib/geminiService.ts` | typescript | REVIEWED | 402 lines (18384 B) | `VITE_GEMINI_API_KEY`, `localStorage` API key + `?key=` query param, `localStorage` directives prompt injection (`F-04`), hardcoded personal phone/email (`F-10`) |
| `src/lib/googleSheetsRealtimeSync.ts` | typescript | REVIEWED | 184 lines (6591 B) | Hardcoded Apps Script webhook URL, `localStorage` webhook override, unauthenticated `no-cors` movement exfiltration (`F-09`) |
| `src/lib/importRows.ts` | typescript | REVIEWED | 211 lines (7740 B) | `generateMovementErrorReportCsv` has CSV Formula Injection (`F-07`) |
| `src/lib/invitations.ts` | typescript | REVIEWED | 211 lines (6608 B) | Edge function `invite-user` wrapper; minor raw error logging (`F-16`) |
| `src/lib/localUsers.ts` | typescript | REVIEWED | 813 lines (28718 B) | Plaintext `password` stored/retained in `app_users` (`F-01`), unsigned `LocalUserSession` admin bypass (`F-02`), hardcoded PII (`F-10`) |
| `src/lib/medicineCustody67.ts` | typescript | REVIEWED | 1222 lines (46194 B) | Static verified 67 items; clean |
| `src/lib/medicineCustody88.ts` | typescript | REVIEWED | 1501 lines (53881 B) | Legacy duplicate 88-item dataset; clean (drift/bloat noted in C) |
| `src/lib/medicineCustodyData.json` | json | REVIEWED | 750 lines (28254 B) | Legacy duplicate 44-item JSON dataset; clean (drift/bloat noted in C) |
| `src/lib/movementsRepository.ts` | typescript | REVIEWED | 234 lines (8773 B) | Pushes movements to Google Sheets webhook (`F-09`), hardcoded fallback UUID (`F-10`) |
| `src/lib/notificationsRepository.ts` | typescript | REVIEWED | 134 lines (3679 B) | `markAllNotificationsAsRead` lacks `.eq('user_id', ...)` filter (`F-16`) |
| `src/lib/parse.ts` | typescript | REVIEWED | 167 lines (5239 B) | Pure numeric/date/Arabic parser; clean |
| `src/lib/passwordSecurity.ts` | typescript | REVIEWED | 80 lines (2889 B) | Safe HIBP k-anonymity range check; clean |
| `src/lib/permissions.ts` | typescript | REVIEWED | 378 lines (18492 B) | `userMustChangePassword()` bypass via `user_metadata.must_change_password === false` (`F-03`) |
| `src/lib/printUtils.ts` | typescript | REVIEWED | 67 lines (2100 B) | Safe `window.print()` wrapper (no HTML template injection/`document.write`); clean |
| `src/lib/procurementAttachments.ts` | typescript | REVIEWED | 150 lines (4957 B) | `image/*` allows `image/svg+xml` XSS & unvalidated `anchor.href` in `downloadAttachment` (`F-05`) |
| `src/lib/procurementRepository.ts` | typescript | REVIEWED | 764 lines (22956 B) | `localStorage` cache (`F-12`), raw DB `error.message` surfaced (`F-16`) |
| `src/lib/protectedAccounts.ts` | typescript | REVIEWED | 175 lines (6059 B) | Hardcoded admin username & legacy Gmail addresses (`F-10`) |
| `src/lib/purgeDemoData.ts` | typescript | REVIEWED | 146 lines (5592 B) | `purgeDatabaseDemoData()` lacks `assertDepartmentWrite`/admin check (`F-08`) |
| `src/lib/pwa.ts` | typescript | REVIEWED | 101 lines (3224 B) | SW registration & install prompt; clean |
| `src/lib/quality.ts` | typescript | REVIEWED | 126 lines (4837 B) | Pure data quality evaluator; clean |
| `src/lib/registrationService.ts` | typescript | REVIEWED | 648 lines (23549 B) | PostgREST `.or()` injection (`F-06`), hardcoded `'507'` email check (`F-10`), `localStorage` PII (`F-12`), false `{ success: true }` local fallbacks (`F-14`) |
| `src/lib/routeMetadata.ts` | typescript | REVIEWED | 187 lines (8258 B) | Static route titles/breadcrumbs; clean |
| `src/lib/searchUtils.ts` | typescript | REVIEWED | 38 lines (1275 B) | Pure text search normalizer; clean |
| `src/lib/settings.ts` | typescript | REVIEWED | 241 lines (8265 B) | Stores unvalidated `logoUrl`/`logoDataUrl` in `localStorage` & `app_settings` (`F-11`, `F-12`) |
| `src/lib/supabase.ts` | typescript | REVIEWED | 87 lines (3404 B) | Supabase client (`sessionStorage` + `accessScopedFetch`); clean |
| `src/lib/suppliersRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 15117 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/suppliersRepository-pablo.ts` | typescript | REVIEWED | 473 lines (14645 B) | Swallows DB errors into `localStorage` fallback (`F-14`), drift vs placeholder (`F-15`) |
| `src/lib/supportTicketsRepository.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 9219 B metadata) | Imported by `backup.ts`; unreadable OneDrive placeholder (`F-15`) |
| `src/lib/supportTicketsRepository-pablo.ts` | typescript | REVIEWED | 309 lines (8911 B) | Unrestricted file upload to public bucket (`F-05`), unguarded status/delete (`F-08`), `localStorage` ticket PII (`F-12`), drift (`F-15`) |
| `src/lib/telegramSettingsRepository.ts` | typescript | REVIEWED | 131 lines (4305 B) | Missing `assertDepartmentWrite`/admin guard on `saveTelegramBotSettings` (`F-08`), hardcoded personal phone/email (`F-10`) |
| `src/lib/theme.ts` | typescript | REVIEWED | 58 lines (1570 B) | Dark/light theme toggle; clean |
| `src/lib/workshopCategoryClassifier.ts` | typescript | REVIEWED | 192 lines (5702 B) | Pure category classifier; clean |
| `src/main.tsx` | typescript | REVIEWED | 22 lines (598 B) | React root mount & SW init; clean |
| `src/pages/AssetHistoryPage.tsx` | typescript | REVIEWED | 520 lines (21987 B) | Mass `purgeDatabaseDemoData()` guarded only by `canModify` + `confirm`, `hidden={!canModify}` DOM hiding, email PII logged in records (`F-12`, `F-13`, `F-14`) |
| `src/pages/AuditLogPage.tsx` | typescript | REVIEWED | 543 lines (27883 B) | SysAdmin-gated (`isSystemAdmin`), hardcoded `'marwan-desouky'` identity check at 456, renders raw diff JSON (`F-06`, `F-14`) |
| `src/pages/AuthPage.tsx` | typescript | REVIEWED | 987 lines (56574 B) | Fail-open `login-bridge` fallback to `signInWithPassword`, client-side `app_users` update, `minLength={6}` vs `10`, URL `error_description` reflected (`F-05`, `F-06`, `F-14`) |
| `src/pages/BudgetPage.tsx` | typescript | REVIEWED | 557 lines (21767 B) | `handleUpdateSpent` lacks `if (!isAdmin) return`, no in-page view RBAC gate, stores `created_by_email` (`F-04`, `F-12`, `F-14`) |
| `src/pages/ChatbotAdminPage.tsx` | typescript | REVIEWED | 723 lines (33793 B) | Stores/loads/reveals Gemini API key in `localStorage`, hardcoded `'marwan-desouky'` reference, raw context JSON dump (`F-06`, `F-07`, `F-14`) |
| `src/pages/ContractsPage.tsx` | typescript | REVIEWED | 921 lines (40231 B) | Base64 `att.dataUrl` rendered in `<img>` and downloaded without runtime MIME/protocol check, no view gate, stores `created_by_email` (`F-09`, `F-12`, `F-14`) |
| `src/pages/CustodyPage.tsx` | typescript | REVIEWED | 3372 lines (139407 B) | Unsanitized Excel disbursement export, `handleRecordOfficialPermit`/`handleImportCustody`/`handleCreateDisbursement` missing in-handler role guards, `hidden={!canEdit}` on settlement button, unvalidated logo URL in print DOM, client-side fixture seeding & multi-warehouse visibility (`F-04`, `F-08`, `F-09`, `F-12`, `F-14`) |
| `src/pages/DisbursementRequestsPage.tsx` | typescript | REVIEWED | 850 lines (34696 B) | `handleApprove`, `handleIssue`, `handleReject` lack in-handler `if (!isAdmin) return` check, no in-page view gate, stores `created_by_email` (`F-04`, `F-12`, `F-14`) |
| `src/pages/FinancialReportsPage.tsx` | typescript | REVIEWED | 624 lines (25739 B) | Uses `safePrint()` properly; lacks in-page view/department RBAC gate, stores `created_by_email` (`F-12`, `F-14`) |
| `src/pages/ImportPage.tsx` | typescript | REVIEWED | 342 lines (18467 B) | `isSystemAdmin` gated; enforces `MAX_IMPORT_FILE_SIZE` & `MAX_IMPORT_ROWS`; delegates CSV error generation (`F-12` minor: relies on parent/session checks) |
| `src/pages/InventoryAnalyticsPage.tsx` | typescript | REVIEWED | 297 lines (12165 B) | Read-only analytics; no in-page RBAC or department scoping (`F-12`) |
| `src/pages/NotFoundPage.tsx` | typescript | REVIEWED | 36 lines (1515 B) | Static 404 fallback; no findings |
| `src/pages/NotificationsPage.tsx` | typescript | REVIEWED | 209 lines (8231 B) | Unvalidated `notif.action_url` passed to `<Link to={...}>`; no in-page role/ownership check (`F-11`, `F-12`) |
| `src/pages/procurement/QuotesPage.tsx` | typescript | REVIEWED | 1235 lines (52240 B) | `sanitizeExcelCell` misses `\t`/`\r`; `hidden={!canAdd}` / `hidden={!isSysAdmin}`; `reqSubmitImmediately` UI option rendered to non-admins (`F-08`, `F-12`) |
| `src/pages/procurement/SuppliersPage.tsx` | typescript | REVIEWED | 772 lines (28820 B) | `handleDeleteSupplier` lacks in-handler `if (!isSysAdmin) return` check; `hidden={!isSysAdmin}` / `hidden={!canAdd}` DOM hiding (`F-04`, `F-12`) |
| `src/pages/PurchasesPage.tsx` | typescript | REVIEWED | 802 lines (31759 B) | `sanitizeExcelCell` misses `\t`/`\r`/leading-whitespace prefixes; no in-page view gate (`F-08`, `F-12`) |
| `src/pages/QualityPage.tsx` | typescript | REVIEWED | 263 lines (10356 B) | Auto-repair button uses `hidden` / relies on role, leaks raw `err.message` in `repairNotice`, no in-page view gate (`F-12`, `F-14`) |
| `src/pages/ReportsPage.tsx` | typescript | REVIEWED | 1169 lines (52670 B) | `exportProcurementInvoicesExcel` & `exportSuppliersStatementExcel` have zero formula sanitization; unvalidated `settings.logoUrl` in print view; no view gate (`F-08`, `F-09`, `F-12`) |
| `src/pages/SettingsPage.tsx` | typescript | REVIEWED | 1805 lines (115497 B) | Accepts `image/svg+xml` logo & falls back to raw `reader.result` data URL on error, unvalidated Google Sheets webhook URL, local JSON full-state restore, raw `err.message` (`F-09`, `F-10`, `F-13`, `F-14`) |
| `src/pages/SupportPage.tsx` | typescript | REVIEWED | 2122 lines (97155 B) | **CRITICAL** Stored XSS via `document.write` in `handlePrintTicket`, hardcoded admin emails for `isSysAdmin`, `handleUpdateStatus` unguarded, `window.open` missing `noopener,noreferrer`, unvalidated `attachment_url`, hardcoded personal contact PII (`F-01`, `F-02`, `F-04`, `F-09`, `F-11`, `F-12`, `F-14`) |
| `src/pages/TelegramBotPage.tsx` | typescript | REVIEWED | 520 lines (24195 B) | Zero RBAC check in component (anyone reaching route can load & call `saveTelegramBotSettings`), unvalidated `bot_username` URL (`F-03`, `F-11`) |
| `src/pages/UsersPage.tsx` | typescript | REVIEWED | 2483 lines (141906 B) | Plaintext passwords passed to local/cloud helpers, `Math.random()` password generator, `minLength` 6, hardcoded `[REDACTED_OWNER_EMAIL_1]` / `marwan-desouky`, `isSystemAdmin` check blocks dept admins despite copy (`F-06`, `F-12`, `F-14`) |
| `src/test/setup.ts` | typescript | REVIEWED | 2 lines (42 B) | Vitest setup; clean |
| `src/vite-env.d.ts` | typescript | REVIEWED | 2 lines (38 B) | Vite client types; clean |
| `supabase/.temp/cli-latest` | config/other | REVIEWED | 1 lines (6 B) | Non-secret text: `v3.1.0` |
| `supabase/.temp/gotrue-version` | config/other | REVIEWED | 1 lines (8 B) | Non-secret text: `v2.197.0` |
| `supabase/.temp/linked-project.json` | json | REVIEWED | 1 lines (140 B) | Project ref `agfvwyycgqhzjbywyzqi`, name `warehouse-ledger`, org `oqlabniwgnznclafkxys` |
| `supabase/.temp/pooler-url` | config/other | REVIEWED | 1 lines (92 B) | Connection host/user only (no password): `postgresql://postgres.agfvwyycgqhzjbywyzqi@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` |
| `supabase/.temp/postgres-version` | config/other | REVIEWED | 1 lines (11 B) | Non-secret text: `17.11.0.003` |
| `supabase/.temp/project-ref` | config/other | REVIEWED | 1 lines (20 B) | Project ref: `agfvwyycgqhzjbywyzqi` |
| `supabase/.temp/rest-version` | config/other | REVIEWED | 1 lines (6 B) | Non-secret text: `v14.18` |
| `supabase/.temp/storage-migration` | config/other | REVIEWED | 1 lines (29 B) | Non-secret text: `lifecycle-writer-coordination` |
| `supabase/.temp/storage-version` | config/other | REVIEWED | 1 lines (7 B) | Non-secret text: `v1.89.9` |
| `supabase/config.toml` | config/other | REVIEWED | 43 lines (1459 B) | `verify_jwt = false` on `admin-users`, `login-bridge`, `telegram-bot`, `verify-email`, `daily-report`, `critical-alerts`; matches `config-pablo.toml` except comments at L36-38 (`F-02`, `F-10`). |
| `supabase/config-pablo.toml` | config/other | REVIEWED | 42 lines (1266 B) | Identical `project_id` and `verify_jwt` flags to `config.toml`; older comments at L34-40 (`F-02`, `F-10`). |
| `supabase/functions/admin-users/index.ts` | typescript | REVIEWED | 2766 lines (122694 B) | Admin management + unauthenticated `send_password_recovery` (`F-01`, `F-02`, `F-03`, `F-07`, `F-08`, `F-11`). |
| `supabase/functions/complete-activation/index.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 18153 B metadata) | OneDrive offline stub (`M` in git status, 18,153 B); unreadable locally on disk. Committed `HEAD` & sibling `index-pablo.ts` reviewed for context (FAIL-open password verify, race condition, `system_admin` role propagation). |
| `supabase/functions/complete-activation/index-pablo.ts` | typescript | REVIEWED | 431 lines (17723 B) | Identical to `HEAD:complete-activation/index.ts`; `verify_jwt = true` + internal `getUser()` (`F-02`, `F-08`, `F-09`). |
| `supabase/functions/critical-alerts/index.ts` | typescript | REVIEWED | 285 lines (10765 B) | `verify_jwt = false`; internal `timingSafeEqual` on service role / `CRON_WEBHOOK_SECRET`; HTML-escapes Telegram output (`F-12`). |
| `supabase/functions/daily-report/index.ts` | typescript | REVIEWED | 326 lines (12399 B) | `verify_jwt = false`; internal `timingSafeEqual` on service role / `CRON_WEBHOOK_SECRET`; HTML-escapes Telegram output (`F-12`). |
| `supabase/functions/deno.d.ts` | typescript | REVIEWED | 47 lines (1273 B) | Ambient Deno/URL module declarations; no security issues. |
| `supabase/functions/invite-user/index.ts` | typescript | REVIEWED | 244 lines (9535 B) | `verify_jwt = true` + `system_admin` check; `reset-password` lacks protected-account guard (`F-07`, `F-10`). |
| `supabase/functions/login-bridge/index.ts` | typescript | REVIEWED | 638 lines (22323 B) | `verify_jwt = false`; parameterized lookups (no PostgREST injection), but IP spoofing, rate-limit gaps, timing leak (`F-06`). |
| `supabase/functions/migrate-users/index.ts` | typescript | REVIEWED | 305 lines (11544 B) | `verify_jwt = true` + `system_admin` check; pagination cap, `system_admin` migration gap (`F-11`). |
| `supabase/functions/telegram-bot/index.ts` | typescript | REVIEWED | 1303 lines (58738 B) | `verify_jwt = false`; fail-closed `timingSafeEqual` on `TELEGRAM_WEBHOOK_SECRET` + update deduplication, but skips email OTP (`F-01`, `F-08`). |
| `supabase/functions/tsconfig.json` | json | REVIEWED | 19 lines (389 B) | Strict TS config (`"strict": true`); no security issues. |
| `supabase/functions/verify-email/index.ts` | typescript | REVIEWED | 156 lines (5915 B) | `verify_jwt = false`; internal service-role `!==` check, unpeppered SHA-256, non-atomic attempts (`F-10`). |
| `supabase/migrations/0001_init.sql` | sql | REVIEWED | 30 lines (898 B) | Extensions in `public` (`pgcrypto`, `pg_trgm`), base tables `organizations`, `profiles`, `organization_members` (no RLS/PK initially; superseded by #2, #32, #33). |
| `supabase/migrations/20261010161551_create_user_movements.sql` | sql | REVIEWED | 60 lines (2153 B) | Enables RLS + revokes on #1 tables; creates `movements` with `owner_id = auth.uid()` RLS (superseded by #6, #13, #32, #33). |
| `supabase/migrations/20261010200500_create_audit_logs_and_invitations.sql` | sql | REVIEWED | 73 lines (2953 B) | Creates `audit_logs` (`WITH CHECK (true)` INSERT) and `user_invitations` (hardcoded email, `role='admin'`). Superseded by #4, #5, #8, #13, #28, #32, #33. |
| `supabase/migrations/20261010204500_harden_admin_security.sql` | sql | REVIEWED | 60 lines (2721 B) | Updates `user_invitations`, `profiles` (`USING(true)`), `organization_members` (`USING(true)`), grants on `profiles`/`organization_members`. Superseded by #13, #28, #33. **F-12** (excessive `profiles` grants). |
| `supabase/migrations/20261011153000_restrict_audit_logs_to_system_admin.sql` | sql | REVIEWED | 15 lines (611 B) | Restricts `audit_logs` SELECT with hardcoded email & `role='admin'`. Superseded by #8, #13, #33. |
| `supabase/migrations/20261011213000_enable_seamless_cloud_sync.sql` | sql | REVIEWED | 94 lines (4063 B) | Drops `movements_owner_id_fkey`, opens `movements`, `custody_items`, `app_settings` to `anon, authenticated` with `USING(true)/WITH CHECK(true)`. Superseded by #13, #32, #33. |
| `supabase/migrations/20261011220000_create_app_users_table.sql` | sql | REVIEWED | 50 lines (1787 B) | Creates `app_users` (plaintext `password` col, `anon` all-access, seeds `marwan-desouky` with `-- redacted` password & `activation_code='1001'`). RLS superseded by #13, #28, #32, #33. |
| `supabase/migrations/20261011221500_fix_audit_logs_permissions.sql` | sql | REVIEWED | 37 lines (1512 B) | Drops `audit_logs` FK, changes `user_id` to `TEXT`, opens `audit_logs` to `anon` (superseded by #13, #32, #33). |
| `supabase/migrations/20261013190000_additive_roles_permissions.sql` | sql | REVIEWED | 9 lines (439 B) | Adds `permissions JSONB DEFAULT '[]'` to `app_users`. Clean. |
| `supabase/migrations/20261013193000_purchases_idempotency.sql` | sql | REVIEWED | 12 lines (570 B) | Adds `custody_applied`, `created_by` to `movements`. Clean. |
| `supabase/migrations/20261013200000_transfers_custody_sources.sql` | sql | REVIEWED | 20 lines (1040 B) | Adds warehouse transfer columns to `movements`. Clean. |
| `supabase/migrations/20261013210000_security_hardening_schema.sql` | sql | REVIEWED | 272 lines (7447 B) | Adds `auth_user_id`/`must_change_password`/`kind`, `movement_kind` (search_path fixed #32), `is_system_admin`, `app_role`, `has_permission` (switched to INVOKER #32), `record_purchase` (fixed #17, INVOKER #33). |
| `supabase/migrations/20261013213000_harden_rls.sql` | sql | REVIEWED | 261 lines (10967 B) | Revokes `anon` on core tables, column-level GRANT on `app_users`, `safe_app_users` view (INVOKER #28), `set_audit_log_actor`, `prevent_audit_log_tamper` (search_path #32), strict role RLS on `custody_items`/`movements` (later weakened in #32/#33!). |
| `supabase/migrations/20261013220000_remove_username_privilege_escalation.sql` | sql | REVIEWED | 43 lines (1289 B) | Enforces `app_metadata` only in `is_system_admin()` and `app_role()` (later INVOKER #32; email backdoors reintroduced in #28, #32, #33, #34, #35). |
| `supabase/migrations/20261014120000_protected_system_admin.sql` | sql | REVIEWED | 141 lines (5859 B) | `is_protected_username()` (search_path #32) & `protect_system_admin_row()` (`SECURITY DEFINER`, revoked #32). **F-13** (`email`/`employee_id`/`activation_code` not protected on UPDATE). |
| `supabase/migrations/20261014120001_login_attempts.sql` | sql | REVIEWED | 22 lines (894 B) | Creates `login_attempts` (RLS enabled, revoked from `anon, authenticated`). Policy added #33. |
| `supabase/migrations/20261014130000_fix_record_purchase_rpc.sql` | sql | REVIEWED | 240 lines (7151 B) | Hardens `record_purchase` (`FOR UPDATE`, `ON CONFLICT`, JWT creator). Later altered to `SECURITY INVOKER` in #33 (**F-08**). |
| `supabase/migrations/20261014140000_procurement_module.sql` | sql | REVIEWED | 839 lines (29920 B) | Procurement tables, `supplier_stats` view (INVOKER #28), `can_access_procurement` (INVOKER #32), 6 RPCs (INVOKER #33). **F-07**, **F-08**. |
| `supabase/migrations/20261014143000_procurement_storage.sql` | sql | REVIEWED | 48 lines (1588 B) | Private bucket `procurement-attachments` (10MB, safe MIME types, procurement RLS). Clean. |
| `supabase/migrations/20261017120000_employee_registration_and_identity.sql` | sql | REVIEWED | 347 lines (12775 B) | `registration_requests`, `generate_employee_code`, `bootstrap_system_admin`, `approve_employee_registration`. Initially open to `PUBLIC`/clients; locked down in #21 and #23. |
| `supabase/migrations/20261017130000_lockdown_privileged_functions_and_bootstrap.sql` | sql | REVIEWED | 238 lines (8732 B) | `system_bootstrap_state` singleton, revokes #20 RPCs to `service_role`, hardens `bootstrap_system_admin`. Clean. |
| `supabase/migrations/20261017140000_telegram_bot_hardening_and_email_verification.sql` | sql | REVIEWED | 171 lines (6269 B) | `telegram_processed_updates`, `telegram_rate_events`, atomic OTP RPCs (`service_role` only, `SET search_path = ''`). Clean. |
| `supabase/migrations/20261017150000_approval_delegation_code_registry_and_rls.sql` | sql | REVIEWED | 501 lines (19546 B) | `registration_approval_settings`, `employee_code_registry` + tamper trigger, hardened `approve_employee_registration`, revokes `registration_requests` writes, `registration_requests_admin_view` (`security_invoker`). Delegation SELECT later regressed in #28 (**F-14**). |
| `supabase/migrations/20261017160000_telegram_user_sessions.sql` | sql | REVIEWED | 27 lines (987 B) | `telegram_user_sessions` locked to `service_role`. Clean. |
| `supabase/migrations/20261018170000_employee_onboarding_invitation_and_activation.sql` | sql | REVIEWED | 564 lines (20498 B) | Onboarding columns/unique indexes, `verify_auth_user_has_password`, `approve_employee_registration` (`pending_activation`), `complete_employee_activation`, `get_identity_consistency_report` (all `service_role`, `search_path=''`). `complete_employee_activation` regressed in #26 (**F-11**). |
| `supabase/migrations/20261022093500_enforce_single_use_activation_and_reset.sql` | sql | REVIEWED | 98 lines (3605 B) | Replaces `complete_employee_activation` (**F-11**: drops username charset/reserved-name checks & audit log, widens `search_path`); grants col SELECT on `app_users` & `registration_approval_settings` SELECT. |
| `supabase/migrations/20261027201500_create_support_tickets_system.sql` | sql | REVIEWED | 110 lines (5920 B) | `support_tickets` + `support-attachments` public bucket. **F-09** (`anon` DML grants, `user_id` spoofing, public bucket + unauthenticated upload), **F-06** (hardcoded emails). |
| `supabase/migrations/20261027204500_fix_supabase_linter_security_and_rls_initplan.sql` | sql | REVIEWED | 184 lines (9230 B) | Sets `security_invoker=true` on views. **F-06** (reintroduces hardcoded emails), **F-07** (`pr_update_policy` removes `draft`/owner check & `WITH CHECK`), **F-14** (`app_users` drops `is_protected_username`, `registration_requests` breaks delegation & re-adds UPDATE policy). |
| `supabase/migrations/20261027214500_create_inspection_and_settlement_tables.sql` | sql | REVIEWED | 89 lines (4516 B) | `technical_inspections` & `inventory_settlements` with `USING(true)/WITH CHECK(true)` for `authenticated` (**F-05**). |
| `supabase/migrations/20261029120000_create_modules_1_to_7.sql` | sql | REVIEWED | 329 lines (11982 B) | Creates 7 module tables (`disbursement_requests`, `notifications`, `inventory_analytics_snapshots`, `supplier_contracts`, `asset_movement_log`, `financial_reports`, `budget_plans`) with open `USING(true)/WITH CHECK(true)` & hardcoded emails (**F-01**, **F-05**, **F-06**, **F-10**). |
| `supabase/migrations/20261029170500_create_telegram_bot_settings.sql` | sql | REVIEWED | 63 lines (3324 B) | `telegram_bot_settings` (`GRANT ... TO anon`, `USING(true)` SELECT exposing `admin_chat_id` & personal phone/email). Writes later restricted #32/#33; **F-15** (`anon` grants & public SELECT remain). |
| `supabase/migrations/20261029180000_resolve_supabase_linter_security_warnings.sql` | sql | REVIEWED | 486 lines (22540 B) | Fixes 7 function search_paths, moves `pg_trgm` to `extensions`, converts helpers to `INVOKER`, revokes RPCs from `anon`. **F-04** (weakens `custody_items`/`movements` RLS to `auth.uid() IS NOT NULL`), **F-05**, **F-06**. |
| `supabase/migrations/20261029190000_resolve_advanced_supabase_linter_issues.sql` | sql | REVIEWED | 662 lines (32778 B) | Drops broad storage SELECT on `support-attachments`; converts 7 RPCs to `INVOKER` (**F-08**); **F-04** (`custody_items`/`movements` open to any `auth.uid() IS NOT NULL`); **F-06** (18+ hardcoded-email policies, drops `app_metadata.system_admin` boolean); **F-10** (any user can delete broadcast notifications); **F-14** (`audit_logs` drops `view_audit` permission). |
| `supabase/migrations/20261029193000_resolve_final_linter_warnings.sql` | sql | REVIEWED | 74 lines (3115 B) | Splits `organizations` admin policies (still uses hardcoded emails **F-06**) and drops duplicate unique constraint on `organization_members`. |
| `supabase/migrations/20261029210000_purge_demo_test_data.sql` | sql | REVIEWED | 145 lines (5075 B) | Purges demo rows, updates module delete policies (**F-06**), creates `purge_demo_test_data()` `SECURITY DEFINER` with no auth check (**F-03**). |
| `supabase/migrations/20261029220000_create_data_quality_repair_rpc.sql` | sql | REVIEWED | 78 lines (2743 B) | Creates `repair_movements_data_quality()` `SECURITY DEFINER` with no auth check granted to `authenticated` (**F-03**). |
| `supabase/migrations/20261029230000_universal_system_backup_and_contract_attachments.sql` | sql | REVIEWED | 160 lines (6971 B) | Adds `Authenticated users can manage contracts` `FOR ALL USING(true) WITH CHECK(true)` (**F-01**); creates `get_system_backup_stats()` `SECURITY DEFINER` granted to `anon, authenticated` with no auth check (**F-02**). |
| `supabase/migrations/20261030010000_normalize_movements_unit_price.sql` | sql | REVIEWED | 10 lines (372 B) | Normalizes `movements.unit_price` commas/whitespace; no security issues. |
| `supabase/migrations/20261030020000_fix_duplicate_employee_ids.sql` | sql | REVIEWED | 131 lines (5500 B) | Hardcoded plaintext password, personal emails, Telegram ID; drops unique index on `telegram_user_id`. **SQL-05** |
| `supabase/migrations/20261101070000_enhance_employee_code_generation_and_remove_pin.sql` | sql | REVIEWED | 200 lines (8897 B) | `generate_employee_code(TEXT)` `SECURITY DEFINER`, `SET search_path = ''`, granted to `service_role` only; clears `activation_code`. |
| `supabase/migrations/20261101103000_resolve_database_linter_security_and_performance.sql` | sql | REVIEWED | 248 lines (10831 B) | Hardcoded personal emails in DELETE RLS; permissive `supplier_contracts` INSERT/UPDATE (`auth.uid() IS NOT NULL`); `get_system_backup_stats()` changed to `SECURITY INVOKER`. **SQL-05, SQL-12** |
| `supabase/migrations/20261101103500_clean_backup_stats_lint.sql` | sql | REVIEWED | 116 lines (5087 B) | Static `EXECUTE` count queries in `get_system_backup_stats()` (`SECURITY INVOKER`, `SET search_path = public`), granted to `authenticated, service_role`. **SQL-12** |
| `supabase/migrations/20261101170000_optimize_custody_print_and_reports.sql` | sql | REVIEWED | 14 lines (616 B) | Two `CREATE INDEX IF NOT EXISTS` on `custody_items`; no security issues. |
| `supabase/migrations/20261102160000_merge_nursing_and_add_new_warehouses.sql` | sql | REVIEWED | 302 lines (9209 B) | `warehouse_merge_audit_log` RLS uses `FOR ALL` and compares `app_users.id = auth.uid()` (TEXT vs UUID mismatch). **SQL-08** |
| `supabase/migrations/20261102200000_engineering_workshops_custody_import.sql` | sql | REVIEWED | 2018 lines (90690 B) | Granted `custody_items` CRUD and `SECURITY DEFINER` `import_custody_batch` (`p_force` delete) to `anon, authenticated` with no auth check (later mitigated in `20261104201756`). **SQL-08** |
| `supabase/migrations/20261102203000_drop_duplicate_movements_created_at_index.sql` | sql | REVIEWED | 15 lines (814 B) | Drops redundant index `movements_created_at_idx1`; no security issues. |
| `supabase/migrations/20261102210000_expand_system_backup_to_all_modules.sql` | sql | REVIEWED | 167 lines (8053 B) | Expands `get_system_backup_stats()` (`SECURITY INVOKER`, static `EXECUTE`) to 20 tables; granted to `authenticated, service_role`. **SQL-12** |
| `supabase/migrations/20261102220000_harden_security_and_privilege_escalation.sql` | sql | REVIEWED | 328 lines (16175 B) | Adds universal role/permissions/status/dept guard in `protect_system_admin_row()`; still has hardcoded personal emails & `custody_items` `GRANT SELECT TO anon` & JWT-only RLS (later replaced). **SQL-05, SQL-08** |
| `supabase/migrations/20261102230000_sync_medicine_nursing_67_items.sql` | sql | REVIEWED | 1170 lines (33887 B) | Deletes/re-seeds `'medicine'`/`'nursing'` `custody_items` data; no RLS/RPC definitions. |
| `supabase/migrations/20261104201756_department_role_matrix.sql` | sql | REVIEWED | 646 lines (34001 B) | Defines `app_effective_role()`, department matrix, `RESTRICTIVE` identity/audit/storage policies, hardens `import_custody_batch`, `record_purchase`, `record_warehouse_issue`, `create_purchase_order`; note `stamp_business_department()` lacks `SECURITY DEFINER` (runs as invoker, ok), `regexp_replace` patching on RPCs, `import_custody_batch` still granted to `authenticated`. **SQL-06, SQL-08** |
| `supabase/migrations/20261104203023_role_authority_freshness.sql` | sql | REVIEWED | 16 lines (697 B) | Hardens `app_effective_role()` to query `app_users` (`status = 'active'`) only, ignoring stale JWTs; revokes `anon` on `app_users`. |
| `supabase/migrations/20261105155500_add_acquisition_date_to_custody_items.sql` | sql | REVIEWED | 14 lines (612 B) | Adds/backfills `acquisition_date` column and index on `custody_items`; no security issues. |
| `supabase/migrations/20261106101500_harden_modules_1_to_7_rls.sql` | sql | REVIEWED | 142 lines (5276 B) | Hardens `disbursement_requests`, `supplier_contracts`, `financial_reports`, `budget_plans`, `asset_movement_log` using `app_effective_role()`; creator update on `disbursement_requests` restricted to `status = 'rejected'`. |
| `supabase/migrations/20261106140500_resolve_supabase_linter_warnings.sql` | sql | REVIEWED | 171 lines (9253 B) | Drops `AND status = 'rejected'` from `disbursement_requests` `role_update` `WITH CHECK` -> self-approval privilege escalation! **SQL-02** |
| `supabase/migrations/20261106144500_harden_security_definer_and_search_paths.sql` | sql | REVIEWED | 90 lines (5414 B) | Pins `protect_user_roles_trigger()`; converts `create_purchase_order(uuid)` to `SECURITY INVOKER` (breaks procurement staff due to `purchase_orders` RLS); widens `app_effective_role()` `search_path` to `public, auth, pg_temp`. **SQL-06, SQL-09** |
| `supabase/migrations/20261107150000_make_audit_and_operations_log_immutable.sql` | sql | REVIEWED | 76 lines (4691 B) | Adds `BEFORE UPDATE OR DELETE` trigger on `audit_logs` and `BEFORE DELETE` triggers on `movements`, `asset_movement_log` (`ERRCODE '55000'`); revokes `DELETE`. |
| `supabase/migrations/20261111160000_security_monitoring_audit_logs.sql` | sql | REVIEWED | 439 lines (20133 B) | Re-introduces stale JWT `app_metadata` OR-checks on `audit_logs`, `audit_logs_archive`, `security_monitor_config`, `audit_alert_deliveries`, `purge_expired_audit_logs()`; `security_monitor_config` readable by all `authenticated`; `audit_logs` client INSERT allows arbitrary `event_type`; adds `app.audit_retention_purge` bypass. **SQL-01, SQL-03, SQL-04** |
| `supabase/migrations/20261111161000_security_triggers_and_detection_rules.sql` | sql | REVIEWED | 563 lines (23757 B) | `record_security_event()` callable by any `authenticated` user allows forging `CRITICAL` alerts & brute-force triggers; `audit_table_change()` swallows `WHEN OTHERS` exceptions and can leak `app.trusted_security_writer`; `sanitize_audit_json()` only masks top-level keys; `v_is_system_admin` checks stale JWT. **SQL-01, SQL-03, SQL-07, SQL-09** |
| `supabase/migrations/20261111162000_security_retention_and_cron_schedules.sql` | sql | REVIEWED | 163 lines (6630 B) | `dispatch_security_webhook()` (`service_role` only) reads Vault `service_role_key` & `security_cron_secret`, calls `net.http_post` with unvalidated `p_function_name`; schedules 3 `pg_cron` jobs. **SQL-09** |
| `supabase/migrations/20261111163000_n8n_security_events_bridge.sql` | sql | REVIEWED | 449 lines (17562 B) | Adds `n8n_webhook_url` to readable `security_monitor_config`; stale JWT OR-check on `security_events`; bridges forged `audit_logs` rows by `event_type`; `notify_n8n_security_event()` allows plaintext `http://`; `SECURITY DEFINER` trigger funcs lack `REVOKE FROM PUBLIC`. **SQL-01, SQL-03, SQL-04, SQL-09** |
| `supabase/pending/20261013213000_harden_rls.sql` | sql | REVIEWED | 261 lines (11227 B) | Duplicate of `migrations/20261013213000_harden_rls.sql` (CRLF vs LF only); exposes `activation_code` column grant, `safe_app_users` lacks `security_invoker`, `prevent_audit_log_tamper()` lacks `search_path`, `ELSE true` on `movements`. **SQL-10** |
| `supabase/pending/20261017153000_enforce_active_status_on_business_tables.sql` | sql | REVIEWED | 31 lines (1372 B) | Unapplied; defines `is_current_user_active()` (`SECURITY DEFINER`, `SET search_path = ''`); policy alteration is commented out. **SQL-10** |
| `supabase/pending/20261018130000_harden_telegram_user_sessions.sql` | sql | REVIEWED | 38 lines (1459 B) | Unapplied; `cleanup_stale_telegram_sessions(INT)` (`service_role` only) and `REVOKE ALL FROM authenticated` on `telegram_user_sessions`. **SQL-10** |
| `supabase/pending/20261018173000_formalize_app_users_status_check_constraint.sql` | sql | REVIEWED | 28 lines (1214 B) | Unapplied; `chk_app_users_status` CHECK constraint is missing from `migrations/`. **SQL-10** |
| `supabase/pending/README.md` | markdown | REVIEWED | 38 lines (2526 B) | Explains staging/approval workflow for `pending/20261013213000_harden_rls.sql` (already in `migrations/`). |
| `supabase/pending/rejected/20261017210000_reset_users_and_pin_admin.sql.REJECTED` | config/other | REVIEWED | 284 lines (8298 B) | Rejected destructive script (mass deletes `auth.users`/`app_users`, directly writes `auth` schema, retains `activation_code='1001'`). |
| `supabase/pending/rejected/README.md` | markdown | REVIEWED | 26 lines (2837 B) | Documents rejection rationale for `20261017210000_reset_users_and_pin_admin.sql.REJECTED`. |
| `supabase/rollbacks/_proposed_rls_hardening.sql` | sql | REVIEWED | 76 lines (3343 B) | Uses broken `u.id = auth.uid()` (TEXT vs UUID mismatch) and omits `DROP POLICY` for permissive policies. **SQL-11** |
| `supabase/rollbacks/20261013213000_harden_rls_rollback.sql` | sql | REVIEWED | 34 lines (2219 B) | **DANGEROUS**: Drops `trg_prevent_audit_log_tamper`, runs `GRANT ALL TO anon, authenticated` on `app_users` (incl. `password`), `audit_logs`, `custody_items`, `movements` with `USING (true)`. **SQL-11** |
| `supabase/rollbacks/20261014140000_procurement_module_rollback.sql` | sql | REVIEWED | 38 lines (1600 B) | Drops procurement tables/RPCs/views; destructive to procurement data if run, no unsafe grants. |
| `supabase/rollbacks/20261014143000_procurement_storage_rollback.sql` | sql | REVIEWED | 13 lines (464 B) | Drops procurement storage policies and bucket; no unsafe grants. |
| `supabase/rollbacks/20261017130000_lockdown_privileged_functions_and_bootstrap.rollback.sql` | sql | REVIEWED | 21 lines (1159 B) | Drops `system_bootstrap_state` & `bootstrap_system_admin`; intentionally does NOT restore `PUBLIC` execute grants. |
| `supabase/rollbacks/20261017140000_telegram_bot_hardening_and_email_verification.rollback.sql` | sql | REVIEWED | 24 lines (1112 B) | Drops rate-limiting/dedup tables, RPCs, and `registration_requests` CHECK constraints (weakens input validation if run). |
| `supabase/rollbacks/20261017150000_approval_delegation_code_registry_and_rls.rollback.sql` | sql | REVIEWED | 22 lines (968 B) | Drops `employee_code_registry`, `registration_approval_settings`, `approve_employee_registration` RPC, and admin view. |
| `supabase/rollbacks/20261017153000_enforce_active_status_on_business_tables.rollback.sql` | sql | REVIEWED | 7 lines (285 B) | Drops `is_current_user_active()`. |
| `supabase/rollbacks/20261017160000_telegram_user_sessions.rollback.sql` | sql | REVIEWED | 5 lines (222 B) | Drops `telegram_user_sessions` policy and table. |
| `supabase/rollbacks/20261018130000_harden_telegram_user_sessions.rollback.sql` | sql | REVIEWED | 4 lines (136 B) | Drops `cleanup_stale_telegram_sessions(INT)`. |
| `supabase/rollbacks/20261018170000_employee_onboarding_invitation_and_activation.rollback.sql` | sql | REVIEWED | 45 lines (1512 B) | Drops activation RPCs/unique indexes; recreates `registration_requests_admin_view` (`security_invoker = true`) granted to `authenticated`. |
| `supabase/rollbacks/20261018173000_formalize_app_users_status_check_constraint.rollback.sql` | sql | REVIEWED | 8 lines (272 B) | Drops `chk_app_users_status` constraint. |
| `supabase/rollbacks/20261101170000_optimize_custody_print_and_reports.rollback.sql` | sql | REVIEWED | 7 lines (276 B) | Drops 2 `custody_items` indexes. |
| `supabase/rollbacks/20261102160000_merge_nursing_and_add_new_warehouses.rollback.sql` | sql | REVIEWED | 95 lines (2903 B) | Reverts merge rows and executes `DELETE FROM public.warehouse_merge_audit_log;` (wipes audit trail). **SQL-11** |
| `supabase/rollbacks/20261102200000_engineering_workshops_custody_import.rollback.sql` | sql | REVIEWED | 11 lines (485 B) | Deletes imported workshop items and drops `import_custody_batch` + indexes. |
| `supabase/rollbacks/20261102203000_drop_duplicate_movements_created_at_index.rollback.sql` | sql | REVIEWED | 9 lines (393 B) | Recreates duplicate index `movements_created_at_idx1`. |
| `supabase/rollbacks/20261102220000_harden_security_and_privilege_escalation.rollback.sql` | sql | REVIEWED | 93 lines (3997 B) | **DANGEROUS**: Reverts `disbursement_requests`, `budget_plans`, `financial_reports` to `USING (true) WITH CHECK (true)`, and `movements`/`custody_items`/`supplier_contracts` to `auth.uid() IS NOT NULL`. **SQL-11** |
| `supabase/rollbacks/20261102230000_sync_medicine_nursing_67_items.rollback.sql` | sql | REVIEWED | 5 lines (214 B) | Deletes `cust-med-verified-%` rows from `custody_items`. |
| `supabase/seed/seed_demo.sql` | sql | REVIEWED | 5 lines (162 B) | Placeholder `SELECT 1;` only; no secrets or vulnerabilities. |
| `supabase/tests/dashboard_rpc.sql` | sql | REVIEWED | 3 lines (53 B) | Placeholder (`SELECT 1;`). **SQL-12** |
| `supabase/tests/derive_equivalence.sql` | sql | REVIEWED | 3 lines (93 B) | Placeholder (`SELECT 1;`). **SQL-12** |
| `supabase/tests/procurement_rls_and_rpc.sql` | sql | REVIEWED | 117 lines (3643 B) | pgTAP suite; asserts legacy `movements` count=33 and pre-`20261104201756` RPC permissions. **SQL-12** |
| `supabase/tests/rls.sql` | sql | REVIEWED | 5 lines (166 B) | Placeholder (`SELECT 1;`). **SQL-12** |
| `supabase/tests/rls_protected_admin_and_passwords.sql` | sql | REVIEWED | 102 lines (4711 B) | pgTAP suite; invalid top-level `INTO v_test_log_id` at line 78 and expects `P0001` instead of `55000` on `audit_logs`. **SQL-12** |
| `supabase/tests/rls_security_matrix.sql` | sql | REVIEWED | 97 lines (3014 B) | pgTAP suite; tests `app_role()`/`is_system_admin()` (stale JWT functions) instead of `app_effective_role()`, expects `P0001` instead of `55000`. **SQL-12** |
| `system_admin_screenshots/01_dashboard.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (354047 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/02_purchases.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (325715 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/03_suppliers.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (322775 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/04_quotes_requests.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (282606 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/05_contracts.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (311011 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/06_custody.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (356601 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/07_asset_history.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (295051 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/08_reports.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (327299 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/09_imports.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (272356 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/10_quality.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (342199 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/11_disbursement_requests.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (295816 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/12_inventory_analytics.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (324641 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/13_financial_reports.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (291824 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/14_budget.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (295040 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/15_audit_log.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (264833 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/16_users_permissions.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (301393 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/17_telegram_bot.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (326228 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/18_chatbot_admin.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (313037 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/19_settings.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (276988 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/20_notifications.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (237253 B) | Static UI screenshot PNG of system admin views. |
| `system_admin_screenshots/21_support.png` | asset | METADATA_ONLY | Binary/minified asset metadata only (284276 B) | Static UI screenshot PNG of system admin views. |
| `tests/fixtures/role-schema.json` | json | REVIEWED | 2467 lines (66850 B) | PGlite schema/RPC snapshot used by `departmentRoles.mjs`; no secrets. |
| `tests/integration/departmentRoles.mjs` | javascript | REVIEWED | 120 lines (10356 B) | PGlite integration tests across 10 roles (160 checks); solid DB/RLS verification. |
| `tests/security_verification.test.ts` | typescript | REVIEWED | 261 lines (10264 B) | **FINDING**: Hardcodes live `SUPABASE_URL` & publishable `ANON_KEY`, hits production Supabase over network during `vitest run`, targets `[REDACTED_OWNER_EMAIL_1]`. [F-08, F-10] |
| `tests/unit/arabicNormalization.test.ts` | typescript | REVIEWED | 49 lines (1945 B) | Clean unit tests. |
| `tests/unit/auditAuth.test.ts` | typescript | REVIEWED | 140 lines (4862 B) | System admin access unit tests (`app_metadata` vs `user_metadata`). |
| `tests/unit/authSessionUtils.test.ts` | typescript | REVIEWED | 87 lines (2739 B) | URL token extraction tests with mock tokens. |
| `tests/unit/backup.test.ts` | typescript | REVIEWED | 444 lines (18465 B) | email === 'marwan-desouky'`. [F-13] |
| `tests/unit/custody.test.ts` | typescript | REVIEWED | 306 lines (11018 B) | Custody warehouse & movement sync tests. |
| `tests/unit/custodyImport.test.ts` | typescript | REVIEWED | 264 lines (10206 B) | Custody Excel import tests. |
| `tests/unit/dateUtils.test.ts` | typescript | REVIEWED | 22 lines (819 B) | Date formatting tests. |
| `tests/unit/departmentIsolation.test.ts` | typescript | REVIEWED | 60 lines (2857 B) | Department RBAC tests. |
| `tests/unit/departmentIsolation.test-pablo.ts` | typescript | REVIEWED | 60 lines (2798 B) | Duplicate `-pablo` test file matching `departmentIsolation.test.ts`. [F-07] |
| `tests/unit/derive.test.ts` | typescript | REVIEWED | 30 lines (1294 B) | Calculation tests. |
| `tests/unit/disbursement.test.ts` | typescript | REVIEWED | 244 lines (8566 B) | Transfer/disbursement tests. |
| `tests/unit/edgeFunctions.test.ts` | typescript | REVIEWED | 296 lines (12522 B) | Edge function static/simulation tests (test 10 title duplicated; helper simulation for tests 1-6). [F-13] |
| `tests/unit/edgeRoleBoundary.test.ts` | typescript | REVIEWED | 66 lines (3451 B) | Executes transpiled `admin-users` & `complete-activation` Edge handlers with mocked Supabase client. |
| `tests/unit/employeeIdentity.test.ts` | typescript | REVIEWED | 89 lines (4430 B) | Employee ID & OTP tests. |
| `tests/unit/employeeOnboarding.test.ts` | typescript | REVIEWED | 320 lines (17497 B) | Onboarding validation & static source checks. |
| `tests/unit/endToEndIntegration.test.ts` | typescript | REVIEWED | 369 lines (16353 B) | Pure in-memory mock simulation of Telegram registration flow. [F-13] |
| `tests/unit/enterpriseAuth.test.ts` | typescript | REVIEWED | 150 lines (5226 B) | Lines 36-103 test legacy `saveUserToCloud` preserving plaintext/legacy `password` column on `app_users`. [F-13] |
| `tests/unit/googleSheetsRealtimeSync.test.ts` | typescript | REVIEWED | 109 lines (4051 B) | Tests Google Sheets webhook sync (`mode: 'no-cors'`, stores webhook URL in `localStorage`). |
| `tests/unit/importRows.test.ts` | typescript | REVIEWED | 44 lines (1756 B) | Excel row mapping tests. |
| `tests/unit/localUsers.test.ts` | typescript | REVIEWED | 190 lines (6239 B) | Local user storage & legacy auth disabling tests. |
| `tests/unit/loginBridge.test.ts` | typescript | REVIEWED | 174 lines (7433 B) | Login bridge logic simulation + static checks. [F-13] |
| `tests/unit/movementsRepository.test.ts` | typescript | REVIEWED | 38 lines (1194 B) | Offline update/delete fallback tests. |
| `tests/unit/noHardcodedPasswords.test.ts` | typescript | REVIEWED | 106 lines (3640 B) | Line 69 reconstructs previously exposed admin password via character array join; only scans `supabase/functions` (misses `tests/`, `scripts/`, `src/`, `scratch/`). [F-08b, F-13] |
| `tests/unit/notFoundPage.test.tsx` | typescript | REVIEWED | 19 lines (644 B) | 404 component test. |
| `tests/unit/parse.test.ts` | typescript | REVIEWED | 25 lines (984 B) | Parsing tests. |
| `tests/unit/passwordRecoveryFlow.test.ts` | typescript | REVIEWED | 74 lines (2711 B) | Password recovery mock tests. |
| `tests/unit/permissions.test.ts` | typescript | REVIEWED | 464 lines (21068 B) | Permissions matrix & metadata forgery tests. |
| `tests/unit/phase2_inventory_integrity.test.ts` | typescript | REVIEWED | 258 lines (9431 B) | Inventory conservation tests. |
| `tests/unit/phase3_workflows.test.ts` | typescript | REVIEWED | 203 lines (7245 B) | **HIGH FINDING**: Lines 31-37 assert `userMustChangePassword(user)` returns `false` when mutable `user_metadata.must_change_password: false` overrides `app_metadata.must_change_password: true`. [F-09] |
| `tests/unit/phase4_accessibility.test.tsx` | typescript | REVIEWED | 333 lines (10933 B) | Dialog/ARIA accessibility tests. |
| `tests/unit/phase5_delivery.test.tsx` | typescript | REVIEWED | 183 lines (7096 B) | Currency, print, chunked import, error boundary tests. |
| `tests/unit/procurementAttachments.test.ts` | typescript | REVIEWED | 61 lines (2309 B) | Attachment validation tests. |
| `tests/unit/procurementKpis.test.ts` | typescript | REVIEWED | 78 lines (5475 B) | KPI calculation tests. |
| `tests/unit/procurementPermissions.test.ts` | typescript | REVIEWED | 78 lines (2727 B) | Procurement route access tests. |
| `tests/unit/procurementStateMachine.test.ts` | typescript | BLOCKED | 0 lines (OneDrive offline stub / unreadable locally; 4509 B metadata) | OneDrive offline stub (`M` in git status, 4,515 B); unreadable locally on disk. Committed `HEAD` (130 lines) & sibling `-pablo.ts` reviewed for context. |
| `tests/unit/procurementStateMachine.test-pablo.ts` | typescript | REVIEWED | 130 lines (4380 B) | Duplicate `-pablo` test file matching `procurementStateMachine.test.ts`. [F-07] |
| `tests/unit/protectedAccounts.test.ts` | typescript | REVIEWED | 158 lines (5842 B) | Protected admin username/homoglyph tests; references `marwan-desouky` & `[REDACTED_OWNER_EMAIL_1]`. [F-10] |
| `tests/unit/purchases.test.ts` | typescript | REVIEWED | 110 lines (5001 B) | Purchase filter & idempotency tests. |
| `tests/unit/quality.test.ts` | typescript | REVIEWED | 21 lines (854 B) | Data quality summary tests. |
| `tests/unit/quotesAndOrders.test.ts` | typescript | REVIEWED | 122 lines (3757 B) | Quotes & PO RPC tests. |
| `tests/unit/quotesAndOrders.test-pablo.ts` | typescript | REVIEWED | 122 lines (3636 B) | Duplicate `-pablo` test file matching `quotesAndOrders.test.ts`. [F-07] |
| `tests/unit/recordPurchaseRpc.test.ts` | typescript | REVIEWED | 158 lines (5550 B) | `record_purchase` RPC & custody overwrite tests. |
| `tests/unit/registrationWorkflow.test.ts` | typescript | REVIEWED | 81 lines (3300 B) | Registration input/OTP tests. |
| `tests/unit/roleMatrix.test.ts` | typescript | REVIEWED | 81 lines (4440 B) | Role matrix + stale in-flight response isolation tests. |
| `tests/unit/searchUtils.test.ts` | typescript | REVIEWED | 44 lines (2065 B) | Arabic search normalization tests. |
| `tests/unit/securityMonitorSystem.test.ts` | typescript | REVIEWED | 1037 lines (43495 B) | PGlite + real Edge handler tests (`login-bridge`, `daily-report`, `critical-alerts`) + n8n workflow validation; lines 972-975 hardcode internal n8n credential ID (`vflFy7UeAsh7U6YR`) and Telegram `chatId` (`[REDACTED_TG_CHAT_ID]`). [F-08c] |
| `tests/unit/sessionASecurity.test.ts` | typescript | REVIEWED | 314 lines (12610 B) | Tests webhook auth & bootstrap simulations + migration string checks; references `[REDACTED_OWNER_EMAIL_1]` & `SYS-ADM-000001`. [F-10, F-13] |
| `tests/unit/sessionBSecurity.test.ts` | typescript | REVIEWED | 244 lines (10089 B) | Tests inline OTP/webhook helper simulations rather than real Edge handlers. [F-13] |
| `tests/unit/sessionCSecurity.test.ts` | typescript | REVIEWED | 293 lines (12309 B) | Tests inline login-bridge/delegation helper simulations; references `[REDACTED_OWNER_EMAIL_1]` & `SYS-ADM-000001`. [F-10, F-13] |
| `tests/unit/settings.test.ts` | typescript | REVIEWED | 158 lines (6280 B) | Settings & logo persistence tests. |
| `tests/unit/snapshot.test.ts` | typescript | REVIEWED | 90 lines (3764 B) | Fixture snapshot tests; line 31 title says `(463)` rows while asserting `EXPECTED_SNAPSHOT.totalRows = 33`. [F-13] |
| `tests/unit/suppliers.test.ts` | typescript | REVIEWED | 180 lines (5506 B) | Suppliers management tests. |
| `tests/unit/suppliers.test-pablo.ts` | typescript | REVIEWED | 180 lines (5327 B) | Duplicate `-pablo` test file matching `suppliers.test.ts`. [F-07] |
| `tests/unit/systemAdminBootstrap.test.ts` | typescript | REVIEWED | 77 lines (2942 B) | Bootstrap simulation tests; references `[REDACTED_OWNER_EMAIL_1]` & `SYS-ADM-000001`. [F-10, F-13] |
| `tests/unit/telegramWizardSecurity.test.ts` | typescript | REVIEWED | 61 lines (3121 B) | Static regex assertions against `telegram-bot/index.ts` and `telegram_user_sessions` migration. |
| `tests/unit/theme.test.ts` | typescript | REVIEWED | 28 lines (990 B) | Theme toggle tests. |
| `tests/unit/uniqueIdLogin.test.ts` | typescript | REVIEWED | 70 lines (3039 B) | Employee ID / login gating tests; references `[REDACTED_OWNER_EMAIL_1]` & `SYS-ADM-000001`. [F-10] |
| `tests/unit/warehouseChatBot.test.tsx` | typescript | REVIEWED | 69 lines (2872 B) | Chatbot component session-change unmount tests. |
| `tsconfig.app.json` | json | REVIEWED | 34 lines (750 B) | App TS config (`noEmit: true`); includes `src`, `tests`, `fixtures`. |
| `tsconfig.json` | json | REVIEWED | 8 lines (119 B) | Project references; clean. |
| `tsconfig.node.json` | json | REVIEWED | 24 lines (558 B) | Node TS config (`vite.config.ts`). |
| `vercel.json` | json | REVIEWED | 55 lines (1613 B) | Security headers present (`nosniff`, `DENY`, `HSTS`, `Referrer-Policy`, `Permissions-Policy`, `/sw.js` `no-cache`), but missing `CSP` and `COOP`/`CORP`; uses `npm install` instead of `npm ci`. [F-05, F-06] |
| `vite.config.ts` | typescript | REVIEWED | 22 lines (448 B) | `build.sourcemap: false`, Vitest jsdom config; `server.host: true` binds dev server on `0.0.0.0`. [F-06] |
| `.git/**` (2,636 files) | vcs-internals | METADATA_ONLY | Repository refs, hooks & `git status`/`HEAD` inspected | Historical commits previously contained exposed secrets (per project docs); pack/object files accounted for as VCS internals. |
| `node_modules/**` (27,045 files) | third-party-deps | METADATA_ONLY | Manifest & lockfile resolution via `package-lock.json` (v3) | Resolved dependency tree (`zod@4.6.7`, `undici@8.12.4` dev, `xlsx@0.20.3`, `@supabase/supabase-js@2.117.3`, `@google/genai@2.32.0`, `vite@8.3.4`). |

---

## 8. Limitations and Continuation

1. **OneDrive Offline Cloud-Only Placeholders (`515` files `BLOCKED`):**
   - Because Windows OneDrive cloud-file hydration is inactive in this environment (`The cloud file provider is not running`), `515` files carrying `Offline | RecallOnDataAccess` attributes (`dist/`: `131`, `reports/screenshots/responsive/`: `221`, `scratch/`: `152`, `src/`: `8` — `src/App-DESKTOP-O2AF58P.tsx` plus `7` modified `*Repository.ts` files, `data/نموذج_استيراد_الورش_الهندسية.xlsx`: `1`, `supabase/functions/complete-activation/index.ts`: `1`, `tests/unit/procurementStateMachine.test.ts`: `1`) returned OS read errors on disk and are strictly recorded as `BLOCKED`.
   - For the `9` modified tracked code/test files among those (`7` `src/lib/*Repository.ts`, `supabase/functions/complete-activation/index.ts`, `tests/unit/procurementStateMachine.test.ts`), committed `HEAD` snapshots and untracked `*-pablo.ts` siblings were inspected for context, but the modified working-tree contents remain `BLOCKED` until hydrated locally.
2. **Offline / Read-Only Constraints:**
   - No commands were run against deployed Supabase (`agfvwyycgqhzjbywyzqi`), Vercel, n8n, Telegram, or Gemini endpoints, and no online vulnerability database (`npm audit`) or dynamic application tests were executed during this read-only review.
   - Resolved npm dependency versions (`package-lock.json` v3) were verified statically (`zod@4.6.7` prod, `undici@8.12.4` dev, `@supabase/supabase-js@2.117.3` prod, `xlsx@0.20.3` prod CDN tarball, `@google/genai@2.32.0` dev, `vite@8.3.4` dev).
3. **Resumption / Checkpoint Status:**
   - Complete exhaustive audit finished (`30,591` files accounted for: `349` `REVIEWED`, `46` `METADATA_ONLY`, `515` `BLOCKED`, `2,636` `.git/**`, `27,045` `node_modules/**`).
   - Next step after user approval: hydrate the `515` OneDrive files on an active OneDrive host, inspect any diffs in the `9` modified `src/`/`supabase/`/`tests/` files, and execute prioritized fixes (`P0` -> `P3`) upon explicit authorization.
