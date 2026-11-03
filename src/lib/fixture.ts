import originalData from '../../fixtures/original-data.json'

export type FixtureMovement = {
    requestFingerprint?: string
    version?: number
    deletedAt?: string
    inventoryEffects?: import('./inventoryTypes').InventoryEffect[]
    id: number | string
    date: string
    inv: number | string
    from: string
    to: string
    permit: string | number
    issue: string
    item: string
    price: string | number
    qin: number | string
    qout: number | string
    notes: string
    custodyApplied?: boolean
    createdBy?: string
    sourceQuantityBefore?: number
    sourceValueBefore?: number
    sourceItemId?: string
    sourceWarehouseId?: string
    destType?: 'warehouse' | 'custodian'
    destWarehouseId?: string
    custodianName?: string
}

export const fixtureMovements = originalData as FixtureMovement[]
