class ChestStorageModel {
  constructor() {
    const definition = BuildCatalog.CHEST;
    if (!definition || !Number.isInteger(definition.storageSlots) || definition.storageSlots <= 0) {
      throw new Error('Для CHEST не задана корректная вместимость.');
    }
    this.slotCount = definition.storageSlots;
    this.slots = Array(this.slotCount).fill(null);
  }

  isValidIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < this.slotCount;
  }

  static cloneSlot(slot) {
    return slot === null ? null : { itemType: slot.itemType, quantity: slot.quantity };
  }

  static normalizeSlot(slot) {
    if (slot === null) return null;
    if (!slot || !ItemCatalog[slot.itemType] || !Number.isInteger(slot.quantity)
      || slot.quantity <= 0 || slot.quantity > ItemCatalog[slot.itemType].maxStack) return null;
    return ChestStorageModel.cloneSlot(slot);
  }

  static normalizeSlots(value) {
    const slotCount = BuildCatalog.CHEST.storageSlots;
    const normalized = Array(slotCount).fill(null);
    if (!Array.isArray(value)) return normalized;
    for (let index = 0; index < slotCount; index += 1) {
      normalized[index] = ChestStorageModel.normalizeSlot(value[index] === undefined ? null : value[index]);
    }
    return normalized;
  }

  getSlot(index) {
    if (!this.isValidIndex(index)) return null;
    return ChestStorageModel.cloneSlot(this.slots[index]);
  }

  getSlots() {
    return this.slots.map(ChestStorageModel.cloneSlot);
  }

  canPlace(index, itemType, quantity) {
    if (!this.isValidIndex(index) || !ItemCatalog[itemType]
      || !Number.isInteger(quantity) || quantity <= 0
      || quantity > ItemCatalog[itemType].maxStack) return false;
    const target = this.slots[index];
    return target === null
      || (target.itemType === itemType
        && target.quantity + quantity <= ItemCatalog[itemType].maxStack);
  }

  setSlot(index, itemType, quantity) {
    if (!this.isValidIndex(index) || !ItemCatalog[itemType]
      || !Number.isInteger(quantity) || quantity <= 0
      || quantity > ItemCatalog[itemType].maxStack) return false;
    this.slots[index] = { itemType, quantity };
    return true;
  }

  clearSlot(index) {
    if (!this.isValidIndex(index)) return false;
    this.slots[index] = null;
    return true;
  }

  addItem(itemType, quantity) {
    const definition = ItemCatalog[itemType];
    if (!definition || !Number.isInteger(quantity) || quantity <= 0) return quantity;
    let remainder = quantity;
    for (let index = 0; index < this.slotCount && remainder > 0; index += 1) {
      const slot = this.slots[index];
      if (slot && slot.itemType === itemType && slot.quantity < definition.maxStack) {
        const added = Math.min(remainder, definition.maxStack - slot.quantity);
        slot.quantity += added;
        remainder -= added;
      }
    }
    for (let index = 0; index < this.slotCount && remainder > 0; index += 1) {
      if (this.slots[index] === null) {
        const added = Math.min(remainder, definition.maxStack);
        this.slots[index] = { itemType, quantity: added };
        remainder -= added;
      }
    }
    return remainder;
  }

  removeFromSlot(index, quantity) {
    if (!this.isValidIndex(index) || !Number.isInteger(quantity) || quantity <= 0) return 0;
    const slot = this.slots[index];
    if (slot === null) return 0;
    const removed = Math.min(quantity, slot.quantity);
    slot.quantity -= removed;
    if (slot.quantity === 0) this.slots[index] = null;
    return removed;
  }

  moveOrMerge(fromIndex, toIndex) {
    if (!this.isValidIndex(fromIndex) || !this.isValidIndex(toIndex) || fromIndex === toIndex) return false;
    return ChestStorageModel.transferBetweenContainers(this, fromIndex, this, toIndex);
  }

  exportState() {
    return this.getSlots();
  }

  importState(state) {
    this.slots = ChestStorageModel.normalizeSlots(state);
    return true;
  }

  static transferBetweenContainers(source, sourceIndex, target, targetIndex) {
    if (!source || !target || typeof source.getSlot !== 'function' || typeof target.getSlot !== 'function'
      || typeof source.exportState !== 'function' || typeof target.exportState !== 'function'
      || typeof source.importState !== 'function' || typeof target.importState !== 'function') return false;
    const sourceSlot = source.getSlot(sourceIndex);
    const targetSlot = target.getSlot(targetIndex);
    if (sourceSlot === null || (source === target && sourceIndex === targetIndex)) return false;

    const sourceBefore = source.exportState();
    const targetBefore = source === target ? sourceBefore : target.exportState();
    if (!Array.isArray(sourceBefore) || !Array.isArray(targetBefore)
      || sourceIndex < 0 || sourceIndex >= sourceBefore.length
      || targetIndex < 0 || targetIndex >= targetBefore.length) return false;
    const nextSource = sourceBefore.map(ChestStorageModel.cloneSlot);
    const nextTarget = source === target ? nextSource : targetBefore.map(ChestStorageModel.cloneSlot);
    const moving = ChestStorageModel.cloneSlot(sourceSlot);
    const destination = ChestStorageModel.cloneSlot(targetSlot);

    if (destination === null) {
      nextTarget[targetIndex] = moving;
      nextSource[sourceIndex] = null;
    } else if (destination.itemType === moving.itemType) {
      const maxStack = ItemCatalog[moving.itemType].maxStack;
      const amount = Math.min(moving.quantity, maxStack - destination.quantity);
      if (amount <= 0) return false;
      nextTarget[targetIndex] = { itemType: destination.itemType, quantity: destination.quantity + amount };
      const remainder = moving.quantity - amount;
      nextSource[sourceIndex] = remainder > 0 ? { itemType: moving.itemType, quantity: remainder } : null;
    } else {
      nextTarget[targetIndex] = moving;
      nextSource[sourceIndex] = destination;
    }

    const sourceTotals = ChestStorageModel.countItems(sourceBefore, targetBefore, source === target);
    const nextTotals = ChestStorageModel.countItems(nextSource, nextTarget, source === target);
    if (!ChestStorageModel.sameTotals(sourceTotals, nextTotals)) return false;

    try {
      if (!source.importState(nextSource)) throw new Error('sourceImport');
      if (target !== source && !target.importState(nextTarget)) throw new Error('targetImport');
      return true;
    } catch {
      source.importState(sourceBefore);
      if (target !== source) target.importState(targetBefore);
      return false;
    }
  }

  static countItems(first, second, sameContainer) {
    const totals = {};
    const arrays = sameContainer ? [first] : [first, second];
    arrays.forEach((slots) => slots.forEach((slot) => {
      if (slot) totals[slot.itemType] = (totals[slot.itemType] || 0) + slot.quantity;
    }));
    return totals;
  }

  static sameTotals(first, second) {
    const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
    return Array.from(keys).every((key) => first[key] === second[key]);
  }
}
