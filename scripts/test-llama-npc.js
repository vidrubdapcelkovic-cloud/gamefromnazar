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
  { filename: 'llama-npc-bundle.js' }
);

const { getPassiveNpcConfig, ChunkGenerator, buildChunkNpcId } = context.exports;
const prepare = require('./prepare-llama-asset.js');

// Config
{
  const rabbit = getPassiveNpcConfig('RABBIT');
  const pig = getPassiveNpcConfig('PIG');
  const llama = getPassiveNpcConfig('LLAMA');
  assert(llama, 'LLAMA config exists');

  assertEqual(rabbit.maxHp, 6, 'RABBIT maxHp unchanged');
  assertEqual(rabbit.lootQuantity, 1, 'RABBIT loot unchanged');
  assertEqual(rabbit.renderWidth, 28, 'RABBIT render unchanged');
  assertEqual(pig.maxHp, 20, 'PIG maxHp unchanged');
  assertEqual(pig.lootQuantity, 3, 'PIG loot unchanged');
  assertEqual(pig.renderWidth, 87, 'PIG render unchanged');
  assertEqual(pig.bodyOffsetX, 171, 'PIG body offset unchanged');
  assertEqual(pig.wanderTweenDuration, 700, 'PIG tween unchanged');

  assertEqual(llama.maxHp, 20, 'LLAMA maxHp 20');
  assertEqual(llama.lootType, 'RAW_MEAT', 'LLAMA loot RAW_MEAT');
  assertEqual(llama.lootQuantity, 3, 'LLAMA loot quantity 3');
  assertEqual(llama.textureKey, 'llama-texture', 'LLAMA texture key');
  assertEqual(llama.renderWidth, 67, 'LLAMA renderWidth');
  assertEqual(llama.renderHeight, 93, 'LLAMA renderHeight');
  assertEqual(llama.bodyWidth, 728, 'LLAMA bodyWidth');
  assertEqual(llama.bodyHeight, 299, 'LLAMA bodyHeight');
  assertEqual(llama.bodyOffsetX, 61, 'LLAMA bodyOffsetX');
  assertEqual(llama.bodyOffsetY, 864, 'LLAMA bodyOffsetY');
  assertEqual(llama.wanderTweenDuration, 750, 'LLAMA tween 750');
  assertEqual(llama.wanderPauseDuration, 1300, 'LLAMA pause 1300');
  assert(llama.wanderTweenDuration > pig.wanderTweenDuration, 'LLAMA slower than PIG');
  assert(llama.renderHeight > pig.renderHeight, 'LLAMA taller than PIG');

  // Render aspect matches content aspect (~818/1147)
  const contentAspect = 818 / 1147;
  const renderAspect = llama.renderWidth / llama.renderHeight;
  assert(Math.abs(renderAspect - contentAspect) < 0.02, 'render aspect close to content aspect');
}

