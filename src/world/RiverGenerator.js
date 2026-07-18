// Deterministic procedural rivers (stage 1: static water only).
//
// The river is a single, world-spanning meandering channel. A cell being water
// depends ONLY on: the world seed, the absolute world-tile coordinates, and this
// fixed algorithm version. It never depends on chunk load order, and it never
// consumes the TREE/ROCK/NPC RNG streams. Neighbouring chunks agree by
// construction because every query is a pure function of absolute coordinates.
//
// Model: one dominant axis (vertical OR horizontal, chosen from the seed). The
// channel centre line is a low-frequency sum of two seed-dependent sinusoids
// offset far from the spawn tile. Water is the band of `width` tiles (2..4)
// around that centre line. A generous dry safe zone around the spawn tile keeps
// the start area walkable and its exits open. Bridges/fords/lakes/flow are out
// of scope for this stage.
const RIVER_ALGORITHM_VERSION = 1;

const RiverGenerator = {
  VERSION: RIVER_ALGORITHM_VERSION,
  // Spawn tile is chunk (0,0) local (8,8); keep a dry, exitable start area.
  SAFE_ZONE_TILE_X: 8,
  SAFE_ZONE_TILE_Y: 8,
  SAFE_ZONE_RADIUS: 7,

  _cacheSeedKey: null,
  _cacheParams: null,

  _unit(worldSeed, stream) {
    return SeededRandom.hashParts(worldSeed, 0, 0, stream) / 4294967296;
  },

  // Seed-derived, world-global river parameters. Cached per seed so scanning a
  // chunk does not recompute the hashes for every tile.
  getParams(worldSeed) {
    const key = `${typeof worldSeed}:${worldSeed}`;
    if (this._cacheSeedKey === key && this._cacheParams) return this._cacheParams;
    const u = (stream) => this._unit(worldSeed, stream);
    const params = {
      orientationVertical: u('river-orientation') < 0.5,
      side: u('river-side') < 0.5 ? -1 : 1,
      // Centre line sits 30..69 tiles off the spawn axis so it never crosses the
      // start area; the meander below never reaches back into the safe zone.
      base: 30 + Math.floor(u('river-base') * 40),
      amp1: 5 + u('river-amp1') * 6,
      amp2: 2 + u('river-amp2') * 3,
      freq1: 0.018 + u('river-freq1') * 0.020,
      freq2: 0.050 + u('river-freq2') * 0.030,
      phase1: u('river-phase1') * Math.PI * 2,
      phase2: u('river-phase2') * Math.PI * 2,
      widthPhase: u('river-width-phase') * Math.PI * 2,
      widthFreq: 0.030 + u('river-width-freq') * 0.030
    };
    this._cacheSeedKey = key;
    this._cacheParams = params;
    return params;
  },

  isInSafeZone(worldTileX, worldTileY) {
    return Math.abs(worldTileX - this.SAFE_ZONE_TILE_X) <= this.SAFE_ZONE_RADIUS
      && Math.abs(worldTileY - this.SAFE_ZONE_TILE_Y) <= this.SAFE_ZONE_RADIUS;
  },

  // Centre line and channel width along the dominant axis coordinate.
  _channelAt(params, along) {
    const spawnAxis = params.orientationVertical ? this.SAFE_ZONE_TILE_X : this.SAFE_ZONE_TILE_Y;
    const center = spawnAxis
      + params.side * params.base
      + params.amp1 * Math.sin(params.freq1 * along + params.phase1)
      + params.amp2 * Math.sin(params.freq2 * along + params.phase2);
    // Width 2..4, changing by at most 1 tile between adjacent rows.
    const width = 3 + Math.round(Math.sin(params.widthFreq * along + params.widthPhase));
    return { center, width };
  },

  isWaterTile(worldSeed, worldTileX, worldTileY) {
    if (!Number.isInteger(worldTileX) || !Number.isInteger(worldTileY)) return false;
    if (this.isInSafeZone(worldTileX, worldTileY)) return false;
    const params = this.getParams(worldSeed);
    const along = params.orientationVertical ? worldTileY : worldTileX;
    const cross = params.orientationVertical ? worldTileX : worldTileY;
    const { center, width } = this._channelAt(params, along);
    const left = Math.round(center - width / 2);
    return cross >= left && cross < left + width;
  },

  // A bank is a dry tile that touches water on a 4-neighbour. Passable and
  // purely informational for this stage (no bank descriptors are emitted yet).
  isRiverBankTile(worldSeed, worldTileX, worldTileY) {
    if (!Number.isInteger(worldTileX) || !Number.isInteger(worldTileY)) return false;
    if (this.isWaterTile(worldSeed, worldTileX, worldTileY)) return false;
    return this.isWaterTile(worldSeed, worldTileX + 1, worldTileY)
      || this.isWaterTile(worldSeed, worldTileX - 1, worldTileY)
      || this.isWaterTile(worldSeed, worldTileX, worldTileY + 1)
      || this.isWaterTile(worldSeed, worldTileX, worldTileY - 1);
  },

  // All water tiles of a chunk as { localTileX, localTileY, worldTileX, worldTileY }.
  getRiverTilesForChunk(worldSeed, chunkX, chunkY) {
    const size = ChunkMath.CHUNK_SIZE;
    const tiles = [];
    for (let localY = 0; localY < size; localY += 1) {
      for (let localX = 0; localX < size; localX += 1) {
        const worldTileX = chunkX * size + localX;
        const worldTileY = chunkY * size + localY;
        if (this.isWaterTile(worldSeed, worldTileX, worldTileY)) {
          tiles.push({ localTileX: localX, localTileY: localY, worldTileX, worldTileY });
        }
      }
    }
    return tiles;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RiverGenerator;
}
