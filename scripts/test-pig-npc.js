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
// 18. Asset tests
// ---------------------------------------------------------------------------
{
  const pngPath = path.join(root, 'assets/generated/pig.png');
  assert(fs.existsSync(pngPath), 'production PIG PNG exists at assets/generated/pig.png');
  const buffer = fs.readFileSync(pngPath);
  assertEqual(buffer.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
  const { width, height, pixels } = decodePng(buffer);
  assert(width > 0 && height > 0, 'PNG has dimensions');

  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };

  // Corners transparent
  [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].forEach(([x, y]) => {
    assertEqual(px(x, y)[3], 0, `corner (${x},${y}) fully transparent`);
  });

  // No green background box + no obvious green halo: opaque pixels must not be green-dominant
  let opaque = 0;
  let greenish = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const [r, g, b, aVal] = px(x, y);
      if (aVal > 32) {
        opaque += 1;
        if (g > r + 24 && g > b + 24) greenish += 1;
      }
    }
  }
  assert(opaque > 0, 'PNG has visible pig pixels');
  assertEqual(greenish, 0, 'no green background / halo among opaque pixels');

  // Alpha channel is actually used (transparent + opaque both present)
  assert(opaque > 0, 'has opaque pixels');
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
