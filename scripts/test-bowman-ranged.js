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

function assertClose(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message} (expected ~${expected}, got ${actual})`);
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
  'src/world/ChunkGenerator.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
  'src/world/ChunkInstance.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.getHostileNpcConfig = getHostileNpcConfig;
;exports.buildChunkEnemyId = buildChunkEnemyId;
;exports.ChunkInstance = ChunkInstance;
;exports.ChunkMath = ChunkMath;
;exports.HOSTILE_NPC_STATE = HOSTILE_NPC_STATE;`,
  context,
  { filename: 'bowman-ranged-bundle.js' }
);

const {
  getHostileNpcConfig,
  buildChunkEnemyId,
  ChunkInstance,
  ChunkMath,
  HOSTILE_NPC_STATE
} = context.exports;

const bow = getHostileNpcConfig('BOWMAN');

function createImageMock(x, y, textureKey) {
  const data = {};
  return {
    x,
    y,
    textureKey,
    rotation: 0,
    displayWidth: 14,
    displayHeight: 3,
    body: null,
    destroyed: false,
    setDataEnabled() { return this; },
    setData(key, value) { data[key] = value; return this; },
    getData(key) { return data[key]; },
    setDepth() { return this; },
    setRotation(value) { this.rotation = value; return this; },
    setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
    getBounds() {
      return {
        centerX: this.x,
        bottom: this.y + this.displayHeight / 2,
        top: this.y - this.displayHeight / 2,
        left: this.x - this.displayWidth / 2,
        right: this.x + this.displayWidth / 2
      };
    },
    destroy() { this.destroyed = true; this.body = null; }
  };
}

function createScene(playerPos) {
  const groundItems = [];
  const damageEvents = [];
  return {
    groundItems,
    damageEvents,
    player: {
      x: playerPos.x,
      y: playerPos.y,
      active: true,
      destroyed: false,
      body: { width: 24, height: 24 }
    },
    playerStatsModel: { isDead() { return false; } },
    damagePlayer(amount, source) {
      damageEvents.push({ amount, source });
      return amount;
    },
    textures: { exists() { return true; } },
    make: {
      graphics() {
        return {
          fillStyle() { return this; },
          fillRect() { return this; },
          fillTriangle() { return this; },
          fillEllipse() { return this; },
          fillCircle() { return this; },
          generateTexture() { return this; },
          destroy() {}
        };
      }
    },
    add: {
      graphics() {
        return {
          setDepth() { return this; },
          fillStyle() { return this; },
          fillRect() { return this; },
          destroy() {}
        };
      },
      image(x, y, key) { return createImageMock(x, y, key); }
    },
    physics: {
      add: {
        existing(obj) {
          obj.body = {
            width: 0,
            height: 0,
            offset: { x: 0, y: 0 },
            moves: false,
            setAllowGravity() {},
            setImmovable() {},
            setSize(w, h) { this.width = w; this.height = h; },
            setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
            updateFromGameObject() {},
            reset() {}
          };
        },
        collider() { return { destroy() {} }; }
      }
    },
    tweens: { add() { return { stop() {}, complete() {} }; } },
    time: { delayedCall() { return { remove() {}, destroy() {} }; } },
    groundItemSystem: {
      spawn(itemType, quantity, x, y) {
        const item = { itemType, quantity, x, y };
        groundItems.push(item);
        return item;
      }
    }
  };
}

const blockingGroup = {
  create() {
    return {
      x: 0,
      y: 0,
      setVisible() { return this; },
      setDataEnabled() { return this; },
      setData() { return this; },
      getData() { return undefined; },
      setDepth() { return this; },
      refreshBody() { return this; },
      body: { setSize() {}, setOffset() {}, refreshBody() {} },
      destroy() {}
    };
  }
};

