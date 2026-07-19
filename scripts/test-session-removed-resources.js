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
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
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
  `${bundle}\n;exports.buildChunkResourceId = buildChunkResourceId; exports.shouldMaterializeChunkResource = shouldMaterializeChunkResource; exports.ChunkGenerator = ChunkGenerator;`,
  context,
  { filename: 'session-removed-resources-bundle.js' }
);

const {
  buildChunkResourceId,
  shouldMaterializeChunkResource,
  ChunkGenerator
} = context.exports;

function createRemovedSet(ids = []) {
  return new Set(ids);
}

const treeId = buildChunkResourceId(0, 0, 'TREE', 3, 4);
const rockId = buildChunkResourceId(-2, 1, 'ROCK', 7, 8);
const otherTreeId = buildChunkResourceId(0, 0, 'TREE', 5, 6);

const removed = createRemovedSet();
assertEqual(removed.size, 0, 'new session starts empty');

removed.add(treeId);
removed.add(rockId);
assert(removed.has(treeId), 'tree id added to removed set');
assert(removed.has(rockId), 'rock id added to removed set');
assertEqual(removed.size, 2, 'removed set size after two ids');

removed.add(treeId);
assertEqual(removed.size, 2, 'duplicate removal is idempotent');

assertEqual(shouldMaterializeChunkResource(treeId, removed), false, 'filter excludes removed tree');
assertEqual(shouldMaterializeChunkResource(rockId, removed), false, 'filter excludes removed rock');
assertEqual(shouldMaterializeChunkResource(otherTreeId, removed), true, 'other ids are not excluded');

const negativeTreeId = buildChunkResourceId(-3, -4, 'TREE', 1, 2);
assertEqual(
  buildChunkResourceId(-3, -4, 'TREE', 1, 2),
  'chunk_-3_-4_TREE_1_2',
  'negative chunk coordinates in stable id'
);
assertEqual(shouldMaterializeChunkResource(negativeTreeId, removed), true, 'negative chunk id not excluded by default');

const seedA = 424242;
const first = ChunkGenerator.generate(seedA, 1, -2);
const second = ChunkGenerator.generate(seedA, 1, -2);
assertEqual(JSON.stringify(first.objects), JSON.stringify(second.objects), 'same seed/chunk gives same descriptors');

const descriptor = first.objects[0];
const generatedId = buildChunkResourceId(
  first.chunkX,
  first.chunkY,
  descriptor.type,
  descriptor.localTileX,
  descriptor.localTileY
);
const generatedIdAgain = buildChunkResourceId(
  second.chunkX,
  second.chunkY,
  descriptor.type,
  descriptor.localTileX,
  descriptor.localTileY
);
assertEqual(generatedId, generatedIdAgain, 'stable id matches across regenerations');

assert(
  buildChunkResourceId(0, 0, 'TREE', 1, 1) !== buildChunkResourceId(0, 0, 'ROCK', 1, 1),
  'tree and rock ids differ'
);

console.log('test-session-removed-resources: ok');
