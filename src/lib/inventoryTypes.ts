import type { CustodyItem } from './custody'
import type { FixtureMovement } from './fixture'

export type InventoryEffect = { itemId: string; quantity: number; value: number }
export type InventoryEvent = {
  id: string; at: string; kind: string; title: string; description: string
  beforeItems?: Omit<CustodyItem, 'history'>[]; beforeMovements?: FixtureMovement[]
  movementId?: string; effects: InventoryEffect[]
}
export type InventorySnapshot = {
  schemaVersion: 2; revision: number; items: CustodyItem[]; movements: FixtureMovement[]; appliedOperations: string[]
}
export type InventoryCommand =
  | { kind: 'purchase' | 'disbursement'; movement: FixtureMovement }
  | { kind: 'transfer'; sourceItemId: string; targetWarehouseId: string; quantity: number; custodian?: string; location?: string; note?: string; permit?: string }
  | { kind: 'edit'; movementId: string | number; movement: FixtureMovement }
  | { kind: 'delete'; movementId: string | number; expectedVersion?: number }
  | { kind: 'item_save'; item: CustodyItem; note?: string }
  | { kind: 'item_delete'; itemId: string; expectedVersion?: number }
  | { kind: 'import'; items: CustodyItem[] }
export type InventoryPlan = {
  id: string; kind: InventoryCommand['kind']; event: InventoryEvent; beforeRevision: number; next: InventorySnapshot
  itemChanges: { expectedVersion: number | null; after: CustodyItem }[]
  movementChanges: { expectedVersion: number | null; after: FixtureMovement }[]
}
