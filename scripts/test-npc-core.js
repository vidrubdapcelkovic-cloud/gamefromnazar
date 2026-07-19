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

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert(error instanceof Error, `${message}: expected Error`);
    assert(
      typeof error.message === 'string' && error.message.length > 0,
      `${message}: expected non-empty error message`
    );
  }
  assert(threw, `${message}: expected throw`);
}

const bundle = [
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js',
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
  `${bundle}\n;exports.buildChunkNpcId = buildChunkNpcId; exports.buildChunkResourceId = buildChunkResourceId; exports.ChunkGenerator = ChunkGenerator; exports.ChunkMath = ChunkMath;`,
  context,
  { filename: 'npc-core-bundle.js' }
);

const {
  buildChunkNpcId,
  buildChunkResourceId,
  ChunkGenerator,
  ChunkMath
} = context.exports;

const first = buildChunkNpcId(0, 0, 'RABBIT', 0);
const second = buildChunkNpcId(0, 0, 'RABBIT', 0);
assertEqual(first, second, 'same inputs yield same ID');
assertEqual(first, 'chunk_0_0_NPC_RABBIT_0', 'canonical RABBIT ID format');

assertEqual(
  buildChunkNpcId(0, 0, 'RABBIT', 1),
  'chunk_0_0_NPC_RABBIT_1',
  'different index yields different ID'
);
assert(
  buildChunkNpcId(0, 0, 'RABBIT', 0) !== buildChunkNpcId(0, 0, 'RABBIT', 1),
  'index 0 and 1 must differ'
);

assert(
  buildChunkNpcId(0, 0, 'RABBIT', 0) !== buildChunkNpcId(0, 0, 'SLIME', 0),
  'different type yields different ID'
);

assertEqual(
  buildChunkNpcId(-2, 3, 'RABBIT', 1),
  'chunk_-2_3_NPC_RABBIT_1',
  'negative chunk coordinates supported'
);
assertEqual(
  buildChunkNpcId(-2, -3, 'RABBIT', 0),
  'chunk_-2_-3_NPC_RABBIT_0',
  'both negative chunk coordinates supported'
);

const resourceTree = buildChunkResourceId(0, 0, 'TREE', 0, 0);
const resourceRock = buildChunkResourceId(0, 0, 'ROCK', 0, 0);
assert(first !== resourceTree, 'NPC ID does not collide with TREE resource ID');
assert(
  buildChunkNpcId(0, 0, 'ROCK', 0) !== resourceRock,
  'NPC ROCK namespace differs from resource ROCK id'
);
assert(
  buildChunkNpcId(0, 0, 'TREE', 0) !== resourceTree,
  'NPC TREE namespace differs from resource TREE id'
);

assertEqual(
  buildChunkNpcId(1, 2, 'rabbit', 0),
  'chunk_1_2_NPC_RABBIT_0',
  'type is normalized to safe uppercase string'
);
assertEqual(
  buildChunkNpcId(1, 2, ' Ra-bbit! ', 0),
  'chunk_1_2_NPC_RABBIT_0',
  'unsafe type characters are stripped'
);

assertThrows(() => buildChunkNpcId(0, 0, 'RABBIT', -1), 'negative index');
assertThrows(() => buildChunkNpcId(0, 0, 'RABBIT', 1.5), 'non-integer index');
assertThrows(() => buildChunkNpcId(0, 0, 'RABBIT', '0'), 'string index');
assertThrows(() => buildChunkNpcId(0, 0, '', 0), 'empty type');
assertThrows(() => buildChunkNpcId(0, 0, '   ', 0), 'whitespace-only type');
assertThrows(() => buildChunkNpcId(0, 0, '!!!', 0), 'type with no safe characters');
assertThrows(() => buildChunkNpcId(0, 0, null, 0), 'null type');
assertThrows(() => buildChunkNpcId(0.5, 0, 'RABBIT', 0), 'non-integer chunkX');
assertThrows(() => buildChunkNpcId(0, 0.5, 'RABBIT', 0), 'non-integer chunkY');

const npcSeed = 424242;
const npcChunkA = ChunkGenerator.generate(npcSeed, 2, -1);
const npcChunkB = ChunkGenerator.generate(npcSeed, 2, -1);
function countType(npcs, type) {
  return npcs.filter((entry) => entry.type === type).length;
}

assert(Array.isArray(npcChunkA.npcs), 'generate always returns npcs array');
assertEqual(JSON.stringify(npcChunkA.npcs), JSON.stringify(npcChunkB.npcs), 'npc descriptors are deterministic');
assertEqual(
  JSON.stringify(npcChunkA.objects),
  JSON.stringify(npcChunkB.objects),
  'objects stay deterministic alongside npcs'
);
assert(countType(npcChunkA.npcs, 'RABBIT') <= 1, 'at most one rabbit per chunk');
assert(countType(npcChunkA.npcs, 'PIG') <= 1, 'at most one pig per chunk');
assert(countType(npcChunkA.npcs, 'LLAMA') <= 1, 'at most one llama per chunk');
assert(countType(npcChunkA.npcs, 'BUFFALO') <= 1, 'at most one buffalo per chunk');
assert(countType(npcChunkA.npcs, 'TALL_MONSTER') <= 1, 'at most one tall monster per chunk');
assert(countType(npcChunkA.npcs, 'ELECTRICMAN') <= 1, 'at most one electricman per chunk');
assert(countType(npcChunkA.npcs, 'BOWMAN') <= 1, 'at most one bowman per chunk');
assert(npcChunkA.npcs.length <= 7, 'at most seven npcs per chunk (passive + hostiles)');

