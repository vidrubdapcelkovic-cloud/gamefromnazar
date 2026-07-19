// Runtime-only projectile constants (BOWMAN arrows). Uniquely prefixed to avoid
// collisions when concatenated with the other world scripts.
const BOWMAN_ARROW_TEXTURE_KEY = 'bowman-arrow-texture';
const BOWMAN_ARROW_HIT_HALF = 6;
const BOWMAN_ARROW_BOUNDS_MARGIN = 48;
const BOWMAN_PLAYER_HIT_HALF_DEFAULT = 14;
const BOWMAN_OBSTACLE_HALF = Object.freeze({
  ROCK: { x: 14, y: 12 },
  TREE: { x: 12, y: 16 }
});

// Static procedural river tile. One texture is shared by every water sprite.
const RIVER_WATER_TEXTURE_KEY = 'river-water-texture';

// Static procedural village textures (created once). Keys are distinct from the
// player-build 'temporary-campfire'/'temporary-chest' textures on purpose.
// Houses and the warehouse have one texture variant per facade direction so the
// door can face the village centre without rotating the footprint/body.
const VILLAGE_FACINGS = Object.freeze(['NORTH', 'EAST', 'SOUTH', 'WEST']);
const VILLAGE_HOUSE_TEXTURE_KEYS = Object.freeze({
  NORTH: 'village-house-north-texture',
  EAST: 'village-house-east-texture',
  SOUTH: 'village-house-south-texture',
  WEST: 'village-house-west-texture'
});
const VILLAGE_WAREHOUSE_TEXTURE_KEYS = Object.freeze({
  NORTH: 'village-warehouse-north-texture',
  EAST: 'village-warehouse-east-texture',
  SOUTH: 'village-warehouse-south-texture',
  WEST: 'village-warehouse-west-texture'
});
const VILLAGE_CAMPFIRE_TEXTURE_KEY = 'village-campfire-texture';
const VILLAGE_CHEST_CLOSED_TEXTURE_KEY = 'village-chest-closed-texture';

// Runtime spec per village descriptor type. Texture pixel size equals the
// footprint (tilesW/tilesH * TILE_SIZE) so the visual matches stage-1 footprints
// exactly. Houses/warehouse block their whole footprint; campfire/chest keep a
// small blocker inside their single cell. None of them deal damage.
const VILLAGE_RUNTIME_SPEC = Object.freeze({
  VILLAGE_HOUSE: { tilesW: 4, tilesH: 3, fullFootprintBody: true },
  VILLAGE_WAREHOUSE: { tilesW: 4, tilesH: 4, fullFootprintBody: true },
  VILLAGE_CAMPFIRE: {
    tilesW: 1, tilesH: 1,
    body: { width: 18, height: 14, offsetX: 7, offsetY: 14 }
  },
  VILLAGE_CHEST: {
    tilesW: 1, tilesH: 1,
    body: { width: 22, height: 18, offsetX: 5, offsetY: 10 }
  }
});

// Resolve the texture key for a descriptor. Houses/warehouse pick the directional
// facade variant (SOUTH fallback); campfire/chest are direction-agnostic.
function resolveVillageTextureKey(type, facing) {
  const dir = VILLAGE_HOUSE_TEXTURE_KEYS[facing] ? facing : 'SOUTH';
  if (type === 'VILLAGE_HOUSE') return VILLAGE_HOUSE_TEXTURE_KEYS[dir];
  if (type === 'VILLAGE_WAREHOUSE') return VILLAGE_WAREHOUSE_TEXTURE_KEYS[dir];
  if (type === 'VILLAGE_CAMPFIRE') return VILLAGE_CAMPFIRE_TEXTURE_KEY;
  if (type === 'VILLAGE_CHEST') return VILLAGE_CHEST_CLOSED_TEXTURE_KEY;
  return null;
}

class ChunkInstance {
  constructor(scene, chunkData, options) {
    this.scene = scene;
    this.chunkX = chunkData.chunkX;
    this.chunkY = chunkData.chunkY;
    this.key = ChunkMath.chunkKey(this.chunkX, this.chunkY);
    this.blockingGroup = options.blockingGroup;
    this.onObjectCreated = options.onObjectCreated;
    this.onObjectDestroyed = options.onObjectDestroyed;
    this.isResourceRemoved = options.isResourceRemoved;
    this.isNpcRemoved = options.isNpcRemoved;
    this.onNpcRemoved = options.onNpcRemoved;
    this.destroyed = false;
    this.ground = null;
    this.ownedObjectIds = [];
    this.npcObjects = [];
    this.npcIds = new Set();
    this.hostileControllers = [];
    this.npcBlockedCells = new Set();
    // Active BOWMAN arrows live only here (runtime-only, never serialised).
    this.projectiles = [];
    // Static water sprites (passive visuals, non-blocking), created and
    // destroyed with the chunk.
    this.waterSprites = [];
    // Static village sprites/blockers owned by this chunk (runtime-only).
    this.villageObjects = [];
    this.obstacleRects = this.buildObstacleRects(chunkData);
    this.createGround(chunkData);
    this.createObjects(chunkData);
    this.createWater(chunkData);
    this.createVillage(chunkData);
    this.createNpcs(chunkData);
  }

  resolveNpcConfig(type) {
    const passive = getPassiveNpcConfig(type);
    if (passive) return { kind: 'passive', config: passive };
    const hostile = getHostileNpcConfig(type);
    if (hostile) return { kind: 'hostile', config: hostile };
    return null;
  }

  buildStableNpcId(type, index) {
    if (isHostileNpcType(type)) {
      return buildChunkEnemyId(this.chunkX, this.chunkY, type, index);
    }
    return buildChunkNpcId(this.chunkX, this.chunkY, type, index);
  }

  createGround(chunkData) {
    const tileSize = ChunkMath.TILE_SIZE;
    const chunkSize = ChunkMath.CHUNK_SIZE;
    const origin = ChunkMath.chunkOriginWorld(this.chunkX, this.chunkY);
    // Keep terrain far below Y-sorted world entities (negative world Y yields negative depth).
    const graphics = this.scene.add.graphics().setDepth(ChunkMath.CHUNK_TERRAIN_DEPTH);

    for (let localY = 0; localY < chunkSize; localY += 1) {
      for (let localX = 0; localX < chunkSize; localX += 1) {
        const x = origin.x + localX * tileSize;
        const y = origin.y + localY * tileSize;
        const shade = ((localX + localY) % 2 === 0) ? 0x527a45 : 0x4f7542;
        graphics.fillStyle(shade, 1);
        graphics.fillRect(x, y, tileSize, tileSize);
        graphics.fillStyle(0x668d55, 1);
        graphics.fillRect(x + 5, y + 7, 3, 3);
        graphics.fillRect(x + 22, y + 19, 3, 3);
        graphics.fillStyle(0x416a3b, 1);
        graphics.fillRect(x + 14, y + 25, 2, 4);
      }
    }

    this.ground = graphics;
  }

