/** Guard both access to browser storage and its methods. Writes survive in memory if denied. */
export function createSafeStorage(getStorage: () => Pick<Storage, 'getItem' | 'setItem'>) {
  const memory = new Map<string, string>()
  return {
    getItem(key: string): string | null {
      if (memory.has(key)) return memory.get(key)!
      try { return getStorage().getItem(key) } catch { return null }
    },
    setItem(key: string, value: string): void {
      memory.set(key, value)
      try { getStorage().setItem(key, value) } catch { /* session-only fallback */ }
    },
  }
}

export const browserStorage = createSafeStorage(() => window.localStorage)
