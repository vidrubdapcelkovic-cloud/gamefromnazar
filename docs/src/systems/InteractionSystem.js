class InteractionSystem {
  constructor(radius = 72) {
    this.radius = radius;
    this.radiusSquared = radius * radius;
    this.targets = [];
    this.currentTarget = null;
  }

  setTargets(targets) {
    this.targets = targets.slice();
    this.currentTarget = null;
  }

  removeTarget(id) {
    this.targets = this.targets.filter((target) => target.id !== id);
    if (this.currentTarget && this.currentTarget.id === id) {
      this.currentTarget = null;
    }
  }

  update(playerX, playerY, targetValidator = null) {
    let nearestTarget = null;
    let nearestDistanceSquared = this.radiusSquared;

    this.targets.forEach((target) => {
      if (targetValidator !== null && !targetValidator(target)) return;
      const offsetX = target.interactionX - playerX;
      const offsetY = target.interactionY - playerY;
      const distanceSquared = offsetX * offsetX + offsetY * offsetY;

      if (distanceSquared > this.radiusSquared) return;

      const isCloser = nearestTarget === null || distanceSquared < nearestDistanceSquared;
      const hasStableTieBreak = nearestTarget !== null
        && distanceSquared === nearestDistanceSquared
        && target.id.localeCompare(nearestTarget.id) < 0;

      if (isCloser || hasStableTieBreak) {
        nearestTarget = target;
        nearestDistanceSquared = distanceSquared;
      }
    });

    this.currentTarget = nearestTarget;
    return this.currentTarget;
  }

  getCurrentTarget() {
    return this.currentTarget;
  }
}
