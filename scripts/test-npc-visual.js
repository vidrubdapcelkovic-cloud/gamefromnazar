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

function createImageMock(x, y, textureKey) {
  const data = {};
  return {
    x,
    y,
    textureKey,
    displayHeight: 28,
    destroyed: false,
    setDataEnabled() { return this; },
    setData(key, value) { data[key] = value; return this; },
    getData(key) { return data[key]; },
    setDepth() { return this; },
    getBounds() {
      return { centerX: x, bottom: y + 14 };
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

function createGraphicsMock() {
  return {
    setDepth() { return this; },
    fillStyle() { return this; },
    fillRect() { return this; },
    fillEllipse() { return this; },
    fillCircle() { return this; },
    generateTexture() { return this; },
    destroy() { return this; }
  };
}

function createSceneMock() {
  const textures = new Set();
  const images = [];
  return {
    images,
    textures: {
      exists(key) { return textures.has(key); },
      add(key) { textures.add(key); }
    },
    make: {
      graphics() {
        const graphics = createGraphicsMock();
        graphics.generateTexture = (key) => {
          textures.add(key);
          return graphics;
        };
        return graphics;
      }
    },
    add: {
      graphics() { return createGraphicsMock(); },
      image(x, y, textureKey) {
        const image = createImageMock(x, y, textureKey);
        images.push(image);
        return image;
      }
    }
  };
}

function createBlockingGroupMock() {
  const children = [];
  return {
    children,
    create(x, y, textureKey) {
      const body = {
        setSize() { return this; },
        setOffset() { return this; }
      };
      const object = {
        x,
        y,
        textureKey,
        body,
        refreshBody() {},
        setVisible() { return this; },
        setDataEnabled() { return this; },
        setData() { return this; },
        getBounds() { return { centerX: x, bottom: y + 8 }; },
        destroy() {}
      };
      children.push(object);
      return object;
    }
  };
}

const bundle = [
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkInstance.js'
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
  `${bundle}\n;exports.ChunkInstance = ChunkInstance; exports.ChunkMath = ChunkMath; exports.buildChunkNpcId = buildChunkNpcId;`,
  context,
  { filename: 'npc-visual-bundle.js' }
);

const { ChunkInstance, ChunkMath, buildChunkNpcId } = context.exports;

function createChunkData(overrides = {}) {
  return {
    chunkX: 1,
    chunkY: -2,
    terrain: [],
    objects: [],
    npcs: [],
    spawnPoints: [],
    ...overrides
  };
}

function createInstance(chunkData, options = {}) {
  const scene = createSceneMock();
  const blockingGroup = createBlockingGroupMock();
  const created = [];
  const destroyed = [];
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup,
    onObjectCreated: (runtimeObject) => created.push(runtimeObject),
    onObjectDestroyed: (id) => destroyed.push(id),
    ...options
  });
  return { instance, scene, blockingGroup, created, destroyed };
}

// 1. Missing npcs field
{
  const data = createChunkData();
  delete data.npcs;
  const { instance } = createInstance(data);
  assertEqual(instance.npcObjects.length, 0, 'missing npcs creates no visuals');
  instance.destroy();
}

// 2. Non-array npcs
{
  const { instance } = createInstance(createChunkData({ npcs: { bad: true } }));
  assertEqual(instance.npcObjects.length, 0, 'non-array npcs creates no visuals');
  instance.destroy();
}

// 3. Empty npcs
{
  const { instance } = createInstance(createChunkData({ npcs: [] }));
  assertEqual(instance.npcObjects.length, 0, 'empty npcs creates no visuals');
  instance.destroy();
}

// 4. Unknown type skipped
{
  const { instance, scene } = createInstance(createChunkData({
    npcs: [{ type: 'WOLF', index: 0, localTileX: 3, localTileY: 4 }]
  }));
  assertEqual(instance.npcObjects.length, 0, 'unknown type skipped');
  assertEqual(scene.images.length, 0, 'unknown type creates no image');
  instance.destroy();
}

// 5–10. One RABBIT materializes correctly
{
  const descriptor = {
    type: 'RABBIT',
    index: 0,
    localTileX: 4,
    localTileY: 7
  };
  const descriptorSnapshot = JSON.stringify(descriptor);
  const { instance, scene } = createInstance(createChunkData({
    chunkX: 1,
    chunkY: -2,
    npcs: [descriptor]
  }));

  assertEqual(instance.npcObjects.length, 1, 'one rabbit creates one visual');
  assertEqual(scene.images.length, 1, 'one image created');
  const npcObject = instance.npcObjects[0];
  assertEqual(npcObject.textureKey, 'rabbit-placeholder', 'uses rabbit-placeholder texture');
  assert(scene.textures.exists('rabbit-placeholder'), 'placeholder texture registered once');

  const expectedId = buildChunkNpcId(1, -2, 'RABBIT', 0);
  assertEqual(npcObject.getData('npcId'), expectedId, 'npcId stored via setData');
  assertEqual(npcObject.getData('npcType'), 'RABBIT', 'npcType stored');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged');

  const expectedPos = ChunkMath.localTileCenterWorld(1, -2, 4, 7);
  assertEqual(npcObject.x, expectedPos.x, 'world x matches tile center');
  assertEqual(npcObject.y, expectedPos.y, 'world y matches tile center');
  assert(instance.npcObjects.includes(npcObject), 'object owned by ChunkInstance collection');

  // Texture is not recreated for a second chunk while already present.
  const second = createInstance(createChunkData({
    chunkX: 2,
    chunkY: 0,
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 1, localTileY: 1 }]
  }), {});
  // Reuse same scene textures set by sharing first scene? Separate scenes each have own Set.
  // Verify ensure path: calling createNpcs again on same instance with duplicate id does nothing.
  const before = instance.npcObjects.length;
  instance.createNpcs({
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 4, localTileY: 7 }]
  });
  assertEqual(instance.npcObjects.length, before, 'duplicate npcId is not rematerialized');

  instance.destroy();
  assertEqual(npcObject.destroyed, true, 'destroy() called on visual npc');
  assertEqual(instance.npcObjects.length, 0, 'npc collection cleared');
  assertEqual(instance.npcIds.size, 0, 'npc id set cleared');

  // 12–13. Repeat destroy is safe
  instance.destroy();
  instance.destroyNpcs();
  assertEqual(instance.npcObjects.length, 0, 'repeat cleanup stays empty');

  second.instance.destroy();
}

// 14–15. TREE/ROCK lifecycle unaffected by missing/present npcs
{
  const treeDescriptor = {
    type: 'TREE',
    localTileX: 2,
    localTileY: 3,
    variant: 0
  };
  const withNpc = createInstance(createChunkData({
    objects: [treeDescriptor],
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 5, localTileY: 5 }]
  }));
  const withoutNpc = createInstance(createChunkData({
    objects: [treeDescriptor],
    npcs: []
  }));

  assertEqual(withNpc.created.length, 1, 'tree still created with npc present');
  assertEqual(withoutNpc.created.length, 1, 'tree still created without npc');
  assertEqual(withNpc.created[0].type, 'TREE', 'created runtime object is TREE');
  assertEqual(withNpc.instance.npcObjects.length, 1, 'npc collection separate from resources');
  assertEqual(withoutNpc.instance.npcObjects.length, 0, 'no npc when array empty');

  withNpc.instance.destroy();
  withoutNpc.instance.destroy();
  assertEqual(withNpc.destroyed.length, 1, 'tree unload callback still fires');
  assertEqual(withoutNpc.destroyed.length, 1, 'tree unload callback fires without npc');
}

console.log('test-npc-visual: ok');
