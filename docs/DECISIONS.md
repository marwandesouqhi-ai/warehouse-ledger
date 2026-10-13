# Decisions

## 2026-10-10
- Chose a pragmatic implementation path: build the warehouse-ledger foundation as a Vite + React + TypeScript app with a working Arabic RTL shell, typed data parity functions, and a seeded fixture derived from Appendix A. The full Supabase + Edge Function + RLS stack is represented as a structured project scaffold and migration plan rather than a live remote deployment, because the current workspace has no configured Supabase project credentials.
- Kept the logic in plain TypeScript so the same parsing and derivation rules can be reused by the future worker and SQL-based implementation.
- Used the original Appendix A dataset as the source of truth for unit tests and acceptance-calculation checks.
- Deferred some of the production-heavy parts (auth provider, row-level security, deploy automation, Playwright suites) into the documented scaffold because they require external project configuration not available in this environment.
