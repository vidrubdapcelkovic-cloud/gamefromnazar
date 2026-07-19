const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (expected ${expected}, got ${actual})`);
}

const bundle = [
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/RiverDebugLocator.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, Infinity, JSON, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.ChunkMath = ChunkMath;
;exports.RiverGenerator = RiverGenerator;
;exports.VillageGenerator = VillageGenerator;
;exports.ChunkGenerator = ChunkGenerator;
;exports.RiverDebugLocator = RiverDebugLocator;`,
  context,
  { filename: 'river-debug-bundle.js' }
);

const { ChunkMath, RiverGenerator, VillageGenerator, ChunkGenerator, RiverDebugLocator } = context.exports;
const TILE = ChunkMath.TILE_SIZE;

// Instrument RiverGenerator.isWaterTile to prove the locator uses it (production).
let isWaterCalls = 0;
const realIsWaterTile = RiverGenerator.isWaterTile.bind(RiverGenerator);
RiverGenerator.isWaterTile = function instrumented(seed, tileX, tileY) {
  isWaterCalls += 1;
  return realIsWaterTile(seed, tileX, tileY);
};

const seed = 20260719;

// ---------------------------------------------------------------------------
// 1. Locator uses production RiverGenerator and finds a real water tile.
// ---------------------------------------------------------------------------
{
  const before = isWaterCalls;
  const result = RiverDebugLocator.findNearestRiver(seed, 0, 0);
  assert(isWaterCalls > before, 'locator calls RiverGenerator.isWaterTile');
  assert(result, 'a river is found from origin');
  assert(realIsWaterTile(seed, result.tileX, result.tileY), 'found tile is actually water');
  // Result shape.
  assert(Number.isInteger(result.tileX) && Number.isInteger(result.tileY), 'tile coords are ints');
  assertEqual(result.worldX, result.tileX * TILE + TILE / 2, 'worldX is tile centre');
  assertEqual(result.worldY, result.tileY * TILE + TILE / 2, 'worldY is tile centre');
  assert(Number.isInteger(result.distanceTiles) && result.distanceTiles >= 0, 'distanceTiles int');
  assert(Number.isInteger(result.distanceChunks) && result.distanceChunks >= 0, 'distanceChunks int');
  assert(typeof result.direction === 'string' && result.direction.length > 0, 'direction present');
}

// ---------------------------------------------------------------------------
// 2. Deterministic: same seed + start -> identical result.
// ---------------------------------------------------------------------------
{
  const a = RiverDebugLocator.findNearestRiver(seed, 40, -80);
  const b = RiverDebugLocator.findNearestRiver(seed, 40, -80);
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'locator deterministic');
}

// ---------------------------------------------------------------------------
// 3. Negative coordinates supported.
// ---------------------------------------------------------------------------
{
  const result = RiverDebugLocator.findNearestRiver(seed, -5000, -7000);
  assert(result === null || realIsWaterTile(seed, result.tileX, result.tileY),
    'negative-coord result is null or real water');
  const again = RiverDebugLocator.findNearestRiver(seed, -5000, -7000);
  assertEqual(JSON.stringify(result), JSON.stringify(again), 'negative-coord deterministic');
}

// ---------------------------------------------------------------------------
// 4. Bounded radius: a tiny limit with no retry stops and can return null; the
//    found tile never exceeds the limit in Chebyshev tiles.
// ---------------------------------------------------------------------------
{
  // Start on a dry tile and search with a 0-tile radius, no retry.
  // Find a dry start first.
  let dryX = 0;
  let dryY = 0;
  outer:
  for (let ty = 0; ty < 50; ty += 1) {
    for (let tx = 0; tx < 50; tx += 1) {
      if (!realIsWaterTile(seed, tx, ty)) { dryX = tx; dryY = ty; break outer; }
    }
  }
  const startX = dryX * TILE + TILE / 2;
  const startY = dryY * TILE + TILE / 2;
  const zero = RiverDebugLocator.findNearestRiver(seed, startX, startY, { limit: 0, noRetry: true });
  assert(zero === null, 'radius 0 on a dry tile returns null (bounded, no retry)');

  const small = RiverDebugLocator.findNearestRiver(seed, startX, startY, { limit: 3, noRetry: true });
  if (small) assert(small.distanceTiles <= 3, 'result respects the tile limit');
}

// ---------------------------------------------------------------------------
// 5. Retry widens the search (256 -> 1024) only when allowed.
// ---------------------------------------------------------------------------
{
  const player = RiverDebugLocator.findNearestRiver(seed, 0, 0);
  assert(player, 'baseline river exists from origin');
  // Default call must find it (256 or retry 1024).
  assert(player.distanceTiles <= 1024, 'found within retry limit');
}

