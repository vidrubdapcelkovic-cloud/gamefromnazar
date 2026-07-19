class StatusHUD {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
    this.lastHealth = null;
    this.lastHunger = null;
    this.elements = [];

    this.background = scene.add.rectangle(600, 18, 260, 72, 0x111820, 0.88)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(INTERFACE_DEPTH + 5)
      .setStrokeStyle(2, 0xbad5e8, 0.5);
    this.healthBarBackground = scene.add.rectangle(680, 38, 150, 12, 0x3b2025, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 6);
    this.healthBarFill = scene.add.rectangle(680, 38, 150, 12, 0xd9535f, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 7);
    this.hungerBarBackground = scene.add.rectangle(680, 72, 150, 12, 0x3a3420, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 6);
    this.hungerBarFill = scene.add.rectangle(680, 72, 150, 12, 0xe5bd45, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 7);
    this.healthText = scene.add.text(616, 28, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#ffffff'
    }).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 8);
    this.hungerText = scene.add.text(616, 62, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#ffffff'
    }).setScrollFactor(0).setDepth(INTERFACE_DEPTH + 8);
    this.elements.push(
      this.background,
      this.healthBarBackground,
      this.healthBarFill,
      this.hungerBarBackground,
      this.hungerBarFill,
      this.healthText,
      this.hungerText
    );
  }

  update(health, hunger) {
    const roundedHealth = Math.round(Phaser.Math.Clamp(health, 0, 100));
    const roundedHunger = Math.round(Phaser.Math.Clamp(hunger, 0, 100));
    if (roundedHealth === this.lastHealth && roundedHunger === this.lastHunger) return false;
    this.lastHealth = roundedHealth;
    this.lastHunger = roundedHunger;
    this.healthText.setText(`Здоровье: ${roundedHealth}/100`);
    this.hungerText.setText(`Голод: ${roundedHunger}/100`);
    this.healthBarFill.setScale(roundedHealth / 100, 1);
    this.hungerBarFill.setScale(roundedHunger / 100, 1);
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.elements.forEach((element) => {
      if (element && element.active) element.destroy();
    });
    this.elements = [];
  }
}