  createObjects(chunkData) {
    chunkData.objects.forEach((objectData) => {
      const id = buildChunkResourceId(
        this.chunkX,
        this.chunkY,
        objectData.type,
        objectData.localTileX,
        objectData.localTileY
      );
      if (typeof this.isResourceRemoved === 'function' && this.isResourceRemoved(id)) {
        return;
      }
      const worldTile = ChunkMath.chunkLocalToWorldTile(
        this.chunkX,
        this.chunkY,
        objectData.localTileX,
        objectData.localTileY
      );
      const position = ChunkMath.localTileCenterWorld(
        this.chunkX,
        this.chunkY,
        objectData.localTileX,
        objectData.localTileY
      );
      const textureKey = {
        TREE: 'temporary-tree',
        ROCK: 'temporary-rock',
        BERRY_BUSH: 'temporary-berry-bush'
      }[objectData.type] || 'temporary-rock';
      let gameObject;
      let blockerObject = null;
      let interactionX = position.x;
      let interactionY = position.y;

      if (objectData.type === 'ROCK') {
        gameObject = this.blockingGroup.create(position.x, position.y, textureKey);
        gameObject.body.setSize(24, 18);
        gameObject.body.setOffset(4, 14);
        gameObject.refreshBody();
        blockerObject = gameObject;
      } else if (objectData.type === 'BERRY_BUSH') {
        // Berry bush is a harvestable, non-blocking resource: a plain image with
        // no collision blocker, interacted with at its centre.
        gameObject = this.scene.add.image(position.x, position.y, textureKey);
      } else {
        gameObject = this.scene.add.image(position.x, position.y, textureKey);
        const treeBounds = gameObject.getBounds();
        const blocker = this.blockingGroup.create(
          treeBounds.centerX,
          treeBounds.bottom - 8,
          'temporary-tree-blocker'
        );
        blocker.setVisible(false);
        blocker.setDataEnabled();
        blocker.setData('ownerId', id);
        blocker.setData('type', objectData.type);
        blocker.setData('col', worldTile.tileX);
        blocker.setData('row', worldTile.tileY);
        blockerObject = blocker;
        interactionX = blocker.x;
        interactionY = blocker.y;
      }

      gameObject.setDataEnabled();
      gameObject.setData('id', id);
      gameObject.setData('type', objectData.type);
      gameObject.setData('col', worldTile.tileX);
      gameObject.setData('row', worldTile.tileY);
      gameObject.setData('chunkKey', this.key);
      if (blockerObject && blockerObject !== gameObject) {
        blockerObject.setData('chunkKey', this.key);
      }
      if (typeof this.scene.updateWorldDepth === 'function') {
        this.scene.updateWorldDepth(gameObject);
      } else {
        gameObject.setDepth((position.y + gameObject.displayHeight / 2) * 0.1);
      }

      const interactionTarget = {
        id,
        type: objectData.type,
        col: worldTile.tileX,
        row: worldTile.tileY,
        interactionX,
        interactionY,
        visualObject: gameObject
      };

      const runtimeObject = {
        id,
        type: objectData.type,
        col: worldTile.tileX,
        row: worldTile.tileY,
        active: true,
        visualObject: gameObject,
        blockerObject,
        interactionTarget,
        chunkKey: this.key
      };

      this.ownedObjectIds.push(id);
      if (typeof this.onObjectCreated === 'function') {
        this.onObjectCreated(runtimeObject);
      }
    });
  }

  ensureWaterTexture() {
    if (!this.scene || !this.scene.textures) return;
    if (typeof this.scene.textures.exists === 'function'
      && this.scene.textures.exists(RIVER_WATER_TEXTURE_KEY)) {
      return;
    }
    if (!this.scene.make || typeof this.scene.make.graphics !== 'function') return;
    const tileSize = ChunkMath.TILE_SIZE;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    // Calm water base plus a few static ripples. Deterministic, tile-sized.
    graphics.fillStyle(0x2f6f9f, 1);
    graphics.fillRect(0, 0, tileSize, tileSize);
    graphics.fillStyle(0x3f86bb, 1);
    graphics.fillRect(2, 6, 12, 2);
    graphics.fillRect(18, 14, 11, 2);
    graphics.fillRect(6, 22, 14, 2);
    graphics.fillStyle(0x276089, 1);
    graphics.fillRect(10, 12, 10, 1);
    graphics.fillRect(4, 26, 12, 1);
    graphics.generateTexture(RIVER_WATER_TEXTURE_KEY, tileSize, tileSize);
    graphics.destroy();
  }

  createWater(chunkData) {
    if (this.destroyed) return;
    const water = Array.isArray(chunkData && chunkData.water) ? chunkData.water : [];
    if (!water.length) return;
    this.ensureWaterTexture();
    water.forEach((tile) => {
      if (!tile || !Number.isInteger(tile.localTileX) || !Number.isInteger(tile.localTileY)) return;
      const center = ChunkMath.localTileCenterWorld(
        this.chunkX,
        this.chunkY,
        tile.localTileX,
        tile.localTileY
      );
      // Water is a passive visual: a plain image with NO physics body, so it is
      // never part of the player blocking group and the player can wade across
      // the river (the slow-down is applied in the movement controller). NPCs
      // still treat water as impassable via npcBlockedCells (grid-based).
      let sprite = null;
      if (this.scene && this.scene.add && typeof this.scene.add.image === 'function') {
        sprite = this.scene.add.image(center.x, center.y, RIVER_WATER_TEXTURE_KEY);
      }
      if (!sprite) return;

      // Keep water above the grass terrain but below every Y-sorted entity.
      if (typeof sprite.setDepth === 'function') {
        sprite.setDepth(ChunkMath.CHUNK_TERRAIN_DEPTH + 1);
      }
      if (typeof sprite.setDataEnabled === 'function') sprite.setDataEnabled();
      if (typeof sprite.setData === 'function') {
        sprite.setData('type', 'RIVER_WATER');
        sprite.setData(
          'id',
          typeof tile.id === 'string'
            ? tile.id
            : `chunk_${this.chunkX}_${this.chunkY}_RIVER_WATER_${tile.localTileX}_${tile.localTileY}`
        );
        sprite.setData('chunkKey', this.key);
      }
      this.waterSprites.push(sprite);
    });
  }

  clearWater() {
    this.waterSprites.slice().forEach((sprite) => {
      if (sprite && !sprite.destroyed && typeof sprite.destroy === 'function') {
        sprite.destroy();
      }
    });
    this.waterSprites = [];
  }

  ensureVillageTexture(textureKey, draw) {
    if (!this.scene || !this.scene.textures) return;
    if (typeof this.scene.textures.exists === 'function' && this.scene.textures.exists(textureKey)) {
      return;
    }
    if (!this.scene.make || typeof this.scene.make.graphics !== 'function') return;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    draw(graphics);
    graphics.destroy();
  }

  // Draw a door (and a small threshold) on the given wall of a body rectangle.
  // The roof/front stay upright for every facing; only the door position moves.
  drawVillageDoor(g, facing, bodyX, bodyY, bodyW, bodyH, doorColor, thresholdColor) {
    g.fillStyle(doorColor, 1);
    if (facing === 'NORTH') {
      const dw = Math.min(24, bodyW - 8);
      g.fillRect(bodyX + (bodyW - dw) / 2, bodyY + 2, dw, Math.min(22, bodyH - 4));
    } else if (facing === 'SOUTH') {
      const dw = Math.min(24, bodyW - 8);
      const dh = Math.min(26, bodyH - 4);
      g.fillRect(bodyX + (bodyW - dw) / 2, bodyY + bodyH - dh, dw, dh);
    } else if (facing === 'WEST') {
      const dh = Math.min(24, bodyH - 8);
      g.fillRect(bodyX + 1, bodyY + (bodyH - dh) / 2, Math.min(18, bodyW - 4), dh);
    } else { // EAST
      const dh = Math.min(24, bodyH - 8);
      const dw = Math.min(18, bodyW - 4);
      g.fillRect(bodyX + bodyW - 1 - dw, bodyY + (bodyH - dh) / 2, dw, dh);
    }
    if (thresholdColor !== undefined) {
      g.fillStyle(thresholdColor, 1);
    }
  }

