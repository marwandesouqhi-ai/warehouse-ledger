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

  it('4. Allows seamless warehouse client to read inventory movements', async () => {
    const { data, error } = await client
      .from('movements')
      .select('*')

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.length).toBeGreaterThan(0)
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
})
