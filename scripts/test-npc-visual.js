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
    width: 28,
    height: 28,
    displayWidth: 28,
    displayHeight: 28,
    textureKey,
    body: null,
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
      this.body = null;
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

function createPlayerMock() {
  return {
    x: 0,
    y: 0,
    destroyed: false,
    body: {
      enable: true,
      width: 40,
      height: 40
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

function createSceneMock(options = {}) {
  const textures = new Set();
  const images = [];
  const tweens = [];
  const timers = [];
  const existingCalls = [];
  const colliderCalls = [];
  const includePlayer = options.includePlayer !== false;
  const player = includePlayer ? createPlayerMock() : null;

  const scene = {
    images,
    tweensList: tweens,
    timersList: timers,
    existingCalls,
    colliderCalls,
    player,
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
    },
    physics: {
      add: {
        existing(gameObject) {
          existingCalls.push(gameObject);
          const body = {
            allowGravity: true,
            immovable: false,
            moves: true,
            width: gameObject.displayWidth || 28,
            height: gameObject.displayHeight || 28,
            offset: { x: 0, y: 0 },
            x: gameObject.x,
            y: gameObject.y,
            setAllowGravity(value) { this.allowGravity = value; return this; },
            setImmovable(value) { this.immovable = value; return this; },
            setSize(width, height) { this.width = width; this.height = height; return this; },
            setOffset(x, y) { this.offset.x = x; this.offset.y = y; return this; },
            reset(x, y) {
              this.x = x;
              this.y = y;
            },
            updateFromGameObject() {
              this.x = gameObject.x;
              this.y = gameObject.y;
            }
          };
          gameObject.body = body;
          return gameObject;
        },
        collider(object1, object2, callback) {
          const collider = {
            object1,
            object2,
            callback: callback || null,
            destroyed: false,
            destroy() { this.destroyed = true; }
          };
          colliderCalls.push(collider);
          return collider;
        }
      }
    }
  };

  return scene;
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
  const { sceneOptions, ...chunkOptions } = options;
  const scene = createSceneMock(sceneOptions || {});
  const blockingGroup = createBlockingGroupMock();
  const created = [];
  const destroyed = [];
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup,
    onObjectCreated: (runtimeObject) => created.push(runtimeObject),
    onObjectDestroyed: (id) => destroyed.push(id),
    ...chunkOptions
  });
  return { instance, scene, blockingGroup, created, destroyed };
}

function rabbitImagesOf(scene) {
  return scene.images.filter((image) => image.textureKey === 'rabbit-placeholder');
}

function expectedRabbitBody(frameWidth = 28, frameHeight = 28) {
  const bodyWidth = Math.max(8, Math.round(frameWidth * 0.5));
  const bodyHeight = Math.max(6, Math.round(frameHeight * 0.36));
  const offsetX = Math.round((frameWidth - bodyWidth) / 2);
  const offsetY = Math.round(frameHeight - bodyHeight - Math.max(2, Math.round(frameHeight * 0.08)));
  return { bodyWidth, bodyHeight, offsetX, offsetY };
}

// Source guard: no velocity/menu/save APIs in ChunkInstance NPC path
{
  const source = fs.readFileSync(path.join(root, 'src/world/ChunkInstance.js'), 'utf8');
  assert(!/\bsetVelocity\b/.test(source), 'ChunkInstance must not call setVelocity');
  assert(!/\bacceleration\b/.test(source), 'ChunkInstance must not use acceleration');
  assert(!/\boverlap\b/.test(source), 'ChunkInstance must not use overlap');
  assert(!/\bMath\.random\s*\(/.test(source), 'ChunkInstance must not call Math.random');
  assert(!/\bSaveSystem\b/.test(source), 'ChunkInstance must not call SaveSystem');
  assert(!/\bMenuScene\b/.test(source), 'ChunkInstance must not reference MenuScene');
  assert(!/\bscene\.start\b/.test(source), 'ChunkInstance must not call scene.start');
  assert(!/\bscene\.stop\b/.test(source), 'ChunkInstance must not call scene.stop');
}

// 1. Missing npcs field
{
  resetWanderCalls();
  const data = createChunkData();
  delete data.npcs;
  const { instance, scene } = createInstance(data);
  assertEqual(instance.npcObjects.length, 0, 'missing npcs creates no visuals');
  assertEqual(getWanderCallCount(), 0, 'no wander planning without rabbits');
  assertEqual(scene.existingCalls.length, 0, 'no body without rabbits');
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

// 4. Unknown type skipped — no body
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [{ type: 'WOLF', index: 0, localTileX: 3, localTileY: 4 }]
  }));
  assertEqual(instance.npcObjects.length, 0, 'unknown type skipped');
  assertEqual(scene.images.length, 0, 'unknown type creates no image');
  assertEqual(getWanderCallCount(), 0, 'unknown type does not plan wander');
  assertEqual(scene.existingCalls.length, 0, 'unknown type creates no body');
  assertEqual(scene.colliderCalls.length, 0, 'unknown type creates no collider');
  instance.destroy();
}