  drawVillageHouse(g, facing, key) {
    const tileSize = ChunkMath.TILE_SIZE;
    const w = 4 * tileSize;
    const h = 3 * tileSize;
    const roofH = Math.round(h * 0.42);
    // Wooden body.
    g.fillStyle(0x8a5a33, 1);
    g.fillRect(6, roofH, w - 12, h - roofH);
    g.fillStyle(0x6f4423, 1);
    g.fillRect(6, roofH, w - 12, 4);
    // Pitched roof (always upright, never mirrored vertically).
    g.fillStyle(0x7a3b2a, 1);
    g.fillTriangle(0, roofH + 2, w / 2, 4, w, roofH + 2);
    g.fillStyle(0x5c2c1f, 1);
    g.fillTriangle(w / 2, 12, w - 10, roofH, 10, roofH);
    // Door on the facing wall of the body.
    this.drawVillageDoor(g, facing, 6, roofH, w - 12, h - roofH, 0x3a2415);
    g.generateTexture(key, w, h);
  }

  drawVillageWarehouse(g, facing, key) {
    const tileSize = ChunkMath.TILE_SIZE;
    const w = 4 * tileSize;
    const h = 4 * tileSize;
    const roofH = Math.round(h * 0.28);
    // Greyer, larger body.
    g.fillStyle(0x6d6f73, 1);
    g.fillRect(4, roofH, w - 8, h - roofH);
    g.fillStyle(0x4f5155, 1);
    g.fillRect(4, roofH, w - 8, 6);
    // Low roof band (upright).
    g.fillStyle(0x565860, 1);
    g.fillRect(0, roofH - 10, w, 12);
    // Windows on the upper corners for a distinct warehouse look.
    g.fillStyle(0x8f9196, 1);
    g.fillRect(12, roofH + 12, 10, 10);
    g.fillRect(w - 22, roofH + 12, 10, 10);
    // Wide door on the facing wall.
    const bodyX = 4;
    const bodyY = roofH;
    const bodyW = w - 8;
    const bodyH = h - roofH;
    g.fillStyle(0x3c2f22, 1);
    if (facing === 'NORTH') {
      g.fillRect(bodyX + (bodyW - 56) / 2, bodyY + 2, 56, 40);
    } else if (facing === 'SOUTH') {
      g.fillRect(bodyX + (bodyW - 56) / 2, bodyY + bodyH - 52, 56, 52);
    } else if (facing === 'WEST') {
      g.fillRect(bodyX + 1, bodyY + (bodyH - 56) / 2, 40, 56);
    } else { // EAST
      g.fillRect(bodyX + bodyW - 1 - 40, bodyY + (bodyH - 56) / 2, 40, 56);
    }
    g.generateTexture(key, w, h);
  }

  ensureVillageTextures() {
    const tileSize = ChunkMath.TILE_SIZE;

    // One house and one warehouse texture per facade direction (created once).
    VILLAGE_FACINGS.forEach((facing) => {
      const houseKey = VILLAGE_HOUSE_TEXTURE_KEYS[facing];
      this.ensureVillageTexture(houseKey, (g) => this.drawVillageHouse(g, facing, houseKey));
      const warehouseKey = VILLAGE_WAREHOUSE_TEXTURE_KEYS[facing];
      this.ensureVillageTexture(warehouseKey, (g) => this.drawVillageWarehouse(g, facing, warehouseKey));
    });

    // Campfire: ring of stones with a static flame. No animation/light/timers.
    this.ensureVillageTexture(VILLAGE_CAMPFIRE_TEXTURE_KEY, (g) => {
      const s = tileSize;
      g.fillStyle(0x6b6b6b, 1);
      g.fillCircle(6, 24, 4);
      g.fillCircle(16, 27, 4);
      g.fillCircle(26, 24, 4);
      g.fillCircle(10, 20, 3);
      g.fillCircle(22, 20, 3);
      g.fillStyle(0x8a5a2b, 1);
      g.fillRect(9, 21, 14, 3);
      g.fillStyle(0xd8531f, 1);
      g.fillTriangle(16, 6, 23, 22, 9, 22);
      g.fillStyle(0xf29a2e, 1);
      g.fillTriangle(16, 12, 20, 22, 12, 22);
      g.fillStyle(0xffd85e, 1);
      g.fillTriangle(16, 17, 18, 22, 14, 22);
      g.generateTexture(VILLAGE_CAMPFIRE_TEXTURE_KEY, s, s);
    });

    // Closed chest: wooden box with metal bands and a lock. Distinct from ROCK.
    this.ensureVillageTexture(VILLAGE_CHEST_CLOSED_TEXTURE_KEY, (g) => {
      const s = tileSize;
      g.fillStyle(0x7a4a24, 1);
      g.fillRect(4, 12, 24, 16);
      g.fillStyle(0x8f5a2c, 1);
      g.fillRect(4, 8, 24, 8);
      g.fillStyle(0x4a2c15, 1);
      g.fillRect(4, 15, 24, 2);
      g.fillStyle(0x3a2413, 1);
      g.fillRect(9, 8, 3, 20);
      g.fillRect(20, 8, 3, 20);
      g.fillStyle(0xe0c15a, 1);
      g.fillRect(14, 15, 4, 6);
      g.generateTexture(VILLAGE_CHEST_CLOSED_TEXTURE_KEY, s, s);
    });
  }

