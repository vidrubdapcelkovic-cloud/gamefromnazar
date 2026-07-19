// Central configuration for hostile chunk NPCs.
// Keep this file as plain data only: no engine objects, callbacks or runtime state.
//
// Units mirror PassiveNpcConfig:
// - renderWidth / renderHeight: on-screen display size in world pixels.
// - bodyWidth / bodyHeight / bodyOffsetX / bodyOffsetY: Arcade body geometry
//   in TEXTURE (source) pixels (scaled by sprite scale).
// - radii / speeds: world pixels (or world px / second for chaseSpeed).
// - attackCooldown / wander durations: milliseconds.
const HostileNpcConfig = Object.freeze({
  // SLIME: restored from the legacy CreatureCatalog.SLIME + CreatureSystem blob.
  // It was hostile (contact damage, detection/lose radius, attack cooldown) and
  // dropped two stacks. Historically it lived only in the old fixed-map spawn
  // (GameScene SLIME_SPAWN_CELLS, gated by !useChunkedWorld), so once the world
  // became chunk-based (USE_CHUNKED_WORLD = true) it never spawned again. It is
  // re-registered here so the shared ChunkGenerator/ChunkInstance/HostileNpc
  // controller/persistence flow drives it exactly like the other hostiles.
  SLIME: Object.freeze({
    type: 'SLIME',
    // Procedural 32x32 texture generated once (temporary-slime); display == source.
    textureKey: 'temporary-slime',
    maxHp: 30,
    // Historical two-stack loot (SLIME_GEL x1..2 and RAW_MEAT x1). The optional
    // `loot` array is consumed by ChunkInstance.dropNpcLoot; hostiles without it
    // keep using the single lootType/lootQuantity fields (unchanged behaviour).
    loot: Object.freeze([
      Object.freeze({ itemId: 'SLIME_GEL', minQuantity: 1, maxQuantity: 2 }),
      Object.freeze({ itemId: 'RAW_MEAT', minQuantity: 1, maxQuantity: 1 })
    ]),
    renderWidth: 32,
    renderHeight: 32,
    // Body mirrors the legacy CreatureSystem 24x18 blob, centred on the slime
    // mass (texture pixels; scaled by the sprite scale like every other NPC body).
    bodyWidth: 24,
    bodyHeight: 18,
    bodyOffsetX: 4,
    bodyOffsetY: 9,
    // No historical wander cadence (the old slime idled until it detected the
    // player); minimal slow-blob values from the base NPC shape (assumption).
    wanderTweenDuration: 650,
    wanderPauseDuration: 1100,
    // Restored 1:1 from CreatureCatalog.SLIME.
    detectionRadius: 160,
    disengageRadius: 220,
    attackRange: 26,
    attackDamage: 5,
    attackCooldown: 1000,
    chaseSpeed: 70,
    returnRadius: 12
  }),
  TALL_MONSTER: Object.freeze({
    type: 'TALL_MONSTER',
    textureKey: 'tall-monster-texture',
    maxHp: 30,
    lootType: 'RAW_MEAT',
    lootQuantity: 2,
    // Prepared texture 391x1305 (content 359x1273 + 16px padding, aspect ~0.282).
    // Visible content height ~110 world px; full display includes transparent padding.
    renderWidth: 34,
    renderHeight: 113,
    // Body covers central torso / pelvis / upper legs in texture pixels.
    bodyWidth: 203,
    bodyHeight: 510,
    bodyOffsetX: 94,
    bodyOffsetY: 423,
    wanderTweenDuration: 850,
    wanderPauseDuration: 1200,
    detectionRadius: 150,
    disengageRadius: 230,
    attackRange: 30,
    attackDamage: 5,
    attackCooldown: 1000,
    chaseSpeed: 55,
    returnRadius: 12
  }),
  ELECTRICMAN: Object.freeze({
    type: 'ELECTRICMAN',
    textureKey: 'electricman-texture',
    maxHp: 20,
    lootType: 'RAW_MEAT',
    lootQuantity: 2,
    // Prepared texture 991x1305 (content 959x1273 + 16px padding, aspect ~0.753).
    // Visible content height ~100 world px; full display includes transparent padding.
    renderWidth: 78,
    renderHeight: 103,
    // Body covers central torso / pelvis / upper legs in texture pixels.
    bodyWidth: 423,
    bodyHeight: 510,
    bodyOffsetX: 284,
    bodyOffsetY: 423,
    wanderTweenDuration: 700,
    wanderPauseDuration: 1000,
    detectionRadius: 170,
    disengageRadius: 250,
    attackRange: 28,
    attackDamage: 4,
    attackCooldown: 900,
    chaseSpeed: 68,
    returnRadius: 12
  }),
  BOWMAN: Object.freeze({
    type: 'BOWMAN',
    textureKey: 'bowman-texture',
    maxHp: 24,
    lootType: 'RAW_MEAT',
    lootQuantity: 2,
    // Prepared texture 856x1169 (content 824x1137 + 16px padding, aspect ~0.725).
    // Visible content height ~102 world px; full display includes transparent padding.
    renderWidth: 77,
    renderHeight: 105,
    // Body covers central torso / pelvis / upper legs (excludes head/arms/bow).
    bodyWidth: 330,
    bodyHeight: 456,
    bodyOffsetX: 263,
    bodyOffsetY: 379,
    wanderTweenDuration: 800,
    wanderPauseDuration: 1100,
    detectionRadius: 165,
    disengageRadius: 245,
    // Melee attackRange kept for shared shape; BOWMAN attacks from rangedAttackRange.
    attackRange: 30,
    attackDamage: 5,
    attackCooldown: 1000,
    chaseSpeed: 60,
    returnRadius: 12,
    // Ranged attack (first simple direct arrow). Only BOWMAN is ranged; the
    // other hostiles omit these fields and stay melee via the ATTACK state.
    attackMode: 'RANGED',
    rangedAttackRange: 150,
    projectileSpeed: 180,
    projectileDamage: 6,
    projectileLifetime: 1200,
    projectileWidth: 14,
    projectileHeight: 3
  })
});

function getHostileNpcConfig(type) {
  if (typeof type !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(HostileNpcConfig, type)
    ? HostileNpcConfig[type]
    : null;
}

function isHostileNpcType(type) {
  return getHostileNpcConfig(type) !== null;
}
