class CraftingUI {
  constructor(scene, craftingModel, onOpenChanged, onCraftResult, canOpenPanel, textureKeys) {
    this.scene = scene;
    this.craftingModel = craftingModel;
    this.onOpenChanged = onOpenChanged;
    this.onCraftResult = onCraftResult;
    this.canOpenPanel = canOpenPanel || (() => true);
    this.textureKeys = textureKeys;
    this.recipeIds = Object.keys(RecipeCatalog).filter(
      (recipeId) => !RecipeCatalog[recipeId].station
    );
    this.selectedRecipeId = this.recipeIds[0];
    this.isOpen = false;
    this.destroyed = false;
    this.togglePointerId = null;
    this.toggleNativePointerId = null;
    this.elements = [];
    this.panelElements = [];
    this.interactivePanelElements = [];
    this.recipeRows = [];

    this.createPanel();
    this.createToggleButton();
    this.registerHandlers();
    this.setPanelVisible(false);
  }

  createPanel() {
    this.panelBackground = this.scene.add.rectangle(480, 270, 460, 480, 0x0d141b, 0.96)
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 35)
      .setStrokeStyle(3, 0xbad5e8, 0.75).setInteractive();
    this.panelTitle = this.scene.add.text(480, 55, UiText.panels.crafting, {
      fontFamily: 'Arial, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 36);
    this.elements.push(this.panelBackground, this.panelTitle);
    this.panelElements.push(this.panelBackground, this.panelTitle);
    this.interactivePanelElements.push(this.panelBackground);

    this.onPanelPointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    };
    this.panelBackground.on('pointerdown', this.onPanelPointerDown);

    this.recipeIds.forEach((recipeId, index) => {
      const recipe = RecipeCatalog[recipeId];
      const textureKey = this.textureKeys && this.textureKeys[recipe.result.itemType];
      if (!textureKey) throw new Error(`Нельзя отобразить результат крафта: ${recipe.result.itemType}.`);
      const y = 115 + index * 72;
      const background = this.scene.add.rectangle(480, y, 410, 58, 0x1b2731, 0.96)
        .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 37)
        .setStrokeStyle(2, 0x78909f, 0.8).setInteractive();
      const ingredientsText = recipe.ingredients
        .map((ingredient) => `${ItemCatalog[ingredient.itemType].displayName} ×${ingredient.quantity}`)
        .join('  ');
      const text = this.scene.add.text(290, y - 20, `${recipe.displayName}\n${ingredientsText}`, {
        fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#ffffff', lineSpacing: 5
      }).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 38);
      const resultIcon = this.scene.add.image(620, y, textureKey)
        .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 38);
      const resultText = this.scene.add.text(
        680,
        y,
        `→ ×${recipe.result.quantity}`,
        {
        fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#fff4b0'
        }
      ).setOrigin(1, 0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 38);
      const row = { recipeId, background, text, resultIcon, resultText };
      row.onPointerDown = (pointer, localX, localY, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.selectRecipe(recipeId);
      };
      background.on('pointerdown', row.onPointerDown);
      this.recipeRows.push(row);
      this.elements.push(background, text, resultIcon, resultText);
      this.panelElements.push(background, text, resultIcon, resultText);
      this.interactivePanelElements.push(background);
    });

    this.createButton = this.scene.add.rectangle(480, 450, 180, 48, 0x3f8f5b, 0.95)
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 37)
      .setStrokeStyle(2, 0xd9ffe3, 0.9).setInteractive();
    this.createButtonText = this.scene.add.text(480, 450, UiText.buttons.craftConfirm, {
      fontFamily: 'Arial, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 38);
    this.onCreatePointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!this.isOpen) return;
      const result = this.craftingModel.craft(this.selectedRecipeId);
      this.onCraftResult(result, RecipeCatalog[this.selectedRecipeId]);
    };
    this.createButton.on('pointerdown', this.onCreatePointerDown);
    this.elements.push(this.createButton, this.createButtonText);
    this.panelElements.push(this.createButton, this.createButtonText);
    this.interactivePanelElements.push(this.createButton);
    this.updateSelection();
  }

  createToggleButton() {
    this.toggleButton = this.scene.add.circle(0, 0, 28, 0x674d82, 0.9)
      .setScrollFactor(0).setDepth(INTERFACE_DEPTH + 32)
      .setStrokeStyle(2, 0xe0c9f5, 0.85).setInteractive();
    this.toggleButtonText = this.scene.add.text(0, 0, UiText.buttons.craft, {
      fontFamily: 'Arial, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 33);
    this.toggleButton.setPosition(this.scene.scale.gameSize.width - 52, 122);
    this.toggleButtonText.setPosition(this.scene.scale.gameSize.width - 52, 122);
    this.elements.push(this.toggleButton, this.toggleButtonText);
  }

  registerHandlers() {
    this.onCraftKey = (event) => {
      if (!event || !event.repeat) this.togglePanel();
    };
    this.onEscapeKey = (event) => {
      if (!event || !event.repeat) this.closePanel();
    };
    this.scene.input.keyboard.on('keydown-C', this.onCraftKey);
    this.scene.input.keyboard.on('keydown-ESC', this.onEscapeKey);

    this.onTogglePointerDown = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.togglePointerId !== null) return;
      this.togglePointerId = pointer.id;
      this.toggleNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.toggleButton.setScale(0.92);
      this.toggleButtonText.setScale(0.92);
      this.togglePanel();
    };
    this.onTogglePointerEnd = (pointer) => {
      if (pointer.id === this.togglePointerId) this.resetPointer();
    };
    this.onWindowPointerEnd = (event) => {
      if (event.pointerId === this.toggleNativePointerId) this.resetPointer();
    };
    this.onBlur = () => this.resetPointer();
    this.onVisibilityChange = () => {
      if (document.hidden) this.resetPointer();
    };
    this.onResize = () => {
      this.resetPointer();
      this.toggleButton.setPosition(this.scene.scale.gameSize.width - 52, 122);
      this.toggleButtonText.setPosition(this.scene.scale.gameSize.width - 52, 122);
    };

    this.toggleButton.on('pointerdown', this.onTogglePointerDown);
    this.scene.input.on('pointerup', this.onTogglePointerEnd);
    this.scene.input.on('pointerupoutside', this.onTogglePointerEnd);
    this.scene.scale.on('resize', this.onResize);
    window.addEventListener('pointerup', this.onWindowPointerEnd);
    window.addEventListener('pointercancel', this.onWindowPointerEnd);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  selectRecipe(recipeId) {
    if (!this.recipeIds.includes(recipeId)) return false;
    this.selectedRecipeId = recipeId;
    this.updateSelection();
    return true;
  }

  updateSelection() {
    this.recipeRows.forEach((row) => {
      const selected = row.recipeId === this.selectedRecipeId;
      row.background.setStrokeStyle(selected ? 4 : 2, selected ? 0xffdf6b : 0x78909f, 1);
    });
  }

  togglePanel() {
    if (this.isOpen) this.closePanel();
    else this.openPanel();
  }

  openPanel() {
    if (this.isOpen || !this.canOpenPanel()) return;
    this.isOpen = true;
    this.setPanelVisible(true);
    this.onOpenChanged(true);
  }

  closePanel() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.setPanelVisible(false);
    this.onOpenChanged(false);
  }

  setPanelVisible(visible) {
    this.panelElements.forEach((element) => element.setVisible(visible));
    this.interactivePanelElements.forEach((element) => {
      if (visible) element.setInteractive();
      else element.disableInteractive();
    });
  }

  resetPointer() {
    this.togglePointerId = null;
    this.toggleNativePointerId = null;
    if (this.toggleButton && this.toggleButton.active) this.toggleButton.setScale(1);
    if (this.toggleButtonText && this.toggleButtonText.active) this.toggleButtonText.setScale(1);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resetPointer();
    this.selectedRecipeId = null;
    this.scene.input.keyboard.off('keydown-C', this.onCraftKey);
    this.scene.input.keyboard.off('keydown-ESC', this.onEscapeKey);
    this.panelBackground.off('pointerdown', this.onPanelPointerDown);
    this.recipeRows.forEach((row) => row.background.off('pointerdown', row.onPointerDown));
    this.createButton.off('pointerdown', this.onCreatePointerDown);
    this.toggleButton.off('pointerdown', this.onTogglePointerDown);
    this.scene.input.off('pointerup', this.onTogglePointerEnd);
    this.scene.input.off('pointerupoutside', this.onTogglePointerEnd);
    this.scene.scale.off('resize', this.onResize);
    window.removeEventListener('pointerup', this.onWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onWindowPointerEnd);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.elements.forEach((element) => {
      if (element && element.active) element.destroy();
    });
    this.elements = [];
    this.panelElements = [];
    this.interactivePanelElements = [];
    this.recipeRows = [];
  }
}
