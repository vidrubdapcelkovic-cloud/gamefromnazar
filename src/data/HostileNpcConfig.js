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
