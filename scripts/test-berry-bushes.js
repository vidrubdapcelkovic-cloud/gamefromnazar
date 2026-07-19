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

// ---------------------------------------------------------------------------
// Generation bundle (pure): ChunkGenerator + RiverGenerator + ids.
// ---------------------------------------------------------------------------
const genBundle = [
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const genContext = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(genContext);
vm.runInContext(
  `${genBundle}
;exports.ChunkMath = ChunkMath;
;exports.RiverGenerator = RiverGenerator;
;exports.ChunkGenerator = ChunkGenerator;
;exports.buildChunkResourceId = buildChunkResourceId;
;exports.shouldMaterializeChunkResource = shouldMaterializeChunkResource;`,
  genContext,
  { filename: 'berry-gen-bundle.js' }
);

const {
  ChunkMath,
  RiverGenerator,
  ChunkGenerator,
  buildChunkResourceId,
  shouldMaterializeChunkResource
} = genContext.exports;
const SIZE = ChunkMath.CHUNK_SIZE;

function berriesOf(chunk) {
  return chunk.objects.filter((o) => o.type === 'BERRY_BUSH');
}

// ---------------------------------------------------------------------------
// 1. Bushes are generated again across many chunks, deterministically.
// ---------------------------------------------------------------------------
{
  const seed = 424242;
  let chunksWithBushes = 0;
  let totalBushes = 0;
  let maxInAnyChunk = 0;
  for (let cy = -3; cy <= 12; cy += 1) {
    for (let cx = -4; cx <= 4; cx += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const bushes = berriesOf(chunk);
      if (bushes.length) chunksWithBushes += 1;
      totalBushes += bushes.length;
      maxInAnyChunk = Math.max(maxInAnyChunk, bushes.length);
    }
  }
  assert(chunksWithBushes >= 20, `berry bushes appear in many chunks (got ${chunksWithBushes})`);
  assert(totalBushes > 40, `plenty of berry bushes overall (got ${totalBushes})`);
  assert(maxInAnyChunk <= 3, `max 3 bushes per chunk (got ${maxInAnyChunk})`);

  const a = ChunkGenerator.generate(seed, 2, 6);
  const b = ChunkGenerator.generate(seed, 2, 6);
  assertEqual(JSON.stringify(a.objects), JSON.stringify(b.objects), 'berry generation deterministic');
}

// ---------------------------------------------------------------------------
// 2. Stable, unique ids; no overlap with TREE/ROCK/NPC; not in start clear zone.
// ---------------------------------------------------------------------------
{
  const seed = 987654321;
  for (let cy = -2; cy <= 8; cy += 1) {
    for (let cx = -3; cx <= 3; cx += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const bushes = berriesOf(chunk);
      const ids = new Set();
      const objectCells = new Set(
        chunk.objects
          .filter((o) => o.type !== 'BERRY_BUSH')
          .map((o) => `${o.localTileX},${o.localTileY}`)
      );
      const npcCells = new Set(chunk.npcs.map((n) => `${n.localTileX},${n.localTileY}`));
      bushes.forEach((bush) => {
        assert(bush.localTileX >= 0 && bush.localTileX < SIZE, 'bush localX in range');
        assert(bush.localTileY >= 0 && bush.localTileY < SIZE, 'bush localY in range');
        const id = buildChunkResourceId(cx, cy, 'BERRY_BUSH', bush.localTileX, bush.localTileY);
        assertEqual(
          id,
          `chunk_${cx}_${cy}_BERRY_BUSH_${bush.localTileX}_${bush.localTileY}`,
          'bush stable id format'
        );
        assert(!ids.has(id), 'unique bush id within chunk');
        ids.add(id);
        const cell = `${bush.localTileX},${bush.localTileY}`;
        assert(!objectCells.has(cell), 'bush does not overlap TREE/ROCK');
        assert(!npcCells.has(cell), 'bush does not overlap NPC');
      });
    }
  }

  const start = ChunkGenerator.generate(seed, 0, 0);
  berriesOf(start).forEach((bush) => {
    const inClear = bush.localTileX >= 5 && bush.localTileX <= 11
      && bush.localTileY >= 5 && bush.localTileY <= 11;
    assert(!inClear, 'no bush in start clear zone');
  });
}

// ---------------------------------------------------------------------------
// 3. With rivers: no bush on water, but bushes still appear on dry land.
// ---------------------------------------------------------------------------
{
  const seed = 20260718;
  let sawWater = false;
  let sawBushNearWater = false;
  for (let cy = -2; cy <= 14; cy += 1) {
    for (let cx = -5; cx <= 5; cx += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const waterCells = new Set(chunk.water.map((w) => `${w.localTileX},${w.localTileY}`));
      const bushes = berriesOf(chunk);
      if (waterCells.size) sawWater = true;
      bushes.forEach((bush) => {
        const cell = `${bush.localTileX},${bush.localTileY}`;
        assert(!waterCells.has(cell), 'no berry bush on water');
        // Cross-check with the pure water mask on absolute coordinates.
        const wx = cx * SIZE + bush.localTileX;
        const wy = cy * SIZE + bush.localTileY;
        assert(!RiverGenerator.isWaterTile(seed, wx, wy), 'bush cell is dry per river mask');
      });
      if (waterCells.size && bushes.length) sawBushNearWater = true;
    }
  }
  assert(sawWater, 'river water exists in scanned region');
  assert(sawBushNearWater, 'bushes still spawn on land in chunks that also contain water');
}

// ---------------------------------------------------------------------------
// 4. Existing object stream stays independent (structural guard).
// ---------------------------------------------------------------------------
{
  const generatorSrc = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(generatorSrc.includes("'chunk-berry-bushes'"), 'berry uses its own stream');
  assert(/BERRY_BUSH_SPAWN_CHANCE = 0\.55/.test(generatorSrc), 'berry spawn chance 0.55');
  assert(/BERRY_BUSH_MAX_PER_CHUNK = 3/.test(generatorSrc), 'berry max per chunk 3');
  // Berry block must come after the BOWMAN (last hostile) placement so existing
  // TREE/ROCK/NPC streams and positions are untouched.
  const bowmanIdx = generatorSrc.indexOf("'chunk-enemies-bowman'");
  const berryIdx = generatorSrc.indexOf("'chunk-berry-bushes'");
  assert(bowmanIdx >= 0 && berryIdx > bowmanIdx, 'berry placed after all NPCs');
}

// ---------------------------------------------------------------------------
// 5. Runtime: ChunkInstance builds a non-blocking, harvestable bush and honours
//    removed-resource persistence.
// ---------------------------------------------------------------------------
const runtimeBundle = [
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
  'src/world/VillageGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
  'src/world/ChunkInstance.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const runtimeContext = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(runtimeContext);
vm.runInContext(
  `${runtimeBundle}
;exports.ChunkInstance = ChunkInstance;
;exports.buildChunkResourceId = buildChunkResourceId;`,
  runtimeContext,
  { filename: 'berry-runtime-bundle.js' }
);
const { ChunkInstance } = runtimeContext.exports;

function createImageMock(x, y, key) {
  return {
    x,
    y,
    textureKey: key,
    displayWidth: 32,
    displayHeight: 32,
    destroyed: false,
    _data: {},
    setDataEnabled() { return this; },
    setData(k, v) { this._data[k] = v; return this; },
    getData(k) { return this._data[k]; },
    setDepth() { return this; },
    setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
    getBounds() {
      return {
        centerX: this.x,
        bottom: this.y + this.displayHeight / 2
      };
    },
    destroy() { this.destroyed = true; }
  };
}

function createScene() {
  return {
    textures: { exists() { return true; } },
    make: {
      graphics() {
        return {
          fillStyle() { return this; },
          fillRect() { return this; },
          fillCircle() { return this; },
          generateTexture() { return this; },
          destroy() {}
        };
      }
    },
    add: {
      graphics() {
        return {
          setDepth() { return this; },
          fillStyle() { return this; },
          fillRect() { return this; },
          destroy() {}
        };
      },
      image(x, y, key) { return createImageMock(x, y, key); }
    }
  };
}

let blockingCreateCalls = 0;
const blockingGroup = {
  create(x, y, key) {
    blockingCreateCalls += 1;
    return {
      x,
      y,
      textureKey: key,
      setVisible() { return this; },
      setDataEnabled() { return this; },
      setData() { return this; },
      setDepth() { return this; },
      destroyed: false,
      destroy() { this.destroyed = true; },
      body: { setSize() {}, setOffset() {}, refreshBody() {} }
    };
  }
};

{
  const chunkData = {
    chunkX: 2,
    chunkY: 3,
    objects: [{ type: 'BERRY_BUSH', localTileX: 4, localTileY: 6, variant: 0 }],
    water: [],
    npcs: [],
    spawnPoints: []
  };
  const bushId = runtimeContext.exports.buildChunkResourceId(2, 3, 'BERRY_BUSH', 4, 6);

  const created = [];
  const destroyed = [];
  const registry = new Map();
  blockingCreateCalls = 0;
  const instance = new ChunkInstance(createScene(), chunkData, {
    blockingGroup,
    onObjectCreated: (obj) => { created.push(obj); registry.set(obj.id, obj); },
    // Mirror GameScene.unregisterChunkWorldObject: destroy the visual on release.
    onObjectDestroyed: (id) => {
      destroyed.push(id);
      const obj = registry.get(id);
      if (obj && obj.visualObject && typeof obj.visualObject.destroy === 'function') {
        obj.visualObject.destroy();
      }
      registry.delete(id);
    },
    isResourceRemoved: () => false
  });

  assertEqual(created.length, 1, 'one runtime bush created');
  const runtime = created[0];
  assertEqual(runtime.id, bushId, 'runtime bush id');
  assertEqual(runtime.type, 'BERRY_BUSH', 'runtime bush type');
  assert(runtime.active, 'runtime bush active');
  assert(runtime.blockerObject === null, 'berry bush is non-blocking (no blocker)');
  assertEqual(runtime.visualObject.textureKey, 'temporary-berry-bush', 'berry uses berry texture');
  assertEqual(blockingCreateCalls, 0, 'berry bush adds nothing to the blocking group');

  // Cleanup on chunk unload is idempotent and releases the object.
  instance.destroy();
  assert(destroyed.includes(bushId), 'bush released on chunk unload');
  assert(runtime.visualObject.destroyed, 'bush sprite destroyed on unload');
  instance.destroy();
}

// Removed bush (harvested) must not respawn after reload / save-continue.
{
  const chunkData = {
    chunkX: 2,
    chunkY: 3,
    objects: [{ type: 'BERRY_BUSH', localTileX: 4, localTileY: 6, variant: 0 }],
    water: [],
    npcs: [],
    spawnPoints: []
  };
  const bushId = runtimeContext.exports.buildChunkResourceId(2, 3, 'BERRY_BUSH', 4, 6);
  const removed = new Set([bushId]);

  const created = [];
  const instance = new ChunkInstance(createScene(), chunkData, {
    blockingGroup,
    onObjectCreated: (obj) => created.push(obj),
    onObjectDestroyed: () => {},
    isResourceRemoved: (id) => removed.has(id)
  });
  assertEqual(created.length, 0, 'harvested bush does not respawn after reload');
  instance.destroy();

  // Descriptor-level persistence helper agrees.
  assertEqual(shouldMaterializeChunkResource(bushId, removed), false, 'removed bush stays removed');
  assertEqual(
    shouldMaterializeChunkResource(buildChunkResourceId(2, 3, 'BERRY_BUSH', 7, 7), removed),
    true,
    'other bushes still materialize'
  );
}

// ---------------------------------------------------------------------------
// 6. Harvest economy preserved (BERRIES x2) and generic harvest flow intact.
// ---------------------------------------------------------------------------
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /BERRY_BUSH: Object\.freeze\(\{ itemType: 'BERRIES', quantity: 2 \}\)/.test(gameScene),
    'berry bush yields BERRIES x2 (economy unchanged)'
  );
  assert(/WORLD_OBJECT_TYPES = Object\.freeze\(\['TREE', 'ROCK', 'BERRY_BUSH'\]\)/.test(gameScene), 'BERRY_BUSH is a world object type');
  // Generic harvest path: single yield + removal + persistence marking.
  assert(/const drop = WORLD_OBJECT_DROPS\[runtimeObject\.type\];/.test(gameScene), 'harvest reads generic drop');
  assert(/this\.groundItemSystem\.spawn\(drop\.itemType, drop\.quantity/.test(gameScene), 'harvest spawns one stack');
  assert(/this\.markSessionResourceRemoved\(runtimeObject\.id\)/.test(gameScene), 'harvest marks resource removed');
}

console.log('test-berry-bushes: ok');
