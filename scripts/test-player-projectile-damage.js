// Narrow behavioural test for the boundary between the player ProjectileSystem
// and chunk NPCs. The player projectile only overlaps the legacy creature group
// (empty in the chunked world), so GameScene.handlePlayerProjectileNpcHits()
// resolves ranged hits by proximity and routes them through the shared
// applyNpcDamage -> killNpc -> loot/persistence flow. This test drives the REAL
// ProjectileSystem and the REAL ChunkInstance together and reproduces exactly
// that resolution (getNearestAttackableNpc within PLAYER_PROJECTILE_HIT_RADIUS
// -> applyNpcDamage -> projectileSystem.remove).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// Must match GameScene.PLAYER_PROJECTILE_HIT_RADIUS.
const PLAYER_PROJECTILE_HIT_RADIUS = 28;
const PLAYER_BULLET_DAMAGE = 10; // ItemCatalog.BOW.attackDamage

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

const bundle = [
  'src/data/ItemCatalog.js',
  'src/data/BuildCatalog.js',
  'src/data/PassiveNpcConfig.js',
  'src/data/HostileNpcConfig.js',
  'src/systems/ChestStorageModel.js',
  'src/systems/DayNightSystem.js',
  'src/systems/SaveSystem.js',
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
  'src/world/ChunkInstance.js',
  'src/systems/ProjectileSystem.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const Phaser = {
  Math: { Distance: { Between(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); } } }
};

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, Phaser, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.ChunkInstance = ChunkInstance;
;exports.ProjectileSystem = ProjectileSystem;`,
  context,
  { filename: 'player-projectile-damage-bundle.js' }
);

const { ChunkInstance, ProjectileSystem } = context.exports;

function createImageMock(x, y, textureKey) {
  const data = {};
  return {
    x, y, textureKey, rotation: 0, displayWidth: 32, displayHeight: 32,
    body: null, destroyed: false,
    setDataEnabled() { return this; },
    setData(key, value) { data[key] = value; return this; },
    getData(key) { return data[key]; },
    setDepth() { return this; },
    setOrigin() { return this; },
    setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
    setScale() { return this; },
    setVisible() { return this; },
    setRotation(v) { this.rotation = v; return this; },
    destroy() { this.destroyed = true; this.body = null; }
  };
}

function createBulletSprite(x, y, key) {
  const data = {};
  return {
    x, y, textureKey: key, active: true, rotation: 0, displayHeight: 6,
    body: {
      setAllowGravity() { return this; },
      setSize() { return this; },
      setVelocity(vx, vy) { this.velocityX = vx; this.velocityY = vy; return this; }
    },
    setRotation(v) { this.rotation = v; return this; },
    setDepth() { return this; },
    setData(k, v) { data[k] = v; return this; },
    getData(k) { return data[k]; },
    destroy() { this.active = false; this.destroyed = true; }
  };
}

function createScene() {
  const groundItems = [];
  const bulletGroup = {
    world: { pendingDestroy: true },
    create(x, y, key) { return createBulletSprite(x, y, key); },
    destroy() { this.destroyed = true; }
  };
  return {
    groundItems,
    player: { x: 999999, y: 999999, active: true, body: { width: 24, height: 24 } },
    playerStatsModel: { isDead() { return false; } },
    damagePlayer() { return 0; },
    textures: { exists() { return true; } },
    make: {
      graphics() {
        return {
          fillStyle() { return this; }, fillRect() { return this; },
          fillRoundedRect() { return this; }, fillTriangle() { return this; },
          fillEllipse() { return this; }, fillCircle() { return this; },
          lineStyle() { return this; }, lineBetween() { return this; },
          beginPath() { return this; }, arc() { return this; }, strokePath() { return this; },
          generateTexture() { return this; }, destroy() {}
        };
      }
    },
    add: {
      graphics() { return { setDepth() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, destroy() {} }; },
      image(x, y, key) { return createImageMock(x, y, key); }
    },
    physics: {
      add: {
        existing(obj) {
          obj.body = {
            width: 0, height: 0, offset: { x: 0, y: 0 }, moves: false,
            setAllowGravity() {}, setImmovable() {},
            setSize(w, h) { this.width = w; this.height = h; },
            setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
            updateFromGameObject() {}, reset() {}
          };
        },
        group() { return bulletGroup; },
        collider() { return { destroy() {} }; },
        overlap() { return { destroy() {} }; }
      }
    },
    tweens: { add() { return { stop() {}, complete() {} }; } },
    time: { delayedCall() { return { remove() {}, destroy() {} }; } },
    groundItemSystem: { spawn(itemType, quantity, x, y) { const item = { itemType, quantity, x, y }; groundItems.push(item); return item; } }
  };
}

const blockingGroup = {
  create() {
    return {
      x: 0, y: 0,
      setVisible() { return this; }, setDataEnabled() { return this; },
      setData() { return this; }, getData() { return undefined; }, setDepth() { return this; },
      refreshBody() { return this; },
      body: { setSize() {}, setOffset() {}, refreshBody() {} },
      destroy() {}
    };
  }
};

function makeInstance(scene, npcDescriptors) {
  return new ChunkInstance(scene, {
    chunkX: 2, chunkY: -1, objects: [], npcs: npcDescriptors, spawnPoints: []
  }, {
    blockingGroup,
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
}

function makeProjectileSystem(scene) {
  return new ProjectileSystem(scene, {
    textureKey: 'player-bullet-texture',
    depthScale: 0.1,
    onCreatureHit() {},
    surfaceLayer: {},
    blockingGroup: {},
    creatureGroup: {}
  });
}

// Mirrors GameScene.handlePlayerProjectileNpcHits: for each active player
// projectile, find the nearest attackable chunk NPC within the hit radius and
// route damage through the shared applyNpcDamage flow, then remove the projectile.
function resolveHits(projectileSystem, instances) {
  projectileSystem.getProjectiles().forEach((projectile) => {
    if (!projectile || !projectile.active || !projectile.sprite || !projectile.sprite.active) return;
    let hit = null;
    instances.forEach((instance) => {
      const npcObject = instance.getNearestAttackableNpc(projectile.sprite.x, projectile.sprite.y, PLAYER_PROJECTILE_HIT_RADIUS);
      if (npcObject) hit = { instance, npcObject };
    });
    if (!hit) return;
    hit.instance.applyNpcDamage(hit.npcObject, projectile.damage);
    projectileSystem.remove(projectile);
  });
}

function spawnBulletAt(projectileSystem, x, y) {
  return projectileSystem.spawn({
    x, y, directionX: 1, directionY: 0,
    speed: 320, range: 220, damage: PLAYER_BULLET_DAMAGE
  });
}

// --- The spawned player projectile uses the bullet texture and carries damage.
{
  const scene = createScene();
  const system = makeProjectileSystem(scene);
  const projectile = spawnBulletAt(system, 100, 100);
  assertEqual(projectile.sprite.textureKey, 'player-bullet-texture', 'player projectile uses bullet texture');
  assertEqual(projectile.damage, PLAYER_BULLET_DAMAGE, 'player projectile carries unchanged damage');
  system.destroy();
}

// --- SLIME takes player-projectile damage through the shared flow, once per hit,
// dies after 3 hits, drops loot, and a dead SLIME is never damaged again.
{
  const scene = createScene();
  const instance = makeInstance(scene, [{ type: 'SLIME', index: 0, localTileX: 5, localTileY: 8 }]);
  const slime = instance.npcObjects[0];
  assertEqual(slime.getData('npcType'), 'SLIME', 'slime present');
  assertEqual(slime.getData('hp'), 30, 'slime full hp');
  const system = makeProjectileSystem(scene);

  // Hit 1: bullet at the slime -> 30 - 10 = 20, projectile removed.
  spawnBulletAt(system, slime.x, slime.y);
  assertEqual(system.getProjectiles().length, 1, 'one projectile in flight');
  resolveHits(system, [instance]);
  assertEqual(slime.getData('hp'), 20, 'slime hp after first hit');
  assertEqual(system.getProjectiles().length, 0, 'projectile removed after hit');

  // A second resolve pass with no projectiles does nothing (no double damage).
  resolveHits(system, [instance]);
  assertEqual(slime.getData('hp'), 20, 'no damage without a projectile');

  // Hit 2 and 3 -> death + loot.
  spawnBulletAt(system, slime.x, slime.y); resolveHits(system, [instance]);
  assertEqual(slime.getData('hp'), 10, 'slime hp after second hit');
  const groundBefore = scene.groundItems.length;
  spawnBulletAt(system, slime.x, slime.y); resolveHits(system, [instance]);
  assertEqual(slime.getData('dead'), true, 'slime dead after third hit');
  assert(scene.groundItems.length > groundBefore, 'slime dropped loot on death');
  assertEqual(instance.npcObjects.includes(slime), false, 'dead slime removed from chunk');

  // A dead slime cannot be damaged again.
  const deadResult = instance.applyNpcDamage(slime, PLAYER_BULLET_DAMAGE);
  assertEqual(deadResult.damage, 0, 'dead slime takes no further damage');

  system.destroy();
  instance.destroy();
}

// --- BOWMAN also takes player-projectile damage (same shared flow).
{
  const scene = createScene();
  const instance = makeInstance(scene, [{ type: 'BOWMAN', index: 0, localTileX: 6, localTileY: 9 }]);
  const bowman = instance.npcObjects[0];
  assertEqual(bowman.getData('npcType'), 'BOWMAN', 'bowman present');
  assertEqual(bowman.getData('hp'), 24, 'bowman full hp');
  const system = makeProjectileSystem(scene);

  spawnBulletAt(system, bowman.x, bowman.y);
  resolveHits(system, [instance]);
  assertEqual(bowman.getData('hp'), 14, 'bowman hp after first bullet');
  assertEqual(system.getProjectiles().length, 0, 'bullet removed after bowman hit');
  system.destroy();
  instance.destroy();
}

// --- A bullet that is NOT near any NPC deals no damage (hit radius respected)
// and world-obstacle collision cleanup stays intact (bullet removable).
{
  const scene = createScene();
  const instance = makeInstance(scene, [{ type: 'SLIME', index: 0, localTileX: 5, localTileY: 8 }]);
  const slime = instance.npcObjects[0];
  const system = makeProjectileSystem(scene);

  // Far away from the slime (> hit radius) -> no damage, projectile still alive.
  const projectile = spawnBulletAt(system, slime.x + 500, slime.y + 500);
  resolveHits(system, [instance]);
  assertEqual(slime.getData('hp'), 30, 'distant bullet does not damage slime');
  assertEqual(system.getProjectiles().length, 1, 'distant bullet still in flight');

  // World-object collision still cleans the projectile up (policy preserved).
  system.handleObstacleCollision(projectile.sprite);
  assertEqual(system.getProjectiles().length, 0, 'obstacle collision removes bullet');
  assertEqual(slime.getData('hp'), 30, 'obstacle-removed bullet dealt no npc damage');

  system.destroy();
  instance.destroy();
}

console.log('test-player-projectile-damage: ok');
