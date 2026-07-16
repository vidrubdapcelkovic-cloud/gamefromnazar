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
  'src/world/ChunkResourceIds.js'
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
  `${bundle}\n;exports.SaveSystem = SaveSystem; exports.buildChunkResourceId = buildChunkResourceId; exports.shouldMaterializeChunkResource = shouldMaterializeChunkResource;`,
  context,
  { filename: 'removed-resources-persistence-bundle.js' }
);

const {
  SaveSystem,
  buildChunkResourceId,
  shouldMaterializeChunkResource
} = context.exports;

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
      walls: []
    },
    worldSeed: 42,
    ...overrides
  };
}

const treeId = buildChunkResourceId(0, 0, 'TREE', 3, 4);
const rockId = buildChunkResourceId(-1, 2, 'ROCK', 11, 7);
const otherId = buildChunkResourceId(0, 0, 'TREE', 5, 6);

const slotOne = SaveSystem.normalizeState(createBaseState({
  world: {
    ...createBaseState().world,
    removedResources: [rockId, treeId, treeId, '', null]
  }
}));
assert(slotOne !== null, 'slot one save normalizes');
assertEqual(
  JSON.stringify(slotOne.world.removedResources),
  JSON.stringify([rockId, treeId].sort()),
  'slot one stores cleaned sorted ids'
);

const restoredSet = new Set(slotOne.world.removedResources);
assertEqual(shouldMaterializeChunkResource(treeId, restoredSet), false, 'restored set filters TREE');
assertEqual(shouldMaterializeChunkResource(rockId, restoredSet), false, 'restored set filters ROCK');
assertEqual(shouldMaterializeChunkResource(otherId, restoredSet), true, 'other ids still materialize');

const slotTwo = SaveSystem.normalizeState(createBaseState({
  world: {
    ...createBaseState().world,
    removedResources: []
  }
}));
assertEqual(slotTwo.world.removedResources.length, 0, 'slot two starts empty');
assertEqual(
  shouldMaterializeChunkResource(treeId, new Set(slotTwo.world.removedResources)),
  true,
  'slot two does not inherit slot one removals'
);

const legacy = SaveSystem.normalizeState(createBaseState());
assertEqual(JSON.stringify(legacy.world.removedResources), '[]', 'legacy save without field becomes []');
assertEqual(
  shouldMaterializeChunkResource(treeId, new Set(legacy.world.removedResources)),
  true,
  'new/legacy session starts with empty removed set'
);

console.log('test-removed-resources-persistence: ok');
