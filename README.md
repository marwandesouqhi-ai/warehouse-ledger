# Warehouse Ledger

This repository is a Vite + React + TypeScript foundation for an Arabic RTL stock ledger named "حركة المخزن". It includes the core parsing, derivation, and quality logic for the original Appendix A dataset and a dashboard shell that reflects the requested warehouse dashboard design.

## Included in this workspace

- React 19 + TypeScript + Vite application shell
- Arabic RTL routing and dashboard scaffold
- Shared ledger utilities: parsing, derived balance/status logic, and quality checks
- Fixture dataset loaded from the original Appendix A data
- Unit tests proving the core calculations for totals and summary status
- Deployment and decision documentation for the full Supabase-based product roadmap

## Commands

- `npm install`
- `npm run dev`
- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Important note

The full Supabase/Postgres/Edge Function stack in the original requirement is scaffolded in the repo structure, but it cannot be executed against a live remote project in this environment because no Supabase project credentials or deployment secrets are configured here.

## Optional demo initialization

Production and new browser stores start empty. For an isolated demo installation only,
set `VITE_DEMO_MODE=true` before starting/building Vite. Fixtures initialize a missing
movement/custody store once, with a durable `<storage-key>:demo-initialized:v1` marker.
Existing stores (including empty arrays) are preserved; removing records does not
reinitialize a previously seeded store. Leave this flag unset for production.
