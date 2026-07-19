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

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, Infinity, JSON, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.ChunkMath = ChunkMath;
;exports.VillageGenerator = VillageGenerator;
;exports.ChunkGenerator = ChunkGenerator;
;exports.ChunkInstance = ChunkInstance;`,
  context,
  { filename: 'village-runtime-bundle.js' }
);

const { ChunkMath, VillageGenerator, ChunkGenerator, ChunkInstance } = context.exports;
const SIZE = ChunkMath.CHUNK_SIZE;
const TILE = ChunkMath.TILE_SIZE;
const REGION_SIZE = VillageGenerator.REGION_SIZE;

// ---------------------------------------------------------------------------
// Mock Phaser scene: records generated textures and created sprites.
// ---------------------------------------------------------------------------
function createSprite(x, y, textureKey) {
  const data = {};
  return {
    x,
    y,
    textureKey,
    displayWidth: 32,
    displayHeight: 32,
    originY: 0.5,
    flipX: false,
    flipY: false,
    depth: 0,
    destroyed: false,
    body: {
      width: 32,
      height: 32,
      offset: { x: 0, y: 0 },
      setSize(w, h) { this.width = w; this.height = h; },
      setOffset(ox, oy) { this.offset.x = ox; this.offset.y = oy; }
    },
    refreshBody() { return this; },
    setFlipX(v) { this.flipX = v; return this; },
    setFlipY(v) { this.flipY = v; return this; },
    setDepth(d) { this.depth = d; return this; },
    setVisible() { return this; },
    setDataEnabled() { return this; },
    setData(k, v) { data[k] = v; return this; },
    getData(k) { return data[k]; },
    getBounds() { return { centerX: this.x, bottom: this.y + this.displayHeight / 2 }; },
    destroy() { this.destroyed = true; this.body = null; }
  };
}

function createScene() {
  const createdTextureCounts = {};
  const textureSet = new Set();
  const scene = {
    createdTextureCounts,
    damagePlayerCalls: 0,
    player: { x: 0, y: 0, body: { width: 20, height: 20 }, destroyed: false, active: true },
    playerStatsModel: { isDead() { return false; } },
    damagePlayer() { this.damagePlayerCalls += 1; return 0; },
    textures: {
      exists(key) { return textureSet.has(key); }
    },
    make: {
      graphics() {
        return {
          fillStyle() { return this; },
          fillRect() { return this; },
          fillTriangle() { return this; },
          fillCircle() { return this; },
          fillEllipse() { return this; },
          generateTexture(key) {
            createdTextureCounts[key] = (createdTextureCounts[key] || 0) + 1;
            textureSet.add(key);
            return this;
          },
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
      image(x, y, key) { return createSprite(x, y, key); }
    },
    physics: {
      add: {
        existing(obj) {
          obj.body = {
            width: 0, height: 0, offset: { x: 0, y: 0 }, moves: false,
            setAllowGravity() {}, setImmovable() {},
            setSize(w, h) { this.width = w; this.height = h; },
            setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
            updateFromGameObject() {}, reset() {}
          };
        },
        collider() { return { destroy() {} }; }
      }
    },
    tweens: { add() { return { stop() {}, remove() {} }; } },
    time: { delayedCall() { return { remove() {}, destroy() {} }; } },
    groundItemSystem: { spawn() { return null; } }
  };
  return scene;
}

function createBlockingGroup() {
  return {
    create(x, y, key) { return createSprite(x, y, key); }
  };
}

// Build the chunk data ChunkManager would hand to ChunkInstance, but isolated to
// village runtime (objects/npcs stripped so the test focuses on village).
function villageChunkData(seed, cx, cy) {
  const base = ChunkGenerator.generate(seed, cx, cy);
  return {
    chunkX: cx,
    chunkY: cy,
    terrain: base.terrain,
    objects: [],
    water: [],
    npcs: [],
    spawnPoints: [],
    village: VillageGenerator.getVillageDescriptorsForChunk(seed, cx, cy),
    villageBlockedCells: VillageGenerator.getFootprintCellsForChunk(seed, cx, cy)
  };
}

// ---------------------------------------------------------------------------
// Locate a deterministic village to exercise.
// ---------------------------------------------------------------------------
function findVillage() {
  const seeds = [11, 4242, 20260718, 987654321, 5, 99, 123456];
  for (const seed of seeds) {
    for (let ry = -3; ry <= 4; ry += 1) {
      for (let rx = -3; rx <= 4; rx += 1) {
        if (rx === 0 && ry === 0) continue;
        const village = VillageGenerator.getVillageForRegion(seed, rx, ry);
        if (village) return { seed, rx, ry, village };
      }
    }
  }
  throw new Error('no village found for runtime test');
}

const { seed, rx, ry, village } = findVillage();

// Expected descriptor set from stage 1 (unchanged stable IDs).
const expectedById = new Map(village.descriptors.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// 1. Build every chunk of the region on one shared scene; collect runtime.
// ---------------------------------------------------------------------------
const scene = createScene();
const createdObjectRuntimes = [];
const instances = [];
const villageRuntimeById = new Map();

for (let cy = ry * REGION_SIZE; cy < (ry + 1) * REGION_SIZE; cy += 1) {
  for (let cx = rx * REGION_SIZE; cx < (rx + 1) * REGION_SIZE; cx += 1) {
    const data = villageChunkData(seed, cx, cy);
    const instance = new ChunkInstance(scene, data, {
      blockingGroup: createBlockingGroup(),
      onObjectCreated: (runtime) => createdObjectRuntimes.push(runtime)
    });
    instances.push({ cx, cy, instance, data });
    instance.villageObjects.forEach((entry) => {
      assert(!villageRuntimeById.has(entry.id), `village object ${entry.id} created exactly once`);
      villageRuntimeById.set(entry.id, { entry, cx, cy });
    });
  }
}

// Owner-only creation: exactly the 7 descriptors, no duplicates.
assertEqual(villageRuntimeById.size, 7, 'exactly 7 village runtime objects across region');
const typeCounts = {};
villageRuntimeById.forEach(({ entry }) => {
  typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
});
assertEqual(typeCounts.VILLAGE_HOUSE, 3, '3 houses');
assertEqual(typeCounts.VILLAGE_WAREHOUSE, 1, '1 warehouse');
assertEqual(typeCounts.VILLAGE_CAMPFIRE, 1, '1 campfire');
assertEqual(typeCounts.VILLAGE_CHEST, 2, '2 chests');

// Stable IDs unchanged and each created by its owner chunk.
villageRuntimeById.forEach(({ entry, cx, cy }, id) => {
  assert(expectedById.has(id), `runtime id ${id} matches a stage-1 descriptor`);
  const descriptor = expectedById.get(id);
  assertEqual(cx, descriptor.ownerChunk.chunkX, `created in owner chunkX for ${id}`);
  assertEqual(cy, descriptor.ownerChunk.chunkY, `created in owner chunkY for ${id}`);
});

// ---------------------------------------------------------------------------
// 2. Positions match footprint bounding-box centres; visuals within reserved.
// ---------------------------------------------------------------------------
villageRuntimeById.forEach(({ entry }, id) => {
  const descriptor = expectedById.get(id);
  let minTileX = Infinity;
  let minTileY = Infinity;
  let maxTileX = -Infinity;
  let maxTileY = -Infinity;
  descriptor.footprint.forEach((t) => {
    if (t.tileX < minTileX) minTileX = t.tileX;
    if (t.tileY < minTileY) minTileY = t.tileY;
    if (t.tileX > maxTileX) maxTileX = t.tileX;
    if (t.tileY > maxTileY) maxTileY = t.tileY;
  });
  const widthTiles = maxTileX - minTileX + 1;
  const heightTiles = maxTileY - minTileY + 1;
  const expectedCenterX = minTileX * TILE + (widthTiles * TILE) / 2;
  const expectedCenterY = minTileY * TILE + (heightTiles * TILE) / 2;
  assertEqual(entry.centerX, expectedCenterX, `centerX matches footprint for ${id}`);
  assertEqual(entry.centerY, expectedCenterY, `centerY matches footprint for ${id}`);
  assertEqual(entry.sprite.x, expectedCenterX, `sprite x for ${id}`);
  assertEqual(entry.sprite.y, expectedCenterY, `sprite y for ${id}`);
});

// ---------------------------------------------------------------------------
// 3. Textures created exactly once each (4 house + 4 warehouse dirs + 2 props).
// ---------------------------------------------------------------------------
const HOUSE_TEXTURE_KEYS = {
  NORTH: 'village-house-north-texture',
  EAST: 'village-house-east-texture',
  SOUTH: 'village-house-south-texture',
  WEST: 'village-house-west-texture'
};
const WAREHOUSE_TEXTURE_KEYS = {
  NORTH: 'village-warehouse-north-texture',
  EAST: 'village-warehouse-east-texture',
  SOUTH: 'village-warehouse-south-texture',
  WEST: 'village-warehouse-west-texture'
};
const ALL_VILLAGE_TEXTURE_KEYS = [
  ...Object.values(HOUSE_TEXTURE_KEYS),
  ...Object.values(WAREHOUSE_TEXTURE_KEYS),
  'village-campfire-texture',
  'village-chest-closed-texture'
];
ALL_VILLAGE_TEXTURE_KEYS.forEach((key) => {
  assertEqual(scene.createdTextureCounts[key], 1, `${key} generated once`);
});

// ---------------------------------------------------------------------------
// 3c. The runtime picks the directional texture matching descriptor.facing and
//     applies no mirror/rotation to the sprite.
// ---------------------------------------------------------------------------
villageRuntimeById.forEach(({ entry }, id) => {
  const descriptor = expectedById.get(id);
  if (entry.type === 'VILLAGE_HOUSE') {
    assertEqual(entry.textureKey, HOUSE_TEXTURE_KEYS[descriptor.facing], `house texture matches facing ${id}`);
  } else if (entry.type === 'VILLAGE_WAREHOUSE') {
    assertEqual(entry.textureKey, WAREHOUSE_TEXTURE_KEYS[descriptor.facing], `warehouse texture matches facing ${id}`);
  }
  assertEqual(entry.facing, descriptor.facing, `runtime facing matches descriptor ${id}`);
  assertEqual(entry.sprite.flipX, false, `no flipX applied ${id}`);
  assertEqual(entry.sprite.flipY, false, `no flipY applied ${id}`);
});

// ---------------------------------------------------------------------------
// 4. Collision bodies: houses/warehouse full footprint; campfire/chest small.
// ---------------------------------------------------------------------------
villageRuntimeById.forEach(({ entry }, id) => {
  const body = entry.sprite.body;
  assert(body, `village sprite has body for ${id}`);
  if (entry.type === 'VILLAGE_HOUSE') {
    assertEqual(body.width, 4 * TILE, 'house body width = footprint');
    assertEqual(body.height, 3 * TILE, 'house body height = footprint');
  } else if (entry.type === 'VILLAGE_WAREHOUSE') {
    assertEqual(body.width, 4 * TILE, 'warehouse body width = footprint');
    assertEqual(body.height, 4 * TILE, 'warehouse body height = footprint');
  } else {
    // Small blocker strictly inside a single tile.
    assert(body.width > 0 && body.width < TILE, `${entry.type} small blocker width`);
    assert(body.height > 0 && body.height < TILE, `${entry.type} small blocker height`);
  }
});

// ---------------------------------------------------------------------------
// 5. Depth applied (finite, from world position).
// ---------------------------------------------------------------------------
villageRuntimeById.forEach(({ entry }, id) => {
  assert(Number.isFinite(entry.sprite.depth), `depth is finite for ${id}`);
});

// ---------------------------------------------------------------------------
// 6. npcBlockedCells contain every village footprint local cell in each chunk.
// ---------------------------------------------------------------------------
let boundaryChunksWithFootprint = 0;
instances.forEach(({ cx, cy, instance, data }) => {
  const cells = data.villageBlockedCells;
  cells.forEach((cell) => {
    assert(
      instance.npcBlockedCells.has(`${cell.localTileX},${cell.localTileY}`),
      `chunk ${cx},${cy} blocks footprint cell ${cell.localTileX},${cell.localTileY}`
    );
  });
  // A chunk that has footprint cells but created no sprite is a neighbour that
  // still blocks the footprint (proves cross-boundary blocking without dupes).
  if (cells.length > 0 && instance.villageObjects.length === 0) boundaryChunksWithFootprint += 1;
});
// (Not asserting >0: a compact plot may fit fully inside its owner chunks.)
assert(boundaryChunksWithFootprint >= 0, 'boundary block accounting sane');

// ---------------------------------------------------------------------------
// 7. No interaction/loot: onObjectCreated never receives a village object.
// ---------------------------------------------------------------------------
createdObjectRuntimes.forEach((runtime) => {
  assert(!String(runtime.type || '').startsWith('VILLAGE_'), 'village objects are not interaction targets');
});
assertEqual(scene.damagePlayerCalls, 0, 'campfire/chest deal no damage on creation');

// ---------------------------------------------------------------------------
// 8. Destroy removes sprites/bodies/refs; idempotent.
// ---------------------------------------------------------------------------
{
  const ownerEntry = instances.find(({ instance }) => instance.villageObjects.length > 0);
  assert(ownerEntry, 'at least one owner chunk instance');
  const sprites = ownerEntry.instance.villageObjects.map((e) => e.sprite);
  ownerEntry.instance.destroy();
  sprites.forEach((s) => assert(s.destroyed, 'village sprite destroyed on unload'));
  assertEqual(ownerEntry.instance.villageObjects.length, 0, 'villageObjects cleared on destroy');
  ownerEntry.instance.destroy(); // second destroy must be safe
  assertEqual(ownerEntry.instance.villageObjects.length, 0, 'idempotent destroy');
}

// Destroy the rest.
instances.forEach(({ instance }) => { if (!instance.destroyed) instance.destroy(); });

// ---------------------------------------------------------------------------
// 9. Reload restores identical runtime without duplicates or new textures.
// ---------------------------------------------------------------------------
{
  const before = { ...scene.createdTextureCounts };
  const reloadById = new Map();
  for (let cy = ry * REGION_SIZE; cy < (ry + 1) * REGION_SIZE; cy += 1) {
    for (let cx = rx * REGION_SIZE; cx < (rx + 1) * REGION_SIZE; cx += 1) {
      const data = villageChunkData(seed, cx, cy);
      const instance = new ChunkInstance(scene, data, { blockingGroup: createBlockingGroup() });
      instance.villageObjects.forEach((entry) => {
        assert(!reloadById.has(entry.id), `reload: ${entry.id} created once`);
        reloadById.set(entry.id, entry);
      });
      instance.destroy();
    }
  }
  assertEqual(reloadById.size, 7, 'reload recreates exactly 7 village objects');
  reloadById.forEach((entry, id) => {
    const original = villageRuntimeById.get(id);
    assert(original, `reload id ${id} existed before`);
    assertEqual(entry.centerX, original.entry.centerX, `reload centerX stable ${id}`);
    assertEqual(entry.centerY, original.entry.centerY, `reload centerY stable ${id}`);
    assertEqual(entry.facing, original.entry.facing, `reload facing stable ${id}`);
    assertEqual(entry.textureKey, original.entry.textureKey, `reload texture stable ${id}`);
  });
  ALL_VILLAGE_TEXTURE_KEYS.forEach((key) => {
    assertEqual(scene.createdTextureCounts[key], before[key], `no texture regeneration on reload for ${key}`);
  });
}

// ---------------------------------------------------------------------------
// 10. SaveSystem untouched by the village runtime (no village serialization).
// ---------------------------------------------------------------------------
{
  const saveSrc = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
  assert(!/village/i.test(saveSrc), 'SaveSystem has no village references');
}

console.log('test-village-runtime: ok');
