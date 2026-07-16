const PLAYER_SPEED = 260;
const SURFACE_TILE_INDICES = Object.freeze({ G: 0, S: 1, W: 2, R: 3 });
const WORLD_OBJECT_TYPES = Object.freeze(['TREE', 'ROCK', 'BERRY_BUSH']);
const WORLD_OBJECT_DROPS = Object.freeze({
  TREE: Object.freeze({ itemType: 'WOOD', quantity: 3 }),
  ROCK: Object.freeze({ itemType: 'STONE', quantity: 2 }),
  BERRY_BUSH: Object.freeze({ itemType: 'BERRIES', quantity: 2 })
});
const WORLD_DEPTH_SCALE = 0.1;
const INTERFACE_DEPTH = 2000;
const DAY_NIGHT_OVERLAY_DEPTH = INTERFACE_DEPTH - 100;
const GROUND_ITEM_PICKUP_RADIUS = 28;
const BUILDING_DISMANTLE_DURATION_MS = 600;
const PLAYER_MELEE_ATTACK = Object.freeze({ damage: 10, radius: 52, cooldownMs: 450 });
const ITEM_TEXTURE_KEYS = Object.freeze({
  WOOD: 'temporary-ground-wood',
  STONE: 'temporary-ground-stone',
  SLIME_GEL: 'temporary-slime-gel',
  RAW_MEAT: 'temporary-raw-meat',
  MEAT_STEW: 'temporary-meat-stew',
  BERRIES: 'temporary-ground-berries',
  STONE_AXE: 'temporary-stone-axe',
  STONE_PICKAXE: 'temporary-stone-pickaxe',
  STONE_SWORD: 'temporary-stone-sword',
  BOW: 'temporary-bow'
});
const SLIME_SPAWN_CELLS = Object.freeze([
  Object.freeze({ col: 8, row: 8 }), Object.freeze({ col: 39, row: 8 }),
  Object.freeze({ col: 8, row: 28 }), Object.freeze({ col: 39, row: 28 })
]);
const USE_CHUNKED_WORLD = true;
const CHUNK_WORLD_DEBUG = true;

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.activeSlotId = data && (data.slotId === 1 || data.slotId === 2) ? data.slotId : null;
    this.launchMode = data && (data.mode === 'new' || data.mode === 'continue') ? data.mode : null;
  }

  create() {
    if (this.activeSlotId === null || this.launchMode === null) {
      this.scene.start('MenuScene', { message: 'Не удалось начать игру: слот или режим не выбран.' });
      return;
    }
    this.saveSlotManager = new SaveSlotManager();
    this.inventoryModel = new InventoryModel();
    this.craftingModel = new CraftingModel(this.inventoryModel);
    this.playerStatsModel = new PlayerStatsModel();
    this.dayNightSystem = new DayNightSystem();
    this.saveSystem = new SaveSystem(this.saveSlotManager, this.activeSlotId);
    this.isApplyingSave = false;
    this.isDeathHandled = false;
    this.useChunkedWorld = USE_CHUNKED_WORLD;
    this.worldSeed = this.resolveWorldSeedForSession();
    this.chunkManager = null;
    this.chunkDebugText = null;
    this.chunkWorldCleanupDone = false;
    this.createWorld();
    this.createPlayer();
    this.createWorldObjects();
    this.createBuildingSystem();
    this.createCreatureSystem();
    this.createCamera();
    this.createDayNightInterface();
    this.createInterface();
    this.createInteractionInterface();
    this.createInventoryUI();
    this.createCraftingUI();
    this.createChestUI();
    this.createSurvivalInterface();
    this.createBuildingInterface();
    this.createCombatInterface();
    this.createMenuExitInterface();
    this.createInputController();
    this.initializeSelectedSlot();
  }

  isPlayerDead() {
    return Boolean(
      this.isDeathHandled
      || (this.playerStatsModel && this.playerStatsModel.isDead())
    );
  }

  isModalOpen() {
    return Boolean(
      (this.inventoryUI && this.inventoryUI.isOpen)
      || (this.craftingUI && this.craftingUI.isOpen)
      || (this.chestUI && this.chestUI.isOpen)
      || this.exitConfirmOpen
    );
  }

  canMove() {
    return !this.isApplyingSave && !this.isPlayerDead() && !this.isModalOpen();
  }

  canHarvest() {
    return this.canMove() && !(this.buildingSystem && this.buildingSystem.isActive());
  }

  canUseFood() {
    return this.canHarvest() && !(this.holdActionSystem && this.holdActionSystem.active);
  }

  canAttack() {
    return this.canHarvest()
      && !(this.holdActionSystem && this.holdActionSystem.active);
  }

  canBuild() {
    return !this.isApplyingSave && !this.isPlayerDead() && !this.isModalOpen();
  }

  canOpenPanel() {
    return !this.isApplyingSave
      && !this.isPlayerDead()
      && !this.exitConfirmOpen
      && !this.exitTransitionLocked
      && !(this.buildingSystem && this.buildingSystem.isActive());
  }

  canSelectHotbarSlot() {
    return !this.isApplyingSave
      && !this.isPlayerDead()
      && !this.exitConfirmOpen
      && !this.exitTransitionLocked;
  }

  canSave() {
    return !this.isApplyingSave && !this.isPlayerDead() && !this.exitConfirmOpen;
  }

  canLoad() {
    return !this.isApplyingSave && !this.exitConfirmOpen;
  }

  createNewWorldSeed() {
    return Date.now();
  }

  resolveWorldSeedForSession() {
    if (this.launchMode === 'continue') {
      const loaded = this.saveSystem.load();
      if (loaded.success && loaded.state && loaded.state.worldSeed !== undefined && loaded.state.worldSeed !== null) {
        return loaded.state.worldSeed;
      }
      return this.createNewWorldSeed();
    }
    return this.createNewWorldSeed();
  }

  createChunkedWorld() {
    this.worldGrid = new ChunkWorldGrid(ChunkMath.TILE_SIZE);
    this.physics.world.setBounds(-1000000, -1000000, 2000000, 2000000);
    this.ensureSurfaceTileTexture();
    this.createChunkedSurfaceLayer();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupChunkedWorld, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupChunkedWorld, this);
  }

  ensureSurfaceTileTexture() {
    const textureKey = 'temporary-surface-tiles';
    const tileSize = ChunkMath.TILE_SIZE;
    if (this.textures.exists(textureKey)) return;
    const tiles = this.make.graphics({ x: 0, y: 0, add: false });
    tiles.fillStyle(0x527a45, 1);
    tiles.fillRect(0, 0, tileSize, tileSize);
    tiles.fillStyle(0x668d55, 1);
    tiles.fillRect(5, 7, 3, 3);
    tiles.fillRect(22, 19, 3, 3);
    tiles.fillStyle(0x416a3b, 1);
    tiles.fillRect(14, 25, 2, 4);
    tiles.fillStyle(0xc9aa62, 1);
    tiles.fillRect(tileSize, 0, tileSize, tileSize);
    tiles.fillStyle(0x2f6f9f, 1);
    tiles.fillRect(tileSize * 2, 0, tileSize, tileSize);
    tiles.fillStyle(0x696c70, 1);
    tiles.fillRect(tileSize * 3, 0, tileSize, tileSize);
    tiles.generateTexture(textureKey, tileSize * 4, tileSize);
    tiles.destroy();
  }

  createChunkedSurfaceLayer() {
    const tileSize = ChunkMath.TILE_SIZE;
    const textureKey = 'temporary-surface-tiles';
    this.surfaceMap = this.make.tilemap({
      data: [[SURFACE_TILE_INDICES.G]],
      tileWidth: tileSize,
      tileHeight: tileSize
    });
    const tileset = this.surfaceMap.addTilesetImage(
      textureKey,
      textureKey,
      tileSize,
      tileSize,
      0,
      0,
      0
    );
    this.surfaceLayer = this.surfaceMap.createLayer(0, tileset, 0, 0);
    this.surfaceLayer.setDepth(ChunkMath.CHUNK_TERRAIN_DEPTH);
    this.surfaceLayer.setVisible(false);
  }

  createChunkedWorldObjects() {
    this.interactionSystem = new InteractionSystem(72);
    this.interactionSystem.setTargets([]);
    this.worldObjectsCollider = this.physics.add.collider(
      this.player,
      this.blockingWorldObjects
    );
    this.chunkManager = new ChunkManager(this, {
      worldSeed: this.worldSeed,
      blockingGroup: this.blockingWorldObjects,
      onObjectCreated: (runtimeObject) => this.registerChunkWorldObject(runtimeObject),
      onObjectDestroyed: (id) => this.unregisterChunkWorldObject(id),
      onChunkSetChanged: () => this.refreshInteractionTargets(),
      isResourceRemoved: (id) => this.isSessionResourceRemoved(id)
    });
    this.chunkManager.syncAround(this.player.x, this.player.y);
    this.refreshInteractionTargets();
    this.createChunkDebugOverlay();
  }

  registerChunkWorldObject(runtimeObject) {
    if (!this.runtimeWorldObjects) return;
    this.runtimeWorldObjects.set(runtimeObject.id, runtimeObject);
    if (runtimeObject.visualObject) this.worldObjects.push(runtimeObject.visualObject);
    if (runtimeObject.blockerObject && runtimeObject.blockerObject !== runtimeObject.visualObject) {
      this.treeBlockers.push(runtimeObject.blockerObject);
    }
  }

  markSessionResourceRemoved(id) {
    if (typeof id !== 'string' || !id.startsWith('chunk_')) return;
    this.sessionRemovedResourceIds.add(id);
  }

  isSessionResourceRemoved(id) {
    return this.sessionRemovedResourceIds.has(id);
  }

  hydrateSessionRemovedResourcesFromSave() {
    if (!this.saveSystem) {
      this.sessionRemovedResourceIds = new Set();
      return;
    }
    const loaded = this.saveSystem.load();
    if (!loaded.success || !loaded.state || !loaded.state.world) {
      this.sessionRemovedResourceIds = new Set();
      return;
    }
    this.applySessionRemovedResources(loaded.state.world.removedResources);
  }

  applySessionRemovedResources(removedResources) {
    const normalized = SaveSystem.normalizeRemovedResources(removedResources);
    this.sessionRemovedResourceIds = new Set(normalized);
    if (!this.runtimeWorldObjects) return;
    normalized.forEach((id) => {
      if (this.runtimeWorldObjects.has(id)) {
        this.unregisterChunkWorldObject(id);
      }
    });
  }

  unregisterChunkWorldObject(id) {
    if (!this.runtimeWorldObjects) return;
    if (typeof id !== 'string' || !id.startsWith('chunk_')) return;
    const runtimeObject = this.runtimeWorldObjects.get(id);
    if (!runtimeObject) return;
    if (runtimeObject.visualObject === this.player || runtimeObject.blockerObject === this.player) return;
    if (this.interactionSystem) this.interactionSystem.removeTarget(id);
    if (runtimeObject.blockerObject) {
      const group = this.blockingWorldObjects;
      // Phaser.GameObjects.Group#destroy sets children=undefined. During GameScene SHUTDOWN
      // the StaticPhysicsGroup is destroyed before ChunkManager cleanup calls contains().
      if (group && group.children && group.contains(runtimeObject.blockerObject)) {
        group.remove(runtimeObject.blockerObject, true, true);
      } else if (runtimeObject.blockerObject.destroy) {
        runtimeObject.blockerObject.destroy();
      }
    }
    if (runtimeObject.visualObject && runtimeObject.visualObject !== runtimeObject.blockerObject) {
      runtimeObject.visualObject.destroy();
    }
    this.runtimeWorldObjects.delete(id);
    this.worldObjects = this.worldObjects.filter((object) => object !== runtimeObject.visualObject);
    this.treeBlockers = this.treeBlockers.filter((object) => object !== runtimeObject.blockerObject);
  }

  createChunkDebugOverlay() {
    if (!CHUNK_WORLD_DEBUG) return;
    this.chunkDebugText = this.add.text(12, 12, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#d7ffe0',
      backgroundColor: '#000000aa'
    }).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 50).setPadding(6, 4, 6, 4);
    this.updateChunkDebugOverlay();
  }

  updateChunkDebugOverlay() {
    if (!this.chunkDebugText || !this.chunkManager || !this.player) return;
    const tile = ChunkMath.worldToTile(this.player.x, this.player.y);
    const chunk = ChunkMath.worldToChunk(this.player.x, this.player.y);
    this.chunkDebugText.setText([
      `seed: ${this.worldSeed}`,
      `tile: ${tile.tileX}, ${tile.tileY}`,
      `chunk: ${chunk.chunkX}, ${chunk.chunkY}`,
      `active: ${this.chunkManager.getActiveCount()}`,
      `pos: ${Math.round(this.player.x)}, ${Math.round(this.player.y)}`,
      `depth: ${this.player.depth}`,
      `vis: ${this.player.visible}/${this.player.active}`
    ].join('\n'));
  }

  cleanupChunkedWorld() {
    if (this.chunkWorldCleanupDone) return;
    this.chunkWorldCleanupDone = true;
    if (this.chunkManager) {
      this.chunkManager.destroy();
      this.chunkManager = null;
    }
    if (this.chunkDebugText) {
      this.chunkDebugText.destroy();
      this.chunkDebugText = null;
    }
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupChunkedWorld, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupChunkedWorld, this);
  }


  createWorld() {
    if (this.useChunkedWorld) {
      this.createChunkedWorld();
      return;
    }
    this.worldGrid = new WorldGrid(FixedMapData);
    this.physics.world.setBounds(0, 0, this.worldGrid.worldWidth, this.worldGrid.worldHeight);

    const graphics = this.add.graphics().setDepth(-20);
    graphics.fillStyle(0x527a45, 1);
    graphics.fillRect(0, 0, this.worldGrid.worldWidth, this.worldGrid.worldHeight);

    graphics.lineStyle(2, 0x5f8b50, 0.55);
    for (let x = 0; x <= this.worldGrid.worldWidth; x += 80) {
      graphics.lineBetween(x, 0, x, this.worldGrid.worldHeight);
    }
    for (let y = 0; y <= this.worldGrid.worldHeight; y += 80) {
      graphics.lineBetween(0, y, this.worldGrid.worldWidth, y);
    }

    const decorations = [
      { x: 220, y: 220, color: 0x294d32 },
      { x: 480, y: 720, color: 0x79593a },
      { x: 760, y: 300, color: 0x294d32 },
      { x: 1120, y: 850, color: 0x79593a },
      { x: 1420, y: 260, color: 0x294d32 },
      { x: 1740, y: 690, color: 0x79593a },
      { x: 1840, y: 1040, color: 0x294d32 }
    ];

    decorations.forEach((item, index) => {
      graphics.fillStyle(0x1c3324, 0.25);
      graphics.fillEllipse(item.x + 5, item.y + 14, 56, 24);
      graphics.fillStyle(item.color, 1);
      if (index % 2 === 0) {
        graphics.fillCircle(item.x, item.y, 28);
        graphics.fillCircle(item.x - 20, item.y + 5, 18);
        graphics.fillCircle(item.x + 20, item.y + 5, 18);
      } else {
        graphics.fillRoundedRect(item.x - 26, item.y - 20, 52, 40, 10);
        graphics.lineStyle(3, 0x5b402c, 1);
        graphics.strokeRoundedRect(item.x - 26, item.y - 20, 52, 40, 10);
      }
    });

    graphics.lineStyle(16, 0xe6c766, 1);
    graphics.strokeRect(8, 8, this.worldGrid.worldWidth - 16, this.worldGrid.worldHeight - 16);
    graphics.lineStyle(4, 0x3b2f21, 1);
    graphics.strokeRect(18, 18, this.worldGrid.worldWidth - 36, this.worldGrid.worldHeight - 36);

    this.createSurfaceTilemap();
  }

  createSurfaceTilemap() {
    const textureKey = 'temporary-surface-tiles';
    const tileSize = FixedMapData.tileSize;

    if (!this.textures.exists(textureKey)) {
      const tiles = this.make.graphics({ x: 0, y: 0, add: false });

      // Grass tile (index 0).
      tiles.fillStyle(0x527a45, 1);
      tiles.fillRect(0, 0, tileSize, tileSize);
      tiles.fillStyle(0x668d55, 1);
      tiles.fillRect(5, 7, 3, 3);
      tiles.fillRect(22, 19, 3, 3);
      tiles.fillStyle(0x416a3b, 1);
      tiles.fillRect(14, 25, 2, 4);

      // Sand tile (index 1).
      tiles.fillStyle(0xc9aa62, 1);
      tiles.fillRect(tileSize, 0, tileSize, tileSize);
      tiles.fillStyle(0xe0c47b, 1);
      tiles.fillRect(tileSize + 6, 6, 4, 2);
      tiles.fillRect(tileSize + 20, 23, 5, 2);
      tiles.fillStyle(0xaa884c, 1);
      tiles.fillRect(tileSize + 15, 14, 3, 3);

      // Water tile (index 2).
      tiles.fillStyle(0x2f6f9f, 1);
      tiles.fillRect(tileSize * 2, 0, tileSize, tileSize);
      tiles.fillStyle(0x4d91ba, 1);
      tiles.fillRect(tileSize * 2 + 3, 7, 12, 3);
      tiles.fillRect(tileSize * 2 + 17, 20, 12, 3);
      tiles.fillStyle(0x23577f, 1);
      tiles.fillRect(tileSize * 2 + 9, 27, 14, 2);

      // Rocky ground tile (index 3).
      tiles.fillStyle(0x696c70, 1);
      tiles.fillRect(tileSize * 3, 0, tileSize, tileSize);
      tiles.fillStyle(0x85898d, 1);
      tiles.fillRect(tileSize * 3 + 4, 5, 8, 6);
      tiles.fillRect(tileSize * 3 + 20, 19, 7, 8);
      tiles.fillStyle(0x505358, 1);
      tiles.fillRect(tileSize * 3 + 13, 14, 6, 5);

      tiles.generateTexture(textureKey, tileSize * 4, tileSize);
      tiles.destroy();
    }

    const numericMap = FixedMapData.tiles.map((row) => (
      Array.from(row, (tileType) => SURFACE_TILE_INDICES[tileType])
    ));

    this.surfaceMap = this.make.tilemap({
      data: numericMap,
      tileWidth: tileSize,
      tileHeight: tileSize
    });

    const tileset = this.surfaceMap.addTilesetImage(
      textureKey,
      textureKey,
      tileSize,
      tileSize,
      0,
      0,
      0
    );

    this.surfaceLayer = this.surfaceMap.createLayer(0, tileset, 0, 0);
    this.surfaceLayer.setDepth(-10);

    const waterTileIndex = SURFACE_TILE_INDICES.W;
    this.surfaceLayer.setCollision([waterTileIndex], true, true);
    this.surfaceLayer.calculateFacesWithin(
      0,
      0,
      FixedMapData.columns,
      FixedMapData.rows
    );
    this.validateSurfaceCollision(waterTileIndex);
  }

  validateSurfaceCollision(waterTileIndex) {
    const findFirstCell = (tileType) => {
      for (let row = 0; row < FixedMapData.rows; row += 1) {
        const col = FixedMapData.tiles[row].indexOf(tileType);
        if (col !== -1) return { col, row };
      }
      return null;
    };

    const waterCell = findFirstCell('W');
    const grassCell = findFirstCell('G');

    if (waterCell === null || grassCell === null) {
      throw new Error('Проверка коллизий карты невозможна: не найдена клетка W или G.');
    }

    const waterTile = this.surfaceLayer.getTileAt(waterCell.col, waterCell.row);
    if (
      waterTile === null
      || waterTile.index !== waterTileIndex
      || waterTile.collides !== true
    ) {
      throw new Error(
        `Неверная коллизия клетки W (col: ${waterCell.col}, row: ${waterCell.row}, `
        + `ожидался индекс: ${waterTileIndex}, фактический индекс: ${waterTile ? waterTile.index : 'нет тайла'}, `
        + `collides: ${waterTile ? waterTile.collides : 'нет тайла'}).`
      );
    }

    const grassTileIndex = SURFACE_TILE_INDICES.G;
    const grassTile = this.surfaceLayer.getTileAt(grassCell.col, grassCell.row);
    if (
      grassTile === null
      || grassTile.index !== grassTileIndex
      || grassTile.collides !== false
    ) {
      throw new Error(
        `Неверная коллизия клетки G (col: ${grassCell.col}, row: ${grassCell.row}, `
        + `ожидался индекс: ${grassTileIndex}, фактический индекс: ${grassTile ? grassTile.index : 'нет тайла'}, `
        + `collides: ${grassTile ? grassTile.collides : 'нет тайла'}).`
      );
    }
  }

  createPlayer() {
    if (!this.textures.exists('player')) {
      const playerTexture = this.make.graphics({ x: 0, y: 0, add: false });
      playerTexture.fillStyle(0x163a59, 1);
      playerTexture.fillRoundedRect(0, 0, 40, 40, 8);
      playerTexture.fillStyle(0x4fc3f7, 1);
      playerTexture.fillRoundedRect(4, 4, 32, 32, 6);
      playerTexture.fillStyle(0xffffff, 1);
      playerTexture.fillCircle(14, 17, 4);
      playerTexture.fillCircle(26, 17, 4);
      playerTexture.generateTexture('player', 40, 40);
      playerTexture.destroy();
    }

    let startPosition;
    if (this.useChunkedWorld) {
      const spawn = ChunkMath.chunkLocalToWorldTile(0, 0, 8, 8);
      startPosition = this.worldGrid.cellToWorldCenter(spawn.tileX, spawn.tileY);
    } else {
      const { col, row } = FixedMapData.playerStart;

      if (!this.worldGrid.isInside(col, row)) {
        throw new Error(`Стартовая клетка игрока находится вне карты (col: ${col}, row: ${row}).`);
      }

      if (!this.worldGrid.isWalkable(col, row)) {
        const tileType = this.worldGrid.getTileType(col, row);
        throw new Error(
          `Стартовая клетка игрока непроходима (col: ${col}, row: ${row}, тип: ${tileType ?? 'неизвестен'}).`
        );
      }

      startPosition = this.worldGrid.cellToWorldCenter(col, row);
      if (startPosition === null) {
        throw new Error(
          `Не удалось преобразовать стартовую клетку игрока в координаты мира (col: ${col}, row: ${row}).`
        );
      }
    }

    this.player = this.physics.add.sprite(startPosition.x, startPosition.y, 'player');
    this.player.setCollideWorldBounds(!this.useChunkedWorld);
    this.player.body.setSize(40, 40);
    this.playerMapCollider = this.physics.add.collider(this.player, this.surfaceLayer);
    this.updateWorldDepth(this.player);
  }

  createWorldObjects() {
    this.createWorldObjectTextures();
    this.createGroundItemTextures();

    this.worldObjects = [];
    this.treeBlockers = [];
    this.interactionTargets = [];
    this.runtimeWorldObjects = new Map();
    this.sessionRemovedResourceIds = new Set();
    // Continue must hydrate removed IDs before the first chunk materialization.
    if (this.launchMode === 'continue') {
      this.hydrateSessionRemovedResourcesFromSave();
    }
    this.blockingWorldObjects = this.physics.add.staticGroup();
    this.groundItemSystem = new GroundItemSystem(this, ITEM_TEXTURE_KEYS);

    if (this.useChunkedWorld) {
      this.createChunkedWorldObjects();
      return;
    }

    this.validateWorldObjects();

    FixedWorldObjects.forEach((objectData) => {
      const position = this.worldGrid.cellToWorldCenter(objectData.col, objectData.row);
      const textureKey = {
        TREE: 'temporary-tree',
        ROCK: 'temporary-rock',
        BERRY_BUSH: 'temporary-berry-bush'
      }[objectData.type];
      const gameObject = objectData.type === 'ROCK'
        ? this.blockingWorldObjects.create(position.x, position.y, textureKey)
        : this.add.image(position.x, position.y, textureKey);

      gameObject.setDataEnabled();
      gameObject.setData('id', objectData.id);
      gameObject.setData('type', objectData.type);
      gameObject.setData('col', objectData.col);
      gameObject.setData('row', objectData.row);
      this.updateWorldDepth(gameObject);

      let interactionX = gameObject.x;
      let interactionY = gameObject.y;
      let blockerObject = null;

      if (objectData.type === 'TREE') {
        const treeBounds = gameObject.getBounds();
        const blocker = this.blockingWorldObjects.create(
          treeBounds.centerX,
          treeBounds.bottom - 8,
          'temporary-tree-blocker'
        );
        blocker.setVisible(false);
        blocker.setDataEnabled();
        blocker.setData('ownerId', objectData.id);
        blocker.setData('type', objectData.type);
        blocker.setData('col', objectData.col);
        blocker.setData('row', objectData.row);
        this.treeBlockers.push(blocker);
        blockerObject = blocker;
        interactionX = blocker.x;
        interactionY = blocker.y;
      } else if (objectData.type === 'ROCK') {
        gameObject.body.setSize(24, 18);
        gameObject.body.setOffset(4, 14);
        gameObject.refreshBody();
        blockerObject = gameObject;
      }

      this.worldObjects.push(gameObject);
      const interactionTarget = {
        id: objectData.id,
        type: objectData.type,
        col: objectData.col,
        row: objectData.row,
        interactionX,
        interactionY,
        visualObject: gameObject
      };
      this.interactionTargets.push(interactionTarget);
      this.runtimeWorldObjects.set(objectData.id, {
        id: objectData.id,
        type: objectData.type,
        col: objectData.col,
        row: objectData.row,
        active: true,
        visualObject: gameObject,
        blockerObject,
        interactionTarget
      });
    });

    this.validateTreeBlockerGeometry();
    this.interactionSystem = new InteractionSystem(72);
    this.interactionSystem.setTargets(this.interactionTargets);
    this.worldObjectsCollider = this.physics.add.collider(
      this.player,
      this.blockingWorldObjects
    );
  }

  validateWorldObjects() {
    const ids = new Set();
    const occupiedCells = new Set();
    const allowedTypes = new Set(WORLD_OBJECT_TYPES);
    const start = FixedMapData.playerStart;

    FixedWorldObjects.forEach((objectData) => {
      const details = `id: ${objectData.id}, type: ${objectData.type}, col: ${objectData.col}, row: ${objectData.row}`;

      if (ids.has(objectData.id)) {
        throw new Error(`Повторяющийся id объекта мира (${details}).`);
      }
      ids.add(objectData.id);

      if (!allowedTypes.has(objectData.type)) {
        throw new Error(`Недопустимый тип объекта мира (${details}).`);
      }

      if (!Number.isInteger(objectData.col) || !Number.isInteger(objectData.row)) {
        throw new Error(`Координаты объекта мира должны быть целыми (${details}).`);
      }

      if (!this.worldGrid.isInside(objectData.col, objectData.row)) {
        throw new Error(`Объект мира находится вне карты (${details}).`);
      }

      if (!this.worldGrid.isWalkable(objectData.col, objectData.row)) {
        throw new Error(`Объект мира находится на непроходимой клетке (${details}).`);
      }

      const cellKey = `${objectData.col},${objectData.row}`;
      if (occupiedCells.has(cellKey)) {
        throw new Error(`Несколько объектов мира занимают одну клетку (${details}).`);
      }
      occupiedCells.add(cellKey);

      const distanceFromStart = Math.max(
        Math.abs(objectData.col - start.col),
        Math.abs(objectData.row - start.row)
      );
      if (distanceFromStart <= 2) {
        throw new Error(`Объект мира находится слишком близко к старту игрока (${details}).`);
      }
    });
  }

  createBuildingSystem() {
    this.lastFacingDirection = 'down';
    this.currentBuildTarget = null;
    this.buildingSystem = new BuildingSystem(
      this,
      this.worldGrid,
      this.blockingWorldObjects,
      {
        WOOD_WALL: 'temporary-wood-wall',
        CAMPFIRE: 'temporary-campfire',
        CHEST: 'temporary-chest'
      }
    );
    this.interactionTargetValidator = (target) => this.isInteractionTargetValid(target);
    this.refreshInteractionTargets();
  }

  isInteractionTargetValid(target) {
    if (!['WOOD_WALL', 'CAMPFIRE', 'CHEST'].includes(target.type)) return true;
    const building = this.buildingSystem ? this.buildingSystem.getPlacement(target.id) : null;
    if (building === null || target.building !== building || target.buildType !== building.buildType) {
      return false;
    }
    if ((target.type === 'CAMPFIRE' || target.type === 'CHEST') && (
      this.isApplyingSave
      || this.isPlayerDead()
      || this.isModalOpen()
      || this.buildingSystem.isActive()
    )) return false;
    const facingVectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };
    const facing = facingVectors[this.lastFacingDirection];
    if (!facing) return false;
    const offsetX = target.interactionX - this.player.x;
    const offsetY = target.interactionY - this.player.y;
    return offsetX * facing.x + offsetY * facing.y > 0;
  }

  refreshInteractionTargets() {
    const targets = [];
    if (this.runtimeWorldObjects) {
      this.runtimeWorldObjects.forEach((object) => {
        if (object.active) targets.push(object.interactionTarget);
      });
    }
    if (this.buildingSystem) {
      this.buildingSystem.getPlacements().forEach((building) => {
        const position = this.worldGrid.cellToWorldCenter(building.col, building.row);
        if (position === null) {
          throw new Error(
            `Не удалось создать цель постройки ${building.id} `
            + `(тип: ${building.buildType}, col: ${building.col}, row: ${building.row}).`
          );
        }
        targets.push({
          id: building.id,
          type: building.buildType,
          buildType: building.buildType,
          col: building.col,
          row: building.row,
          interactionX: position.x,
          interactionY: position.y,
          visualObject: building.visualObject,
          building
        });
      });
    }
    this.interactionTargets = targets;
    this.interactionSystem.setTargets(targets);
  }

  createCreatureSystem() {
    this.creatureSystem = new CreatureSystem(this);
    if (!this.useChunkedWorld) {
      SLIME_SPAWN_CELLS.forEach(({ col, row }) => {
        if (!this.worldGrid.isWalkable(col, row)
          || Array.from(this.runtimeWorldObjects.values()).some(
            (object) => object.active && object.col === col && object.row === row
          )) {
          throw new Error(`Недопустимая клетка появления слизня (${col}, ${row}).`);
        }
        const position = this.worldGrid.cellToWorldCenter(col, row);
        this.creatureSystem.spawn('SLIME', position.x, position.y, `SLIME_${col}_${row}`);
      });
    }
    this.creatureMapCollider = this.physics.add.collider(this.creatureSystem.group, this.surfaceLayer);
    this.creatureObstacleCollider = this.physics.add.collider(
      this.creatureSystem.group,
      this.blockingWorldObjects
    );
    this.projectileSystem = new ProjectileSystem(this, {
      textureKey: 'temporary-arrow',
      surfaceLayer: this.surfaceLayer,
      blockingGroup: this.blockingWorldObjects,
      creatureGroup: this.creatureSystem.group,
      depthScale: WORLD_DEPTH_SCALE,
      onCreatureHit: (projectile, creatureSprite) => {
        this.handleProjectileCreatureHit(projectile, creatureSprite);
      }
    });
  }

  createWorldObjectTextures() {
    if (!this.textures.exists('temporary-tree')) {
      const tree = this.make.graphics({ x: 0, y: 0, add: false });
      tree.fillStyle(0x76502f, 1);
      tree.fillRect(19, 34, 10, 30);
      tree.fillStyle(0x285a35, 1);
      tree.fillCircle(24, 22, 20);
      tree.fillStyle(0x397343, 1);
      tree.fillCircle(14, 25, 12);
      tree.fillCircle(34, 25, 12);
      tree.fillStyle(0x4b8a50, 1);
      tree.fillRect(19, 9, 10, 6);
      tree.generateTexture('temporary-tree', 48, 64);
      tree.destroy();
    }

    if (!this.textures.exists('temporary-rock')) {
      const rock = this.make.graphics({ x: 0, y: 0, add: false });
      rock.fillStyle(0x555b61, 1);
      rock.fillRoundedRect(2, 7, 28, 23, 8);
      rock.fillStyle(0x838a91, 1);
      rock.fillRoundedRect(7, 5, 17, 12, 5);
      rock.fillStyle(0x3f4449, 1);
      rock.fillRect(20, 19, 6, 5);
      rock.generateTexture('temporary-rock', 32, 32);
      rock.destroy();
    }

    if (!this.textures.exists('temporary-tree-blocker')) {
      const blocker = this.make.graphics({ x: 0, y: 0, add: false });
      blocker.fillStyle(0xffffff, 0);
      blocker.fillRect(0, 0, 18, 16);
      blocker.generateTexture('temporary-tree-blocker', 18, 16);
      blocker.destroy();
    }

    if (!this.textures.exists('temporary-berry-bush')) {
      const bush = this.make.graphics({ x: 0, y: 0, add: false });
      bush.fillStyle(0x315f35, 1);
      bush.fillCircle(10, 18, 9);
      bush.fillCircle(21, 17, 10);
      bush.fillCircle(16, 10, 9);
      bush.fillStyle(0xc53f57, 1);
      bush.fillCircle(9, 14, 3);
      bush.fillCircle(22, 13, 3);
      bush.fillCircle(17, 22, 3);
      bush.generateTexture('temporary-berry-bush', 32, 32);
      bush.destroy();
    }

    if (!this.textures.exists('temporary-wood-wall')) {
      const wall = this.make.graphics({ x: 0, y: 0, add: false });
      wall.fillStyle(0x744a2b, 1);
      wall.fillRect(1, 2, 30, 28);
      wall.fillStyle(0xa87343, 1);
      wall.fillRect(3, 5, 26, 6);
      wall.fillRect(3, 16, 26, 6);
      wall.fillStyle(0x4f321f, 1);
      wall.fillRect(7, 2, 3, 28);
      wall.fillRect(22, 2, 3, 28);
      wall.generateTexture('temporary-wood-wall', 32, 32);
      wall.destroy();
    }

    if (!this.textures.exists('temporary-campfire')) {
      const campfire = this.make.graphics({ x: 0, y: 0, add: false });
      campfire.fillStyle(0x555b61, 1);
      campfire.fillCircle(8, 24, 6);
      campfire.fillCircle(16, 26, 6);
      campfire.fillCircle(24, 24, 6);
      campfire.fillStyle(0x8c613c, 1);
      campfire.fillRect(7, 22, 19, 5);
      campfire.fillStyle(0xe85d35, 1);
      campfire.fillTriangle(16, 5, 8, 22, 24, 22);
      campfire.fillStyle(0xffb53d, 1);
      campfire.fillTriangle(16, 10, 12, 22, 20, 22);
      campfire.fillStyle(0xffe06a, 1);
      campfire.fillRect(15, 16, 3, 6);
      campfire.generateTexture('temporary-campfire', 32, 32);
      campfire.destroy();
    }

    if (!this.textures.exists('temporary-chest')) {
      const chest = this.make.graphics({ x: 0, y: 0, add: false });
      chest.fillStyle(0x5b351e, 1);
      chest.fillRect(2, 10, 28, 20);
      chest.fillStyle(0x8a552d, 1);
      chest.fillRect(3, 5, 26, 10);
      chest.fillStyle(0xb77a3f, 1);
      chest.fillRect(5, 7, 22, 3);
      chest.fillStyle(0x30251d, 1);
      chest.fillRect(2, 14, 28, 3);
      chest.fillStyle(0xe0b45d, 1);
      chest.fillRect(14, 14, 5, 8);
      chest.fillStyle(0x8b6a35, 1);
      chest.fillRect(15, 16, 3, 3);
      chest.generateTexture('temporary-chest', 32, 32);
      chest.destroy();
    }

    if (!this.textures.exists('temporary-slime')) {
      const slime = this.make.graphics({ x: 0, y: 0, add: false });
      slime.fillStyle(0x64b85d, 1);
      slime.fillRoundedRect(1, 7, 30, 23, 9);
      slime.fillStyle(0x91df79, 1);
      slime.fillCircle(11, 15, 4);
      slime.fillCircle(21, 15, 4);
      slime.fillStyle(0x17212b, 1);
      slime.fillCircle(11, 15, 2);
      slime.fillCircle(21, 15, 2);
      slime.generateTexture('temporary-slime', 32, 32);
      slime.destroy();
    }
  }

  createGroundItemTextures() {
    const definitions = [
      ['temporary-ground-wood', 0x9a6336, (graphics) => {
        graphics.fillRect(2, 7, 16, 6);
        graphics.fillStyle(0xc58a50, 1);
        graphics.fillRect(4, 5, 12, 3);
      }],
      ['temporary-ground-stone', 0x747d86, (graphics) => {
        graphics.fillRoundedRect(2, 4, 16, 13, 5);
        graphics.fillStyle(0xa8b0b7, 1);
        graphics.fillRect(6, 5, 7, 3);
      }],
      ['temporary-slime-gel', 0x63c76a, (graphics) => {
        graphics.fillRoundedRect(2, 7, 16, 11, 5);
        graphics.fillStyle(0x9be889, 1);
        graphics.fillRect(6, 6, 7, 4);
        graphics.fillStyle(0xd2ffc0, 1);
        graphics.fillRect(6, 9, 3, 3);
      }],
      ['temporary-raw-meat', 0xc95b63, (graphics) => {
        graphics.fillRoundedRect(2, 5, 16, 12, 5);
        graphics.fillStyle(0xf08b8f, 1);
        graphics.fillRoundedRect(5, 7, 10, 7, 3);
        graphics.fillStyle(0xffd3c5, 1);
        graphics.fillCircle(15, 7, 3);
      }],
      ['temporary-meat-stew', 0x71452f, (graphics) => {
        graphics.fillRoundedRect(2, 8, 16, 10, 4);
        graphics.fillStyle(0xcfd6dc, 1);
        graphics.fillRect(1, 7, 18, 3);
        graphics.fillStyle(0xa95032, 1);
        graphics.fillRoundedRect(4, 8, 12, 5, 2);
        graphics.fillStyle(0xe8b45a, 1);
        graphics.fillRect(7, 9, 3, 2);
        graphics.fillStyle(0x6fa354, 1);
        graphics.fillRect(12, 10, 3, 2);
      }],
      ['temporary-ground-berries', 0xc53f57, (graphics) => {
        graphics.fillCircle(6, 10, 5);
        graphics.fillCircle(14, 10, 5);
        graphics.fillCircle(10, 5, 5);
        graphics.fillStyle(0x3f7d46, 1);
        graphics.fillRect(9, 0, 3, 4);
      }],
      ['temporary-stone-axe', 0x8c613c, (graphics) => {
        graphics.fillRect(9, 4, 3, 15);
        graphics.fillStyle(0x9099a1, 1);
        graphics.fillRect(5, 2, 11, 6);
        graphics.fillRect(3, 4, 4, 4);
      }],
      ['temporary-stone-pickaxe', 0x8c613c, (graphics) => {
        graphics.fillRect(9, 5, 3, 14);
        graphics.fillStyle(0x9099a1, 1);
        graphics.fillRect(3, 2, 14, 4);
        graphics.fillRect(2, 4, 4, 3);
        graphics.fillRect(15, 4, 3, 3);
      }],
      ['temporary-stone-sword', 0x8c613c, (graphics) => {
        graphics.fillRect(9, 13, 3, 6);
        graphics.fillStyle(0x6b452b, 1);
        graphics.fillRect(8, 17, 5, 2);
        graphics.fillStyle(0xaab2ba, 1);
        graphics.fillRect(5, 11, 11, 3);
        graphics.fillRect(8, 3, 5, 9);
        graphics.fillRect(9, 1, 3, 2);
      }],
      ['temporary-bow', 0x9a6336, (graphics) => {
        graphics.lineStyle(3, 0x9a6336, 1);
        graphics.beginPath();
        graphics.arc(6, 10, 8, -Math.PI / 2, Math.PI / 2);
        graphics.strokePath();
        graphics.lineStyle(1, 0xe8dec5, 1);
        graphics.lineBetween(6, 2, 6, 18);
        graphics.lineStyle(2, 0xc8d0d6, 1);
        graphics.lineBetween(4, 10, 17, 10);
        graphics.fillStyle(0xc8d0d6, 1);
        graphics.fillTriangle(17, 10, 13, 7, 13, 13);
      }],
      ['temporary-arrow', 0xc8d0d6, (graphics) => {
        graphics.fillRect(2, 9, 15, 2);
        graphics.fillTriangle(19, 10, 14, 6, 14, 14);
        graphics.fillStyle(0x9a6336, 1);
        graphics.fillTriangle(2, 10, 6, 6, 6, 10);
        graphics.fillTriangle(2, 10, 6, 14, 6, 10);
      }]
    ];

    definitions.forEach(([textureKey, color, draw]) => {
      if (this.textures.exists(textureKey)) return;
      const graphics = this.make.graphics({ x: 0, y: 0, add: false });
      graphics.fillStyle(color, 1);
      draw(graphics);
      graphics.generateTexture(textureKey, 20, 20);
      graphics.destroy();
    });
  }

  validateTreeBlockerGeometry() {
    const trees = this.worldObjects.filter((gameObject) => gameObject.getData('type') === 'TREE');

    if (this.treeBlockers.length !== trees.length) {
      throw new Error(
        `Количество блокировщиков деревьев не совпадает с количеством спрайтов `
        + `(спрайтов: ${trees.length}, блокировщиков: ${this.treeBlockers.length}).`
      );
    }

    trees.forEach((tree) => {
      const treeId = tree.getData('id');
      const blockers = this.treeBlockers.filter(
        (blocker) => blocker.getData('ownerId') === treeId
      );

      if (tree.body && tree.body.enable) {
        throw new Error(`Визуальный спрайт дерева ${treeId} не должен иметь активное физическое тело.`);
      }

      if (blockers.length !== 1) {
        throw new Error(
          `Для дерева ${treeId} ожидался один блокировщик, найдено: ${blockers.length}.`
        );
      }

      const blocker = blockers[0];
      const treeBounds = tree.getBounds();
      const body = blocker.body;
      const bodyLeft = body.position.x;
      const bodyTop = body.position.y;
      const bodyRight = bodyLeft + body.width;
      const bodyBottom = bodyTop + body.height;
      const tolerance = 1;
      const bodyDescription = `x: ${bodyLeft}, y: ${bodyTop}, width: ${body.width}, height: ${body.height}`;

      if (body.width !== 18 || body.height !== 16) {
        throw new Error(`Неверный размер блокировщика дерева ${treeId} (${bodyDescription}).`);
      }

      if (
        bodyLeft < treeBounds.left - tolerance
        || bodyRight > treeBounds.right + tolerance
      ) {
        throw new Error(`Блокировщик дерева ${treeId} вышел за горизонтальные границы (${bodyDescription}).`);
      }

      if (bodyTop < treeBounds.top + treeBounds.height * 0.75 - tolerance) {
        throw new Error(`Блокировщик дерева ${treeId} пересекает область кроны (${bodyDescription}).`);
      }

      if (bodyBottom > treeBounds.bottom + tolerance) {
        throw new Error(`Блокировщик дерева ${treeId} находится ниже изображения (${bodyDescription}).`);
      }

      if (
        Math.abs(blocker.x - treeBounds.centerX) > tolerance
        || Math.abs(blocker.y - (treeBounds.bottom - 8)) > tolerance
      ) {
        throw new Error(`Блокировщик дерева ${treeId} неверно выровнен (${bodyDescription}).`);
      }
    });
  }

  updateWorldDepth(gameObject) {
    const bottom = gameObject.y + gameObject.displayHeight * (1 - gameObject.originY);
    gameObject.setDepth(bottom * WORLD_DEPTH_SCALE);
  }

  createInputController() {
    this.inputController = new InputController(this, {
      onActionPointerDown: () => this.handleActionPointerDown(),
      onActionPointerEnd: () => this.releaseInteractionHold('pointer'),
      onActionPointerOut: () => this.releaseInteractionHold('pointer'),
      onBuildTypePointerDown: (buildType) => this.selectBuildType(buildType),
      onMenuPointerDown: () => {
        if (!this.isApplyingSave && !this.exitTransitionLocked) this.showExitConfirmation();
      }
    });
    this.updateInteractionTarget();
  }

  handleActionPointerDown() {
    if (!this.canHarvest()) return;
    if (this.interactionSystem.getCurrentTarget() === null) return;
    if (this.tryOpenCurrentChest()) return;
    if (!this.startInteractionHold('pointer')) this.inputController.resetActionButton();
  }

  createInteractionInterface() {
    this.interactionCleanupDone = false;
    this.holdInputSource = null;
    this.holdStartHotbarIndex = null;
    this.holdToolDisplayName = null;
    this.holdActionSystem = new HoldActionSystem();
    this.lastCampfireHealTime = -Infinity;

    this.targetMarker = this.add.circle(0, 0, 18, 0xffe16a, 0.18)
      .setStrokeStyle(3, 0xfff2a8, 0.95)
      .setDepth(INTERFACE_DEPTH - 10)
      .setVisible(false);

    this.holdProgressBackground = this.add.rectangle(0, 0, 84, 14, 0x14202a, 0.9)
      .setStrokeStyle(2, 0xfff2a8, 0.9)
      .setDepth(INTERFACE_DEPTH - 9)
      .setVisible(false);
    this.holdProgressFill = this.add.rectangle(0, 0, 78, 8, 0x6fda83, 1)
      .setOrigin(0, 0.5)
      .setDepth(INTERFACE_DEPTH - 8)
      .setVisible(false);
    this.holdProgressText = this.add.text(0, 0, '0%', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(INTERFACE_DEPTH - 7).setVisible(false);

    this.interactionHintText = this.add.text(480, 500, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#17212bcc',
      padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH).setVisible(false);

    this.interactionResultText = this.add.text(480, 148, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '24px',
      color: '#fff4b0',
      backgroundColor: '#17212bcc',
      padding: { x: 14, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH).setVisible(false);

    this.hideInteractionMessage = () => {
      this.interactionResultText.setVisible(false);
      this.interactionMessageTimer.paused = true;
    };
    this.interactionMessageTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      paused: true,
      callback: this.hideInteractionMessage
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupInteractionInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupInteractionInterface, this);
  }

  updateInteractionTarget() {
    const target = this.interactionSystem.update(
      this.player.x,
      this.player.y,
      this.interactionTargetValidator
    );
    const hasTarget = target !== null;

    if (hasTarget) {
      this.targetMarker
        .setPosition(target.interactionX, target.interactionY - 26)
        .setVisible(true);
    } else {
      this.targetMarker.setVisible(false);
    }

    this.interactionHintText
      .setText(target && target.type === 'CAMPFIRE'
        ? this.getCampfireHintText()
        : (target && target.type === 'CHEST' ? 'E: открыть сундук' : ''))
      .setVisible(Boolean(target && (target.type === 'CAMPFIRE' || target.type === 'CHEST')));

    if (this.inputController) {
      this.inputController.updateActionButtonAppearance(hasTarget);
    }
  }

  startInteractionHold(source) {
    if (!this.canHarvest()) return false;
    const target = this.interactionSystem.getCurrentTarget();
    if (target === null || this.holdInputSource !== null) return false;

    const configuration = this.getInteractionHoldConfiguration(target);
    const started = this.holdActionSystem.start(target, configuration.durationOverride);
    if (!started) return false;

    this.holdInputSource = source;
    this.holdStartHotbarIndex = configuration.hotbarIndex;
    this.holdToolDisplayName = configuration.toolDisplayName;
    this.updateHoldProgress(target, 0);
    return true;
  }

  getInteractionHoldConfiguration(target) {
    const hotbarIndex = this.inventoryUI.getActiveHotbarIndex();
    if (target.type === 'CAMPFIRE') {
      return {
        hotbarIndex,
        durationOverride: BuildCatalog.CAMPFIRE.interactionDurationMs,
        toolDisplayName: null
      };
    }
    if (target.type === 'WOOD_WALL') {
      return {
        hotbarIndex,
        durationOverride: BUILDING_DISMANTLE_DURATION_MS,
        toolDisplayName: null
      };
    }
    const slot = this.inventoryModel.getSlot(hotbarIndex);
    const item = slot === null ? null : ItemCatalog[slot.itemType];
    const isEffectiveTool = Boolean(
      item
      && item.effectiveAgainst === target.type
      && Number.isFinite(item.actionDurationMs)
      && item.actionDurationMs > 0
    );
    return {
      hotbarIndex,
      durationOverride: isEffectiveTool ? item.actionDurationMs : undefined,
      toolDisplayName: isEffectiveTool ? item.displayName : null
    };
  }

  updateInteractionHold(delta) {
    const wasActive = this.holdActionSystem.active;
    if (wasActive
      && this.inventoryUI.getActiveHotbarIndex() !== this.holdStartHotbarIndex) {
      this.cancelInteractionHold();
      return;
    }
    const completedTarget = this.holdActionSystem.update(
      delta,
      this.interactionSystem.getCurrentTarget()
    );

    if (completedTarget !== null) {
      this.completeInteraction(completedTarget);
      this.hideHoldProgress();
      this.inputController.resetActionButton();
      return;
    }

    if (wasActive && !this.holdActionSystem.active) {
      this.cancelInteractionHold();
      return;
    }

    if (this.holdActionSystem.active) {
      this.updateHoldProgress(
        this.holdActionSystem.target,
        this.holdActionSystem.getProgress()
      );
    }
  }

  updateHoldProgress(target, progress) {
    const x = target.interactionX;
    const y = target.interactionY - 50;
    const percent = Math.round(progress * 100);

    this.holdProgressBackground.setPosition(x, y).setVisible(true);
    this.holdProgressFill
      .setPosition(x - 39, y)
      .setScale(progress, 1)
      .setVisible(true);
    const toolLabel = this.holdToolDisplayName ? ` · ${this.holdToolDisplayName}` : '';
    this.holdProgressText
      .setPosition(x, y)
      .setText(`${percent}%${toolLabel}`)
      .setVisible(true);
  }

  hideHoldProgress() {
    this.holdProgressBackground.setVisible(false);
    this.holdProgressFill.setVisible(false);
    this.holdProgressText.setVisible(false);
  }

  completeInteraction(target) {
    if (target.type === 'CHEST') {
      this.openChestById(target.id);
      return;
    }
    if (target.type === 'CAMPFIRE') {
      this.completeCampfireRest(target);
      return;
    }
    if (target.type === 'WOOD_WALL') {
      this.completeBuildingDismantle(target);
      return;
    }

    const runtimeObject = this.runtimeWorldObjects.get(target.id);
    if (!runtimeObject || !runtimeObject.active) return;

    const position = this.worldGrid.cellToWorldCenter(runtimeObject.col, runtimeObject.row);
    if (!this.worldGrid.isInside(runtimeObject.col, runtimeObject.row)
      || !this.worldGrid.isWalkable(runtimeObject.col, runtimeObject.row)
      || position === null) {
      throw new Error(
        `Нельзя создать предмет после добычи ${runtimeObject.id} `
        + `(col: ${runtimeObject.col}, row: ${runtimeObject.row}).`
      );
    }

    runtimeObject.active = false;
    this.interactionSystem.removeTarget(runtimeObject.id);
    this.targetMarker.setVisible(false);
    this.hideHoldProgress();

    const drop = WORLD_OBJECT_DROPS[runtimeObject.type];
    this.groundItemSystem.spawn(drop.itemType, drop.quantity, position.x, position.y);
    this.showInteractionMessage(`${drop.itemType} ×${drop.quantity}`);

    if (this.useChunkedWorld) {
      this.markSessionResourceRemoved(runtimeObject.id);
      this.unregisterChunkWorldObject(runtimeObject.id);
      this.refreshInteractionTargets();
      return;
    }

    this.setRuntimeWorldObjectActive(runtimeObject, false);
  }

  getCampfireRecipe() {
    const recipes = Object.values(RecipeCatalog).filter(
      (recipe) => recipe.station === 'CAMPFIRE'
    );
    if (recipes.length !== 1) {
      throw new Error(`Ожидался один рецепт CAMPFIRE, найдено: ${recipes.length}.`);
    }
    return recipes[0];
  }

  getCampfireActionState() {
    const recipe = this.getCampfireRecipe();
    const availability = this.craftingModel.canCraft(recipe.id, 'CAMPFIRE');
    const hasIngredients = recipe.ingredients.every(
      (ingredient) => this.inventoryModel.getTotal(ingredient.itemType) >= ingredient.quantity
    );
    const canStoreResult = hasIngredients && availability.reason !== 'noSpace';
    const canCook = recipe.station === 'CAMPFIRE'
      && hasIngredients
      && canStoreResult
      && availability.canCraft;
    const needsHealing = !this.isPlayerDead()
      && this.playerStatsModel.getHealth() < this.playerStatsModel.getMaxHealth();
    const evaluatedAt = this.getCombatTime();
    const remainingHealCooldownMs = needsHealing
      ? Math.max(
        0,
        BuildCatalog.CAMPFIRE.healCooldownMs
          - (evaluatedAt - this.lastCampfireHealTime)
      )
      : 0;
    return {
      recipe,
      hasIngredients,
      canStoreResult,
      canCook,
      needsHealing,
      healOnCooldown: remainingHealCooldownMs > 0,
      remainingHealCooldownMs,
      evaluatedAt,
      failureReason: hasIngredients ? availability.reason : 'missingIngredients'
    };
  }

  getCampfireHintText() {
    const actionState = this.getCampfireActionState();
    if (actionState.canCook) return 'Удерживайте E: приготовить похлёбку';
    if (actionState.needsHealing) return 'Удерживайте E: отдохнуть у костра';
    return 'Удерживайте E: использовать костёр';
  }

  getCampfireRequirementsText(recipe) {
    return recipe.ingredients.map((ingredient) => (
      `${ItemCatalog[ingredient.itemType].displayName} ×${ingredient.quantity}`
    )).join(', ');
  }

  completeCampfireRest(target) {
    const building = this.buildingSystem.getPlacement(target.id);
    const currentTarget = this.interactionSystem.getCurrentTarget();
    if (building === null
      || building.buildType !== 'CAMPFIRE'
      || target.building !== building
      || target.buildType !== building.buildType
      || currentTarget === null
      || currentTarget.id !== target.id
      || !this.isInteractionTargetValid(target)
      || this.isPlayerDead()) return false;

    const actionState = this.getCampfireActionState();
    if (actionState.canCook) {
      const craftResult = this.craftingModel.craft(actionState.recipe.id, 'CAMPFIRE');
      if (!craftResult.success) {
        throw new Error(`Не удалось выполнить доступный рецепт костра: ${craftResult.reason}.`);
      }
      this.inventoryUI.updateFromModel();
      this.updateInventoryHud();
      this.showInteractionMessage(
        `Приготовлено: ${ItemCatalog[craftResult.resultItemType].displayName} ×${craftResult.resultQuantity}`
      );
      return true;
    }

    const definition = BuildCatalog.CAMPFIRE;
    const healthBefore = this.playerStatsModel.getHealth();
    if (!actionState.needsHealing) {
      if (actionState.failureReason === 'noSpace') {
        this.showInteractionMessage('Нет места для мясной похлёбки');
      } else {
        this.showInteractionMessage(
          `Для похлёбки нужно: ${this.getCampfireRequirementsText(actionState.recipe)}`
        );
      }
      return false;
    }

    if (actionState.healOnCooldown) {
      this.showInteractionMessage(
        `Костёр ещё не готов. Осталось: ${Math.ceil(actionState.remainingHealCooldownMs / 1000)} сек.`
      );
      return false;
    }

    this.playerStatsModel.restoreHealth(definition.healAmount);
    const healthAfter = this.playerStatsModel.getHealth();
    const healed = healthAfter - healthBefore;
    if (healed <= 0) return false;

    this.lastCampfireHealTime = actionState.evaluatedAt;
    this.statusHUD.update(healthAfter, this.playerStatsModel.getHunger());
    this.showInteractionMessage(`Вы отдохнули у костра. Здоровье +${healed}`);
    return true;
  }

  completeBuildingDismantle(target) {
    const building = this.buildingSystem.getPlacement(target.id);
    if (building === null) return false;
    if (target.building !== building || target.buildType !== building.buildType) {
      throw new Error(`Цель постройки ${target.id} больше не соответствует активной постройке.`);
    }

    const definition = BuildCatalog[building.buildType];
    const position = this.worldGrid.cellToWorldCenter(building.col, building.row);
    if (!definition || position === null) {
      throw new Error(
        `Нельзя разобрать постройку ${building.id} `
        + `(тип: ${building.buildType}, col: ${building.col}, row: ${building.row}).`
      );
    }
    const refunds = definition.cost.map((ingredient) => ({
      itemType: ingredient.itemType,
      quantity: Math.ceil(ingredient.quantity * 0.5)
    })).filter((refund) => refund.quantity > 0);

    const removed = this.buildingSystem.remove(building.id);
    if (removed === null) return false;
    this.refreshInteractionTargets();
    this.targetMarker.setVisible(false);
    this.hideHoldProgress();
    refunds.forEach((refund) => {
      this.groundItemSystem.spawn(
        refund.itemType,
        refund.quantity,
        position.x,
        position.y
      );
    });
    const refundText = refunds.map(
      (refund) => `${refund.itemType} ×${refund.quantity}`
    ).join(', ');
    this.showInteractionMessage(`Разобрано: ${definition.displayName}. Возврат: ${refundText}`);
    return true;
  }

  setRuntimeWorldObjectActive(runtimeObject, active) {
    runtimeObject.active = active;
    if (runtimeObject.visualObject && runtimeObject.visualObject.active) {
      runtimeObject.visualObject.setVisible(active);
    }
    if (runtimeObject.blockerObject && runtimeObject.blockerObject.body) {
      runtimeObject.blockerObject.body.enable = active;
      if (runtimeObject.blockerObject === runtimeObject.visualObject) {
        runtimeObject.blockerObject.setVisible(active);
      }
    }
  }

  restoreRemovedWorldObjects(removedIds) {
    const removed = new Set(removedIds);
    this.runtimeWorldObjects.forEach((object) => {
      this.setRuntimeWorldObjectActive(object, !removed.has(object.id));
    });
    this.refreshInteractionTargets();
  }

  showInteractionMessage(message) {
    this.interactionResultText
      .setText(message)
      .setVisible(true);

    this.interactionMessageTimer.reset({
      delay: 1000,
      loop: true,
      paused: false,
      callback: this.hideInteractionMessage
    });
  }

  cancelInteractionHold() {
    this.holdActionSystem.release();
    this.holdInputSource = null;
    this.holdStartHotbarIndex = null;
    this.holdToolDisplayName = null;
    this.hideHoldProgress();
    this.resetActionButton();
  }

  releaseInteractionHold(source) {
    if (this.holdInputSource !== source) return;

    this.holdActionSystem.release();
    this.holdInputSource = null;
    this.holdStartHotbarIndex = null;
    this.holdToolDisplayName = null;
    this.hideHoldProgress();
    this.resetActionButton();
  }

  resetActionButton() {
    if (this.inputController) this.inputController.resetActionButton();
  }

  cleanupInteractionInterface() {
    if (this.interactionCleanupDone) return;
    this.interactionCleanupDone = true;
    this.lastCampfireHealTime = -Infinity;
    this.cancelInteractionHold();
    if (this.groundItemSystem) {
      this.groundItemSystem.clear();
      this.groundItemSystem = null;
    }
    if (this.runtimeWorldObjects) this.runtimeWorldObjects.clear();
    if (this.inventoryModel) {
      this.inventoryModel.clear();
    }
    if (this.playerMapCollider) {
      this.playerMapCollider.destroy();
      this.playerMapCollider = null;
    }
    if (this.worldObjectsCollider) {
      this.worldObjectsCollider.destroy();
      this.worldObjectsCollider = null;
    }

    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupInteractionInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupInteractionInterface, this);

    if (this.interactionMessageTimer) {
      this.interactionMessageTimer.remove(false);
      this.interactionMessageTimer = null;
    }
    this.interactionHintText = null;
  }

  createCamera() {
    const camera = this.cameras.main;
    if (this.useChunkedWorld) {
      camera.removeBounds();
    } else {
      camera.setBounds(0, 0, this.worldGrid.worldWidth, this.worldGrid.worldHeight);
    }
    camera.startFollow(this.player, true, 0.09, 0.09);
    camera.setRoundPixels(true);
  }

  createDayNightInterface() {
    this.dayNightCleanupDone = false;
    this.lastDayNightHudStateKey = null;
    this.dayNightOverlay = this.add.rectangle(480, 270, 960, 540, 0x07162d, 1)
      .setScrollFactor(0)
      .setDepth(DAY_NIGHT_OVERLAY_DEPTH);
    this.dayNightHudText = this.add.text(34, 160, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      fontStyle: 'bold',
      color: '#d9edff',
      backgroundColor: '#111820d9',
      padding: { x: 10, y: 6 }
    }).setScrollFactor(0).setDepth(INTERFACE_DEPTH);
    this.applyDayNightVisuals(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupDayNightInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupDayNightInterface, this);
  }

  applyDayNightVisuals(forceHudUpdate) {
    if (!this.dayNightSystem) return;
    if (this.dayNightOverlay && this.dayNightOverlay.active) {
      this.dayNightOverlay.setAlpha(this.dayNightSystem.getOverlayAlpha());
    }
    const stateKey = this.dayNightSystem.getHudStateKey();
    if ((forceHudUpdate || stateKey !== this.lastDayNightHudStateKey)
      && this.dayNightHudText && this.dayNightHudText.active) {
      this.dayNightHudText.setText(this.dayNightSystem.formatHud());
      this.lastDayNightHudStateKey = stateKey;
    }
  }

  cleanupDayNightInterface() {
    if (this.dayNightCleanupDone) return;
    this.dayNightCleanupDone = true;
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupDayNightInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupDayNightInterface, this);
    if (this.dayNightOverlay && this.dayNightOverlay.active) this.dayNightOverlay.destroy();
    if (this.dayNightHudText && this.dayNightHudText.active) this.dayNightHudText.destroy();
    this.dayNightOverlay = null;
    this.dayNightHudText = null;
    this.dayNightSystem = null;
  }

  createInterface() {
    this.inventoryHudText = this.add.text(34, 34, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#fff4b0',
      backgroundColor: '#111820d9',
      padding: { x: 10, y: 6 }
    }).setScrollFactor(0).setDepth(INTERFACE_DEPTH);
    this.updateInventoryHud();
  }

  createInventoryUI() {
    this.inventoryUI = new InventoryUI(
      this,
      this.inventoryModel,
      ITEM_TEXTURE_KEYS,
      (isOpen) => this.handleInventoryOpenChanged(isOpen),
      () => this.canOpenPanel(),
      () => this.canSelectHotbarSlot()
    );
  }

  createCraftingUI() {
    this.craftingUI = new CraftingUI(
      this,
      this.craftingModel,
      (isOpen) => this.handleCraftingOpenChanged(isOpen),
      (result, recipe) => this.handleCraftResult(result, recipe),
      () => this.canOpenPanel(),
      ITEM_TEXTURE_KEYS
    );
  }

  createChestUI() {
    this.openChestId = null;
    this.chestUI = new ChestUI(
      this,
      this.inventoryModel,
      ITEM_TEXTURE_KEYS,
      () => this.getOpenChestContext(),
      (isOpen) => this.handleChestOpenChanged(isOpen),
      () => {
        this.inventoryUI.updateFromModel();
        this.updateInventoryHud();
      }
    );
  }

  getOpenChestContext() {
    if (typeof this.openChestId !== 'string' || !this.buildingSystem) return null;
    const placement = this.buildingSystem.getPlacement(this.openChestId);
    const storage = this.buildingSystem.getChestStorage(this.openChestId);
    if (!placement || placement.buildType !== 'CHEST' || !storage) return null;
    return { chestId: placement.id, storage };
  }

  tryOpenCurrentChest() {
    const target = this.interactionSystem ? this.interactionSystem.getCurrentTarget() : null;
    if (!target || target.type !== 'CHEST') return false;
    return this.openChestById(target.id);
  }

  openChestById(chestId) {
    if (!this.canHarvest() || this.buildingSystem.isActive()) return false;
    const currentTarget = this.interactionSystem.getCurrentTarget();
    const placement = this.buildingSystem.getPlacement(chestId);
    const storage = this.buildingSystem.getChestStorage(chestId);
    if (!currentTarget || currentTarget.id !== chestId || currentTarget.type !== 'CHEST'
      || !this.isInteractionTargetValid(currentTarget)
      || !placement || placement.buildType !== 'CHEST' || !storage) return false;
    if (this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.cancelInteractionHold();
    this.openChestId = chestId;
    if (!this.chestUI.openPanel()) {
      this.openChestId = null;
      return false;
    }
    return true;
  }

  closeChestPanel() {
    if (this.chestUI && this.chestUI.isOpen) return this.chestUI.closePanel();
    this.openChestId = null;
    return false;
  }

  isBlockingPanelOpen() {
    return this.isModalOpen();
  }

  handleCraftResult(result, recipe) {
    if (result.success) {
      this.inventoryUI.updateFromModel();
      this.updateInventoryHud();
      this.showInteractionMessage(`Создано: ${recipe.displayName}`);
    } else if (result.reason === 'missingIngredients') {
      this.showInteractionMessage('Недостаточно ресурсов');
    } else if (result.reason === 'noSpace') {
      this.showInteractionMessage('Нет места в инвентаре');
    }
  }

  createSurvivalInterface() {
    this.survivalCleanupDone = false;
    this.statusHUD = new StatusHUD(this);
    this.statusHUD.update(this.playerStatsModel.getHealth(), this.playerStatsModel.getHunger());

    this.deathText = this.add.text(480, 270, 'Вы погибли', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '44px',
      fontStyle: 'bold',
      color: '#ff9b9b',
      backgroundColor: '#111820e6',
      padding: { x: 24, y: 14 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 50).setVisible(false);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSurvivalInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupSurvivalInterface, this);
  }

  initializeSelectedSlot() {
    if (this.launchMode === 'continue') {
      if (!this.loadGame()) {
        this.scene.start('MenuScene', { message: 'Не удалось загрузить выбранное сохранение.' });
      }
      return;
    }

    const slotState = this.saveSlotManager.inspectSlot(this.activeSlotId);
    if (slotState.status !== 'EMPTY') {
      this.scene.start('MenuScene', {
        message: slotState.status === 'CORRUPT'
          ? 'Новая игра не создана: слот повреждён и требует сброса.'
          : 'Новая игра не создана: выбранный слот уже занят.'
      });
      return;
    }
    const result = this.saveSystem.save(this.createSaveState());
    if (!result.success) {
      this.scene.start('MenuScene', { message: 'Не удалось создать сохранение: хранилище недоступно.' });
    }
  }

  createSaveState() {
    const stats = this.playerStatsModel.exportState();
    const state = { version: 1, savedAt: Date.now(), player: { x: this.player.x, y: this.player.y, ...stats },
      dayNight: this.dayNightSystem.exportState(),
      inventory: { activeHotbarIndex: this.inventoryUI.getActiveHotbarIndex(), slots: this.inventoryModel.exportState() },
      world: {
        removedObjectIds: Array.from(this.runtimeWorldObjects.values()).filter((o) => !o.active).map((o) => o.id),
        groundItems: this.groundItemSystem.exportState(), walls: this.buildingSystem.exportState(),
        deadCreatureIds: this.creatureSystem.exportState(),
        removedResources: SaveSystem.normalizeRemovedResources(
          Array.from(this.sessionRemovedResourceIds || [])
        )
      } };
    if (this.worldSeed !== undefined && this.worldSeed !== null) {
      state.worldSeed = this.worldSeed;
    }
    return state;
  }

  prepareForSaveOperation() {
    this.cancelInteractionHold(); this.exitBuildMode();
    if (this.interactionHintText) this.interactionHintText.setVisible(false);
    if (this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.closeChestPanel();
    this.inventoryUI.resetBackpackPointer(); this.craftingUI.resetPointer();
    if (this.inputController) {
      this.inputController.resetHardwareState();
      this.inputController.resetBuildTogglePointer();
      this.inputController.resetPlacePointer();
      this.inputController.resetAttackButton();
      this.inputController.resetUseButton();
    }
    this.player.setVelocity(0, 0);
    if (this.projectileSystem) this.projectileSystem.clearProjectiles();
  }

  saveGame() {
    if (!this.canSave()) {
      if (this.isPlayerDead()) this.showInteractionMessage('Нельзя сохраняться после смерти');
      return false;
    }
    this.prepareForSaveOperation();
    const result = this.saveSystem.save(this.createSaveState());
    this.showInteractionMessage(result.success ? 'Игра сохранена' : 'Ошибка локального хранилища');
    return result.success;
  }

  isSavedPositionValid(x, y) {
    const cell = this.worldGrid.worldToCell(x, y);
    if (!cell || !this.worldGrid.isWalkable(cell.col, cell.row)) return false;
    const halfWidth = this.player.body.width / 2;
    const halfHeight = this.player.body.height / 2;
    const left = x - halfWidth;
    const right = x + halfWidth;
    const top = y - halfHeight;
    const bottom = y + halfHeight;
    const topLeftCell = this.worldGrid.worldToCell(left + 0.001, top + 0.001);
    const bottomRightCell = this.worldGrid.worldToCell(right - 0.001, bottom - 0.001);
    if (!topLeftCell || !bottomRightCell) return false;
    for (let row = topLeftCell.row; row <= bottomRightCell.row; row += 1) {
      for (let col = topLeftCell.col; col <= bottomRightCell.col; col += 1) {
        if (!this.worldGrid.isWalkable(col, row)) return false;
      }
    }
    return !this.blockingWorldObjects.getChildren().some((blocker) => {
      const body = blocker && blocker.body;
      return blocker.active && body && body.enable
        && left < body.right && right > body.left
        && top < body.bottom && bottom > body.top;
    });
  }

  findSafePlayerPosition(x, y) {
    if (this.isSavedPositionValid(x, y)) return { x, y };
    if (this.useChunkedWorld) {
      if (this.chunkManager) {
        this.chunkManager.syncAround(x, y);
      }
      if (this.isSavedPositionValid(x, y)) return { x, y };
      const spawn = this.chunkManager
        ? this.chunkManager.getSpawnWorldPosition()
        : this.worldGrid.cellToWorldCenter(8, 8);
      if (spawn && this.isSavedPositionValid(spawn.x, spawn.y)) return spawn;
      return spawn || { x: 8 * 32 + 16, y: 8 * 32 + 16 };
    }
    const start = FixedMapData.playerStart;
    const cells = [];
    for (let row = 0; row < this.worldGrid.rows; row += 1) for (let col = 0; col < this.worldGrid.columns; col += 1) {
      cells.push({ col, row, distance: Math.abs(col - start.col) + Math.abs(row - start.row) });
    }
    cells.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
    for (const cell of cells) {
      const p = this.worldGrid.cellToWorldCenter(cell.col, cell.row);
      if (this.isSavedPositionValid(p.x, p.y)) return p;
    }
    throw new Error('Не найдена допустимая позиция игрока.');
  }

  applySaveState(state) {
    if (!this.inventoryModel.importState(state.inventory.slots)
      || !this.playerStatsModel.importState(state.player)) throw new Error('Ошибка импорта сохранения.');
    if (state.worldSeed !== undefined && state.worldSeed !== null) {
      this.worldSeed = state.worldSeed;
      if (this.chunkManager) this.chunkManager.worldSeed = state.worldSeed;
    } else if (this.worldSeed === undefined || this.worldSeed === null) {
      this.worldSeed = this.createNewWorldSeed();
      if (this.chunkManager) this.chunkManager.worldSeed = this.worldSeed;
    }
    this.applySessionRemovedResources(state.world && state.world.removedResources);
    this.dayNightSystem.importState(state.dayNight);
    this.applyDayNightVisuals(true);
    if (!this.useChunkedWorld) {
      this.restoreRemovedWorldObjects(state.world.removedObjectIds);
    }
    if (!this.groundItemSystem.restoreState(state.world.groundItems)
      || !this.buildingSystem.restoreState(Array.isArray(state.world.walls) ? state.world.walls : [])
      || !this.creatureSystem.restoreState(this.useChunkedWorld ? [] : state.world.deadCreatureIds)) {
      throw new Error('Ошибка импорта сохранения.');
    }
    this.refreshInteractionTargets();
    const position = this.findSafePlayerPosition(state.player.x, state.player.y);
    if (this.chunkManager) {
      this.chunkManager.syncAround(position.x, position.y);
      this.refreshInteractionTargets();
    }
    this.player.setVisible(true);
    this.player.body.enable = true;
    this.player.setPosition(position.x, position.y); this.player.body.reset(position.x, position.y);
    this.resetPlayerCombatState();
    this.lastCampfireHealTime = -Infinity;
    this.creatureSystem.resetTransientState();
    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
    this.inventoryUI.setActiveQuickSlot(state.inventory.activeHotbarIndex);
    this.isDeathHandled = this.playerStatsModel.isDead();
    this.lastPlayerAttackTime = -Infinity;
    this.updateDeathPresentation();
    this.inventoryUI.updateFromModel(); this.updateInventoryHud();
    this.statusHUD.update(this.playerStatsModel.getHealth(), this.playerStatsModel.getHunger());
  }

  loadGame() {
    if (!this.canLoad()) return false;
    const loaded = this.saveSystem.load();
    if (!loaded.success) {
      const messages = { notFound: 'Сохранение не найдено', invalidData: 'Сохранение повреждено', storageError: 'Ошибка локального хранилища' };
      this.showInteractionMessage(messages[loaded.reason]); return false;
    }
    const rollback = this.createSaveState(); this.isApplyingSave = true;
    try { this.prepareForSaveOperation(); this.applySaveState(loaded.state); this.showInteractionMessage('Игра загружена'); return true; }
    catch { try { this.applySaveState(rollback); } catch {} this.showInteractionMessage('Сохранение повреждено'); return false; }
    finally { this.isApplyingSave = false; }
  }

  createMenuExitInterface() {
    this.exitConfirmOpen = false;
    this.exitTransitionLocked = false;
    this.exitTransitionScheduled = false;
    this.exitTransitionPostUpdateHandler = null;
    this.menuExitCleanupDone = false;
    const modalDepth = INTERFACE_DEPTH + 100;
    this.exitModalOverlay = this.add.rectangle(480, 270, 960, 540, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(modalDepth).setVisible(false);
    this.exitModalPanel = this.add.rectangle(480, 270, 570, 220, 0x17232d, 1)
      .setStrokeStyle(3, 0xbad5e8, 0.9).setScrollFactor(0).setDepth(modalDepth + 1).setVisible(false);
    this.exitModalText = this.add.text(480, 225, 'Сохранить игру и выйти в меню?', {
      fontFamily: 'Arial, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(modalDepth + 2).setVisible(false);
    this.exitConfirmButton = this.add.rectangle(390, 325, 160, 46, 0x3d7651, 1)
      .setStrokeStyle(2, 0xcbe9ff, 0.85).setScrollFactor(0).setDepth(modalDepth + 2).setVisible(false);
    this.exitConfirmText = this.add.text(390, 325, 'СОХРАНИТЬ', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(modalDepth + 3).setVisible(false);
    this.exitCancelButton = this.add.rectangle(570, 325, 160, 46, 0x5d3e43, 1)
      .setStrokeStyle(2, 0xcbe9ff, 0.85).setScrollFactor(0).setDepth(modalDepth + 2).setVisible(false);
    this.exitCancelText = this.add.text(570, 325, 'ОТМЕНА', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(modalDepth + 3).setVisible(false);

    this.onExitConfirmDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.exitTransitionLocked || this.exitTransitionScheduled) return;
      this.saveAndExitToMenu();
    };
    this.onExitCancelDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.hideExitConfirmation();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupMenuExitInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupMenuExitInterface, this);
  }

  showExitConfirmation() {
    if (this.exitConfirmOpen || this.exitTransitionLocked) return;
    this.exitConfirmOpen = true;
    this.cancelInteractionHold();
    if (this.inventoryUI && this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (this.craftingUI && this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.closeChestPanel();
    if (this.inventoryUI) this.inventoryUI.setInteractionBlocked(true);
    if (this.inputController) this.inputController.setGameControlsBlocked(true);
    if (this.player && this.player.body) this.player.setVelocity(0, 0);
    this.exitConfirmButton.setInteractive({ useHandCursor: true });
    this.exitCancelButton.setInteractive({ useHandCursor: true });
    this.exitConfirmText.setInteractive({ useHandCursor: true });
    this.exitCancelText.setInteractive({ useHandCursor: true });
    this.exitConfirmButton.on('pointerdown', this.onExitConfirmDown);
    this.exitCancelButton.on('pointerdown', this.onExitCancelDown);
    this.exitConfirmText.on('pointerdown', this.onExitConfirmDown);
    this.exitCancelText.on('pointerdown', this.onExitCancelDown);
    [this.exitModalOverlay, this.exitModalPanel, this.exitModalText, this.exitConfirmButton,
      this.exitConfirmText, this.exitCancelButton, this.exitCancelText]
      .forEach((element) => element.setVisible(true));
    [
      this.exitModalOverlay,
      this.exitModalPanel,
      this.exitModalText,
      this.exitConfirmButton,
      this.exitConfirmText,
      this.exitCancelButton,
      this.exitCancelText
    ].forEach((element) => this.children.bringToTop(element));
  }

  disableExitModalInteractivity() {
    if (this.exitConfirmButton) this.exitConfirmButton.disableInteractive();
    if (this.exitCancelButton) this.exitCancelButton.disableInteractive();
    if (this.exitConfirmText) this.exitConfirmText.disableInteractive();
    if (this.exitCancelText) this.exitCancelText.disableInteractive();
  }

  enableExitModalInteractivity() {
    if (!this.exitConfirmOpen || this.exitTransitionLocked || this.exitTransitionScheduled) return;
    this.exitConfirmButton.setInteractive({ useHandCursor: true });
    this.exitCancelButton.setInteractive({ useHandCursor: true });
    this.exitConfirmText.setInteractive({ useHandCursor: true });
    this.exitCancelText.setInteractive({ useHandCursor: true });
  }

  cancelExitTransitionSchedule() {
    if (this.exitTransitionPostUpdateHandler) {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.exitTransitionPostUpdateHandler, this);
      this.exitTransitionPostUpdateHandler = null;
    }
    this.exitTransitionScheduled = false;
  }

  scheduleExitToMenu() {
    if (this.exitTransitionScheduled || !this.sys || !this.sys.isActive()) return;
    this.exitTransitionScheduled = true;
    this.exitTransitionPostUpdateHandler = () => {
      this.exitTransitionPostUpdateHandler = null;
      if (!this.sys || !this.sys.isActive()) {
        this.exitTransitionScheduled = false;
        this.exitTransitionLocked = false;
        this.enableExitModalInteractivity();
        return;
      }
      if (!this.exitTransitionLocked || !this.exitTransitionScheduled) return;
      this.scene.start('MenuScene');
    };
    this.events.once(
      Phaser.Scenes.Events.POST_UPDATE,
      this.exitTransitionPostUpdateHandler,
      this
    );
  }

  hideExitConfirmation() {
    if (!this.exitConfirmOpen) return;
    this.cancelExitTransitionSchedule();
    this.exitConfirmOpen = false;
    this.exitConfirmButton.disableInteractive();
    this.exitCancelButton.disableInteractive();
    this.exitConfirmText.disableInteractive();
    this.exitCancelText.disableInteractive();
    this.exitConfirmButton.off('pointerdown', this.onExitConfirmDown);
    this.exitCancelButton.off('pointerdown', this.onExitCancelDown);
    this.exitConfirmText.off('pointerdown', this.onExitConfirmDown);
    this.exitCancelText.off('pointerdown', this.onExitCancelDown);
    if (this.inputController) this.inputController.setGameControlsBlocked(false);
    if (this.inventoryUI && !this.inventoryUI.destroyed) this.inventoryUI.setInteractionBlocked(false);
    [this.exitModalOverlay, this.exitModalPanel, this.exitModalText, this.exitConfirmButton,
      this.exitConfirmText, this.exitCancelButton, this.exitCancelText]
      .forEach((element) => element.setVisible(false));
  }

  saveAndExitToMenu() {
    if (!this.exitConfirmOpen || this.exitTransitionLocked || this.exitTransitionScheduled || this.isPlayerDead()) {
      if (this.isPlayerDead()) {
        this.hideExitConfirmation();
        this.showInteractionMessage('Нельзя сохраняться после смерти');
      }
      return false;
    }
    this.exitTransitionLocked = true;
    this.disableExitModalInteractivity();
    this.prepareForSaveOperation();
    const result = this.saveSystem.save(this.createSaveState());
    if (!result.success) {
      this.exitTransitionLocked = false;
      this.cancelExitTransitionSchedule();
      this.enableExitModalInteractivity();
      this.showInteractionMessage('Ошибка локального хранилища');
      return false;
    }
    this.scheduleExitToMenu();
    return true;
  }

  cleanupMenuExitInterface() {
    if (this.menuExitCleanupDone) return;
    this.menuExitCleanupDone = true;
    this.exitConfirmOpen = false;
    this.cancelExitTransitionSchedule();
    if (this.inputController && !this.exitTransitionLocked) {
      this.inputController.setGameControlsBlocked(false);
    }
    if (this.exitConfirmButton) this.exitConfirmButton.off('pointerdown', this.onExitConfirmDown);
    if (this.exitCancelButton) this.exitCancelButton.off('pointerdown', this.onExitCancelDown);
    if (this.exitConfirmText) this.exitConfirmText.off('pointerdown', this.onExitConfirmDown);
    if (this.exitCancelText) this.exitCancelText.off('pointerdown', this.onExitCancelDown);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupMenuExitInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupMenuExitInterface, this);
    const elements = [];
    elements.push(this.exitModalOverlay, this.exitModalPanel, this.exitModalText,
      this.exitConfirmButton, this.exitConfirmText, this.exitCancelButton, this.exitCancelText);
    elements.forEach((element) => { if (element && element.active) element.destroy(); });
  }

  createCombatInterface() {
    this.combatCleanupDone = false;
    this.lastPlayerAttackTime = -Infinity;
    this.resetPlayerCombatState();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupCombatInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupCombatInterface, this);
  }

  resetAttackButton() {
    if (this.inputController) this.inputController.resetAttackButton();
  }

  getCombatTime() {
    return this.time && Number.isFinite(this.time.now) ? this.time.now : 0;
  }

  resetPlayerCombatState() {
    this.invulnerableUntil = 0;
    this.playerHitFlashUntil = 0;
    if (this.player && this.player.active) {
      this.player.clearTint();
      if (this.player.body) this.player.body.setVelocity(0, 0);
    }
  }

  handleCreatureContactAttack(attack) {
    const time = this.getCombatTime();
    if (!attack || this.isPlayerDead() || time < this.invulnerableUntil) return false;
    const damage = this.playerStatsModel.takeDamage(attack.damage);
    if (damage <= 0) return false;
    this.invulnerableUntil = time + CombatConfig.PLAYER.invulnerabilityMs;
    this.playerHitFlashUntil = time + CombatConfig.PLAYER.flashMs;
    this.player.setTint(0xffb5b5);
    return true;
  }

  updatePlayerHitFlash() {
    const time = this.getCombatTime();
    if (!this.player || !this.player.active) return;
    if (time < this.playerHitFlashUntil) this.player.setTint(0xffb5b5);
    else this.player.clearTint();
  }

  getActiveHotbarItemDefinition() {
    const slotIndex = this.inventoryUI.getActiveHotbarIndex();
    const slot = this.inventoryModel.getSlot(slotIndex);
    return slot === null ? null : ItemCatalog[slot.itemType] || null;
  }

  getPlayerAttackDamage() {
    const item = this.getActiveHotbarItemDefinition();
    return item
      && item.category === 'WEAPON'
      && Number.isFinite(item.attackDamage)
      && item.attackDamage > 0
      ? item.attackDamage
      : PLAYER_MELEE_ATTACK.damage;
  }

  getFacingVector() {
    const vectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };
    return vectors[this.lastFacingDirection] || vectors.down;
  }

  tryPlayerAttack() {
    const time = this.getCombatTime();
    if (!this.canAttack()) return false;
    const activeItem = this.getActiveHotbarItemDefinition();
    const isBow = Boolean(activeItem && activeItem.attackType === 'RANGED');
    const cooldownMs = isBow ? activeItem.attackCooldownMs : PLAYER_MELEE_ATTACK.cooldownMs;
    if (time - this.lastPlayerAttackTime < cooldownMs) {
      return false;
    }
    this.lastPlayerAttackTime = time;
    if (isBow) {
      const direction = this.getFacingVector();
      const spawnOffset = 24;
      this.projectileSystem.spawn({
        x: this.player.x + direction.x * spawnOffset,
        y: this.player.y + direction.y * spawnOffset,
        directionX: direction.x,
        directionY: direction.y,
        speed: activeItem.projectileSpeed,
        range: activeItem.projectileRange,
        damage: activeItem.attackDamage
      });
      return true;
    }

    const creatureTarget = this.creatureSystem.getNearestAttackable(
      this.player.x, this.player.y, PLAYER_MELEE_ATTACK.radius
    );
    const npcTarget = this.findNearestAttackableNpc(
      this.player.x, this.player.y, PLAYER_MELEE_ATTACK.radius
    );
    if (!creatureTarget && !npcTarget) return true;

    const creatureDistanceSquared = creatureTarget
      ? ((creatureTarget.sprite.x - this.player.x) ** 2)
        + ((creatureTarget.sprite.y - this.player.y) ** 2)
      : Number.POSITIVE_INFINITY;
    const preferNpc = npcTarget
      && (
        !creatureTarget
        || npcTarget.distanceSquared < creatureDistanceSquared
        || (
          npcTarget.distanceSquared === creatureDistanceSquared
          && String(npcTarget.npcObject.getData('npcId') || '')
            < String(creatureTarget.id || '')
        )
      );

    const actualDamage = this.getPlayerAttackDamage();
    if (preferNpc) {
      npcTarget.instance.applyNpcDamage(npcTarget.npcObject, actualDamage);
      return true;
    }

    const deathX = creatureTarget.sprite.x;
    const deathY = creatureTarget.sprite.y;
    const result = this.creatureSystem.damage(creatureTarget.id, actualDamage);
    this.handleCreatureDamageResult(creatureTarget, result, deathX, deathY);
    return true;
  }

  findNearestAttackableNpc(x, y, radius) {
    if (!this.useChunkedWorld || !this.chunkManager || !this.chunkManager.chunks) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      return null;
    }

    let nearest = null;
    this.chunkManager.chunks.forEach((instance) => {
      if (!instance || typeof instance.getNearestAttackableNpc !== 'function') return;
      const npcObject = instance.getNearestAttackableNpc(x, y, radius);
      if (!npcObject) return;
      const dx = npcObject.x - x;
      const dy = npcObject.y - y;
      const distanceSquared = dx * dx + dy * dy;
      if (
        !nearest
        || distanceSquared < nearest.distanceSquared
        || (
          distanceSquared === nearest.distanceSquared
          && String(npcObject.getData('npcId') || '')
            < String(nearest.npcObject.getData('npcId') || '')
        )
      ) {
        nearest = { instance, npcObject, distanceSquared };
      }
    });
    return nearest;
  }

  handleProjectileCreatureHit(projectile, creatureSprite) {
    if (!projectile || !creatureSprite || !this.creatureSystem) return false;
    const target = this.creatureSystem.getCreatures().find(
      (creature) => creature.active && creature.sprite === creatureSprite
    );
    if (!target) return false;
    const deathX = target.sprite.x;
    const deathY = target.sprite.y;
    const result = this.creatureSystem.damage(target.id, projectile.damage);
    this.handleCreatureDamageResult(target, result, deathX, deathY);
    return result.damage > 0;
  }

  handleCreatureDamageResult(target, result, deathX, deathY) {
    if (result.damage > 0) {
      const creatureDefinition = CreatureCatalog[target.type];
      const loot = creatureDefinition ? creatureDefinition.loot : null;
      const displayName = creatureDefinition.displayName;
      if (result.died) {
        if (!Array.isArray(loot) || loot.length === 0 || loot.some((drop) => (
          !drop
          || !ItemCatalog[drop.itemId]
          || !Number.isInteger(drop.minQuantity)
          || !Number.isInteger(drop.maxQuantity)
          || drop.minQuantity <= 0
          || drop.maxQuantity < drop.minQuantity
        ))) {
          throw new Error(`Некорректная конфигурация лута существа: ${target.type}.`);
        }
        const groundItemsBefore = this.groundItemSystem.getItems().length;
        const droppedItems = loot.map((drop, index) => {
          const quantity = Phaser.Math.Between(drop.minQuantity, drop.maxQuantity);
          const offsetX = (index - (loot.length - 1) / 2) * 12;
          return this.groundItemSystem.spawn(
            drop.itemId,
            quantity,
            deathX + offsetX,
            deathY
          );
        });
        const groundItemsAfter = this.groundItemSystem.getItems();
        const dropsAreValid = groundItemsAfter.length === groundItemsBefore + loot.length
          && droppedItems.every((droppedItem, index) => {
            const definition = loot[index];
            const textureKey = this.groundItemSystem.textureKeys[definition.itemId];
            const expectedX = deathX + (index - (loot.length - 1) / 2) * 12;
            return groundItemsAfter.includes(droppedItem)
              && droppedItem.itemType === definition.itemId
              && droppedItem.quantity >= definition.minQuantity
              && droppedItem.quantity <= definition.maxQuantity
              && droppedItem.x === expectedX
              && droppedItem.y === deathY
              && droppedItem.visualObject
              && droppedItem.visualObject.active
              && droppedItem.visualObject.visible
              && droppedItem.visualObject.alpha > 0
              && droppedItem.visualObject.texture.key === textureKey
              && this.textures.exists(textureKey);
          });
        if (!dropsAreValid) {
          throw new Error(
            `Не удалось создать весь лут существа ${target.type} в (${deathX}, ${deathY}).`
          );
        }
      }
      const message = result.died
        ? `${displayName} побеждён`
        : `Удар: ${displayName} -${result.damage}. Осталось ${result.health} HP`;
      this.showInteractionMessage(message);
    }
  }

  cleanupCombatInterface() {
    if (this.combatCleanupDone) return;
    this.combatCleanupDone = true;
    this.resetAttackButton();
    this.resetPlayerCombatState();
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupCombatInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupCombatInterface, this);
    if (this.projectileSystem) this.projectileSystem.destroy();
    this.projectileSystem = null;
    if (this.creatureMapCollider) this.creatureMapCollider.destroy();
    if (this.creatureObstacleCollider) this.creatureObstacleCollider.destroy();
    if (this.creatureSystem) this.creatureSystem.clear();
    this.creatureMapCollider = null;
    this.creatureObstacleCollider = null;
    this.creatureSystem = null;
  }

  createBuildingInterface() {
    this.buildingCleanupDone = false;
    this.selectedBuildType = Object.keys(BuildCatalog)[0];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupBuildingInterface, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupBuildingInterface, this);
  }

  selectBuildType(buildType) {
    if (!BuildCatalog[buildType] || !this.buildingSystem.isActive()) return false;
    this.selectedBuildType = buildType;
    this.buildingSystem.enterMode(buildType);
    this.updateBuildTypeControls();
    this.updateBuildingPreview();
    return true;
  }

  setBuildTypeControlsVisible(visible) {
    if (!this.inputController) return;
    this.inputController.buildTypeControls.forEach((control) => {
      control.button.setVisible(visible);
      control.label.setVisible(visible);
      if (visible) control.button.setInteractive();
      else control.button.disableInteractive();
    });
    if (visible) this.updateBuildTypeControls();
  }

  updateBuildTypeControls() {
    if (!this.inputController) return;
    this.inputController.buildTypeControls.forEach((control) => {
      const selected = control.buildType === this.selectedBuildType;
      control.button
        .setFillStyle(selected ? 0x806039 : 0x3b4650, 0.94)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0xffd28a : 0xa9bac7, 0.9);
    });
  }

  resetBuildTogglePointer() {
    if (this.inputController) this.inputController.resetBuildTogglePointer();
  }

  resetPlacePointer() {
    if (this.inputController) this.inputController.resetPlacePointer();
  }

  toggleBuildMode() {
    if (this.buildingSystem.isActive()) this.exitBuildMode();
    else this.enterBuildMode();
  }

  enterBuildMode() {
    if (!this.canBuild()) return false;
    if (this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.cancelInteractionHold();
    this.resetActionButton();
    this.resetUseButton();
    this.resetAttackButton();
    this.targetMarker.setVisible(false);
    this.interactionHintText.setVisible(false);
    this.buildingSystem.enterMode(this.selectedBuildType);
    this.setBuildTypeControlsVisible(true);
    this.inputController.placeButton.setVisible(true);
    this.inputController.placeButton.setInteractive();
    this.inputController.placeButtonLabel.setVisible(true);
    this.updateBuildingPreview();
    return true;
  }

  exitBuildMode() {
    if (!this.buildingSystem || !this.buildingSystem.isActive()) return;
    this.buildingSystem.exitMode();
    this.currentBuildTarget = null;
    this.inputController.placeButton.setVisible(false);
    this.inputController.placeButton.disableInteractive();
    this.inputController.placeButtonLabel.setVisible(false);
    this.setBuildTypeControlsVisible(false);
    this.resetPlacePointer();
    if (!this.buildingCleanupDone && this.canHarvest()) this.updateInteractionTarget();
  }

  getBuildTargetCell() {
    const playerCell = this.worldGrid.worldToCell(this.player.x, this.player.y);
    if (playerCell === null) return null;
    const offsets = {
      up: { col: 0, row: -1 },
      down: { col: 0, row: 1 },
      left: { col: -1, row: 0 },
      right: { col: 1, row: 0 }
    };
    const offset = offsets[this.lastFacingDirection];
    return {
      col: playerCell.col + offset.col,
      row: playerCell.row + offset.row,
      playerCol: playerCell.col,
      playerRow: playerCell.row
    };
  }

  validateBuildCell(target) {
    const definition = BuildCatalog[this.buildingSystem.buildType];
    if (!definition) return { valid: false, reason: 'invalidBuildType' };
    if (!target || !this.worldGrid.isInside(target.col, target.row)
      || !this.worldGrid.isWalkable(target.col, target.row)
      || this.worldGrid.getTileType(target.col, target.row) === 'W'
      || (target.col === target.playerCol && target.row === target.playerRow)) {
      return { valid: false, reason: 'invalidCell' };
    }
    const occupiedByWorldObject = Array.from(this.runtimeWorldObjects.values()).some(
      (object) => object.active && object.col === target.col && object.row === target.row
    );
    if (occupiedByWorldObject || this.buildingSystem.isOccupied(target.col, target.row)) {
      return { valid: false, reason: 'invalidCell' };
    }
    const occupiedByGroundItem = this.groundItemSystem.getItems().some((item) => {
      const cell = this.worldGrid.worldToCell(item.x, item.y);
      return cell !== null && cell.col === target.col && cell.row === target.row;
    });
    if (occupiedByGroundItem) return { valid: false, reason: 'invalidCell' };
    const hasCost = definition.cost.every(
      (cost) => this.inventoryModel.getTotal(cost.itemType) >= cost.quantity
    );
    return hasCost
      ? { valid: true, reason: null }
      : { valid: false, reason: 'missingResources' };
  }

  updateBuildingPreview() {
    if (!this.buildingSystem.isActive()) return;
    const target = this.getBuildTargetCell();
    const validation = this.validateBuildCell(target);
    this.currentBuildTarget = target;
    this.buildingSystem.updatePreview(target ? target.col : null, target ? target.row : null, validation.valid);
  }

  tryPlaceBuilding() {
    if (!this.canBuild() || !this.buildingSystem.isActive()) return false;
    const target = this.getBuildTargetCell();
    const validation = this.validateBuildCell(target);
    if (!validation.valid) {
      this.showInteractionMessage(
        validation.reason === 'missingResources' ? 'Недостаточно ресурсов' : 'Здесь нельзя строить'
      );
      return false;
    }
    const buildType = this.buildingSystem.buildType;
    const definition = BuildCatalog[buildType];
    const consumedCosts = [];
    try {
      definition.cost.forEach((cost) => {
        if (!this.inventoryModel.consumeItem(cost.itemType, cost.quantity)) {
          throw new Error(`Не удалось списать стоимость ${cost.itemType} ×${cost.quantity}.`);
        }
        consumedCosts.push(cost);
      });
    } catch (error) {
      consumedCosts.forEach((cost) => {
        const remainder = this.inventoryModel.addItem(cost.itemType, cost.quantity);
        if (remainder !== 0) throw new Error(`Не удалось вернуть стоимость ${cost.itemType} ×${cost.quantity}.`);
      });
      throw error;
    }
    const placement = this.buildingSystem.place(target.col, target.row);
    if (placement === null) {
      consumedCosts.forEach((cost) => {
        const remainder = this.inventoryModel.addItem(cost.itemType, cost.quantity);
        if (remainder !== 0) throw new Error(`Не удалось вернуть стоимость ${cost.itemType} ×${cost.quantity}.`);
      });
      throw new Error(`Не удалось разместить постройку ${buildType} (${target.col}, ${target.row}).`);
    }
    this.refreshInteractionTargets();
    this.inventoryUI.updateFromModel();
    this.updateInventoryHud();
    this.showInteractionMessage(`Построено: ${definition.displayName}`);
    this.updateBuildingPreview();
    return true;
  }

  cleanupBuildingInterface() {
    if (this.buildingCleanupDone) return;
    this.buildingCleanupDone = true;
    this.exitBuildMode();
    this.resetBuildTogglePointer();
    this.resetPlacePointer();
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupBuildingInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupBuildingInterface, this);
    if (this.buildingSystem) {
      this.buildingSystem.clear();
      this.buildingSystem = null;
    }
  }

  resetUseButton() {
    if (this.inputController) this.inputController.resetUseButton();
  }

  tryUseActiveItem() {
    if (!this.canUseFood()) return false;
    const slotIndex = this.inventoryUI.getActiveHotbarIndex();
    const slot = this.inventoryModel.getSlot(slotIndex);
    if (slot === null) {
      this.showInteractionMessage('Слот пуст');
      return false;
    }

    const item = ItemCatalog[slot.itemType];
    if (!item || !item.consumable) {
      this.showInteractionMessage('Этот предмет нельзя использовать');
      return false;
    }

    const result = this.applyFoodFromSlot(slotIndex, item);
    if (!result.consumed) {
      this.showInteractionMessage(item.healthRestore
        ? 'Вы не голодны и не ранены'
        : 'Сытость уже полная');
      return false;
    }
    this.inventoryUI.updateFromModel();
    this.updateInventoryHud();
    this.statusHUD.update(this.playerStatsModel.getHealth(), this.playerStatsModel.getHunger());
    const displayedHungerRestored = Math.round(result.hungerRestored * 100) / 100;
    const displayedHealthRestored = Math.round(result.healthRestored * 100) / 100;
    const message = item.healthRestore
      ? `Съедено: ${item.displayName}. Голод +${displayedHungerRestored}, здоровье +${displayedHealthRestored}`
      : `Съедено: ${item.displayName} +${displayedHungerRestored}`;
    this.showInteractionMessage(message);
    return true;
  }

  applyFoodFromSlot(slotIndex, item) {
    const statsBefore = this.playerStatsModel.exportState();
    const hungerRestored = this.playerStatsModel.restoreHunger(item.hungerRestore || 0);
    const healthRestored = this.playerStatsModel.restoreHealth(item.healthRestore || 0);
    if (hungerRestored === 0 && healthRestored === 0) {
      return { consumed: false, hungerRestored: 0, healthRestored: 0 };
    }

    const removed = this.inventoryModel.removeFromSlot(slotIndex, 1);
    if (removed !== 1) {
      if (!this.playerStatsModel.importState(statsBefore)) {
        throw new Error('Не удалось восстановить показатели после ошибки употребления еды.');
      }
      throw new Error(`Не удалось удалить использованный предмет из слота ${slotIndex}.`);
    }
    return { consumed: true, hungerRestored, healthRestored };
  }

  handlePlayerDeath() {
    if (this.isDeathHandled) return false;
    this.isDeathHandled = true;
    if (this.projectileSystem) this.projectileSystem.clearProjectiles();
    this.resetPlayerCombatState();
    this.cancelInteractionHold();
    if (this.inputController) this.inputController.resetHardwareState();
    this.resetActionButton();
    this.resetUseButton();
    this.exitBuildMode();
    if (this.inventoryUI && this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (this.craftingUI && this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.closeChestPanel();
    this.targetMarker.setVisible(false);
    if (this.interactionHintText) this.interactionHintText.setVisible(false);
    this.updateDeathPresentation();
    return true;
  }

  updateDeathPresentation() {
    const isDead = this.isPlayerDead();
    if (this.deathText) this.deathText.setVisible(isDead);
    if (this.inputController) this.inputController.setUseButtonDisabled(isDead);
  }

  cleanupSurvivalInterface() {
    if (this.survivalCleanupDone) return;
    this.survivalCleanupDone = true;
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanupSurvivalInterface, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanupSurvivalInterface, this);
    if (this.statusHUD) {
      this.statusHUD.destroy();
      this.statusHUD = null;
    }
    if (this.deathText && this.deathText.active) this.deathText.destroy();
    this.deathText = null;
    this.playerStatsModel = null;
  }

  handleInventoryOpenChanged(isOpen) {
    if (isOpen && this.isDeathHandled) {
      this.inventoryUI.closePanel();
      return;
    }
    if (isOpen && this.buildingSystem && this.buildingSystem.isActive()) {
      this.inventoryUI.closePanel();
      return;
    }
    if (isOpen && this.craftingUI && this.craftingUI.isOpen) this.craftingUI.closePanel();
    if (isOpen) this.closeChestPanel();
    this.handleBlockingPanelChanged(isOpen);
  }

  handleCraftingOpenChanged(isOpen) {
    if (isOpen && this.isDeathHandled) {
      this.craftingUI.closePanel();
      return;
    }
    if (isOpen && this.buildingSystem && this.buildingSystem.isActive()) {
      this.craftingUI.closePanel();
      return;
    }
    if (isOpen && this.inventoryUI && this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (isOpen) this.closeChestPanel();
    this.handleBlockingPanelChanged(isOpen);
  }

  handleChestOpenChanged(isOpen) {
    if (!isOpen) this.openChestId = null;
    if (isOpen && (this.isDeathHandled || this.isApplyingSave
      || (this.buildingSystem && this.buildingSystem.isActive()))) {
      this.closeChestPanel();
      return;
    }
    if (isOpen && this.inventoryUI && this.inventoryUI.isOpen) this.inventoryUI.closePanel();
    if (isOpen && this.craftingUI && this.craftingUI.isOpen) this.craftingUI.closePanel();
    this.handleBlockingPanelChanged(isOpen);
  }

  handleBlockingPanelChanged(isOpen) {
    this.cancelInteractionHold();
    if (this.inputController) {
      this.inputController.resetHardwareState();
      this.inputController.resetTransientState();
    }
    if (this.player && this.player.body) this.player.setVelocity(0, 0);
    if (isOpen) {
      this.targetMarker.setVisible(false);
      if (this.interactionHintText) this.interactionHintText.setVisible(false);
    }
    if (!isOpen && this.canHarvest()) {
      this.updateInteractionTarget();
    }
  }

  updateInventoryHud() {
    if (!this.inventoryHudText || !this.inventoryHudText.active || !this.inventoryModel) return;
    this.inventoryHudText.setText(
      `WOOD: ${this.inventoryModel.getTotal('WOOD')}  `
      + `STONE: ${this.inventoryModel.getTotal('STONE')}  `
      + `BERRIES: ${this.inventoryModel.getTotal('BERRIES')}`
    );
  }

  collectNearbyGroundItems() {
    const radiusSquared = GROUND_ITEM_PICKUP_RADIUS * GROUND_ITEM_PICKUP_RADIUS;
    const nearbyItems = this.groundItemSystem.getItems().filter((item) => {
      const offsetX = item.x - this.player.x;
      const offsetY = item.y - this.player.y;
      return offsetX * offsetX + offsetY * offsetY <= radiusSquared;
    });

    nearbyItems.forEach((item) => {
      if (!item.active) return;
      const originalQuantity = item.quantity;
      const remainder = this.inventoryModel.addItem(item.itemType, originalQuantity);
      const pickedUp = originalQuantity - remainder;
      if (pickedUp === 0) return;

      if (remainder === 0) {
        this.groundItemSystem.remove(item.id);
      } else {
        this.groundItemSystem.updateQuantity(item.id, remainder);
      }
      this.updateInventoryHud();
      this.inventoryUI.updateFromModel();
      this.showInteractionMessage(`Подобрано: ${item.itemType} ×${pickedUp}`);
    });
  }

  update(time, delta) {
    if (this.survivalCleanupDone || !this.playerStatsModel) return;
    if (this.isApplyingSave) return;

    const input = this.inputController;

    if (this.exitConfirmOpen && input.consumeCancelBuildPressed()) {
      this.hideExitConfirmation();
      return;
    }

    this.dayNightSystem.update(Number.isFinite(delta) ? Math.max(delta, 0) : 0);
    this.applyDayNightVisuals(false);
    if (this.projectileSystem) this.projectileSystem.update();
    const statsDelta = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 250);
    this.playerStatsModel.update(statsDelta);
    this.statusHUD.update(
      this.playerStatsModel.getHealth(),
      this.playerStatsModel.getHunger()
    );
    const contactAttack = this.creatureSystem.update(
      statsDelta,
      this.player,
      this.playerStatsModel.isDead()
    );
    this.handleCreatureContactAttack(contactAttack);
    this.statusHUD.update(
      this.playerStatsModel.getHealth(),
      this.playerStatsModel.getHunger()
    );
    if (this.playerStatsModel.isDead()) this.handlePlayerDeath();

    if (input.consumeSavePressed()) this.saveGame();
    if (input.consumeLoadPressed()) this.loadGame();

    if (this.isDeathHandled) {
      this.player.setVelocity(0, 0);
      return;
    }

    if (this.chestUI && this.chestUI.isOpen && this.getOpenChestContext() === null) {
      this.closeChestPanel();
    }

    this.updatePlayerHitFlash();

    if (input.consumeBuildTogglePressed() && this.canBuild()) {
      this.toggleBuildMode();
    }
    if (this.buildingSystem.isActive() && input.consumeCancelBuildPressed()) {
      this.exitBuildMode();
    }

    if (!this.canMove()) {
      this.player.setVelocity(0, 0);
      this.updateWorldDepth(this.player);
      return;
    }

    const movement = input.getMovementVector();

    if (movement.lengthSq() > 0) {
      if (Math.abs(movement.x) >= Math.abs(movement.y)) {
        this.lastFacingDirection = movement.x < 0 ? 'left' : 'right';
      } else {
        this.lastFacingDirection = movement.y < 0 ? 'up' : 'down';
      }
    }

    movement.scale(PLAYER_SPEED);

    this.player.setVelocity(movement.x, movement.y);
    this.updateWorldDepth(this.player);
    if (this.chunkManager) {
      const synced = this.chunkManager.syncAround(this.player.x, this.player.y);
      if (synced) {
        this.player.setActive(true);
        this.player.setVisible(true);
        this.updateWorldDepth(this.player);
      }
      this.updateChunkDebugOverlay();
    }
    this.collectNearbyGroundItems();
    if (this.buildingSystem.isActive()) {
      this.updateBuildingPreview();
      if (input.consumePlaceBuildPressed()) this.tryPlaceBuilding();
      return;
    }
    this.updateInteractionTarget();

    if (input.consumeAttackPressed()) this.tryPlayerAttack();

    if (input.consumeUsePressed()) {
      this.tryUseActiveItem();
    }

    if (input.consumeInteractPressed()) {
      if (!this.tryOpenCurrentChest()) this.startInteractionHold('keyboard');
    }

    if (this.holdInputSource === 'keyboard' && !input.isInteractKeyDown()) {
      this.releaseInteractionHold('keyboard');
    }

    this.updateInteractionHold(statsDelta);
  }
}
