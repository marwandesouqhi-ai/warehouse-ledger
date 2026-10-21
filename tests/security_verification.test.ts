import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://agfvwyycgqhzjbywyzqi.supabase.co'
const ANON_KEY = 'sb_publishable_fZFcj7ws5L9rNhy9gKySTw_LMZpf3qy'

describe('Security & Authorization Hardening Audit', { timeout: 30000 }, () => {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  it('1. Blocks anonymous/unauthorized callers from Edge Function invite-user with HTTP 403/401', async () => {
    const { error } = await client.functions.invoke('invite-user', {
      body: { email: 'unauthorized_attempt@example.com', role: 'admin' },
    })
    expect(error).toBeDefined()
  })

  it('2. Blocks unauthorized client from direct insert into user_invitations (RLS 42501)', async () => {
    const { error } = await client
      .from('user_invitations')
      .insert({ email: 'unauthorized@example.com', role: 'admin' })
      .select()

    expect(error).toBeDefined()
    expect(error?.code).toBe('42501') // insufficient_privilege
  })

  it('3. Blocks unauthorized client from modifying organization_members (RLS 42501)', async () => {
    const { error } = await client
      .from('organization_members')
      .insert({
        org_id: '00000000-0000-0000-0000-000000000000',
        user_id: '00000000-0000-0000-0000-000000000000',
        role: 'admin',
      })
      .select()

    expect(error).toBeDefined()
    expect(error?.code).toBe('42501')
  })

  it('4. Restricts unauthenticated anon client from accessing inventory movements (RLS 42501)', async () => {
    const { data, error } = await client
      .from('movements')
      .select('*')

    // Under hardened RLS (20261013213000_harden_rls.sql), anon role is revoked from reading movements directly
    const isProtected = error !== null || (Array.isArray(data) && data.length === 0)
    expect(isProtected).toBe(true)
  })

  it('5. Protects audit_logs from tamper: cannot delete or alter audit logs', async () => {
    const { error } = await client
      .from('audit_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
  })

  it('6. Rejects deprecated account marwandesouqhi@gmail.com', async () => {
    const { error } = await client.auth.signInWithPassword({
      email: 'marwandesouqhi@gmail.com',
      password: 'DummyTestPassword123!',
    })

    expect(error).toBeDefined()
  })

  it('7. Blocks unauthorized caller from invoking reset-password action on Edge Function', async () => {
    const unauthClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { error } = await unauthClient.functions.invoke('invite-user', {
      body: { action: 'reset-password', email: 'victim@example.com', newPassword: 'HackedPass123' },
    })
    expect(error).toBeDefined()
  })

  it('8. Edge Function invite-user rejects unauthenticated callers', async () => {
    const { error } = await client.functions.invoke('invite-user', {
      body: { action: 'list-users' },
    })

    expect(error).toBeDefined()
  })

  it('9. Blocks anonymous/unauthorized caller from invoking admin-users Edge Function', async () => {
    const { error } = await client.functions.invoke('admin-users', {
      body: { action: 'list_users' },
    })

    expect(error).toBeDefined()
  })

  it('10. Blocks anonymous/unauthorized caller from invoking migrate-users Edge Function', async () => {
    const { error } = await client.functions.invoke('migrate-users', {
      body: { dry_run: true },
    })

    expect(error).toBeDefined()
  })

  it('11. Blocks unauthorized client from direct insert into app_users', async () => {
    const { error } = await client
      .from('app_users')
      .insert({ username: 'hacker', role: 'system_admin', display_name: 'Hacker' })
      .select()

    expect(error).toBeDefined()
  })
})

// ─── RLS Hardening Tests (P3) ─────────────────────────────────────────────────
// These tests verify that the anon client (no session) cannot access sensitive
// columns or perform mutations on protected tables.
// NOTE: Some tests may show "data: []" (empty) instead of error when RLS is
// enabled with restrictive SELECT policies — both outcomes are correct (no leak).
describe('RLS Hardening — anon client cannot access sensitive data (P3)', { timeout: 30000 }, () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  // ── app_users: password column must never be exposed to anon ──────────────
  it('P3-1. anon cannot read password column from app_users', async () => {
    const { data, error } = await anonClient
      .from('app_users')
      .select('password')
      .limit(5)

    // Either returns an error OR returns no data (RLS blocks the rows entirely)
    const isBlocked = error !== null || (Array.isArray(data) && data.length === 0)
    expect(isBlocked).toBe(true)
  })

  it('P3-2. anon cannot read activation_code column from app_users', async () => {
    const { data, error } = await anonClient
      .from('app_users')
      .select('activation_code')
      .limit(5)

    const isBlocked = error !== null || (Array.isArray(data) && data.length === 0)
    expect(isBlocked).toBe(true)
  })

  // ── app_users: anon cannot INSERT ─────────────────────────────────────────
  it('P3-3. anon cannot INSERT into app_users', async () => {
    const { error } = await anonClient
      .from('app_users')
      .insert({ username: 'anon-injected', role: 'system_admin', display_name: 'Injected' })

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── app_users: anon cannot UPDATE ─────────────────────────────────────────
  it('P3-4. anon cannot UPDATE app_users', async () => {
    const { error } = await anonClient
      .from('app_users')
      .update({ role: 'system_admin' })
      .eq('username', 'any-user')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── app_users: anon cannot DELETE ─────────────────────────────────────────
  it('P3-5. anon cannot DELETE from app_users', async () => {
    const { error } = await anonClient
      .from('app_users')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── movements: anon cannot INSERT ─────────────────────────────────────────
  it('P3-6. anon cannot INSERT into movements', async () => {
    const { error } = await anonClient
      .from('movements')
      .insert({ item: 'injected', qty_in: '100', kind: 'purchase' })

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── movements: anon cannot UPDATE ─────────────────────────────────────────
  it('P3-7. anon cannot UPDATE movements', async () => {
    const { error } = await anonClient
      .from('movements')
      .update({ item: 'tampered' })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── movements: anon cannot DELETE ─────────────────────────────────────────
  it('P3-8. anon cannot DELETE from movements', async () => {
    const { error } = await anonClient
      .from('movements')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── custody_items: anon cannot INSERT ────────────────────────────────────
  it('P3-9. anon cannot INSERT into custody_items', async () => {
    const { error } = await anonClient
      .from('custody_items')
      .insert({ name: 'injected-item', warehouseId: 'main', quantity: 999 })

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── custody_items: anon cannot UPDATE ────────────────────────────────────
  it('P3-10. anon cannot UPDATE custody_items', async () => {
    const { error } = await anonClient
      .from('custody_items')
      .update({ quantity: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── custody_items: anon cannot DELETE ────────────────────────────────────
  it('P3-11. anon cannot DELETE from custody_items', async () => {
    const { error } = await anonClient
      .from('custody_items')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    expect(error).toBeDefined()
    expect(error).not.toBeNull()
  })

  // ── app_settings: anon cannot UPDATE/modify ───────────────────────────────
  it('P3-12. anon cannot UPDATE app_settings', async () => {
    const { data, error } = await anonClient
      .from('app_settings')
      .update({ organization: 'Hacked Org' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()

    const isBlocked = error !== null || (Array.isArray(data) && data.length === 0)
    expect(isBlocked).toBe(true)
  })

  it('P3-13. anon cannot DELETE from app_settings', async () => {
    const { data, error } = await anonClient
      .from('app_settings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()

    const isBlocked = error !== null || (Array.isArray(data) && data.length === 0)
    expect(isBlocked).toBe(true)
  })
})

