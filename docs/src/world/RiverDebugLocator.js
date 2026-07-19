// TEMPORARY river debug locator (removed before the passable-water stage is
// committed).
//
// Pure helper (no Phaser) that reuses the real production world functions to find
// the nearest river to a world position and a safe dry shore tile next to it. It
// never copies the river algorithm and never reads sprites/textures; water is
// decided only by RiverGenerator.isWaterTile, obstacles by ChunkGenerator and
// village footprints by VillageGenerator. Nothing here mutates game state.
const RiverDebugLocator = {
  DEFAULT_LIMIT_TILES: 256,
  RETRY_LIMIT_TILES: 1024,
  MAX_SHORE_DISTANCE: 3,

  // 8-way arrow from a delta measured in screen space (dy positive is down).
  directionArrow(dx, dy) {
    if (dx === 0 && dy === 0) return '•';
    const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const dirs = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    return dirs[Math.round(deg / 45) % 8];
  },

  // Cheap distance/direction from a world position to a known tile (no search).
  describeToTile(worldX, worldY, tile) {
    const tileSize = ChunkMath.TILE_SIZE;
    const chunkPixel = ChunkMath.CHUNK_PIXEL_SIZE;
    const cx = tile.tileX * tileSize + tileSize / 2;
    const cy = tile.tileY * tileSize + tileSize / 2;
    const dx = cx - worldX;
    const dy = cy - worldY;
    return {
      distanceChunks: Math.round(Math.hypot(dx, dy) / chunkPixel),
      direction: this.directionArrow(dx, dy)
    };
  },

  _scan(seed, playerTileX, playerTileY, limit, worldX, worldY) {
    const tileSize = ChunkMath.TILE_SIZE;
    const consider = (tileX, tileY) => {
      if (!RiverGenerator.isWaterTile(seed, tileX, tileY)) return null;
      const cx = tileX * tileSize + tileSize / 2;
      const cy = tileY * tileSize + tileSize / 2;
      const dx = cx - worldX;
      const dy = cy - worldY;
      const distanceTiles = Math.max(Math.abs(tileX - playerTileX), Math.abs(tileY - playerTileY));
      return {
        tileX,
        tileY,
        worldX: cx,
        worldY: cy,
        distanceTiles,
        distanceChunks: Math.round(distanceTiles / ChunkMath.CHUNK_SIZE),
        direction: this.directionArrow(dx, dy)
      };
    };
    for (let r = 0; r <= limit; r += 1) {
      if (r === 0) {
        const hit = consider(playerTileX, playerTileY);
        if (hit) return hit;
        continue;
      }
      // Deterministic ring order: top & bottom rows, then left & right columns.
      for (let dx = -r; dx <= r; dx += 1) {
        const top = consider(playerTileX + dx, playerTileY - r);
        if (top) return top;
        const bottom = consider(playerTileX + dx, playerTileY + r);
        if (bottom) return bottom;
      }
      for (let dy = -r + 1; dy <= r - 1; dy += 1) {
        const left = consider(playerTileX - r, playerTileY + dy);
        if (left) return left;
        const right = consider(playerTileX + r, playerTileY + dy);
        if (right) return right;
      }
    }
    return null;
  },

  // Nearest river tile to (startWorldX, startWorldY) by expanding concentric tile
  // rings. Deterministic; supports negative coordinates; bounded by `limit`
  // (default 256). If nothing is found and retry is allowed, one wider pass at
  // 1024 tiles is attempted. Returns a result object or null.
  findNearestRiver(seed, startWorldX, startWorldY, options) {
    const opts = options || {};
    if (!Number.isFinite(startWorldX) || !Number.isFinite(startWorldY)) return null;
    const limit = Number.isInteger(opts.limit) && opts.limit >= 0
      ? opts.limit
      : this.DEFAULT_LIMIT_TILES;
    const playerTile = ChunkMath.worldToTile(startWorldX, startWorldY);
    let result = this._scan(seed, playerTile.tileX, playerTile.tileY, limit, startWorldX, startWorldY);
    if (!result && !opts.noRetry && limit < this.RETRY_LIMIT_TILES) {
      result = this._scan(seed, playerTile.tileX, playerTile.tileY, this.RETRY_LIMIT_TILES, startWorldX, startWorldY);
    }
    return result;
  },

  _isVillageFootprintTile(seed, tileX, tileY) {
    const { regionX, regionY } = VillageGenerator.regionOfTile(tileX, tileY);
    const village = VillageGenerator.getVillageForRegion(seed, regionX, regionY);
    if (!village) return false;
    return village.descriptors.some((d) => d.footprint.some((t) => t.tileX === tileX && t.tileY === tileY));
  },

  _hasObstacleObject(seed, tileX, tileY, chunkCache) {
    const { chunkX, chunkY, localTileX, localTileY } = ChunkMath.worldTileToLocal(tileX, tileY);
    const key = `${chunkX},${chunkY}`;
    let chunk = chunkCache.get(key);
    if (!chunk) {
      chunk = ChunkGenerator.generate(seed, chunkX, chunkY);
      chunkCache.set(key, chunk);
    }
    const objects = Array.isArray(chunk.objects) ? chunk.objects : [];
    // TREE/ROCK block; a berry bush is a resource we also avoid landing on.
    return objects.some((o) => o.localTileX === localTileX && o.localTileY === localTileY
      && (o.type === 'TREE' || o.type === 'ROCK' || o.type === 'BERRY_BUSH'));
  },

  _hasCardinalWater(seed, tileX, tileY) {
    return RiverGenerator.isWaterTile(seed, tileX + 1, tileY)
      || RiverGenerator.isWaterTile(seed, tileX - 1, tileY)
      || RiverGenerator.isWaterTile(seed, tileX, tileY + 1)
      || RiverGenerator.isWaterTile(seed, tileX, tileY - 1);
  },

  // A dry tile 1..MAX_SHORE_DISTANCE tiles (Chebyshev) from the water tile, that
  // has a straight (cardinal) water neighbour so the player can walk into the
  // river, and is clear of water, TREE/ROCK/berry and village footprints. Returns
  // { tileX, tileY, worldX, worldY } or null.
  findSafeShore(seed, waterTile, options) {
    if (!waterTile || !Number.isInteger(waterTile.tileX) || !Number.isInteger(waterTile.tileY)) return null;
    const opts = options || {};
    const maxDistance = Number.isInteger(opts.maxShoreDistance) && opts.maxShoreDistance >= 1
      ? opts.maxShoreDistance
      : this.MAX_SHORE_DISTANCE;
    const tileSize = ChunkMath.TILE_SIZE;
    const chunkCache = new Map();

    const evaluate = (tileX, tileY) => {
      if (RiverGenerator.isWaterTile(seed, tileX, tileY)) return null;      // must be dry
      if (!this._hasCardinalWater(seed, tileX, tileY)) return null;         // straight entry
      if (this._hasObstacleObject(seed, tileX, tileY, chunkCache)) return null;
      if (this._isVillageFootprintTile(seed, tileX, tileY)) return null;
      return {
        tileX,
        tileY,
        worldX: tileX * tileSize + tileSize / 2,
        worldY: tileY * tileSize + tileSize / 2
      };
    };

    for (let r = 1; r <= maxDistance; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const top = evaluate(waterTile.tileX + dx, waterTile.tileY - r);
        if (top) return top;
        const bottom = evaluate(waterTile.tileX + dx, waterTile.tileY + r);
        if (bottom) return bottom;
      }
      for (let dy = -r + 1; dy <= r - 1; dy += 1) {
        const left = evaluate(waterTile.tileX - r, waterTile.tileY + dy);
        if (left) return left;
        const right = evaluate(waterTile.tileX + r, waterTile.tileY + dy);
        if (right) return right;
      }
    }
    return null;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RiverDebugLocator;
}
