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
function assertClose(actual, expected, message, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${message} (expected ~${expected}, got ${actual})`);
}

// Same base speed as GameScene's PLAYER_SPEED (kept in sync intentionally).
const PLAYER_SPEED = 260;

const bundle = [
  'src/data/ItemCatalog.js',
  'src/data/BuildCatalog.js',
  'src/data/PassiveNpcConfig.js',
  'src/data/HostileNpcConfig.js',
  'src/systems/ChestStorageModel.js',
  'src/systems/DayNightSystem.js',
  'src/systems/SaveSystem.js',
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/PlayerWaterState.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
  'src/world/ChunkInstance.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, Infinity, JSON, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.ChunkMath = ChunkMath;
;exports.RiverGenerator = RiverGenerator;
;exports.PlayerWaterState = PlayerWaterState;
;exports.ChunkGenerator = ChunkGenerator;
;exports.ChunkInstance = ChunkInstance;`,
  context,
  { filename: 'player-water-bundle.js' }
);

const { ChunkMath, RiverGenerator, PlayerWaterState, ChunkGenerator, ChunkInstance } = context.exports;
const TILE = ChunkMath.TILE_SIZE;

// ---------------------------------------------------------------------------
// 0. Constant is present and correct.
// ---------------------------------------------------------------------------
assertEqual(PlayerWaterState.PLAYER_WATER_SPEED_MULTIPLIER, 0.55, 'multiplier constant is 0.55');

// ---------------------------------------------------------------------------
// Locate deterministic river geometry: a horizontal-river seed so a tile can be
// water while the tile directly above it is dry (needed to prove foot vs centre).
// ---------------------------------------------------------------------------
function findRiverSample() {
  for (let seed = 1; seed <= 400; seed += 1) {
    const params = RiverGenerator.getParams(seed);
    if (params.orientationVertical) continue; // want a horizontal band (varies in Y)
    for (let ty = -60; ty <= 60; ty += 1) {
      for (let tx = -60; tx <= 60; tx += 1) {
        if (RiverGenerator.isWaterTile(seed, tx, ty)
          && !RiverGenerator.isWaterTile(seed, tx, ty - 1)) {
          return { seed, waterTileX: tx, waterTileY: ty };
        }
      }
    }
  }
  throw new Error('no horizontal river sample found');
}

const { seed, waterTileX, waterTileY } = findRiverSample();
const landTileX = waterTileX;
const landTileY = waterTileY - 1; // dry tile directly above the water tile
assert(RiverGenerator.isWaterTile(seed, waterTileX, waterTileY), 'sample water tile is water');
assert(!RiverGenerator.isWaterTile(seed, landTileX, landTileY), 'sample land tile is dry');

const waterCenterX = waterTileX * TILE + TILE / 2;
const waterCenterY = waterTileY * TILE + TILE / 2;
const landCenterX = landTileX * TILE + TILE / 2;
const landCenterY = landTileY * TILE + TILE / 2;

// ---------------------------------------------------------------------------
// 1. Helper: production seed + RiverGenerator decide water; land=false, water=true.
// ---------------------------------------------------------------------------
assertEqual(PlayerWaterState.isFootInWater(seed, landCenterX, landCenterY), false, 'land foot -> not water');
assertEqual(PlayerWaterState.isFootInWater(seed, waterCenterX, waterCenterY), true, 'water foot -> water');
// Matches RiverGenerator exactly (no independent water definition).
assertEqual(
  PlayerWaterState.isFootInWater(seed, waterCenterX, waterCenterY),
  RiverGenerator.isWaterTile(seed, waterTileX, waterTileY),
  'helper agrees with RiverGenerator'
);