// Full wander + physics cycle
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
  const bodyExpect = expectedRabbitBody(28, 28);

  const { instance, scene } = createInstance(chunkData);
  const npcObject = instance.npcObjects[0];
  const player = scene.player;
  const startPos = ChunkMath.localTileCenterWorld(1, -2, 4, 7);

  assertEqual(instance.npcObjects.length, 1, 'one rabbit creates one visual');
  assertEqual(rabbitImagesOf(scene).length, 1, 'one rabbit image created');
  assertEqual(npcObject.getData('npcId'), npcId, 'npcId stored');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged');
  assertEqual(JSON.stringify(objects), objectsSnapshot, 'resource descriptors unchanged');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'chunkData unchanged');

  assertEqual(scene.existingCalls.length, 1, 'physics.add.existing once');
  assertEqual(scene.existingCalls[0], npcObject, 'existing called for rabbit image');
  assert(npcObject.body, 'rabbit has body');
  assertEqual(npcObject.body.allowGravity, false, 'allowGravity false');
  assertEqual(npcObject.body.immovable, true, 'immovable true');
  assertEqual(npcObject.body.moves, false, 'body.moves false for tween follow');
  assertEqual(npcObject.body.width, bodyExpect.bodyWidth, 'body width reduced');
  assertEqual(npcObject.body.height, bodyExpect.bodyHeight, 'body height reduced');
  assertEqual(npcObject.body.offset.x, bodyExpect.offsetX, 'body offset X centered');
  assertEqual(npcObject.body.offset.y, bodyExpect.offsetY, 'body offset Y lower');
  assert(npcObject.body.width < npcObject.displayWidth, 'body smaller than full width');
  assert(npcObject.body.height < npcObject.displayHeight, 'body smaller than full height');

  assertEqual(scene.colliderCalls.length, 1, 'one collider created');
  assertEqual(scene.colliderCalls[0].object1, npcObject, 'collider object1 is rabbit');
  assertEqual(scene.colliderCalls[0].object2, player, 'collider object2 is player');
  assertEqual(scene.colliderCalls[0].callback, null, 'collider has no gameplay callback');
  assertEqual(npcObject._npcPlayerCollider, scene.colliderCalls[0], 'collider stored on NPC');

  assertEqual(getWanderCallCount(), 1, 'physics setup does not add extra wander plan');
  const firstPlan = getWanderCalls()[0];
  assertEqual(firstPlan.localTileX, 4, 'first plan uses start local X');
  assertEqual(firstPlan.localTileY, 7, 'first plan uses start local Y');
  assertEqual(firstPlan.randomValue, expectedRandom0, 'uses buildNpcWanderRandomValue(npcId, 0)');
  assert(firstPlan.blockedCells.includes('4,6'), 'blockedCells contains TREE');
  assert(firstPlan.blockedCells.includes('5,7'), 'blockedCells contains ROCK');

  const expectedTarget = chooseNpcWanderTarget({
    localTileX: 4,
    localTileY: 7,
    chunkSize: ChunkMath.CHUNK_SIZE,
    blockedCells: new Set(['4,6', '5,7']),
    randomValue: expectedRandom0
  });
  assert(expectedTarget, 'expected open neighbor target');
  assertEqual(scene.tweensList.length, 1, 'wander tween still created');
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
  assert(!Object.prototype.hasOwnProperty.call(tween.config, 'velocity'), 'tween has no velocity');
  assertEqual(npcObject.getData('currentLocalTileX'), 4, 'current X unchanged before onComplete');
  assertEqual(npcObject.getData('currentLocalTileY'), 7, 'current Y unchanged before onComplete');
  assertEqual(npcObject.x, startPos.x, 'visual x unchanged before onComplete');

  tween.complete();
  assertEqual(npcObject.getData('currentLocalTileX'), expectedTarget.localTileX, 'current X after tween');
  assertEqual(npcObject.getData('currentLocalTileY'), expectedTarget.localTileY, 'current Y after tween');
  assertEqual(npcObject.x, expectedWorld.x, 'visual x after tween');
  assertEqual(npcObject.y, expectedWorld.y, 'visual y after tween');
  assertEqual(npcObject.body.x, expectedWorld.x, 'body x synced after tween');
  assertEqual(npcObject.body.y, expectedWorld.y, 'body y synced after tween');
  assertEqual(scene.timersList.length, 1, 'wait timer after tween');
  assertEqual(getWanderCallCount(), 1, 'no second plan until timer');

  scene.timersList[0].fire();
  assertEqual(getWanderCallCount(), 2, 'timer starts next attempt');
  assertEqual(scene.tweensList.length, 2, 'second tween created');
  assertEqual(scene.existingCalls.length, 1, 'still one body setup');
  assertEqual(scene.colliderCalls.length, 1, 'still one collider');

  const activeTween = scene.tweensList[1];
  const collider = npcObject._npcPlayerCollider;
  instance.destroy();
  assertEqual(activeTween.stopped, true, 'destroy stops tween');
  assertEqual(collider.destroyed, true, 'destroy removes collider');
  assertEqual(npcObject.destroyed, true, 'NPC image destroyed');
  assertEqual(npcObject._npcPlayerCollider, null, 'collider ref cleared');
  assertEqual(player.destroyed, false, 'player not destroyed');
  assertEqual(instance.npcObjects.length, 0, 'npc collection cleared');

  const tweensAfterDestroy = scene.tweensList.length;
  const timersAfterDestroy = scene.timersList.length;
  const plansAfterDestroy = getWanderCallCount();
  activeTween.complete();
  assertEqual(getWanderCallCount(), plansAfterDestroy, 'callback after destroy does not replan');
  assertEqual(scene.tweensList.length, tweensAfterDestroy, 'callback after destroy creates no tween');
  assertEqual(scene.timersList.length, timersAfterDestroy, 'callback after destroy creates no timer');

  instance.destroy();
  instance.destroyNpcs();
  assertEqual(instance.npcObjects.length, 0, 'repeat destroy safe');
}

