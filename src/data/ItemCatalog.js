const ItemCatalog = Object.freeze({
  WOOD: Object.freeze({
    id: 'WOOD', displayName: 'Дерево', maxStack: 99, category: 'RESOURCE', consumable: false
  }),
  STONE: Object.freeze({
    id: 'STONE', displayName: 'Камень', maxStack: 99, category: 'RESOURCE', consumable: false
  }),
  SLIME_GEL: Object.freeze({
    id: 'SLIME_GEL', displayName: 'Слизь', maxStack: 99, category: 'RESOURCE', consumable: false
  }),
  RAW_MEAT: Object.freeze({
    id: 'RAW_MEAT', displayName: 'Сырое мясо', maxStack: 20, category: 'RESOURCE', consumable: false
  }),
  MEAT_STEW: Object.freeze({
    id: 'MEAT_STEW',
    displayName: 'Мясная похлёбка',
    maxStack: 10,
    category: 'FOOD',
    consumable: true,
    hungerRestore: 45,
    healthRestore: 10
  }),
  BERRIES: Object.freeze({
    id: 'BERRIES',
    displayName: 'Ягоды',
    maxStack: 99,
    category: 'FOOD',
    consumable: true,
    hungerRestore: 20
  }),
  STONE_AXE: Object.freeze({
    id: 'STONE_AXE',
    displayName: 'Каменный топор',
    maxStack: 1,
    category: 'TOOL',
    consumable: false,
    toolType: 'AXE',
    effectiveAgainst: 'TREE',
    actionDurationMs: 750
  }),
  STONE_PICKAXE: Object.freeze({
    id: 'STONE_PICKAXE',
    displayName: 'Каменная кирка',
    maxStack: 1,
    category: 'TOOL',
    consumable: false,
    toolType: 'PICKAXE',
    effectiveAgainst: 'ROCK',
    actionDurationMs: 850
  }),
  STONE_SWORD: Object.freeze({
    id: 'STONE_SWORD',
    displayName: 'Каменный меч',
    maxStack: 1,
    category: 'WEAPON',
    consumable: false,
    attackDamage: 15
  }),
  BOW: Object.freeze({
    id: 'BOW',
    displayName: 'Лук',
    maxStack: 1,
    category: 'WEAPON',
    consumable: false,
    attackType: 'RANGED',
    attackDamage: 10,
    attackCooldownMs: 650,
    projectileSpeed: 320,
    projectileRange: 220
  })
});
