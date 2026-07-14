class VirtualJoystick {
  constructor(scene) {
    this.scene = scene;
    this.baseRadius = 64;
    this.stickRadius = 28;
    this.deadZone = 0.12;
    this.margin = 28;
    this.activePointerId = null;
    this.activeNativePointerId = null;
    this.direction = new Phaser.Math.Vector2();
    this.destroyed = false;

    this.base = scene.add.circle(0, 0, this.baseRadius, 0x15202a, 0.48)
      .setStrokeStyle(4, 0xd7edf7, 0.48)
      .setScrollFactor(0)
      .setDepth(1000)
      .setInteractive();

    this.stick = scene.add.circle(0, 0, this.stickRadius, 0x82d7ff, 0.72)
      .setStrokeStyle(3, 0xffffff, 0.7)
      .setScrollFactor(0)
      .setDepth(1001);

    this.reposition();
    this.registerListeners();
  }

  registerListeners() {
    this.onPointerDown = (pointer) => {
      if (this.activePointerId !== null) return;

      this.activePointerId = pointer.id;
      this.activeNativePointerId = pointer.event ? pointer.event.pointerId : null;
      this.updateFromPointer(pointer);
    };

    this.onPointerMove = (pointer) => {
      if (pointer.id !== this.activePointerId) return;
      this.updateFromPointer(pointer);
    };

    this.onPointerUp = (pointer) => {
      if (pointer.id === this.activePointerId) this.reset();
    };

    this.onResize = () => {
      this.reset();
      this.reposition();
    };

    this.onWindowPointerEnd = (event) => {
      if (event.pointerId === this.activeNativePointerId) this.reset();
    };

    this.onWindowBlur = () => this.reset();
    this.onVisibilityChange = () => {
      if (document.hidden) this.reset();
    };

    this.base.on('pointerdown', this.onPointerDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
    this.scene.input.on('pointerupoutside', this.onPointerUp);
    this.scene.scale.on('resize', this.onResize);

    window.addEventListener('pointerup', this.onWindowPointerEnd);
    window.addEventListener('pointercancel', this.onWindowPointerEnd);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  reposition() {
    const width = this.scene.scale.gameSize.width;
    const height = this.scene.scale.gameSize.height;

    this.centerX = this.margin + this.baseRadius;
    this.centerY = height - this.margin - this.baseRadius;
    this.base.setPosition(this.centerX, this.centerY);
    this.stick.setPosition(this.centerX, this.centerY);

    // Width is intentionally read here: the joystick stays in the left half.
    this.base.setVisible(this.centerX < width / 2);
    this.stick.setVisible(this.centerX < width / 2);
  }

  updateFromPointer(pointer) {
    const offsetX = pointer.x - this.centerX;
    const offsetY = pointer.y - this.centerY;
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    const clampedDistance = Math.min(distance, this.baseRadius);
    const unitX = distance > 0 ? offsetX / distance : 0;
    const unitY = distance > 0 ? offsetY / distance : 0;

    this.stick.setPosition(
      this.centerX + unitX * clampedDistance,
      this.centerY + unitY * clampedDistance
    );

    const normalizedDistance = clampedDistance / this.baseRadius;
    if (normalizedDistance <= this.deadZone) {
      this.direction.set(0, 0);
      return;
    }

    const strength = (normalizedDistance - this.deadZone) / (1 - this.deadZone);
    this.direction.set(unitX * strength, unitY * strength);
  }

  getDirection() {
    return this.direction;
  }

  reset() {
    this.activePointerId = null;
    this.activeNativePointerId = null;
    this.direction.set(0, 0);
    if (this.scene.player && this.scene.player.body) {
      this.scene.player.setVelocity(0, 0);
    }
    if (this.stick && this.stick.active) {
      this.stick.setPosition(this.centerX, this.centerY);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();

    this.base.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUp);
    this.scene.scale.off('resize', this.onResize);

    window.removeEventListener('pointerup', this.onWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onWindowPointerEnd);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.base.destroy();
    this.stick.destroy();
  }
}
