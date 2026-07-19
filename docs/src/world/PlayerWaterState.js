// Player-in-water state and the movement slow-down it causes.
//
// Water is passable for the player (the river sprite is a passive visual, not a
// blocker), but wading is slower. Whether the player is "in water" is decided by
// the FEET (bottom-centre of the physics body), using the same production river
// mask (`RiverGenerator.isWaterTile`) that generated the river. It never depends
// on textures, colours, sprite overlap or whether a water sprite is loaded, and
// it works for negative coordinates and across chunk borders (absolute tiles).
const PLAYER_WATER_SPEED_MULTIPLIER = 0.55;

const PlayerWaterState = {
  PLAYER_WATER_SPEED_MULTIPLIER,

  // Foot world-position = bottom-centre of the Arcade physics body (NOT the
  // centre of the visual Nazar sprite). Returns null when no body is present.
  footPosition(body) {
    if (!body) return null;
    const x = body.center && Number.isFinite(body.center.x)
      ? body.center.x
      : body.x + (Number.isFinite(body.width) ? body.width : 0) / 2;
    const y = Number.isFinite(body.bottom)
      ? body.bottom
      : body.y + (Number.isFinite(body.height) ? body.height : 0);
    return { x, y };
  },

  // Single, stable rule (no bank jitter): the feet are in water iff the tile
  // under the bottom-centre of the body is a river tile.
  isFootInWater(worldSeed, footX, footY) {
    if (!Number.isFinite(footX) || !Number.isFinite(footY)) return false;
    const tile = ChunkMath.worldToTile(footX, footY);
    return RiverGenerator.isWaterTile(worldSeed, tile.tileX, tile.tileY);
  },

  // 1.0 on land, PLAYER_WATER_SPEED_MULTIPLIER in water. Recomputed from the base
  // multiplier on every call, so the slow-down never accumulates between frames.
  speedMultiplier(worldSeed, footX, footY) {
    return this.isFootInWater(worldSeed, footX, footY)
      ? PLAYER_WATER_SPEED_MULTIPLIER
      : 1;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayerWaterState;
}
