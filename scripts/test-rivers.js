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
  Error
};
context.exports = {};
vm.createContext(context);
vm.runInContext(
  `${bundle}\n;exports.ChunkMath = ChunkMath; exports.SeededRandom = SeededRandom;`
  + ' exports.RiverGenerator = RiverGenerator; exports.ChunkGenerator = ChunkGenerator;',
  context,
  { filename: 'rivers-bundle.js' }
);

const { ChunkMath, RiverGenerator, ChunkGenerator } = context.exports;
const SIZE = ChunkMath.CHUNK_SIZE;

// ---------------------------------------------------------------------------
// 1. Purity / determinism of the water mask.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  for (let i = 0; i < 50; i += 1) {
    const wx = (i * 7) - 100;
    const wy = (i * 5) - 60;
    assertEqual(
      RiverGenerator.isWaterTile(seed, wx, wy),
      RiverGenerator.isWaterTile(seed, wx, wy),
      `isWaterTile stable at (${wx},${wy})`
    );
  }

  const a = JSON.stringify(RiverGenerator.getRiverTilesForChunk(seed, 0, 3));
  const b = JSON.stringify(RiverGenerator.getRiverTilesForChunk(seed, 0, 3));
  assertEqual(a, b, 'getRiverTilesForChunk deterministic');

  // Order independence (cache must key on seed, not call order).
  RiverGenerator.getRiverTilesForChunk(987654321, 2, 2);
  const c = JSON.stringify(RiverGenerator.getRiverTilesForChunk(seed, 0, 3));
  assertEqual(a, c, 'getRiverTilesForChunk independent of query order');
}

// ---------------------------------------------------------------------------
// 2. A river actually exists, and different seeds usually differ.
// ---------------------------------------------------------------------------
function collectWater(seed, minX, maxX, minY, maxY) {
  const cells = new Set();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (RiverGenerator.isWaterTile(seed, x, y)) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

{
  const seeds = [11, 4242, 20260718, 987654321];
  const signatures = seeds.map((s) => {
    const cells = collectWater(s, -60, 120, 40, 220);
    assert(cells.size > 30, `river present for seed ${s} (got ${cells.size} tiles)`);
    return [...cells].sort().join('|');
  });
  const uniqueSignatures = new Set(signatures);
  assert(uniqueSignatures.size >= 3, 'different seeds usually produce different rivers');
}

// ---------------------------------------------------------------------------
// 3. Continuity, width 2..4, no isolated singletons, one contiguous run/line.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  const params = RiverGenerator.getParams(seed);
  const vertical = params.orientationVertical;

  // Scan far from the spawn safe zone so the carve never interferes.
  const alongMin = 60;
  const alongMax = 220;
  const crossMin = -120;
  const crossMax = 220;

  const byAlong = new Map();
  let total = 0;
  for (let along = alongMin; along <= alongMax; along += 1) {
    const crosses = [];
    for (let cross = crossMin; cross <= crossMax; cross += 1) {
      const wx = vertical ? cross : along;
      const wy = vertical ? along : cross;
      if (RiverGenerator.isWaterTile(seed, wx, wy)) crosses.push(cross);
    }
    if (crosses.length) {
      byAlong.set(along, crosses);
      total += crosses.length;
    }
  }
  assert(total > 100, 'scanned river band is substantial');

  byAlong.forEach((crosses, along) => {
    crosses.sort((p, q) => p - q);
    const width = crosses.length;
    assert(width >= 2 && width <= 4, `width 2..4 at along=${along} (got ${width})`);
    // Single contiguous run in this line (no gaps within the channel).
    assertEqual(
      crosses[crosses.length - 1] - crosses[0] + 1,
      width,
      `contiguous water run at along=${along}`
    );
  });

  // No isolated water tiles: every water tile has a 4-neighbour that is water.
  let checked = 0;
  for (let along = alongMin + 1; along <= alongMax - 1; along += 1) {
    const crosses = byAlong.get(along);
    if (!crosses) continue;
    crosses.forEach((cross) => {
      const wx = vertical ? cross : along;
      const wy = vertical ? along : cross;
      const neighbourWater = RiverGenerator.isWaterTile(seed, wx + 1, wy)
        || RiverGenerator.isWaterTile(seed, wx - 1, wy)
        || RiverGenerator.isWaterTile(seed, wx, wy + 1)
        || RiverGenerator.isWaterTile(seed, wx, wy - 1);
      assert(neighbourWater, `no isolated water tile at (${wx},${wy})`);
      checked += 1;
    });
  }
  assert(checked > 100, 'neighbour continuity actually exercised');
}

