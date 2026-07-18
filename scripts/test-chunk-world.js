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
  'src/world/ChunkGenerator.js'
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
  `${bundle}\n;exports.ChunkMath = ChunkMath; exports.SeededRandom = SeededRandom; exports.ChunkGenerator = ChunkGenerator;`,
  context,
  { filename: 'chunk-world-bundle.js' }
);

const { ChunkMath, SeededRandom, ChunkGenerator } = context.exports;

const tileCases = [
  { tile: 0, chunk: 0 },
  { tile: 15, chunk: 0 },
  { tile: 16, chunk: 1 },
  { tile: -1, chunk: -1 },
  { tile: -16, chunk: -1 },
  { tile: -17, chunk: -2 }
];

tileCases.forEach(({ tile, chunk }) => {
  const mapped = ChunkMath.tileToChunk(tile, tile);
  assertEqual(mapped.chunkX, chunk, `tile ${tile} -> chunkX`);
  assertEqual(mapped.chunkY, chunk, `tile ${tile} -> chunkY`);
});

[-17, -16, -1, 0, 15, 16, 31].forEach((tileX) => {
  [-17, -16, -1, 0, 15, 16].forEach((tileY) => {
    const local = ChunkMath.worldTileToLocal(tileX, tileY);
    const back = ChunkMath.chunkLocalToWorldTile(
      local.chunkX,
      local.chunkY,
      local.localTileX,
      local.localTileY
    );
    assertEqual(back.tileX, tileX, 'round-trip tileX');
    assertEqual(back.tileY, tileY, 'round-trip tileY');
    assert(local.localTileX >= 0 && local.localTileX <= 15, 'localTileX range');
    assert(local.localTileY >= 0 && local.localTileY <= 15, 'localTileY range');
  });
});

const seedA = 123456789;
const seedB = 987654321;
const first = ChunkGenerator.generate(seedA, 1, -1);
const second = ChunkGenerator.generate(seedA, 1, -1);
assertEqual(JSON.stringify(first), JSON.stringify(second), 'same seed/chunk is deterministic');

const otherSeed = ChunkGenerator.generate(seedB, 1, -1);
assert(JSON.stringify(first) !== JSON.stringify(otherSeed), 'different seed changes chunk');

const orderA = [
  ChunkGenerator.generate(seedA, 0, 0),
  ChunkGenerator.generate(seedA, 1, 0),
  ChunkGenerator.generate(seedA, 0, 1)
];
const orderB = [
  ChunkGenerator.generate(seedA, 0, 1),
  ChunkGenerator.generate(seedA, 0, 0),
  ChunkGenerator.generate(seedA, 1, 0)
];
assertEqual(
  JSON.stringify(orderA.find((c) => c.chunkX === 0 && c.chunkY === 0)),
  JSON.stringify(orderB.find((c) => c.chunkX === 0 && c.chunkY === 0)),
  'order independence for (0,0)'
);
assertEqual(
  JSON.stringify(orderA.find((c) => c.chunkX === 1 && c.chunkY === 0)),
  JSON.stringify(orderB.find((c) => c.chunkX === 1 && c.chunkY === 0)),
  'order independence for (1,0)'
);

const samples = [
  ChunkGenerator.generate(seedA, 0, 0),
  ChunkGenerator.generate(seedA, -2, 3),
  ChunkGenerator.generate(seedA, 4, -1)
];

samples.forEach((chunk) => {
  assert(Array.isArray(chunk.npcs), 'chunk always has npcs array');
  assert(chunk.npcs.length <= 5, 'chunk has at most five npcs (passive + tall monster)');
  assert(
    chunk.npcs.filter((npc) => npc.type === 'RABBIT').length <= 1,
    'chunk has at most one rabbit'
  );
  assert(
    chunk.npcs.filter((npc) => npc.type === 'PIG').length <= 1,
    'chunk has at most one pig'
  );
  assert(
    chunk.npcs.filter((npc) => npc.type === 'LLAMA').length <= 1,
    'chunk has at most one llama'
  );
  assert(
    chunk.npcs.filter((npc) => npc.type === 'BUFFALO').length <= 1,
    'chunk has at most one buffalo'
  );
  assert(
    chunk.npcs.filter((npc) => npc.type === 'TALL_MONSTER').length <= 1,
    'chunk has at most one tall monster'
  );
  const occupied = new Set();
  chunk.objects.forEach((object) => {
    assert(object.localTileX >= 0 && object.localTileX <= 15, 'object localX');
    assert(object.localTileY >= 0 && object.localTileY <= 15, 'object localY');
    const key = `${object.localTileX},${object.localTileY}`;
    assert(!occupied.has(key), 'no overlapping blocking objects');
    occupied.add(key);
  });
  chunk.npcs.forEach((npc) => {
    assert(
      npc.type === 'RABBIT'
      || npc.type === 'PIG'
      || npc.type === 'LLAMA'
      || npc.type === 'BUFFALO'
      || npc.type === 'TALL_MONSTER',
      'npc type is known peaceful or hostile type'
    );
    assert(Number.isInteger(npc.index) && npc.index >= 0, 'npc index');
    assert(npc.localTileX >= 0 && npc.localTileX <= 15, 'npc localX');
    assert(npc.localTileY >= 0 && npc.localTileY <= 15, 'npc localY');
    const key = `${npc.localTileX},${npc.localTileY}`;
    assert(!occupied.has(key), 'npc does not overlap TREE/ROCK or another npc');
    occupied.add(key);
  });
});

