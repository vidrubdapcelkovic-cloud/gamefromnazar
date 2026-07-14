const BuildCatalog = Object.freeze({
  WOOD_WALL: Object.freeze({
    id: 'WOOD_WALL',
    displayName: 'Деревянная стена',
    widthCells: 1,
    heightCells: 1,
    blocksMovement: true,
    cost: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 2 })
    ])
  }),
  CAMPFIRE: Object.freeze({
    id: 'CAMPFIRE',
    displayName: 'Костёр',
    widthCells: 1,
    heightCells: 1,
    blocksMovement: true,
    cost: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 2 }),
      Object.freeze({ itemType: 'STONE', quantity: 4 })
    ]),
    healAmount: 20,
    healCooldownMs: 30000,
    interactionDurationMs: 800
  }),
  CHEST: Object.freeze({
    id: 'CHEST',
    displayName: 'Сундук',
    widthCells: 1,
    heightCells: 1,
    blocksMovement: true,
    cost: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 6 })
    ]),
    storageSlots: 15
  })
});
