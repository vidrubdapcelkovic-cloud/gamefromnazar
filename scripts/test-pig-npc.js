const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

// ---------------------------------------------------------------------------
// Load production modules in an isolated context
// ---------------------------------------------------------------------------
const bundle = [
  'src/data/PassiveNpcConfig.js',
  'src/world/ChunkMath.js',
  'src/world/SeededRandom.js',
  'src/world/RiverGenerator.js',
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
  + ' exports.ChunkGenerator = ChunkGenerator; exports.ChunkMath = ChunkMath;'
  + ' exports.buildChunkNpcId = buildChunkNpcId;',
  context,
  { filename: 'pig-npc-bundle.js' }
);

const { PassiveNpcConfig, getPassiveNpcConfig, ChunkGenerator, ChunkMath, buildChunkNpcId } = context.exports;

// ---------------------------------------------------------------------------
// 18. Config tests
// ---------------------------------------------------------------------------
{
  const rabbit = getPassiveNpcConfig('RABBIT');
  const pig = getPassiveNpcConfig('PIG');
  assert(rabbit, 'RABBIT config exists');
  assert(pig, 'PIG config exists');
  assertEqual(getPassiveNpcConfig('WOLF'), null, 'unknown type has no config');
  assertEqual(getPassiveNpcConfig(null), null, 'null type has no config');

  // RABBIT unchanged
  assertEqual(rabbit.maxHp, 6, 'RABBIT maxHp 6');
  assertEqual(rabbit.lootType, 'RAW_MEAT', 'RABBIT loot RAW_MEAT');
  assertEqual(rabbit.lootQuantity, 1, 'RABBIT loot quantity 1');
  assertEqual(rabbit.textureKey, 'rabbit-placeholder', 'RABBIT texture unchanged');
  assertEqual(rabbit.renderWidth, 28, 'RABBIT render width 28');
  assertEqual(rabbit.renderHeight, 28, 'RABBIT render height 28');
  assertEqual(rabbit.bodyWidth, 14, 'RABBIT body width 14');
  assertEqual(rabbit.bodyHeight, 10, 'RABBIT body height 10');
  assertEqual(rabbit.bodyOffsetX, 7, 'RABBIT body offsetX 7');
  assertEqual(rabbit.bodyOffsetY, 16, 'RABBIT body offsetY 16');
  assertEqual(rabbit.wanderTweenDuration, 450, 'RABBIT tween 450');
  assertEqual(rabbit.wanderPauseDuration, 900, 'RABBIT pause 900');

  // PIG values
  assertEqual(pig.maxHp, 20, 'PIG maxHp 20');
  assertEqual(pig.lootType, 'RAW_MEAT', 'PIG loot RAW_MEAT');
  assertEqual(pig.lootQuantity, 3, 'PIG loot quantity 3');
  assertEqual(pig.textureKey, 'pig-texture', 'PIG separate texture key');
  assert(pig.textureKey !== rabbit.textureKey, 'PIG texture differs from RABBIT');
  assertEqual(pig.wanderTweenDuration, 700, 'PIG tween 700 unchanged');
  assertEqual(pig.wanderPauseDuration, 1200, 'PIG pause 1200 unchanged');
  assertEqual(pig.bodyWidth, 540, 'PIG bodyWidth preserved after crop');
  assertEqual(pig.bodyHeight, 118, 'PIG bodyHeight preserved after crop');
  assertEqual(pig.bodyOffsetX, 171, 'PIG bodyOffsetX remapped after crop');
  assertEqual(pig.bodyOffsetY, 294, 'PIG bodyOffsetY remapped after crop');
  assertEqual(pig.renderWidth, 87, 'PIG renderWidth preserves visible size');
  assertEqual(pig.renderHeight, 42, 'PIG renderHeight preserves visible size');

  // PIG visually larger, distinct body, slower movement
  assert(pig.renderWidth > rabbit.renderWidth, 'PIG wider than rabbit');
  assert(pig.renderHeight > rabbit.renderHeight, 'PIG taller than rabbit');
  assert(pig.bodyWidth !== rabbit.bodyWidth, 'PIG body differs from rabbit');
  assert(pig.wanderTweenDuration > rabbit.wanderTweenDuration, 'PIG moves slower than rabbit');
  assert(pig.wanderPauseDuration > rabbit.wanderPauseDuration, 'PIG pauses longer than rabbit');

  // No runtime objects / functions / phaser refs in config
  const configSource = fs.readFileSync(path.join(root, 'src/data/PassiveNpcConfig.js'), 'utf8');
  assert(!/\bPhaser\b/.test(configSource), 'config has no Phaser reference');
  assert(!/=>/.test(configSource.replace(/\/\/.*$/gm, '')), 'config has no arrow callbacks in data');
  Object.keys(PassiveNpcConfig).forEach((type) => {
    const cfg = PassiveNpcConfig[type];
    Object.keys(cfg).forEach((key) => {
      const v = cfg[key];
      assert(
        typeof v === 'string' || typeof v === 'number',
        `config ${type}.${key} is plain data`
      );
    });
  });
}

