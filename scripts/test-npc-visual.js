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

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert(error instanceof Error, `${message}: expected Error`);
  }
  assert(threw, `${message}: expected throw`);
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
    setDisplaySize(displayWidth, displayHeight) {
      this.displayWidth = displayWidth;
      this.displayHeight = displayHeight;
      this.scaleX = this.width ? displayWidth / this.width : 1;
      this.scaleY = this.height ? displayHeight / this.height : 1;
      return this;
    },
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
  const groundItems = [];
  const includePlayer = options.includePlayer !== false;
  const player = includePlayer ? createPlayerMock() : null;

  const scene = {
    images,
    tweensList: tweens,
    timersList: timers,
    existingCalls,
    colliderCalls,
    groundItems,
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
      },
      text() {
        return {
          setOrigin() { return this; },
          setDepth() { return this; },
          setText() { return this; },
          destroy() {},
          active: true
        };
      }
    },
    groundItemSystem: {
      spawn(itemType, quantity, x, y) {
        const item = {
          id: `ground-item-${groundItems.length + 1}`,
          itemType,
          quantity,
          x,
          y,
          active: true,
          visualObject: { active: true, visible: true }
        };
        groundItems.push(item);
        return item;
      },
      getItems() {
        return groundItems.filter((item) => item.active);
      },
      remove(itemId) {
        const item = groundItems.find((candidate) => candidate.id === itemId && candidate.active);
        if (!item) return false;
        item.active = false;
        return true;
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
  'src/data/PassiveNpcConfig.js',
  'src/data/HostileNpcConfig.js',
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkResourceIds.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
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
;exports.PassiveNpcConfig = PassiveNpcConfig;
;exports.getPassiveNpcConfig = getPassiveNpcConfig;
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
  PassiveNpcConfig,
  getPassiveNpcConfig,
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
  const removedNpcMarks = [];
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup,
    onObjectCreated: (runtimeObject) => created.push(runtimeObject),
    onObjectDestroyed: (id) => destroyed.push(id),
    onNpcRemoved: (id) => removedNpcMarks.push(id),
    ...chunkOptions
  });
  return { instance, scene, blockingGroup, created, destroyed, removedNpcMarks };
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

