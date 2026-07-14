class InventoryUI {
  constructor(scene, inventoryModel, textureKeys, onOpenChanged, canOpenPanel, canSelectQuickSlot) {
    this.scene = scene;
    this.inventoryModel = inventoryModel;
    this.textureKeys = textureKeys;
    this.onOpenChanged = onOpenChanged;
    this.canOpenPanel = canOpenPanel || (() => true);
    this.canSelectQuickSlot = canSelectQuickSlot || (() => true);
    this.activeQuickSlotIndex = 0;
    this.selectedSourceIndex = null;
    this.isOpen = false;
    this.interactionBlocked = false;
    this.destroyed = false;
    this.backpackPointerId = null;
    this.backpackNativePointerId = null;
    this.elements = [];
    this.quickSlots = [];
    this.mainSlots = [];
    this.panelElements = [];

    this.createQuickSlots();
    this.createMainPanel();
    this.createBackpackButton();
    this.registerHandlers();
    this.reposition();
    this.updateFromModel();
  }

  createSlot(x, y, slotIndex, interactive) {
    const background = this.scene.add.rectangle(x, y, 48, 48, 0x1b2731, 0.94)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 22)
      .setStrokeStyle(2, 0x78909f, 0.8);
    const icon = this.scene.add.image(x, y - 3, 'temporary-ground-wood')
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 23)
      .setVisible(false);
    const quantityText = this.scene.add.text(x + 17, y + 16, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#101820',
      strokeThickness: 3
    }).setOrigin(1).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 24);
    const slot = { slotIndex, background, icon, quantityText };
    this.elements.push(background, icon, quantityText);

    if (interactive) {
      background.setInteractive();
      slot.onPointerDown = (pointer, localX, localY, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.handleSlotPointerDown(slotIndex);
      };
      background.on('pointerdown', slot.onPointerDown);
    }
    return slot;
  }

  createQuickSlots() {
    for (let index = 0; index < 5; index += 1) {
      this.quickSlots.push(this.createSlot(0, 0, index, true));
    }
  }

  createMainPanel() {
    this.panelBackground = this.scene.add.rectangle(480, 270, 340, 270, 0x0d141b, 0.94)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 20)
      .setStrokeStyle(3, 0xbad5e8, 0.75);
    this.panelTitle = this.scene.add.text(480, 162, 'Инвентарь', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 21);
    this.elements.push(this.panelBackground, this.panelTitle);
    this.panelElements.push(this.panelBackground, this.panelTitle);
    this.panelBackground.setInteractive();
    this.onPanelPointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    };
    this.panelBackground.on('pointerdown', this.onPanelPointerDown);

    for (let index = 5; index < 25; index += 1) {
      const slot = this.createSlot(0, 0, index, true);
      this.mainSlots.push(slot);
      this.panelElements.push(slot.background, slot.icon, slot.quantityText);
    }
    this.setPanelVisible(false);
  }

  createBackpackButton() {
    this.backpackButton = this.scene.add.circle(0, 0, 28, 0x263642, 0.88)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 30)
      .setStrokeStyle(2, 0xbad5e8, 0.8)
      .setInteractive();
    this.backpackLabel = this.scene.add.text(0, 0, '🎒', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 31);
    this.elements.push(this.backpackButton, this.backpackLabel);
  }

  registerHandlers() {
    this.onQuickKey = (index) => (event) => {
      if (this.destroyed || this.interactionBlocked) return;
      if ((!event || !event.repeat) && this.canSelectQuickSlot()) {
        this.setActiveQuickSlot(index);
      }
    };
    this.quickKeyHandlers = [0, 1, 2, 3, 4].map((index) => this.onQuickKey(index));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].forEach((keyName, index) => {
      this.scene.input.keyboard.on(`keydown-${keyName}`, this.quickKeyHandlers[index]);
    });
    this.onToggleKey = (event) => {
      if (this.destroyed || this.interactionBlocked) return;
      if (!event || !event.repeat) this.togglePanel();
    };
    this.onEscapeKey = (event) => {
      if (this.destroyed || this.interactionBlocked) return;
      if (!event || !event.repeat) this.closePanel();
    };
    this.scene.input.keyboard.on('keydown-I', this.onToggleKey);
    this.scene.input.keyboard.on('keydown-ESC', this.onEscapeKey);

    this.onBackpackPointerDown = (pointer, localX, localY, event) => {
      if (this.destroyed || this.interactionBlocked) return;
      if (this.backpackPointerId !== null) return;
      if (event && event.stopPropagation) event.stopPropagation();
      this.backpackPointerId = pointer.id;
      this.backpackNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.backpackButton.setScale(0.92);
      this.backpackLabel.setScale(0.92);
      this.togglePanel();
    };
    this.onBackpackPointerEnd = (pointer) => {
      if (pointer.id === this.backpackPointerId) this.resetBackpackPointer();
    };
    this.onWindowPointerEnd = (event) => {
      if (event.pointerId === this.backpackNativePointerId) this.resetBackpackPointer();
    };
    this.onBlur = () => {
      this.resetBackpackPointer();
      this.resetSourceSelection();
    };
    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.resetBackpackPointer();
        this.resetSourceSelection();
      }
    };
    this.onResize = () => this.reposition();

    this.backpackButton.on('pointerdown', this.onBackpackPointerDown);
    this.scene.input.on('pointerup', this.onBackpackPointerEnd);
    this.scene.input.on('pointerupoutside', this.onBackpackPointerEnd);
    this.scene.scale.on('resize', this.onResize);
    window.addEventListener('pointerup', this.onWindowPointerEnd);
    window.addEventListener('pointercancel', this.onWindowPointerEnd);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  reposition() {
    if (this.destroyed) return;
    const width = this.scene.scale.gameSize.width;
    const height = this.scene.scale.gameSize.height;
    const quickStartX = width / 2 - 112;
    this.quickSlots.forEach((slot, index) => {
      const x = quickStartX + index * 52;
      const y = height - 34;
      slot.background.setPosition(x, y);
      slot.icon.setPosition(x, y - 3);
      slot.quantityText.setPosition(x + 17, y + 16);
    });

    this.panelBackground.setPosition(width / 2, height / 2);
    this.panelTitle.setPosition(width / 2, height / 2 - 108);
    this.mainSlots.forEach((slot, index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = width / 2 - 112 + col * 56;
      const y = height / 2 - 65 + row * 56;
      slot.background.setPosition(x, y);
      slot.icon.setPosition(x, y - 3);
      slot.quantityText.setPosition(x + 17, y + 16);
    });
    this.backpackButton.setPosition(width - 52, 52);
    this.backpackLabel.setPosition(width - 52, 52);
  }

  setInteractionBlocked(blocked) {
    const next = Boolean(blocked);
    if (this.interactionBlocked === next) return;
    this.interactionBlocked = next;
    if (next) {
      if (this.isOpen) this.closePanel();
      this.resetBackpackPointer();
      this.resetSourceSelection();
      this.disableSlotInteractivity();
      if (this.backpackButton && this.backpackButton.input) this.backpackButton.disableInteractive();
      return;
    }
    if (this.destroyed) return;
    this.enableSlotInteractivity();
    if (this.backpackButton && this.backpackButton.active) this.backpackButton.setInteractive();
  }

  disableSlotInteractivity() {
    [...this.quickSlots, ...this.mainSlots].forEach((slot) => {
      if (slot.background && slot.background.input) slot.background.disableInteractive();
    });
  }

  enableSlotInteractivity() {
    if (this.destroyed) return;
    this.quickSlots.forEach((slot) => {
      if (slot.background && slot.background.active) slot.background.setInteractive();
    });
    if (this.isOpen) {
      this.mainSlots.forEach((slot) => {
        if (slot.background && slot.background.active) slot.background.setInteractive();
      });
    }
  }

  updateFromModel() {
    if (this.destroyed) return;
    const slots = this.inventoryModel.getSlots();
    [...this.quickSlots, ...this.mainSlots].forEach((slot) => {
      const contents = slots[slot.slotIndex];
      const contentVisible = contents !== null && (slot.slotIndex < 5 || this.isOpen);
      if (contents) {
        const definition = ItemCatalog[contents.itemType];
        if (!definition || !this.textureKeys[contents.itemType]) {
          throw new Error(`Нельзя отобразить предмет: ${contents.itemType}.`);
        }
        slot.icon.setTexture(this.textureKeys[contents.itemType]).setVisible(contentVisible);
        slot.quantityText
          .setText(String(contents.quantity))
          .setVisible(contentVisible);
      } else {
        slot.icon.setVisible(false);
        slot.quantityText.setText('').setVisible(false);
      }
    });
    this.updateSlotHighlights();
  }

  setActiveQuickSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 5) return false;
    this.activeQuickSlotIndex = index;
    this.updateSlotHighlights();
    return true;
  }

  getActiveHotbarIndex() {
    return this.activeQuickSlotIndex;
  }

  handleSlotPointerDown(index) {
    if (this.destroyed || this.interactionBlocked) return;
    if (!this.isOpen) {
      if (index < 5 && this.canSelectQuickSlot()) this.setActiveQuickSlot(index);
      return;
    }

    if (this.selectedSourceIndex === null) {
      if (this.inventoryModel.getSlot(index) !== null) {
        this.selectedSourceIndex = index;
        this.updateSlotHighlights();
      }
      return;
    }

    if (this.selectedSourceIndex === index) {
      this.resetSourceSelection();
      return;
    }

    const result = this.inventoryModel.moveOrMerge(this.selectedSourceIndex, index);
    this.resetSourceSelection();
    if (result) this.updateFromModel();
  }

  resetSourceSelection() {
    this.selectedSourceIndex = null;
    this.updateSlotHighlights();
  }

  updateSlotHighlights() {
    if (this.destroyed) return;
    [...this.quickSlots, ...this.mainSlots].forEach((slot) => {
      const isSource = slot.slotIndex === this.selectedSourceIndex;
      const isActiveQuick = slot.slotIndex === this.activeQuickSlotIndex && slot.slotIndex < 5;
      if (isSource) {
        slot.background.setStrokeStyle(4, 0x63e6ff, 1);
      } else if (isActiveQuick) {
        slot.background.setStrokeStyle(4, 0xffdf6b, 1);
      } else {
        slot.background.setStrokeStyle(2, 0x78909f, 0.8);
      }
    });
  }

  togglePanel() {
    if (this.isOpen) this.closePanel();
    else this.openPanel();
  }

  openPanel() {
    if (this.isOpen || !this.canOpenPanel()) return;
    this.isOpen = true;
    this.updateFromModel();
    this.setPanelVisible(true);
    this.onOpenChanged(true);
  }

  closePanel() {
    if (!this.isOpen) return;
    this.resetSourceSelection();
    this.isOpen = false;
    this.setPanelVisible(false);
    this.onOpenChanged(false);
  }

  setPanelVisible(visible) {
    this.panelBackground.setVisible(visible);
    this.panelTitle.setVisible(visible);
    if (visible) this.panelBackground.setInteractive();
    else this.panelBackground.disableInteractive();
    this.mainSlots.forEach((slot) => {
      slot.background.setVisible(visible);
      if (visible) {
        slot.background.setInteractive();
      } else {
        slot.background.disableInteractive();
        slot.icon.setVisible(false);
        slot.quantityText.setVisible(false);
      }
    });
  }

  resetBackpackPointer() {
    this.backpackPointerId = null;
    this.backpackNativePointerId = null;
    if (this.backpackButton && this.backpackButton.active) this.backpackButton.setScale(1);
    if (this.backpackLabel && this.backpackLabel.active) this.backpackLabel.setScale(1);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.interactionBlocked = true;
    this.resetBackpackPointer();
    this.resetSourceSelection();
    const sceneInput = this.scene && this.scene.input;
    const sceneKeyboard = sceneInput && sceneInput.keyboard;
    const sceneScale = this.scene && this.scene.scale;
    const sceneEvents = this.scene && this.scene.events;
    if (sceneKeyboard) {
      ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].forEach((keyName, index) => {
        sceneKeyboard.off(`keydown-${keyName}`, this.quickKeyHandlers[index]);
      });
      sceneKeyboard.off('keydown-I', this.onToggleKey);
      sceneKeyboard.off('keydown-ESC', this.onEscapeKey);
    }
    if (this.backpackButton) this.backpackButton.off('pointerdown', this.onBackpackPointerDown);
    if (this.panelBackground) this.panelBackground.off('pointerdown', this.onPanelPointerDown);
    [...this.quickSlots, ...this.mainSlots].forEach(
      (slot) => { if (slot.background) slot.background.off('pointerdown', slot.onPointerDown); }
    );
    if (sceneInput) {
      sceneInput.off('pointerup', this.onBackpackPointerEnd);
      sceneInput.off('pointerupoutside', this.onBackpackPointerEnd);
    }
    if (sceneScale) sceneScale.off('resize', this.onResize);
    window.removeEventListener('pointerup', this.onWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onWindowPointerEnd);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (sceneEvents) {
      sceneEvents.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
      sceneEvents.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    }
    new Set(this.elements).forEach((element) => {
      if (element && element.active) element.destroy();
    });
    this.elements = [];
    this.quickSlots = [];
    this.mainSlots = [];
    this.panelElements = [];
  }
}
