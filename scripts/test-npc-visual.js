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
      return { centerX: this.x, bottom: this.y + 14 };
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
  const tweens = [];
  const timers = [];
  return {
    images,
    tweensList: tweens,
    timersList: timers,
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
    },
    tweens: {
      add(config) {
        const tween = {
          config,
          stopped: false,
          stop() { this.stopped = true; },
          remove() { this.stopped = true; },
          complete() {
            if (this.stopped) return;
            const target = Array.isArray(config.targets) ? config.targets[0] : config.targets;
            if (target && typeof config.x === 'number') target.x = config.x;
            if (target && typeof config.y === 'number') target.y = config.y;
            if (typeof config.onComplete === 'function') config.onComplete();
          }
        };
        tweens.push(tween);
        return tween;
      }
    },
    time: {
      delayedCall(delay, callback) {
        const timer = {
          delay,
          callback,
          removed: false,
          remove() { this.removed = true; },
          destroy() { this.removed = true; },
          fire() {
            if (this.removed) return;
            if (typeof callback === 'function') callback();
          }
        };
        timers.push(timer);
        return timer;
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
        displayHeight: 28,
        body,
        refreshBody() {},
        setVisible() { return this; },
        setDataEnabled() { return this; },
        setData() { return this; },
        setDepth() { return this; },
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
  'src/world/ChunkNpcWander.js',
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
  `${bundle}
;var __wanderCallCount = 0;
;var __wanderCalls = [];
;var __originalChooseNpcWanderTarget = chooseNpcWanderTarget;
;chooseNpcWanderTarget = function(options) {
  __wanderCallCount += 1;
  __wanderCalls.push({
    localTileX: options.localTileX,
    localTileY: options.localTileY,
    chunkSize: options.chunkSize,
    randomValue: options.randomValue,
    blockedCells: Array.from(options.blockedCells).sort()
  });
  return __originalChooseNpcWanderTarget(options);
};
;exports.ChunkInstance = ChunkInstance;
;exports.ChunkMath = ChunkMath;
;exports.buildChunkNpcId = buildChunkNpcId;
;exports.chooseNpcWanderTarget = __originalChooseNpcWanderTarget;
;exports.buildNpcWanderRandomValue = buildNpcWanderRandomValue;
;exports.getWanderCallCount = function() { return __wanderCallCount; };
;exports.getWanderCalls = function() { return __wanderCalls.slice(); };
;exports.getWanderLastOptions = function() {
  return __wanderCalls.length ? __wanderCalls[__wanderCalls.length - 1] : null;
};
;exports.resetWanderCalls = function() { __wanderCallCount = 0; __wanderCalls = []; };`,
  context,
  { filename: 'npc-visual-bundle.js' }
);

const {
  ChunkInstance,
  ChunkMath,
  buildChunkNpcId,
  chooseNpcWanderTarget,
  buildNpcWanderRandomValue,
  getWanderCallCount,
  getWanderCalls,
  getWanderLastOptions,
  resetWanderCalls
} = context.exports;

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

function rabbitImagesOf(scene) {
  return scene.images.filter((image) => image.textureKey === 'rabbit-placeholder');
}

// 1. Missing npcs field
{
  resetWanderCalls();
  const data = createChunkData();
  delete data.npcs;
  const { instance } = createInstance(data);
  assertEqual(instance.npcObjects.length, 0, 'missing npcs creates no visuals');
  assertEqual(getWanderCallCount(), 0, 'no wander planning without rabbits');
  instance.destroy();
}

// 2. Non-array npcs
{
  resetWanderCalls();
  const { instance } = createInstance(createChunkData({ npcs: { bad: true } }));
  assertEqual(instance.npcObjects.length, 0, 'non-array npcs creates no visuals');
  instance.destroy();
}

// 3. Empty npcs
{
  resetWanderCalls();
  const { instance } = createInstance(createChunkData({ npcs: [] }));
  assertEqual(instance.npcObjects.length, 0, 'empty npcs creates no visuals');
  instance.destroy();
}

// 4. Unknown type skipped
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [{ type: 'WOLF', index: 0, localTileX: 3, localTileY: 4 }]
  }));
  assertEqual(instance.npcObjects.length, 0, 'unknown type skipped');
  assertEqual(scene.images.length, 0, 'unknown type creates no image');
  assertEqual(getWanderCallCount(), 0, 'unknown type does not plan wander');
  instance.destroy();
}

