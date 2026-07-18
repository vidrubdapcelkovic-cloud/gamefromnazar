class InputController {
  static get TOP_ACTION_BUTTON_Y() { return 42; }
  static get TOP_ACTION_BUTTON_GAP() { return 16; }
  static get SAVE_LOAD_RADIUS() { return 25; }
  static get MENU_BUTTON_WIDTH() { return 82; }
  static get MENU_BUTTON_HEIGHT() { return 40; }
  static get STATUS_HUD_LEFT_X() { return 600; }

  constructor(scene, handlers) {
    this.scene = scene;
    this.handlers = handlers || {};
    this.enabled = true;
    this.gameControlsBlocked = false;
    this.destroyed = false;
    this.cleanupDone = false;
    this.movementVector = new Phaser.Math.Vector2();

    this.pending = {
      attack: false,
      use: false,
      buildToggle: false,
      cancelBuild: false,
      placeBuild: false,
      save: false,
      load: false,
      menu: false
    };

    this.actionPointerId = null;
    this.actionNativePointerId = null;
    this.attackPointerId = null;
    this.attackNativePointerId = null;
    this.usePointerId = null;
    this.useNativePointerId = null;
    this.savePointers = { save: null, load: null };
    this.saveNativePointers = { save: null, load: null };
    this.buildTogglePointerId = null;
    this.buildToggleNativePointerId = null;
    this.placePointerId = null;
    this.placeNativePointerId = null;

    scene.input.addPointer(1);
    this.setupKeyboard();
    this.createVirtualJoystick();
    this.createActionButton();
    this.createUseButton();
    this.createAttackButton();
    this.createSaveButtons();
    this.createMenuButton();
    this.createBuildingButtons();
    this.registerLifecycleHandlers();
  }

  setupKeyboard() {
    this.cursors = this.scene.input.keyboard.createCursorKeys();
    this.wasd = this.scene.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    this.interactKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.useKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.buildToggleKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.placeBuildKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.cancelBuildKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.attackKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.saveKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K);
    this.loadKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
  }

  createVirtualJoystick() {
    this.virtualJoystick = new VirtualJoystick(this.scene);
  }

  createActionButton() {
    this.actionButton = this.scene.add.circle(0, 0, 36, 0x263642, 0.42)
      .setStrokeStyle(3, 0xb9cbd6, 0.5)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH)
      .setInteractive();

    this.actionButtonLabel = this.scene.add.text(0, 0, 'E', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '30px',
      fontStyle: 'bold',
      color: '#b9cbd6'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 1);

    this.onActionPointerDown = (pointer) => {
      if (!this.enabled || this.gameControlsBlocked) return;
      if (this.actionPointerId !== null) return;
      this.actionPointerId = pointer.id;
      this.actionNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.actionButton.setScale(0.92);
      this.actionButtonLabel.setScale(0.92);
      if (this.handlers.onActionPointerDown) this.handlers.onActionPointerDown(pointer);
    };
    this.onActionPointerEnd = (pointer) => {
      if (pointer.id !== this.actionPointerId) return;
      if (this.handlers.onActionPointerEnd) this.handlers.onActionPointerEnd(pointer);
      this.resetActionButton();
    };
    this.onActionPointerOut = (pointer) => {
      if (pointer.id !== this.actionPointerId) return;
      if (this.handlers.onActionPointerOut) this.handlers.onActionPointerOut(pointer);
      this.resetActionButton();
    };
    this.onActionWindowPointerEnd = (event) => {
      if (event.pointerId !== this.actionNativePointerId) return;
      if (this.handlers.onActionPointerEnd) this.handlers.onActionPointerEnd(null);
      this.resetActionButton();
    };
    this.onActionBlur = () => {
      if (this.handlers.onActionPointerOut) this.handlers.onActionPointerOut(null);
      this.resetActionButton();
    };
    this.onActionVisibilityChange = () => {
      if (document.hidden) this.onActionBlur();
    };
    this.onActionResize = () => {
      this.onActionBlur();
      this.positionActionButton();
    };

    this.actionButton.on('pointerdown', this.onActionPointerDown);
    this.actionButton.on('pointerout', this.onActionPointerOut);
    this.scene.input.on('pointerup', this.onActionPointerEnd);
    this.scene.input.on('pointerupoutside', this.onActionPointerEnd);
    this.scene.scale.on('resize', this.onActionResize);
    window.addEventListener('pointerup', this.onActionWindowPointerEnd);
    window.addEventListener('pointercancel', this.onActionWindowPointerEnd);
    window.addEventListener('blur', this.onActionBlur);
    document.addEventListener('visibilitychange', this.onActionVisibilityChange);

    this.positionActionButton();
  }

  positionActionButton() {
    const x = this.scene.scale.gameSize.width - 92;
    const y = this.scene.scale.gameSize.height - 92;
    this.actionButton.setPosition(x, y);
    this.actionButtonLabel.setPosition(x, y);
  }

  updateActionButtonAppearance(hasTarget) {
    if (!this.actionButton || !this.actionButton.active) return;
    this.actionButton.setFillStyle(hasTarget ? 0x3f8f5b : 0x263642, hasTarget ? 0.82 : 0.42);
    this.actionButton.setStrokeStyle(3, hasTarget ? 0xd9ffe3 : 0xb9cbd6, hasTarget ? 0.95 : 0.5);
    this.actionButtonLabel.setColor(hasTarget ? '#ffffff' : '#b9cbd6');
  }

  resetActionButton() {
    this.actionPointerId = null;
    this.actionNativePointerId = null;
    if (this.actionButton && this.actionButton.active) this.actionButton.setScale(1);
    if (this.actionButtonLabel && this.actionButtonLabel.active) this.actionButtonLabel.setScale(1);
  }

  createUseButton() {
    this.useButton = this.scene.add.circle(0, 0, 30, 0x36516a, 0.88)
      .setStrokeStyle(3, 0xc8e8ff, 0.85)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 10)
      .setInteractive();
    this.useButtonLabel = this.scene.add.text(0, 0, 'USE', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 11);

    this.onUsePointerDown = (pointer, localX, localY, event) => {
      if (!this.enabled) return;
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.usePointerId !== null) return;
      this.usePointerId = pointer.id;
      this.useNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.useButton.setScale(0.92);
      this.useButtonLabel.setScale(0.92);
      this.pending.use = true;
    };
    this.onUsePointerEnd = (pointer) => {
      if (pointer.id === this.usePointerId) this.resetUseButton();
    };
    this.onUseWindowPointerEnd = (event) => {
      if (event.pointerId === this.useNativePointerId) this.resetUseButton();
    };
    this.onUseBlur = () => this.resetUseButton();
    this.onUseVisibilityChange = () => {
      if (document.hidden) this.resetUseButton();
    };
    this.onUseResize = () => {
      this.resetUseButton();
      this.positionUseButton();
    };

    this.useButton.on('pointerdown', this.onUsePointerDown);
    this.scene.input.on('pointerup', this.onUsePointerEnd);
    this.scene.input.on('pointerupoutside', this.onUsePointerEnd);
    this.scene.scale.on('resize', this.onUseResize);
    window.addEventListener('pointerup', this.onUseWindowPointerEnd);
    window.addEventListener('pointercancel', this.onUseWindowPointerEnd);
    window.addEventListener('blur', this.onUseBlur);
    document.addEventListener('visibilitychange', this.onUseVisibilityChange);

    this.positionUseButton();
  }

  positionUseButton() {
    const x = this.scene.scale.gameSize.width - 176;
    const y = this.scene.scale.gameSize.height - 92;
    this.useButton.setPosition(x, y);
    this.useButtonLabel.setPosition(x, y);
  }

  setUseButtonDisabled(isDead) {
    if (!this.useButton) return;
    this.useButton.setFillStyle(isDead ? 0x303840 : 0x36516a, isDead ? 0.55 : 0.88);
    this.useButton.setStrokeStyle(3, isDead ? 0x77838c : 0xc8e8ff, isDead ? 0.5 : 0.85);
  }

  resetUseButton() {
    this.usePointerId = null;
    this.useNativePointerId = null;
    if (this.useButton && this.useButton.active) this.useButton.setScale(1);
    if (this.useButtonLabel && this.useButtonLabel.active) this.useButtonLabel.setScale(1);
  }

  createAttackButton() {
    this.attackButton = this.scene.add.circle(0, 0, 30, 0x8b3f47, 0.9)
      .setStrokeStyle(3, 0xffc4c8, 0.9).setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 12).setInteractive();
    this.attackButtonLabel = this.scene.add.text(0, 0, 'ATTACK', {
      fontFamily: 'Arial, sans-serif', fontSize: '9px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13);

    this.onAttackPointerDown = (pointer, localX, localY, event) => {
      if (!this.enabled) return;
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.attackPointerId !== null) return;
      this.attackPointerId = pointer.id;
      this.attackNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.attackButton.setScale(0.92);
      this.attackButtonLabel.setScale(0.92);
      this.pending.attack = true;
    };
    this.onAttackPointerEnd = (pointer) => {
      if (pointer.id === this.attackPointerId) this.resetAttackButton();
    };
    this.onAttackWindowEnd = (event) => {
      if (event.pointerId === this.attackNativePointerId) this.resetAttackButton();
    };
    this.onAttackBlur = () => this.resetAttackButton();
    this.onAttackVisibility = () => {
      if (document.hidden) this.resetAttackButton();
    };
    this.onAttackResize = () => {
      this.resetAttackButton();
      this.positionAttackButton();
    };

    this.attackButton.on('pointerdown', this.onAttackPointerDown);
    this.scene.input.on('pointerup', this.onAttackPointerEnd);
    this.scene.input.on('pointerupoutside', this.onAttackPointerEnd);
    this.scene.scale.on('resize', this.onAttackResize);
    window.addEventListener('pointerup', this.onAttackWindowEnd);
    window.addEventListener('pointercancel', this.onAttackWindowEnd);
    window.addEventListener('blur', this.onAttackBlur);
    document.addEventListener('visibilitychange', this.onAttackVisibility);

    this.positionAttackButton();
  }

  positionAttackButton() {
    const x = this.scene.scale.gameSize.width - 328;
    const y = this.scene.scale.gameSize.height - 92;
    this.attackButton.setPosition(x, y);
    this.attackButtonLabel.setPosition(x, y);
  }

  resetAttackButton() {
    this.attackPointerId = null;
    this.attackNativePointerId = null;
    if (this.attackButton && this.attackButton.active) this.attackButton.setScale(1);
    if (this.attackButtonLabel && this.attackButtonLabel.active) this.attackButtonLabel.setScale(1);
  }

  createSaveButtons() {
    const make = (label) => ({
      button: this.scene.add.circle(0, 0, InputController.SAVE_LOAD_RADIUS, 0x35536b, 0.9)
        .setStrokeStyle(2, 0xcbe9ff, 0.8).setScrollFactor(0)
        .setDepth(INTERFACE_DEPTH + 12).setInteractive(),
      text: this.scene.add.text(0, 0, label, {
        fontFamily: 'Arial, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#fff'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13)
    });

    this.saveControl = make('SAVE');
    this.loadControl = make('LOAD');

    const bind = (name, control) => {
      control.handler = (pointer, localX, localY, event) => {
        if (!this.enabled) return;
        if (event && event.stopPropagation) event.stopPropagation();
        if (this.savePointers[name] !== null) return;
        this.savePointers[name] = pointer.id;
        this.saveNativePointers[name] = pointer.event ? pointer.event.pointerId : null;
        this.pending[name] = true;
      };
      control.button.on('pointerdown', control.handler);
    };

    bind('save', this.saveControl);
    bind('load', this.loadControl);

    this.onSavePointerUp = (pointer) => {
      for (const name of ['save', 'load']) {
        if (this.savePointers[name] === pointer.id) {
          this.savePointers[name] = null;
          this.saveNativePointers[name] = null;
        }
      }
    };
    this.onSaveWindowUp = (event) => {
      for (const name of ['save', 'load']) {
        if (this.saveNativePointers[name] === event.pointerId) {
          this.savePointers[name] = null;
          this.saveNativePointers[name] = null;
        }
      }
    };
    this.onSaveBlur = () => {
      this.savePointers.save = null;
      this.savePointers.load = null;
      this.saveNativePointers.save = null;
      this.saveNativePointers.load = null;
    };
    this.onSaveVisibility = () => {
      if (document.hidden) this.onSaveBlur();
    };

    this.scene.input.on('pointerup', this.onSavePointerUp);
    this.scene.input.on('pointerupoutside', this.onSavePointerUp);
    window.addEventListener('pointerup', this.onSaveWindowUp);
    window.addEventListener('pointercancel', this.onSaveWindowUp);
    window.addEventListener('blur', this.onSaveBlur);
    document.addEventListener('visibilitychange', this.onSaveVisibility);
  }

  createMenuButton() {
    this.menuControl = {
      button: this.scene.add.rectangle(0, 0, InputController.MENU_BUTTON_WIDTH, InputController.MENU_BUTTON_HEIGHT, 0x45556a, 0.95)
        .setStrokeStyle(2, 0xcbe9ff, 0.8).setScrollFactor(0)
        .setDepth(INTERFACE_DEPTH + 12).setInteractive({ useHandCursor: true }),
      text: this.scene.add.text(0, 0, 'МЕНЮ', {
        fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffffff'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13)
    };

    this.onMenuControlDown = (pointer, localX, localY, event) => {
      if (!this.enabled || this.gameControlsBlocked) return;
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.handlers.onMenuPointerDown) {
        this.handlers.onMenuPointerDown();
        return;
      }
      this.pending.menu = true;
    };
    this.menuControl.button.on('pointerdown', this.onMenuControlDown);
    this.positionTopActionButtons();
    this.onTopActionButtonsResize = () => this.positionTopActionButtons();
    this.scene.scale.on('resize', this.onTopActionButtonsResize);
  }

  positionTopActionButtons() {
    if (!this.saveControl || !this.loadControl || !this.menuControl) return;

    const y = InputController.TOP_ACTION_BUTTON_Y;
    const gap = InputController.TOP_ACTION_BUTTON_GAP;
    const saveLoadRadius = InputController.SAVE_LOAD_RADIUS;
    const menuHalfWidth = InputController.MENU_BUTTON_WIDTH / 2;
    const rightEdge = InputController.STATUS_HUD_LEFT_X - gap;
    const menuX = rightEdge - menuHalfWidth;
    const menuLeft = menuX - menuHalfWidth;
    const loadX = menuLeft - gap - saveLoadRadius;
    const saveX = loadX - saveLoadRadius - gap - saveLoadRadius;

    this.saveControl.button.setPosition(saveX, y);
    this.saveControl.text.setPosition(saveX, y);
    this.loadControl.button.setPosition(loadX, y);
    this.loadControl.text.setPosition(loadX, y);
    this.menuControl.button.setPosition(menuX, y);
    this.menuControl.text.setPosition(menuX, y);
  }

  createBuildingButtons() {
    this.buildTypeControls = [];

    this.buildToggleButton = this.scene.add.circle(0, 0, 28, 0x806039, 0.9)
      .setStrokeStyle(2, 0xf1d2a5, 0.85).setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 12).setInteractive();
    this.buildToggleLabel = this.scene.add.text(0, 0, 'СТРОИТЬ', {
      fontFamily: 'Arial, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13);
    this.placeButton = this.scene.add.circle(0, 0, 30, 0x3f8f5b, 0.9)
      .setStrokeStyle(3, 0xd9ffe3, 0.9).setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 12).setInteractive().setVisible(false);
    this.placeButton.disableInteractive();
    this.placeButtonLabel = this.scene.add.text(0, 0, 'PLACE', {
      fontFamily: 'Arial, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13).setVisible(false);

    Object.keys(BuildCatalog).forEach((buildType) => {
      const definition = BuildCatalog[buildType];
      const costText = definition.cost
        .map((cost) => `${cost.itemType} ×${cost.quantity}`)
        .join(' + ');
      const button = this.scene.add.rectangle(0, 0, 132, 46, 0x3b4650, 0.94)
        .setStrokeStyle(2, 0xa9bac7, 0.8)
        .setScrollFactor(0)
        .setDepth(INTERFACE_DEPTH + 12)
        .setVisible(false)
        .setInteractive();
      button.disableInteractive();
      const label = this.scene.add.text(0, 0, `${definition.displayName}\n${costText}`, {
        fontFamily: 'Arial, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff',
        align: 'center', lineSpacing: 2
      }).setOrigin(0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 13).setVisible(false);
      const onPointerDown = (pointer, localX, localY, event) => {
        if (!this.enabled) return;
        if (event && event.stopPropagation) event.stopPropagation();
        if (this.handlers.onBuildTypePointerDown) this.handlers.onBuildTypePointerDown(buildType);
      };
      button.on('pointerdown', onPointerDown);
      this.buildTypeControls.push({ buildType, button, label, onPointerDown });
    });

    this.onBuildTogglePointerDown = (pointer, localX, localY, event) => {
      if (!this.enabled) return;
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.buildTogglePointerId !== null) return;
      this.buildTogglePointerId = pointer.id;
      this.buildToggleNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.buildToggleButton.setScale(0.92);
      this.buildToggleLabel.setScale(0.92);
      this.pending.buildToggle = true;
    };
    this.onPlacePointerDown = (pointer, localX, localY, event) => {
      if (!this.enabled) return;
      if (event && event.stopPropagation) event.stopPropagation();
      if (this.placePointerId !== null) return;
      this.placePointerId = pointer.id;
      this.placeNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.placeButton.setScale(0.92);
      this.placeButtonLabel.setScale(0.92);
      this.pending.placeBuild = true;
    };
    this.onBuildingPointerEnd = (pointer) => {
      if (pointer.id === this.buildTogglePointerId) this.resetBuildTogglePointer();
      if (pointer.id === this.placePointerId) this.resetPlacePointer();
    };
    this.onBuildingWindowPointerEnd = (event) => {
      if (event.pointerId === this.buildToggleNativePointerId) this.resetBuildTogglePointer();
      if (event.pointerId === this.placeNativePointerId) this.resetPlacePointer();
    };
    this.onBuildingBlur = () => {
      this.resetBuildTogglePointer();
      this.resetPlacePointer();
    };
    this.onBuildingVisibilityChange = () => {
      if (document.hidden) this.onBuildingBlur();
    };
    this.onBuildingResize = () => {
      this.onBuildingBlur();
      this.positionBuildingButtons();
    };

    this.buildToggleButton.on('pointerdown', this.onBuildTogglePointerDown);
    this.placeButton.on('pointerdown', this.onPlacePointerDown);
    this.scene.input.on('pointerup', this.onBuildingPointerEnd);
    this.scene.input.on('pointerupoutside', this.onBuildingPointerEnd);
    this.scene.scale.on('resize', this.onBuildingResize);
    window.addEventListener('pointerup', this.onBuildingWindowPointerEnd);
    window.addEventListener('pointercancel', this.onBuildingWindowPointerEnd);
    window.addEventListener('blur', this.onBuildingBlur);
    document.addEventListener('visibilitychange', this.onBuildingVisibilityChange);

    this.positionBuildingButtons();
  }

  positionBuildingButtons() {
    const width = this.scene.scale.gameSize.width;
    const height = this.scene.scale.gameSize.height;
    this.buildToggleButton.setPosition(width - 52, 192);
    this.buildToggleLabel.setPosition(width - 52, 192);
    this.placeButton.setPosition(width - 260, height - 92);
    this.placeButtonLabel.setPosition(width - 260, height - 92);
    const buildControlStartX = width / 2 - ((this.buildTypeControls.length - 1) * 145) / 2;
    this.buildTypeControls.forEach((control, index) => {
      const x = buildControlStartX + index * 145;
      control.button.setPosition(x, 192);
      control.label.setPosition(x, 192);
    });
  }

  resetBuildTogglePointer() {
    this.buildTogglePointerId = null;
    this.buildToggleNativePointerId = null;
    if (this.buildToggleButton && this.buildToggleButton.active) this.buildToggleButton.setScale(1);
    if (this.buildToggleLabel && this.buildToggleLabel.active) this.buildToggleLabel.setScale(1);
  }

  resetPlacePointer() {
    this.placePointerId = null;
    this.placeNativePointerId = null;
    if (this.placeButton && this.placeButton.active) this.placeButton.setScale(1);
    if (this.placeButtonLabel && this.placeButtonLabel.active) this.placeButtonLabel.setScale(1);
  }

  getMovementVector() {
    let horizontal = 0;
    let vertical = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) horizontal -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) horizontal += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vertical -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vertical += 1;

    const joystickDirection = this.virtualJoystick.getDirection();
    const movement = this.movementVector.set(
      horizontal + joystickDirection.x,
      vertical + joystickDirection.y
    );

    if (movement.lengthSq() > 1) movement.normalize();
    return movement;
  }

  consumeFlag(flagName, keyboardKey) {
    const fromKeyboard = keyboardKey && Phaser.Input.Keyboard.JustDown(keyboardKey);
    const fromPending = this.pending[flagName];
    if (fromPending) this.pending[flagName] = false;
    return fromKeyboard || fromPending;
  }

  consumeAttackPressed() {
    return this.consumeFlag('attack', this.attackKey);
  }

  consumeUsePressed() {
    return this.consumeFlag('use', this.useKey);
  }

  consumeInteractPressed() {
    return Phaser.Input.Keyboard.JustDown(this.interactKey);
  }

  isInteractKeyDown() {
    return this.interactKey.isDown;
  }

  consumeBuildTogglePressed() {
    return this.consumeFlag('buildToggle', this.buildToggleKey);
  }

  consumeCancelBuildPressed() {
    return this.consumeFlag('cancelBuild', this.cancelBuildKey);
  }

  consumePlaceBuildPressed() {
    return this.consumeFlag('placeBuild', this.placeBuildKey);
  }

  consumeSavePressed() {
    return this.consumeFlag('save', this.saveKey);
  }

  consumeLoadPressed() {
    return this.consumeFlag('load', this.loadKey);
  }

  consumeMenuPressed() {
    return this.consumeFlag('menu', null);
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (!next && this.enabled) {
      this.resetTransientState();
      this.resetHardwareState();
    }
    this.enabled = next;
  }

  resetTransientState() {
    this.pending.attack = false;
    this.pending.use = false;
    this.pending.buildToggle = false;
    this.pending.cancelBuild = false;
    this.pending.placeBuild = false;
    this.pending.save = false;
    this.pending.load = false;
    this.pending.menu = false;
    this.resetActionButton();
    this.resetAttackButton();
    this.resetUseButton();
    this.resetBuildTogglePointer();
    this.resetPlacePointer();
    this.onSaveBlur();
  }

  resetHardwareState() {
    if (this.scene.input.keyboard) this.scene.input.keyboard.resetKeys();
    if (this.virtualJoystick) this.virtualJoystick.reset();
  }

  setGameControlsBlocked(blocked) {
    const next = Boolean(blocked);
    if (this.gameControlsBlocked === next) return;
    this.gameControlsBlocked = next;
    if (next) {
      this.resetTransientState();
      this.resetHardwareState();
      this.disableGameControlInteractivity();
      return;
    }
    this.restoreGameControlInteractivity();
  }

  disableGameControlInteractivity() {
    [
      this.actionButton,
      this.useButton,
      this.attackButton,
      this.saveControl ? this.saveControl.button : null,
      this.loadControl ? this.loadControl.button : null,
      this.menuControl ? this.menuControl.button : null,
      this.buildToggleButton,
      this.placeButton,
      ...this.buildTypeControls.map((control) => control.button)
    ].forEach((object) => {
      if (object && object.input && object.input.enabled) object.disableInteractive();
    });
  }

  restoreGameControlInteractivity() {
    if (this.destroyed || !this.enabled) return;
    const enable = (object) => {
      if (object && object.active) object.setInteractive();
    };
    enable(this.actionButton);
    enable(this.useButton);
    enable(this.attackButton);
    if (this.saveControl) enable(this.saveControl.button);
    if (this.loadControl) enable(this.loadControl.button);
    if (this.menuControl) enable(this.menuControl.button);
    enable(this.buildToggleButton);
    if (this.placeButton && this.placeButton.visible) enable(this.placeButton);
    this.buildTypeControls.forEach((control) => {
      if (control.button.visible) enable(control.button);
    });
  }

  registerLifecycleHandlers() {
    this.lifecycleHandlersRemoved = false;
    this.pendingScaleRefresh = null;

    this.resetControls = () => {
      this.resetHardwareState();
      if (this.scene.player && this.scene.player.body) this.scene.player.setVelocity(0, 0);
    };

    this.refreshScaleAfterLayout = () => {
      this.resetControls();
      if (this.pendingScaleRefresh !== null) {
        window.cancelAnimationFrame(this.pendingScaleRefresh);
      }
      this.pendingScaleRefresh = window.requestAnimationFrame(() => {
        this.pendingScaleRefresh = null;
        if (this.scene.sys.isActive()) this.scene.scale.refresh();
      });
    };

    this.onVisibilityChange = () => {
      this.resetControls();
      if (!document.hidden) this.refreshScaleAfterLayout();
    };

    this.scene.scale.on('resize', this.resetControls);
    window.addEventListener('blur', this.resetControls);
    window.addEventListener('focus', this.refreshScaleAfterLayout);
    window.addEventListener('orientationchange', this.refreshScaleAfterLayout);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  removeLifecycleHandlers() {
    if (this.lifecycleHandlersRemoved) return;
    this.lifecycleHandlersRemoved = true;

    if (this.pendingScaleRefresh !== null) {
      window.cancelAnimationFrame(this.pendingScaleRefresh);
      this.pendingScaleRefresh = null;
    }

    this.scene.scale.off('resize', this.resetControls);
    window.removeEventListener('blur', this.resetControls);
    window.removeEventListener('focus', this.refreshScaleAfterLayout);
    window.removeEventListener('orientationchange', this.refreshScaleAfterLayout);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanupDone = true;
    this.enabled = false;
    this.resetTransientState();
    this.removeLifecycleHandlers();

    const sceneInput = this.scene && this.scene.input;
    const sceneScale = this.scene && this.scene.scale;
    const sceneEvents = this.scene && this.scene.events;

    if (this.actionButton) {
      this.actionButton.off('pointerdown', this.onActionPointerDown);
      this.actionButton.off('pointerout', this.onActionPointerOut);
    }
    if (sceneInput) {
      sceneInput.off('pointerup', this.onActionPointerEnd);
      sceneInput.off('pointerupoutside', this.onActionPointerEnd);
    }
    if (sceneScale) sceneScale.off('resize', this.onActionResize);
    window.removeEventListener('pointerup', this.onActionWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onActionWindowPointerEnd);
    window.removeEventListener('blur', this.onActionBlur);
    document.removeEventListener('visibilitychange', this.onActionVisibilityChange);

    if (this.useButton) this.useButton.off('pointerdown', this.onUsePointerDown);
    if (sceneInput) {
      sceneInput.off('pointerup', this.onUsePointerEnd);
      sceneInput.off('pointerupoutside', this.onUsePointerEnd);
    }
    if (sceneScale) sceneScale.off('resize', this.onUseResize);
    window.removeEventListener('pointerup', this.onUseWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onUseWindowPointerEnd);
    window.removeEventListener('blur', this.onUseBlur);
    document.removeEventListener('visibilitychange', this.onUseVisibilityChange);

    if (this.attackButton) this.attackButton.off('pointerdown', this.onAttackPointerDown);
    if (sceneInput) {
      sceneInput.off('pointerup', this.onAttackPointerEnd);
      sceneInput.off('pointerupoutside', this.onAttackPointerEnd);
    }
    if (sceneScale) sceneScale.off('resize', this.onAttackResize);
    window.removeEventListener('pointerup', this.onAttackWindowEnd);
    window.removeEventListener('pointercancel', this.onAttackWindowEnd);
    window.removeEventListener('blur', this.onAttackBlur);
    document.removeEventListener('visibilitychange', this.onAttackVisibility);

    if (this.saveControl) this.saveControl.button.off('pointerdown', this.saveControl.handler);
    if (this.loadControl) this.loadControl.button.off('pointerdown', this.loadControl.handler);
    if (sceneInput) {
      sceneInput.off('pointerup', this.onSavePointerUp);
      sceneInput.off('pointerupoutside', this.onSavePointerUp);
    }
    window.removeEventListener('pointerup', this.onSaveWindowUp);
    window.removeEventListener('pointercancel', this.onSaveWindowUp);
    window.removeEventListener('blur', this.onSaveBlur);
    document.removeEventListener('visibilitychange', this.onSaveVisibility);

    if (this.menuControl) this.menuControl.button.off('pointerdown', this.onMenuControlDown);
    if (sceneScale) sceneScale.off('resize', this.onTopActionButtonsResize);

    if (this.buildToggleButton) this.buildToggleButton.off('pointerdown', this.onBuildTogglePointerDown);
    if (this.placeButton) this.placeButton.off('pointerdown', this.onPlacePointerDown);
    this.buildTypeControls.forEach((control) => {
      control.button.off('pointerdown', control.onPointerDown);
    });
    if (sceneInput) {
      sceneInput.off('pointerup', this.onBuildingPointerEnd);
      sceneInput.off('pointerupoutside', this.onBuildingPointerEnd);
    }
    if (sceneScale) sceneScale.off('resize', this.onBuildingResize);
    window.removeEventListener('pointerup', this.onBuildingWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onBuildingWindowPointerEnd);
    window.removeEventListener('blur', this.onBuildingBlur);
    document.removeEventListener('visibilitychange', this.onBuildingVisibilityChange);

    if (sceneEvents) {
      sceneEvents.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
      sceneEvents.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    }

    if (this.virtualJoystick) {
      this.virtualJoystick.destroy();
      this.virtualJoystick = null;
    }

    const destroyIfActive = (object) => {
      if (object && object.active) object.destroy();
    };

    destroyIfActive(this.actionButton);
    destroyIfActive(this.actionButtonLabel);
    destroyIfActive(this.useButton);
    destroyIfActive(this.useButtonLabel);
    destroyIfActive(this.attackButton);
    destroyIfActive(this.attackButtonLabel);
    if (this.saveControl) {
      destroyIfActive(this.saveControl.button);
      destroyIfActive(this.saveControl.text);
    }
    if (this.loadControl) {
      destroyIfActive(this.loadControl.button);
      destroyIfActive(this.loadControl.text);
    }
    if (this.menuControl) {
      destroyIfActive(this.menuControl.button);
      destroyIfActive(this.menuControl.text);
    }
    destroyIfActive(this.buildToggleButton);
    destroyIfActive(this.buildToggleLabel);
    destroyIfActive(this.placeButton);
    destroyIfActive(this.placeButtonLabel);
    this.buildTypeControls.forEach((control) => {
      destroyIfActive(control.button);
      destroyIfActive(control.label);
    });

    this.actionButton = null;
    this.actionButtonLabel = null;
    this.useButton = null;
    this.useButtonLabel = null;
    this.attackButton = null;
    this.attackButtonLabel = null;
    this.saveControl = null;
    this.loadControl = null;
    this.menuControl = null;
    this.buildToggleButton = null;
    this.buildToggleLabel = null;
    this.placeButton = null;
    this.placeButtonLabel = null;
    this.buildTypeControls = [];
  }
}
