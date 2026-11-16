import { beforeEach, describe, expect, it, vi } from 'vitest'

type ServerUser = {
  id: string
  username: string
  displayName: string
  email: string
  role: string
  status: string
  createdAt: string
}

// Fake server behind the `admin-users` edge function.
const server = {
  users: [] as ServerUser[],
  listFailures: 0,
  keepAfterDelete: new Set<string>(),
  calls: [] as string[],
}

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_name: string, options: { body: { action: string; userId?: string; username?: string } }) => {
        const { action, userId } = options.body
        server.calls.push(action)
        if (action === 'list_users') {
          if (server.listFailures > 0) {
            server.listFailures -= 1
            return { data: null, error: new Error('503 Service Unavailable') }
          }
          return { data: { success: true, users: server.users.map((u) => ({ ...u })) }, error: null }
        }
        if (action === 'delete_user') {
          if (!server.keepAfterDelete.has(String(userId))) {
            server.users = server.users.filter((u) => u.id !== userId)
          }
          return { data: { success: true }, error: null }
        }
        return { data: { success: false, error: 'unsupported' }, error: null }
      }),
    },
  },
}))

vi.mock('../../src/lib/auditLogger', () => ({
  logAuditEvent: vi.fn(async () => undefined),
  recordSecurityEvent: vi.fn(async () => undefined),
}))

import { deleteUserPermanently, loadLocalUsers, saveLocalUsers, syncUsersWithCloud } from '../../src/lib/localUsers'

const mk = (id: string, username: string, role = 'warehouse_employee'): ServerUser => ({
  id,
  username,
  displayName: username,
  email: `${username}@example.com`,
  role,
  status: 'active',
  createdAt: '2026-10-30T00:00:00.000Z',
})

describe('permanent user deletion keeps the directory in sync with the server', () => {
  beforeEach(() => {
    server.users = [mk('admin-1', 'owner', 'system_admin'), mk('u-507', 'employee507'), mk('u-2', 'employee2')]
    server.listFailures = 0
    server.keepAfterDelete = new Set()
    server.calls = []
  })

  it('a deleted account never comes back in the directory (no stale list is written back)', async () => {
    await syncUsersWithCloud()
    expect(loadLocalUsers().map((u) => u.id)).toEqual(['admin-1', 'u-507', 'u-2'])

    await deleteUserPermanently('u-507')
    expect(loadLocalUsers().map((u) => u.id)).toEqual(['admin-1', 'u-2'])

    await deleteUserPermanently('u-2')
    expect(loadLocalUsers().map((u) => u.id)).toEqual(['admin-1'])
    expect(server.users.map((u) => u.id)).toEqual(['admin-1'])
  })

  it('a stale in-memory entry for an account that no longer exists is not resurrected by a later delete', async () => {
    // Directory still holds "ghost" (deleted earlier from another device) while the server no longer lists it.
    saveLocalUsers([
      { ...mk('admin-1', 'owner', 'system_admin'), password: '', activationCode: '' } as never,
      { ...mk('u-507', 'employee507'), password: '', activationCode: '' } as never,
      { ...mk('ghost', 'ghost'), password: '', activationCode: '' } as never,
    ])
    await deleteUserPermanently('u-507')
    expect(loadLocalUsers().map((u) => u.id)).toEqual(['admin-1', 'u-2'])
  })

  it('refuses to report success when the server still lists the account after the delete request', async () => {
    await syncUsersWithCloud()
    server.keepAfterDelete.add('u-507')
    await expect(deleteUserPermanently('u-507')).rejects.toThrow(/ما زال يعرض الحساب/)
  })

  it('never deletes the last active system administrator', async () => {
    await syncUsersWithCloud()
    await expect(deleteUserPermanently('admin-1')).rejects.toThrow()
    expect(server.calls).not.toContain('delete_user')
  })

  it('retries the user list once when the edge function answers with a transient error', async () => {
    server.listFailures = 1
    const users = await syncUsersWithCloud()
    expect(users.map((u) => u.id)).toEqual(['admin-1', 'u-507', 'u-2'])
    expect(server.calls.filter((c) => c === 'list_users').length).toBe(2)
  })
})