const start = ChunkGenerator.generate(seedA, 0, 0);
const clearMin = 5;
const clearMax = 11;
start.objects.forEach((object) => {
  const inClear = object.localTileX >= clearMin && object.localTileX <= clearMax
    && object.localTileY >= clearMin && object.localTileY <= clearMax;
  assert(!inClear, 'start clear zone must be free');
});
start.npcs.forEach((npc) => {
  const inClear = npc.localTileX >= clearMin && npc.localTileX <= clearMax
    && npc.localTileY >= clearMin && npc.localTileY <= clearMax;
  assert(!inClear, 'start clear zone must be free of npcs');
});
assert(start.spawnPoints.length > 0, 'start chunk has spawn');
assertEqual(start.spawnPoints[0].localTileX, 8, 'spawn localX');
assertEqual(start.spawnPoints[0].localTileY, 8, 'spawn localY');

const streamA = SeededRandom.fromParts(seedA, 2, -3, 'chunk-objects');
const streamB = SeededRandom.fromParts(seedA, 2, -3, 'chunk-objects');
assertEqual(streamA.next(), streamB.next(), 'SeededRandom stream stability');


const originCases = [
  { chunkX: 0, chunkY: 0, x: 0, y: 0 },
  { chunkX: 1, chunkY: 0, x: 512, y: 0 },
  { chunkX: -1, chunkY: 0, x: -512, y: 0 },
  { chunkX: -4, chunkY: -1, x: -2048, y: -512 }
];
originCases.forEach(({ chunkX, chunkY, x, y }) => {
  const origin = ChunkMath.chunkOriginWorld(chunkX, chunkY);
  assertEqual(origin.x, x, `origin (${chunkX},${chunkY}).x`);
  assertEqual(origin.y, y, `origin (${chunkX},${chunkY}).y`);
});

const local00 = ChunkMath.localTileCenterWorld(0, 0, 0, 0);
assertEqual(local00.x, 16, 'local (0,0) center x');
assertEqual(local00.y, 16, 'local (0,0) center y');
const local1515 = ChunkMath.localTileCenterWorld(0, 0, 15, 15);
assertEqual(local1515.x, 15 * 32 + 16, 'local (15,15) center x');
assertEqual(local1515.y, 15 * 32 + 16, 'local (15,15) center y');

const negLocal = ChunkMath.localTileCenterWorld(-1, 0, 0, 0);
assertEqual(negLocal.x, -512 + 16, 'neg chunk local center x');
const viaTiles = ChunkMath.chunkLocalToWorldTile(-1, 0, 0, 0);
assertEqual(
  viaTiles.tileX * 32 + 16,
  negLocal.x,
  'no double chunk offset'
);

const required = ChunkMath.requiredChunkKeys(-4, -1, 1);
assertEqual(required.length, 9, 'required key count');
assertEqual(new Set(required).size, 9, 'required keys unique');
assert(required.includes('-4,-1'), 'required contains center');
assert(required.includes('-5,-2'), 'required contains corner');
assert(required.includes('-3,0'), 'required contains opposite corner');

const previous = new Set(ChunkMath.requiredChunkKeys(-5, -1, 1));
const unload = [...previous].filter((key) => !required.includes(key));
unload.forEach((key) => {
  assert(!required.includes(key), 'unload set must not intersect required');
});

assertEqual(ChunkMath.CHUNK_TERRAIN_DEPTH, -1000000, 'terrain depth constant');
const sampleEntityDepth = (-512 + 20) * 0.1;
assert(sampleEntityDepth > ChunkMath.CHUNK_TERRAIN_DEPTH, 'entity depth stays above terrain at negative Y');
console.log('test-chunk-world: ok');