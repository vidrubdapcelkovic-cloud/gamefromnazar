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
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/ChunkGenerator.js',
  'src/world/ChunkNpcIds.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = {
  console, Math, Number, String, Array, Object, Set, Map, Error, exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${bundle}\n;exports.PassiveNpcConfig = PassiveNpcConfig;`
  + ' exports.getPassiveNpcConfig = getPassiveNpcConfig;'
  + ' exports.ChunkGenerator = ChunkGenerator;'
  + ' exports.buildChunkNpcId = buildChunkNpcId;',
  context,
  { filename: 'buffalo-npc-bundle.js' }
);

const { getPassiveNpcConfig, ChunkGenerator, buildChunkNpcId } = context.exports;
const prepare = require('./prepare-buffalo-asset.js');

const CONTENT_W = 986;
const CONTENT_H = 789;
const TEX_W = 1018;
const TEX_H = 821;

// Config
{
  const rabbit = getPassiveNpcConfig('RABBIT');
  const pig = getPassiveNpcConfig('PIG');
  const llama = getPassiveNpcConfig('LLAMA');
  const buffalo = getPassiveNpcConfig('BUFFALO');
  assert(buffalo, 'BUFFALO config exists');

  assertEqual(rabbit.maxHp, 6, 'RABBIT maxHp unchanged');
  assertEqual(rabbit.lootQuantity, 1, 'RABBIT loot unchanged');
  assertEqual(rabbit.renderWidth, 28, 'RABBIT render unchanged');
  assertEqual(pig.maxHp, 20, 'PIG maxHp unchanged');
  assertEqual(pig.lootQuantity, 3, 'PIG loot unchanged');
  assertEqual(pig.renderWidth, 87, 'PIG render unchanged');
  assertEqual(pig.bodyOffsetX, 171, 'PIG body offset unchanged');
  assertEqual(pig.wanderTweenDuration, 700, 'PIG tween unchanged');
  assertEqual(llama.maxHp, 20, 'LLAMA maxHp unchanged');
  assertEqual(llama.lootQuantity, 3, 'LLAMA loot unchanged');
  assertEqual(llama.renderWidth, 67, 'LLAMA render unchanged');
  assertEqual(llama.bodyOffsetX, 61, 'LLAMA body offset unchanged');
  assertEqual(llama.wanderTweenDuration, 750, 'LLAMA tween unchanged');

  assertEqual(buffalo.maxHp, 35, 'BUFFALO maxHp 35');
  assertEqual(buffalo.lootType, 'RAW_MEAT', 'BUFFALO loot RAW_MEAT');
  assertEqual(buffalo.lootQuantity, 5, 'BUFFALO loot quantity 5');
  assertEqual(buffalo.textureKey, 'buffalo-texture', 'BUFFALO texture key');
  assertEqual(buffalo.renderWidth, 119, 'BUFFALO renderWidth');
  assertEqual(buffalo.renderHeight, 96, 'BUFFALO renderHeight');
  assertEqual(buffalo.bodyWidth, 679, 'BUFFALO bodyWidth');
  assertEqual(buffalo.bodyHeight, 341, 'BUFFALO bodyHeight');
  assertEqual(buffalo.bodyOffsetX, 134, 'BUFFALO bodyOffsetX');
  assertEqual(buffalo.bodyOffsetY, 449, 'BUFFALO bodyOffsetY');
  assertEqual(buffalo.wanderTweenDuration, 900, 'BUFFALO tween 900');
  assertEqual(buffalo.wanderPauseDuration, 1600, 'BUFFALO pause 1600');
  assert(buffalo.wanderTweenDuration > llama.wanderTweenDuration, 'BUFFALO slower than LLAMA');
  assert(buffalo.renderWidth > pig.renderWidth, 'BUFFALO wider than PIG');
  assert(buffalo.renderWidth > llama.renderWidth, 'BUFFALO wider than LLAMA');

  const contentAspect = CONTENT_W / CONTENT_H;
  const renderAspect = buffalo.renderWidth / buffalo.renderHeight;
  assert(Math.abs(renderAspect - contentAspect) < 0.02, 'render aspect close to content aspect');
}

// Generation / ID
{
  const seed = 424242;
  const a = ChunkGenerator.generate(seed, 4, 2);
  const b = ChunkGenerator.generate(seed, 4, 2);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'BUFFALO generation deterministic');

  let buffaloChunks = 0;
  let pigChunks = 0;
  let llamaChunks = 0;
  let rabbitChunks = 0;
  let sawBuffalo = false;
  let buffaloCoords = null;
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const rabbits = chunk.npcs.filter((n) => n.type === 'RABBIT');
      const pigs = chunk.npcs.filter((n) => n.type === 'PIG');
      const llamas = chunk.npcs.filter((n) => n.type === 'LLAMA');
      const buffalos = chunk.npcs.filter((n) => n.type === 'BUFFALO');
      assert(
        rabbits.length <= 1 && pigs.length <= 1 && llamas.length <= 1 && buffalos.length <= 1,
        'at most one of each'
      );
      if (rabbits.length) rabbitChunks += 1;
      if (pigs.length) pigChunks += 1;
      if (llamas.length) llamaChunks += 1;
      if (buffalos.length) {
        buffaloChunks += 1;
        if (!sawBuffalo) {
          sawBuffalo = true;
          buffaloCoords = { cx, cy, descriptor: buffalos[0] };
        }
      }
      const occupied = new Set(chunk.objects.map((o) => `${o.localTileX},${o.localTileY}`));
      chunk.npcs.forEach((n) => {
        const key = `${n.localTileX},${n.localTileY}`;
        assert(!occupied.has(key), 'NPC cells unique vs TREE/ROCK/NPC');
        occupied.add(key);
      });
    }
  }
  assert(sawBuffalo, 'BUFFALO appears in some chunks');
  assert(buffaloChunks < pigChunks, 'BUFFALO rarer than PIG');
  assert(buffaloChunks < llamaChunks, 'BUFFALO rarer than LLAMA');
  assert(buffaloChunks < rabbitChunks, 'BUFFALO rarer than RABBIT');
  assertEqual(buffaloCoords.descriptor.type, 'BUFFALO', 'buffalo descriptor type');
  assertEqual(buffaloCoords.descriptor.index, 0, 'buffalo index 0');

  const buffaloId = buildChunkNpcId(buffaloCoords.cx, buffaloCoords.cy, 'BUFFALO', 0);
  assertEqual(
    buffaloId,
    `chunk_${buffaloCoords.cx}_${buffaloCoords.cy}_NPC_BUFFALO_0`,
    'BUFFALO stable id format'
  );
  assert(
    buffaloId !== buildChunkNpcId(buffaloCoords.cx, buffaloCoords.cy, 'LLAMA', 0),
    'BUFFALO id differs from LLAMA'
  );
  assertEqual(buildChunkNpcId(0, 0, 'RABBIT', 0), 'chunk_0_0_NPC_RABBIT_0', 'RABBIT id unchanged');
  assertEqual(buildChunkNpcId(0, 0, 'PIG', 0), 'chunk_0_0_NPC_PIG_0', 'PIG id unchanged');
  assertEqual(buildChunkNpcId(0, 0, 'LLAMA', 0), 'chunk_0_0_NPC_LLAMA_0', 'LLAMA id unchanged');

  const generatorSource = fs.readFileSync(path.join(root, 'src/world/ChunkGenerator.js'), 'utf8');
  assert(generatorSource.includes("'chunk-npcs-buffalo'"), 'buffalo stream chunk-npcs-buffalo');
  assert(/buffaloRng\.next\(\)\s*<\s*0\.08/.test(generatorSource), 'buffalo chance 0.08');

  const startChunk = ChunkGenerator.generate(seed, 0, 0);
  const clearMin = 5;
  const clearMax = 11;
  startChunk.npcs.forEach((entry) => {
    const inClear = entry.localTileX >= clearMin && entry.localTileX <= clearMax
      && entry.localTileY >= clearMin && entry.localTileY <= clearMax;
    assert(!inClear, 'start clear zone has no buffalo');
  });
}

// Asset
{
  function decodePng(buffer) {
    let o = 8;
    let width = 0;
    let height = 0;
    while (o + 8 <= buffer.length) {
      const len = buffer.readUInt32BE(o);
      const type = buffer.slice(o + 4, o + 8).toString('ascii');
      const data = buffer.slice(o + 8, o + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        assertEqual(data[8], 8, 'bit depth 8');
        assertEqual(data[9], 6, 'RGBA');
      } else if (type === 'IDAT') {
        // collected below
      } else if (type === 'IEND') break;
      o += 12 + len;
    }
    const idat = [];
    o = 8;
    while (o + 8 <= buffer.length) {
      const len = buffer.readUInt32BE(o);
      const type = buffer.slice(o + 4, o + 8).toString('ascii');
      const data = buffer.slice(o + 8, o + 8 + len);
      if (type === 'IDAT') idat.push(data);
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

  const pngPath = path.join(root, 'assets/generated/buffalo.png');
  assert(fs.existsSync(pngPath), 'buffalo.png exists');
  const buffer = fs.readFileSync(pngPath);
  const { width, height, pixels } = decodePng(buffer);
  assertEqual(width, TEX_W, 'prepared width');
  assertEqual(height, TEX_H, 'prepared height');
  assert(width < 1254 && height < 1254, 'canvas smaller than original 1254');

  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };
  const alpha = (x, y) => px(x, y)[3];

  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(alpha(x, y), 0, `corner (${x},${y}) transparent`);
  });

  let borderGreen = 0;
  let borderWhiteBox = 0;
  for (let x = 0; x < width; x += 8) {
    [[x, 0], [x, height - 1]].forEach(([bx, by]) => {
      const [r, g, b, a] = px(bx, by);
      if (a > 32 && g > r + 25 && g > b + 25 && g > 100) borderGreen += 1;
      if (a > 200 && r > 230 && g > 230 && b > 230) borderWhiteBox += 1;
    });
  }
  assertEqual(borderGreen, 0, 'no bright green background on border');
  assertEqual(borderWhiteBox, 0, 'no large white rectangle on border');

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  let greenOpaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, aVal] = px(x, y);
      if (aVal > prepare.ALPHA_THRESHOLD) {
        opaque += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (g > 200 && r < 40 && b < 40) greenOpaque += 1;
      }
    }
  }
  assert(opaque > 0, 'has opaque pixels');
  assertEqual(greenOpaque, 0, 'no leftover pure greenscreen pixels');
  assertEqual(minX, prepare.PADDING, 'left padding');
  assertEqual(minY, prepare.PADDING, 'top padding');
  assertEqual(width - 1 - maxX, prepare.PADDING, 'right padding');
  assertEqual(height - 1 - maxY, prepare.PADDING, 'bottom padding');
  assertEqual(maxX - minX + 1, CONTENT_W, 'content width');
  assertEqual(maxY - minY + 1, CONTENT_H, 'content height');

  const buffalo = getPassiveNpcConfig('BUFFALO');
  assert(buffalo.bodyOffsetX >= 0 && buffalo.bodyOffsetY >= 0, 'body offsets non-negative');
  assert(buffalo.bodyOffsetX + buffalo.bodyWidth <= width, 'body fits X');
  assert(buffalo.bodyOffsetY + buffalo.bodyHeight <= height, 'body fits Y');
  const contentMidY = minY + Math.floor((maxY - minY + 1) / 2);
  assert(buffalo.bodyOffsetY >= contentMidY, 'body starts in lower half');

  const visibleW = buffalo.renderWidth * CONTENT_W / width;
  const visibleH = buffalo.renderHeight * CONTENT_H / height;
  assert(visibleW >= 105 && visibleW <= 125, 'visible width in 105..125 world px');
  assert(Math.abs(visibleW / visibleH - CONTENT_W / CONTENT_H) < 0.02, 'visible aspect matches content');

  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = prepare.prepareBuffaloAsset();
  const second = prepare.prepareBuffaloAsset();
  assertEqual(first.sha256, hashBefore, 'prepare idempotent hash');
  assertEqual(second.sha256, first.sha256, 'second prepare same hash');
  assertEqual(first.newWidth, TEX_W, 'idempotent width');
  assertEqual(first.newHeight, TEX_H, 'idempotent height');
}

// Preload / embedding wiring
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /this\.load\.image\(\s*'buffalo-texture'\s*,\s*BUFFALO_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'GameScene loads buffalo-texture from BUFFALO_TEXTURE_DATA_URL'
  );
  assert(!/data:image\/png;base64,/.test(gameScene), 'no base64 in GameScene');

  const generatedPath = path.join(root, 'src/generated/BuffaloTextureData.js');
  assert(fs.existsSync(generatedPath), 'BuffaloTextureData.js exists');
  const generated = fs.readFileSync(generatedPath, 'utf8');
  assert(
    generated.includes("const BUFFALO_TEXTURE_DATA_URL = 'data:image/png;base64,"),
    'generated buffalo module exposes data URL'
  );

  const offlinePath = path.join(root, 'dist/gamefromnazar-offline.html');
  assert(fs.existsSync(offlinePath), 'offline build exists');
  const offline = fs.readFileSync(offlinePath, 'utf8');
  assert(offline.includes("'buffalo-texture'"), 'offline HTML references buffalo-texture');
  assert(!/buffalo\.png['"]/.test(offline), 'offline HTML has no external buffalo.png');
}

console.log('test-buffalo-npc: ok');
