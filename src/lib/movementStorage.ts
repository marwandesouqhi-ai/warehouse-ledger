import { readInventorySnapshot } from './inventoryStorage'
import { fixtureMovements, type FixtureMovement } from './fixture'
import { loadInitialRecords } from './initialRecords'

export const movementStorageKey = 'warehouse-ledger-movements'
export function loadMovements(): FixtureMovement[] {
  const state = readInventorySnapshot()
  return state ? state.movements.filter((movement) => !movement.deletedAt) : loadInitialRecords(movementStorageKey, fixtureMovements)
}

/** Do not replace an unreadable saved ledger with the loader's empty fallback. */
export function persistMovementsLocally(movements: FixtureMovement[]): void {
  try {
    if (readInventorySnapshot()) return
    const raw = localStorage.getItem(movementStorageKey)
    if (raw !== null && !Array.isArray(JSON.parse(raw))) return
    localStorage.setItem(movementStorageKey, JSON.stringify(movements))
  } catch { /* Keep the original store intact if reading or parsing fails. */ }
}
