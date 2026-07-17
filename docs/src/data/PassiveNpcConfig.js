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
    // Cropped production texture is 894x432 (content 862x400 + 16px padding).
    // Display size preserves the pre-crop visible world size (~84.18 x 39.06).
    renderWidth: 87,
    renderHeight: 42,
    // Body covers the same lower body / legs region in texture pixels.
    // Offsets remapped after crop: oldOffset - contentOrigin + padding.
    bodyWidth: 540,
    bodyHeight: 118,
    bodyOffsetX: 171,
    bodyOffsetY: 294,
    // Slightly slower and longer pause than the rabbit.
    wanderTweenDuration: 700,
    wanderPauseDuration: 1200
  }),
  LLAMA: Object.freeze({
    type: 'LLAMA',
    textureKey: 'llama-texture',
    maxHp: 20,
    lootType: 'RAW_MEAT',
    lootQuantity: 3,
    // Prepared texture 850x1179 (content 818x1147 + 16px padding, aspect ~0.713).
    // Visible content height ~90 world px; full display includes transparent padding.
    renderWidth: 67,
    renderHeight: 93,
    // Body covers the lower torso / upper legs (bottom ~26% of content) in texture pixels.
    bodyWidth: 728,
    bodyHeight: 299,
    bodyOffsetX: 61,
    bodyOffsetY: 864,
    // Slightly slower than PIG.
    wanderTweenDuration: 750,
    wanderPauseDuration: 1300
  }),
  BUFFALO: Object.freeze({
    type: 'BUFFALO',
    textureKey: 'buffalo-texture',
    maxHp: 35,
    lootType: 'RAW_MEAT',
    lootQuantity: 5,
    // Prepared texture 1018x821 (content 986x789 + 16px padding, aspect ~1.25).
    // Visible content width ~115 world px; full display includes transparent padding.
    renderWidth: 119,
    renderHeight: 96,
    // Body covers the lower torso / upper legs in texture pixels.
    bodyWidth: 679,
    bodyHeight: 341,
    bodyOffsetX: 134,
    bodyOffsetY: 449,
    wanderTweenDuration: 900,
    wanderPauseDuration: 1600
  })
});

function getPassiveNpcConfig(type) {
  if (typeof type !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(PassiveNpcConfig, type)
    ? PassiveNpcConfig[type]
    : null;
}
