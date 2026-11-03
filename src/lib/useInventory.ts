import { useSyncExternalStore } from 'react'
import { readInventoryState } from './inventoryStorage'
import type { InventorySnapshot } from './inventoryTypes'

let lastSerialized = ''
let lastState: InventorySnapshot = { schemaVersion: 2, revision: 0, items: [], movements: [], appliedOperations: [] }
function snapshot() {
  try {
    const state = readInventoryState()
    const serialized = JSON.stringify(state)
    if (serialized !== lastSerialized) { lastSerialized = serialized; lastState = state }
  } catch { /* Keep the last readable view; mutation methods surface storage errors. */ }
  return lastState
}
function subscribe(listener: () => void) {
  window.addEventListener('inventory-changed', listener)
  window.addEventListener('custody-changed', listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener('inventory-changed', listener)
    window.removeEventListener('custody-changed', listener)
    window.removeEventListener('storage', listener)
  }
}
export function useInventory() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  return state
}