// ---------------------------------------------------------------------------
// 19. Generation & stable ID tests (fixed seeds, no statistics)
// ---------------------------------------------------------------------------
{
  const seed = 424242;

  // Deterministic: repeat generation gives identical descriptors
  const a = ChunkGenerator.generate(seed, 2, -1);
  const b = ChunkGenerator.generate(seed, 2, -1);
  assertEqual(JSON.stringify(a.npcs), JSON.stringify(b.npcs), 'PIG/NPC generation deterministic');

  // Scan a fixed region and gather counts + placement validity
  let rabbitChunks = 0;
  let pigChunks = 0;
  let sawPig = false;
  let pigDescriptor = null;
  let pigChunkCoords = null;
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 1) {
      const chunk = ChunkGenerator.generate(seed, cx, cy);
      const rabbits = chunk.npcs.filter((n) => n.type === 'RABBIT');
      const pigs = chunk.npcs.filter((n) => n.type === 'PIG');
      assert(rabbits.length <= 1, 'at most one rabbit');
      assert(pigs.length <= 1, 'at most one pig');
      if (rabbits.length) rabbitChunks += 1;
      if (pigs.length) {
        pigChunks += 1;
        if (!sawPig) {
          sawPig = true;
          pigDescriptor = pigs[0];
          pigChunkCoords = { cx, cy };
        }
      }
      // No NPC overlaps TREE/ROCK or another NPC
      const occupied = new Set();
      chunk.objects.forEach((o) => occupied.add(`${o.localTileX},${o.localTileY}`));
      chunk.npcs.forEach((n) => {
        const key = `${n.localTileX},${n.localTileY}`;
        assert(!occupied.has(key), 'NPC never shares a cell with TREE/ROCK or another NPC');
        occupied.add(key);
      });
    }
  }
  assert(sawPig, 'PIG appears in some chunks');
  assert(rabbitChunks > 0, 'RABBIT still appears');
  // PIG rarer than RABBIT (approx 2-3x); assert strictly rarer over the fixed scan.
  assert(pigChunks < rabbitChunks, 'PIG is rarer than RABBIT');

  // PIG descriptor is plain, inside chunk
  assertEqual(pigDescriptor.type, 'PIG', 'pig descriptor type');
  assertEqual(pigDescriptor.index, 0, 'pig descriptor index 0');
  assert(Number.isInteger(pigDescriptor.localTileX), 'pig localTileX integer');
  assert(Number.isInteger(pigDescriptor.localTileY), 'pig localTileY integer');

  // Stable PIG id deterministic, distinct from RABBIT, valid for removedNpcIds
  const pigId = buildChunkNpcId(pigChunkCoords.cx, pigChunkCoords.cy, 'PIG', 0);
  const rabbitId = buildChunkNpcId(pigChunkCoords.cx, pigChunkCoords.cy, 'RABBIT', 0);
  assertEqual(
    pigId,
    `chunk_${pigChunkCoords.cx}_${pigChunkCoords.cy}_NPC_PIG_0`,
    'PIG stable id format'
  );
  assert(pigId !== rabbitId, 'PIG id differs from RABBIT id');
  assert(pigId.startsWith('chunk_') && pigId.indexOf('_NPC_') !== -1, 'PIG id passes removedNpcIds validation');

  // RABBIT id format unchanged
  assertEqual(buildChunkNpcId(0, 0, 'RABBIT', 0), 'chunk_0_0_NPC_RABBIT_0', 'RABBIT id format unchanged');

  // descriptor + chunkData not mutated by runtime-independent generation
  const before = JSON.stringify(ChunkGenerator.generate(seed, 2, -1));
  const after = JSON.stringify(ChunkGenerator.generate(seed, 2, -1));
  assertEqual(before, after, 'generation stays pure/deterministic');

  // PIG uses a separate RNG stream: RABBIT layout unchanged vs. a build without pig would be
  // guaranteed by the dedicated 'chunk-npcs-pig' stream (object/rabbit streams untouched).
  const objsA = ChunkGenerator.generate(seed, 3, 3).objects;
  const objsB = ChunkGenerator.generate(seed, 3, 3).objects;
  assertEqual(JSON.stringify(objsA), JSON.stringify(objsB), 'object layout deterministic alongside pig');
}

// ---------------------------------------------------------------------------
// PNG decode helper (for asset tests)
// ---------------------------------------------------------------------------
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
      assertEqual(data[8], 8, 'PNG bit depth 8');
      assertEqual(data[9], 6, 'PNG color type RGBA');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
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

