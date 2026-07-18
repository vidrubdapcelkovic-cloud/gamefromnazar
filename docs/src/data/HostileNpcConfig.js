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
