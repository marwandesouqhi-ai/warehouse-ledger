import { supabase } from './supabase'

export type AuditSeverity = 'info' | 'warning' | 'critical'

export type AuditLogEntry = {
    id: string
    user_id: string | null
    actor_id?: string | null
    actor_role?: string
    user_email: string
    action: string
    event_type?: string
    entity_type: string
    entity_id: string
    table_name?: string
    record_id?: string
    old_data?: Record<string, unknown> | null
    new_data?: Record<string, unknown> | null
    details: Record<string, unknown>
    ip?: string
    ip_address: string
    user_agent: string
    severity?: AuditSeverity
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
        const updated = [entry, ...current.filter((item) => item.id !== entry.id)]
        try {
            localStorage.setItem(localAuditLogsKey, JSON.stringify(updated))
        } catch {
            // If localStorage reaches browser quota, preserve the maximum safe history without failing
            localStorage.setItem(localAuditLogsKey, JSON.stringify(updated.slice(0, 10000)))
        }
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
    event_type?: string
    severity?: AuditSeverity
    details?: Record<string, unknown>
    user?: { id: string; email?: string; role?: string } | null
}): Promise<void> {
    const ip = await getClientIp().catch(() => '127.0.0.1')
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'

    let userId = params.user?.id ?? null
    let userEmail = params.user?.email ?? ''
    let actorRole = params.user?.role ?? ''

    if (!userId && supabase) {
        try {
            const { data } = await supabase.auth.getSession()
            userId = data.session?.user.id ?? null
            userEmail = data.session?.user.email ?? ''
            actorRole = (data.session?.user.app_metadata?.role as string) ?? ''
        } catch {
            // ignore
        }
    }

    const resolvedEventType = params.event_type ?? (params.entity_type === 'auth' ? 'auth_event' : 'client_action')
    const resolvedSeverity: AuditSeverity = params.severity ?? 'info'

    const localEntry: AuditLogEntry = {
        id: `local-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        user_id: userId,
        actor_id: userId,
        actor_role: actorRole || (userId ? 'authenticated' : 'anon'),
        user_email: userEmail || (userId ? `user-${userId.slice(0, 8)}` : ''),
        action: params.action,
        event_type: resolvedEventType,
        entity_type: params.entity_type ?? 'general',
        entity_id: params.entity_id ?? '',
        details: params.details ?? {},
        ip,
        ip_address: ip,
        user_agent: userAgent,
        severity: resolvedSeverity,
        created_at: new Date().toISOString(),
    }

    // Always persist to local storage cache
    saveLocalAuditLog(localEntry)

    // Persist to Supabase only if an authenticated session exists with a real user identity
    if (supabase && (userId || userEmail)) {
        try {
            await supabase.from('audit_logs').insert({
                user_id: userId,
                actor_id: userId,
                actor_role: actorRole || 'authenticated',
                user_email: userEmail,
                action: params.action,
                event_type: resolvedEventType,
                entity_type: params.entity_type ?? 'general',
                entity_id: params.entity_id ?? '',
                details: params.details ?? {},
                ip,
                ip_address: ip,
                user_agent: userAgent,
                severity: resolvedSeverity,
            })
        } catch (err) {
            console.warn('Failed to log audit event to Supabase:', err)
        }
    } else if (supabase && !userId && !userEmail) {
        console.warn('Skipping cloud audit log insert: no authenticated session active (stored locally).')
    }
}

/**
 * Report a security event (unauthorized page/API access, logout, permission denial)
 * through the hardened `record_security_event` SQL RPC with safe local fallback.
 */
export async function recordSecurityEvent(params: {
    event_type: string
    action: string
    severity?: AuditSeverity
    table_name?: string
    record_id?: string
    details?: Record<string, unknown>
    user?: { id: string; email?: string; role?: string } | null
}): Promise<void> {
    const ip = await getClientIp().catch(() => '127.0.0.1')
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
    const severity: AuditSeverity = params.severity ?? 'warning'

    if (supabase) {
        try {
            const { data: sessionData } = await supabase.auth.getSession()
            const hasSession = Boolean(sessionData?.session?.access_token)
            if (hasSession) {
                const { error } = await supabase.rpc('record_security_event', {
                    p_event_type: params.event_type,
                    p_action: params.action,
                    p_details: params.details ?? {},
                    p_severity: severity,
                    p_table_name: params.table_name ?? '',
                    p_record_id: params.record_id ?? '',
                    p_ip: ip,
                    p_user_agent: userAgent,
                })
                if (!error) {
                    saveLocalAuditLog({
                        id: `local-sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        user_id: sessionData.session?.user.id ?? null,
                        actor_id: sessionData.session?.user.id ?? null,
                        actor_role: (sessionData.session?.user.app_metadata?.role as string) ?? 'authenticated',
                        user_email: sessionData.session?.user.email ?? '',
                        action: params.action,
                        event_type: params.event_type,
                        entity_type: params.table_name || 'security',
                        entity_id: params.record_id ?? '',
                        table_name: params.table_name ?? '',
                        record_id: params.record_id ?? '',
                        details: params.details ?? {},
                        ip,
                        ip_address: ip,
                        user_agent: userAgent,
                        severity,
                        created_at: new Date().toISOString(),
                    })
                    return
                }
            }
        } catch {
            // Fall through to local/standard logAuditEvent
        }
    }

    await logAuditEvent({
        action: params.action,
        entity_type: params.table_name || 'security',
        entity_id: params.record_id || '',
        event_type: params.event_type,
        severity,
        details: params.details,
        user: params.user,
    })
}

/**
 * Fetch all audit logs for the audit view (from Supabase with local fallback, permanently merging records)
 */
export async function fetchAuditLogs(limit = 10000): Promise<AuditLogEntry[]> {
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

        // Merge remote logs with any local logs, ensuring no historical records are ever overwritten or dropped
        const mergedMap = new Map<string, AuditLogEntry>()
        for (const log of remoteLogs) {
            mergedMap.set(log.id, log)
        }
        for (const log of localLogs) {
            if (!mergedMap.has(log.id)) {
                mergedMap.set(log.id, log)
            }
        }
        const merged = Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )

        try {
            localStorage.setItem(localAuditLogsKey, JSON.stringify(merged))
        } catch {
            try {
                localStorage.setItem(localAuditLogsKey, JSON.stringify(merged.slice(0, 10000)))
            } catch {
                // ignore
            }
        }

        return merged.slice(0, limit)
    } catch {
        return localLogs.slice(0, limit)
    }
}