// ---------------------------------------------------------------------------
// Asset + crop tests
// ---------------------------------------------------------------------------
{
  const crypto = require('crypto');
  const crop = require('./crop-pig-asset.js');
  const pngPath = path.join(root, 'assets/generated/pig.png');
  assert(fs.existsSync(pngPath), 'production PIG PNG exists at assets/generated/pig.png');
  const buffer = fs.readFileSync(pngPath);
  assertEqual(buffer.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
  const { width, height, pixels } = decodePng(buffer);
  assert(width > 0 && height > 0, 'PNG has dimensions');
  assert(width < 1536 && height < 1024, 'cropped canvas smaller than original 1536x1024');
  assertEqual(width, 894, 'cropped width 894');
  assertEqual(height, 432, 'cropped height 432');
  assert(buffer.length < 1500000, 'production PNG noticeably smaller than ~2MB original');

  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };

  // Corners transparent
  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(px(x, y)[3], 0, `corner (${x},${y}) fully transparent`);
  });

  // Content bbox with the crop script threshold
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  let greenish = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, aVal] = px(x, y);
      if (aVal > crop.ALPHA_THRESHOLD) {
        opaque += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (aVal > 32 && g > r + 24 && g > b + 24) greenish += 1;
    }
  }
  assert(opaque > 0, 'PNG has opaque pig pixels');
  assertEqual(greenish, 0, 'no green background / halo among opaque pixels');
  assertEqual(minX, crop.PADDING, 'left padding equals crop padding');
  assertEqual(minY, crop.PADDING, 'top padding equals crop padding');
  assertEqual(width - 1 - maxX, crop.PADDING, 'right padding equals crop padding');
  assertEqual(height - 1 - maxY, crop.PADDING, 'bottom padding equals crop padding');
  assertEqual(maxX - minX + 1, 862, 'content width preserved at 862');
  assertEqual(maxY - minY + 1, 400, 'content height preserved at 400');

  // Visible world size preserved within 1% vs pre-crop values
  const pig = getPassiveNpcConfig('PIG');
  const oldVisibleW = 150 * 862 / 1536;
  const oldVisibleH = 100 * 400 / 1024;
  const newVisibleW = pig.renderWidth * 862 / width;
  const newVisibleH = pig.renderHeight * 400 / height;
  const dW = Math.abs(newVisibleW - oldVisibleW) / oldVisibleW;
  const dH = Math.abs(newVisibleH - oldVisibleH) / oldVisibleH;
  assert(dW <= 0.01, `visible world width delta ${dW} within 1%`);
  assert(dH <= 0.01, `visible world height delta ${dH} within 1%`);

  // Body remapped and inside texture
  assertEqual(pig.bodyOffsetX, 460 - 305 + 16, 'bodyOffsetX = old - cropLeft + padding');
  assertEqual(pig.bodyOffsetY, 582 - 304 + 16, 'bodyOffsetY = old - cropTop + padding');
  assert(pig.bodyOffsetX >= 0, 'bodyOffsetX >= 0');
  assert(pig.bodyOffsetY >= 0, 'bodyOffsetY >= 0');
  assert(pig.bodyOffsetX + pig.bodyWidth <= width, 'body fits horizontally');
  assert(pig.bodyOffsetY + pig.bodyHeight <= height, 'body fits vertically');

  // Idempotency: re-crop must not change hash/dimensions
  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = crop.cropPigAsset();
  const second = crop.cropPigAsset();
  assertEqual(first.newWidth, width, 'idempotent width');
  assertEqual(first.newHeight, height, 'idempotent height');
  assertEqual(second.newWidth, first.newWidth, 'second crop same width');
  assertEqual(second.newHeight, first.newHeight, 'second crop same height');
  assertEqual(first.sha256, hashBefore, 'first re-crop keeps file hash');
  assertEqual(second.sha256, first.sha256, 'second re-crop keeps file hash');
}

// ---------------------------------------------------------------------------
// Runtime wiring: GameScene registers pig-texture from the embedded data URL
// ---------------------------------------------------------------------------
{
  const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');
  assert(
    /this\.load\.image\(\s*'pig-texture'\s*,\s*PIG_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'GameScene loads pig-texture from PIG_TEXTURE_DATA_URL'
  );
  assert(!/data:image\/png;base64,/.test(gameScene), 'no base64 hardcoded in GameScene');

  const generated = fs.readFileSync(path.join(root, 'src/generated/PigTextureData.js'), 'utf8');
  assert(/^const PIG_TEXTURE_DATA_URL = 'data:image\/png;base64,/.test(generated.split('\n').find((l) => l.startsWith('const'))), 'generated module exposes data URL');
}

// ---------------------------------------------------------------------------
// Build embedding: offline HTML is self-contained and has no external pig.png
// ---------------------------------------------------------------------------
{
  const offlinePath = path.join(root, 'dist/gamefromnazar-offline.html');
  assert(fs.existsSync(offlinePath), 'offline build exists (run node build.js first)');
  const offline = fs.readFileSync(offlinePath, 'utf8');
  assert(offline.includes('data:image/png;base64,'), 'offline HTML embeds the pig data URL');
  assert(offline.includes("'pig-texture'"), 'offline HTML references pig-texture key');
  // No external pig.png referenced as a loadable resource (quotes would indicate a path literal).
  assert(!/pig\.png['"]/.test(offline), 'offline HTML does not reference an external pig.png file');
  assert(!/<img[\s>]/i.test(offline), 'offline HTML has no external <img> tag');
}

console.log('test-pig-npc: ok');