  createVillage(chunkData) {
    if (this.destroyed) return;
    const descriptors = Array.isArray(chunkData && chunkData.village) ? chunkData.village : [];
    if (!descriptors.length) return;
    this.ensureVillageTextures();
    const tileSize = ChunkMath.TILE_SIZE;

    descriptors.forEach((descriptor) => {
      if (!descriptor || !VILLAGE_RUNTIME_SPEC[descriptor.type]) return;
      const footprint = Array.isArray(descriptor.footprint) ? descriptor.footprint : [];
      if (!footprint.length) return;
      const spec = VILLAGE_RUNTIME_SPEC[descriptor.type];

      // World-tile bounding box of the (already oriented) footprint. The visual is
      // centred over the footprint so it lines up with the reserved stage-1 cells.
      let minTileX = Infinity;
      let minTileY = Infinity;
      let maxTileX = -Infinity;
      let maxTileY = -Infinity;
      footprint.forEach((t) => {
        if (t.tileX < minTileX) minTileX = t.tileX;
        if (t.tileY < minTileY) minTileY = t.tileY;
        if (t.tileX > maxTileX) maxTileX = t.tileX;
        if (t.tileY > maxTileY) maxTileY = t.tileY;
      });
      const widthTiles = maxTileX - minTileX + 1;
      const heightTiles = maxTileY - minTileY + 1;
      const centerX = minTileX * tileSize + (widthTiles * tileSize) / 2;
      const centerY = minTileY * tileSize + (heightTiles * tileSize) / 2;

      // Facade direction comes from the descriptor (VillageGenerator decides it).
      // The runtime only picks the matching directional texture; it never mirrors
      // or rotates the sprite, so the footprint/body/position stay identical.
      const facing = descriptor.facing;
      const textureKey = resolveVillageTextureKey(descriptor.type, facing);
      if (!textureKey) return;

      let sprite = null;
      if (this.blockingGroup && typeof this.blockingGroup.create === 'function') {
        sprite = this.blockingGroup.create(centerX, centerY, textureKey);
      } else if (this.scene && this.scene.add && typeof this.scene.add.image === 'function') {
        sprite = this.scene.add.image(centerX, centerY, textureKey);
      }
      if (!sprite) return;

      if (sprite.body) {
        if (spec.fullFootprintBody) {
          if (typeof sprite.body.setSize === 'function') {
            sprite.body.setSize(widthTiles * tileSize, heightTiles * tileSize);
          }
          if (typeof sprite.body.setOffset === 'function') sprite.body.setOffset(0, 0);
        } else if (spec.body) {
          if (typeof sprite.body.setSize === 'function') {
            sprite.body.setSize(spec.body.width, spec.body.height);
          }
          if (typeof sprite.body.setOffset === 'function') {
            sprite.body.setOffset(spec.body.offsetX, spec.body.offsetY);
          }
        }
        if (typeof sprite.refreshBody === 'function') sprite.refreshBody();
      }

      if (this.scene && typeof this.scene.updateWorldDepth === 'function') {
        this.scene.updateWorldDepth(sprite);
      } else if (typeof sprite.setDepth === 'function') {
        const displayHeight = Number.isFinite(sprite.displayHeight) ? sprite.displayHeight : 0;
        sprite.setDepth((centerY + displayHeight / 2) * 0.1);
      }

      if (typeof sprite.setDataEnabled === 'function') sprite.setDataEnabled();
      if (typeof sprite.setData === 'function') {
        sprite.setData('id', descriptor.id);
        sprite.setData('type', descriptor.type);
        sprite.setData('villageId', descriptor.villageId);
        sprite.setData('facing', facing || null);
        sprite.setData('chunkKey', this.key);
      }

      this.villageObjects.push({
        id: descriptor.id,
        type: descriptor.type,
        villageId: descriptor.villageId,
        facing: facing || null,
        textureKey,
        sprite,
        centerX,
        centerY
      });
    });
  }

  clearVillage() {
    this.villageObjects.slice().forEach((entry) => {
      const sprite = entry && entry.sprite;
      if (sprite && !sprite.destroyed && typeof sprite.destroy === 'function') {
        sprite.destroy();
      }
      if (entry) entry.sprite = null;
    });
    this.villageObjects = [];
  }

  ensureRabbitPlaceholderTexture() {
    const textureKey = 'rabbit-placeholder';
    if (!this.scene || !this.scene.textures || this.scene.textures.exists(textureKey)) return;
    if (!this.scene.make || typeof this.scene.make.graphics !== 'function') return;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(0xd9c3a4, 1);
    graphics.fillEllipse(14, 18, 20, 14);
    graphics.fillStyle(0xc9b08a, 1);
    graphics.fillEllipse(22, 16, 10, 8);
    graphics.fillStyle(0xb8926c, 1);
    graphics.fillEllipse(8, 6, 5, 12);
    graphics.fillEllipse(14, 5, 5, 13);
    graphics.fillStyle(0x2b2118, 1);
    graphics.fillCircle(24, 14, 1.5);
    graphics.fillStyle(0xe8d8c4, 1);
    graphics.fillCircle(4, 20, 3);
    graphics.generateTexture(textureKey, 28, 28);
    graphics.destroy();
  }

  ensureSlimeTexture() {
    // Same procedural 32x32 blob as GameScene.createWorldObjectTextures. Guarded
    // by exists() so it is generated exactly once regardless of which side (scene
    // preload or first chunk) reaches it first, and never per-instance.
    const textureKey = 'temporary-slime';
    if (!this.scene || !this.scene.textures || this.scene.textures.exists(textureKey)) return;
    if (!this.scene.make || typeof this.scene.make.graphics !== 'function') return;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(0x64b85d, 1);
    graphics.fillRoundedRect(1, 7, 30, 23, 9);
    graphics.fillStyle(0x91df79, 1);
    graphics.fillCircle(11, 15, 4);
    graphics.fillCircle(21, 15, 4);
    graphics.fillStyle(0x17212b, 1);
    graphics.fillCircle(11, 15, 2);
    graphics.fillCircle(21, 15, 2);
    graphics.generateTexture(textureKey, 32, 32);
    graphics.destroy();
  }

  buildNpcBlockedCells(chunkData) {
    const blockedCells = new Set();
    const objects = Array.isArray(chunkData && chunkData.objects) ? chunkData.objects : [];
    objects.forEach((objectData) => {
      if (!objectData || (objectData.type !== 'TREE' && objectData.type !== 'ROCK')) return;
      if (!Number.isInteger(objectData.localTileX) || !Number.isInteger(objectData.localTileY)) return;
      blockedCells.add(`${objectData.localTileX},${objectData.localTileY}`);
    });
    // Water is impassable for wandering/chasing NPCs, exactly like TREE/ROCK.
    const water = Array.isArray(chunkData && chunkData.water) ? chunkData.water : [];
    water.forEach((tile) => {
      if (!tile || !Number.isInteger(tile.localTileX) || !Number.isInteger(tile.localTileY)) return;
      blockedCells.add(`${tile.localTileX},${tile.localTileY}`);
    });
    // Village building/campfire/chest footprint cells block NPC wandering too.
    // These come from ChunkManager for THIS chunk (including footprints whose
    // sprite is owned by a neighbouring chunk), so buildings are impassable from
    // every side even across chunk boundaries.
    const villageCells = Array.isArray(chunkData && chunkData.villageBlockedCells)
      ? chunkData.villageBlockedCells
      : [];
    villageCells.forEach((cell) => {
      if (!cell || !Number.isInteger(cell.localTileX) || !Number.isInteger(cell.localTileY)) return;
      blockedCells.add(`${cell.localTileX},${cell.localTileY}`);
    });
    return blockedCells;
  }

  isNpcWanderActive(npcObject) {
    return !this.destroyed
      && !!npcObject
      && !npcObject.destroyed
      && !npcObject.getData('dead')
      && this.npcObjects.includes(npcObject)
      && !npcObject.getData('wanderStopped');
  }

  isNpcWanderCallbackValid(npcObject, kind, handle) {
    if (!this.isNpcWanderActive(npcObject)) return false;
    if (kind === 'tween' && npcObject._npcWanderTween !== handle) return false;
    if (kind === 'timer' && npcObject._npcWanderTimer !== handle) return false;
    return true;
  }

  clearNpcWanderTween(npcObject) {
    if (!npcObject) return;
    const tween = npcObject._npcWanderTween;
    npcObject._npcWanderTween = null;
    if (!tween) return;
    if (typeof tween.stop === 'function') tween.stop();
    else if (typeof tween.remove === 'function') tween.remove();
  }

