// Deterministic procedural villages (stage 1: pure plan + reserved mask only).
//
// A village is a purely computed plan: no Phaser sprites, textures, bodies,
// interaction, loot or SaveSystem state are produced here. Everything below is a
// pure function of the world seed, the region coordinates and this fixed
// algorithm version, so query order and chunk load order never change results.
//
// World is split into large square regions of REGION_SIZE chunks. At most one
// village per region, ~VILLAGE_CHANCE probability. The village never uses the
// TREE/ROCK/NPC RNG streams; it has its own independent stream. The start region
// (0,0) is always village-free so the spawn area stays dry, open and predictable.
//
// A fixed compact plot template (campfire centre, 3 houses, 1 warehouse, 2
// chests) is placed at a deterministically chosen, validated site and given one
// of four deterministic orientations (identity / mirror-X / mirror-Y / 180°),
// none of which swap the plot width/height. The reserved zone is the plot plus a
// 1-tile margin; ChunkGenerator rejects TREE/ROCK/berry/NPC candidates that fall
// on reserved tiles (same "reject after the draw" pattern used for river water),
// so existing RNG streams, chances and draw counts are unchanged.
const VILLAGE_ALGORITHM_VERSION = 1;

const VillageGenerator = {
  VERSION: VILLAGE_ALGORITHM_VERSION,

  // Region size in chunks. One region spans REGION_SIZE * CHUNK_SIZE world tiles.
  REGION_SIZE: 16,
  VILLAGE_CHANCE: 0.25,

  // Fixed plot content size (tiles) and reserved margin. Width 16 (14..18) and
  // height 14 (12..16) both sit inside the required ranges. Reserved zone is the
  // content rectangle expanded by MARGIN on every side.
  CONTENT_WIDTH: 16,
  CONTENT_HEIGHT: 14,
  MARGIN: 1,

  // Bounded list of deterministic candidate anchors tried in order. No infinite
  // search: if none is valid the region simply has no village.
  CANDIDATE_ATTEMPTS: 16,

  // Fixed template rectangles in content coordinates (origin top-left, x right,
  // y down). Footprints do not overlap and leave 1..2 tile passages between
  // structures. index is the per-type ordinal used in the stable id.
  _template: [
    { type: 'VILLAGE_CAMPFIRE', index: 0, x: 8, y: 7, w: 1, h: 1 },
    { type: 'VILLAGE_HOUSE', index: 0, x: 1, y: 1, w: 4, h: 3 },
    { type: 'VILLAGE_HOUSE', index: 1, x: 11, y: 1, w: 4, h: 3 },
    { type: 'VILLAGE_HOUSE', index: 2, x: 1, y: 10, w: 4, h: 3 },
    { type: 'VILLAGE_WAREHOUSE', index: 0, x: 10, y: 9, w: 4, h: 4 },
    { type: 'VILLAGE_CHEST', index: 0, x: 7, y: 10, w: 1, h: 1 },
    { type: 'VILLAGE_CHEST', index: 1, x: 7, y: 11, w: 1, h: 1 }
  ],

  _typeShort: {
    VILLAGE_CAMPFIRE: 'CAMPFIRE',
    VILLAGE_HOUSE: 'HOUSE',
    VILLAGE_WAREHOUSE: 'WAREHOUSE',
    VILLAGE_CHEST: 'CHEST'
  },

  _cache: new Map(),

  regionTileSpan() {
    return this.REGION_SIZE * ChunkMath.CHUNK_SIZE;
  },

  regionOfChunk(chunkX, chunkY) {
    return {
      regionX: Math.floor(chunkX / this.REGION_SIZE),
      regionY: Math.floor(chunkY / this.REGION_SIZE)
    };
  },

  regionOfTile(worldTileX, worldTileY) {
    const span = this.regionTileSpan();
    return {
      regionX: Math.floor(worldTileX / span),
      regionY: Math.floor(worldTileY / span)
    };
  },

  // Apply one of four dimension-preserving orientations to a content tile.
  _orient(orientation, localX, localY) {
    const w = this.CONTENT_WIDTH;
    const h = this.CONTENT_HEIGHT;
    switch (orientation) {
      case 1: return { x: w - 1 - localX, y: localY };       // mirror X
      case 2: return { x: localX, y: h - 1 - localY };       // mirror Y
      case 3: return { x: w - 1 - localX, y: h - 1 - localY }; // 180 deg
      default: return { x: localX, y: localY };              // identity
    }
  },

  // True only if the whole reserved rectangle is on dry land, clear of the river
  // and clear of the start safe zone. Bridges are not implemented yet, so there
  // is nothing to intersect there.
  _reservedRectValid(worldSeed, reservedRect) {
    for (let ty = reservedRect.minTileY; ty <= reservedRect.maxTileY; ty += 1) {
      for (let tx = reservedRect.minTileX; tx <= reservedRect.maxTileX; tx += 1) {
        if (RiverGenerator.isWaterTile(worldSeed, tx, ty)) return false;
        if (RiverGenerator.isInSafeZone(tx, ty)) return false;
      }
    }
    return true;
  },

  _buildVillage(worldSeed, regionX, regionY, orientation, originTileX, originTileY) {
    const villageId = `village_${regionX}_${regionY}`;
    const reservedRect = {
      minTileX: originTileX - this.MARGIN,
      minTileY: originTileY - this.MARGIN,
      maxTileX: originTileX + this.CONTENT_WIDTH - 1 + this.MARGIN,
      maxTileY: originTileY + this.CONTENT_HEIGHT - 1 + this.MARGIN
    };

    const descriptors = this._template.map((part) => {
      const footprint = [];
      let anchorTileX = Infinity;
      let anchorTileY = Infinity;
      for (let dy = 0; dy < part.h; dy += 1) {
        for (let dx = 0; dx < part.w; dx += 1) {
          const oriented = this._orient(orientation, part.x + dx, part.y + dy);
          const tileX = originTileX + oriented.x;
          const tileY = originTileY + oriented.y;
          footprint.push({ tileX, tileY });
          if (tileX < anchorTileX) anchorTileX = tileX;
          if (tileY < anchorTileY) anchorTileY = tileY;
        }
      }
      footprint.sort((a, b) => (a.tileY - b.tileY) || (a.tileX - b.tileX));
      const anchor = { tileX: anchorTileX, tileY: anchorTileY };
      const ownerChunk = ChunkMath.tileToChunk(anchor.tileX, anchor.tileY);
      return {
        villageId,
        type: part.type,
        index: part.index,
        anchor,
        footprint,
        orientation,
        id: `${villageId}_${this._typeShort[part.type]}_${part.index}`,
        ownerChunk: { chunkX: ownerChunk.chunkX, chunkY: ownerChunk.chunkY }
      };
    });

    return {
      villageId,
      regionX,
      regionY,
      orientation,
      version: this.VERSION,
      plotOrigin: { tileX: originTileX, tileY: originTileY },
      contentWidth: this.CONTENT_WIDTH,
      contentHeight: this.CONTENT_HEIGHT,
      reservedRect,
      descriptors
    };
  },

  // At most one village per region; deterministic and cached per seed+region.
  getVillageForRegion(worldSeed, regionX, regionY) {
    const key = `${typeof worldSeed}:${worldSeed}:${regionX}:${regionY}`;
    if (this._cache.has(key)) return this._cache.get(key);

    // Start region stays village-free: guarantees a dry, open, predictable start.
    if (regionX === 0 && regionY === 0) {
      this._cache.set(key, null);
      return null;
    }

    const rng = SeededRandom.fromParts(worldSeed, regionX, regionY, `village-region-v${this.VERSION}`);
    if (rng.next() >= this.VILLAGE_CHANCE) {
      this._cache.set(key, null);
      return null;
    }

    const orientation = rng.nextInt(0, 4);
    const span = this.regionTileSpan();
    const regionMinTileX = regionX * span;
    const regionMinTileY = regionY * span;
    // Keep the reserved rect strictly inside the region interior with a >=1 tile
    // gap to every region border, so villages of adjacent regions never touch.
    const minOriginX = regionMinTileX + this.MARGIN + 1;
    const minOriginY = regionMinTileY + this.MARGIN + 1;
    const maxOriginX = regionMinTileX + span - 1 - (this.CONTENT_WIDTH - 1) - this.MARGIN - 1;
    const maxOriginY = regionMinTileY + span - 1 - (this.CONTENT_HEIGHT - 1) - this.MARGIN - 1;
    const spanX = maxOriginX - minOriginX + 1;
    const spanY = maxOriginY - minOriginY + 1;

    let village = null;
    for (let attempt = 0; attempt < this.CANDIDATE_ATTEMPTS; attempt += 1) {
      const originTileX = minOriginX + rng.nextInt(0, spanX);
      const originTileY = minOriginY + rng.nextInt(0, spanY);
      const reservedRect = {
        minTileX: originTileX - this.MARGIN,
        minTileY: originTileY - this.MARGIN,
        maxTileX: originTileX + this.CONTENT_WIDTH - 1 + this.MARGIN,
        maxTileY: originTileY + this.CONTENT_HEIGHT - 1 + this.MARGIN
      };
      if (this._reservedRectValid(worldSeed, reservedRect)) {
        village = this._buildVillage(worldSeed, regionX, regionY, orientation, originTileX, originTileY);
        break;
      }
    }

    this._cache.set(key, village);
    return village;
  },

  findVillageAtTile(worldSeed, worldTileX, worldTileY) {
    if (!Number.isInteger(worldTileX) || !Number.isInteger(worldTileY)) return null;
    const { regionX, regionY } = this.regionOfTile(worldTileX, worldTileY);
    const village = this.getVillageForRegion(worldSeed, regionX, regionY);
    if (!village) return null;
    const r = village.reservedRect;
    if (worldTileX >= r.minTileX && worldTileX <= r.maxTileX
      && worldTileY >= r.minTileY && worldTileY <= r.maxTileY) {
      return village;
    }
    return null;
  },

  isReservedTile(worldSeed, worldTileX, worldTileY) {
    return this.findVillageAtTile(worldSeed, worldTileX, worldTileY) !== null;
  },

  // Descriptors whose stable owner chunk is exactly (chunkX, chunkY). The whole
  // plot lives inside a single region interior, so only that region's village can
  // own descriptors in this chunk. Runtime ownership (stage 2) uses this.
  getVillageDescriptorsForChunk(worldSeed, chunkX, chunkY) {
    const { regionX, regionY } = this.regionOfChunk(chunkX, chunkY);
    const village = this.getVillageForRegion(worldSeed, regionX, regionY);
    if (!village) return [];
    return village.descriptors.filter(
      (d) => d.ownerChunk.chunkX === chunkX && d.ownerChunk.chunkY === chunkY
    );
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VillageGenerator;
}
