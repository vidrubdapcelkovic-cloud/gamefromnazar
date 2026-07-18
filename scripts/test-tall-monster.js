const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');

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
  'src/data/PassiveNpcConfig.js',
  'src/data/HostileNpcConfig.js',
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkNpcIds.js',
  'src/world/ChunkNpcWander.js',
  'src/world/HostileNpcController.js',
  'src/world/ChunkInstance.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.getPassiveNpcConfig = getPassiveNpcConfig;
;exports.getHostileNpcConfig = getHostileNpcConfig;
;exports.isHostileNpcType = isHostileNpcType;
;exports.ChunkGenerator = ChunkGenerator;
;exports.buildChunkNpcId = buildChunkNpcId;
;exports.buildChunkEnemyId = buildChunkEnemyId;
;exports.ChunkInstance = ChunkInstance;
;exports.ChunkMath = ChunkMath;`,
  context,
  { filename: 'tall-monster-bundle.js' }
);

const {
  getPassiveNpcConfig,
  getHostileNpcConfig,
  ChunkGenerator,
  buildChunkNpcId,
  buildChunkEnemyId,
  ChunkInstance,
  ChunkMath
} = context.exports;
const prepare = require('./prepare-tall-monster-asset.js');

const CONTENT_W = 359;
const CONTENT_H = 1273;
const TEX_W = 391;
const TEX_H = 1305;

// Config
{
  const rabbit = getPassiveNpcConfig('RABBIT');
  const pig = getPassiveNpcConfig('PIG');
  const llama = getPassiveNpcConfig('LLAMA');
  const buffalo = getPassiveNpcConfig('BUFFALO');
  const tall = getHostileNpcConfig('TALL_MONSTER');
  assert(tall, 'TALL_MONSTER config');

  assertEqual(rabbit.maxHp, 6, 'RABBIT unchanged');
  assertEqual(pig.renderWidth, 87, 'PIG unchanged');
  assertEqual(llama.renderWidth, 67, 'LLAMA unchanged');
  assertEqual(buffalo.renderWidth, 119, 'BUFFALO unchanged');

  assertEqual(tall.textureKey, 'tall-monster-texture', 'textureKey');
  assertEqual(tall.maxHp, 30, 'maxHp');
  assertEqual(tall.lootType, 'RAW_MEAT', 'lootType');
  assertEqual(tall.lootQuantity, 2, 'lootQuantity');
  assertEqual(tall.detectionRadius, 150, 'detectionRadius');
  assertEqual(tall.disengageRadius, 230, 'disengageRadius');
  assertEqual(tall.attackRange, 30, 'attackRange');
  assertEqual(tall.attackDamage, 5, 'attackDamage');
  assertEqual(tall.attackCooldown, 1000, 'attackCooldown');
  assertEqual(tall.chaseSpeed, 55, 'chaseSpeed');
  assertEqual(tall.wanderTweenDuration, 850, 'wander tween');
  assertEqual(tall.wanderPauseDuration, 1200, 'wander pause');
  assertEqual(tall.returnRadius, 12, 'returnRadius');
  assertEqual(tall.renderWidth, 34, 'renderWidth');
  assertEqual(tall.renderHeight, 113, 'renderHeight');
  assert(tall.renderHeight > llama.renderHeight, 'taller than LLAMA');

  const contentAspect = CONTENT_W / CONTENT_H;
  const visibleW = tall.renderWidth * CONTENT_W / TEX_W;
  const visibleH = tall.renderHeight * CONTENT_H / TEX_H;
  assert(visibleH >= 100 && visibleH <= 120, 'visible height 100..120');
  assert(Math.abs(visibleW / visibleH - contentAspect) < 0.02, 'visible aspect matches');
}

// Generation
{
  const seed = 424242;
  const a = ChunkGenerator.generate(seed, 5, 3);
  const b = ChunkGenerator.generate(seed, 5, 3);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'deterministic');

  const generatorSource = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(generatorSource.includes("'chunk-enemies-tall-monster'"), 'stream');
  assert(/tallMonsterRng\.next\(\)\s*<\s*0\.10/.test(generatorSource), 'chance 0.10');

  let saw = false;
  let coords = null;
  let tallChunks = 0;
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const talls = chunk.npcs.filter((n) => n.type === 'TALL_MONSTER');
      assert(talls.length <= 1, 'max 1 tall monster');
      if (talls.length) {
        tallChunks += 1;
        if (!saw) {
          saw = true;
          coords = { cx, cy, descriptor: talls[0] };
        }
      }
      const occupied = new Set(chunk.objects.map((o) => `${o.localTileX},${o.localTileY}`));
      chunk.npcs.forEach((n) => {
        const key = `${n.localTileX},${n.localTileY}`;
        assert(!occupied.has(key), 'no overlap');
        occupied.add(key);
      });
    }
  }
  assert(saw, 'appears somewhere');
  assert(tallChunks > 0, 'spawned in survey');
  assertEqual(coords.descriptor.type, 'TALL_MONSTER', 'type');
  assertEqual(coords.descriptor.index, 0, 'index');

  const enemyId = buildChunkEnemyId(coords.cx, coords.cy, 'TALL_MONSTER', 0);
  assertEqual(
    enemyId,
    `chunk_${coords.cx}_${coords.cy}_ENEMY_TALL_MONSTER_0`,
    'stable ENEMY id'
  );
  assertEqual(buildChunkNpcId(0, 0, 'RABBIT', 0), 'chunk_0_0_NPC_RABBIT_0', 'passive id format');

  const startChunk = ChunkGenerator.generate(seed, 0, 0);
  const clearMin = 5;
  const clearMax = 11;
  startChunk.npcs.forEach((entry) => {
    const inClear = entry.localTileX >= clearMin && entry.localTileX <= clearMax
      && entry.localTileY >= clearMin && entry.localTileY <= clearMax;
    assert(!inClear, 'starter safe zone');
  });
}

// Asset
{
  function decodePng(buffer) {
    let o = 8;
    let width = 0;
    let height = 0;
    const idat = [];
    while (o + 8 <= buffer.length) {
      const len = buffer.readUInt32BE(o);
      const type = buffer.slice(o + 4, o + 8).toString('ascii');
      const data = buffer.slice(o + 8, o + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        assertEqual(data[8], 8, 'bit depth');
        assertEqual(data[9], 6, 'RGBA');
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      o += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = 4;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    let ip = 0;
    for (let y = 0; y < height; y += 1) {
      const ft = raw[ip++];
      const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
      for (let i = 0; i < stride; i += 1) {
        const x = raw[ip + i];
        let a = 0;
        let bb = 0;
        let c = 0;
        if (i >= bpp) a = out[y * stride + i - bpp];
        if (prev) bb = prev[i];
        if (prev && i >= bpp) c = prev[i - bpp];
        let v;
        if (ft === 0) v = x;
        else if (ft === 1) v = (x + a) & 255;
        else if (ft === 2) v = (x + bb) & 255;
        else if (ft === 3) v = (x + ((a + bb) >> 1)) & 255;
        else {
          const p = a + bb - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - bb);
          const pc = Math.abs(p - c);
          v = (x + (pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c))) & 255;
        }
        out[y * stride + i] = v;
      }
      ip += stride;
    }
    return { width, height, pixels: out };
  }

  const pngPath = path.join(root, 'assets/generated/tall-monster.png');
  assert(fs.existsSync(pngPath), 'png exists');
  const buffer = fs.readFileSync(pngPath);
  const { width, height, pixels } = decodePng(buffer);
  assertEqual(width, TEX_W, 'width');
  assertEqual(height, TEX_H, 'height');

  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };

  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(px(x, y)[3], 0, `corner transparent ${x},${y}`);
  });

  let borderGreen = 0;
  for (let x = 0; x < width; x += 8) {
    [[x, 0], [x, height - 1]].forEach(([bx, by]) => {
      const [r, g, b, a] = px(bx, by);
      if (a > 32 && g > r + 25 && g > b + 25 && g > 100) borderGreen += 1;
    });
  }
  assertEqual(borderGreen, 0, 'no green border');

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let greenOpaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = px(x, y);
      if (a > prepare.ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (g > 200 && r < 40 && b < 40) greenOpaque += 1;
      }
    }
  }
  assertEqual(greenOpaque, 0, 'no pure greenscreen leftovers');
  assertEqual(minX, prepare.PADDING, 'left pad');
  assertEqual(minY, prepare.PADDING, 'top pad');
  assertEqual(width - 1 - maxX, prepare.PADDING, 'right pad');
  assertEqual(height - 1 - maxY, prepare.PADDING, 'bottom pad');
  assertEqual(maxX - minX + 1, CONTENT_W, 'content width');
  assertEqual(maxY - minY + 1, CONTENT_H, 'content height');

  const tall = getHostileNpcConfig('TALL_MONSTER');
  assert(tall.bodyOffsetX >= 0 && tall.bodyOffsetY >= 0, 'body offsets');
  assert(tall.bodyOffsetX + tall.bodyWidth <= width, 'body X');
  assert(tall.bodyOffsetY + tall.bodyHeight <= height, 'body Y');

  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = prepare.prepareTallMonsterAsset();
  const second = prepare.prepareTallMonsterAsset();
  assertEqual(first.sha256, hashBefore, 'idempotent hash');
  assertEqual(second.sha256, first.sha256, 'second hash');
  assertEqual(first.newWidth, TEX_W, 'idempotent w');
  assertEqual(first.newHeight, TEX_H, 'idempotent h');
  assertEqual(first.contentBBox.contentWidth, CONTENT_W, 'bbox w');
  assertEqual(first.contentBBox.contentHeight, CONTENT_H, 'bbox h');
}

// Runtime mock
{
  function createImageMock(x, y, textureKey) {
    const data = {};
    return {
      x,
      y,
      width: TEX_W,
      height: TEX_H,
      displayWidth: TEX_W,
      displayHeight: TEX_H,
      textureKey,
      body: null,
      destroyed: false,
      setDataEnabled() { return this; },
      setData(key, value) { data[key] = value; return this; },
      getData(key) { return data[key]; },
      setDepth() { return this; },
      setDisplaySize(w, h) {
        this.displayWidth = w;
        this.displayHeight = h;
        return this;
      },
      destroy() { this.destroyed = true; this.body = null; }
    };
  }

  function createScene() {
    const images = [];
    const groundItems = [];
    const tweensList = [];
    const timersList = [];
    const colliderCalls = [];
    return {
      images,
      groundItems,
      tweensList,
      timersList,
      colliderCalls,
      player: { x: 0, y: 0, body: {}, destroyed: false, active: true },
      playerStatsModel: { isDead() { return false; } },
      damageCalls: [],
      damagePlayer(amount) {
        this.damageCalls.push(amount);
        return amount;
      },
      textures: { exists() { return true; } },
      make: { graphics() { return { fillStyle() { return this; }, fillEllipse() { return this; }, fillCircle() { return this; }, generateTexture() { return this; }, destroy() {} }; } },
      add: {
        graphics() {
          return { setDepth() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, destroy() {} };
        },
        image(x, y, key) {
          const img = createImageMock(x, y, key);
          images.push(img);
          return img;
        }
      },
      physics: {
        add: {
          existing(obj) {
            obj.body = {
              width: 0,
              height: 0,
              offset: { x: 0, y: 0 },
              moves: false,
              setAllowGravity() {},
              setImmovable() {},
              setSize(w, h) { this.width = w; this.height = h; },
              setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
              updateFromGameObject() {},
              reset() {}
            };
          },
          collider(a, b) {
            const c = { a, b, destroy() {} };
            colliderCalls.push(c);
            return c;
          }
        }
      },
      tweens: {
        add(config) {
          const tween = {
            config,
            stop() {},
            complete() {
              if (typeof config.onComplete === 'function') config.onComplete();
            }
          };
          tweensList.push(tween);
          return tween;
        }
      },
      time: {
        delayedCall(delay, cb) {
          const timer = { delay, remove() {}, destroy() {} };
          timersList.push(timer);
          // Do not auto-fire; hostile tests do not need wander cycle completion.
          return timer;
        }
      },
      groundItemSystem: {
        spawn(itemType, quantity, x, y) {
          const item = { itemType, quantity, x, y };
          groundItems.push(item);
          return item;
        }
      }
    };
  }

  const removedMarks = [];
  const scene = createScene();
  const chunkData = {
    chunkX: 2,
    chunkY: -1,
    objects: [],
    npcs: [{ type: 'TALL_MONSTER', index: 0, localTileX: 6, localTileY: 6 }],
    spawnPoints: []
  };
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup: { create() { return { setVisible() {}, setDataEnabled() {}, setData() {}, body: { setSize() {}, setOffset() {}, refreshBody() {} } }; } },
    isNpcRemoved: () => false,
    onNpcRemoved: (id) => removedMarks.push(id)
  });

  assertEqual(instance.npcObjects.length, 1, 'created');
  const npc = instance.npcObjects[0];
  const tall = getHostileNpcConfig('TALL_MONSTER');
  const enemyId = buildChunkEnemyId(2, -1, 'TALL_MONSTER', 0);
  assertEqual(npc.textureKey, 'tall-monster-texture', 'texture');
  assertEqual(npc.getData('npcId'), enemyId, 'id');
  assertEqual(npc.getData('maxHp'), 30, 'hp');
  assertEqual(npc.displayWidth, tall.renderWidth, 'display w');
  assertEqual(npc.displayHeight, tall.renderHeight, 'display h');
  assertEqual(npc.body.width, tall.bodyWidth, 'body w');
  assertEqual(npc.body.height, tall.bodyHeight, 'body h');
  assertEqual(npc.body.offset.x, tall.bodyOffsetX, 'body ox');
  assertEqual(npc.body.offset.y, tall.bodyOffsetY, 'body oy');
  assertEqual(scene.colliderCalls.length, 1, 'collider');
  assertEqual(instance.hostileControllers.length, 1, 'controller attached');
  assertEqual(instance.getNearestAttackableNpc(npc.x, npc.y, 50), npc, 'melee sees hostile');

  assertEqual(instance.applyNpcDamage(npc, 10).health, 20, 'fist 1');
  assertEqual(instance.applyNpcDamage(npc, 10).health, 10, 'fist 2');
  assertEqual(instance.applyNpcDamage(npc, 10).died, true, 'fist 3 kills');
  assertEqual(removedMarks[0], enemyId, 'removed id');
  assertEqual(scene.groundItems.length, 1, 'one loot stack');
  assertEqual(scene.groundItems[0].quantity, 2, 'qty 2');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'RAW_MEAT');
  assertEqual(instance.hostileControllers.length, 0, 'controller cleaned on death');
  assertEqual(instance.applyNpcDamage(npc, 10).died, false, 'death idempotent');

  // Sword path: 15+15
  const scene2 = createScene();
  const marks2 = [];
  const instance2 = new ChunkInstance(scene2, chunkData, {
    blockingGroup: { create() { return { setVisible() {}, setDataEnabled() {}, setData() {}, body: { setSize() {}, setOffset() {}, refreshBody() {} } }; } },
    isNpcRemoved: () => false,
    onNpcRemoved: (id) => marks2.push(id)
  });
  const npc2 = instance2.npcObjects[0];
  assertEqual(instance2.applyNpcDamage(npc2, 15).health, 15, 'sword 1');
  assertEqual(instance2.applyNpcDamage(npc2, 15).died, true, 'sword 2 kills');

  // Reload skip through production markSessionNpcRemoved filter (not a raw Set bypass)
  const scene3 = createScene();
  const sessionOwner = {
    ids: new Set(),
    mark(id) {
      // Same gate as GameScene.markSessionNpcRemoved / SaveSystem.isValidRemovedNpcId
      if (typeof id !== 'string' || !id.startsWith('chunk_')) return;
      if (id.indexOf('_NPC_') === -1 && id.indexOf('_ENEMY_') === -1) return;
      this.ids.add(id);
    },
    has(id) { return this.ids.has(id); }
  };
  const liveThenKill = new ChunkInstance(scene3, chunkData, {
    blockingGroup: { create() { return { setVisible() {}, setDataEnabled() {}, setData() {}, body: { setSize() {}, setOffset() {}, refreshBody() {} } }; } },
    isNpcRemoved: (id) => sessionOwner.has(id),
    onNpcRemoved: (id) => sessionOwner.mark(id)
  });
  const doomed = liveThenKill.npcObjects[0];
  assertEqual(doomed.getData('npcId'), enemyId, 'session runtime id');
  assertEqual(liveThenKill.applyNpcDamage(doomed, 30).died, true, 'session death');
  assert(sessionOwner.has(enemyId), 'session owner accepted ENEMY id');
  liveThenKill.destroy();

  const skipped = new ChunkInstance(createScene(), chunkData, {
    blockingGroup: { create() { return { setVisible() {}, setDataEnabled() {}, setData() {}, body: { setSize() {}, setOffset() {}, refreshBody() {} } }; } },
    isNpcRemoved: (id) => sessionOwner.has(id),
    onNpcRemoved: (id) => sessionOwner.mark(id)
  });
  assertEqual(skipped.npcObjects.length, 0, 'removed not created after session mark');
  assertEqual(skipped.hostileControllers.length, 0, 'no controller for removed');

  // Unload cleanup
  const scene4 = createScene();
  const live = new ChunkInstance(scene4, chunkData, {
    blockingGroup: { create() { return { setVisible() {}, setDataEnabled() {}, setData() {}, body: { setSize() {}, setOffset() {}, refreshBody() {} } }; } },
    isNpcRemoved: () => false,
    onNpcRemoved: () => {}
  });
  assertEqual(live.hostileControllers.length, 1, 'live controller');
  live.destroy();
  assertEqual(live.hostileControllers.length, 0, 'unload clears controllers');
  assertEqual(scene4.groundItems.length, 0, 'unload is not death loot');

  instance.destroy();
  instance2.destroy();
  skipped.destroy();
}

// Preload / embedding
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /this\.load\.image\(\s*'tall-monster-texture'\s*,\s*TALL_MONSTER_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'preload tall-monster-texture'
  );
  assert(gameScene.includes('damagePlayer('), 'damagePlayer API');

  const generatedPath = path.join(root, 'src/generated/TallMonsterTextureData.js');
  assert(fs.existsSync(generatedPath), 'TallMonsterTextureData exists');
  const generated = fs.readFileSync(generatedPath, 'utf8');
  assert(
    generated.includes("const TALL_MONSTER_TEXTURE_DATA_URL = 'data:image/png;base64,"),
    'data URL export'
  );

  const offlinePath = path.join(root, 'dist/gamefromnazar-offline.html');
  assert(fs.existsSync(offlinePath), 'offline exists');
  const offline = fs.readFileSync(offlinePath, 'utf8');
  assert(offline.includes("'tall-monster-texture'"), 'offline texture key');
  assert(!/tall-monster\.png['"]/.test(offline), 'no external png');
}

console.log('test-tall-monster: ok');
