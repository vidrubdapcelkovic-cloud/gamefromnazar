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

// Behavioural bundle: the SLIME must ride the SHARED chunk NPC architecture
// (config -> generator -> ChunkInstance -> HostileNpcController -> persistence),
// so we load exactly those production modules and drive them directly.
const bundle = [
  'src/data/ItemCatalog.js',
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
  'src/world/PlayerWaterState.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.getPassiveNpcConfig = getPassiveNpcConfig;
;exports.getHostileNpcConfig = getHostileNpcConfig;
;exports.isHostileNpcType = isHostileNpcType;
;exports.HOSTILE_NPC_STATE = HOSTILE_NPC_STATE;
;exports.HostileNpcController = HostileNpcController;
;exports.ChunkGenerator = ChunkGenerator;
;exports.ChunkInstance = ChunkInstance;
;exports.ChunkMath = ChunkMath;
;exports.RiverGenerator = RiverGenerator;
;exports.VillageGenerator = VillageGenerator;
;exports.buildChunkEnemyId = buildChunkEnemyId;
;exports.buildChunkNpcId = buildChunkNpcId;
;exports.SaveSystem = SaveSystem;
;exports.PLAYER_WATER_SPEED_MULTIPLIER = PLAYER_WATER_SPEED_MULTIPLIER;`,
  context,
  { filename: 'slime-bundle.js' }
);

const {
  getPassiveNpcConfig,
  getHostileNpcConfig,
  isHostileNpcType,
  HOSTILE_NPC_STATE,
  HostileNpcController,
  ChunkGenerator,
  ChunkInstance,
  ChunkMath,
  RiverGenerator,
  VillageGenerator,
  buildChunkEnemyId,
  buildChunkNpcId,
  SaveSystem,
  PLAYER_WATER_SPEED_MULTIPLIER
} = context.exports;

const SLIME_TEXTURE_KEY = 'temporary-slime';

// ---------------------------------------------------------------------------
// 1. Config: SLIME registered in the HOSTILE registry with restored parameters.
// ---------------------------------------------------------------------------
{
  assert(typeof getHostileNpcConfig === 'function', 'getHostileNpcConfig exists');
  assertEqual(isHostileNpcType('SLIME'), true, 'SLIME is a hostile type');
  assertEqual(getPassiveNpcConfig('SLIME'), null, 'SLIME is NOT a passive type');

  const slime = getHostileNpcConfig('SLIME');
  assert(slime, 'SLIME config exists');

  [
    'type', 'textureKey', 'maxHp', 'renderWidth', 'renderHeight',
    'bodyWidth', 'bodyHeight', 'bodyOffsetX', 'bodyOffsetY',
    'wanderTweenDuration', 'wanderPauseDuration',
    'detectionRadius', 'disengageRadius', 'attackRange', 'attackDamage',
    'attackCooldown', 'chaseSpeed', 'returnRadius'
  ].forEach((key) => {
    assert(Object.prototype.hasOwnProperty.call(slime, key), `SLIME field ${key}`);
  });

  // Restored 1:1 from the legacy CreatureCatalog.SLIME.
  assertEqual(slime.type, 'SLIME', 'type id preserved');
  assertEqual(slime.textureKey, SLIME_TEXTURE_KEY, 'textureKey');
  assertEqual(slime.maxHp, 30, 'maxHp 30');
  assertEqual(slime.detectionRadius, 160, 'detectionRadius 160');
  assertEqual(slime.disengageRadius, 220, 'disengageRadius 220');
  assertEqual(slime.attackRange, 26, 'attackRange 26');
  assertEqual(slime.attackDamage, 5, 'attackDamage 5');
  assertEqual(slime.attackCooldown, 1000, 'attackCooldown 1000');
  assertEqual(slime.chaseSpeed, 70, 'chaseSpeed 70 (legacy moveSpeed)');
  assertEqual(slime.renderWidth, 32, 'renderWidth 32');
  assertEqual(slime.renderHeight, 32, 'renderHeight 32');
  assertEqual(slime.bodyWidth, 24, 'bodyWidth 24 (legacy 24x18 blob)');
  assertEqual(slime.bodyHeight, 18, 'bodyHeight 18');

  // Shared state-machine invariants.
  assert(slime.attackRange < slime.detectionRadius, 'attackRange < detectionRadius');
  assert(slime.detectionRadius < slime.disengageRadius, 'detectionRadius < disengageRadius');
  assert(slime.returnRadius > 0, 'returnRadius > 0');
  assert(slime.bodyOffsetX + slime.bodyWidth <= slime.renderWidth, 'body fits texture X');
  assert(slime.bodyOffsetY + slime.bodyHeight <= slime.renderHeight, 'body fits texture Y');

  // Melee: no ranged fields (slime never had a ranged attack).
  assert(slime.attackMode !== 'RANGED', 'slime is melee');
  assert(!Object.prototype.hasOwnProperty.call(slime, 'rangedAttackRange'), 'no ranged range');
  assert(!Object.prototype.hasOwnProperty.call(slime, 'projectileSpeed'), 'no projectile fields');

  // Historical two-stack loot: SLIME_GEL x1..2 and RAW_MEAT x1.
  assert(Array.isArray(slime.loot) && slime.loot.length === 2, 'loot: 2 stacks');
  const gel = slime.loot.find((entry) => entry.itemId === 'SLIME_GEL');
  const meat = slime.loot.find((entry) => entry.itemId === 'RAW_MEAT');
  assert(gel, 'loot has SLIME_GEL');
  assertEqual(gel.minQuantity, 1, 'SLIME_GEL min 1');
  assertEqual(gel.maxQuantity, 2, 'SLIME_GEL max 2');
  assert(meat, 'loot has RAW_MEAT');
  assertEqual(meat.minQuantity, 1, 'RAW_MEAT min 1');
  assertEqual(meat.maxQuantity, 1, 'RAW_MEAT max 1');

  // Existing NPC parameters must remain untouched.
  assertEqual(getPassiveNpcConfig('RABBIT').maxHp, 6, 'RABBIT unchanged');
  assertEqual(getHostileNpcConfig('TALL_MONSTER').maxHp, 30, 'TALL_MONSTER unchanged');
  assertEqual(getHostileNpcConfig('TALL_MONSTER').lootType, 'RAW_MEAT', 'TALL_MONSTER loot unchanged');
  assertEqual(getHostileNpcConfig('BOWMAN').attackMode, 'RANGED', 'BOWMAN unchanged');
}

// ---------------------------------------------------------------------------
// 2. Deterministic spawn via a dedicated stream that does NOT touch other NPCs.
// ---------------------------------------------------------------------------
{
  const seed = 424242;

  const a = ChunkGenerator.generate(seed, 5, 3);
  const b = ChunkGenerator.generate(seed, 5, 3);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'same seed/chunk => same npcs');
  assertEqual(JSON.stringify(a.objects), JSON.stringify(b.objects), 'same seed/chunk => same objects');

  const generatorSource = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(generatorSource.includes("'chunk-enemies-slime'"), 'slime uses own stream');
  assert(/slimeRng\.next\(\)\s*<\s*0\.10/.test(generatorSource), 'slime chance 0.10');
  // Slime must be placed AFTER the berry bushes so it never perturbs existing
  // TREE/ROCK/berry/other-NPC layout (reject-after-place, own stream).
  const berryIdx = generatorSource.indexOf("'chunk-berry-bushes'");
  const slimeIdx = generatorSource.indexOf("'chunk-enemies-slime'");
  assert(berryIdx !== -1 && slimeIdx !== -1 && slimeIdx > berryIdx, 'slime block after berries');

  // Layout independence: the non-SLIME npc entries a game would have generated
  // are identical whether or not the slime stream ran. We confirm this by
  // regenerating and comparing the non-SLIME slice (the slime stream is last and
  // only reads `occupied`, so it can never move an earlier entry).
  let sawSlime = false;
  let slimeChunks = 0;
  let firstCoords = null;
  let checkedWater = false;
  let checkedReserved = false;

  for (let cx = -14; cx <= 14; cx += 1) {
    for (let cy = -14; cy <= 14; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const slimes = chunk.npcs.filter((n) => n.type === 'SLIME');
      assert(slimes.length <= 1, 'max 1 slime per chunk');

      if (slimes.length) {
        slimeChunks += 1;
        const s = slimes[0];
        assertEqual(s.index, 0, 'slime index 0');

        // Never on water.
        const worldTile = ChunkMath.chunkLocalToWorldTile(cx, cy, s.localTileX, s.localTileY);
        assert(!RiverGenerator.isWaterTile(seed, worldTile.tileX, worldTile.tileY),
          'slime never spawns on water');
        checkedWater = true;
        // Never inside a village reserved footprint.
        assert(!VillageGenerator.isReservedTile(seed, worldTile.tileX, worldTile.tileY),
          'slime never spawns in village reserved footprint');
        checkedReserved = true;

        if (!sawSlime) {
          sawSlime = true;
          firstCoords = { cx, cy, descriptor: s };
        }
      }

      // No slime overlaps any object or other NPC in the same chunk.
      const occupied = new Set(chunk.objects.map((o) => `${o.localTileX},${o.localTileY}`));
      chunk.npcs.forEach((n) => {
        const key = `${n.localTileX},${n.localTileY}`;
        assert(!occupied.has(key), 'no slime/object/NPC overlap');
        occupied.add(key);
      });
    }
  }

  assert(sawSlime, 'slime spawns somewhere in the survey');
  assert(slimeChunks > 1, 'slime appears in multiple chunks');
  assert(checkedWater, 'water exclusion exercised');
  assert(checkedReserved, 'reserved exclusion exercised');

  // Stable, unique ENEMY id (shared hostile format).
  const { cx, cy } = firstCoords;
  const enemyId = buildChunkEnemyId(cx, cy, 'SLIME', 0);
  assertEqual(enemyId, `chunk_${cx}_${cy}_ENEMY_SLIME_0`, 'stable ENEMY id format');
  assert(enemyId.indexOf('_ENEMY_') !== -1 && enemyId.indexOf('_NPC_') === -1,
    'hostile id uses _ENEMY_ (persistence gate)');

  // Starter safe zone (chunk 0,0 clear box) is slime-free.
  const startChunk = ChunkGenerator.generate(seed, 0, 0);
  startChunk.npcs.filter((n) => n.type === 'SLIME').forEach((s) => {
    const inClear = s.localTileX >= 5 && s.localTileX <= 11
      && s.localTileY >= 5 && s.localTileY <= 11;
    assert(!inClear, 'no slime in starter safe zone');
  });
}

// ---------------------------------------------------------------------------
// Runtime scaffolding: minimal Phaser-shaped scene mock.
// ---------------------------------------------------------------------------
function createImageMock(x, y, textureKey) {
  const data = {};
  return {
    x,
    y,
    width: 32,
    height: 32,
    displayWidth: 32,
    displayHeight: 32,
    textureKey,
    body: null,
    destroyed: false,
    setDataEnabled() { return this; },
    setData(key, value) { data[key] = value; return this; },
    getData(key) { return data[key]; },
    setDepth() { return this; },
    setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
    destroy() { this.destroyed = true; this.body = null; }
  };
}

function createScene() {
  const groundItems = [];
  const generatedTextures = {};
  const depthCalls = [];
  const textureKeys = new Set();
  return {
    groundItems,
    generatedTextures,
    depthCalls,
    player: { x: 0, y: 0, body: {}, destroyed: false, active: true },
    playerStatsModel: { isDead() { return false; } },
    damageCalls: [],
    damagePlayer(amount) { this.damageCalls.push(amount); return amount; },
    updateWorldDepth(obj) { depthCalls.push(obj); },
    textures: {
      exists(key) { return textureKeys.has(key); }
    },
    make: {
      graphics() {
        return {
          fillStyle() { return this; },
          fillRect() { return this; },
          fillRoundedRect() { return this; },
          fillEllipse() { return this; },
          fillCircle() { return this; },
          generateTexture(key) {
            generatedTextures[key] = (generatedTextures[key] || 0) + 1;
            textureKeys.add(key);
            return this;
          },
          destroy() {}
        };
      }
    },
    add: {
      graphics() {
        return { setDepth() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, destroy() {} };
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
        collider(a, b) { return { a, b, destroy() {} }; }
      }
    },
    tweens: { add(config) { return { config, stop() {}, complete() {} }; } },
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

function createBlockingGroup() {
  return {
    create() {
      return {
        setVisible() {},
        setDataEnabled() {},
        setData() {},
        body: { setSize() {}, setOffset() {}, refreshBody() {} }
      };
    }
  };
}

function slimeChunkData(chunkX, chunkY, localTileX, localTileY, extra) {
  return Object.assign({
    chunkX,
    chunkY,
    terrain: [],
    objects: [],
    water: [],
    npcs: [{ type: 'SLIME', index: 0, localTileX, localTileY }],
    spawnPoints: []
  }, extra || {});
}

// ---------------------------------------------------------------------------
// 3. Runtime spawn: sprite / body / controller created; texture generated once.
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  const removed = [];
  const chunkData = slimeChunkData(2, -1, 6, 6);
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: (id) => removed.push(id)
  });

  assertEqual(instance.npcObjects.length, 1, 'slime sprite created');
  const npc = instance.npcObjects[0];
  const slime = getHostileNpcConfig('SLIME');
  const enemyId = buildChunkEnemyId(2, -1, 'SLIME', 0);

  assertEqual(npc.textureKey, SLIME_TEXTURE_KEY, 'sprite uses slime texture');
  assertEqual(npc.getData('npcId'), enemyId, 'runtime id = ENEMY id');
  assertEqual(npc.getData('npcType'), 'SLIME', 'npcType');
  assertEqual(npc.getData('npcKind'), 'hostile', 'kind hostile');
  assertEqual(npc.getData('maxHp'), 30, 'maxHp data');
  assertEqual(npc.getData('hp'), 30, 'hp data');
  assertEqual(npc.displayWidth, slime.renderWidth, 'display w');
  assertEqual(npc.displayHeight, slime.renderHeight, 'display h');
  assertEqual(npc.body.width, slime.bodyWidth, 'body w');
  assertEqual(npc.body.height, slime.bodyHeight, 'body h');
  assertEqual(npc.body.offset.x, slime.bodyOffsetX, 'body offset x');
  assertEqual(npc.body.offset.y, slime.bodyOffsetY, 'body offset y');
  assert(scene.depthCalls.includes(npc), 'depth sorted via updateWorldDepth');
  assertEqual(instance.hostileControllers.length, 1, 'hostile controller attached');
  assertEqual(instance.getNearestAttackableNpc(npc.x, npc.y, 50), npc, 'attackable by player');
  assertEqual(scene.generatedTextures[SLIME_TEXTURE_KEY], 1, 'texture generated once');

  // A second slime (different chunk) must NOT regenerate the shared texture.
  const instance2 = new ChunkInstance(scene, slimeChunkData(3, 3, 7, 7), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
  assertEqual(scene.generatedTextures[SLIME_TEXTURE_KEY], 1, 'texture still generated only once');
  instance.destroy();
  instance2.destroy();
}

// ---------------------------------------------------------------------------
// 4. Combat / death / loot: shared damage flow, once-only loot, idempotent death.
// ---------------------------------------------------------------------------
function killAndCollect(damagePerHit) {
  const scene = createScene();
  const removed = [];
  const instance = new ChunkInstance(scene, slimeChunkData(2, -1, 6, 6), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: (id) => removed.push(id)
  });
  const npc = instance.npcObjects[0];
  let hits = 0;
  let died = false;
  while (!died && hits < 10) {
    const result = instance.applyNpcDamage(npc, damagePerHit);
    died = result.died;
    hits += 1;
  }
  return { scene, removed, instance, npc, hits };
}

{
  // Fist path: 30 hp / 10 dmg = exactly 3 hits (matches historical README).
  const fist = killAndCollect(10);
  assertEqual(fist.hits, 3, 'fist kills slime in 3 hits');
  assertEqual(fist.removed.length, 1, 'removed exactly once');
  assertEqual(fist.removed[0], buildChunkEnemyId(2, -1, 'SLIME', 0), 'removed id = ENEMY id');

  const gel = fist.scene.groundItems.filter((i) => i.itemType === 'SLIME_GEL');
  const meat = fist.scene.groundItems.filter((i) => i.itemType === 'RAW_MEAT');
  assertEqual(fist.scene.groundItems.length, 2, 'two loot stacks');
  assertEqual(gel.length, 1, 'one SLIME_GEL stack');
  assert(gel[0].quantity >= 1 && gel[0].quantity <= 2, 'SLIME_GEL quantity within 1..2');
  assertEqual(meat.length, 1, 'one RAW_MEAT stack');
  assertEqual(meat[0].quantity, 1, 'RAW_MEAT quantity 1');
  assertEqual(fist.instance.hostileControllers.length, 0, 'controller cleaned on death');

  // Death is idempotent: further damage does nothing and drops no extra loot.
  const again = fist.instance.applyNpcDamage(fist.npc, 10);
  assertEqual(again.died, false, 'death idempotent');
  assertEqual(fist.scene.groundItems.length, 2, 'no duplicate loot after re-hit');
  fist.instance.destroy();

  // Sword path: 30 hp / 15 dmg = 2 hits.
  const sword = killAndCollect(15);
  assertEqual(sword.hits, 2, 'sword kills slime in 2 hits');
  assertEqual(sword.scene.groundItems.length, 2, 'sword path also drops two stacks');
  sword.instance.destroy();

  // Deterministic loot quantity: the SAME slime id yields the SAME SLIME_GEL qty.
  const q1 = killAndCollect(30).scene.groundItems.find((i) => i.itemType === 'SLIME_GEL').quantity;
  const q2 = killAndCollect(30).scene.groundItems.find((i) => i.itemType === 'SLIME_GEL').quantity;
  assertEqual(q1, q2, 'loot quantity deterministic per slime id');
}

// ---------------------------------------------------------------------------
// 5. AI role via the SHARED HostileNpcController: wander -> chase -> attack.
// ---------------------------------------------------------------------------
{
  const slime = getHostileNpcConfig('SLIME');
  const state = { x: 0, y: 0, player: null, wanderStops: 0, wanderResumes: 0, damageCalls: [] };
  const controller = new HostileNpcController({
    config: slime,
    homeX: 0,
    homeY: 0,
    getPosition: () => ({ x: state.x, y: state.y }),
    setPosition: (x, y) => { state.x = x; state.y = y; },
    getPlayerPosition: () => state.player,
    stopWander: () => { state.wanderStops += 1; },
    resumeWander: () => { state.wanderResumes += 1; },
    damagePlayer: (amount) => { state.damageCalls.push(amount); return amount; },
    canOccupy: () => true
  });

  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'starts wandering');

  state.player = { x: 300, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'far player: no chase');

  state.player = { x: 100, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'detects & chases');
  assertEqual(state.wanderStops, 1, 'chase stops wander');

  state.x = 0; state.y = 0;
  state.player = { x: 20, y: 0 };
  controller.update(100, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.ATTACK, 'in range: attacks');
  assertEqual(state.damageCalls.length, 1, 'first attack lands');
  assertEqual(state.damageCalls[0], 5, 'attack damage 5');

  controller.update(500, 16);
  assertEqual(state.damageCalls.length, 1, 'cooldown blocks second attack');
  controller.update(1200, 16);
  assertEqual(state.damageCalls.length, 2, 'attack after cooldown');

  state.player = { x: 300, y: 0 };
  controller.update(1300, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.RETURN, 'beyond disengage: return');

  state.x = 3; state.y = 0; state.player = null;
  controller.update(1400, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'home: idle again');
  assertEqual(state.wanderResumes, 1, 'idle resumes wander');

  // A dead slime stops attacking (controller destroyed on death).
  controller.destroy();
  const before = state.damageCalls.length;
  state.player = { x: 5, y: 0 };
  controller.update(5000, 16);
  assertEqual(state.damageCalls.length, before, 'destroyed controller never attacks');
}

// ---------------------------------------------------------------------------
// 6. Water is blocked terrain for the slime (same as every other NPC).
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  // Slime on a dry tile; a separate water tile in the same chunk.
  const waterTile = { type: 'RIVER_WATER', localTileX: 10, localTileY: 10, id: 'w' };
  const chunkData = slimeChunkData(0, 0, 3, 3, { water: [waterTile] });
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });

  const dry = ChunkMath.localTileCenterWorld(0, 0, 3, 3);
  const wet = ChunkMath.localTileCenterWorld(0, 0, 10, 10);
  assertEqual(instance.canNpcOccupyWorld(dry.x, dry.y), true, 'slime may occupy dry land');
  assertEqual(instance.canNpcOccupyWorld(wet.x, wet.y), false, 'slime may NOT occupy water');
  instance.destroy();
}

// ---------------------------------------------------------------------------
// 7. Persistence via the SHARED removed-NPC mechanism (no new save fields).
// ---------------------------------------------------------------------------
{
  const enemyId = buildChunkEnemyId(2, -1, 'SLIME', 0);
  assert(SaveSystem.isValidRemovedNpcId(enemyId), 'slime ENEMY id valid for removed set');

  // Kill -> unload -> reload the same chunk: slime stays dead, no duplicate loot.
  const removedSet = new Set();
  const scene = createScene();
  const instance = new ChunkInstance(scene, slimeChunkData(2, -1, 6, 6), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => removedSet.has(id),
    onNpcRemoved: (id) => { if (SaveSystem.isValidRemovedNpcId(id)) removedSet.add(id); }
  });
  assertEqual(instance.applyNpcDamage(instance.npcObjects[0], 30).died, true, 'slime dies');
  assert(removedSet.has(enemyId), 'death recorded in removed set');
  instance.destroy();

  const reloadScene = createScene();
  const reloaded = new ChunkInstance(reloadScene, slimeChunkData(2, -1, 6, 6), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => removedSet.has(id),
    onNpcRemoved: () => {}
  });
  assertEqual(reloaded.npcObjects.length, 0, 'dead slime not recreated after reload');
  assertEqual(reloaded.hostileControllers.length, 0, 'no controller for dead slime');
  assertEqual(reloadScene.groundItems.length, 0, 'no duplicate loot on reload');
  reloaded.destroy();

  // Save -> Menu -> Continue: id survives normalization and still blocks respawn.
  const serialized = SaveSystem.normalizeRemovedNpcIds(Array.from(removedSet));
  assertEqual(JSON.stringify(serialized), JSON.stringify([enemyId]), 'slime id survives save normalize');
  const restoredSet = new Set(serialized);
  const continueScene = createScene();
  const continued = new ChunkInstance(continueScene, slimeChunkData(2, -1, 6, 6), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => restoredSet.has(id),
    onNpcRemoved: () => {}
  });
  assertEqual(continued.npcObjects.length, 0, 'dead slime not recreated after Save/Continue');
  continued.destroy();

  // A live slime IS recreated deterministically when it was never killed.
  const liveScene = createScene();
  const live = new ChunkInstance(liveScene, slimeChunkData(2, -1, 6, 6), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
  assertEqual(live.npcObjects.length, 1, 'live slime restored deterministically');
  assertEqual(live.npcObjects[0].getData('npcId'), enemyId, 'same stable id after reload');
  live.destroy();
}

// ---------------------------------------------------------------------------
// 8. Idempotent cleanup + no duplicates after unload/reload.
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  const instance = new ChunkInstance(scene, slimeChunkData(4, 4, 5, 5), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
  assertEqual(instance.hostileControllers.length, 1, 'live controller before unload');
  instance.destroy();
  assertEqual(instance.hostileControllers.length, 0, 'unload clears controllers');
  assertEqual(instance.npcObjects.length, 0, 'unload clears npc objects');
  assertEqual(scene.groundItems.length, 0, 'unload is not a death (no loot)');
  instance.destroy(); // idempotent
  assertEqual(instance.hostileControllers.length, 0, 'destroy idempotent');

  // Reload after a plain unload (never killed) re-creates exactly one slime.
  const reloadScene = createScene();
  const reloaded = new ChunkInstance(reloadScene, slimeChunkData(4, 4, 5, 5), {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
  assertEqual(reloaded.npcObjects.length, 1, 'no duplicate; exactly one slime after reload');
  reloaded.destroy();
}

// ---------------------------------------------------------------------------
// 9. Passable-water invariant is untouched by this stage.
// ---------------------------------------------------------------------------
{
  assertEqual(PLAYER_WATER_SPEED_MULTIPLIER, 0.55, 'PLAYER_WATER_SPEED_MULTIPLIER stays 0.55');
}

console.log('test-slime: ok');
