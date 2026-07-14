class ChestUI {
  constructor(scene, inventoryModel, textureKeys, getOpenContext, onOpenChanged, onContentsChanged) {
    this.scene = scene;
    this.inventoryModel = inventoryModel;
    this.textureKeys = textureKeys;
    this.getOpenContext = getOpenContext;
    this.onOpenChanged = onOpenChanged;
    this.onContentsChanged = onContentsChanged;
    this.isOpen = false;
    this.destroyed = false;
    this.selectedSource = null;
    this.elements = [];
    this.interactiveElements = [];
    this.chestSlots = [];
    this.playerSlots = [];
    this.createPanel();
    this.registerHandlers();
    this.setVisible(false);
  }

  createPanel() {
    this.panelBackground = this.scene.add.rectangle(480, 270, 820, 450, 0x0d141b, 0.97)
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 60)
      .setStrokeStyle(3, 0xd8b879, 0.9).setInteractive();
    this.title = this.scene.add.text(480, 62, 'Сундук', {
      fontFamily: 'Arial, sans-serif', fontSize: '27px', fontStyle: 'bold', color: '#fff4cf'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 61);
    this.chestLabel = this.scene.add.text(320, 104, 'Хранилище', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#e8c989'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 61);
    this.playerLabel = this.scene.add.text(640, 104, 'Инвентарь', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#bad5e8'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 61);
    this.closeButton = this.scene.add.rectangle(838, 62, 74, 40, 0x713f3f, 0.95)
      .setStrokeStyle(2, 0xffb8b8, 0.9).setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 62).setInteractive();
    this.closeLabel = this.scene.add.text(838, 62, 'Закрыть', {
      fontFamily: 'Arial, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 63);
    this.elements.push(
      this.panelBackground, this.title, this.chestLabel, this.playerLabel,
      this.closeButton, this.closeLabel
    );
    this.interactiveElements.push(this.panelBackground, this.closeButton);
    this.onPanelPointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    };
    this.onClosePointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.closePanel();
    };
    this.panelBackground.on('pointerdown', this.onPanelPointerDown);
    this.closeButton.on('pointerdown', this.onClosePointerDown);

    for (let index = 0; index < BuildCatalog.CHEST.storageSlots; index += 1) {
      const col = index % 5;
      const row = Math.floor(index / 5);
      this.chestSlots.push(this.createSlot(220 + col * 50, 150 + row * 50, 'chest', index));
    }
    for (let index = 0; index < 25; index += 1) {
      const col = index % 5;
      const row = Math.floor(index / 5);
      this.playerSlots.push(this.createSlot(540 + col * 50, 150 + row * 50, 'player', index));
    }
  }

  createSlot(x, y, container, index) {
    const background = this.scene.add.rectangle(x, y, 44, 44, 0x1b2731, 0.98)
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 62)
      .setStrokeStyle(2, container === 'chest' ? 0xa68550 : 0x78909f, 0.9)
      .setInteractive();
    const icon = this.scene.add.image(x, y - 2, 'temporary-ground-wood')
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 63).setVisible(false);
    const quantityText = this.scene.add.text(x + 17, y + 16, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#101820', strokeThickness: 3
    }).setOrigin(1).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 64).setVisible(false);
    const slot = { container, index, background, icon, quantityText };
    slot.onPointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.handleSlotPointerDown(container, index);
    };
    background.on('pointerdown', slot.onPointerDown);
    this.elements.push(background, icon, quantityText);
    this.interactiveElements.push(background);
    return slot;
  }

  registerHandlers() {
    this.onEscapeKey = (event) => {
      if ((!event || !event.repeat) && this.isOpen) this.closePanel();
    };
    this.scene.input.keyboard.on('keydown-ESC', this.onEscapeKey);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  getValidatedContext() {
    if (!this.isOpen) return null;
    const context = this.getOpenContext();
    if (!context || !context.chestId || !(context.storage instanceof ChestStorageModel)) {
      this.closePanel();
      return null;
    }
    return context;
  }

  openPanel() {
    if (this.isOpen || !this.getOpenContext()) return false;
    this.isOpen = true;
    this.selectedSource = null;
    this.updateFromModels();
    this.setVisible(true);
    this.onOpenChanged(true);
    return true;
  }

  closePanel() {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.selectedSource = null;
    this.setVisible(false);
    this.onOpenChanged(false);
    return true;
  }

  setVisible(visible) {
    this.elements.forEach((element) => element.setVisible(visible));
    this.interactiveElements.forEach((element) => {
      if (visible) element.setInteractive();
      else element.disableInteractive();
    });
    if (visible) this.updateFromModels();
  }

  updateSlot(slot, contents) {
    const visible = this.isOpen && contents !== null;
    if (contents) {
      const textureKey = this.textureKeys[contents.itemType];
      if (!ItemCatalog[contents.itemType] || !textureKey) {
        throw new Error(`Нельзя отобразить предмет сундука: ${contents.itemType}.`);
      }
      slot.icon.setTexture(textureKey).setVisible(visible);
      slot.quantityText.setText(String(contents.quantity)).setVisible(visible);
    } else {
      slot.icon.setVisible(false);
      slot.quantityText.setText('').setVisible(false);
    }
  }

  updateFromModels() {
    if (!this.isOpen) return false;
    const context = this.getValidatedContext();
    if (!context) return false;
    const chestSlots = context.storage.getSlots();
    const playerSlots = this.inventoryModel.getSlots();
    this.chestSlots.forEach((slot) => this.updateSlot(slot, chestSlots[slot.index]));
    this.playerSlots.forEach((slot) => this.updateSlot(slot, playerSlots[slot.index]));
    this.updateHighlights();
    return true;
  }

  getModel(container, context) {
    if (container === 'chest') return context.storage;
    if (container === 'player') return this.inventoryModel;
    return null;
  }

  handleSlotPointerDown(container, index) {
    const context = this.getValidatedContext();
    if (!context) return false;
    const model = this.getModel(container, context);
    if (!model) return false;
    if (this.selectedSource === null) {
      if (model.getSlot(index) !== null) {
        this.selectedSource = { container, index };
        this.updateHighlights();
      }
      return false;
    }
    if (this.selectedSource.container === container && this.selectedSource.index === index) {
      this.selectedSource = null;
      this.updateHighlights();
      return false;
    }
    const sourceModel = this.getModel(this.selectedSource.container, context);
    const result = ChestStorageModel.transferBetweenContainers(
      sourceModel, this.selectedSource.index, model, index
    );
    this.selectedSource = null;
    this.updateFromModels();
    if (result) this.onContentsChanged();
    return result;
  }

  updateHighlights() {
    [...this.chestSlots, ...this.playerSlots].forEach((slot) => {
      const selected = this.selectedSource
        && this.selectedSource.container === slot.container
        && this.selectedSource.index === slot.index;
      const color = slot.container === 'chest' ? 0xa68550 : 0x78909f;
      slot.background.setStrokeStyle(selected ? 4 : 2, selected ? 0x63e6ff : color, 1);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.isOpen) this.closePanel();
    this.scene.input.keyboard.off('keydown-ESC', this.onEscapeKey);
    this.panelBackground.off('pointerdown', this.onPanelPointerDown);
    this.closeButton.off('pointerdown', this.onClosePointerDown);
    [...this.chestSlots, ...this.playerSlots].forEach(
      (slot) => slot.background.off('pointerdown', slot.onPointerDown)
    );
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.elements.forEach((element) => { if (element && element.active) element.destroy(); });
    this.elements = [];
    this.interactiveElements = [];
    this.chestSlots = [];
    this.playerSlots = [];
  }
}
