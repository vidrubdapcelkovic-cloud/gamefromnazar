class ChunkWorldGrid {
  constructor(tileSize = ChunkMath.TILE_SIZE) {
    this.tileSize = tileSize;
    this.columns = 0;
    this.rows = 0;
    this.worldWidth = 0;
    this.worldHeight = 0;
  }

  isInside(col, row) {
    return Number.isInteger(col) && Number.isInteger(row);
  }

  getTileType(col, row) {
    return this.isInside(col, row) ? 'G' : null;
  }

  isWalkable(col, row) {
    return this.isInside(col, row);
  }

  worldToCell(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      col: Math.floor(x / this.tileSize),
      row: Math.floor(y / this.tileSize)
    };
  }

  cellToWorldCenter(col, row) {
    if (!this.isInside(col, row)) return null;
    return {
      x: col * this.tileSize + this.tileSize / 2,
      y: row * this.tileSize + this.tileSize / 2
    };
  }
}

class ChunkManager {
  constructor(scene, options) {
    this.scene = scene;
    this.worldSeed = options.worldSeed;
    this.blockingGroup = options.blockingGroup;
    this.onObjectCreated = options.onObjectCreated;
    this.onObjectDestroyed = options.onObjectDestroyed;
    this.onChunkSetChanged = options.onChunkSetChanged;
    this.isResourceRemoved = typeof options.isResourceRemoved === 'function'
      ? options.isResourceRemoved
      : null;
    this.isNpcRemoved = typeof options.isNpcRemoved === 'function'
      ? options.isNpcRemoved
      : null;
    this.onNpcRemoved = typeof options.onNpcRemoved === 'function'
      ? options.onNpcRemoved
      : null;
    this.activeRadius = Number.isInteger(options.activeRadius) ? options.activeRadius : 1;
    this.chunks = new Map();
    this.centerChunkX = null;
    this.centerChunkY = null;
    this.destroyed = false;
  }

  getActiveCount() {
    return this.chunks.size;
  }

  getCenterChunk() {
    if (this.centerChunkX === null || this.centerChunkY === null) return null;
    return { chunkX: this.centerChunkX, chunkY: this.centerChunkY };
  }

  syncAround(worldX, worldY) {
    if (this.destroyed) return false;
    const chunk = ChunkMath.worldToChunk(worldX, worldY);
    if (this.centerChunkX === chunk.chunkX && this.centerChunkY === chunk.chunkY && this.chunks.size > 0) {
      return false;
    }
    this.centerChunkX = chunk.chunkX;
    this.centerChunkY = chunk.chunkY;
    this.loadWindow(chunk.chunkX, chunk.chunkY);
    return true;
  }

  loadWindow(centerX, centerY) {
    if (this.destroyed) return;

    const neededKeys = ChunkMath.requiredChunkKeys(centerX, centerY, this.activeRadius);
    const needed = new Set(neededKeys);

    // 1) Load missing chunks first so the new center is present before unload.
    neededKeys.forEach((key) => {
      if (this.chunks.has(key)) return;
      const parsed = ChunkMath.parseChunkKey(key);
      if (!parsed) return;
      const data = ChunkGenerator.generate(this.worldSeed, parsed.chunkX, parsed.chunkY);
      // Attach the deterministic village plan for this chunk (stage 2 runtime):
      // owner-chunk descriptors get sprites/bodies here; every chunk that
      // contains part of a footprint blocks those local cells for NPC wandering.
      data.village = VillageGenerator.getVillageDescriptorsForChunk(
        this.worldSeed,
        parsed.chunkX,
        parsed.chunkY
      );
      data.villageBlockedCells = VillageGenerator.getFootprintCellsForChunk(
        this.worldSeed,
        parsed.chunkX,
        parsed.chunkY
      );
      const instance = new ChunkInstance(this.scene, data, {
        blockingGroup: this.blockingGroup,
        onObjectCreated: this.onObjectCreated,
        onObjectDestroyed: this.onObjectDestroyed,
        isResourceRemoved: this.isResourceRemoved,
        isNpcRemoved: this.isNpcRemoved,
        onNpcRemoved: this.onNpcRemoved
      });
      this.chunks.set(key, instance);
    });

    // 2) Only then destroy chunks outside the required set. Never touch the player.
    Array.from(this.chunks.keys()).forEach((key) => {
      if (needed.has(key)) return;
      const instance = this.chunks.get(key);
      this.chunks.delete(key);
      if (instance) instance.destroy();
    });

    if (typeof this.onChunkSetChanged === 'function') {
      this.onChunkSetChanged();
    }
  }

  getSpawnWorldPosition() {
    const data = ChunkGenerator.generate(this.worldSeed, 0, 0);
    const spawn = data.spawnPoints[0] || { localTileX: 8, localTileY: 8 };
    const worldTile = ChunkMath.chunkLocalToWorldTile(0, 0, spawn.localTileX, spawn.localTileY);
    return {
      x: worldTile.tileX * ChunkMath.TILE_SIZE + ChunkMath.TILE_SIZE / 2,
      y: worldTile.tileY * ChunkMath.TILE_SIZE + ChunkMath.TILE_SIZE / 2
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    Array.from(this.chunks.values()).forEach((instance) => instance.destroy());
    this.chunks.clear();
    this.scene = null;
    this.blockingGroup = null;
    this.onObjectCreated = null;
    this.onObjectDestroyed = null;
    this.onChunkSetChanged = null;
    this.isResourceRemoved = null;
    this.isNpcRemoved = null;
    this.onNpcRemoved = null;
  }
}
