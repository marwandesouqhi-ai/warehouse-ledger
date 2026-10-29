import { supabase } from './supabase'

export type AuditLogEntry = {
    id: string
    user_id: string | null
    user_email: string
    action: string
    entity_type: string
    entity_id: string
    details: Record<string, unknown>
    ip_address: string
    user_agent: string
    created_at: string
}

const localAuditLogsKey = 'warehouse-ledger-audit-logs'
let cachedIp = ''

export function getLocalAuditLogs(): AuditLogEntry[] {
    try {
        const stored = localStorage.getItem(localAuditLogsKey)
        if (stored) {
            const parsed = JSON.parse(stored) as unknown
            if (Array.isArray(parsed)) return parsed as AuditLogEntry[]
        }
    } catch {
        // ignore
    }
    return []
}

function saveLocalAuditLog(entry: AuditLogEntry) {
    try {
        const current = getLocalAuditLogs()
        const updated = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 150)
        localStorage.setItem(localAuditLogsKey, JSON.stringify(updated))
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('audit-logs-changed', { detail: entry }))
        }
    } catch {
        // ignore
    }
}

/**
 * Fetch client public IP address (cached in memory)
 */
export async function getClientIp(): Promise<string> {
    if (cachedIp) return cachedIp

    try {
        const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) })
        if (response.ok) {
            const data = (await response.json()) as { ip?: string }
            if (data.ip) {
                cachedIp = data.ip
                return data.ip
            }
        }
    } catch {
        try {
            const response2 = await fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(3000) })
            if (response2.ok) {
                const data = (await response2.json()) as { ip?: string }
                if (data.ip) {
                    cachedIp = data.ip
                    return data.ip
                }
            }
        } catch {
            // Keep default fallback
        }
    }

    cachedIp = '127.0.0.1 (محلي)'
    return cachedIp
}

/**
 * Record an audit log event to Supabase and LocalStorage
 */
export async function logAuditEvent(params: {
    action: string
    entity_type?: string
    entity_id?: string
    details?: Record<string, unknown>
    user?: { id: string; email?: string } | null
}): Promise<void> {
    const ip = await getClientIp().catch(() => '127.0.0.1')
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'

    let userId = params.user?.id ?? null
    let userEmail = params.user?.email ?? ''

    if (!userId && supabase) {
        try {
            const { data } = await supabase.auth.getSession()
            userId = data.session?.user.id ?? null
            userEmail = data.session?.user.email ?? ''
        } catch {
            // ignore
        }
    }

    const localEntry: AuditLogEntry = {
        id: `local-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        user_id: userId,
        user_email: userEmail || (userId ? `user-${userId.slice(0, 8)}` : ''),
        action: params.action,
        entity_type: params.entity_type ?? 'general',
        entity_id: params.entity_id ?? '',
        details: params.details ?? {},
        ip_address: ip,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
    }

    // Always persist to local storage cache
    saveLocalAuditLog(localEntry)

    // Persist to Supabase only if an authenticated session exists with a real user identity
    if (supabase && (userId || userEmail)) {
        try {
            await supabase.from('audit_logs').insert({
                user_id: userId,
                user_email: userEmail,
                action: params.action,
                entity_type: params.entity_type ?? 'general',
                entity_id: params.entity_id ?? '',
                details: params.details ?? {},
                ip_address: ip,
                user_agent: userAgent,
            })
        } catch (err) {
            console.warn('Failed to log audit event to Supabase:', err)
        }
    } else if (supabase && !userId && !userEmail) {
        console.warn('Skipping cloud audit log insert: no authenticated session active (stored locally).')
    }
}

/**
 * Fetch all audit logs for the audit view (from Supabase with local fallback)
 */
export async function fetchAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
    const localLogs = getLocalAuditLogs()

    if (!supabase) {
        return localLogs.slice(0, limit)
    }

    try {
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit)

        if (error) {
            console.warn('Error fetching audit logs from Supabase, falling back to local:', error)
            return localLogs.slice(0, limit)
        }

        const remoteLogs = (data ?? []) as AuditLogEntry[]
        if (remoteLogs.length > 0) {
            // Cache remote logs locally
            try {
                localStorage.setItem(localAuditLogsKey, JSON.stringify(remoteLogs.slice(0, 150)))
            } catch {
                // ignore
            }
            return remoteLogs
        }

        return localLogs.slice(0, limit)
    } catch {
        return localLogs.slice(0, limit)
    }
}