// HP / damage / death lifecycle + meat drop
{
  resetWanderCalls();
  const descriptor = {
    type: 'RABBIT',
    index: 0,
    localTileX: 5,
    localTileY: 5
  };
  const descriptorSnapshot = JSON.stringify(descriptor);
  const treeDescriptor = {
    type: 'TREE',
    localTileX: 2,
    localTileY: 3,
    variant: 0
  };
  const chunkData = createChunkData({
    objects: [treeDescriptor],
    npcs: [descriptor]
  });
  const chunkDataSnapshot = JSON.stringify(chunkData);
  const { instance, scene, created } = createInstance(chunkData);
  const npcObject = instance.npcObjects[0];
  const player = scene.player;
  const npcId = npcObject.getData('npcId');
  const collider = npcObject._npcPlayerCollider;
  const firstTween = scene.tweensList[0];
  const startStep = npcObject.getData('wanderStepIndex');
  const plansAtStart = getWanderCallCount();
  const deathX = npcObject.x;
  const deathY = npcObject.y;

  assertEqual(npcObject.getData('maxHp'), 6, 'maxHp = 6');
  assertEqual(npcObject.getData('hp'), 6, 'hp = 6');
  assertEqual(npcObject.getData('dead'), false, 'dead = false');
  assertEqual(collider.callback, null, 'player collider has no damage callback');
  assertEqual(scene.groundItems.length, 0, 'no loot while alive');

  const hit = instance.getNearestAttackableNpc(npcObject.x, npcObject.y, 52);
  assertEqual(hit, npcObject, 'attack range finds rabbit');
  assertEqual(
    instance.getNearestAttackableNpc(npcObject.x + 200, npcObject.y, 52),
    null,
    'out of range returns null'
  );

  const first = instance.applyNpcDamage(npcObject, 1);
  assertEqual(first.damage, 1, 'damage 1 applied');
  assertEqual(first.health, 5, 'hp 6 → 5');
  assertEqual(first.died, false, 'still alive after 1');
  assertEqual(npcObject.getData('hp'), 5, 'stored hp is 5');
  assertEqual(npcObject.getData('dead'), false, 'not dead yet');
  assertEqual(scene.groundItems.length, 0, 'no loot while hp > 0');
  assertEqual(getWanderCallCount(), plansAtStart, 'damage does not start extra wander cycle');
  assertEqual(npcObject.getData('wanderStepIndex'), startStep, 'damage does not change stepIndex');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged by damage');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'chunkData unchanged by damage');

  const second = instance.applyNpcDamage(npcObject, 1);
  assertEqual(second.health, 4, 'next damage uses current hp');

  assertThrows(() => instance.applyNpcDamage(npcObject, 0), 'invalid damage 0 throws');
  assertThrows(() => instance.applyNpcDamage(npcObject, -1), 'invalid damage negative throws');
  assertThrows(() => instance.applyNpcDamage(npcObject, Number.NaN), 'invalid damage NaN throws');
  assertEqual(npcObject.getData('hp'), 4, 'invalid damage does not change hp');

  const lethal = instance.applyNpcDamage(npcObject, 10);
  assertEqual(lethal.damage, 4, 'large damage clamped to remaining hp');
  assertEqual(lethal.health, 0, 'hp becomes 0');
  assertEqual(lethal.died, true, 'death triggered once');
  assertEqual(npcObject.getData('hp'), 0, 'hp stored as 0');
  assertEqual(npcObject.getData('dead'), true, 'dead true');
  assert(npcObject.getData('hp') >= 0, 'hp never negative');

  assertEqual(scene.groundItems.length, 1, 'exactly one ground item on death');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'loot type is RAW_MEAT');
  assertEqual(scene.groundItems[0].quantity, 1, 'loot quantity is 1');
  assertEqual(scene.groundItems[0].x, deathX, 'loot x matches death position');
  assertEqual(scene.groundItems[0].y, deathY, 'loot y matches death position');
  assert(!scene.groundItems[0]._npcPlayerCollider, 'drop has no rabbit collider');

  assertEqual(firstTween.stopped, true, 'death stops active tween');
  assertEqual(collider.destroyed, true, 'death destroys collider');
  assertEqual(npcObject._npcWanderTween, null, 'tween ref cleared');
  assertEqual(npcObject._npcWanderTimer, null, 'timer ref cleared');
  assertEqual(npcObject._npcPlayerCollider, null, 'collider ref cleared');
  assertEqual(npcObject.destroyed, true, 'visual destroyed');
  assertEqual(npcObject.body, null, 'body gone with visual');
  assertEqual(instance.npcObjects.length, 0, 'removed from npcObjects');
  assertEqual(instance.npcIds.has(npcId), false, 'npcId removed from npcIds');
  assertEqual(player.destroyed, false, 'player not destroyed');
  assertEqual(created.length, 1, 'TREE lifecycle unchanged');
  assertEqual(created[0].type, 'TREE', 'TREE still present');

  const afterDead = instance.applyNpcDamage(npcObject, 1);
  assertEqual(afterDead.damage, 0, 'damage after dead ignored');
  assertEqual(afterDead.died, false, 'no second death');
  assertEqual(instance.killNpc(npcObject), false, 'repeat killNpc safe');
  assertEqual(scene.groundItems.length, 1, 'repeat death does not create second loot');

  const plansAfterDeath = getWanderCallCount();
  const tweensAfterDeath = scene.tweensList.length;
  const timersAfterDeath = scene.timersList.length;
  const lootAfterDeath = scene.groundItems.length;
  firstTween.complete();
  assertEqual(getWanderCallCount(), plansAfterDeath, 'dead tween callback does not replan');
  assertEqual(scene.tweensList.length, tweensAfterDeath, 'dead tween callback creates no tween');
  assertEqual(scene.timersList.length, timersAfterDeath, 'dead tween callback creates no timer');
  assertEqual(scene.groundItems.length, lootAfterDeath, 'dead tween callback creates no loot');

  instance.destroy();
  assertEqual(instance.npcObjects.length, 0, 'destroy after death safe');
  assertEqual(scene.groundItems.length, 1, 'unload after death does not duplicate loot');
}

// Damage after ChunkInstance.destroy ignored; unload living NPC is not death and drops no loot
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 4, localTileY: 4 }]
  }));
  const npcObject = instance.npcObjects[0];
  assertEqual(npcObject.getData('dead'), false, 'alive before unload');
  assertEqual(npcObject.getData('hp'), 6, 'full hp before unload');
  instance.destroy();
  assertEqual(npcObject.destroyed, true, 'unload destroys visual');
  assertEqual(npcObject.getData('dead'), false, 'unload is not death flow');
  assertEqual(scene.groundItems.length, 0, 'unload living NPC creates no loot');
  const afterUnload = instance.applyNpcDamage(npcObject, 1);
  assertEqual(afterUnload.damage, 0, 'damage after destroy ignored');
  assertEqual(afterUnload.died, false, 'no death after destroy');
  assertEqual(scene.player.destroyed, false, 'player survives unload');
  assertEqual(scene.groundItems.length, 0, 'damage after unload creates no loot');
}

