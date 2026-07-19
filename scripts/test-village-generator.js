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
  Infinity,
  JSON,
  exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}\n;exports.ChunkMath = ChunkMath; exports.SeededRandom = SeededRandom;`
  + ' exports.RiverGenerator = RiverGenerator; exports.VillageGenerator = VillageGenerator;'
  + ' exports.ChunkGenerator = ChunkGenerator;',
  context,
  { filename: 'village-bundle.js' }
);

const { ChunkMath, RiverGenerator, VillageGenerator, ChunkGenerator } = context.exports;
const SIZE = ChunkMath.CHUNK_SIZE;
const REGION_SIZE = VillageGenerator.REGION_SIZE;
const SPAN = REGION_SIZE * SIZE;

const SEEDS = [11, 4242, 20260718, 987654321, 5, 99, 123456];

// Helper: iterate region coords in a bounded window (skipping the start region).
function forEachRegion(fn, minR = -3, maxR = 4) {
  for (let ry = minR; ry <= maxR; ry += 1) {
    for (let rx = minR; rx <= maxR; rx += 1) {
      if (rx === 0 && ry === 0) continue;
      fn(rx, ry);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Determinism and query-order independence (incl. negative coords).
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  const a = JSON.stringify(VillageGenerator.getVillageForRegion(seed, 2, -3));
  // Query unrelated regions in between to defeat any order-dependent cache bug.
  VillageGenerator.getVillageForRegion(seed, -1, 5);
  VillageGenerator.getVillageForRegion(999, 2, -3);
  const b = JSON.stringify(VillageGenerator.getVillageForRegion(seed, 2, -3));
  assertEqual(a, b, 'village deterministic and order-independent');

  // Negative region coordinates resolve and are stable.
  const neg1 = JSON.stringify(VillageGenerator.getVillageForRegion(seed, -2, -2));
  const neg2 = JSON.stringify(VillageGenerator.getVillageForRegion(seed, -2, -2));
  assertEqual(neg1, neg2, 'negative region deterministic');
}

// ---------------------------------------------------------------------------
// 2. Probability ~25% per region; start region is always empty.
// ---------------------------------------------------------------------------
{
  SEEDS.forEach((seed) => {
    assertEqual(VillageGenerator.getVillageForRegion(seed, 0, 0), null, 'start region has no village');
  });

  let villages = 0;
  let total = 0;
  SEEDS.forEach((seed) => {
    forEachRegion((rx, ry) => {
      total += 1;
      if (VillageGenerator.getVillageForRegion(seed, rx, ry)) villages += 1;
    });
  });
  const ratio = villages / total;
  assert(villages > 0, 'some villages exist');
  assert(villages < total, 'some regions have no village');
  assert(ratio > 0.10 && ratio < 0.45, `village ratio ~0.25 (got ${ratio.toFixed(3)} over ${total})`);
}

// ---------------------------------------------------------------------------
// Collect a representative sample of actual villages across seeds/regions.
// ---------------------------------------------------------------------------
const sampleVillages = [];
SEEDS.forEach((seed) => {
  forEachRegion((rx, ry) => {
    const village = VillageGenerator.getVillageForRegion(seed, rx, ry);
    if (village) sampleVillages.push({ seed, rx, ry, village });
  }, -4, 5);
});
assert(sampleVillages.length >= 10, `enough villages sampled (got ${sampleVillages.length})`);

// ---------------------------------------------------------------------------
// 3. Composition, footprints, ids, reserved zone geometry, owner chunk.
// ---------------------------------------------------------------------------
{
  sampleVillages.forEach(({ seed, rx, ry, village }) => {
    assertEqual(village.villageId, `village_${rx}_${ry}`, 'villageId format');
    assert(village.orientation >= 0 && village.orientation <= 3, 'orientation in 0..3');

    const byType = {};
    village.descriptors.forEach((d) => {
      byType[d.type] = (byType[d.type] || 0) + 1;
    });
    assertEqual(byType.VILLAGE_HOUSE, 3, '3 houses');
    assertEqual(byType.VILLAGE_WAREHOUSE, 1, '1 warehouse');
    assertEqual(byType.VILLAGE_CAMPFIRE, 1, '1 campfire');
    assertEqual(byType.VILLAGE_CHEST, 2, '2 chests');
    assertEqual(village.descriptors.length, 7, 'exactly 7 descriptors');

    // Unique, stable, format-correct ids.
    const ids = new Set();
    village.descriptors.forEach((d) => {
      const short = {
        VILLAGE_HOUSE: 'HOUSE',
        VILLAGE_WAREHOUSE: 'WAREHOUSE',
        VILLAGE_CAMPFIRE: 'CAMPFIRE',
        VILLAGE_CHEST: 'CHEST'
      }[d.type];
      assertEqual(d.id, `village_${rx}_${ry}_${short}_${d.index}`, 'descriptor id format');
      assert(!ids.has(d.id), 'descriptor id unique');
      ids.add(d.id);
    });

    // Reserved zone geometry: 18x16 (content 16x14 + 1 tile margin each side).
    const r = village.reservedRect;
    assertEqual(r.maxTileX - r.minTileX + 1, village.contentWidth + 2, 'reserved width = content + 2*margin');
    assertEqual(r.maxTileY - r.minTileY + 1, village.contentHeight + 2, 'reserved height = content + 2*margin');

    // Reserved zone fully inside its region interior (so adjacent regions never touch).
    const regMinX = rx * SPAN;
    const regMinY = ry * SPAN;
    assert(r.minTileX > regMinX && r.maxTileX < regMinX + SPAN - 1, 'reserved rect inside region X');
    assert(r.minTileY > regMinY && r.maxTileY < regMinY + SPAN - 1, 'reserved rect inside region Y');

    // Every footprint tile lies inside the reserved rect; owner chunk is stable
    // and matches the anchor tile; footprints do not overlap.
    const footprintKeys = new Set();
    village.descriptors.forEach((d) => {
      let minTx = Infinity;
      let minTy = Infinity;
      d.footprint.forEach((t) => {
        assert(t.tileX >= r.minTileX && t.tileX <= r.maxTileX, 'footprint tile inside reserved X');
        assert(t.tileY >= r.minTileY && t.tileY <= r.maxTileY, 'footprint tile inside reserved Y');
        const key = `${t.tileX},${t.tileY}`;
        assert(!footprintKeys.has(key), 'footprints do not overlap');
        footprintKeys.add(key);
        if (t.tileX < minTx) minTx = t.tileX;
        if (t.tileY < minTy) minTy = t.tileY;
      });
      assertEqual(d.anchor.tileX, minTx, 'anchor is min footprint tileX');
      assertEqual(d.anchor.tileY, minTy, 'anchor is min footprint tileY');
      const ownerChunk = ChunkMath.tileToChunk(d.anchor.tileX, d.anchor.tileY);
      assertEqual(d.ownerChunk.chunkX, ownerChunk.chunkX, 'owner chunkX from anchor');
      assertEqual(d.ownerChunk.chunkY, ownerChunk.chunkY, 'owner chunkY from anchor');
    });

    // Passages: open tiles within the reserved rect form one connected region and
    // every footprint tile touches at least one open tile (buildings reachable).
    const openTiles = [];
    const openSet = new Set();
    for (let ty = r.minTileY; ty <= r.maxTileY; ty += 1) {
      for (let tx = r.minTileX; tx <= r.maxTileX; tx += 1) {
        const key = `${tx},${ty}`;
        if (!footprintKeys.has(key)) {
          openTiles.push({ tx, ty });
          openSet.add(key);
        }
      }
    }
    assert(openTiles.length > 0, 'has open tiles');
    // Flood fill from the first open tile.
    const seen = new Set();
    const stack = [openTiles[0]];
    seen.add(`${openTiles[0].tx},${openTiles[0].ty}`);
    while (stack.length) {
      const { tx, ty } = stack.pop();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nk = `${tx + dx},${ty + dy}`;
        if (openSet.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push({ tx: tx + dx, ty: ty + dy });
        }
      });
    }
    assertEqual(seen.size, openTiles.length, 'all open tiles connected (passages exist)');

    // Each structure (not each tile) must be reachable: at least one of its
    // footprint tiles borders an open tile. Solid building interiors are fine.
    village.descriptors.forEach((d) => {
      const reachable = d.footprint.some((t) => (
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
          ([dx, dy]) => openSet.has(`${t.tileX + dx},${t.tileY + dy}`)
        )
      ));
      assert(reachable, `structure ${d.id} borders an open passage`);
    });

    // Reserved zone is on land, out of water and out of the start safe zone.
    for (let ty = r.minTileY; ty <= r.maxTileY; ty += 1) {
      for (let tx = r.minTileX; tx <= r.maxTileX; tx += 1) {
        assert(!RiverGenerator.isWaterTile(seed, tx, ty), 'reserved tile not water');
        assert(!RiverGenerator.isInSafeZone(tx, ty), 'reserved tile not in safe zone');
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 3b. Facade direction: houses and the warehouse face the village centre.
// ---------------------------------------------------------------------------
function footprintCenter(footprint) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  footprint.forEach((t) => {
    if (t.tileX < minX) minX = t.tileX;
    if (t.tileY < minY) minY = t.tileY;
    if (t.tileX > maxX) maxX = t.tileX;
    if (t.tileY > maxY) maxY = t.tileY;
  });
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function expectedFacing(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'WEST' : 'EAST';
  if (dy !== 0) return dy > 0 ? 'NORTH' : 'SOUTH';
  if (dx !== 0) return dx > 0 ? 'WEST' : 'EAST';
  return 'SOUTH';
}

{
  const valid = new Set(['NORTH', 'EAST', 'SOUTH', 'WEST']);
  let sawNorth = false;
  let sawSouth = false;
  sampleVillages.forEach(({ seed, rx, ry, village }) => {
    const campfire = village.descriptors.find((d) => d.type === 'VILLAGE_CAMPFIRE');
    assert(campfire, 'village has a campfire centre');
    const center = footprintCenter(campfire.footprint);

    // Determinism of facing across repeated queries.
    const again = VillageGenerator.getVillageForRegion(seed, rx, ry);
    village.descriptors.forEach((d, i) => {
      assertEqual(d.facing, again.descriptors[i].facing, 'facing deterministic');
    });

    village.descriptors.forEach((d) => {
      if (d.type === 'VILLAGE_HOUSE' || d.type === 'VILLAGE_WAREHOUSE') {
        assert(valid.has(d.facing), `building facing is valid direction (${d.facing})`);
        const c = footprintCenter(d.footprint);
        const want = expectedFacing(c.x - center.x, c.y - center.y);
        assertEqual(d.facing, want, `facing points toward centre for ${d.id}`);

        // Schema regression: the facade side must lie between the building and
        // the centre on the chosen dominant axis.
        if (d.facing === 'NORTH') { assert(c.y > center.y, 'NORTH => building south of centre'); sawNorth = true; }
        if (d.facing === 'SOUTH') { assert(c.y < center.y, 'SOUTH => building north of centre'); sawSouth = true; }
        if (d.facing === 'EAST') assert(c.x < center.x, 'EAST => building west of centre');
        if (d.facing === 'WEST') assert(c.x > center.x, 'WEST => building east of centre');
      } else {
        assertEqual(d.facing, null, 'campfire/chest have no facade direction');
      }
    });
  });
  // The compact template always has buildings both north and south of centre.
  assert(sawNorth && sawSouth, 'facades exercise both vertical directions');
}

// ---------------------------------------------------------------------------
// 4. isReservedTile / findVillageAtTile consistency and cross-chunk descriptor
//    partitioning by owner chunk.
// ---------------------------------------------------------------------------
{
  sampleVillages.forEach(({ seed, rx, ry, village }) => {
    const r = village.reservedRect;
    // Inside reserved rect => reserved; just outside on all four sides => not.
    assert(VillageGenerator.isReservedTile(seed, r.minTileX, r.minTileY), 'reserved corner is reserved');
    assert(VillageGenerator.isReservedTile(seed, r.maxTileX, r.maxTileY), 'reserved far corner is reserved');
    assert(!VillageGenerator.isReservedTile(seed, r.minTileX - 1, r.minTileY), 'outside left not reserved');
    assert(!VillageGenerator.isReservedTile(seed, r.maxTileX + 1, r.maxTileY), 'outside right not reserved');

    const found = VillageGenerator.findVillageAtTile(seed, r.minTileX, r.minTileY);
    assert(found && found.villageId === village.villageId, 'findVillageAtTile returns owning village');

    // Owner-chunk partition: union of per-chunk descriptors == all descriptors,
    // each exactly once. Scan every chunk of the region.
    const collected = new Set();
    for (let cy = ry * REGION_SIZE; cy < (ry + 1) * REGION_SIZE; cy += 1) {
      for (let cx = rx * REGION_SIZE; cx < (rx + 1) * REGION_SIZE; cx += 1) {
        const owned = VillageGenerator.getVillageDescriptorsForChunk(seed, cx, cy);
        owned.forEach((d) => {
          assert(!collected.has(d.id), 'descriptor owned by exactly one chunk');
          collected.add(d.id);
          assertEqual(d.ownerChunk.chunkX, cx, 'descriptor owner chunkX matches query');
          assertEqual(d.ownerChunk.chunkY, cy, 'descriptor owner chunkY matches query');
        });
      }
    }
    assertEqual(collected.size, village.descriptors.length, 'all descriptors partitioned by owner chunk');
  });
}

// ---------------------------------------------------------------------------
// 5. ChunkGenerator reserved-mask integration: nothing generates inside a
//    village reserved zone (TREE/ROCK/berry/NPC), across the whole village.
// ---------------------------------------------------------------------------
{
  sampleVillages.slice(0, 8).forEach(({ seed, rx, ry, village }) => {
    for (let cy = ry * REGION_SIZE; cy < (ry + 1) * REGION_SIZE; cy += 1) {
      for (let cx = rx * REGION_SIZE; cx < (rx + 1) * REGION_SIZE; cx += 1) {
        const chunk = ChunkGenerator.generate(seed, cx, cy);
        const check = (entry) => {
          const world = ChunkMath.chunkLocalToWorldTile(cx, cy, entry.localTileX, entry.localTileY);
          assert(
            !VillageGenerator.isReservedTile(seed, world.tileX, world.tileY),
            `no world content inside reserved zone (${world.tileX},${world.tileY})`
          );
        };
        chunk.objects.forEach(check);
        chunk.npcs.forEach(check);
        chunk.water.forEach(check);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 6. Old streams/chances unchanged: source strings intact AND behavioral proof
//    that toggling the village only removes reserved cells (no RNG shift).
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(src.includes("'chunk-objects'"), 'chunk-objects stream intact');
  assert(src.includes("'chunk-npcs'"), 'chunk-npcs stream intact');
  assert(src.includes("'chunk-npcs-pig'"), 'pig stream intact');
  assert(src.includes("'chunk-npcs-llama'"), 'llama stream intact');
  assert(src.includes("'chunk-npcs-buffalo'"), 'buffalo stream intact');
  assert(src.includes("'chunk-enemies-tall-monster'"), 'tall monster stream intact');
  assert(src.includes("'chunk-enemies-electricman'"), 'electricman stream intact');
  assert(src.includes("'chunk-enemies-bowman'"), 'bowman stream intact');
  assert(src.includes("'chunk-berry-bushes'"), 'berry stream intact');
  assert(/npcRng\.next\(\)\s*<\s*0\.35/.test(src), 'rabbit chance intact');
  assert(/pigRng\.next\(\)\s*<\s*0\.14/.test(src), 'pig chance intact');
  assert(/bowmanRng\.next\(\)\s*<\s*0\.10/.test(src), 'bowman chance intact');

  // Behavioral: pick a village region, compare village-on vs village-off runs.
  const { seed, rx, ry, village } = sampleVillages[0];
  const reserved = new Set();
  const r = village.reservedRect;
  for (let ty = r.minTileY; ty <= r.maxTileY; ty += 1) {
    for (let tx = r.minTileX; tx <= r.maxTileX; tx += 1) {
      reserved.add(`${tx},${ty}`);
    }
  }

  const coords = [];
  for (let cy = ry * REGION_SIZE; cy < (ry + 1) * REGION_SIZE; cy += 1) {
    for (let cx = rx * REGION_SIZE; cx < (rx + 1) * REGION_SIZE; cx += 1) {
      coords.push([cx, cy]);
    }
  }

  const onChunks = coords.map(([cx, cy]) => ChunkGenerator.generate(seed, cx, cy));
  const originalIsReserved = VillageGenerator.isReservedTile;
  VillageGenerator.isReservedTile = () => false;
  const offChunks = coords.map(([cx, cy]) => ChunkGenerator.generate(seed, cx, cy));
  VillageGenerator.isReservedTile = originalIsReserved;

  let objectsOmitted = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const [cx, cy] = coords[i];
    const on = onChunks[i];
    const off = offChunks[i];
    const worldKey = (e) => {
      const w = ChunkMath.chunkLocalToWorldTile(cx, cy, e.localTileX, e.localTileY);
      return `${w.tileX},${w.tileY}`;
    };
    const offObjectsKept = off.objects.filter((o) => !reserved.has(worldKey(o)));
    assertEqual(
      JSON.stringify(on.objects),
      JSON.stringify(offObjectsKept),
      `objects outside reserved unchanged for chunk ${cx},${cy}`
    );
    objectsOmitted += off.objects.length - offObjectsKept.length;

    const offNpcsKept = off.npcs.filter((n) => !reserved.has(worldKey(n)));
    assertEqual(
      JSON.stringify(on.npcs),
      JSON.stringify(offNpcsKept),
      `npcs outside reserved unchanged for chunk ${cx},${cy}`
    );
  }
  assert(objectsOmitted >= 0, 'omission count non-negative');
}

console.log('test-village-generator: ok');
