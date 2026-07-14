class ProjectileSystem {
  constructor(scene, options) {
    this.scene = scene;
    this.textureKey = options.textureKey;
    this.onCreatureHit = options.onCreatureHit;
    this.depthScale = options.depthScale;
    this.projectiles = [];
    this.nextId = 1;
    this.destroyed = false;
    this.group = scene.physics.add.group({ allowGravity: false });

    this.surfaceCollider = scene.physics.add.collider(
      this.group,
      options.surfaceLayer,
      this.handleObstacleCollision,
      null,
      this
    );
    this.obstacleCollider = scene.physics.add.collider(
      this.group,
      options.blockingGroup,
      this.handleObstacleCollision,
      null,
      this
    );
    this.creatureOverlap = scene.physics.add.overlap(
      this.group,
      options.creatureGroup,
      this.handleCreatureOverlap,
      null,
      this
    );
  }

  spawn(config) {
    if (this.destroyed || !this.group) return null;
    const length = Math.hypot(config.directionX, config.directionY);
    if (!Number.isFinite(length) || length === 0) {
      throw new Error('Нельзя выпустить стрелу без направления.');
    }
    if (!Number.isFinite(config.speed) || config.speed <= 0
      || !Number.isFinite(config.range) || config.range <= 0
      || !Number.isFinite(config.damage) || config.damage <= 0) {
      throw new Error('Некорректные параметры стрелы.');
    }

    const directionX = config.directionX / length;
    const directionY = config.directionY / length;
    const sprite = this.group.create(config.x, config.y, this.textureKey);
    sprite.body.setAllowGravity(false);
    sprite.body.setSize(14, 6);
    sprite.setRotation(Math.atan2(directionY, directionX));
    sprite.body.setVelocity(directionX * config.speed, directionY * config.speed);
    sprite.setDepth((sprite.y + sprite.displayHeight / 2) * this.depthScale);

    const projectile = {
      id: `arrow-${this.nextId++}`,
      sprite,
      startX: config.x,
      startY: config.y,
      range: config.range,
      damage: config.damage,
      active: true,
      processed: false
    };
    sprite.setData('projectileId', projectile.id);
    this.projectiles.push(projectile);
    return projectile;
  }

  getProjectileBySprite(sprite) {
    if (!sprite) return null;
    const id = sprite.getData('projectileId');
    return this.projectiles.find((projectile) => projectile.id === id) || null;
  }

  handleObstacleCollision(projectileSprite) {
    const projectile = this.getProjectileBySprite(projectileSprite);
    if (!projectile || !projectile.active || projectile.processed) return;
    projectile.processed = true;
    this.remove(projectile);
  }

  handleCreatureOverlap(projectileSprite, creatureSprite) {
    const projectile = this.getProjectileBySprite(projectileSprite);
    if (!projectile || !projectile.active || projectile.processed) return;
    projectile.processed = true;
    this.remove(projectile);
    this.onCreatureHit(projectile, creatureSprite);
  }

  update() {
    if (this.destroyed) return;
    this.projectiles.slice().forEach((projectile) => {
      if (!projectile.active || !projectile.sprite || !projectile.sprite.active) return;
      projectile.sprite.setDepth(
        (projectile.sprite.y + projectile.sprite.displayHeight / 2) * this.depthScale
      );
      const travelled = Phaser.Math.Distance.Between(
        projectile.startX,
        projectile.startY,
        projectile.sprite.x,
        projectile.sprite.y
      );
      if (travelled >= projectile.range) {
        projectile.processed = true;
        this.remove(projectile);
      }
    });
  }

  remove(projectile) {
    if (!projectile || !projectile.active) return false;
    projectile.active = false;
    if (projectile.sprite && projectile.sprite.active) projectile.sprite.destroy();
    projectile.sprite = null;
    const index = this.projectiles.indexOf(projectile);
    if (index !== -1) this.projectiles.splice(index, 1);
    return true;
  }

  clearProjectiles() {
    this.projectiles.slice().forEach((projectile) => {
      projectile.processed = true;
      this.remove(projectile);
    });
  }

  getProjectiles() {
    return this.projectiles.slice();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearProjectiles();
    if (this.surfaceCollider && this.surfaceCollider.world) this.surfaceCollider.destroy();
    if (this.obstacleCollider && this.obstacleCollider.world) this.obstacleCollider.destroy();
    if (this.creatureOverlap && this.creatureOverlap.world) this.creatureOverlap.destroy();
    if (this.group && this.group.world && this.group.world.pendingDestroy) this.group.destroy();
    this.surfaceCollider = null;
    this.obstacleCollider = null;
    this.creatureOverlap = null;
    this.group = null;
    this.onCreatureHit = null;
    this.scene = null;
  }
}
