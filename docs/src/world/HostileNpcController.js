const HOSTILE_NPC_STATE = Object.freeze({
  IDLE_WANDER: 'IDLE_WANDER',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  RANGED_ATTACK: 'RANGED_ATTACK',
  RETURN: 'RETURN'
});

/**
 * Minimal hostile AI for an already-created runtime NPC.
 * Owns only behaviour state; ChunkInstance owns sprite/body/HP/loot/persistence.
 *
 * options:
 * - config: HostileNpcConfig entry
 * - homeX / homeY: spawn world position
 * - getPosition(): { x, y }
 * - setPosition(x, y): apply movement (sprite + body sync left to caller via onMoved)
 * - getPlayerPosition(): { x, y } | null
 * - stopWander()
 * - resumeWander()
 * - damagePlayer(amount): number of HP actually removed (melee attackers)
 * - onRangedAttack(target, time): fired when a RANGED attacker releases a shot;
 *   target is the player position captured at release time. The controller only
 *   decides the moment; the runtime owner creates and manages the projectile.
 * - canOccupy(x, y): optional obstacle check; default always true
 * - onMoved(): optional body/depth sync after position change
 *
 * A config with attackMode === 'RANGED' uses rangedAttackRange and the
 * RANGED_ATTACK state; any other config stays melee (ATTACK state, direct
 * damagePlayer). Melee behaviour is unchanged.
 */
class HostileNpcController {
  constructor(options) {
    if (!options || !options.config) {
      throw new Error('HostileNpcController requires a config.');
    }
    const config = options.config;
    this.config = config;
    this.homeX = Number(options.homeX) || 0;
    this.homeY = Number(options.homeY) || 0;
    this.getPosition = typeof options.getPosition === 'function'
      ? options.getPosition
      : () => ({ x: this.homeX, y: this.homeY });
    this.setPosition = typeof options.setPosition === 'function'
      ? options.setPosition
      : () => {};
    this.getPlayerPosition = typeof options.getPlayerPosition === 'function'
      ? options.getPlayerPosition
      : () => null;
    this.stopWander = typeof options.stopWander === 'function'
      ? options.stopWander
      : () => {};
    this.resumeWander = typeof options.resumeWander === 'function'
      ? options.resumeWander
      : () => {};
    this.damagePlayer = typeof options.damagePlayer === 'function'
      ? options.damagePlayer
      : () => 0;
    this.onRangedAttack = typeof options.onRangedAttack === 'function'
      ? options.onRangedAttack
      : () => {};
    this.canOccupy = typeof options.canOccupy === 'function'
      ? options.canOccupy
      : () => true;
    this.onMoved = typeof options.onMoved === 'function'
      ? options.onMoved
      : () => {};

    // Ranged attackers use rangedAttackRange and the RANGED_ATTACK state; every
    // other config keeps its melee attackRange and the ATTACK state.
    this.ranged = !!(config.attackMode === 'RANGED');
    this.attackRange = this.ranged && Number.isFinite(config.rangedAttackRange)
      ? config.rangedAttackRange
      : config.attackRange;
    this.attackState = this.ranged
      ? HOSTILE_NPC_STATE.RANGED_ATTACK
      : HOSTILE_NPC_STATE.ATTACK;

    this.state = HOSTILE_NPC_STATE.IDLE_WANDER;
    this.nextAttackTime = 0;
    this.destroyed = false;
    this.wanderRunning = true;
  }

  getState() {
    return this.state;
  }

  isDestroyed() {
    return this.destroyed;
  }

  update(time, delta) {
    if (this.destroyed) return;
    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const safeTime = Number.isFinite(time) ? time : 0;

    const self = this.getPosition();
    if (!self || !Number.isFinite(self.x) || !Number.isFinite(self.y)) return;

    const player = this.getPlayerPosition();
    const hasPlayer = !!(player && Number.isFinite(player.x) && Number.isFinite(player.y));
    const distanceToPlayer = hasPlayer
      ? Math.hypot(player.x - self.x, player.y - self.y)
      : Infinity;
    const distanceToHome = Math.hypot(this.homeX - self.x, this.homeY - self.y);

    switch (this.state) {
      case HOSTILE_NPC_STATE.IDLE_WANDER:
        this.updateIdleWander(safeTime, player, hasPlayer, distanceToPlayer);
        break;
      case HOSTILE_NPC_STATE.CHASE:
        this.updateChase(safeTime, safeDelta, self, player, hasPlayer, distanceToPlayer);
        break;
      case HOSTILE_NPC_STATE.ATTACK:
        this.updateAttack(safeTime, self, player, hasPlayer, distanceToPlayer);
        break;
      case HOSTILE_NPC_STATE.RANGED_ATTACK:
        this.updateRangedAttack(safeTime, self, player, hasPlayer, distanceToPlayer);
        break;
      case HOSTILE_NPC_STATE.RETURN:
        this.updateReturn(safeDelta, self, hasPlayer, distanceToPlayer, distanceToHome);
        break;
      default:
        this.state = HOSTILE_NPC_STATE.IDLE_WANDER;
        break;
    }
  }