  clearNpcWanderTimer(npcObject) {
    if (!npcObject) return;
    const timer = npcObject._npcWanderTimer;
    npcObject._npcWanderTimer = null;
    if (!timer) return;
    if (typeof timer.remove === 'function') timer.remove(false);
    else if (typeof timer.destroy === 'function') timer.destroy();
  }

  stopNpcWander(npcObject) {
    if (!npcObject) return;
    npcObject.setData('wanderStopped', true);
    this.clearNpcWanderTween(npcObject);
    this.clearNpcWanderTimer(npcObject);
  }

  clearNpcPlayerCollider(npcObject) {
    if (!npcObject) return;
    const collider = npcObject._npcPlayerCollider;
    npcObject._npcPlayerCollider = null;
    if (!collider) return;
    if (typeof collider.destroy === 'function') collider.destroy();
  }

  syncNpcPhysicsBody(npcObject) {
    if (!npcObject || !npcObject.body) return;
    if (typeof npcObject.body.updateFromGameObject === 'function') {
      npcObject.body.updateFromGameObject();
      return;
    }
    if (typeof npcObject.body.reset === 'function') {
      npcObject.body.reset(npcObject.x, npcObject.y);
    }
  }

  setupNpcPhysicsBody(npcObject, config) {
    if (!npcObject || npcObject.body) return;
    if (!config) return;
    if (!this.scene || !this.scene.physics || !this.scene.physics.add) return;
    if (typeof this.scene.physics.add.existing !== 'function') return;

    this.scene.physics.add.existing(npcObject);
    const body = npcObject.body;
    if (!body) return;

    if (typeof body.setAllowGravity === 'function') body.setAllowGravity(false);
    else body.allowGravity = false;

    if (typeof body.setImmovable === 'function') body.setImmovable(true);
    else body.immovable = true;

    // Keep Arcade body following the tweened image instead of driving velocity.
    body.moves = false;

    // Body geometry is expressed in texture (source) pixels; Phaser scales it by
    // the sprite scale, so it stays correct regardless of the display size.
    const bodyWidth = Math.max(1, Math.round(config.bodyWidth));
    const bodyHeight = Math.max(1, Math.round(config.bodyHeight));
    const offsetX = Math.round(config.bodyOffsetX);
    const offsetY = Math.round(config.bodyOffsetY);

    if (typeof body.setSize === 'function') body.setSize(bodyWidth, bodyHeight);
    if (typeof body.setOffset === 'function') body.setOffset(offsetX, offsetY);
  }

  setupNpcPlayerCollider(npcObject) {
    if (!npcObject || npcObject._npcPlayerCollider) return;
    if (!this.scene || !this.scene.physics || !this.scene.physics.add) return;
    if (typeof this.scene.physics.add.collider !== 'function') return;

    const player = this.scene.player;
    if (!player || !player.body) return;

    npcObject._npcPlayerCollider = this.scene.physics.add.collider(npcObject, player);
  }

  getNearestAttackableNpc(x, y, radius) {
    if (this.destroyed) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      return null;
    }

    const radiusSquared = radius * radius;
    let nearest = null;
    let nearestDistanceSquared = Infinity;

