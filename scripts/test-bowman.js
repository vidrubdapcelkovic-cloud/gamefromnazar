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
  'src/data/ItemCatalog.js',
  'src/data/BuildCatalog.js',
  'src/data/PassiveNpcConfig.js',
  'src/data/HostileNpcConfig.js',
  'src/systems/ChestStorageModel.js',
  'src/systems/DayNightSystem.js',
  'src/systems/SaveSystem.js',
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
;exports.SaveSystem = SaveSystem;
;exports.ChunkGenerator = ChunkGenerator;
;exports.buildChunkNpcId = buildChunkNpcId;
;exports.buildChunkEnemyId = buildChunkEnemyId;
;exports.ChunkInstance = ChunkInstance;
;exports.HOSTILE_NPC_STATE = HOSTILE_NPC_STATE;
;exports.HostileNpcController = HostileNpcController;`,
  context,
  { filename: 'bowman-bundle.js' }
);

const {
  getPassiveNpcConfig,
  getHostileNpcConfig,
  isHostileNpcType,
  SaveSystem,
  ChunkGenerator,
  buildChunkNpcId,
  buildChunkEnemyId,
  ChunkInstance,
  HOSTILE_NPC_STATE,
  HostileNpcController
} = context.exports;
const prepare = require('./prepare-bowman-asset.js');

const CONTENT_W = 824;
const CONTENT_H = 1137;
const TEX_W = 856;
const TEX_H = 1169;

// Config
{
  const tall = getHostileNpcConfig('TALL_MONSTER');
  const elec = getHostileNpcConfig('ELECTRICMAN');
  const bow = getHostileNpcConfig('BOWMAN');
  assert(bow, 'BOWMAN config');
  assert(isHostileNpcType('BOWMAN'), 'isHostileNpcType');
  assertEqual(tall.maxHp, 30, 'TALL_MONSTER unchanged');
  assertEqual(tall.chaseSpeed, 55, 'TALL_MONSTER chase unchanged');
  assertEqual(elec.maxHp, 20, 'ELECTRICMAN unchanged');
  assertEqual(elec.chaseSpeed, 68, 'ELECTRICMAN chase unchanged');
  assertEqual(getPassiveNpcConfig('BUFFALO').renderWidth, 119, 'BUFFALO unchanged');

  assertEqual(bow.textureKey, 'bowman-texture', 'textureKey');
  assertEqual(bow.maxHp, 24, 'maxHp');
  assertEqual(bow.lootType, 'RAW_MEAT', 'lootType');
  assertEqual(bow.lootQuantity, 2, 'lootQuantity');
  assertEqual(bow.wanderTweenDuration, 800, 'wander tween');
  assertEqual(bow.wanderPauseDuration, 1100, 'wander pause');
  assertEqual(bow.detectionRadius, 165, 'detectionRadius');
  assertEqual(bow.disengageRadius, 245, 'disengageRadius');
  assertEqual(bow.attackRange, 30, 'attackRange');
  assertEqual(bow.attackDamage, 5, 'attackDamage');
  assertEqual(bow.attackCooldown, 1000, 'attackCooldown');
  assertEqual(bow.chaseSpeed, 60, 'chaseSpeed');
  assertEqual(bow.returnRadius, 12, 'returnRadius');
  assertEqual(bow.renderWidth, 77, 'renderWidth');
  assertEqual(bow.renderHeight, 105, 'renderHeight');

  const visibleW = bow.renderWidth * CONTENT_W / TEX_W;
  const visibleH = bow.renderHeight * CONTENT_H / TEX_H;
  assert(visibleH >= 95 && visibleH <= 110, 'visible height 95..110');
  assert(Math.abs(visibleW / visibleH - CONTENT_W / CONTENT_H) < 0.02, 'aspect ok');
  assert(bow.bodyOffsetX >= 0 && bow.bodyOffsetY >= 0, 'body offsets');
  assert(bow.bodyOffsetX + bow.bodyWidth <= TEX_W, 'body X');
  assert(bow.bodyOffsetY + bow.bodyHeight <= TEX_H, 'body Y');
}

// Generation
{
  const seed = 424242;
  const a = ChunkGenerator.generate(seed, 5, 3);
  const b = ChunkGenerator.generate(seed, 5, 3);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'deterministic');

  const src = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(src.includes("'chunk-enemies-bowman'"), 'stream');
  assert(/bowmanRng\.next\(\)\s*<\s*0\.10/.test(src), 'chance 0.10');
  assert(src.includes("'chunk-enemies-tall-monster'"), 'tall stream untouched');
  assert(/tallMonsterRng\.next\(\)\s*<\s*0\.10/.test(src), 'tall chance untouched');
  assert(src.includes("'chunk-enemies-electricman'"), 'electricman stream untouched');
  assert(/electricmanRng\.next\(\)\s*<\s*0\.12/.test(src), 'electricman chance untouched');

  let saw = false;
  let coords = null;
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const bows = chunk.npcs.filter((n) => n.type === 'BOWMAN');
      assert(bows.length <= 1, 'max one bowman');
      assert(chunk.npcs.filter((n) => n.type === 'TALL_MONSTER').length <= 1, 'max one tall');
      assert(chunk.npcs.filter((n) => n.type === 'ELECTRICMAN').length <= 1, 'max one electric');
      if (bows.length && !saw) {
        saw = true;
        coords = { cx, cy, descriptor: bows[0] };
      }
      const occupied = new Set(chunk.objects.map((o) => `${o.localTileX},${o.localTileY}`));
      chunk.npcs.forEach((n) => {
        const key = `${n.localTileX},${n.localTileY}`;
        assert(!occupied.has(key), 'no overlap');
        occupied.add(key);
      });
    }
  }
  assert(saw, 'BOWMAN appears');
  assertEqual(coords.descriptor.type, 'BOWMAN', 'type');
  const enemyId = buildChunkEnemyId(coords.cx, coords.cy, 'BOWMAN', 0);
  assertEqual(
    enemyId,
    `chunk_${coords.cx}_${coords.cy}_ENEMY_BOWMAN_0`,
    'stable ENEMY id'
  );
  assertEqual(buildChunkNpcId(0, 0, 'RABBIT', 0), 'chunk_0_0_NPC_RABBIT_0', 'passive id');

  const startChunk = ChunkGenerator.generate(seed, 0, 0);
  startChunk.npcs.forEach((entry) => {
    const inClear = entry.localTileX >= 5 && entry.localTileX <= 11
      && entry.localTileY >= 5 && entry.localTileY <= 11;
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

  const pngPath = path.join(root, 'assets/generated/bowman.png');
  assert(fs.existsSync(pngPath), 'png exists');
  const buffer = fs.readFileSync(pngPath);
  const { width, height, pixels } = decodePng(buffer);
  assertEqual(width, TEX_W, 'width');
  assertEqual(height, TEX_H, 'height');

  const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(alpha(x, y), 0, `corner transparent ${x},${y}`);
  });

  let borderGreen = 0;
  for (let x = 0; x < width; x += 8) {
    [[x, 0], [x, height - 1]].forEach(([bx, by]) => {
      const i = (by * width + bx) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a > 32 && g > r + 25 && g > b + 25 && g > 100) borderGreen += 1;
    });
  }
  assertEqual(borderGreen, 0, 'no green border');

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha(x, y) > prepare.ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  assertEqual(minX, prepare.PADDING, 'left pad');
  assertEqual(minY, prepare.PADDING, 'top pad');
  assertEqual(width - 1 - maxX, prepare.PADDING, 'right pad');
  assertEqual(height - 1 - maxY, prepare.PADDING, 'bottom pad');
  assertEqual(maxX - minX + 1, CONTENT_W, 'content width');
  assertEqual(maxY - minY + 1, CONTENT_H, 'content height');

  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = prepare.prepareBowmanAsset();
  const second = prepare.prepareBowmanAsset();
  assertEqual(first.sha256, hashBefore, 'idempotent hash');
  assertEqual(second.sha256, first.sha256, 'second hash');
  assertEqual(first.newWidth, TEX_W, 'idempotent w');
  assertEqual(first.newHeight, TEX_H, 'idempotent h');
}

// Runtime melee + persistence (no projectile / ranged)
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
    const groundItems = [];
    return {
      groundItems,
      player: { x: 0, y: 0, body: {}, destroyed: false, active: true },
      playerStatsModel: { isDead() { return false; } },
      damagePlayer() { return 0; },
      textures: { exists() { return true; } },
      make: {
        graphics() {
          return {
            fillStyle() { return this; },
            fillEllipse() { return this; },
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
          collider() { return { destroy() {} }; }
        }
      },
      tweens: { add(config) { return { config, stop() {}, complete() {} }; } },
      time: { delayedCall() { return { remove() {}, destroy() {} }; } },
      groundItemSystem: {
        spawn(itemType, quantity, x, y) {
          const item = { itemType, quantity, x, y };
          groundItems.push(item);
          return item;
        }
      }
    };
  }

  const blockingGroup = {
    create() {
      return {
        setVisible() {},
        setDataEnabled() {},
        setData() {},
        body: { setSize() {}, setOffset() {}, refreshBody() {} }
      };
    }
  };

  const chunkData = {
    chunkX: 4,
    chunkY: -3,
    objects: [],
    npcs: [{ type: 'BOWMAN', index: 0, localTileX: 5, localTileY: 8 }],
    spawnPoints: []
  };
  const enemyId = buildChunkEnemyId(4, -3, 'BOWMAN', 0);
  const bow = getHostileNpcConfig('BOWMAN');

  const session = {
    ids: new Set(),
    mark(id) {
      if (!SaveSystem.isValidRemovedNpcId(id)) return;
      this.ids.add(id);
    },
    has(id) { return this.ids.has(id); }
  };

  const scene = createScene();
  const instance = new ChunkInstance(scene, chunkData, {
    blockingGroup,
    isNpcRemoved: (id) => session.has(id),
    onNpcRemoved: (id) => session.mark(id)
  });
  assertEqual(instance.npcObjects.length, 1, 'created');
  const npc = instance.npcObjects[0];
  assertEqual(npc.textureKey, 'bowman-texture', 'texture');
  assertEqual(npc.getData('npcId'), enemyId, 'id');
  assertEqual(npc.getData('npcKind'), 'hostile', 'hostile kind');
  assertEqual(instance.hostileControllers.length, 1, 'controller');
  assertEqual(npc.displayWidth, bow.renderWidth, 'display w');
  assertEqual(npc.displayHeight, bow.renderHeight, 'display h');
  assertEqual(npc.body.width, bow.bodyWidth, 'body w');
  assertEqual(npc.body.height, bow.bodyHeight, 'body h');
  assertEqual(instance.getNearestAttackableNpc(npc.x, npc.y, 80), npc, 'melee sees');

  // Shared controller melee damage + cooldown (5 dmg / 1000 ms)
  const damageCalls = [];
  const harness = {
    x: npc.x,
    y: npc.y,
    player: { x: npc.x + 10, y: npc.y }
  };
  const controller = new HostileNpcController({
    config: bow,
    homeX: npc.x,
    homeY: npc.y,
    getPosition: () => ({ x: harness.x, y: harness.y }),
    setPosition: (x, y) => { harness.x = x; harness.y = y; },
    getPlayerPosition: () => harness.player,
    stopWander() {},
    resumeWander() {},
    damagePlayer(amount) {
      damageCalls.push(amount);
      return amount;
    },
    canOccupy: () => true
  });
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.ATTACK, 'melee attack state');
  assertEqual(damageCalls.length, 1, 'first attack');
  assertEqual(damageCalls[0], 5, 'attackDamage 5');
  controller.update(500, 16);
  assertEqual(damageCalls.length, 1, 'cooldown blocks');
  controller.update(1000, 16);
  assertEqual(damageCalls.length, 2, 'after 1000ms');
  controller.destroy();

  assertEqual(instance.applyNpcDamage(npc, 12).health, 12, 'dmg 1');
  assertEqual(instance.applyNpcDamage(npc, 12).died, true, 'death');
  assert(session.has(enemyId), 'ENEMY id accepted');
  assertEqual(scene.groundItems.length, 1, 'one loot');
  assertEqual(scene.groundItems[0].quantity, 2, 'qty 2');
  assertEqual(scene.groundItems[0].itemType, 'RAW_MEAT', 'RAW_MEAT');
  assertEqual(instance.applyNpcDamage(npc, 10).died, false, 'death idempotent');
  instance.destroy();

  const reloaded = new ChunkInstance(createScene(), chunkData, {
    blockingGroup,
    isNpcRemoved: (id) => session.has(id),
    onNpcRemoved: (id) => session.mark(id)
  });
  assertEqual(reloaded.npcObjects.length, 0, 'no revive after reload');
  reloaded.destroy();

  const serialized = SaveSystem.normalizeRemovedNpcIds(Array.from(session.ids));
  assertEqual(JSON.stringify(serialized), JSON.stringify([enemyId]), 'save keeps id');
  const restored = new Set(SaveSystem.normalizeRemovedNpcIds(serialized));
  const afterLoad = new ChunkInstance(createScene(), chunkData, {
    blockingGroup,
    isNpcRemoved: (id) => restored.has(id),
    onNpcRemoved: () => {}
  });
  assertEqual(afterLoad.npcObjects.length, 0, 'no revive after save/load');
  afterLoad.destroy();
}

// No projectile / ranged logic wired for BOWMAN
{
  const controllerSrc = fs.readFileSync(path.join(root, 'src/world/HostileNpcController.js'), 'utf8');
  const configSrc = fs.readFileSync(path.join(root, 'src/data/HostileNpcConfig.js'), 'utf8');
  const generatorSrc = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(!/\bprojectile\b/i.test(controllerSrc), 'controller has no projectile');
  assert(!/\branged\b/i.test(controllerSrc), 'controller has no ranged');
  assert(!/projectileRange|arrowSpeed|rangedAttack/.test(configSrc), 'config has no ranged fields');
  assert(generatorSrc.includes("type: 'BOWMAN'"), 'generator places BOWMAN');
}

// Preload / embedding
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /this\.load\.image\(\s*'bowman-texture'\s*,\s*BOWMAN_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'preload bowman-texture'
  );

  const generatedPath = path.join(root, 'src/generated/BowmanTextureData.js');
  assert(fs.existsSync(generatedPath), 'BowmanTextureData exists');
  const generated = fs.readFileSync(generatedPath, 'utf8');
  assert(
    generated.includes("const BOWMAN_TEXTURE_DATA_URL = 'data:image/png;base64,"),
    'data URL export'
  );

  const offline = fs.readFileSync(path.join(root, 'dist/gamefromnazar-offline.html'), 'utf8');
  assert(offline.includes("'bowman-texture'"), 'offline texture key');
  assert(!/bowman\.png['"]/.test(offline), 'no external png');
}

console.log('test-bowman: ok');