  updateIdleWander(time, player, hasPlayer, distanceToPlayer) {
    if (distanceToPlayer <= this.config.detectionRadius) {
      if (distanceToPlayer <= this.attackRange) {
        this.enterAttack();
        this.performAttack(time, player, hasPlayer);
      } else {
        this.enterChase();
      }
    }
  }

  updateChase(time, delta, self, player, hasPlayer, distanceToPlayer) {
    if (!hasPlayer || distanceToPlayer > this.config.disengageRadius) {
      this.enterReturn();
      return;
    }
    if (distanceToPlayer <= this.attackRange) {
      this.enterAttack();
      this.performAttack(time, player, hasPlayer);
      return;
    }
    this.moveToward(self.x, self.y, player.x, player.y, delta);
  }

  updateAttack(time, self, player, hasPlayer, distanceToPlayer) {
    if (!hasPlayer || distanceToPlayer > this.config.disengageRadius) {
      this.enterReturn();
      return;
    }
    if (distanceToPlayer > this.attackRange) {
      this.enterChase();
      return;
    }
    this.performAttack(time, player, hasPlayer);
  }

  updateRangedAttack(time, self, player, hasPlayer, distanceToPlayer) {
    if (!hasPlayer || distanceToPlayer > this.config.disengageRadius) {
      this.enterReturn();
      return;
    }
    if (distanceToPlayer > this.attackRange) {
      this.enterChase();
      return;
    }
    // Movement is halted in RANGED_ATTACK; the controller only times the shot.
    this.performAttack(time, player, hasPlayer);
  }

  performAttack(time, player, hasPlayer) {
    if (this.destroyed) return;
    if (this.ranged) {
      if (!hasPlayer || !player) return;
      if (time >= this.nextAttackTime) {
        this.onRangedAttack({ x: player.x, y: player.y }, time);
        this.nextAttackTime = time + this.config.attackCooldown;
      }
      return;
    }
    this.tryAttack(time);
  }

  tryAttack(time) {
    if (this.destroyed) return;
    if (time >= this.nextAttackTime) {
      this.damagePlayer(this.config.attackDamage);
      this.nextAttackTime = time + this.config.attackCooldown;
    }
  }

  updateReturn(delta, self, hasPlayer, distanceToPlayer, distanceToHome) {
    if (hasPlayer && distanceToPlayer <= this.config.detectionRadius) {
      this.enterChase();
      return;
    }
    if (distanceToHome <= this.config.returnRadius) {
      this.enterIdleWander();
      return;
    }
    this.moveToward(self.x, self.y, this.homeX, this.homeY, delta);
  }

  enterChase() {
    if (this.destroyed) return;
    if (this.wanderRunning) {
      this.stopWander();
      this.wanderRunning = false;
    }
    this.state = HOSTILE_NPC_STATE.CHASE;
  }

  enterAttack() {
    if (this.destroyed) return;
    if (this.wanderRunning) {
      this.stopWander();
      this.wanderRunning = false;
    }
    this.state = this.attackState;
  }

  enterReturn() {
    if (this.destroyed) return;
    if (this.wanderRunning) {
      this.stopWander();
      this.wanderRunning = false;
    }
    this.state = HOSTILE_NPC_STATE.RETURN;
  }

  enterIdleWander() {
    if (this.destroyed) return;
    this.state = HOSTILE_NPC_STATE.IDLE_WANDER;
    if (!this.wanderRunning) {
      this.resumeWander();
      this.wanderRunning = true;
    }
  }

  moveToward(fromX, fromY, toX, toY, delta) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (!(distance > 0) || !(delta > 0)) return;

    const maxStep = this.config.chaseSpeed * (delta / 1000);
    const step = Math.min(maxStep, distance);
    const nextX = fromX + (dx / distance) * step;
    const nextY = fromY + (dy / distance) * step;

    if (!this.canOccupy(nextX, nextY)) {
      // Blocked this frame: try axis slides, otherwise wait for the next update.
      const slideX = fromX + (dx / distance) * step;
      const slideY = fromY;
      if (this.canOccupy(slideX, slideY)) {
        this.setPosition(slideX, slideY);
        this.onMoved();
        return;
      }
      const slideX2 = fromX;
      const slideY2 = fromY + (dy / distance) * step;
      if (this.canOccupy(slideX2, slideY2)) {
        this.setPosition(slideX2, slideY2);
        this.onMoved();
      }
      return;
    }

    this.setPosition(nextX, nextY);
    this.onMoved();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.wanderRunning) {
      try {
        this.stopWander();
      } catch (_) {
        // ignore
      }
      this.wanderRunning = false;
    }
    this.state = HOSTILE_NPC_STATE.IDLE_WANDER;
    this.nextAttackTime = Infinity;
    this.getPosition = () => null;
    this.setPosition = () => {};
    this.getPlayerPosition = () => null;
    this.stopWander = () => {};
    this.resumeWander = () => {};
    this.damagePlayer = () => 0;
    this.onRangedAttack = () => {};
    this.canOccupy = () => false;
    this.onMoved = () => {};
  }
}