// Missing player: no crash, body still created, no collider
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 5, localTileY: 5 }]
  }), { sceneOptions: { includePlayer: false } });
  const npcObject = instance.npcObjects[0];
  assertEqual(scene.existingCalls.length, 1, 'body created without player');
  assert(npcObject.body, 'body exists without player');
  assertEqual(scene.colliderCalls.length, 0, 'no collider without player');
  assertEqual(npcObject._npcPlayerCollider, null, 'collider ref null without player');
  assertEqual(getWanderCallCount(), 1, 'wander still starts without player');
  assertEqual(scene.tweensList.length, 1, 'tween still created without player');
  instance.destroy();
}

// Null target: no tween, wait timer
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
  const collider = npcObject._npcPlayerCollider;

  assertEqual(getWanderCallCount(), 1, 'null-target still plans once');
  assertEqual(npcObject.getData('wanderTargetLocalTileX'), null, 'null target X');
  assertEqual(npcObject.getData('wanderTargetLocalTileY'), null, 'null target Y');
  assertEqual(scene.tweensList.length, 0, 'null target creates no tween');
  assertEqual(scene.timersList.length, 1, 'null target creates wait timer');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged on null');
  assertEqual(scene.existingCalls.length, 1, 'body still created on null target');
  assertEqual(scene.colliderCalls.length, 1, 'collider still created on null target');

  const timer = scene.timersList[0];
  instance.destroy();
  assertEqual(timer.removed, true, 'destroy removes wait timer');
  assertEqual(collider.destroyed, true, 'destroy removes collider on null-target path');
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
  assertEqual(withoutNpc.scene.existingCalls.length, 0, 'no rabbit body without npc');
  assertEqual(withoutNpc.scene.colliderCalls.length, 0, 'no rabbit collider without npc');

  withNpc.instance.destroy();
  withoutNpc.instance.destroy();
  assertEqual(withNpc.destroyed.length, 1, 'tree unload callback still fires');
  assertEqual(withoutNpc.destroyed.length, 1, 'tree unload callback fires without npc');
}

console.log('test-npc-visual: ok');