// Generation / ID
{
  const seed = 424242;
  const a = ChunkGenerator.generate(seed, 4, 2);
  const b = ChunkGenerator.generate(seed, 4, 2);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'LLAMA generation deterministic');

  let llamaChunks = 0;
  let pigChunks = 0;
  let rabbitChunks = 0;
  let sawLlama = false;
  let llamaCoords = null;
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const rabbits = chunk.npcs.filter((n) => n.type === 'RABBIT');
      const pigs = chunk.npcs.filter((n) => n.type === 'PIG');
      const llamas = chunk.npcs.filter((n) => n.type === 'LLAMA');
      assert(rabbits.length <= 1 && pigs.length <= 1 && llamas.length <= 1, 'at most one of each');
      if (rabbits.length) rabbitChunks += 1;
      if (pigs.length) pigChunks += 1;
      if (llamas.length) {
        llamaChunks += 1;
        if (!sawLlama) {
          sawLlama = true;
          llamaCoords = { cx, cy, descriptor: llamas[0] };
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
  assert(sawLlama, 'LLAMA appears in some chunks');
  assert(llamaChunks < rabbitChunks, 'LLAMA rarer than RABBIT');
  assertEqual(llamaCoords.descriptor.type, 'LLAMA', 'llama descriptor type');
  assertEqual(llamaCoords.descriptor.index, 0, 'llama index 0');

  const llamaId = buildChunkNpcId(llamaCoords.cx, llamaCoords.cy, 'LLAMA', 0);
  assertEqual(
    llamaId,
    `chunk_${llamaCoords.cx}_${llamaCoords.cy}_NPC_LLAMA_0`,
    'LLAMA stable id format'
  );
  assert(
    llamaId !== buildChunkNpcId(llamaCoords.cx, llamaCoords.cy, 'PIG', 0),
    'LLAMA id differs from PIG'
  );
  assertEqual(buildChunkNpcId(0, 0, 'RABBIT', 0), 'chunk_0_0_NPC_RABBIT_0', 'RABBIT id unchanged');
  assertEqual(buildChunkNpcId(0, 0, 'PIG', 0), 'chunk_0_0_NPC_PIG_0', 'PIG id unchanged');
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
        assertEqual(data[8], 8, 'bit depth 8');
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

  const pngPath = path.join(root, 'assets/generated/llama.png');
  assert(fs.existsSync(pngPath), 'llama.png exists');
  const buffer = fs.readFileSync(pngPath);
  const { width, height, pixels } = decodePng(buffer);
  assertEqual(width, 850, 'prepared width 850');
  assertEqual(height, 1179, 'prepared height 1179');
  assert(width < 1254 && height < 1254, 'canvas smaller than original 1254');

  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };
  const alpha = (x, y) => px(x, y)[3];

  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(alpha(x, y), 0, `corner (${x},${y}) transparent`);
  });

  // No bright greenscreen on canvas corners / border samples
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
        // Pure greenscreen leftover would be near key (4,246,6) with high G and low R/B.
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
  assertEqual(maxX - minX + 1, 818, 'content width 818');
  assertEqual(maxY - minY + 1, 1147, 'content height 1147');

  const llama = getPassiveNpcConfig('LLAMA');
  assert(llama.bodyOffsetX >= 0 && llama.bodyOffsetY >= 0, 'body offsets non-negative');
  assert(llama.bodyOffsetX + llama.bodyWidth <= width, 'body fits X');
  assert(llama.bodyOffsetY + llama.bodyHeight <= height, 'body fits Y');
  // Body in lower half of content (not head/neck)
  const contentMidY = minY + Math.floor((maxY - minY + 1) / 2);
  assert(llama.bodyOffsetY >= contentMidY, 'body starts in lower half');

  const visibleW = llama.renderWidth * 818 / width;
  const visibleH = llama.renderHeight * 1147 / height;
  assert(visibleH >= 80 && visibleH <= 96, 'visible height in 80..96 world px');
  assert(Math.abs(visibleW / visibleH - 818 / 1147) < 0.02, 'visible aspect matches content');

  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = prepare.prepareLlamaAsset();
  const second = prepare.prepareLlamaAsset();
  assertEqual(first.sha256, hashBefore, 'prepare idempotent hash');
  assertEqual(second.sha256, first.sha256, 'second prepare same hash');
  assertEqual(first.newWidth, 850, 'idempotent width');
  assertEqual(first.newHeight, 1179, 'idempotent height');
}

// Preload / embedding wiring
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /this\.load\.image\(\s*'llama-texture'\s*,\s*LLAMA_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'GameScene loads llama-texture from LLAMA_TEXTURE_DATA_URL'
  );
  assert(!/data:image\/png;base64,/.test(gameScene), 'no base64 in GameScene');

  const generated = fs.readFileSync(path.join(root, 'src/generated/LlamaTextureData.js'), 'utf8');
  assert(
    generated.includes("const LLAMA_TEXTURE_DATA_URL = 'data:image/png;base64,"),
    'generated llama module exposes data URL'
  );

  const offlinePath = path.join(root, 'dist/gamefromnazar-offline.html');
  assert(fs.existsSync(offlinePath), 'offline build exists');
  const offline = fs.readFileSync(offlinePath, 'utf8');
  assert(offline.includes("'llama-texture'"), 'offline HTML references llama-texture');
  assert(!/llama\.png['"]/.test(offline), 'offline HTML has no external llama.png');
}

console.log('test-llama-npc: ok');