// ---------------------------------------------------------------------------
// 6. Safe shore: dry, has a cardinal water neighbour, within 1..3 tiles, and
//    clear of TREE/ROCK/berry and village footprints.
// ---------------------------------------------------------------------------
{
  const water = RiverDebugLocator.findNearestRiver(seed, 0, 0);
  const shore = RiverDebugLocator.findSafeShore(seed, water);
  assert(shore, 'a safe shore tile exists');

  // Deterministic.
  const shore2 = RiverDebugLocator.findSafeShore(seed, water);
  assertEqual(JSON.stringify(shore), JSON.stringify(shore2), 'safe shore deterministic');

  // Dry.
  assert(!realIsWaterTile(seed, shore.tileX, shore.tileY), 'shore tile is dry');

  // Has a cardinal (straight) water neighbour.
  const cardinalWater = realIsWaterTile(seed, shore.tileX + 1, shore.tileY)
    || realIsWaterTile(seed, shore.tileX - 1, shore.tileY)
    || realIsWaterTile(seed, shore.tileX, shore.tileY + 1)
    || realIsWaterTile(seed, shore.tileX, shore.tileY - 1);
  assert(cardinalWater, 'shore has a straight water neighbour');

  // Within 1..3 tiles (Chebyshev) of the found water tile.
  const cheb = Math.max(Math.abs(shore.tileX - water.tileX), Math.abs(shore.tileY - water.tileY));
  assert(cheb >= 1 && cheb <= 3, 'shore is 1..3 tiles from the river tile');

  // No TREE/ROCK/berry object at the shore tile (independent check via generator).
  const local = ChunkMath.worldTileToLocal(shore.tileX, shore.tileY);
  const chunk = ChunkGenerator.generate(seed, local.chunkX, local.chunkY);
  const blocked = chunk.objects.some((o) => o.localTileX === local.localTileX
    && o.localTileY === local.localTileY
    && (o.type === 'TREE' || o.type === 'ROCK' || o.type === 'BERRY_BUSH'));
  assert(!blocked, 'shore tile has no TREE/ROCK/berry');

  // Not on a village footprint.
  const region = VillageGenerator.regionOfTile(shore.tileX, shore.tileY);
  const village = VillageGenerator.getVillageForRegion(seed, region.regionX, region.regionY);
  if (village) {
    const onFootprint = village.descriptors.some((d) => d.footprint.some((t) => t.tileX === shore.tileX && t.tileY === shore.tileY));
    assert(!onFootprint, 'shore tile is not on a village footprint');
  }

  // Shore world position is the tile centre.
  assertEqual(shore.worldX, shore.tileX * TILE + TILE / 2, 'shore worldX = tile centre');
  assertEqual(shore.worldY, shore.tileY * TILE + TILE / 2, 'shore worldY = tile centre');

  // Teleport target must NOT be water (never teleport into the river).
  assert(!realIsWaterTile(seed, shore.tileX, shore.tileY), 'teleport target is not water');
}

// ---------------------------------------------------------------------------
// 7. Safe shore works from a negative-coordinate river tile too.
// ---------------------------------------------------------------------------
{
  const water = RiverDebugLocator.findNearestRiver(seed, -6000, -6000);
  if (water) {
    const shore = RiverDebugLocator.findSafeShore(seed, water);
    if (shore) {
      assert(!realIsWaterTile(seed, shore.tileX, shore.tileY), 'negative-coord shore is dry');
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Debug gating + no serialization + production untouched (source guards).
// ---------------------------------------------------------------------------
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(gameScene.includes('debugRiver'), 'GameScene reads ?debugRiver');
  assert(/isRiverDebugEnabled\(\)/.test(gameScene), 'enable guard helper present');
  assert(/initRiverDebug\(\)\s*{\s*if\s*\(!this\.isRiverDebugEnabled\(\)\)\s*return;/.test(gameScene),
    'initRiverDebug gated by flag');
  assert(/updateRiverDebug\(\)\s*{\s*if\s*\(!this\.isRiverDebugEnabled\(\)/.test(gameScene),
    'updateRiverDebug gated by flag');
  assert(/Phaser\.Input\.Keyboard\.KeyCodes\.R\b/.test(gameScene), 'R key registered (only inside gated init)');
  // Teleport must not touch stats/inventory/time/seed/save.
  const tpIdx = gameScene.indexOf('teleportToRiverShore()');
  const tpEnd = gameScene.indexOf('\n  }', tpIdx);
  const tpSlice = gameScene.slice(tpIdx, tpEnd);
  assert(!/playerStatsModel|inventoryModel|dayNightSystem|worldSeed\s*=|saveGame\(|this\.saveSystem\.save/.test(tpSlice),
    'teleport does not change HP/hunger/inventory/time/seed/save');

  // No debug field is serialized.
  const saveSrc = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
  assert(!/river|debug/i.test(saveSrc), 'SaveSystem has no river/debug fields');
  const createIdx = gameScene.indexOf('createSaveState()');
  if (createIdx !== -1) {
    const slice = gameScene.slice(createIdx, createIdx + 4000);
    assert(!/_riverDebug/.test(slice), 'createSaveState does not serialize debug state');
  }

  // Production water mechanic untouched.
  const water = fs.readFileSync(path.join(root, 'src/world/PlayerWaterState.js'), 'utf8');
  assert(/PLAYER_WATER_SPEED_MULTIPLIER\s*=\s*0\.55/.test(water), 'multiplier stays 0.55');
  const chunkInstance = fs.readFileSync(path.join(root, 'src/world/ChunkInstance.js'), 'utf8');
  assert(/chunkData && chunkData\.water/.test(chunkInstance), 'water still feeds npcBlockedCells');
  const locator = fs.readFileSync(path.join(root, 'src/world/RiverDebugLocator.js'), 'utf8');
  assert(!/isWaterTile\s*\([^)]*\)\s*{[\s\S]*center/.test(locator), 'locator does not reimplement the river algorithm');
}

console.log('test-river-debug-locator: ok');
