// Central configuration for peaceful (passive) chunk NPCs.
// Keep this file as plain data only: no engine objects, callbacks or runtime state.
//
// Units:
// - renderWidth / renderHeight: on-screen display size in world pixels
//   (applied via setDisplaySize on the visual object).
// - bodyWidth / bodyHeight / bodyOffsetX / bodyOffsetY: Arcade body geometry
//   in TEXTURE (source) pixels. The engine scales these by the sprite scale, so a
//   texture that renders smaller/larger still gets a correctly scaled body.
//   For the rabbit placeholder the texture is 28x28, so source == display.
// - wanderTweenDuration / wanderPauseDuration: milliseconds for the shared
//   wander cycle (move tween + pause).
const PassiveNpcConfig = Object.freeze({
  RABBIT: Object.freeze({
    type: 'RABBIT',
    textureKey: 'rabbit-placeholder',
    maxHp: 6,
    lootType: 'RAW_MEAT',
    lootQuantity: 1,
    renderWidth: 28,
    renderHeight: 28,
    bodyWidth: 14,
    bodyHeight: 10,
    bodyOffsetX: 7,
    bodyOffsetY: 16,
    wanderTweenDuration: 450,
    wanderPauseDuration: 900
  }),
  PIG: Object.freeze({
    type: 'PIG',
    textureKey: 'pig-texture',
    maxHp: 20,
    lootType: 'RAW_MEAT',
    lootQuantity: 3,
    // Production texture is 1536x1024 with a lot of transparent padding; the
    // visible pig occupies roughly the central lower area. Displayed noticeably
    // larger than the rabbit while keeping the source aspect ratio (3:2).
    renderWidth: 150,
    renderHeight: 100,
    // Body covers the lower body and legs of the pig (source-pixel region
    // ~x[460..1000], y[582..700] inside the 1536x1024 texture).
    bodyWidth: 540,
    bodyHeight: 118,
    bodyOffsetX: 460,
    bodyOffsetY: 582,
    // Slightly slower and longer pause than the rabbit.
    wanderTweenDuration: 700,
    wanderPauseDuration: 1200
  })
});

function getPassiveNpcConfig(type) {
  if (typeof type !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(PassiveNpcConfig, type)
    ? PassiveNpcConfig[type]
    : null;
}
