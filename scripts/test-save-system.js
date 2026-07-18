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
  'src/systems/SaveSystem.js'
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
  `${bundle}\n;exports.SaveSystem = SaveSystem;`,
  context,
  { filename: 'save-system-bundle.js' }
);

const { SaveSystem } = context.exports;

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
    ...overrides
  };
}

function createWall(col, row, buildType = 'WOOD_WALL', id = 'building-1') {
  return { id, buildType, col, row };
}

function normalizeWalls(state) {
  const normalized = SaveSystem.normalizeState(state);
  assert(normalized !== null, 'expected valid save state');
  return normalized.world.walls;
}

function expectInvalid(state) {
  assertEqual(SaveSystem.normalizeState(state), null, 'expected invalid save state');
}

// Fixed-map without worldSeed
assertEqual(
  normalizeWalls(createBaseState({ world: { ...createBaseState().world, walls: [createWall(0, 0)] } })).length,
  1,
  'fixed-map col=0,row=0 valid'
);
assertEqual(
  normalizeWalls(createBaseState({ world: { ...createBaseState().world, walls: [createWall(47, 35)] } })).length,
  1,
  'fixed-map col=47,row=35 valid'
);
expectInvalid(createBaseState({ world: { ...createBaseState().world, walls: [createWall(-1, 0)] } }));
expectInvalid(createBaseState({ world: { ...createBaseState().world, walls: [createWall(48, 0)] } }));

// Chunked with worldSeed
function chunkedState(walls) {
  return createBaseState({
    worldSeed: 12345,
    world: { ...createBaseState().world, walls }
  });
}

assertEqual(normalizeWalls(chunkedState([createWall(-1, -1)])).length, 1, 'chunked col=-1,row=-1 valid');
assertEqual(
  normalizeWalls(chunkedState([createWall(-100, 250)])).length,
  1,
  'chunked col=-100,row=250 valid'
);
assertEqual(
  normalizeWalls(chunkedState([createWall(100000, -100000)])).length,
  1,
  'chunked large coordinates valid'
);

const negativeWall = normalizeWalls(chunkedState([createWall(-5, -12, 'CAMPFIRE', 'building-2')]))[0];
assertEqual(negativeWall.col, -5, 'chunked negative col preserved');
assertEqual(negativeWall.row, -12, 'chunked negative row preserved');

expectInvalid(chunkedState([createWall(1.5, 0)]));
expectInvalid(chunkedState([createWall(Number.NaN, 0)]));
expectInvalid(chunkedState([createWall(Number.POSITIVE_INFINITY, 0)]));

// Old save without worldSeed keeps fixed-map rules
expectInvalid(createBaseState({ world: { ...createBaseState().world, walls: [createWall(-1, -1)] } }));
expectInvalid(createBaseState({ world: { ...createBaseState().world, walls: [createWall(100000, 0)] } }));

// removedResources normalization
function normalizedRemoved(overrides = {}) {
  const state = createBaseState(overrides);
  const normalized = SaveSystem.normalizeState(state);
  assert(normalized !== null, 'expected valid save for removedResources');
  return normalized.world.removedResources;
}

assertEqual(
  JSON.stringify(normalizedRemoved()),
  '[]',
  'missing removedResources becomes []'
);
assertEqual(
  JSON.stringify(normalizedRemoved({
    world: { ...createBaseState().world, removedResources: null }
  })),
  '[]',
  'non-array removedResources becomes []'
);
assertEqual(
  JSON.stringify(normalizedRemoved({
    world: { ...createBaseState().world, removedResources: 'bad' }
  })),
  '[]',
  'string removedResources becomes []'
);

const oneId = 'chunk_0_0_TREE_3_4';
assertEqual(
  JSON.stringify(normalizedRemoved({
    world: { ...createBaseState().world, removedResources: [oneId] }
  })),
  JSON.stringify([oneId]),
  'single removed resource id preserved'
);

const many = [
  'chunk_1_0_ROCK_2_2',
  'chunk_0_0_TREE_3_4',
  'chunk_-1_2_ROCK_11_7'
];
assertEqual(
  JSON.stringify(normalizedRemoved({
    world: { ...createBaseState().world, removedResources: many }
  })),
  JSON.stringify([...many].sort()),
  'multiple ids are sorted'
);

assertEqual(
  JSON.stringify(normalizedRemoved({
    world: {
      ...createBaseState().world,
      removedResources: [oneId, oneId, 'chunk_0_0_TREE_3_4']
    }
  })),
  JSON.stringify([oneId]),
  'duplicates removed'
);

