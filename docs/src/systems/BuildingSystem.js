class BuildingSystem {
  constructor(scene, worldGrid, blockingWorldObjects, textureKeys) {
    this.scene = scene;
    this.worldGrid = worldGrid;
    this.blockingWorldObjects = blockingWorldObjects;
    this.textureKeys = textureKeys;
    this.active = false;
    this.buildType = null;
    this.placements = [];
    this.occupiedCells = new Set();
    this.nextId = 1;
    this.destroyed = false;
    this.previewObject = scene.add.image(0, 0, textureKeys.WOOD_WALL)
      .setAlpha(0.55)
      .setDepth(INTERFACE_DEPTH - 20)
      .setVisible(false);
  }

  enterMode(buildType) {
    if (!BuildCatalog[buildType]) throw new Error(`Неизвестный тип постройки: ${buildType}.`);
    if (!this.textureKeys[buildType]) throw new Error(`Не задана текстура постройки: ${buildType}.`);
    this.active = true;
    this.buildType = buildType;
    this.previewObject.setTexture(this.textureKeys[buildType]);
    return true;
  }

  exitMode() {
    this.active = false;
    this.buildType = null;
    if (this.previewObject && this.previewObject.active) this.previewObject.setVisible(false);
  }

  isActive() {
    return this.active;
  }

  updatePreview(col, row, isValid) {
    if (!this.active || !Number.isInteger(col) || !Number.isInteger(row)) {
      this.previewObject.setVisible(false);
      return;
    }
    const x = col * this.worldGrid.tileSize + this.worldGrid.tileSize / 2;
    const y = row * this.worldGrid.tileSize + this.worldGrid.tileSize / 2;
    this.previewObject
      .setPosition(x, y)
      .setTint(isValid ? 0x67df78 : 0xe55d65)
      .setVisible(true);
  }

  createStableId(restoredId) {
    if (typeof restoredId === 'string' && restoredId.length > 0
      && !this.placements.some((placement) => placement.id === restoredId)) {
      const match = /^building-(\d+)$/.exec(restoredId);
      if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      return restoredId;
    }
    let id;
    do { id = `building-${this.nextId++}`; }
    while (this.placements.some((placement) => placement.id === id));
    return id;
  }

  place(col, row, restoredId, storageState) {
    if (!this.active || !this.worldGrid.isInside(col, row) || this.isOccupied(col, row)) {
      return null;
    }
    const definition = BuildCatalog[this.buildType];
    const position = this.worldGrid.cellToWorldCenter(col, row);
    const visualObject = definition.blocksMovement
      ? this.blockingWorldObjects.create(position.x, position.y, this.textureKeys[this.buildType])
      : this.scene.add.image(position.x, position.y, this.textureKeys[this.buildType]);
    visualObject.setDepth((position.y + visualObject.displayHeight / 2) * WORLD_DEPTH_SCALE);
    visualObject.setDataEnabled();
    const id = this.createStableId(restoredId);
    visualObject.setData('id', id);
    visualObject.setData('buildType', this.buildType);
    visualObject.setData('col', col);
    visualObject.setData('row', row);
    const storage = this.buildType === 'CHEST' ? new ChestStorageModel() : null;
    if (storage && storageState !== undefined) storage.importState(storageState);
    const placement = { id, buildType: this.buildType, col, row, visualObject, storage, active: true };
    this.placements.push(placement);
    this.occupiedCells.add(`${col},${row}`);
    return placement;
  }

  isOccupied(col, row) {
    return this.occupiedCells.has(`${col},${row}`);
  }

  getPlacements() {
    return this.placements.filter((placement) => placement.active).slice();
  }

  getPlacement(id) {
    return this.placements.find(
      (placement) => placement.active && placement.id === id
    ) || null;
  }

  getChestStorage(id) {
    const placement = this.getPlacement(id);
    return placement && placement.buildType === 'CHEST'
      && placement.storage instanceof ChestStorageModel ? placement.storage : null;
  }

  remove(id) {
    const placement = this.getPlacement(id);
    if (placement === null) return null;

    placement.active = false;
    this.occupiedCells.delete(`${placement.col},${placement.row}`);
    if (placement.visualObject && placement.visualObject.active) {
      placement.visualObject.destroy();
    }
    this.placements = this.placements.filter((candidate) => candidate !== placement);
    return placement;
  }

  exportState() {
    return this.getPlacements().map(({ id, buildType, col, row, storage }) => {
      const state = { id, buildType, col, row };
      if (buildType === 'CHEST') state.storage = storage.exportState();
      return state;
    });
  }
  clearPlacements() {
    this.placements.forEach((p) => { if (p.visualObject && p.visualObject.active) p.visualObject.destroy(); p.active = false; });
    this.placements = []; this.occupiedCells.clear(); this.nextId = 1;
  }
  restoreState(walls) {
    if (!Array.isArray(walls)) return false; const cells = new Set(); const ids = new Set();
    for (const wall of walls) {
      const key = wall && `${wall.col},${wall.row}`;
      if (!wall || !BuildCatalog[wall.buildType] || !Number.isInteger(wall.col) || !Number.isInteger(wall.row)
        || !this.worldGrid.isInside(wall.col, wall.row) || cells.has(key)
        || (wall.id !== undefined && (typeof wall.id !== 'string' || !wall.id || ids.has(wall.id)))) return false;
      cells.add(key);
      if (wall.id !== undefined) ids.add(wall.id);
    }
    this.clearPlacements(); const previousType = this.buildType; const previousActive = this.active;
    walls.forEach((wall) => {
      this.active = true; this.buildType = wall.buildType;
      this.place(wall.col, wall.row, wall.id, wall.storage);
    });
    this.active = previousActive; this.buildType = previousType; if (!this.active) this.previewObject.setVisible(false); return true;
  }

  clear() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.exitMode();
    this.clearPlacements();
    if (this.previewObject && this.previewObject.active) this.previewObject.destroy();
    this.previewObject = null;
  }
}