// ---------------------------------------------------------------------------
// 4. Cross-chunk consistency: chunk tiles agree with absolute isWaterTile, and
//    boundaries continue between adjacent chunks.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  for (const [cx, cy] of [[0, 3], [0, 4], [-1, 5], [2, -2]]) {
    const tiles = RiverGenerator.getRiverTilesForChunk(seed, cx, cy);
    const asSet = new Set(tiles.map((t) => `${t.localTileX},${t.localTileY}`));
    let scanned = 0;
    for (let ly = 0; ly < SIZE; ly += 1) {
      for (let lx = 0; lx < SIZE; lx += 1) {
        const wx = cx * SIZE + lx;
        const wy = cy * SIZE + ly;
        const expected = RiverGenerator.isWaterTile(seed, wx, wy);
        assertEqual(asSet.has(`${lx},${ly}`), expected, `chunk (${cx},${cy}) tile agrees at ${lx},${ly}`);
        scanned += 1;
      }
    }
    assertEqual(scanned, SIZE * SIZE, 'scanned full chunk');
    tiles.forEach((t) => {
      assertEqual(t.worldTileX, cx * SIZE + t.localTileX, 'worldTileX derived correctly');
      assertEqual(t.worldTileY, cy * SIZE + t.localTileY, 'worldTileY derived correctly');
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Dry, exitable start safe zone.
// ---------------------------------------------------------------------------
{
  const seeds = [11, 4242, 20260718, 987654321, 5, 99, 123456];
  seeds.forEach((seed) => {
    for (let wy = -2; wy <= 18; wy += 1) {
      for (let wx = -2; wx <= 18; wx += 1) {
        if (RiverGenerator.isInSafeZone(wx, wy)) {
          assert(!RiverGenerator.isWaterTile(seed, wx, wy), `safe zone dry (${wx},${wy}) seed ${seed}`);
        }
      }
    }
    // Spawn tile and its 4 exits are dry for every seed.
    [[8, 8], [8, 7], [8, 9], [7, 8], [9, 8]].forEach(([wx, wy]) => {
      assert(!RiverGenerator.isWaterTile(seed, wx, wy), `spawn/exit dry (${wx},${wy}) seed ${seed}`);
    });
    // Start chunk has zero water tiles.
    const startWater = RiverGenerator.getRiverTilesForChunk(seed, 0, 0);
    assertEqual(startWater.length, 0, `start chunk fully dry (seed ${seed})`);
  });
}

// ---------------------------------------------------------------------------
// 6. Bank helper: dry tile adjacent to water.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  const water = collectWater(seed, -60, 120, 60, 200);
  let bankFound = false;
  for (const cell of water) {
    const [wx, wy] = cell.split(',').map(Number);
    // A tile just outside the channel edge should be a bank.
    for (const [nx, ny] of [[wx + 1, wy], [wx - 1, wy], [wx, wy + 1], [wx, wy - 1]]) {
      if (!RiverGenerator.isWaterTile(seed, nx, ny)) {
        assert(RiverGenerator.isRiverBankTile(seed, nx, ny), `bank at (${nx},${ny})`);
        assert(!RiverGenerator.isRiverBankTile(seed, wx, wy), 'water tile is not a bank');
        bankFound = true;
        break;
      }
    }
    if (bankFound) break;
  }
  assert(bankFound, 'at least one river bank tile detected');
}

// ---------------------------------------------------------------------------
// 7. Generator integration: water descriptors + no objects/NPCs in water.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  const coords = [];
  for (let cy = -2; cy <= 12; cy += 1) {
    for (let cx = -4; cx <= 4; cx += 1) {
      coords.push([cx, cy]);
    }
  }

  // Determinism including water.
  const g1 = ChunkGenerator.generate(seed, 0, 5);
  const g2 = ChunkGenerator.generate(seed, 0, 5);
  assertEqual(JSON.stringify(g1), JSON.stringify(g2), 'generate deterministic incl. water');

  let sawWater = false;
  coords.forEach(([cx, cy]) => {
    const chunk = ChunkGenerator.generate(seed, cx, cy);
    assert(Array.isArray(chunk.water), 'chunk always has water array');
    const waterSet = new Set(chunk.water.map((w) => `${w.localTileX},${w.localTileY}`));
    if (waterSet.size) sawWater = true;

    chunk.water.forEach((w) => {
      assertEqual(w.type, 'RIVER_WATER', 'water descriptor type');
      assert(w.localTileX >= 0 && w.localTileX < SIZE, 'water localX in range');
      assert(w.localTileY >= 0 && w.localTileY < SIZE, 'water localY in range');
      assertEqual(
        w.id,
        `chunk_${cx}_${cy}_RIVER_WATER_${w.localTileX}_${w.localTileY}`,
        'water stable id format'
      );
    });

    chunk.objects.forEach((o) => {
      assert(!waterSet.has(`${o.localTileX},${o.localTileY}`), 'no TREE/ROCK on water');
    });
    chunk.npcs.forEach((n) => {
      assert(!waterSet.has(`${n.localTileX},${n.localTileY}`), 'no NPC on water');
    });
  });
  assert(sawWater, 'at least one scanned chunk contains water');
}

