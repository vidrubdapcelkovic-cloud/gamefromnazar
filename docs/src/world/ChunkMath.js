const ChunkMath = Object.freeze({
  TILE_SIZE: 32,
  CHUNK_SIZE: 16,
  // Terrain must stay below Y-scaled entity depths, including negative world Y.
  CHUNK_TERRAIN_DEPTH: -1000000,

  get CHUNK_PIXEL_SIZE() {
    return this.TILE_SIZE * this.CHUNK_SIZE;
  },

  worldToTile(x, y, tileSize = this.TILE_SIZE) {
    return {
      tileX: Math.floor(x / tileSize),
      tileY: Math.floor(y / tileSize)
    };
  },

  tileToChunk(tileX, tileY, chunkSize = this.CHUNK_SIZE) {
    return {
      chunkX: Math.floor(tileX / chunkSize),
      chunkY: Math.floor(tileY / chunkSize)
    };
  },

  worldToChunk(x, y, tileSize = this.TILE_SIZE, chunkSize = this.CHUNK_SIZE) {
    const tile = this.worldToTile(x, y, tileSize);
    return this.tileToChunk(tile.tileX, tile.tileY, chunkSize);
  },

  chunkLocalToWorldTile(chunkX, chunkY, localTileX, localTileY, chunkSize = this.CHUNK_SIZE) {
    return {
      tileX: chunkX * chunkSize + localTileX,
      tileY: chunkY * chunkSize + localTileY
    };
  },

  worldTileToLocal(tileX, tileY, chunkSize = this.CHUNK_SIZE) {
    const chunk = this.tileToChunk(tileX, tileY, chunkSize);
    return {
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      localTileX: tileX - chunk.chunkX * chunkSize,
      localTileY: tileY - chunk.chunkY * chunkSize
    };
  },

  chunkKey(chunkX, chunkY) {
    return `${chunkX},${chunkY}`;
  },

  parseChunkKey(key) {
    const parts = String(key).split(',');
    if (parts.length !== 2) return null;
    const chunkX = Number(parts[0]);
    const chunkY = Number(parts[1]);
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) return null;
    return { chunkX, chunkY };
  },

  chunkOriginWorld(chunkX, chunkY, tileSize = this.TILE_SIZE, chunkSize = this.CHUNK_SIZE) {
    return {
      x: chunkX * chunkSize * tileSize,
      y: chunkY * chunkSize * tileSize
    };
  },

  localTileCenterWorld(chunkX, chunkY, localTileX, localTileY, tileSize = this.TILE_SIZE, chunkSize = this.CHUNK_SIZE) {
    const origin = this.chunkOriginWorld(chunkX, chunkY, tileSize, chunkSize);
    return {
      x: origin.x + localTileX * tileSize + tileSize / 2,
      y: origin.y + localTileY * tileSize + tileSize / 2
    };
  },

  requiredChunkKeys(centerX, centerY, activeRadius = 1) {
    const keys = [];
    for (let offsetY = -activeRadius; offsetY <= activeRadius; offsetY += 1) {
      for (let offsetX = -activeRadius; offsetX <= activeRadius; offsetX += 1) {
        keys.push(this.chunkKey(centerX + offsetX, centerY + offsetY));
      }
    }
    return keys;
  }
});