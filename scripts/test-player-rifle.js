// Minimal guard test for the player "rifle" stage: the ONLY gameplay change is
// that the player projectile now uses the procedural `player-bullet-texture`
// instead of the old arrow texture. There is no separate player bow sprite, so
// no rifle sprite / `player-rifle-texture` is created or required. Everything
// else (damage, cooldown, speed, range, collisions, cleanup, BOWMAN, save
// schema) must be unchanged. Checks are source-level plus a tiny behavioural
// spawn/cleanup check on the existing ProjectileSystem.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const gameScene = read('src/GameScene.js');
const chunkInstance = read('src/world/ChunkInstance.js');
const itemCatalogSource = read('src/data/ItemCatalog.js');
const indexHtml = read('index.html');
const buildJs = read('build.js');

// ---------------------------------------------------------------------------
// Source-level: the bullet texture exists and is what the player projectile uses.
// ---------------------------------------------------------------------------
assert(/'player-bullet-texture'/.test(gameScene), 'player-bullet-texture defined in GameScene');
// It is created inside the once-guarded createGroundItemTextures definition loop.
assert(
  /\['player-bullet-texture',/.test(gameScene),
  'player-bullet-texture generated procedurally in the texture definitions'
);
// The player ProjectileSystem is constructed with the bullet texture, not the arrow.
assert(
  /new ProjectileSystem\(this, \{\s*textureKey: 'player-bullet-texture'/.test(gameScene),
  'player ProjectileSystem uses player-bullet-texture'
);
assert(
  !/new ProjectileSystem\(this, \{\s*textureKey: 'temporary-arrow'/.test(gameScene),
  'player ProjectileSystem no longer uses the old arrow texture'
);

// ---------------------------------------------------------------------------
// Attack parameters unchanged (damage / cooldown / speed / range) + id preserved.
// ---------------------------------------------------------------------------
const bowContext = { Object, console, exports: {} };
vm.createContext(bowContext);
vm.runInContext(`${itemCatalogSource}\n;exports.ItemCatalog = ItemCatalog;`, bowContext, { filename: 'item-catalog.js' });
const bow = bowContext.exports.ItemCatalog.BOW;
assertEqual(bow.id, 'BOW', 'player weapon internal id preserved (save-compatible)');
assertEqual(bow.attackType, 'RANGED', 'player weapon still ranged');
assertEqual(bow.attackDamage, 10, 'damage unchanged');
assertEqual(bow.attackCooldownMs, 650, 'cooldown unchanged');
assertEqual(bow.projectileSpeed, 320, 'projectile speed unchanged');
assertEqual(bow.projectileRange, 220, 'projectile range/lifetime unchanged');

// ---------------------------------------------------------------------------
// No new weapon architecture: no new module / helper / combat directory.
// ---------------------------------------------------------------------------
assert(!fs.existsSync(path.join(root, 'src', 'combat')), 'no new combat module directory');
assert(!/PlayerRifle/.test(gameScene), 'no PlayerRifle helper referenced');
assert(!/combat\//.test(indexHtml), 'no new combat script wired in index.html');
assert(!/combat\//.test(buildJs), 'no new combat module wired in build.js');
// There is no separate player bow sprite, so no rifle sprite / texture is added.
assert(!/player-rifle-texture/.test(gameScene), 'no rifle sprite texture added (no bow sprite exists)');

// ---------------------------------------------------------------------------
// Damage flow: player projectile hits on chunk NPCs are resolved each frame and
// routed through the shared applyNpcDamage flow (behaviour is covered in detail
// by scripts/test-player-projectile-damage.js).
// ---------------------------------------------------------------------------
assert(/handlePlayerProjectileNpcHits\(\)\s*\{/.test(gameScene), 'player projectile hit resolver exists');
assert(
  /this\.projectileSystem\.update\(\);\s*\n\s*this\.handlePlayerProjectileNpcHits\(\);/.test(gameScene),
  'hit resolver runs each frame right after the projectile system update'
);
assert(/PLAYER_PROJECTILE_HIT_RADIUS/.test(gameScene), 'projectile hit radius constant used');
assert(
  /handlePlayerProjectileNpcHits[\s\S]*?applyNpcDamage\(/.test(gameScene),
  'hit resolver routes damage through the shared applyNpcDamage flow'
);
assert(
  /handlePlayerProjectileNpcHits[\s\S]*?this\.projectileSystem\.remove\(/.test(gameScene),
  'hit resolver removes the projectile after a hit'
);

// ---------------------------------------------------------------------------
// BOWMAN untouched: its own arrow texture and spawner; it does not use bullets.
// ---------------------------------------------------------------------------
assert(/bowman-arrow-texture/.test(chunkInstance), 'BOWMAN arrow texture preserved');
assert(/BOWMAN_ARROW_TEXTURE_KEY/.test(chunkInstance), 'BOWMAN arrow texture key preserved');
assert(/spawnBowmanArrow/.test(chunkInstance), 'BOWMAN arrow spawner preserved');
assert(!/player-bullet-texture/.test(chunkInstance), 'BOWMAN does not use player bullet texture');

// ---------------------------------------------------------------------------
// Behavioural: the existing ProjectileSystem still spawns exactly one projectile
// (with the bullet texture), keeps its collision callbacks, and cleans up safely.
// ---------------------------------------------------------------------------
function makeSprite(x, y, key) {
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

function makeScene() {
  const colliders = [];
  const group = {
    world: { pendingDestroy: true },
    sprites: [],
    create(x, y, key) { const s = makeSprite(x, y, key); this.sprites.push(s); return s; },
    destroy() { this.destroyed = true; }
  };
  return {
    colliders,
    surfaceLayer: {},
    blockingGroup: {},
    creatureGroup: {},
    physics: {
      add: {
        group() { return group; },
        collider(a, b, cb, pc, ctx) { const c = { kind: 'collider', a, b, cb, ctx, world: {}, destroy() { this.world = null; } }; colliders.push(c); return c; },
        overlap(a, b, cb, pc, ctx) { const c = { kind: 'overlap', a, b, cb, ctx, world: {}, destroy() { this.world = null; } }; colliders.push(c); return c; }
      }
    }
  };
}

const Phaser = { Math: { Distance: { Between(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); } } } };
const projectileContext = { Phaser, Math, Number, console, exports: {} };
vm.createContext(projectileContext);
vm.runInContext(
  `${read('src/systems/ProjectileSystem.js')}\n;exports.ProjectileSystem = ProjectileSystem;`,
  projectileContext,
  { filename: 'projectile-system.js' }
);
const { ProjectileSystem } = projectileContext.exports;

{
  const scene = makeScene();
  let hits = 0;
  const system = new ProjectileSystem(scene, {
    textureKey: 'player-bullet-texture',
    depthScale: 0.1,
    onCreatureHit: () => { hits += 1; },
    surfaceLayer: scene.surfaceLayer,
    blockingGroup: scene.blockingGroup,
    creatureGroup: scene.creatureGroup
  });

  // Collision callbacks preserved: two colliders (surface + obstacle) + one overlap.
  assertEqual(scene.colliders.filter((c) => c.kind === 'collider').length, 2, 'obstacle/surface colliders present');
  assertEqual(scene.colliders.filter((c) => c.kind === 'overlap').length, 1, 'creature overlap present');

  // One attack -> exactly one projectile, using the bullet texture, unchanged params.
  const projectile = system.spawn({
    x: 100, y: 100, directionX: 1, directionY: 0,
    speed: bow.projectileSpeed, range: bow.projectileRange, damage: bow.attackDamage
  });
  assert(projectile, 'one projectile spawned');
  assertEqual(system.getProjectiles().length, 1, 'exactly one projectile per attack');
  assertEqual(projectile.sprite.textureKey, 'player-bullet-texture', 'projectile uses bullet texture');
  assertEqual(projectile.damage, 10, 'projectile carries unchanged damage');

  // Cleanup preserved and idempotent.
  assertEqual(system.remove(projectile), true, 'first remove succeeds');
  assertEqual(system.remove(projectile), false, 'second remove is a safe no-op');
  system.destroy();
  assertEqual(system.getProjectiles().length, 0, 'no projectiles after cleanup');
}

console.log('test-player-rifle: ok');
