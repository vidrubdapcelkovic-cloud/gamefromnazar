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
  'src/systems/ChestStorageModel.js',
  'src/systems/DayNightSystem.js',
  'src/systems/SaveSystem.js',
  'src/world/ChunkNpcIds.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console,
  Math,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  Error,
  exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.SaveSystem = SaveSystem;
;exports.buildChunkNpcId = buildChunkNpcId;`,
  context,
  { filename: 'removed-npcs-persistence-bundle.js' }
);

const { SaveSystem, buildChunkNpcId } = context.exports;

function createOwner() {
  const sessionRemovedNpcIds = new Set();
  return {
    sessionRemovedNpcIds,
    markSessionNpcRemoved(id) {
      if (typeof id !== 'string' || id.length === 0) return;
      if (!id.startsWith('chunk_') || id.indexOf('_NPC_') === -1) return;
      sessionRemovedNpcIds.add(id);
    },
    isSessionNpcRemoved(id) {
      return sessionRemovedNpcIds.has(id);
    },
    applySessionRemovedNpcs(removedNpcIds) {
      const normalized = SaveSystem.normalizeRemovedNpcIds(removedNpcIds);
      sessionRemovedNpcIds.clear();
      normalized.forEach((id) => sessionRemovedNpcIds.add(id));
    },
    exportRemovedNpcIds() {
      return SaveSystem.normalizeRemovedNpcIds(Array.from(sessionRemovedNpcIds));
    }
  };
}

function createBaseState(overrides = {}) {
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
      removedResources: []
    },
    ...overrides
  };
}

const owner = createOwner();
assertEqual(owner.exportRemovedNpcIds().length, 0, 'new game has empty removedNpcIds');

const npcId = buildChunkNpcId(1, -2, 'RABBIT', 0);
const otherId = buildChunkNpcId(2, 0, 'RABBIT', 0);
const treeId = 'chunk_0_0_TREE_3_4';

owner.markSessionNpcRemoved(npcId);
owner.markSessionNpcRemoved(npcId);
owner.markSessionNpcRemoved('');
owner.markSessionNpcRemoved(null);
owner.markSessionNpcRemoved(treeId);
assertEqual(owner.exportRemovedNpcIds().length, 1, 'invalid values ignored; no duplicates');
assert(owner.isSessionNpcRemoved(npcId), 'isSessionNpcRemoved true for marked id');
assert(!owner.isSessionNpcRemoved(otherId), 'isSessionNpcRemoved false for other id');
assert(!owner.isSessionNpcRemoved(treeId), 'TREE id not accepted into removedNpcIds');

const exported = owner.exportRemovedNpcIds();
assert(Array.isArray(exported), 'export is plain array');
assertEqual(JSON.stringify(exported), JSON.stringify([npcId]), 'export contains marked id');

const restored = createOwner();
restored.applySessionRemovedNpcs(exported);
assert(restored.isSessionNpcRemoved(npcId), 'restore restores id');
assertEqual(restored.exportRemovedNpcIds().length, 1, 'restore keeps single id');

restored.applySessionRemovedNpcs([npcId, npcId, '', null, 12, otherId]);
assertEqual(
  JSON.stringify(restored.exportRemovedNpcIds()),
  JSON.stringify([npcId, otherId].sort()),
  'restore filters duplicates and invalid values'
);

restored.applySessionRemovedNpcs(undefined);
assertEqual(restored.exportRemovedNpcIds().length, 0, 'missing field restore clears to empty');

const legacy = SaveSystem.normalizeState(createBaseState());
assert(legacy !== null, 'legacy save without removedNpcIds loads');
assertEqual(
  JSON.stringify(legacy.world.removedNpcIds),
  '[]',
  'legacy save gets empty removedNpcIds'
);

const withMeat = SaveSystem.normalizeState(createBaseState({
  world: {
    ...createBaseState().world,
    removedNpcIds: [npcId],
    groundItems: [{ itemType: 'RAW_MEAT', quantity: 1, x: 10, y: 20 }],
    removedResources: [treeId]
  }
}));
assert(withMeat !== null, 'save with removedNpcIds and groundItems loads');
assertEqual(
  JSON.stringify(withMeat.world.removedNpcIds),
  JSON.stringify([npcId]),
  'npc ids persist in save'
);
assertEqual(
  JSON.stringify(withMeat.world.removedResources),
  JSON.stringify([treeId]),
  'resource ids remain separate'
);
assertEqual(withMeat.world.groundItems.length, 1, 'groundItems still persist');
assertEqual(withMeat.world.groundItems[0].itemType, 'RAW_MEAT', 'meat remains in save');

console.log('test-removed-npcs-persistence: ok');
