const INVENTORY_SLOT_COUNT = 25;
const QUICK_SLOT_COUNT = 5;

class InventoryModel {
  constructor() {
    this.slotCount = INVENTORY_SLOT_COUNT;
    this.quickSlotCount = QUICK_SLOT_COUNT;
    this.slots = Array(INVENTORY_SLOT_COUNT).fill(null);
  }

  addItem(itemType, quantity) {
    const itemDefinition = ItemCatalog[itemType];
    if (!itemDefinition) throw new Error(`Неизвестный тип предмета: ${itemType}.`);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Количество предметов должно быть положительным целым числом: ${quantity}.`);
    }

    let remaining = quantity;
    this.slots.forEach((slot) => {
      if (remaining === 0 || slot === null || slot.itemType !== itemType) return;
      const available = itemDefinition.maxStack - slot.quantity;
      const added = Math.min(available, remaining);
      slot.quantity += added;
      remaining -= added;
    });

    for (let index = 0; index < this.slots.length && remaining > 0; index += 1) {
      if (this.slots[index] !== null) continue;
      const added = Math.min(itemDefinition.maxStack, remaining);
      this.slots[index] = { itemType, quantity: added };
      remaining -= added;
    }

    return remaining;
  }

  getSlots() {
    return this.slots.map((slot) => (slot === null ? null : { ...slot }));
  }

  validateSlotIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= INVENTORY_SLOT_COUNT) {
      throw new Error(`Индекс слота должен быть целым числом от 0 до 24: ${index}.`);
    }
  }

  getSlot(index) {
    this.validateSlotIndex(index);
    const slot = this.slots[index];
    return slot === null ? null : { ...slot };
  }

  removeFromSlot(index, quantity) {
    this.validateSlotIndex(index);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Количество для удаления должно быть положительным целым числом: ${quantity}.`);
    }
    const slot = this.slots[index];
    if (slot === null) return 0;

    const removed = Math.min(quantity, slot.quantity);
    slot.quantity -= removed;
    if (slot.quantity === 0) this.slots[index] = null;
    return removed;
  }

  consumeItem(itemType, quantity) {
    if (!ItemCatalog[itemType]) throw new Error(`Неизвестный тип предмета: ${itemType}.`);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Количество для расходования должно быть положительным целым числом: ${quantity}.`);
    }
    if (this.getTotal(itemType) < quantity) return false;

    let remaining = quantity;
    for (let index = 0; index < this.slots.length && remaining > 0; index += 1) {
      const slot = this.slots[index];
      if (slot === null || slot.itemType !== itemType) continue;
      const consumed = Math.min(slot.quantity, remaining);
      slot.quantity -= consumed;
      remaining -= consumed;
      if (slot.quantity === 0) this.slots[index] = null;
    }
    return true;
  }

  moveOrMerge(fromIndex, toIndex) {
    this.validateSlotIndex(fromIndex);
    this.validateSlotIndex(toIndex);
    if (fromIndex === toIndex) return false;

    const source = this.slots[fromIndex];
    if (source === null) return false;
    const target = this.slots[toIndex];

    if (target === null) {
      this.slots[toIndex] = source;
      this.slots[fromIndex] = null;
      return { type: 'move', movedQuantity: source.quantity };
    }

    if (target.itemType === source.itemType) {
      const maxStack = ItemCatalog[source.itemType].maxStack;
      const available = maxStack - target.quantity;
      if (available <= 0) return false;

      const movedQuantity = Math.min(available, source.quantity);
      target.quantity += movedQuantity;
      source.quantity -= movedQuantity;
      if (source.quantity === 0) this.slots[fromIndex] = null;
      return { type: 'merge', movedQuantity };
    }

    this.slots[fromIndex] = target;
    this.slots[toIndex] = source;
    return { type: 'swap', movedQuantity: source.quantity };
  }

  prepareCraftExchange(ingredients, result) {
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      throw new Error('Ингредиенты крафта должны быть непустым массивом.');
    }
    if (!result || !ItemCatalog[result.itemType]
      || !Number.isInteger(result.quantity) || result.quantity <= 0) {
      throw new Error('Некорректный результат крафта.');
    }

    const required = new Map();
    ingredients.forEach((ingredient) => {
      if (!ingredient || !ItemCatalog[ingredient.itemType]
        || !Number.isInteger(ingredient.quantity) || ingredient.quantity <= 0) {
        throw new Error('Некорректный ингредиент крафта.');
      }
      required.set(
        ingredient.itemType,
        (required.get(ingredient.itemType) || 0) + ingredient.quantity
      );
    });

    for (const [itemType, quantity] of required) {
      if (this.getTotal(itemType) < quantity) {
        return { success: false, reason: 'missingIngredients' };
      }
    }

    const workingSlots = this.slots.map((slot) => (slot === null ? null : { ...slot }));
    required.forEach((quantity, itemType) => {
      let remaining = quantity;
      for (let index = 0; index < workingSlots.length && remaining > 0; index += 1) {
        const slot = workingSlots[index];
        if (slot === null || slot.itemType !== itemType) continue;
        const removed = Math.min(slot.quantity, remaining);
        slot.quantity -= removed;
        remaining -= removed;
        if (slot.quantity === 0) workingSlots[index] = null;
      }
    });

    let remainingResult = result.quantity;
    const resultDefinition = ItemCatalog[result.itemType];
    workingSlots.forEach((slot) => {
      if (remainingResult === 0 || slot === null || slot.itemType !== result.itemType) return;
      const added = Math.min(resultDefinition.maxStack - slot.quantity, remainingResult);
      slot.quantity += added;
      remainingResult -= added;
    });
    for (let index = 0; index < workingSlots.length && remainingResult > 0; index += 1) {
      if (workingSlots[index] !== null) continue;
      const added = Math.min(resultDefinition.maxStack, remainingResult);
      workingSlots[index] = { itemType: result.itemType, quantity: added };
      remainingResult -= added;
    }

    if (remainingResult > 0) return { success: false, reason: 'noSpace' };
    return { success: true, slots: workingSlots };
  }

  canCraftExchange(ingredients, result) {
    const prepared = this.prepareCraftExchange(ingredients, result);
    return prepared.success
      ? { success: true }
      : { success: false, reason: prepared.reason };
  }

  craftExchange(ingredients, result) {
    const prepared = this.prepareCraftExchange(ingredients, result);
    if (!prepared.success) return prepared;
    this.slots = prepared.slots;
    return { success: true };
  }

  getTotal(itemType) {
    if (!ItemCatalog[itemType]) throw new Error(`Неизвестный тип предмета: ${itemType}.`);
    return this.slots.reduce(
      (total, slot) => total + (slot && slot.itemType === itemType ? slot.quantity : 0),
      0
    );
  }

  clear() {
    this.slots.fill(null);
  }

  exportState() { return this.getSlots(); }

  importState(slots) {
    if (!Array.isArray(slots) || slots.length !== 25) return false;
    const copy = [];
    for (const slot of slots) {
      if (slot === null) { copy.push(null); continue; }
      if (!slot || !ItemCatalog[slot.itemType] || !Number.isInteger(slot.quantity)
        || slot.quantity <= 0 || slot.quantity > ItemCatalog[slot.itemType].maxStack) return false;
      copy.push({ itemType: slot.itemType, quantity: slot.quantity });
    }
    this.slots = copy;
    return true;
  }
}