function makeInstance(scene, npcDescriptors) {
  const chunkData = {
    chunkX: 4,
    chunkY: -3,
    objects: [],
    npcs: npcDescriptors,
    spawnPoints: []
  };
  return new ChunkInstance(scene, chunkData, {
    blockingGroup,
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
}

const singleBowman = [{ type: 'BOWMAN', index: 0, localTileX: 5, localTileY: 8 }];

// Spawn: one shot -> one arrow, normalized direction, speed 180, rotation set.
{
  const scene = createScene({ x: 5000, y: 5000 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  const enemyId = buildChunkEnemyId(4, -3, 'BOWMAN', 0);
  assertEqual(npc.getData('npcId'), enemyId, 'bowman id');

  const projectile = instance.spawnBowmanArrow(npc, { x: npc.x + 100, y: npc.y }, bow, 0);
  assert(projectile, 'projectile created');
  assertEqual(instance.projectiles.length, 1, 'one arrow');
  const speed = Math.hypot(projectile.vx, projectile.vy);
  assertClose(speed, 180, 0.001, 'speed 180');
  assertClose(projectile.vx, 180, 0.001, 'vx toward player');
  assertClose(projectile.vy, 0, 0.001, 'vy zero');
  assertEqual(projectile.ownerId, enemyId, 'owner id');
  assertClose(projectile.sprite.rotation, 0, 0.001, 'rotation faces direction');
  assertEqual(projectile.damage, 6, 'damage 6');
  instance.destroy();
}

// Zero-length direction: no projectile.
{
  const scene = createScene({ x: 5000, y: 5000 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  const projectile = instance.spawnBowmanArrow(npc, { x: npc.x, y: npc.y }, bow, 0);
  assertEqual(projectile, null, 'no degenerate projectile');
  assertEqual(instance.projectiles.length, 0, 'no arrow stored');
  instance.destroy();
}

// Player hit: exactly one 6 damage, arrow destroyed, no repeat damage.
{
  const scene = createScene({ x: 0, y: 0 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  scene.player.x = npc.x + 60;
  scene.player.y = npc.y;
  const enemyId = npc.getData('npcId');
  const projectile = instance.spawnBowmanArrow(npc, { x: scene.player.x, y: scene.player.y }, bow, 0);
  assert(projectile, 'arrow spawned');

  let guard = 0;
  while (instance.projectiles.length > 0 && guard < 20) {
    instance.updateProjectiles(0, 100);
    guard += 1;
  }
  assertEqual(scene.damageEvents.length, 1, 'one damage event');
  assertEqual(scene.damageEvents[0].amount, 6, 'exactly 6 damage');
  assertEqual(scene.damageEvents[0].source, enemyId, 'damage source is bowman id');
  assertEqual(instance.projectiles.length, 0, 'arrow removed after hit');
  assert(projectile.sprite === null || projectile.sprite.destroyed, 'sprite destroyed');

  instance.updateProjectiles(0, 100);
  assertEqual(scene.damageEvents.length, 1, 'no repeat damage after removal');
  instance.destroy();
}

// Obstacle (TREE/ROCK) destroys arrow before it reaches the player.
{
  const scene = createScene({ x: 0, y: 0 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  scene.player.x = npc.x + 400;
  scene.player.y = npc.y;
  instance.obstacleRects = [{
    minX: npc.x + 30,
    minY: npc.y - 10,
    maxX: npc.x + 50,
    maxY: npc.y + 10
  }];
  instance.spawnBowmanArrow(npc, { x: scene.player.x, y: scene.player.y }, bow, 0);
  let guard = 0;
  while (instance.projectiles.length > 0 && guard < 20) {
    instance.updateProjectiles(0, 100);
    guard += 1;
  }
  assertEqual(instance.projectiles.length, 0, 'arrow removed by obstacle');
  assertEqual(scene.damageEvents.length, 0, 'obstacle blocked player damage');
  instance.destroy();
}

// buildObstacleRects derives rects from TREE/ROCK descriptors at tile centers.
{
  const scene = createScene({ x: 5000, y: 5000 });
  const instance = makeInstance(scene, singleBowman);
  const rects = instance.buildObstacleRects({
    objects: [{ type: 'ROCK', localTileX: 7, localTileY: 8 }]
  });
  assertEqual(rects.length, 1, 'one obstacle rect');
  const center = ChunkMath.localTileCenterWorld(4, -3, 7, 8);
  assertClose((rects[0].minX + rects[0].maxX) / 2, center.x, 0.001, 'rect centered X');
  assertClose((rects[0].minY + rects[0].maxY) / 2, center.y, 0.001, 'rect centered Y');
  instance.destroy();
}

// Lifetime expiry removes the arrow.
{
  const scene = createScene({ x: 100000, y: 100000 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  instance.spawnBowmanArrow(npc, { x: npc.x + 100, y: npc.y }, bow, 0);
  assertEqual(instance.projectiles.length, 1, 'arrow alive');
  instance.updateProjectiles(bow.projectileLifetime + 100, 16);
  assertEqual(instance.projectiles.length, 0, 'arrow removed after lifetime');
  assertEqual(scene.damageEvents.length, 0, 'no damage on lifetime expiry');
  instance.destroy();
}

// BOWMAN death removes its arrows and drops a single loot stack.
{
  const scene = createScene({ x: 100000, y: 100000 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  instance.spawnBowmanArrow(npc, { x: npc.x + 100, y: npc.y }, bow, 0);
  assertEqual(instance.projectiles.length, 1, 'arrow before death');
  const result = instance.applyNpcDamage(npc, bow.maxHp);
  assertEqual(result.died, true, 'bowman died');
  assertEqual(instance.projectiles.length, 0, 'arrows removed on death');
  assertEqual(scene.groundItems.length, 1, 'single loot stack');
  assertEqual(scene.groundItems[0].quantity, 2, 'loot quantity 2');
  instance.destroy();
}

// Chunk unload / destroy removes active arrows.
{
  const scene = createScene({ x: 100000, y: 100000 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  const projectile = instance.spawnBowmanArrow(npc, { x: npc.x + 100, y: npc.y }, bow, 0);
  assertEqual(instance.projectiles.length, 1, 'arrow before unload');
  instance.destroy();
  assertEqual(instance.projectiles.length, 0, 'arrows cleared on destroy');
  assert(projectile.sprite === null || projectile.sprite.destroyed, 'arrow sprite destroyed on unload');
}

// removeProjectile is idempotent and a destroyed arrow never damages again.
{
  const scene = createScene({ x: 0, y: 0 });
  const instance = makeInstance(scene, singleBowman);
  const npc = instance.npcObjects[0];
  scene.player.x = npc.x + 10;
  scene.player.y = npc.y;
  const projectile = instance.spawnBowmanArrow(npc, { x: npc.x + 100, y: npc.y }, bow, 0);
  assertEqual(instance.removeProjectile(projectile), true, 'first remove');
  assertEqual(instance.removeProjectile(projectile), true, 'second remove idempotent');
  assertEqual(instance.projectiles.length, 0, 'no arrows left');
  instance.updateProjectiles(0, 100);
  assertEqual(scene.damageEvents.length, 0, 'removed arrow deals no damage');
  instance.destroy();
}

// Two BOWMEN keep independent arrow collections.
{
  const scene = createScene({ x: 100000, y: 100000 });
  const instance = makeInstance(scene, [
    { type: 'BOWMAN', index: 0, localTileX: 5, localTileY: 8 },
    { type: 'BOWMAN', index: 1, localTileX: 9, localTileY: 12 }
  ]);
  assertEqual(instance.npcObjects.length, 2, 'two bowmen');
  const npcA = instance.npcObjects[0];
  const npcB = instance.npcObjects[1];
  const idA = npcA.getData('npcId');
  const idB = npcB.getData('npcId');
  assert(idA !== idB, 'distinct ids');
  instance.spawnBowmanArrow(npcA, { x: npcA.x + 100, y: npcA.y }, bow, 0);
  instance.spawnBowmanArrow(npcB, { x: npcB.x + 100, y: npcB.y }, bow, 0);
  assertEqual(instance.projectiles.length, 2, 'two arrows');
  instance.removeProjectilesByOwner(idA);
  assertEqual(instance.projectiles.length, 1, 'only owner A arrows removed');
  assertEqual(instance.projectiles[0].ownerId, idB, 'owner B arrow remains');
  instance.destroy();
}

console.log('test-bowman-ranged: ok');
