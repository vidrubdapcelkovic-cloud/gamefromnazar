const VERSION = 1;

class SaveSystem {
  constructor(slotManager, slotId) {
    this.slotManager = slotManager;
    this.slotId = slotManager && slotManager.isValidSlotId(slotId) ? slotId : null;
  }

  static normalizeRemovedResources(value) {
    if (!Array.isArray(value)) return [];
    const unique = [];
    const seen = new Set();
    value.forEach((entry) => {
      if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) return;
      seen.add(entry);
      unique.push(entry);
    });
    unique.sort();
    return unique;
  }

  static normalizeState(state) {
    try {
      if (!state || state.version !== VERSION || !Number.isFinite(state.savedAt)) return null;
      const p = state.player, inv = state.inventory, w = state.world;
      const dayNight = DayNightSystem.normalizeState(state.dayNight);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
        || !Number.isFinite(p.health) || p.health < 0 || p.health > 100
        || !Number.isFinite(p.hunger) || p.hunger < 0 || p.hunger > 100) return null;
      if (!inv || !Number.isInteger(inv.activeHotbarIndex) || inv.activeHotbarIndex < 0
        || inv.activeHotbarIndex > 4 || !Array.isArray(inv.slots) || inv.slots.length !== 25) return null;
      const slots = inv.slots.map((slot) => {
        if (slot === null) return null;
        if (!slot || !ItemCatalog[slot.itemType] || !Number.isInteger(slot.quantity)
          || slot.quantity <= 0 || slot.quantity > ItemCatalog[slot.itemType].maxStack) throw new Error();
        return { itemType: slot.itemType, quantity: slot.quantity };
      });
      if (!w) return null;
      const uniqueStrings = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string')
        && new Set(value).size === value.length ? value.slice() : null;
      const removedObjectIds = uniqueStrings(w.removedObjectIds);
      const deadCreatureIds = uniqueStrings(w.deadCreatureIds);
      if (!removedObjectIds || !deadCreatureIds || !Array.isArray(w.groundItems) || !Array.isArray(w.walls)) return null;
      const groundItems = w.groundItems.map((item) => {
        if (!item || !ItemCatalog[item.itemType] || !Number.isInteger(item.quantity)
          || item.quantity <= 0 || item.quantity > ItemCatalog[item.itemType].maxStack
          || !Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new Error();
        return { itemType: item.itemType, quantity: item.quantity, x: item.x, y: item.y };
      });
      const isChunkedSave = state.worldSeed !== undefined && state.worldSeed !== null;
      const wallCells = new Set();
      const buildingIds = new Set();
      const walls = w.walls.map((wall) => {
        if (!wall || !BuildCatalog[wall.buildType] || !Number.isInteger(wall.col) || !Number.isInteger(wall.row)
          || (!isChunkedSave && (wall.col < 0 || wall.col >= 48 || wall.row < 0 || wall.row >= 36))) throw new Error();
        const key = `${wall.col},${wall.row}`; if (wallCells.has(key)) throw new Error(); wallCells.add(key);
        if (wall.id !== undefined
          && (typeof wall.id !== 'string' || wall.id.length === 0 || buildingIds.has(wall.id))) throw new Error();
        if (wall.id !== undefined) buildingIds.add(wall.id);
        const normalized = { buildType: wall.buildType, col: wall.col, row: wall.row };
        if (wall.id !== undefined) normalized.id = wall.id;
        if (wall.buildType === 'CHEST') {
          normalized.storage = ChestStorageModel.normalizeSlots(wall.storage);
        }
        return normalized;
      });
      const removedResources = SaveSystem.normalizeRemovedResources(w.removedResources);
      let worldSeed;
      if (state.worldSeed !== undefined && state.worldSeed !== null) {
        if (typeof state.worldSeed === 'number'
          && Number.isFinite(state.worldSeed)
          && Number.isInteger(state.worldSeed)) {
          worldSeed = state.worldSeed;
        } else if (typeof state.worldSeed === 'string'
          && state.worldSeed.length > 0
          && state.worldSeed.length <= 64) {
          worldSeed = state.worldSeed;
        } else {
          return null;
        }
      }
      const normalized = { version: 1, savedAt: state.savedAt,
        player: { x: p.x, y: p.y, health: p.health, hunger: p.hunger },
        dayNight,
        inventory: { activeHotbarIndex: inv.activeHotbarIndex, slots },
        world: { removedObjectIds, groundItems, walls, deadCreatureIds, removedResources } };
      if (worldSeed !== undefined) normalized.worldSeed = worldSeed;
      return normalized;
    } catch { return null; }
  }

  normalize(state) {
    return SaveSystem.normalizeState(state);
  }

  hasSave() {
    if (!this.slotManager || this.slotId === null) return false;
    const result = this.slotManager.has(this.slotId);
    return result.success && result.exists;
  }

  save(state) {
    const normalized = this.normalize(state);
    if (!normalized) return { success: false, reason: 'invalidData' };
    if (!this.slotManager || this.slotId === null) return { success: false, reason: 'invalidSlot' };
    return this.slotManager.write(this.slotId, normalized);
  }

  load() {
    if (!this.slotManager || this.slotId === null) return { success: false, reason: 'invalidSlot' };
    const result = this.slotManager.read(this.slotId);
    if (!result.success) {
      if (result.reason === 'empty') return { success: false, reason: 'notFound' };
      if (result.reason === 'invalidJson') return { success: false, reason: 'invalidData' };
      return result;
    }
    const state = this.normalize(result.value);
    return state ? { success: true, state } : { success: false, reason: 'invalidData' };
  }

  deleteSave() {
    if (!this.slotManager || this.slotId === null) return { success: false, reason: 'invalidSlot' };
    return this.slotManager.delete(this.slotId);
  }
}
