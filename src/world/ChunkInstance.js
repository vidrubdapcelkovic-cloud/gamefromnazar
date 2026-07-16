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
    this.destroyed = false;
    this.ground = null;
    this.ownedObjectIds = [];
    this.npcObjects = [];
    this.npcIds = new Set();
    this.npcBlockedCells = new Set();
    this.createGround(chunkData);
    this.createObjects(chunkData);
    this.createNpcs(chunkData);
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
      const textureKey = objectData.type === 'TREE' ? 'temporary-tree' : 'temporary-rock';
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

  buildNpcBlockedCells(chunkData) {
    const blockedCells = new Set();
    const objects = Array.isArray(chunkData && chunkData.objects) ? chunkData.objects : [];
    objects.forEach((objectData) => {
      if (!objectData || (objectData.type !== 'TREE' && objectData.type !== 'ROCK')) return;
      if (!Number.isInteger(objectData.localTileX) || !Number.isInteger(objectData.localTileY)) return;
      blockedCells.add(`${objectData.localTileX},${objectData.localTileY}`);
    });
    return blockedCells;
  }

  isNpcWanderActive(npcObject) {
    return !this.destroyed
      && !!npcObject
      && !npcObject.destroyed
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

  setupNpcPhysicsBody(npcObject) {
    if (!npcObject || npcObject.body) return;
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

    const frameWidth = Math.max(1, Math.round(npcObject.displayWidth || npcObject.width || 28));
    const frameHeight = Math.max(1, Math.round(npcObject.displayHeight || npcObject.height || 28));
    const bodyWidth = Math.max(8, Math.round(frameWidth * 0.5));
    const bodyHeight = Math.max(6, Math.round(frameHeight * 0.36));
    const offsetX = Math.round((frameWidth - bodyWidth) / 2);
    const offsetY = Math.round(frameHeight - bodyHeight - Math.max(2, Math.round(frameHeight * 0.08)));

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
    const tween = this.scene.tweens.add({
      targets: npcObject,
      x: worldPos.x,
      y: worldPos.y,
      duration: 450,
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
    const timer = this.scene.time.delayedCall(900, () => {
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
      if (!descriptor || descriptor.type !== 'RABBIT') return;
      if (!Number.isInteger(descriptor.index) || descriptor.index < 0) return;
      if (!Number.isInteger(descriptor.localTileX) || !Number.isInteger(descriptor.localTileY)) return;

      const npcId = buildChunkNpcId(
        this.chunkX,
        this.chunkY,
        descriptor.type,
        descriptor.index
      );
      if (this.npcIds.has(npcId)) return;

      this.ensureRabbitPlaceholderTexture();
      const position = ChunkMath.localTileCenterWorld(
        this.chunkX,
        this.chunkY,
        descriptor.localTileX,
        descriptor.localTileY
      );
      // Image is tweened; Arcade body is immovable and follows the visual.
      const npcObject = this.scene.add.image(position.x, position.y, 'rabbit-placeholder');
      npcObject.setDataEnabled();
      npcObject.setData('npcId', npcId);
      npcObject.setData('npcType', descriptor.type);
      npcObject.setData('chunkKey', this.key);
      npcObject.setData('currentLocalTileX', descriptor.localTileX);
      npcObject.setData('currentLocalTileY', descriptor.localTileY);
      npcObject.setData('wanderStepIndex', 0);
      npcObject.setData('wanderTargetLocalTileX', null);
      npcObject.setData('wanderTargetLocalTileY', null);
      npcObject.setData('wanderStarted', false);
      npcObject.setData('wanderStopped', false);
      npcObject._npcWanderTween = null;
      npcObject._npcWanderTimer = null;
      npcObject._npcPlayerCollider = null;
      this.setupNpcPhysicsBody(npcObject);
      this.setupNpcPlayerCollider(npcObject);
      if (typeof this.scene.updateWorldDepth === 'function') {
        this.scene.updateWorldDepth(npcObject);
      } else {
        npcObject.setDepth((position.y + npcObject.displayHeight / 2) * 0.1);
      }

      this.npcIds.add(npcId);
      this.npcObjects.push(npcObject);
      this.startNpcWander(npcObject);
    });
  }

  destroyNpcs() {
    this.npcObjects.slice().forEach((npcObject) => {
      this.stopNpcWander(npcObject);
      this.clearNpcPlayerCollider(npcObject);
      if (npcObject && typeof npcObject.destroy === 'function') {
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
    this.npcBlockedCells = new Set();
  }
}
