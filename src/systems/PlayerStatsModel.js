const PLAYER_MAX_HEALTH = 100;
const PLAYER_MAX_HUNGER = 100;
const HUNGER_DRAIN_PER_SECOND = 0.1;
const STARVATION_DAMAGE_PER_SECOND = 1;

class PlayerStatsModel {
  constructor() {
    this.maxHealth = PLAYER_MAX_HEALTH;
    this.maxHunger = PLAYER_MAX_HUNGER;
    this.reset();
  }

  update(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error(`deltaMs должен быть конечным неотрицательным числом: ${deltaMs}.`);
    }
    if (this.health === 0 || deltaMs === 0) return;

    const seconds = deltaMs / 1000;
    const hungerBeforeUpdate = this.hunger;
    this.hunger = Math.max(0, this.hunger - HUNGER_DRAIN_PER_SECOND * seconds);

    let starvingSeconds = 0;
    if (hungerBeforeUpdate === 0) {
      starvingSeconds = seconds;
    } else if (this.hunger === 0) {
      starvingSeconds = Math.max(0, seconds - hungerBeforeUpdate / HUNGER_DRAIN_PER_SECOND);
    }
    this.health = Math.max(0, this.health - STARVATION_DAMAGE_PER_SECOND * starvingSeconds);
  }

  getHealth() {
    return this.health;
  }

  getHunger() {
    return this.hunger;
  }

  getMaxHealth() {
    return this.maxHealth;
  }

  takeDamage(amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Урон должен быть конечным положительным числом: ${amount}.`);
    }
    const actualDamage = Math.min(amount, this.health);
    this.health -= actualDamage;
    return actualDamage;
  }

  restoreHealth(amount) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Восстановление здоровья должно быть конечным неотрицательным числом: ${amount}.`);
    }
    if (this.isDead()) return 0;
    const restored = Math.min(amount, this.maxHealth - this.health);
    this.health += restored;
    return restored;
  }

  restoreHunger(amount) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Восстановление голода должно быть конечным неотрицательным числом: ${amount}.`);
    }
    const restored = Math.min(amount, this.maxHunger - this.hunger);
    this.hunger += restored;
    return restored;
  }

  isDead() {
    return this.health === 0;
  }

  reset() {
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
  }

  exportState() { return { health: this.health, hunger: this.hunger }; }

  importState(state) {
    if (!state || !Number.isFinite(state.health) || state.health < 0 || state.health > 100
      || !Number.isFinite(state.hunger) || state.hunger < 0 || state.hunger > 100) return false;
    this.health = state.health; this.hunger = state.hunger; return true;
  }
}
