import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function handlerFor(file: string, user: any) {
  let handler: (request: Request) => Promise<Response>
  const queried: unknown[][] = []
  const operations = vi.fn()
  const builder: any = {
    select: () => builder,
    eq: (...args: unknown[]) => { queried.push(args); return builder },
    ilike: (...args: unknown[]) => { queried.push(args); return builder },
    maybeSingle: async () => ({ data: {
      id: 'own-profile', display_name: 'Own name', email: user?.email,
      employee_id: 'OWN', department: 'المخازن', role: user?.app_metadata.role, status: 'active',
    }, error: null }),
  }
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (...args: unknown[]) => { operations(...args); return builder },
    rpc: operations,
  }
  const source = readFileSync(new URL('../../supabase/functions/' + file + '/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText
  new Function('serve', 'createClient', 'nodemailer', 'Deno', code)(
    (fn: typeof handler) => { handler = fn }, () => client, {},
    { env: { get: (name: string) => name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'test-only' } },
  )
  const call = (action: string, extra = {}) => handler(new Request('https://edge.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  }))
  return { call, operations, queried }
}

describe('actual Edge handler user-directory boundary', () => {
  for (const role of ['admin', 'warehouse_admin', 'procurement_admin', 'warehouse_employee', 'procurement_employee', 'editor', 'purchasing_staff']) {
    it(`${role} cannot list or modify other accounts despite legacy extra grants`, async () => {
      const user = { id: 'own-auth-id', email: 'own@example.com', app_metadata: { role, permissions: ['manage_records'] } }
      for (const action of ['list_users', 'approve_registration_request', 'resend_registration_invitation', 'cancel_registration_invitation']) {
        const { call, operations } = handlerFor('admin-users', user)
        expect((await call(action, { requestId: 'other-request' })).status).toBe(403)
        expect(operations).not.toHaveBeenCalled()
      }
    })
  }
  it('requires a verified caller before returning an activation profile', async () => {
    const { call, operations } = handlerFor('complete-activation', null)
    expect((await call('get_profile', { email: 'other@example.com' })).status).toBe(401)
    expect(operations).not.toHaveBeenCalled()
  })
  it('uses the verified caller identity, never an arbitrary profile email', async () => {
    const { call, queried } = handlerFor('complete-activation', {
      id: 'own-auth-id', email: 'own@example.com', app_metadata: { role: 'warehouse_employee' },
    })
    const response = await call('get_profile', { email: 'other@example.com' })
    expect(response.status).toBe(200)
    expect((await response.json()).profile.email).toBe('own@example.com')
    expect(queried).toContainEqual(['auth_user_id', 'own-auth-id'])
    expect(JSON.stringify(queried)).not.toContain('other@example.com')
  })
})