// Two rabbits → two separate meat drops; pickup via ground-item API
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [
      { type: 'RABBIT', index: 0, localTileX: 3, localTileY: 3 },
      { type: 'RABBIT', index: 1, localTileX: 8, localTileY: 8 }
    ]
  }));
  assertEqual(instance.npcObjects.length, 2, 'two rabbits created');
  const firstNpc = instance.npcObjects[0];
  const secondNpc = instance.npcObjects[1];
  const firstPos = { x: firstNpc.x, y: firstNpc.y };
  const secondPos = { x: secondNpc.x, y: secondNpc.y };

  instance.applyNpcDamage(firstNpc, 10);
  assertEqual(scene.groundItems.length, 1, 'first death drops one item');
  instance.applyNpcDamage(secondNpc, 10);
  assertEqual(scene.groundItems.length, 2, 'second death drops second item');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'first drop RAW_MEAT');
  assertEqual(scene.groundItems[1].itemType, 'RAW_MEAT', 'second drop RAW_MEAT');
  assertEqual(scene.groundItems[0].quantity, 1, 'first drop qty 1');
  assertEqual(scene.groundItems[1].quantity, 1, 'second drop qty 1');
  assertEqual(scene.groundItems[0].x, firstPos.x, 'first drop at first rabbit');
  assertEqual(scene.groundItems[0].y, firstPos.y, 'first drop y at first rabbit');
  assertEqual(scene.groundItems[1].x, secondPos.x, 'second drop at second rabbit');
  assertEqual(scene.groundItems[1].y, secondPos.y, 'second drop y at second rabbit');

  // Pickup integration: existing ground-item remove + inventory addItem contract
  const inventory = { RAW_MEAT: 0 };
  function pickupGroundItem(item) {
    if (!item || !item.active) return false;
    inventory[item.itemType] = (inventory[item.itemType] || 0) + item.quantity;
    return scene.groundItemSystem.remove(item.id);
  }

  const firstDrop = scene.groundItems[0];
  assert(pickupGroundItem(firstDrop), 'first drop can be picked up');
  assertEqual(inventory.RAW_MEAT, 1, 'inventory gains 1 RAW_MEAT');
  assertEqual(scene.groundItemSystem.getItems().length, 1, 'picked ground item removed');
  assertEqual(pickupGroundItem(firstDrop), false, 'repeat pickup fails');
  assertEqual(inventory.RAW_MEAT, 1, 'repeat pickup does not add again');

  const secondDrop = scene.groundItemSystem.getItems()[0];
  assert(pickupGroundItem(secondDrop), 'second drop can be picked up');
  assertEqual(inventory.RAW_MEAT, 2, 'inventory stacks second RAW_MEAT');
  assertEqual(scene.groundItemSystem.getItems().length, 0, 'all drops collected');

  instance.destroy();
}

