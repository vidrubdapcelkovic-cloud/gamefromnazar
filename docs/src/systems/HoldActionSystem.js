const HOLD_ACTION_DURATIONS = Object.freeze({
  TREE: 1500,
  ROCK: 1700,
  BERRY_BUSH: 1000
});

class HoldActionSystem {
  constructor(durations = HOLD_ACTION_DURATIONS) {
    this.durations = durations;
    this.active = false;
    this.target = null;
    this.targetId = null;
    this.elapsed = 0;
    this.requiredDuration = 0;
    this.progress = 0;
    this.completed = false;
    this.requiresRelease = false;
  }

  start(target, durationOverride) {
    if (target === null || this.active || this.requiresRelease) return false;

    const duration = durationOverride === undefined
      ? this.durations[target.type]
      : durationOverride;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Не задана длительность удержания для типа ${target.type}.`);
    }

    this.active = true;
    this.target = target;
    this.targetId = target.id;
    this.elapsed = 0;
    this.requiredDuration = duration;
    this.progress = 0;
    this.completed = false;
    return true;
  }

  update(delta, currentTarget) {
    if (!this.active) return null;

    if (currentTarget === null || currentTarget.id !== this.targetId) {
      this.cancel();
      return null;
    }

    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
    this.elapsed = Math.min(this.elapsed + safeDelta, this.requiredDuration);
    this.progress = this.elapsed / this.requiredDuration;

    if (this.progress < 1) return null;

    const completedTarget = this.target;
    this.active = false;
    this.completed = true;
    this.requiresRelease = true;
    return completedTarget;
  }

  cancel() {
    this.active = false;
    this.target = null;
    this.targetId = null;
    this.elapsed = 0;
    this.requiredDuration = 0;
    this.progress = 0;
    this.completed = false;
  }

  release() {
    this.requiresRelease = false;
    this.cancel();
  }

  getProgress() {
    return this.progress;
  }
}
