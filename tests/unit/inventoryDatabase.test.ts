// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { planInventoryOperation } from '../../src/lib/inventoryOperations'
import type { InventoryPlan, InventorySnapshot } from '../../src/lib/inventoryTypes'
import type { CustodyItem } from '../../src/lib/custody'
vi.mock('../../src/lib/supabase', () => ({ supabase: null }))

let db: PGlite
const actor = '10000000-0000-4000-8000-000000000001'
const movementId = '20000000-0000-4000-8000-000000000001'
const stock = { id: 'source', warehouseId: 'main', code: 'A', name: 'حاسوب', category: '', quantity: 10, value: 100, unit: 'قطعة', unitPrice: 10, condition: 'good', custodian: '', roomLocation: '', notes: '', custodyType: 'مستديمة', acquisitionDate: '2020-01-02', version: 1, history: [] }
const migration = readFileSync('supabase/migrations/20261103173855_frontend_inventory_integrity.sql', 'utf8').replace(/^\uFEFF/, '')
const receipt = () => ({ id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'purchase', title: 'توريد', description: 'توريد موثق', effects: [{ itemId: 'source', quantity: 2, value: 20 }] })
function purchaseRequest() {
  const event = receipt()
  return { id: event.id, kind: 'purchase', items: [{ expectedVersion: 1, after: { ...stock, quantity: 12, value: 120, version: 2, history: [event] } }], movements: [{ expectedVersion: null, after: { id: movementId, date: '2026-11-03', item: 'حاسوب', inv: 'I', price: 10, qin: 2, qout: 0, sourceWarehouseId: 'main', inventoryEffects: event.effects, requestFingerprint: 'request-1' } }], event }
}
async function apply(request: { id: string; kind: string; items: unknown[]; movements: unknown[]; event: unknown }) {
  return db.query<{ result: { success: boolean } }>('select public.apply_inventory_operation($1::uuid,$2,$3::jsonb,$4::jsonb,$5::jsonb) as result', [request.id, request.kind, JSON.stringify(request.items), JSON.stringify(request.movements), JSON.stringify(request.event)])
}
async function claims(role: string) {
  await db.query<Record<string, unknown>>("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor, app_metadata: { role } })])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values ('${actor}');
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function public.app_role() returns text language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'role','viewer') $$;
    create function public.is_system_admin() returns boolean language sql stable as $$ select public.app_role()='system_admin' $$;
    create function public.has_permission(p text) returns boolean language sql stable as $$ select false $$;`)
  const custodySql = readFileSync('supabase/migrations/20261011213000_enable_seamless_cloud_sync.sql', 'utf8')
  await db.exec(custodySql.slice(custodySql.indexOf('CREATE TABLE IF NOT EXISTS public.custody_items'), custodySql.indexOf('CREATE INDEX IF NOT EXISTS custody_items_warehouse_idx')))
  const movementSql = readFileSync('supabase/migrations/20261010161551_create_user_movements.sql', 'utf8')
  await db.exec(movementSql.slice(movementSql.indexOf('CREATE TABLE IF NOT EXISTS public.movements'), movementSql.indexOf('CREATE INDEX IF NOT EXISTS movements_owner_created_idx')))
  await db.exec(`alter table public.movements add column kind text, add column custody_applied boolean, add column created_by text;
    grant usage on schema public,auth to authenticated;
    grant select,insert,update on public.custody_items,public.movements to authenticated;
    alter table public.custody_items enable row level security;
    alter table public.movements enable row level security;
    create policy test_custody on public.custody_items for all to authenticated using (true) with check (true);
    create policy test_movements on public.movements for all to authenticated using (true) with check (owner_id=auth.uid());`)
  await db.exec(readFileSync('supabase/migrations/20261013200000_transfers_custody_sources.sql', 'utf8'))
  await db.exec("insert into public.custody_items(id,warehouse_id,name,quantity,value) values ('legacy','main','قديم',5,123)")
  await db.exec(migration)
  const legacy = await db.query<Record<string, unknown>>('select quantity,value,acquisition_date,version from public.custody_items where id=\'legacy\'')
  expect(legacy.rows[0]).toMatchObject({ quantity: '5', value: '123', acquisition_date: null, version: 0 })
}, 30000)

beforeEach(async () => {
  await db.exec('reset role; truncate public.inventory_operations,public.movements,public.custody_items;')
  await db.query<Record<string, unknown>>('insert into public.custody_items(id,warehouse_id,name,quantity,value,acquisition_date) values ($1,$2,$3,$4,$5,$6)', [stock.id, stock.warehouseId, stock.name, stock.quantity, stock.value, stock.acquisitionDate])
  await claims('purchasing_staff')
  await db.exec('set role authenticated')
})
afterAll(async () => { await db?.close() })

describe('Phase 2 real Postgres transaction contract', () => {
  it('commits the ledger and stock once and replays the same operation idempotently', async () => {
    const request = purchaseRequest()
    expect((await apply(request)).rows[0].result.success).toBe(true)
    await apply(request)
    const result = await db.query<Record<string, unknown>>('select quantity,value,version,acquisition_date::text from public.custody_items where id=\'source\'')
    expect(result.rows[0]).toMatchObject({ quantity: '12', value: '120', version: 2 })
    expect(String(result.rows[0].acquisition_date)).toContain('2020-01-02')
    expect((await db.query<Record<string, unknown>>('select count(*)::int as count from public.movements')).rows[0].count).toBe(1)
  })
  it('rejects a stale version and rolls back the entire statement', async () => {
    await db.exec("reset role; update public.custody_items set quantity=11,value=110 where id='source'; set role authenticated")
    await expect(apply(purchaseRequest())).rejects.toThrow(/version conflict/)
    expect((await db.query<Record<string, unknown>>('select count(*)::int as count from public.movements')).rows[0].count).toBe(0)
    expect((await db.query<Record<string, unknown>>("select quantity from public.custody_items where id='source'")).rows[0].quantity).toBe('11')
  })
  it('rolls back an inventory update if ledger insertion fails later', async () => {
    const request = purchaseRequest()
    request.movements[0].after.item = ''
    await expect(apply(request)).rejects.toThrow()
    expect((await db.query<Record<string, unknown>>("select quantity from public.custody_items where id='source'")).rows[0].quantity).toBe('10')
    expect((await db.query<Record<string, unknown>>('select count(*)::int as count from public.inventory_operations')).rows[0].count).toBe(0)
  })
  it('rejects an operation ID reused with a different payload', async () => {
    const request = purchaseRequest()
    await apply(request)
    request.items[0].after.quantity = 13
    await expect(apply(request)).rejects.toThrow(/reused/)
  })
  it('rejects unauthorized roles and invalid value conservation', async () => {
    await claims('viewer')
    await expect(apply(purchaseRequest())).rejects.toThrow(/permission required/)
    await claims('purchasing_staff')
    const request = purchaseRequest()
    request.items[0].after.value = 999
    await expect(apply(request)).rejects.toThrow(/do not match/)
    expect((await db.query<Record<string, unknown>>("select value from public.custody_items where id='source'")).rows[0].value).toBe('100')
  })
  it('conserves value on transfer and atomically reconciles its edit and soft cancellation', async () => {
    const state: InventorySnapshot = { schemaVersion: 2, revision: 0, appliedOperations: [], items: [stock as CustodyItem], movements: [] }
    const run = (plan: InventoryPlan) => apply({ id: plan.id, kind: plan.kind, items: plan.itemChanges, movements: plan.movementChanges, event: plan.event })
    await claims('warehouse_staff')
    const transfer = planInventoryOperation(state, { kind: 'transfer', sourceItemId: stock.id, targetWarehouseId: 'fci', quantity: 2 })
    await run(transfer)
    expect((await db.query<{quantity:string;value:string}>('select sum(quantity)::text as quantity,sum(value)::text as value from public.custody_items')).rows[0]).toEqual({ quantity: '10', value: '100' })
    await claims('system_admin')
    const movement = transfer.next.movements[0]
    const edit = planInventoryOperation(transfer.next, { kind: 'edit', movementId: movement.id, movement: { ...movement, qout: 3 } })
    await run(edit)
    expect((await db.query<{kind:string}>('select kind from public.movements')).rows[0].kind).toBe('transfer')
    expect((await db.query<{quantity:string}>("select quantity from public.custody_items where id='source'")).rows[0].quantity).toBe('7')
    const cancel = planInventoryOperation(edit.next, { kind: 'delete', movementId: movement.id })
    await run(cancel)
    expect((await db.query<{quantity:string}>("select quantity from public.custody_items where id='source'")).rows[0].quantity).toBe('10')
    expect((await db.query<{count:number}>('select count(*)::int as count from public.movements where deleted_at is not null')).rows[0].count).toBe(1)
  })
  it('preserves legacy acquisition dates as unknown instead of deriving them from created_at', async () => {
    expect(migration).not.toMatch(/update\s+public\.custody_items\s+set\s+acquisition_date/i)
    expect(migration).not.toMatch(/delete\s+from|truncate\s+/i)
  })
})
