class CreatureSystem {
  constructor(scene) {
    this.scene = scene;
    this.group = scene.physics.add.group();
    this.creatures = [];
    this.nextId = 1;
  }

  spawn(type, x, y, stableId) {
    const definition = CreatureCatalog[type];
    if (!definition) throw new Error(`Неизвестный тип существа: ${type}.`);
    const sprite = this.group.create(x, y, 'temporary-slime');
    sprite.body.setSize(24, 18);
    sprite.setCollideWorldBounds(true);
    const creature = {
      id: stableId || `creature-${this.nextId++}`,
      type,
      health: definition.maxHealth,
      state: 'idle',
      sprite,
      active: true,
      lastAttackTime: -Infinity,
      spawnX: x,
      spawnY: y,
      hitFlashUntil: 0
    };
    this.creatures.push(creature);
    return creature;
  }

  getCombatTime() {
    return this.scene.time && Number.isFinite(this.scene.time.now) ? this.scene.time.now : 0;
  }

  setCreatureVelocity(creature, velocityX, velocityY) {
    const body = creature && creature.sprite && creature.sprite.body;
    if (!creature.active || !creature.sprite.active || !body
      || !body.enable || !body.moves) return false;
    body.setVelocity(velocityX, velocityY);
    return true;
  }

  update(delta, player, playerIsDead) {
    const time = this.getCombatTime();
    let readyAttacker = null;

    this.creatures.forEach((creature) => {
      if (!creature.active) return;
      const definition = CreatureCatalog[creature.type];
      const dx = player.x - creature.sprite.x;
      const dy = player.y - creature.sprite.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      this.updateHitFlash(creature, time);

      if (playerIsDead) {
        creature.state = 'idle';
        this.setCreatureVelocity(creature, 0, 0);
      } else {
        if (creature.state === 'idle' && distance <= definition.detectionRadius) {
          creature.state = 'chase';
        }
        if (creature.state === 'chase' && distance > definition.loseRadius) {
          creature.state = 'idle';
        }
        if (creature.state === 'chase' && distance <= definition.attackRange) {
          this.setCreatureVelocity(creature, 0, 0);
          if (time - creature.lastAttackTime >= definition.attackCooldownMs
            && (readyAttacker === null || creature.id < readyAttacker.id)) {
            readyAttacker = creature;
          }
        } else if (creature.state === 'chase' && distance > 0) {
          this.setCreatureVelocity(
            creature,
            dx / distance * definition.moveSpeed,
            dy / distance * definition.moveSpeed
          );
        } else {
          this.setCreatureVelocity(creature, 0, 0);
        }
      }

      creature.sprite.setDepth(
        (creature.sprite.y + creature.sprite.displayHeight / 2) * WORLD_DEPTH_SCALE
      );
    });

    if (readyAttacker === null) return null;
    readyAttacker.lastAttackTime = time;
    return {
      id: readyAttacker.id,
      type: readyAttacker.type,
      damage: CreatureCatalog[readyAttacker.type].contactDamage
    };
  }

  updateHitFlash(creature, time) {
    if (!creature.active || !creature.sprite || !creature.sprite.active) return;
    if (time < creature.hitFlashUntil) creature.sprite.setTint(0xff8f8f);
    else creature.sprite.clearTint();
  }

  damage(id, amount) {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Некорректный урон: ${amount}.`);
    const creature = this.creatures.find((candidate) => candidate.id === id);
    if (!creature || !creature.active) {
      return {
        damage: 0,
        health: creature ? Math.max(0, creature.health) : 0,
        died: false
      };
    }

    const actualDamage = Math.min(amount, creature.health);
    creature.health -= actualDamage;
    const died = creature.health === 0;

    if (died) this.killCreature(creature);
    else this.applyHitFlash(creature);

    return { damage: actualDamage, health: creature.health, died };
  }

  killCreature(creature) {
    if (!creature.active) return false;
    creature.active = false;
    creature.state = 'dead';
    creature.hitFlashUntil = 0;
    if (creature.sprite && creature.sprite.active) {
      creature.sprite.clearTint();
      if (creature.sprite.body) creature.sprite.body.setVelocity(0, 0);
      if (creature.sprite.body) creature.sprite.body.enable = false;
      creature.sprite.destroy();
    }
    return true;
  }

  applyHitFlash(creature) {
    if (!creature || !creature.active || !creature.sprite || !creature.sprite.active) return false;
    creature.hitFlashUntil = this.getCombatTime() + CombatConfig.SLIME.flashMs;
    creature.sprite.setTint(0xff8f8f);
    return true;
  }

  getNearestAttackable(x, y, radius) {
    const radiusSquared = radius * radius;
    return this.creatures.filter((creature) => creature.active).reduce((nearest, creature) => {
      const dx = creature.sprite.x - x;
      const dy = creature.sprite.y - y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) return nearest;
      if (!nearest || distanceSquared < nearest.distanceSquared
        || (distanceSquared === nearest.distanceSquared && creature.id < nearest.creature.id)) {
        return { creature, distanceSquared };
      }
      return nearest;
    }, null)?.creature || null;
  }

  getCreatures() {
    return this.creatures.slice();
  }

  exportState() {
    return this.creatures.filter((creature) => !creature.active || creature.state === 'dead')
      .map((creature) => creature.id);
  }

  restoreState(deadCreatureIds) {
    if (!Array.isArray(deadCreatureIds) || deadCreatureIds.some((id) => typeof id !== 'string')
      || new Set(deadCreatureIds).size !== deadCreatureIds.length) return false;
    const dead = new Set(deadCreatureIds);
    this.creatures.forEach((creature) => {
      const definition = CreatureCatalog[creature.type];
      if (!creature.sprite || !creature.sprite.active) {
        creature.sprite = this.group.create(creature.spawnX, creature.spawnY, 'temporary-slime');
        creature.sprite.body.setSize(24, 18);
        creature.sprite.setCollideWorldBounds(true);
      } else {
        creature.sprite.setPosition(creature.spawnX, creature.spawnY);
      }
      creature.health = definition.maxHealth;
      creature.active = true;
      creature.state = 'idle';
      creature.lastAttackTime = -Infinity;
      creature.sprite.body.enable = true;
      creature.sprite.setVisible(true);
      creature.sprite.setVelocity(0, 0);
      creature.sprite.clearTint();
      this.resetCreatureTransientState(creature);
      if (dead.has(creature.id)) this.damage(creature.id, definition.maxHealth);
    });
    return true;
  }

  resetCreatureTransientState(creature) {
    creature.hitFlashUntil = 0;
    if (creature.sprite && creature.sprite.active) {
      creature.sprite.clearTint();
      if (creature.sprite.body) creature.sprite.body.setVelocity(0, 0);
    }
  }

  resetTransientState() {
    this.creatures.forEach((creature) => this.resetCreatureTransientState(creature));
  }

  clear() {
    this.resetTransientState();
    this.creatures.forEach((creature) => {
      if (creature.sprite && creature.sprite.active) creature.sprite.destroy();
      creature.sprite = null;
      creature.active = false;
      creature.state = 'dead';
    });
    this.creatures = [];
    if (this.group) {
      this.group = null;
    }
  }
}
