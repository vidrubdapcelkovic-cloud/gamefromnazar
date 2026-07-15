class ChunkInstance {
  constructor(scene, chunkData, options) {
    this.scene = scene;
    this.chunkX = chunkData.chunkX;
    this.chunkY = chunkData.chunkY;
    this.key = ChunkMath.chunkKey(this.chunkX, this.chunkY);
    this.blockingGroup = options.blockingGroup;
    this.onObjectCreated = options.onObjectCreated;
    this.onObjectDestroyed = options.onObjectDestroyed;
    this.destroyed = false;
    this.ground = null;
    this.ownedObjectIds = [];
    this.createGround(chunkData);
    this.createObjects(chunkData);
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
      const id = `chunk_${this.chunkX}_${this.chunkY}_${objectData.type}_${objectData.localTileX}_${objectData.localTileY}`;
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

    if (this.ground) {
      this.ground.destroy();
      this.ground = null;
    }

    this.scene = null;
    this.blockingGroup = null;
    this.onObjectCreated = null;
    this.onObjectDestroyed = null;
  }
}