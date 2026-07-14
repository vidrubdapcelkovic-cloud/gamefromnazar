const CreatureCatalog = Object.freeze({
  SLIME: Object.freeze({
    id: 'SLIME', displayName: 'Слизень', maxHealth: 30, moveSpeed: 70,
    detectionRadius: 160, loseRadius: 220, attackRange: 26,
    contactDamage: 5, attackCooldownMs: 1000,
    loot: Object.freeze([
      Object.freeze({ itemId: 'SLIME_GEL', minQuantity: 1, maxQuantity: 2 }),
      Object.freeze({ itemId: 'RAW_MEAT', minQuantity: 1, maxQuantity: 1 })
    ])
  })
});