// ---------------------------------------------------------------------------
// 2. Water state is decided by the FEET (bottom-centre of the body), not the
//    visual sprite centre. Body centre sits on the dry tile, feet in the water.
// ---------------------------------------------------------------------------
{
  const bodyHeight = TILE;
  const centerY = landTileY * TILE + TILE - 1;         // inside the dry tile
  const bottom = centerY + bodyHeight / 2;             // pushed down into the water tile
  const body = {
    x: waterCenterX - 10, y: centerY - bodyHeight / 2, width: 20, height: bodyHeight,
    center: { x: waterCenterX, y: centerY },
    bottom
  };
  const foot = PlayerWaterState.footPosition(body);
  assertClose(foot.x, waterCenterX, 'foot x = body centre x');
  assertClose(foot.y, bottom, 'foot y = body bottom');
  assert(ChunkMath.worldToTile(foot.x, foot.y).tileY === waterTileY, 'foot lands in the water tile');
  assert(ChunkMath.worldToTile(body.center.x, body.center.y).tileY === landTileY, 'body centre is on land tile');
  assertEqual(PlayerWaterState.speedMultiplier(seed, foot.x, foot.y), 0.55, 'feet-in-water -> 0.55');
  // Using the visual centre (wrong) would report land; confirm the difference.
  assertEqual(PlayerWaterState.speedMultiplier(seed, body.center.x, body.center.y), 1, 'centre-on-land -> 1 (shows feet rule matters)');
}

// ---------------------------------------------------------------------------
// 3. Speed: 100% on land, exactly 55% in water; recomputed from base each frame
//    (never accumulates); diagonal stays normalized; exit restores speed.
// ---------------------------------------------------------------------------
function movementVector(ix, iy) {
  // Mirrors InputController.getMovementVector: normalize only if length > 1.
  let x = ix;
  let y = iy;
  const lenSq = x * x + y * y;
  if (lenSq > 1) {
    const len = Math.sqrt(lenSq);
    x /= len; y /= len;
  }
  return { x, y };
}
// Mirrors GameScene: normalized input * PLAYER_SPEED * waterMultiplier -> velocity.
function frameVelocity(inputX, inputY, footX, footY) {
  const m = movementVector(inputX, inputY);
  m.x *= PLAYER_SPEED;
  m.y *= PLAYER_SPEED;
  const mult = PlayerWaterState.speedMultiplier(seed, footX, footY);
  if (mult !== 1) { m.x *= mult; m.y *= mult; }
  return m;
}
const mag = (v) => Math.hypot(v.x, v.y);

// Cardinal land vs water.
const landRight = frameVelocity(1, 0, landCenterX, landCenterY);
const waterRight = frameVelocity(1, 0, waterCenterX, waterCenterY);
assertClose(mag(landRight), PLAYER_SPEED, 'land speed = 100%');
assertClose(mag(waterRight), PLAYER_SPEED * 0.55, 'water speed = 55%');
assertClose(mag(waterRight) / mag(landRight), 0.55, 'water/land ratio = 0.55');

// Diagonal normalization preserved on land and in water (no diagonal speed-up).
const landDiag = frameVelocity(1, 1, landCenterX, landCenterY);
const waterDiag = frameVelocity(1, 1, waterCenterX, waterCenterY);
assertClose(mag(landDiag), PLAYER_SPEED, 'diagonal land magnitude = cardinal');
assertClose(mag(waterDiag), PLAYER_SPEED * 0.55, 'diagonal water magnitude = 55%');

// No accumulation: many consecutive water frames keep the same magnitude.
let last = null;
for (let frame = 0; frame < 10; frame += 1) {
  const v = frameVelocity(1, 0, waterCenterX, waterCenterY);
  const m = mag(v);
  assertClose(m, PLAYER_SPEED * 0.55, `water frame ${frame} magnitude stable`);
  if (last !== null) assertClose(m, last, 'multiplier does not accumulate between frames');
  last = m;
}

// Exiting water immediately restores full speed (state is per-frame, not stored).
const afterExit = frameVelocity(1, 0, landCenterX, landCenterY);
assertClose(mag(afterExit), PLAYER_SPEED, 'exit water -> speed restored same frame');