let foundWithNpc = null;
let foundWithoutNpc = null;
for (let chunkX = -8; chunkX <= 8; chunkX += 1) {
  for (let chunkY = -8; chunkY <= 8; chunkY += 1) {
    const sample = ChunkGenerator.generate(npcSeed, chunkX, chunkY);
    assert(Array.isArray(sample.npcs), 'npcs always present');
    assert(countType(sample.npcs, 'RABBIT') <= 1, 'rabbit count never exceeds 1');
    assert(countType(sample.npcs, 'PIG') <= 1, 'pig count never exceeds 1');
    assert(countType(sample.npcs, 'LLAMA') <= 1, 'llama count never exceeds 1');
    assert(countType(sample.npcs, 'BUFFALO') <= 1, 'buffalo count never exceeds 1');
    assert(countType(sample.npcs, 'TALL_MONSTER') <= 1, 'tall monster count never exceeds 1');
    assert(countType(sample.npcs, 'ELECTRICMAN') <= 1, 'electricman count never exceeds 1');
    assert(countType(sample.npcs, 'BOWMAN') <= 1, 'bowman count never exceeds 1');
    assert(sample.npcs.length <= 7, 'npc count never exceeds 7');
    const rabbitCount = countType(sample.npcs, 'RABBIT');
    if (rabbitCount === 1 && !foundWithNpc) foundWithNpc = sample;
    if (rabbitCount === 0 && !foundWithoutNpc) foundWithoutNpc = sample;
    if (foundWithNpc && foundWithoutNpc) break;
  }
  if (foundWithNpc && foundWithoutNpc) break;
}
assert(foundWithNpc, 'some chunks can spawn a rabbit');
assert(foundWithoutNpc, 'rabbit spawn is not guaranteed in every chunk');

const npc = foundWithNpc.npcs.find((entry) => entry.type === 'RABBIT');
assertEqual(npc.type, 'RABBIT', 'descriptor type is RABBIT');
assertEqual(npc.index, 0, 'descriptor index is 0');
assert(Number.isInteger(npc.localTileX), 'localTileX is integer');
assert(Number.isInteger(npc.localTileY), 'localTileY is integer');
assert(npc.localTileX >= 0 && npc.localTileX < ChunkMath.CHUNK_SIZE, 'localTileX inside chunk');
assert(npc.localTileY >= 0 && npc.localTileY < ChunkMath.CHUNK_SIZE, 'localTileY inside chunk');

const objectKeys = new Set(
  foundWithNpc.objects.map((object) => `${object.localTileX},${object.localTileY}`)
);
assert(
  !objectKeys.has(`${npc.localTileX},${npc.localTileY}`),
  'npc tile does not overlap TREE/ROCK'
);

const npcId = buildChunkNpcId(
  foundWithNpc.chunkX,
  foundWithNpc.chunkY,
  npc.type,
  npc.index
);
assertEqual(
  npcId,
  `chunk_${foundWithNpc.chunkX}_${foundWithNpc.chunkY}_NPC_RABBIT_${npc.index}`,
  'stable id matches descriptor'
);

const startChunk = ChunkGenerator.generate(npcSeed, 0, 0);
const clearMin = 5;
const clearMax = 11;
startChunk.npcs.forEach((entry) => {
  const inClear = entry.localTileX >= clearMin && entry.localTileX <= clearMax
    && entry.localTileY >= clearMin && entry.localTileY <= clearMax;
  assert(!inClear, 'start clear zone has no npc');
});

const ids = foundWithNpc.npcs.map((entry) => (
  buildChunkNpcId(foundWithNpc.chunkX, foundWithNpc.chunkY, entry.type, entry.index)
));
assertEqual(new Set(ids).size, ids.length, 'no duplicate npc ids inside chunk');

const negativeChunk = ChunkGenerator.generate(npcSeed, -3, -2);
assert(Array.isArray(negativeChunk.npcs), 'negative chunk coordinates support npcs array');
assert(negativeChunk.npcs.length <= 7, 'negative chunk also at most seven npcs');
assert(countType(negativeChunk.npcs, 'RABBIT') <= 1, 'negative chunk at most one rabbit');
assert(countType(negativeChunk.npcs, 'PIG') <= 1, 'negative chunk at most one pig');
assert(countType(negativeChunk.npcs, 'LLAMA') <= 1, 'negative chunk at most one llama');
assert(countType(negativeChunk.npcs, 'BUFFALO') <= 1, 'negative chunk at most one buffalo');
assert(countType(negativeChunk.npcs, 'TALL_MONSTER') <= 1, 'negative chunk at most one tall monster');
assert(countType(negativeChunk.npcs, 'ELECTRICMAN') <= 1, 'negative chunk at most one electricman');
assert(countType(negativeChunk.npcs, 'BOWMAN') <= 1, 'negative chunk at most one bowman');

// TREE/ROCK object stream must remain independent of NPC stream.
const objectsOnlyA = ChunkGenerator.generate(111, 5, 5).objects;
const objectsOnlyB = ChunkGenerator.generate(111, 5, 5).objects;
assertEqual(JSON.stringify(objectsOnlyA), JSON.stringify(objectsOnlyB), 'object layout remains stable');

console.log('test-npc-core: ok');