// Full wander cycle: plan → tween → pause → next plan
{
  resetWanderCalls();
  const descriptor = {
    type: 'RABBIT',
    index: 0,
    localTileX: 4,
    localTileY: 7
  };
  const tree = { type: 'TREE', localTileX: 4, localTileY: 6, variant: 0 };
  const rock = { type: 'ROCK', localTileX: 5, localTileY: 7, variant: 0 };
  const invalidTree = { type: 'TREE', localTileX: 1.5, localTileY: 2 };
  const invalidRock = { type: 'ROCK', localTileX: 3, localTileY: null };
  const objects = [tree, rock, invalidTree, invalidRock];
  const objectsSnapshot = JSON.stringify(objects);
  const descriptorSnapshot = JSON.stringify(descriptor);
  const chunkData = createChunkData({
    chunkX: 1,
    chunkY: -2,
    objects,
    npcs: [descriptor]
  });
  const chunkDataSnapshot = JSON.stringify(chunkData);
  const npcId = buildChunkNpcId(1, -2, 'RABBIT', 0);
  const expectedRandom0 = buildNpcWanderRandomValue(npcId, 0);

  const { instance, scene } = createInstance(chunkData);
  const npcObject = instance.npcObjects[0];
  const startPos = ChunkMath.localTileCenterWorld(1, -2, 4, 7);

  assertEqual(instance.npcObjects.length, 1, 'one rabbit creates one visual');
  assertEqual(rabbitImagesOf(scene).length, 1, 'one rabbit image created');
  assertEqual(npcObject.getData('npcId'), npcId, 'npcId stored');
  assertEqual(npcObject.getData('currentLocalTileX'), 4, 'current X starts from descriptor');
  assertEqual(npcObject.getData('currentLocalTileY'), 7, 'current Y starts from descriptor');
  assertEqual(npcObject.getData('wanderStepIndex'), 1, 'stepIndex increments once after first plan');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged');
  assertEqual(JSON.stringify(objects), objectsSnapshot, 'resource descriptors unchanged');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'chunkData unchanged');

  assertEqual(getWanderCallCount(), 1, 'one wander cycle starts with one plan');
  const firstPlan = getWanderCalls()[0];
  assertEqual(firstPlan.localTileX, 4, 'first plan uses start local X');
  assertEqual(firstPlan.localTileY, 7, 'first plan uses start local Y');
  assertEqual(firstPlan.chunkSize, ChunkMath.CHUNK_SIZE, 'passes chunkSize');
  assertEqual(firstPlan.randomValue, expectedRandom0, 'uses buildNpcWanderRandomValue(npcId, 0)');
  assert(firstPlan.blockedCells.includes('4,6'), 'blockedCells contains TREE');
  assert(firstPlan.blockedCells.includes('5,7'), 'blockedCells contains ROCK');
  assert(!firstPlan.blockedCells.includes('1.5,2'), 'invalid TREE excluded');
  assert(!firstPlan.blockedCells.includes('3,null'), 'invalid ROCK excluded');
  assert(!firstPlan.blockedCells.includes('4,7'), 'rabbit cell not blocked');

  const expectedTarget = chooseNpcWanderTarget({
    localTileX: 4,
    localTileY: 7,
    chunkSize: ChunkMath.CHUNK_SIZE,
    blockedCells: new Set(['4,6', '5,7']),
    randomValue: expectedRandom0
  });
  assert(expectedTarget, 'expected open neighbor target');
  assertEqual(npcObject.getData('wanderTargetLocalTileX'), expectedTarget.localTileX, 'target X stored');
  assertEqual(npcObject.getData('wanderTargetLocalTileY'), expectedTarget.localTileY, 'target Y stored');

  assertEqual(scene.tweensList.length, 1, 'one tween created for first move');
  assertEqual(scene.timersList.length, 0, 'no pause timer before tween completes');
  const tween = scene.tweensList[0];
  const expectedWorld = ChunkMath.localTileCenterWorld(
    1,
    -2,
    expectedTarget.localTileX,
    expectedTarget.localTileY
  );
  assertEqual(tween.config.x, expectedWorld.x, 'tween x from localTileCenterWorld');
  assertEqual(tween.config.y, expectedWorld.y, 'tween y from localTileCenterWorld');
  assertEqual(tween.config.duration, 450, 'tween duration 450');
  assertEqual(tween.config.ease, 'Linear', 'tween Linear easing');
  assertEqual(npcObject.x, startPos.x, 'x unchanged before onComplete');
  assertEqual(npcObject.y, startPos.y, 'y unchanged before onComplete');
  assertEqual(npcObject.getData('currentLocalTileX'), 4, 'current X unchanged before onComplete');
  assertEqual(npcObject.getData('currentLocalTileY'), 7, 'current Y unchanged before onComplete');

  tween.complete();
  assertEqual(npcObject.getData('currentLocalTileX'), expectedTarget.localTileX, 'current X updates after tween');
  assertEqual(npcObject.getData('currentLocalTileY'), expectedTarget.localTileY, 'current Y updates after tween');
  assertEqual(npcObject.x, expectedWorld.x, 'image x matches target after tween');
  assertEqual(npcObject.y, expectedWorld.y, 'image y matches target after tween');
  assertEqual(scene.timersList.length, 1, 'one wait timer after tween');
  assertEqual(scene.timersList[0].delay, 900, 'pause delay 900');
  assertEqual(getWanderCallCount(), 1, 'no second plan until timer fires');

  scene.timersList[0].fire();
  assertEqual(getWanderCallCount(), 2, 'timer starts next attempt');
  const secondPlan = getWanderCalls()[1];
  assertEqual(secondPlan.localTileX, expectedTarget.localTileX, 'next plan uses updated local X');
  assertEqual(secondPlan.localTileY, expectedTarget.localTileY, 'next plan uses updated local Y');
  assertEqual(
    secondPlan.randomValue,
    buildNpcWanderRandomValue(npcId, 1),
    'second plan uses stepIndex 1'
  );
  assertEqual(npcObject.getData('wanderStepIndex'), 2, 'stepIndex increments once per plan');
  assertEqual(scene.tweensList.length, 2, 'second tween created for next move');
  assertEqual(scene.timersList.length, 1, 'previous timer consumed; no parallel pause yet');

  // No parallel cycles from duplicate createNpcs
  const tweensBefore = scene.tweensList.length;
  const plansBefore = getWanderCallCount();
  instance.createNpcs({
    objects,
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 4, localTileY: 7 }]
  });
  assertEqual(instance.npcObjects.length, 1, 'duplicate npcId not rematerialized');
  assertEqual(getWanderCallCount(), plansBefore, 'duplicate id does not start parallel cycle');
  assertEqual(scene.tweensList.length, tweensBefore, 'duplicate id does not add tween');

  const activeTween = scene.tweensList[1];
  instance.destroy();
  assertEqual(activeTween.stopped, true, 'destroy stops active tween');
  assertEqual(npcObject.destroyed, true, 'NPC image destroyed');
  assertEqual(instance.npcObjects.length, 0, 'npc collection cleared');
  assertEqual(instance.npcIds.size, 0, 'npc id set cleared');

  const tweensAfterDestroy = scene.tweensList.length;
  const timersAfterDestroy = scene.timersList.length;
  activeTween.complete();
  assertEqual(scene.tweensList.length, tweensAfterDestroy, 'callback after destroy creates no tween');
  assertEqual(scene.timersList.length, timersAfterDestroy, 'callback after destroy creates no timer');

  instance.destroy();
  instance.destroyNpcs();
  assertEqual(instance.npcObjects.length, 0, 'repeat destroy safe');
}