// ---------------------------------------------------------------------------
// 4. Negative coordinates and chunk boundaries.
// ---------------------------------------------------------------------------
{
  // A negative-coordinate water tile on the same horizontal band.
  let negTileX = null;
  for (let tx = -1; tx >= -400; tx -= 1) {
    if (RiverGenerator.isWaterTile(seed, tx, waterTileY)) { negTileX = tx; break; }
  }
  assert(negTileX !== null, 'found a negative-x water tile');
  const nx = negTileX * TILE + TILE / 2;
  const ny = waterTileY * TILE + TILE / 2;
  assertEqual(PlayerWaterState.isFootInWater(seed, nx, ny), true, 'negative-coord water detected');
  assertEqual(
    PlayerWaterState.isFootInWater(seed, nx, ny),
    RiverGenerator.isWaterTile(seed, negTileX, waterTileY),
    'negative-coord helper agrees with RiverGenerator'
  );
  // Chunk boundary: a foot position exactly on a tile/chunk edge floors correctly.
  const edgeX = waterTileX * TILE;      // left edge of the water tile
  const edgeY = waterTileY * TILE;      // top edge of the water tile
  assertEqual(
    PlayerWaterState.isFootInWater(seed, edgeX, edgeY),
    RiverGenerator.isWaterTile(seed, waterTileX, waterTileY),
    'tile-edge foot maps to the correct tile'
  );
}

// ---------------------------------------------------------------------------
// Mock Phaser scene / blocking group to exercise ChunkInstance water creation.
// ---------------------------------------------------------------------------
function createSprite(x, y, textureKey) {
  const data = {};
  return {
    x, y, textureKey, displayWidth: 32, displayHeight: 32, depth: 0, destroyed: false,
    body: {
      width: 32, height: 32, offset: { x: 0, y: 0 },
      setSize(w, h) { this.width = w; this.height = h; },
      setOffset(ox, oy) { this.offset.x = ox; this.offset.y = oy; }
    },
    refreshBody() { return this; },
    setVisible() { return this; },
    setDepth(d) { this.depth = d; return this; },
    setDataEnabled() { return this; },
    setData(k, v) { data[k] = v; return this; },
    getData(k) { return data[k]; },
    getBounds() { return { centerX: this.x, bottom: this.y + this.displayHeight / 2 }; },
    destroy() { this.destroyed = true; this.body = null; }
  };
}
function createScene(imageLog) {
  const textureSet = new Set();
  return {
    textures: { exists(key) { return textureSet.has(key); } },
    make: {
      graphics() {
        return {
          fillStyle() { return this; }, fillRect() { return this; },
          generateTexture(key) { textureSet.add(key); return this; }, destroy() {}
        };
      }
    },
    add: {
      graphics() {
        return { setDepth() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, destroy() {} };
      },
      image(x, y, key) { const s = createSprite(x, y, key); imageLog.push({ x, y, key, sprite: s }); return s; }
    },
    physics: { add: { existing() {}, collider() { return { destroy() {} }; } } },
    tweens: { add() { return { stop() {}, remove() {} }; } },
    time: { delayedCall() { return { remove() {}, destroy() {} }; } },
    groundItemSystem: { spawn() { return null; } }
  };
}
function createRecordingBlockingGroup() {
  const created = [];
  return { created, create(x, y, key) { const s = createSprite(x, y, key); created.push({ x, y, key, sprite: s }); return s; } };
}

