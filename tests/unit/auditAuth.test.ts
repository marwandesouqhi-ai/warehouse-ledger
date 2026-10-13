import { describe, expect, it } from 'vitest'
import { checkIsSystemAdmin } from '../../src/lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

describe('System Admin Access Verification for Audit Log', () => {
    it('denies System Admin access when relying on username alone without app_metadata', () => {
        const session = {
            user: {
                id: '123',
                email: 'marwan-desouky',
                app_metadata: {},
                user_metadata: { username: 'marwan-desouky' },
            } as unknown as User,
        } as unknown as Session

        // Privileges are strictly derived from server app_metadata, never username strings
        expect(checkIsSystemAdmin(session)).toBe(false)

        // Verifies old marwandesouqhi@gmail.com is completely removed and rejected
        const oldSession = {
            user: {
                id: 'old-123',
                email: 'marwandesouqhi@gmail.com',
                app_metadata: {},
                user_metadata: {},
            } as unknown as User,
        } as unknown as Session
        expect(checkIsSystemAdmin(oldSession)).toBe(false)
    })

    it('grants System Admin access when app_metadata.system_admin is true', () => {
        const session = {
            user: {
                id: '456',
                email: 'custom_admin@example.com',
                app_metadata: { system_admin: true },
                user_metadata: {},
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(true)
    })

    it('denies System Admin access when app_metadata.role is regular admin (not system_admin)', () => {
        const session = {
            user: {
                id: '789',
                email: 'admin_officer@example.com',
                app_metadata: { role: 'admin' },
                user_metadata: {},
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(false)
    })

    it('denies System Admin access when user_metadata.role is regular admin (not system_admin)', () => {
        const session = {
            user: {
                id: '789-meta',
                email: 'admin_meta@example.com',
                app_metadata: {},
                user_metadata: { role: 'admin' },
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(false)
    })

    it('grants System Admin access when app_metadata.role is system_admin', () => {
        const session = {
            user: {
                id: '789-sys',
                email: 'admin_sys@example.com',
                app_metadata: { role: 'system_admin' },
                user_metadata: {},
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(true)
    })

    it('denies System Admin access to editor users', () => {
        const session = {
            user: {
                id: 'editor-1',
                email: 'warehouse_editor@example.com',
                app_metadata: { role: 'editor' },
                user_metadata: { role: 'editor' },
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(false)
    })

    it('denies System Admin access to viewer users', () => {
        const session = {
            user: {
                id: 'viewer-1',
                email: 'general_viewer@example.com',
                app_metadata: { role: 'viewer' },
                user_metadata: { role: 'viewer' },
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(false)
    })

    it('denies System Admin access to regular authenticated users without admin metadata', () => {
        const session = {
            user: {
                id: 'regular-1',
                email: 'employee@example.com',
                app_metadata: {},
                user_metadata: {},
            } as unknown as User,
        } as unknown as Session

        expect(checkIsSystemAdmin(session)).toBe(false)
    })

    it('handles direct user object passing as well', () => {
        const user = {
            id: 'admin-direct',
            email: 'admin@warehouse.local',
            app_metadata: { system_admin: true },
        } as unknown as User

        expect(checkIsSystemAdmin(user)).toBe(true)

        const regularUser = {
            id: 'regular-direct',
            email: 'user@example.com',
            app_metadata: {},
        } as unknown as User

        expect(checkIsSystemAdmin(regularUser)).toBe(false)
    })
})
