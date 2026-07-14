class GroundItemSystem {
  constructor(scene, textureKeys) {
    this.scene = scene;
    this.textureKeys = textureKeys;
    this.items = [];
    this.nextId = 1;
  }

  spawn(itemType, quantity, x, y) {
    if (!ItemCatalog[itemType]) {
      throw new Error(`Неизвестный тип предмета: ${itemType}.`);
    }
    const textureKey = this.textureKeys[itemType];
    if (!textureKey || !Number.isInteger(quantity) || quantity <= 0
      || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Некорректный стак предмета: ${itemType} x${quantity} (${x}, ${y}).`);
    }

    const id = `ground-item-${this.nextId++}`;
    const visualObject = this.scene.add.image(x, y, textureKey);
    const quantityText = this.scene.add.text(x + 10, y - 10, String(quantity), {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#17212b',
      strokeThickness: 3
    }).setOrigin(0.5);
    const depth = y * WORLD_DEPTH_SCALE;
    visualObject.setDepth(depth);
    quantityText.setDepth(depth + 0.0001);

    const item = {
      id,
      itemType,
      quantity,
      x,
      y,
      visualObject,
      quantityText,
      active: true
    };
    this.items.push(item);
    return item;
  }

  getItems() {
    return this.items.filter((item) => item.active);
  }

  remove(itemId) {
    const item = this.items.find((candidate) => candidate.id === itemId && candidate.active);
    if (!item) return false;

    item.active = false;
    if (item.visualObject && item.visualObject.active) item.visualObject.destroy();
    if (item.quantityText && item.quantityText.active) item.quantityText.destroy();
    this.items = this.items.filter((candidate) => candidate !== item);
    return true;
  }

  updateQuantity(itemId, quantity) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Количество предметов должно быть положительным целым числом: ${quantity}.`);
    }
    const item = this.items.find((candidate) => candidate.id === itemId && candidate.active);
    if (!item) return false;

    item.quantity = quantity;
    item.quantityText.setText(String(quantity));
    return true;
  }

  clear() {
    this.items.forEach((item) => {
      if (item.visualObject && item.visualObject.active) item.visualObject.destroy();
      if (item.quantityText && item.quantityText.active) item.quantityText.destroy();
      item.active = false;
    });
    this.items = [];
  }

  exportState() { return this.getItems().map(({ itemType, quantity, x, y }) => ({ itemType, quantity, x, y })); }
  restoreState(items) {
    if (!Array.isArray(items)) return false;
    const copy = [];
    for (const item of items) {
      if (!item || !ItemCatalog[item.itemType] || !Number.isInteger(item.quantity)
        || item.quantity <= 0 || item.quantity > ItemCatalog[item.itemType].maxStack
        || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return false;
      copy.push({ itemType: item.itemType, quantity: item.quantity, x: item.x, y: item.y });
    }
    this.clear(); copy.forEach((item) => this.spawn(item.itemType, item.quantity, item.x, item.y)); return true;
  }
}