// ---------------------------------------------------------------------------
// 5. ChunkInstance: water sprites are NOT in the player blocking group, real
//    world objects still ARE, and water stays in npcBlockedCells.
// ---------------------------------------------------------------------------
{
  const cx = 3;
  const cy = 4;
  const base = ChunkGenerator.generate(seed, cx, cy);
  const chunkData = {
    chunkX: cx,
    chunkY: cy,
    terrain: base.terrain,
    objects: [{ type: 'ROCK', localTileX: 5, localTileY: 6 }],
    water: [
      { localTileX: 1, localTileY: 1, worldTileX: cx * 16 + 1, worldTileY: cy * 16 + 1, id: 'w_a' },
      { localTileX: 2, localTileY: 1, worldTileX: cx * 16 + 2, worldTileY: cy * 16 + 1, id: 'w_b' }
    ],
    npcs: [],
    spawnPoints: [],
    village: [],
    villageBlockedCells: []
  };
  const imageLog = [];
  const scene = createScene(imageLog);
  const blockingGroup = createRecordingBlockingGroup();
  const instance = new ChunkInstance(scene, chunkData, { blockingGroup });

  // Water is drawn as plain images (visible) but never in the blocking group.
  const waterImages = imageLog.filter((e) => e.key === 'river-water-texture');
  assertEqual(waterImages.length, 2, 'both water tiles drawn as images');
  assertEqual(instance.waterSprites.length, 2, 'waterSprites tracked for cleanup');
  const waterInBlockers = blockingGroup.created.filter((e) => e.key === 'river-water-texture');
  assertEqual(waterInBlockers.length, 0, 'no water sprite added to the player blocking group');

  // The ROCK is still a real blocker in the blocking group.
  const rockBlockers = blockingGroup.created.filter((e) => e.key === 'temporary-rock');
  assert(rockBlockers.length >= 1, 'ROCK remains a blocking object');

  // Water cells and the rock cell remain impassable for NPCs.
  assert(instance.npcBlockedCells.has('1,1'), 'water cell (1,1) blocked for NPCs');
  assert(instance.npcBlockedCells.has('2,1'), 'water cell (2,1) blocked for NPCs');
  assert(instance.npcBlockedCells.has('5,6'), 'rock cell blocked for NPCs');

  // Unload destroys water sprites without leaking / duplicating.
  const sprites = instance.waterSprites.slice();
  instance.destroy();
  sprites.forEach((s) => assert(s.destroyed, 'water sprite destroyed on unload'));
  assertEqual(instance.waterSprites.length, 0, 'waterSprites cleared on destroy');
}

// ---------------------------------------------------------------------------
// 6. Reload does not duplicate water sprites and keeps water blocked for NPCs.
// ---------------------------------------------------------------------------
{
  const cx = -2;
  const cy = -3; // negative chunk coordinates
  const base = ChunkGenerator.generate(seed, cx, cy);
  const chunkData = {
    chunkX: cx, chunkY: cy, terrain: base.terrain,
    objects: [], npcs: [], spawnPoints: [], village: [], villageBlockedCells: [],
    water: [{ localTileX: 0, localTileY: 0, worldTileX: cx * 16, worldTileY: cy * 16, id: 'wn' }]
  };
  const imageLog = [];
  const scene = createScene(imageLog);
  const a = new ChunkInstance(scene, chunkData, { blockingGroup: createRecordingBlockingGroup() });
  assertEqual(a.waterSprites.length, 1, 'negative-chunk water created');
  assert(a.npcBlockedCells.has('0,0'), 'negative-chunk water blocked for NPCs');
  a.destroy();
  const imageLog2 = [];
  const scene2 = createScene(imageLog2);
  const b = new ChunkInstance(scene2, chunkData, { blockingGroup: createRecordingBlockingGroup() });
  assertEqual(b.waterSprites.length, 1, 'reload creates exactly one water sprite (no duplicate)');
  assert(b.npcBlockedCells.has('0,0'), 'reload keeps water blocked for NPCs');
  b.destroy();
}

// ---------------------------------------------------------------------------
// 7. Water state is never serialized (no save-schema change).
// ---------------------------------------------------------------------------
{
  const saveSrc = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
  assert(!/water/i.test(saveSrc), 'SaveSystem has no water references');
  const waterSrc = fs.readFileSync(path.join(root, 'src/world/PlayerWaterState.js'), 'utf8');
  assert(!/save|serialize|localStorage/i.test(waterSrc), 'PlayerWaterState does not persist anything');
}

// ---------------------------------------------------------------------------
// 8. NPC water blocking rule not removed from ChunkInstance source.
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(path.join(root, 'src/world/ChunkInstance.js'), 'utf8');
  assert(/buildNpcBlockedCells/.test(src), 'buildNpcBlockedCells still present');
  assert(/chunkData && chunkData\.water/.test(src), 'water still feeds npcBlockedCells');
}

console.log('test-player-water-movement: ok');