// Attack damage constants unchanged; fist kills 6 HP rabbit in one hit
{
  const gameSceneSource = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /PLAYER_MELEE_ATTACK\s*=\s*Object\.freeze\(\{\s*damage:\s*10/.test(gameSceneSource),
    'fist melee damage remains 10'
  );
  assert(
    /findNearestAttackableNpc\s*\(/.test(gameSceneSource),
    'GameScene finds attackable NPCs'
  );
  assert(
    /applyNpcDamage\s*\(/.test(gameSceneSource),
    'GameScene melee path calls applyNpcDamage'
  );
  assert(
    !/handleCreatureDamageResult\s*\(\s*npcTarget/.test(gameSceneSource),
    'NPC hits do not go through creature loot handler'
  );
  const chunkInstanceSource = fs.readFileSync(path.join(root, 'src/world/ChunkInstance.js'), 'utf8');
  const colliderSetup = chunkInstanceSource.match(
    /setupNpcPlayerCollider\([\s\S]*?\n  [a-zA-Z]/
  );
  assert(colliderSetup, 'setupNpcPlayerCollider found');
  assert(
    !/applyNpcDamage/.test(colliderSetup[0]),
    'collider setup does not wire damage callback'
  );
  assert(
    /physics\.add\.collider\(npcObject, player\)/.test(colliderSetup[0]),
    'collider is created without callback args'
  );
  assert(
    /groundItemSystem\.spawn\(\s*lootType\s*,\s*lootQuantity/.test(chunkInstanceSource),
    'death drops config-driven loot via a single groundItemSystem.spawn call'
  );
  assert(
    (chunkInstanceSource.match(/groundItemSystem\.spawn\(/g) || []).length === 1,
    'only one groundItemSystem.spawn call in ChunkInstance (single stack)'
  );
  assert(
    !/inventoryModel\.addItem/.test(chunkInstanceSource),
    'death does not add inventory directly'
  );
}

// Persistent removedNpcIds: skip create + mark on death
{
  resetWanderCalls();
  const removed = new Set();
  const descriptor = {
    type: 'RABBIT',
    index: 0,
    localTileX: 4,
    localTileY: 5
  };
  const descriptorSnapshot = JSON.stringify(descriptor);
  const chunkData = createChunkData({
    objects: [{ type: 'TREE', localTileX: 1, localTileY: 1, variant: 0 }],
    npcs: [descriptor]
  });
  const chunkDataSnapshot = JSON.stringify(chunkData);
  const npcId = buildChunkNpcId(1, -2, 'RABBIT', 0);

  const alive = createInstance(chunkData, {
    isNpcRemoved: (id) => removed.has(id)
  });
  assertEqual(alive.instance.npcObjects.length, 1, 'living rabbit created');
  const npcObject = alive.instance.npcObjects[0];
  assertEqual(npcObject.getData('npcId'), npcId, 'stable npcId');
  assertEqual(alive.removedNpcMarks.length, 0, 'no mark before death');

  const destroyedBeforeMark = [];
  const originalDestroy = npcObject.destroy.bind(npcObject);
  npcObject.destroy = function destroyWithProbe() {
    destroyedBeforeMark.push(alive.removedNpcMarks.slice());
    return originalDestroy();
  };

  alive.instance.applyNpcDamage(npcObject, 10);
  assertEqual(alive.removedNpcMarks.length, 1, 'markNpcRemoved once');
  assertEqual(alive.removedNpcMarks[0], npcId, 'marked stable npcId');
  assert(
    destroyedBeforeMark[0] && destroyedBeforeMark[0].includes(npcId),
    'markNpcRemoved happens before visual destroy'
  );
  assertEqual(alive.scene.groundItems.length, 1, 'still drops 1 RAW_MEAT');
  assertEqual(alive.scene.groundItems[0].itemType, 'RAW_MEAT', 'loot type RAW_MEAT');

  alive.instance.applyNpcDamage(npcObject, 10);
  alive.instance.killNpc(npcObject);
  assertEqual(alive.removedNpcMarks.length, 1, 'repeat death does not remake mark');
  assertEqual(alive.scene.groundItems.length, 1, 'no second loot');

  alive.instance.destroy();
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'descriptor unchanged');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'chunkData unchanged');

  removed.add(npcId);
  resetWanderCalls();
  const skipped = createInstance(chunkData, {
    isNpcRemoved: (id) => removed.has(id)
  });
  assertEqual(skipped.instance.npcObjects.length, 0, 'removed npcId creates no visual');
  assertEqual(skipped.scene.existingCalls.length, 0, 'removed npcId creates no body');
  assertEqual(skipped.scene.colliderCalls.length, 0, 'removed npcId creates no collider');
  assertEqual(skipped.scene.tweensList.length, 0, 'removed npcId creates no tween');
  assertEqual(skipped.scene.timersList.length, 0, 'removed npcId creates no timer');
  assertEqual(getWanderCallCount(), 0, 'removed npcId does not plan wander');
  assertEqual(skipped.instance.npcIds.size, 0, 'removed npcId not in runtime npcIds');
  assertEqual(skipped.created.length, 1, 'TREE still created');
  assertEqual(skipped.created[0].type, 'TREE', 'TREE lifecycle unchanged');
  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'skip does not mutate descriptor');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'skip does not mutate chunkData');
  skipped.instance.destroy();
}

// Unload living NPC does not mark removed
{
  resetWanderCalls();
  const { instance, removedNpcMarks, scene } = createInstance(createChunkData({
    npcs: [{ type: 'RABBIT', index: 0, localTileX: 2, localTileY: 2 }]
  }));
  assertEqual(instance.npcObjects.length, 1, 'living rabbit before unload');
  instance.destroy();
  assertEqual(removedNpcMarks.length, 0, 'unload living NPC does not mark removed');
  assertEqual(scene.groundItems.length, 0, 'unload living NPC creates no loot');
}

// Full export/restore snapshot: killed rabbit stays gone; meat restores; no second meat
{
  resetWanderCalls();
  const removedNpcIds = new Set();
  const treeDescriptor = { type: 'TREE', localTileX: 2, localTileY: 2, variant: 0 };
  const descriptor = { type: 'RABBIT', index: 0, localTileX: 6, localTileY: 6 };
  const chunkData = createChunkData({
    objects: [treeDescriptor],
    npcs: [descriptor]
  });
  const first = createInstance(chunkData, {
    isNpcRemoved: (id) => removedNpcIds.has(id),
    onNpcRemoved: (id) => {
      if (typeof id === 'string' && id.length > 0) removedNpcIds.add(id);
    }
  });
  const npcId = first.instance.npcObjects[0].getData('npcId');
  first.instance.applyNpcDamage(first.instance.npcObjects[0], 10);
  assert(removedNpcIds.has(npcId), 'death adds npcId to owner set');
  assertEqual(first.scene.groundItems.length, 1, 'first death meat exists');

  const exported = {
    removedNpcIds: Array.from(removedNpcIds).sort(),
    groundItems: first.scene.groundItems.map((item) => ({
      itemType: item.itemType,
      quantity: item.quantity,
      x: item.x,
      y: item.y
    }))
  };
  assertEqual(
    JSON.stringify(exported.removedNpcIds),
    JSON.stringify([npcId]),
    'export contains killed npcId'
  );

  first.instance.destroy();

  const restoredRemoved = new Set(exported.removedNpcIds);
  const second = createInstance(chunkData, {
    isNpcRemoved: (id) => restoredRemoved.has(id)
  });
  assertEqual(second.instance.npcObjects.length, 0, 'restored state skips killed rabbit');
  assertEqual(second.scene.existingCalls.length, 0, 'no body after restore skip');
  assertEqual(second.scene.tweensList.length, 0, 'no wander after restore skip');

  // Restore meat through existing ground-item API, not via NPC death.
  exported.groundItems.forEach((item) => {
    second.scene.groundItemSystem.spawn(item.itemType, item.quantity, item.x, item.y);
  });
  assertEqual(second.scene.groundItems.length, 1, 'saved meat restored once');
  assertEqual(second.scene.groundItems[0].itemType, 'RAW_MEAT', 'restored meat type');
  second.instance.destroy();

  // Legacy save without removedNpcIds: rabbit still spawns.
  const legacy = createInstance(chunkData, {
    isNpcRemoved: (id) => new Set([]).has(id)
  });
  assertEqual(legacy.instance.npcObjects.length, 1, 'legacy empty removedNpcIds creates rabbit');
  legacy.instance.destroy();
}

// PIG: runtime creation, physics body from config, wander timings, damage/death/loot
{
  resetWanderCalls();
  const pigConfig = getPassiveNpcConfig('PIG');
  assert(pigConfig, 'PIG config exists');
  const descriptor = { type: 'PIG', index: 0, localTileX: 6, localTileY: 6 };
  const descriptorSnapshot = JSON.stringify(descriptor);
  const chunkData = createChunkData({ npcs: [descriptor] });
  const chunkDataSnapshot = JSON.stringify(chunkData);
  const pigId = buildChunkNpcId(1, -2, 'PIG', 0);
  const rabbitId = buildChunkNpcId(1, -2, 'RABBIT', 0);
  assert(pigId !== rabbitId, 'PIG id differs from RABBIT id');
  assertEqual(pigId, 'chunk_1_-2_NPC_PIG_0', 'PIG stable id format');

  const { instance, scene, removedNpcMarks } = createInstance(chunkData);
  const npcObject = instance.npcObjects[0];

  assertEqual(instance.npcObjects.length, 1, 'one pig created');
  assertEqual(scene.images.length, 1, 'one pig image');
  assertEqual(npcObject.textureKey, 'pig-texture', 'pig uses pig-texture');
  assertEqual(npcObject.getData('npcId'), pigId, 'pig stable npcId stored');
  assertEqual(npcObject.getData('npcType'), 'PIG', 'npcType PIG');
  assertEqual(npcObject.getData('maxHp'), 20, 'pig maxHp 20');
  assertEqual(npcObject.getData('hp'), 20, 'pig hp 20');
  assertEqual(npcObject.getData('dead'), false, 'pig alive');
  assert(instance.npcIds.has(pigId), 'pig id in npcIds');

  // Display size + body from config
  assertEqual(npcObject.displayWidth, pigConfig.renderWidth, 'pig display width from config');
  assertEqual(npcObject.displayHeight, pigConfig.renderHeight, 'pig display height from config');
  assertEqual(scene.existingCalls.length, 1, 'pig gets one physics body');
  assert(npcObject.body, 'pig has body');
  assertEqual(npcObject.body.allowGravity, false, 'pig allowGravity false');
  assertEqual(npcObject.body.immovable, true, 'pig immovable true');
  assertEqual(npcObject.body.moves, false, 'pig body.moves false');
  assertEqual(npcObject.body.width, pigConfig.bodyWidth, 'pig body width from config');
  assertEqual(npcObject.body.height, pigConfig.bodyHeight, 'pig body height from config');
  assertEqual(npcObject.body.offset.x, pigConfig.bodyOffsetX, 'pig body offsetX from config');
  assertEqual(npcObject.body.offset.y, pigConfig.bodyOffsetY, 'pig body offsetY from config');
  assert(pigConfig.bodyWidth > getPassiveNpcConfig('RABBIT').bodyWidth, 'pig body wider than rabbit');

  // Collider, no damage callback
  assertEqual(scene.colliderCalls.length, 1, 'pig gets one collider');
  assertEqual(scene.colliderCalls[0].object1, npcObject, 'collider object1 pig');
  assertEqual(scene.colliderCalls[0].object2, scene.player, 'collider object2 player');
  assertEqual(scene.colliderCalls[0].callback, null, 'pig collider has no damage callback');

  // Wander uses shared flow with pig-specific timings, slower than rabbit
  assertEqual(getWanderCallCount(), 1, 'pig plans wander once');
  assertEqual(scene.tweensList.length, 1, 'pig wander tween created');
  const tween = scene.tweensList[0];
  assertEqual(tween.config.duration, pigConfig.wanderTweenDuration, 'pig tween duration from config');
  assertEqual(tween.config.duration, 700, 'pig tween duration 700');
  assert(
    pigConfig.wanderTweenDuration > getPassiveNpcConfig('RABBIT').wanderTweenDuration,
    'pig moves slower than rabbit'
  );
  tween.complete();
  assertEqual(npcObject.body.x, npcObject.x, 'pig body x synced after tween');
  assertEqual(npcObject.body.y, npcObject.y, 'pig body y synced after tween');
  assertEqual(scene.timersList.length, 1, 'pig pause timer after tween');
  assertEqual(scene.timersList[0].delay, pigConfig.wanderPauseDuration, 'pig pause duration from config');
  assertEqual(scene.timersList[0].delay, 1200, 'pig pause duration 1200');

  // Nearest attackable search includes pig
  assertEqual(
    instance.getNearestAttackableNpc(npcObject.x, npcObject.y, 52),
    npcObject,
    'attack search finds pig'
  );

  assertEqual(JSON.stringify(descriptor), descriptorSnapshot, 'pig descriptor unchanged');
  assertEqual(JSON.stringify(chunkData), chunkDataSnapshot, 'pig chunkData unchanged');
  instance.destroy();
}

// PIG: fist (10) kills in 2 hits; single 3x RAW_MEAT stack
{
  resetWanderCalls();
  const { instance, scene, removedNpcMarks } = createInstance(createChunkData({
    npcs: [{ type: 'PIG', index: 0, localTileX: 6, localTileY: 6 }]
  }));
  const npcObject = instance.npcObjects[0];
  const pigId = npcObject.getData('npcId');
  const deathX = npcObject.x;
  const deathY = npcObject.y;

  const first = instance.applyNpcDamage(npcObject, 10);
  assertEqual(first.health, 10, 'pig 20 -> 10 after fist');
  assertEqual(first.died, false, 'pig alive after one fist');
  assertEqual(scene.groundItems.length, 0, 'no loot while alive');

  const second = instance.applyNpcDamage(npcObject, 10);
  assertEqual(second.health, 0, 'pig dies on second fist');
  assertEqual(second.died, true, 'pig death on second fist');
  assert(npcObject.getData('hp') >= 0, 'pig hp not negative');
  assertEqual(removedNpcMarks.length, 1, 'pig markNpcRemoved once');
  assertEqual(removedNpcMarks[0], pigId, 'pig marked with stable id');

  assertEqual(scene.groundItems.length, 1, 'pig death drops exactly one stack');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'pig loot RAW_MEAT');
  assertEqual(scene.groundItems[0].quantity, 3, 'pig loot quantity 3');
  assertEqual(scene.groundItems[0].x, deathX, 'pig loot at death x');
  assertEqual(scene.groundItems[0].y, deathY, 'pig loot at death y');

  const afterDead = instance.applyNpcDamage(npcObject, 10);
  assertEqual(afterDead.damage, 0, 'damage after pig death ignored');
  assertEqual(instance.killNpc(npcObject), false, 'repeat killNpc safe for pig');
  assertEqual(scene.groundItems.length, 1, 'pig repeat death no second stack');
  instance.destroy();
}

// PIG: stone sword (15) kills in 2 hits
{
  resetWanderCalls();
  const { instance } = createInstance(createChunkData({
    npcs: [{ type: 'PIG', index: 0, localTileX: 6, localTileY: 6 }]
  }));
  const npcObject = instance.npcObjects[0];
  const first = instance.applyNpcDamage(npcObject, 15);
  assertEqual(first.health, 5, 'pig 20 -> 5 after sword');
  assertEqual(first.died, false, 'pig alive after one sword hit');
  const second = instance.applyNpcDamage(npcObject, 15);
  assertEqual(second.damage, 5, 'second sword hit clamped to remaining hp');
  assertEqual(second.health, 0, 'pig dies on second sword hit');
  assertEqual(second.died, true, 'pig death on second sword hit');
  instance.destroy();
}

// PIG persistent death: skip create when removed; unload living pig does not mark removed
{
  resetWanderCalls();
  const removed = new Set();
  const chunkData = createChunkData({
    npcs: [{ type: 'PIG', index: 0, localTileX: 6, localTileY: 6 }]
  });
  const pigId = buildChunkNpcId(1, -2, 'PIG', 0);

  const alive = createInstance(chunkData, { isNpcRemoved: (id) => removed.has(id) });
  assertEqual(alive.instance.npcObjects.length, 1, 'living pig created');
  alive.instance.destroy();
  assertEqual(alive.removedNpcMarks.length, 0, 'unload living pig does not mark removed');
  assertEqual(alive.scene.groundItems.length, 0, 'unload living pig drops no loot');

  removed.add(pigId);
  resetWanderCalls();
  const skipped = createInstance(chunkData, { isNpcRemoved: (id) => removed.has(id) });
  assertEqual(skipped.instance.npcObjects.length, 0, 'removed pig creates no visual');
  assertEqual(skipped.scene.images.length, 0, 'removed pig no image');
  assertEqual(skipped.scene.existingCalls.length, 0, 'removed pig no body');
  assertEqual(skipped.scene.colliderCalls.length, 0, 'removed pig no collider');
  assertEqual(skipped.scene.tweensList.length, 0, 'removed pig no tween');
  assertEqual(skipped.scene.timersList.length, 0, 'removed pig no timer');
  assertEqual(getWanderCallCount(), 0, 'removed pig does not plan wander');
  assertEqual(skipped.instance.npcIds.size, 0, 'removed pig not in npcIds');
  skipped.instance.destroy();
}

// RABBIT + PIG coexist: independent loot quantities
{
  resetWanderCalls();
  const { instance, scene } = createInstance(createChunkData({
    npcs: [
      { type: 'RABBIT', index: 0, localTileX: 3, localTileY: 3 },
      { type: 'PIG', index: 0, localTileX: 10, localTileY: 10 }
    ]
  }));
  assertEqual(instance.npcObjects.length, 2, 'rabbit and pig coexist');
  const rabbit = instance.npcObjects.find((n) => n.getData('npcType') === 'RABBIT');
  const pig = instance.npcObjects.find((n) => n.getData('npcType') === 'PIG');
  assert(rabbit && pig, 'both npc types present');
  assertEqual(rabbit.getData('maxHp'), 6, 'rabbit still 6 hp');
  assertEqual(pig.getData('maxHp'), 20, 'pig 20 hp');

  instance.applyNpcDamage(rabbit, 6);
  instance.applyNpcDamage(pig, 20);
  const rabbitDrop = scene.groundItems.find((i) => i.quantity === 1);
  const pigDrop = scene.groundItems.find((i) => i.quantity === 3);
  assert(rabbitDrop && rabbitDrop.itemType === 'RAW_MEAT', 'rabbit drops 1 RAW_MEAT');
  assert(pigDrop && pigDrop.itemType === 'RAW_MEAT', 'pig drops 3 RAW_MEAT');
  assertEqual(scene.groundItems.length, 2, 'two separate stacks');
  instance.destroy();
}

// LLAMA: runtime creation, body from config, damage/death/loot; PIG/RABBIT unchanged
{
  resetWanderCalls();
  const llamaConfig = getPassiveNpcConfig('LLAMA');
  const pigConfig = getPassiveNpcConfig('PIG');
  const rabbitConfig = getPassiveNpcConfig('RABBIT');
  assert(llamaConfig, 'LLAMA config exists');
  assertEqual(pigConfig.renderWidth, 87, 'PIG render unchanged');
  assertEqual(pigConfig.bodyOffsetX, 171, 'PIG body offset unchanged');
  assertEqual(rabbitConfig.maxHp, 6, 'RABBIT maxHp unchanged');

  const { instance, scene, removedNpcMarks } = createInstance(createChunkData({
    npcs: [{ type: 'LLAMA', index: 0, localTileX: 7, localTileY: 7 }]
  }));
  const npcObject = instance.npcObjects[0];
  const llamaId = buildChunkNpcId(1, -2, 'LLAMA', 0);

  assertEqual(npcObject.textureKey, 'llama-texture', 'llama uses llama-texture');
  assertEqual(npcObject.getData('npcId'), llamaId, 'llama stable id');
  assertEqual(npcObject.getData('maxHp'), 20, 'llama maxHp 20');
  assertEqual(npcObject.getData('hp'), 20, 'llama hp 20');
  assertEqual(npcObject.displayWidth, llamaConfig.renderWidth, 'llama display width');
  assertEqual(npcObject.displayHeight, llamaConfig.renderHeight, 'llama display height');
  assertEqual(npcObject.body.width, llamaConfig.bodyWidth, 'llama body width');
  assertEqual(npcObject.body.height, llamaConfig.bodyHeight, 'llama body height');
  assertEqual(npcObject.body.offset.x, llamaConfig.bodyOffsetX, 'llama body offsetX');
  assertEqual(npcObject.body.offset.y, llamaConfig.bodyOffsetY, 'llama body offsetY');
  assertEqual(scene.colliderCalls.length, 1, 'llama collider');
  assertEqual(scene.colliderCalls[0].callback, null, 'llama touch deals no damage');
  assertEqual(scene.tweensList[0].config.duration, 750, 'llama tween 750');
  scene.tweensList[0].complete();
  assertEqual(scene.timersList[0].delay, 1300, 'llama pause 1300');

  const deathX = npcObject.x;
  const deathY = npcObject.y;
  assertEqual(instance.applyNpcDamage(npcObject, 10).health, 10, 'llama 20->10');
  assertEqual(instance.applyNpcDamage(npcObject, 10).died, true, 'llama dies second fist');
  assertEqual(removedNpcMarks[0], llamaId, 'llama marked removed');
  assertEqual(scene.groundItems.length, 1, 'llama one loot stack');
  assertEqual(scene.groundItems[0].quantity, 3, 'llama loot qty 3');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'llama loot RAW_MEAT');
  assertEqual(scene.groundItems[0].x, deathX, 'llama loot x');
  assertEqual(scene.groundItems[0].y, deathY, 'llama loot y');
  instance.destroy();
}

// BUFFALO: runtime creation, body from config, damage/death/loot; others unchanged
{
  resetWanderCalls();
  const buffaloConfig = getPassiveNpcConfig('BUFFALO');
  const pigConfig = getPassiveNpcConfig('PIG');
  const llamaConfig = getPassiveNpcConfig('LLAMA');
  const rabbitConfig = getPassiveNpcConfig('RABBIT');
  assert(buffaloConfig, 'BUFFALO config exists');
  assertEqual(pigConfig.renderWidth, 87, 'PIG render unchanged');
  assertEqual(llamaConfig.renderWidth, 67, 'LLAMA render unchanged');
  assertEqual(rabbitConfig.maxHp, 6, 'RABBIT maxHp unchanged');

  const { instance, scene, removedNpcMarks } = createInstance(createChunkData({
    npcs: [{ type: 'BUFFALO', index: 0, localTileX: 7, localTileY: 7 }]
  }));
  const npcObject = instance.npcObjects[0];
  const buffaloId = buildChunkNpcId(1, -2, 'BUFFALO', 0);

  assertEqual(npcObject.textureKey, 'buffalo-texture', 'buffalo uses buffalo-texture');
  assertEqual(npcObject.getData('npcId'), buffaloId, 'buffalo stable id');
  assertEqual(npcObject.getData('maxHp'), 35, 'buffalo maxHp 35');
  assertEqual(npcObject.getData('hp'), 35, 'buffalo hp 35');
  assertEqual(npcObject.displayWidth, buffaloConfig.renderWidth, 'buffalo display width');
  assertEqual(npcObject.displayHeight, buffaloConfig.renderHeight, 'buffalo display height');
  assertEqual(npcObject.body.width, buffaloConfig.bodyWidth, 'buffalo body width');
  assertEqual(npcObject.body.height, buffaloConfig.bodyHeight, 'buffalo body height');
  assertEqual(npcObject.body.offset.x, buffaloConfig.bodyOffsetX, 'buffalo body offsetX');
  assertEqual(npcObject.body.offset.y, buffaloConfig.bodyOffsetY, 'buffalo body offsetY');
  assertEqual(scene.colliderCalls.length, 1, 'buffalo collider');
  assertEqual(scene.colliderCalls[0].callback, null, 'buffalo touch deals no damage');
  assertEqual(scene.tweensList[0].config.duration, 900, 'buffalo tween 900');
  scene.tweensList[0].complete();
  assertEqual(scene.timersList[0].delay, 1600, 'buffalo pause 1600');

  const deathX = npcObject.x;
  const deathY = npcObject.y;
  assertEqual(instance.applyNpcDamage(npcObject, 10).health, 25, 'buffalo 35->25');
  assertEqual(instance.applyNpcDamage(npcObject, 10).health, 15, 'buffalo 25->15');
  assertEqual(instance.applyNpcDamage(npcObject, 10).health, 5, 'buffalo 15->5');
  assertEqual(instance.applyNpcDamage(npcObject, 10).died, true, 'buffalo dies fourth fist');
  assertEqual(removedNpcMarks[0], buffaloId, 'buffalo marked removed');
  assertEqual(scene.groundItems.length, 1, 'buffalo one loot stack');
  assertEqual(scene.groundItems[0].quantity, 5, 'buffalo loot qty 5');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'buffalo loot RAW_MEAT');
  assertEqual(scene.groundItems[0].x, deathX, 'buffalo loot x');
  assertEqual(scene.groundItems[0].y, deathY, 'buffalo loot y');

  const removed = new Set([buffaloId]);
  resetWanderCalls();
  const skipped = createInstance(createChunkData({
    npcs: [{ type: 'BUFFALO', index: 0, localTileX: 7, localTileY: 7 }]
  }), { isNpcRemoved: (id) => removed.has(id) });
  assertEqual(skipped.instance.npcObjects.length, 0, 'removed buffalo creates no visual');
  instance.destroy();
  skipped.instance.destroy();
}

console.log('test-npc-visual: ok');
