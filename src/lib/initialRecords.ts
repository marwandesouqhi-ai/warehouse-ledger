/** Read existing arrays unchanged. Demo initialization never replaces a saved store. */
export function loadInitialRecords<T>(key: string, fixtures: T[]): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed as T[] : []
    }
    const marker = `${key}:demo-initialized:v1`
    if (import.meta.env.VITE_DEMO_MODE !== 'true' || localStorage.getItem(marker) !== null) return []
    // Mark first: if persistence fails, do not repeatedly initialize a partly written store.
    localStorage.setItem(marker, 'true')
    localStorage.setItem(key, JSON.stringify(fixtures))
    return fixtures.map((record) => ({ ...record }))
  } catch {
    // Unreadable data is left untouched for recovery.
    return []
  }
}