    this.npcObjects.forEach((npcObject) => {
      if (!npcObject || npcObject.destroyed || npcObject.getData('dead')) return;
      if (!this.resolveNpcConfig(npcObject.getData('npcType'))) return;

      const dx = npcObject.x - x;
      const dy = npcObject.y - y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) return;

      const npcId = String(npcObject.getData('npcId') || '');
      const nearestId = nearest ? String(nearest.getData('npcId') || '') : '';
      if (
        distanceSquared < nearestDistanceSquared
        || (distanceSquared === nearestDistanceSquared && npcId < nearestId)
      ) {
        nearest = npcObject;
        nearestDistanceSquared = distanceSquared;
      }
    });

    return nearest;
  }

  applyNpcDamage(npcObject, amount) {
    if (this.destroyed) {
      return { damage: 0, health: 0, died: false };
    }
    if (!npcObject || !this.npcObjects.includes(npcObject)) {
      const leftover = npcObject && typeof npcObject.getData === 'function'
        ? Math.max(0, npcObject.getData('hp') || 0)
        : 0;
      return { damage: 0, health: leftover, died: false };
    }
    if (!this.resolveNpcConfig(npcObject.getData('npcType'))) {
      return { damage: 0, health: 0, died: false };
    }
    if (npcObject.destroyed || npcObject.getData('dead')) {
      return { damage: 0, health: 0, died: false };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Некорректный урон NPC: ${amount}.`);
    }

    const currentHp = Number.isInteger(npcObject.getData('hp')) ? npcObject.getData('hp') : 0;
    const actualDamage = Math.min(amount, Math.max(0, currentHp));
    const nextHp = Math.max(0, currentHp - actualDamage);
    npcObject.setData('hp', nextHp);

    if (nextHp === 0) {
      this.killNpc(npcObject);
      return { damage: actualDamage, health: 0, died: true };
    }

    return { damage: actualDamage, health: nextHp, died: false };
  }

  killNpc(npcObject) {
    if (!npcObject) return false;
    if (npcObject.getData('dead')) return false;

    npcObject.setData('dead', true);
    npcObject.setData('hp', 0);

    const npcId = npcObject.getData('npcId');
    if (
      typeof npcId === 'string'
      && npcId.length > 0
      && typeof this.onNpcRemoved === 'function'
    ) {
      this.onNpcRemoved(npcId);
    }

    const deathX = npcObject.x;
    const deathY = npcObject.y;
    const resolved = this.resolveNpcConfig(npcObject.getData('npcType'));
    const config = resolved ? resolved.config : null;

    this.destroyHostileControllerForNpc(npcObject);
    if (typeof npcId === 'string') this.removeProjectilesByOwner(npcId);
    this.stopNpcWander(npcObject);
    this.clearNpcPlayerCollider(npcObject);
    if (config) {
      this.dropNpcLoot(config, npcId, deathX, deathY);
    }

    const index = this.npcObjects.indexOf(npcObject);
    if (index >= 0) this.npcObjects.splice(index, 1);

    if (typeof npcId === 'string') this.npcIds.delete(npcId);

    npcObject._npcWanderTween = null;
    npcObject._npcWanderTimer = null;
    npcObject._npcPlayerCollider = null;

    if (typeof npcObject.destroy === 'function' && !npcObject.destroyed) {
      npcObject.destroy();
    }
    return true;
  }

  dropNpcLoot(config, npcId, deathX, deathY) {
    if (!config) return;
    // Preferred: an explicit `loot` array (restored slime behaviour) drops one
    // ground stack per entry, each with a per-NPC deterministic quantity. NPCs
    // without a `loot` array keep the original single lootType/lootQuantity drop.
    if (Array.isArray(config.loot) && config.loot.length > 0) {
      config.loot.forEach((entry, index) => {
        if (!entry || typeof entry.itemId !== 'string') return;
        const quantity = this.resolveLootQuantity(entry, npcId, index);
        this.dropNpcLootStack(entry.itemId, quantity, deathX, deathY);
      });
      return;
    }
    this.dropNpcLootStack(config.lootType, config.lootQuantity, deathX, deathY);
  }

  resolveLootQuantity(entry, npcId, index) {
    const min = Number.isInteger(entry.minQuantity)
      ? entry.minQuantity
      : (Number.isInteger(entry.quantity) ? entry.quantity : NaN);
    const max = Number.isInteger(entry.maxQuantity) ? entry.maxQuantity : min;
    if (!Number.isInteger(min) || min <= 0) return 0;
    if (!Number.isInteger(max) || max <= min) return min;
    // Deterministic per-NPC quantity so a given slime always drops the same
    // amount (reproducible across reloads and testable) without a shared RNG.
    const span = max - min + 1;
    const hash = SeededRandom.hashParts(String(npcId), index, 0, 'npc-loot-quantity');
    return min + (hash % span);
  }

  dropNpcLootStack(lootType, lootQuantity, deathX, deathY) {
    if (typeof lootType !== 'string' || lootType.length === 0) return null;
    if (!Number.isInteger(lootQuantity) || lootQuantity <= 0) return null;
    if (!Number.isFinite(deathX) || !Number.isFinite(deathY)) return null;
    if (!this.scene || !this.scene.groundItemSystem) return null;
    if (typeof this.scene.groundItemSystem.spawn !== 'function') return null;
    // Single stack: one spawn call carries the full quantity.
    return this.scene.groundItemSystem.spawn(lootType, lootQuantity, deathX, deathY);
  }

  startNpcWander(npcObject) {
    if (!this.isNpcWanderActive(npcObject)) return;
    if (npcObject.getData('wanderStarted')) return;
    npcObject.setData('wanderStarted', true);
    this.runNpcWanderAttempt(npcObject);
  }

  runNpcWanderAttempt(npcObject) {
    if (!this.isNpcWanderActive(npcObject)) return;

    const npcId = npcObject.getData('npcId');
    const stepIndex = npcObject.getData('wanderStepIndex');
    const currentLocalTileX = npcObject.getData('currentLocalTileX');
    const currentLocalTileY = npcObject.getData('currentLocalTileY');
    const randomValue = buildNpcWanderRandomValue(npcId, stepIndex);
    const target = chooseNpcWanderTarget({
      localTileX: currentLocalTileX,
      localTileY: currentLocalTileY,
      chunkSize: ChunkMath.CHUNK_SIZE,
      blockedCells: this.npcBlockedCells,
      randomValue
    });

    npcObject.setData('wanderStepIndex', stepIndex + 1);
    if (target) {
      npcObject.setData('wanderTargetLocalTileX', target.localTileX);
      npcObject.setData('wanderTargetLocalTileY', target.localTileY);
    } else {
      npcObject.setData('wanderTargetLocalTileX', null);
      npcObject.setData('wanderTargetLocalTileY', null);
    }

    if (!target) {
      this.scheduleNpcWanderPause(npcObject);
      return;
    }

    const worldPos = ChunkMath.localTileCenterWorld(
      this.chunkX,
      this.chunkY,
      target.localTileX,
      target.localTileY
    );
    this.startNpcWanderTween(npcObject, worldPos, target);
  }

  startNpcWanderTween(npcObject, worldPos, target) {
    if (!this.isNpcWanderActive(npcObject)) return;
    if (!this.scene || !this.scene.tweens || typeof this.scene.tweens.add !== 'function') return;

    this.clearNpcWanderTween(npcObject);
    const resolved = this.resolveNpcConfig(npcObject.getData('npcType'));
    const config = resolved ? resolved.config : null;
    const duration = config && Number.isFinite(config.wanderTweenDuration)
      ? config.wanderTweenDuration
      : 450;
    const tween = this.scene.tweens.add({
      targets: npcObject,
      x: worldPos.x,
      y: worldPos.y,
      duration,
      ease: 'Linear',
      onComplete: () => {
        if (!this.isNpcWanderCallbackValid(npcObject, 'tween', tween)) return;
        npcObject._npcWanderTween = null;
        npcObject.setData('currentLocalTileX', target.localTileX);
        npcObject.setData('currentLocalTileY', target.localTileY);
        this.syncNpcPhysicsBody(npcObject);
        if (this.scene && typeof this.scene.updateWorldDepth === 'function') {
          this.scene.updateWorldDepth(npcObject);
        } else if (typeof npcObject.setDepth === 'function') {
          npcObject.setDepth((npcObject.y + npcObject.displayHeight / 2) * 0.1);
        }
        this.scheduleNpcWanderPause(npcObject);
      }
    });
    npcObject._npcWanderTween = tween;
  }

  scheduleNpcWanderPause(npcObject) {
    if (!this.isNpcWanderActive(npcObject)) return;
    if (!this.scene || !this.scene.time || typeof this.scene.time.delayedCall !== 'function') return;

    this.clearNpcWanderTimer(npcObject);
    const resolved = this.resolveNpcConfig(npcObject.getData('npcType'));
    const config = resolved ? resolved.config : null;
    const pauseDuration = config && Number.isFinite(config.wanderPauseDuration)
      ? config.wanderPauseDuration
      : 900;
    const timer = this.scene.time.delayedCall(pauseDuration, () => {
      if (!this.isNpcWanderCallbackValid(npcObject, 'timer', timer)) return;
      npcObject._npcWanderTimer = null;
      this.runNpcWanderAttempt(npcObject);
    });
    npcObject._npcWanderTimer = timer;
  }

  createNpcs(chunkData) {
    if (this.destroyed) return;
    const npcs = Array.isArray(chunkData && chunkData.npcs) ? chunkData.npcs : [];
    this.npcBlockedCells = this.buildNpcBlockedCells(chunkData);
    npcs.forEach((descriptor) => {
      if (!descriptor) return;
      const resolved = this.resolveNpcConfig(descriptor.type);
      if (!resolved) return;
      const { kind, config } = resolved;
      if (!Number.isInteger(descriptor.index) || descriptor.index < 0) return;
      if (!Number.isInteger(descriptor.localTileX) || !Number.isInteger(descriptor.localTileY)) return;

      const npcId = this.buildStableNpcId(descriptor.type, descriptor.index);
      if (typeof this.isNpcRemoved === 'function' && this.isNpcRemoved(npcId)) return;
      if (this.npcIds.has(npcId)) return;

      // The rabbit placeholder is generated on demand; other NPC textures are
      // loaded once during preload (see GameScene).
      if (config.textureKey === 'rabbit-placeholder') {
        this.ensureRabbitPlaceholderTexture();
      } else if (config.textureKey === 'temporary-slime') {
        this.ensureSlimeTexture();
      }
      const position = ChunkMath.localTileCenterWorld(
        this.chunkX,
        this.chunkY,
        descriptor.localTileX,
        descriptor.localTileY
      );
      // Image is tweened; Arcade body is immovable and follows the visual.
      const npcObject = this.scene.add.image(position.x, position.y, config.textureKey);
      if (typeof npcObject.setDisplaySize === 'function') {
        // Set display size before the physics body is created so Arcade captures
        // the correct sprite scale for its source-pixel body geometry.
        npcObject.setDisplaySize(config.renderWidth, config.renderHeight);
      }
      npcObject.setDataEnabled();
      npcObject.setData('npcId', npcId);
      npcObject.setData('npcType', descriptor.type);
      npcObject.setData('npcKind', kind);
      npcObject.setData('chunkKey', this.key);
      npcObject.setData('currentLocalTileX', descriptor.localTileX);
      npcObject.setData('currentLocalTileY', descriptor.localTileY);
      npcObject.setData('wanderStepIndex', 0);
      npcObject.setData('wanderTargetLocalTileX', null);
      npcObject.setData('wanderTargetLocalTileY', null);
      npcObject.setData('wanderStarted', false);
      npcObject.setData('wanderStopped', false);
      npcObject.setData('maxHp', config.maxHp);
      npcObject.setData('hp', config.maxHp);
      npcObject.setData('dead', false);
      npcObject._npcWanderTween = null;
      npcObject._npcWanderTimer = null;
      npcObject._npcPlayerCollider = null;
      npcObject._hostileController = null;
      this.setupNpcPhysicsBody(npcObject, config);
      this.setupNpcPlayerCollider(npcObject);
      if (typeof this.scene.updateWorldDepth === 'function') {
        this.scene.updateWorldDepth(npcObject);
      } else {
        npcObject.setDepth((position.y + npcObject.displayHeight / 2) * 0.1);
      }

      this.npcIds.add(npcId);
      this.npcObjects.push(npcObject);
      this.startNpcWander(npcObject);

      if (kind === 'hostile') {
        this.attachHostileController(npcObject, config, position);
      }
    });
  }

  attachHostileController(npcObject, config, homePosition) {
    if (!npcObject || !config) return;
    const controller = new HostileNpcController({
      config,
      homeX: homePosition.x,
      homeY: homePosition.y,
      getPosition: () => {
        if (!npcObject || npcObject.destroyed || npcObject.getData('dead')) return null;
        return { x: npcObject.x, y: npcObject.y };
      },
      setPosition: (x, y) => {
        if (!npcObject || npcObject.destroyed || npcObject.getData('dead')) return;
        npcObject.x = x;
        npcObject.y = y;
      },
      getPlayerPosition: () => {
        const player = this.scene && this.scene.player;
        if (!player || player.destroyed || (player.active === false)) return null;
        if (this.scene.playerStatsModel && this.scene.playerStatsModel.isDead()) return null;
        return { x: player.x, y: player.y };
      },
      stopWander: () => this.stopNpcWander(npcObject),
      resumeWander: () => this.resumeNpcWander(npcObject),
      damagePlayer: (amount) => {
        if (!this.scene || typeof this.scene.damagePlayer !== 'function') return 0;
        return this.scene.damagePlayer(amount, npcObject.getData('npcId'));
      },
      onRangedAttack: (target, time) => {
        this.spawnBowmanArrow(npcObject, target, config, time);
      },
      canOccupy: (x, y) => this.canNpcOccupyWorld(x, y),
      onMoved: () => {
        this.syncNpcPhysicsBody(npcObject);
        if (this.scene && typeof this.scene.updateWorldDepth === 'function') {
          this.scene.updateWorldDepth(npcObject);
        }
      }
    });
    npcObject._hostileController = controller;
    this.hostileControllers.push(controller);
  }

  resumeNpcWander(npcObject) {
    if (!npcObject || npcObject.destroyed || npcObject.getData('dead')) return;
    npcObject.setData('wanderStopped', false);
    npcObject.setData('wanderStarted', false);
    this.startNpcWander(npcObject);
  }

  canNpcOccupyWorld(worldX, worldY) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    const tile = ChunkMath.worldToTile(worldX, worldY);
    const local = ChunkMath.worldTileToLocal(tile.tileX, tile.tileY);
    if (local.chunkX !== this.chunkX || local.chunkY !== this.chunkY) {
      // Leaving the home chunk during chase/return is allowed; obstacle data is local.
      return true;
    }
    const key = `${local.localTileX},${local.localTileY}`;
    return !this.npcBlockedCells.has(key);
  }

  updateHostiles(time, delta) {
    if (this.destroyed) return;
    this.hostileControllers.forEach((controller) => {
      if (!controller || controller.isDestroyed()) return;
      controller.update(time, delta);
    });
  }

  buildObstacleRects(chunkData) {
    const rects = [];
    const objects = Array.isArray(chunkData && chunkData.objects) ? chunkData.objects : [];
    objects.forEach((objectData) => {
      if (!objectData) return;
      const half = BOWMAN_OBSTACLE_HALF[objectData.type];
      if (!half) return;
      if (!Number.isInteger(objectData.localTileX) || !Number.isInteger(objectData.localTileY)) return;
      const center = ChunkMath.localTileCenterWorld(
        this.chunkX,
        this.chunkY,
        objectData.localTileX,
        objectData.localTileY
      );
      rects.push({
        minX: center.x - half.x,
        minY: center.y - half.y,
        maxX: center.x + half.x,
        maxY: center.y + half.y
      });
    });
    return rects;
  }

  ensureBowmanArrowTexture() {
    if (!this.scene || !this.scene.textures) return;
    if (typeof this.scene.textures.exists === 'function'
      && this.scene.textures.exists(BOWMAN_ARROW_TEXTURE_KEY)) {
      return;
    }
    if (!this.scene.make || typeof this.scene.make.graphics !== 'function') return;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    // Wooden shaft.
    graphics.fillStyle(0x8a5a2b, 1);
    graphics.fillRect(2, 1, 9, 1);
    // Steel head.
    graphics.fillStyle(0xcfd6da, 1);
    graphics.fillTriangle(11, 0, 14, 1.5, 11, 3);
    // Fletching.
    graphics.fillStyle(0xbfc6cc, 1);
    graphics.fillRect(0, 0, 2, 3);
    graphics.generateTexture(BOWMAN_ARROW_TEXTURE_KEY, 14, 3);
    graphics.destroy();
  }

  spawnBowmanArrow(sourceNpc, target, config, time) {
    if (this.destroyed) return null;
    if (!config) return null;
    if (!sourceNpc || sourceNpc.destroyed || sourceNpc.getData('dead')) return null;
    if (!this.scene || !this.scene.add || typeof this.scene.add.image !== 'function') return null;

    const originX = sourceNpc.x;
    const originY = sourceNpc.y;
    const targetX = target && Number.isFinite(target.x) ? target.x : NaN;
    const targetY = target && Number.isFinite(target.y) ? target.y : NaN;
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;

    let dirX = targetX - originX;
    let dirY = targetY - originY;
    const length = Math.hypot(dirX, dirY);
    // Zero-length direction: never emit a degenerate projectile.
    if (!(length > 0)) return null;
    dirX /= length;
    dirY /= length;

    const speed = config.projectileSpeed;
    const damage = config.projectileDamage;
    const lifetime = config.projectileLifetime;
    if (!(speed > 0) || !(damage > 0) || !(lifetime > 0)) return null;

    this.ensureBowmanArrowTexture();
    const sprite = this.scene.add.image(originX, originY, BOWMAN_ARROW_TEXTURE_KEY);
    if (sprite && typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(config.projectileWidth, config.projectileHeight);
    }
    if (sprite && typeof sprite.setRotation === 'function') {
      sprite.setRotation(Math.atan2(dirY, dirX));
    }
    this.applyProjectileDepth(sprite, originY);

    const safeTime = Number.isFinite(time) ? time : 0;
    const maxTravel = speed * (lifetime / 1000) + BOWMAN_ARROW_BOUNDS_MARGIN;
    const projectile = {
      sprite,
      ownerId: sourceNpc.getData('npcId'),
      x: originX,
      y: originY,
      startX: originX,
      startY: originY,
      vx: dirX * speed,
      vy: dirY * speed,
      damage,
      expireTime: safeTime + lifetime,
      maxTravelSq: maxTravel * maxTravel,
      active: true,
      processed: false
    };
    this.projectiles.push(projectile);
    return projectile;
  }

  applyProjectileDepth(sprite, worldY) {
    if (!sprite) return;
    if (this.scene && typeof this.scene.updateWorldDepth === 'function') {
      this.scene.updateWorldDepth(sprite);
    } else if (typeof sprite.setDepth === 'function') {
      const displayHeight = Number.isFinite(sprite.displayHeight) ? sprite.displayHeight : 0;
      sprite.setDepth((worldY + displayHeight / 2) * 0.1);
    }
  }

  getPlayerHitRect() {
    const player = this.scene && this.scene.player;
    if (!player || player.destroyed || player.active === false) return null;
    if (this.scene.playerStatsModel
      && typeof this.scene.playerStatsModel.isDead === 'function'
      && this.scene.playerStatsModel.isDead()) {
      return null;
    }
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;

    let halfW = BOWMAN_PLAYER_HIT_HALF_DEFAULT;
    let halfH = BOWMAN_PLAYER_HIT_HALF_DEFAULT;
    const body = player.body;
    if (body && Number.isFinite(body.width) && body.width > 0) halfW = body.width / 2;
    if (body && Number.isFinite(body.height) && body.height > 0) halfH = body.height / 2;
    return {
      minX: player.x - halfW,
      minY: player.y - halfH,
      maxX: player.x + halfW,
      maxY: player.y + halfH
    };
  }

  rectsIntersect(aMinX, aMinY, aMaxX, aMaxY, bMinX, bMinY, bMaxX, bMaxY) {
    return aMinX <= bMaxX && aMaxX >= bMinX && aMinY <= bMaxY && aMaxY >= bMinY;
  }

  projectileHitsObstacle(projectile) {
    const aMinX = projectile.x - BOWMAN_ARROW_HIT_HALF;
    const aMinY = projectile.y - BOWMAN_ARROW_HIT_HALF;
    const aMaxX = projectile.x + BOWMAN_ARROW_HIT_HALF;
    const aMaxY = projectile.y + BOWMAN_ARROW_HIT_HALF;
    for (let i = 0; i < this.obstacleRects.length; i += 1) {
      const rect = this.obstacleRects[i];
      if (this.rectsIntersect(aMinX, aMinY, aMaxX, aMaxY, rect.minX, rect.minY, rect.maxX, rect.maxY)) {
        return true;
      }
    }
    return false;
  }

  updateProjectiles(time, delta) {
    if (this.destroyed) return;
    if (!this.projectiles.length) return;
    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const dt = safeDelta / 1000;
    const safeTime = Number.isFinite(time) ? time : 0;
    const playerRect = this.getPlayerHitRect();

    this.projectiles.slice().forEach((projectile) => {
      if (!projectile.active) return;

      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) {
        this.removeProjectile(projectile);
        return;
      }

      if (projectile.sprite && !projectile.sprite.destroyed) {
        projectile.sprite.x = projectile.x;
        projectile.sprite.y = projectile.y;
        this.applyProjectileDepth(projectile.sprite, projectile.y);
      }

      // Lifetime expiry.
      if (safeTime >= projectile.expireTime) {
        this.removeProjectile(projectile);
        return;
      }

      // Reasonable travel bounds.
      const travelX = projectile.x - projectile.startX;
      const travelY = projectile.y - projectile.startY;
      if (travelX * travelX + travelY * travelY > projectile.maxTravelSq) {
        this.removeProjectile(projectile);
        return;
      }

      // TREE / ROCK collision.
      if (this.projectileHitsObstacle(projectile)) {
        this.removeProjectile(projectile);
        return;
      }

      // Player hit: single damage via the public API, then destroy.
      if (playerRect && !projectile.processed) {
        const hitsPlayer = this.rectsIntersect(
          projectile.x - BOWMAN_ARROW_HIT_HALF,
          projectile.y - BOWMAN_ARROW_HIT_HALF,
          projectile.x + BOWMAN_ARROW_HIT_HALF,
          projectile.y + BOWMAN_ARROW_HIT_HALF,
          playerRect.minX,
          playerRect.minY,
          playerRect.maxX,
          playerRect.maxY
        );
        if (hitsPlayer) {
          projectile.processed = true;
          if (this.scene && typeof this.scene.damagePlayer === 'function') {
            this.scene.damagePlayer(projectile.damage, projectile.ownerId);
          }
          this.removeProjectile(projectile);
        }
      }
    });
  }

  removeProjectile(projectile) {
    if (!projectile) return false;
    projectile.active = false;
    projectile.processed = true;
    const sprite = projectile.sprite;
    projectile.sprite = null;
    if (sprite && !sprite.destroyed && typeof sprite.destroy === 'function') {
      sprite.destroy();
    }
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) this.projectiles.splice(index, 1);
    return true;
  }

  removeProjectilesByOwner(ownerId) {
    if (typeof ownerId !== 'string' || ownerId.length === 0) return;
    this.projectiles.slice().forEach((projectile) => {
      if (projectile.ownerId === ownerId) this.removeProjectile(projectile);
    });
  }

  clearProjectiles() {
    this.projectiles.slice().forEach((projectile) => this.removeProjectile(projectile));
    this.projectiles = [];
  }

  destroyHostileControllerForNpc(npcObject) {
    if (!npcObject || !npcObject._hostileController) return;
    const controller = npcObject._hostileController;
    npcObject._hostileController = null;
    const index = this.hostileControllers.indexOf(controller);
    if (index >= 0) this.hostileControllers.splice(index, 1);
    if (typeof controller.destroy === 'function') controller.destroy();
  }

  destroyNpcs() {
    this.hostileControllers.slice().forEach((controller) => {
      if (controller && typeof controller.destroy === 'function') controller.destroy();
    });
    this.hostileControllers = [];
    this.npcObjects.slice().forEach((npcObject) => {
      if (!npcObject || npcObject.getData('dead')) return;
      npcObject._hostileController = null;
      this.stopNpcWander(npcObject);
      this.clearNpcPlayerCollider(npcObject);
      if (typeof npcObject.destroy === 'function') {
        npcObject.destroy();
      }
    });
    this.npcObjects = [];
    this.npcIds.clear();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.ownedObjectIds.slice().forEach((id) => {
      if (typeof id !== 'string' || !id.startsWith('chunk_')) return;
      if (typeof this.onObjectDestroyed === 'function') {
        this.onObjectDestroyed(id);
      }
    });
    this.ownedObjectIds = [];

    this.clearProjectiles();
    this.clearWater();
    this.clearVillage();
    this.destroyNpcs();

    if (this.ground) {
      this.ground.destroy();
      this.ground = null;
    }

    this.scene = null;
    this.blockingGroup = null;
    this.onObjectCreated = null;
    this.onObjectDestroyed = null;
    this.isResourceRemoved = null;
    this.isNpcRemoved = null;
    this.onNpcRemoved = null;
    this.npcBlockedCells = new Set();
  }
}
