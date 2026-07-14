const RecipeCatalog = Object.freeze({
  STONE_AXE: Object.freeze({
    id: 'STONE_AXE',
    displayName: 'Каменный топор',
    ingredients: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 3 }),
      Object.freeze({ itemType: 'STONE', quantity: 2 })
    ]),
    result: Object.freeze({ itemType: 'STONE_AXE', quantity: 1 })
  }),
  STONE_PICKAXE: Object.freeze({
    id: 'STONE_PICKAXE',
    displayName: 'Каменная кирка',
    ingredients: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 2 }),
      Object.freeze({ itemType: 'STONE', quantity: 3 })
    ]),
    result: Object.freeze({ itemType: 'STONE_PICKAXE', quantity: 1 })
  }),
  STONE_SWORD: Object.freeze({
    id: 'STONE_SWORD',
    displayName: 'Каменный меч',
    ingredients: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 1 }),
      Object.freeze({ itemType: 'STONE', quantity: 2 })
    ]),
    result: Object.freeze({ itemType: 'STONE_SWORD', quantity: 1 })
  }),
  BOW: Object.freeze({
    id: 'BOW',
    displayName: 'Лук',
    ingredients: Object.freeze([
      Object.freeze({ itemType: 'WOOD', quantity: 3 }),
      Object.freeze({ itemType: 'SLIME_GEL', quantity: 1 })
    ]),
    result: Object.freeze({ itemType: 'BOW', quantity: 1 })
  }),
  MEAT_STEW: Object.freeze({
    id: 'MEAT_STEW',
    displayName: 'Мясная похлёбка',
    station: 'CAMPFIRE',
    ingredients: Object.freeze([
      Object.freeze({ itemType: 'BERRIES', quantity: 2 }),
      Object.freeze({ itemType: 'RAW_MEAT', quantity: 1 })
    ]),
    result: Object.freeze({ itemType: 'MEAT_STEW', quantity: 1 })
  })
});