// Null target: no tween, wait timer, then retry
{
  resetWanderCalls();
  const descriptor = {
    type: 'RABBIT',
    index: 0,
    localTileX: 4,
    localTileY: 7
  };
  const descriptorSnapshot = JSON.stringify(descriptor);
  const objects = [
    { type: 'TREE', localTileX: 4, localTileY: 6 },
    { type: 'ROCK', localTileX: 5, localTileY: 7 },
    { type: 'TREE', localTileX: 4, localTileY: 8 },
    { type: 'ROCK', localTileX: 3, localTileY: 7 }
  ];
  const { instance, scene } = createInstance(createChunkData({
    objects,
    npcs: [descriptor]
  }));
  const npcObject = instance.npcObjects[0];
  const startX = npcObject.x;
  const startY = npcObject.y;

  assertEqual(getWanderCallCount(), 1, 'null-target still plans once');
  assertEqual(npcObject.getData('wanderTargetLocalTileX'), null, 'null target X');
  assertEqual(npcObject.getData('wanderTargetLocalTileY'), null, 'null target Y');
  assertEqual(scene.tweensList.length, 0, 'null target creates no tween');
  assertEqual(scene.timersList.length, 1, 'null target creates wait timer');
  assertEqual(npcObject.x, startX, 'x unchanged on null target');
  assertEqual(npcObject.y, startY, 'y unchanged on null target');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged on null');

  const timer = scene.timersList[0];
  instance.destroy();
  assertEqual(timer.removed, true, 'destroy removes wait timer');

  const tweensBefore = scene.tweensList.length;
  const timersBefore = scene.timersList.length;
  const plansBefore = getWanderCallCount();
  timer.fire();
  assertEqual(getWanderCallCount(), plansBefore, 'timer callback after destroy does not replan');
  assertEqual(scene.tweensList.length, tweensBefore, 'timer callback after destroy creates no tween');
  assertEqual(scene.timersList.length, timersBefore, 'timer callback after destroy creates no timer');
}

// TREE/ROCK lifecycle unaffected
{
  resetWanderCalls();
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