assertEqual(
  JSON.stringify(normalizedRemoved({
    world: {
      ...createBaseState().world,
      removedResources: [oneId, '', null, 12, 'chunk_-3_-4_TREE_1_2']
    }
  })),
  JSON.stringify(['chunk_-3_-4_TREE_1_2', oneId].sort()),
  'empty/non-string values dropped; negatives kept'
);

assertEqual(
  JSON.stringify(SaveSystem.normalizeRemovedResources([
    'chunk_2_0_TREE_1_1',
    'chunk_0_0_TREE_1_1',
    'chunk_0_0_TREE_1_1',
    '',
    5
  ])),
  JSON.stringify(['chunk_0_0_TREE_1_1', 'chunk_2_0_TREE_1_1']),
  'normalizeRemovedResources helper sorts and filters'
);

// removedNpcIds normalization
function normalizedRemovedNpcs(overrides = {}) {
  const state = createBaseState(overrides);
  const normalized = SaveSystem.normalizeState(state);
  assert(normalized !== null, 'expected valid save for removedNpcIds');
  return normalized.world.removedNpcIds;
}

assertEqual(
  JSON.stringify(normalizedRemovedNpcs()),
  '[]',
  'missing removedNpcIds becomes []'
);
assertEqual(
  JSON.stringify(normalizedRemovedNpcs({
    world: { ...createBaseState().world, removedNpcIds: null }
  })),
  '[]',
  'non-array removedNpcIds becomes []'
);

const oneNpcId = 'chunk_1_-2_NPC_RABBIT_0';
assertEqual(
  JSON.stringify(normalizedRemovedNpcs({
    world: { ...createBaseState().world, removedNpcIds: [oneNpcId] }
  })),
  JSON.stringify([oneNpcId]),
  'single removed npc id preserved'
);

assertEqual(
  JSON.stringify(normalizedRemovedNpcs({
    world: {
      ...createBaseState().world,
      removedNpcIds: [oneNpcId, oneNpcId, '', null, 9, 'chunk_2_0_NPC_RABBIT_1']
    }
  })),
  JSON.stringify(['chunk_2_0_NPC_RABBIT_1', oneNpcId].sort()),
  'removedNpcIds filters duplicates and invalid values'
);

assertEqual(
  JSON.stringify(SaveSystem.normalizeRemovedNpcIds([
    'chunk_2_0_NPC_RABBIT_1',
    'chunk_0_0_NPC_RABBIT_0',
    'chunk_0_0_NPC_RABBIT_0',
    '',
    5
  ])),
  JSON.stringify(['chunk_0_0_NPC_RABBIT_0', 'chunk_2_0_NPC_RABBIT_1']),
  'normalizeRemovedNpcIds helper sorts and filters'
);

const enemyNpcId = 'chunk_3_-1_ENEMY_TALL_MONSTER_0';
assertEqual(
  JSON.stringify(SaveSystem.normalizeRemovedNpcIds([
    enemyNpcId,
    oneNpcId,
    'chunk_0_0_TREE_1_1',
    'tall-monster-texture',
    enemyNpcId
  ])),
  JSON.stringify([enemyNpcId, oneNpcId].sort()),
  'normalizeRemovedNpcIds keeps ENEMY ids and drops TREE/texture'
);
assert(SaveSystem.isValidRemovedNpcId(enemyNpcId), 'isValidRemovedNpcId accepts ENEMY');
assert(SaveSystem.isValidRemovedNpcId(oneNpcId), 'isValidRemovedNpcId accepts NPC');
assert(!SaveSystem.isValidRemovedNpcId('chunk_0_0_TREE_1_1'), 'isValidRemovedNpcId rejects TREE');

assertEqual(
  JSON.stringify(normalizedRemovedNpcs({
    world: { ...createBaseState().world, removedNpcIds: [enemyNpcId, oneNpcId] }
  })),
  JSON.stringify([enemyNpcId, oneNpcId].sort()),
  'full normalizeState preserves hostile ENEMY id'
);

const mixed = SaveSystem.normalizeState(createBaseState({
  world: {
    ...createBaseState().world,
    removedResources: [oneId],
    removedNpcIds: [oneNpcId]
  }
}));
assert(mixed !== null, 'mixed resource/npc removed fields normalize');
assertEqual(
  JSON.stringify(mixed.world.removedResources),
  JSON.stringify([oneId]),
  'resource ids stay in removedResources'
);
assertEqual(
  JSON.stringify(mixed.world.removedNpcIds),
  JSON.stringify([oneNpcId]),
  'npc ids stay in removedNpcIds'
);
assert(
  !mixed.world.removedNpcIds.includes(oneId),
  'TREE id does not appear in removedNpcIds when saved separately'
);

console.log('test-save-system: ok');
