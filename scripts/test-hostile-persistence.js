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
  'src/world/ChunkResourceIds.js',
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
;exports.SaveSystem = SaveSystem;
;exports.ChunkGenerator = ChunkGenerator;
;exports.ChunkInstance = ChunkInstance;
;exports.buildChunkEnemyId = buildChunkEnemyId;
;exports.buildChunkNpcId = buildChunkNpcId;
;exports.getHostileNpcConfig = getHostileNpcConfig;`,
  context,
  { filename: 'hostile-persistence-bundle.js' }
);

const {
  SaveSystem,
  ChunkGenerator,
  ChunkInstance,
  buildChunkEnemyId,
  buildChunkNpcId
} = context.exports;

// Mirror production GameScene.markSessionNpcRemoved / isSessionNpcRemoved.
function createSessionOwner() {
  const sessionRemovedNpcIds = new Set();
  return {
    sessionRemovedNpcIds,
    markSessionNpcRemoved(id) {
      if (!SaveSystem.isValidRemovedNpcId(id)) return;
      sessionRemovedNpcIds.add(id);
    },
    isSessionNpcRemoved(id) {
      return sessionRemovedNpcIds.has(id);
    },
    applySessionRemovedNpcs(removedNpcIds) {
      const normalized = SaveSystem.normalizeRemovedNpcIds(removedNpcIds);
      sessionRemovedNpcIds.clear();
      normalized.forEach((entry) => sessionRemovedNpcIds.add(entry));
    },
    exportRemovedNpcIds() {
      return SaveSystem.normalizeRemovedNpcIds(Array.from(sessionRemovedNpcIds));
    }
  };
}

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
    setDisplaySize(w, h) {
      this.displayWidth = w;
      this.displayHeight = h;
      return this;
    },
    getBounds() {
      return { centerX: this.x, bottom: this.y + this.displayHeight / 2 };
    },
    destroy() { this.destroyed = true; this.body = null; }
  };
}

function createScene() {
  const groundItems = [];
  return {
    groundItems,
    player: { x: 0, y: 0, body: {}, destroyed: false, active: true },
    playerStatsModel: { isDead() { return false; } },
    damagePlayer() { return 0; },
    textures: { exists() { return true; } },
    make: {
      graphics() {
        return {
          fillStyle() { return this; },
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
      image(x, y, key) {
        return createImageMock(x, y, key);
      }
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
        collider() {
          return { destroy() {} };
        }
      }
    },
    tweens: {
      add(config) {
        return { config, stop() {}, complete() {} };
      }
    },
    time: {
      delayedCall() {
        return { remove() {}, destroy() {} };
      }
    },
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

function findTallMonsterChunk(seed) {
  for (let cx = -16; cx <= 16; cx += 1) {
    for (let cy = -16; cy <= 16; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const tall = chunk.npcs.find((n) => n.type === 'TALL_MONSTER');
      if (tall) {
        return { chunk, descriptor: tall, enemyId: buildChunkEnemyId(cx, cy, 'TALL_MONSTER', 0) };
      }
    }
  }
  throw new Error('No TALL_MONSTER found in survey');
}

function createBaseSaveState(removedNpcIds) {
  return {
    version: 1,
    savedAt: Date.now(),
    player: { x: 100, y: 100, health: 100, hunger: 100 },
    dayNight: { dayNumber: 1, timeOfDayMs: 0 },
    inventory: {
      activeHotbarIndex: 0,
      slots: Array(25).fill(null)
    },
    world: {
      removedObjectIds: [],
      deadCreatureIds: [],
      groundItems: [],
      walls: [],
      removedResources: [],
      removedNpcIds
    }
  };
}

// Validation accepts ENEMY and NPC, rejects TREE
{
  const enemyId = 'chunk_3_-1_ENEMY_TALL_MONSTER_0';
  const rabbitId = 'chunk_1_0_NPC_RABBIT_0';
  const treeId = 'chunk_0_0_TREE_3_4';
  assert(SaveSystem.isValidRemovedNpcId(enemyId), 'ENEMY id valid');
  assert(SaveSystem.isValidRemovedNpcId(rabbitId), 'NPC id valid');
  assert(!SaveSystem.isValidRemovedNpcId(treeId), 'TREE id invalid for npc set');
  assert(!SaveSystem.isValidRemovedNpcId('tall-monster-texture'), 'texture key invalid');
  assertEqual(
    JSON.stringify(SaveSystem.normalizeRemovedNpcIds([
      enemyId,
      rabbitId,
      treeId,
      '',
      null,
      7,
      enemyId
    ])),
    JSON.stringify([enemyId, rabbitId].sort()),
    'normalization keeps ENEMY+NPC, drops TREE/junk'
  );
}

const seed = 424242;
const found = findTallMonsterChunk(seed);
const { chunk, descriptor, enemyId } = found;
assertEqual(descriptor.type, 'TALL_MONSTER', 'descriptor type');
assertEqual(descriptor.index, 0, 'descriptor index');
assertEqual(
  enemyId,
  `chunk_${chunk.chunkX}_${chunk.chunkY}_ENEMY_TALL_MONSTER_0`,
  'canonical enemy id'
);

// Use the real descriptor/coords but empty objects so the test focuses on NPC
// persistence without needing a full TREE/ROCK physics mock.
const chunkForNpc = {
  chunkX: chunk.chunkX,
  chunkY: chunk.chunkY,
  terrain: chunk.terrain,
  objects: [],
  npcs: chunk.npcs.filter((n) => n.type === 'TALL_MONSTER'),
  spawnPoints: chunk.spawnPoints || []
};

// Diagnose the pre-fix filter: _NPC_-only would reject this ID.
assertEqual(enemyId.indexOf('_NPC_'), -1, 'hostile id has no _NPC_ substring');
assert(enemyId.indexOf('_ENEMY_') !== -1, 'hostile id uses _ENEMY_');

// SCENARIO A: death → chunk unload → reload through production mark filter
{
  const owner = createSessionOwner();
  const scene = createScene();
  const instance = new ChunkInstance(scene, chunkForNpc, {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => owner.isSessionNpcRemoved(id),
    onNpcRemoved: (id) => owner.markSessionNpcRemoved(id)
  });

  assertEqual(instance.npcObjects.length, 1, 'A: hostile created');
  const npc = instance.npcObjects[0];
  const runtimeId = npc.getData('npcId');
  assertEqual(runtimeId, enemyId, 'A: runtime id matches descriptor id');

  const death = instance.applyNpcDamage(npc, 30);
  assertEqual(death.died, true, 'A: death');
  assert(owner.isSessionNpcRemoved(enemyId), 'A: mark accepts ENEMY id after death');
  assertEqual(
    JSON.stringify(owner.exportRemovedNpcIds()),
    JSON.stringify([enemyId]),
    'A: export contains exact enemy id'
  );
  assertEqual(scene.groundItems.length, 1, 'A: one loot');
  assertEqual(scene.groundItems[0].quantity, 2, 'A: loot qty 2');

  instance.destroy();

  const sceneReload = createScene();
  const reloaded = new ChunkInstance(sceneReload, {
    ...chunkForNpc,
    npcs: ChunkGenerator.generate(seed, chunk.chunkX, chunk.chunkY).npcs
      .filter((n) => n.type === 'TALL_MONSTER')
  }, {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => owner.isSessionNpcRemoved(id),
    onNpcRemoved: (id) => owner.markSessionNpcRemoved(id)
  });
  assertEqual(reloaded.npcObjects.length, 0, 'A: reload creates no hostile');
  assertEqual(reloaded.hostileControllers.length, 0, 'A: no controller');
  assertEqual(sceneReload.groundItems.length, 0, 'A: no duplicate loot');
  reloaded.destroy();
}

// SCENARIO B: death → save normalize/load → same chunk
{
  const owner = createSessionOwner();
  const scene = createScene();
  const instance = new ChunkInstance(scene, chunkForNpc, {
    blockingGroup: createBlockingGroup(),
    isNpcRemoved: (id) => owner.isSessionNpcRemoved(id),
    onNpcRemoved: (id) => owner.markSessionNpcRemoved(id)
  });
  const npc = instance.npcObjects[0];
  assertEqual(npc.getData('npcId'), enemyId, 'B: runtime id');
  assertEqual(instance.applyNpcDamage(npc, 30).died, true, 'B: death');
  instance.destroy();

  const serialized = owner.exportRemovedNpcIds();
  assertEqual(JSON.stringify(serialized), JSON.stringify([enemyId]), 'B: serialized array');

  const saved = SaveSystem.normalizeState(createBaseSaveState(serialized));
  assert(saved !== null, 'B: save normalizes');
  assertEqual(
    JSON.stringify(saved.world.removedNpcIds),
    JSON.stringify([enemyId]),
    'B: ENEMY id survives normalization'
  );

  const restored = createSessionOwner();
  restored.applySessionRemovedNpcs(saved.world.removedNpcIds);
  assert(restored.isSessionNpcRemoved(enemyId), 'B: restored set has id');

  const afterLoad = new ChunkInstance(
    createScene(),
    {
      ...chunkForNpc,
      npcs: ChunkGenerator.generate(seed, chunk.chunkX, chunk.chunkY).npcs
        .filter((n) => n.type === 'TALL_MONSTER')
    },
    {
      blockingGroup: createBlockingGroup(),
      isNpcRemoved: (id) => restored.isSessionNpcRemoved(id),
      onNpcRemoved: (id) => restored.markSessionNpcRemoved(id)
    }
  );
  assertEqual(afterLoad.npcObjects.length, 0, 'B: no hostile after Continue');
  afterLoad.destroy();

  // Second save/load round-trip
  const again = SaveSystem.normalizeState(
    createBaseSaveState(restored.exportRemovedNpcIds())
  );
  assertEqual(
    JSON.stringify(again.world.removedNpcIds),
    JSON.stringify([enemyId]),
    'B: second save/load keeps id'
  );
}

// Passive still works; other chunk enemy not blocked; malformed dropped
{
  const rabbitId = buildChunkNpcId(7, 2, 'RABBIT', 0);
  const otherEnemy = buildChunkEnemyId(9, 4, 'TALL_MONSTER', 0);
  assert(otherEnemy !== enemyId, 'distinct hostile ids');

  const owner = createSessionOwner();
  owner.markSessionNpcRemoved(rabbitId);
  owner.markSessionNpcRemoved(enemyId);
  owner.markSessionNpcRemoved('chunk_0_0_TREE_1_1');
  owner.markSessionNpcRemoved(null);
  assert(owner.isSessionNpcRemoved(rabbitId), 'passive mark works');
  assert(owner.isSessionNpcRemoved(enemyId), 'hostile mark works');
  assert(!owner.isSessionNpcRemoved('chunk_0_0_TREE_1_1'), 'tree rejected');
  assert(!owner.isSessionNpcRemoved(otherEnemy), 'other hostile not blocked');

  const legacy = SaveSystem.normalizeState(createBaseSaveState(undefined));
  // createBaseSaveState always sets removedNpcIds; test missing field:
  const legacyState = createBaseSaveState([]);
  delete legacyState.world.removedNpcIds;
  const legacyNorm = SaveSystem.normalizeState(legacyState);
  assert(legacyNorm !== null, 'legacy without removedNpcIds loads');
  assertEqual(JSON.stringify(legacyNorm.world.removedNpcIds), '[]', 'legacy default []');

  const passiveOnly = SaveSystem.normalizeState(createBaseSaveState([rabbitId]));
  assertEqual(
    JSON.stringify(passiveOnly.world.removedNpcIds),
    JSON.stringify([rabbitId]),
    'old passive-only save loads'
  );
}

console.log('test-hostile-persistence: ok');
