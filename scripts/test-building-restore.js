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
  'src/systems/BuildingSystem.js'
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
  INTERFACE_DEPTH: 2000,
  WORLD_DEPTH_SCALE: 0.1,
  exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}\n;exports.BuildingSystem = BuildingSystem; exports.ChestStorageModel = ChestStorageModel;`,
  context,
  { filename: 'building-restore-bundle.js' }
);

const { BuildingSystem, ChestStorageModel } = context.exports;

function createMockVisual() {
  const data = {};
  const visual = {
    displayHeight: 32,
    active: true,
    body: { enable: true },
    setDepth() { return visual; },
    setAlpha() { return visual; },
    setVisible() { return visual; },
    setTexture() { return visual; },
    setTint() { return visual; },
    setPosition() { return visual; },
    setDataEnabled() { return visual; },
    setData(key, value) { data[key] = value; },
    getData(key) { return data[key]; },
    destroy() { visual.active = false; }
  };
  return visual;
}

function createBuildingSystem() {
  const scene = {
    add: {
      image() { return createMockVisual(); }
    }
  };
  const blockingWorldObjects = {
    create() { return createMockVisual(); }
  };
  const worldGrid = {
    tileSize: 32,
    isInside(col, row) {
      return Number.isInteger(col) && Number.isInteger(row);
    },
    cellToWorldCenter(col, row) {
      return { x: col * 32 + 16, y: row * 32 + 16 };
    }
  };
  return new BuildingSystem(scene, worldGrid, blockingWorldObjects, {
    WOOD_WALL: 'temporary-wood-wall',
    CAMPFIRE: 'temporary-campfire',
    CHEST: 'temporary-chest'
  });
}

const system = createBuildingSystem();

assertEqual(system.restoreState([]), true, 'empty array restores safely');
assertEqual(system.getPlacements().length, 0, 'empty restore leaves no placements');

assertEqual(
  system.restoreState([{ id: 'building-1', buildType: 'WOOD_WALL', col: 4, row: 5 }]),
  true,
  'single building restores'
);
const single = system.getPlacements()[0];
assertEqual(single.id, 'building-1', 'single building id');
assertEqual(single.col, 4, 'single building col');
assertEqual(single.row, 5, 'single building row');

assertEqual(
  system.restoreState([{ id: 'building-2', buildType: 'WOOD_WALL', col: -3, row: -7 }]),
  true,
  'negative coordinates restore'
);
const negative = system.getPlacements()[0];
assertEqual(negative.col, -3, 'negative col preserved');
assertEqual(negative.row, -7, 'negative row preserved');

assertEqual(
  system.restoreState([
    { id: 'building-10', buildType: 'WOOD_WALL', col: 0, row: 0 },
    { id: 'building-20', buildType: 'CAMPFIRE', col: 1, row: 0 }
  ]),
  true,
  'two different ids restore'
);
assertEqual(system.getPlacements().length, 2, 'two placements restored');
assertEqual(system.nextId, 21, 'nextId continues after max building-N');

assertEqual(
  system.restoreState([
    { id: 'building-1', buildType: 'WOOD_WALL', col: 0, row: 0 },
    { id: 'building-1', buildType: 'WOOD_WALL', col: 1, row: 0 }
  ]),
  false,
  'duplicate id rejects restore'
);
assertEqual(system.getPlacements().length, 2, 'duplicate id leaves previous state untouched');

assertEqual(
  system.restoreState([{ id: 'building-3', buildType: 'UNKNOWN_TYPE', col: 0, row: 0 }]),
  false,
  'unknown buildType rejects restore'
);

assertEqual(
  system.restoreState([{
    id: 'building-4',
    buildType: 'CHEST',
    col: 2,
    row: 2,
    storage: Array(15).fill(null)
  }]),
  true,
  'chest storage restores'
);
const chest = system.getPlacements()[0];
assertEqual(chest.buildType, 'CHEST', 'chest buildType');
assert(chest.storage instanceof ChestStorageModel, 'chest storage model exists');
assertEqual(chest.storage.exportState().length, 15, 'chest storage slot count');

console.log('test-building-restore: ok');