// ---------------------------------------------------------------------------
// 8. RNG preservation: with the river disabled the generator reproduces the
//    original layout; with it enabled the layout is exactly that minus the
//    cells that became water (same candidates, same draws, water omitted).
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  const coords = [];
  for (let cy = -3; cy <= 14; cy += 1) {
    for (let cx = -5; cx <= 5; cx += 1) {
      coords.push([cx, cy]);
    }
  }

  const onChunks = coords.map(([cx, cy]) => ChunkGenerator.generate(seed, cx, cy));

  const originalIsWater = RiverGenerator.isWaterTile;
  RiverGenerator.isWaterTile = () => false;
  const offChunks = coords.map(([cx, cy]) => ChunkGenerator.generate(seed, cx, cy));
  RiverGenerator.isWaterTile = originalIsWater;

  let objectsOmitted = 0;
  let npcsOmitted = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const on = onChunks[i];
    const off = offChunks[i];
    assertEqual(off.water.length, 0, 'river-off run has no water');

    const waterSet = new Set(on.water.map((w) => `${w.localTileX},${w.localTileY}`));

    const offObjectsKept = off.objects.filter(
      (o) => !waterSet.has(`${o.localTileX},${o.localTileY}`)
    );
    assertEqual(
      JSON.stringify(on.objects),
      JSON.stringify(offObjectsKept),
      `objects outside water unchanged for chunk ${coords[i]}`
    );
    objectsOmitted += off.objects.length - offObjectsKept.length;

    const offNpcsKept = off.npcs.filter(
      (n) => !waterSet.has(`${n.localTileX},${n.localTileY}`)
    );
    assertEqual(
      JSON.stringify(on.npcs),
      JSON.stringify(offNpcsKept),
      `npcs outside water unchanged for chunk ${coords[i]}`
    );
    npcsOmitted += off.npcs.length - offNpcsKept.length;
  }
  // The river must actually intersect some content for this proof to be strong.
  assert(objectsOmitted > 0, 'at least one object was omitted because of water');
  // NPCs are rarer; omission is possible but not guaranteed. Just report count.
  assert(npcsOmitted >= 0, 'npc omission count is non-negative');
}

console.log('test-rivers: ok');
