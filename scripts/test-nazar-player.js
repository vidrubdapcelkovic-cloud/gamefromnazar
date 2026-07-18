const fs = require('fs');
const path = require('path');
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

const prepare = require('./prepare-nazar-asset.js');

function decodePng(buffer) {
  let o = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (o + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(o);
    const type = buffer.slice(o + 4, o + 8).toString('ascii');
    const data = buffer.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
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
  return { width, height, colorType, pixels: out };
}

// Parse a numeric const literal out of the GameScene source so the test tracks
// the real player geometry without hardcoding a duplicate copy.
function readConst(source, name) {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
  assert(match, `constant ${name} present in GameScene`);
  return Number(match[1]);
}

const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');

// ---- Asset ----
const pngPath = path.join(root, 'assets/generated/nazar.png');
assert(fs.existsSync(pngPath), 'nazar.png exists');
const buffer = fs.readFileSync(pngPath);
const { width: TEX_W, height: TEX_H, colorType, pixels } = decodePng(buffer);
assertEqual(colorType, 6, 'prepared PNG is RGBA');

const alpha = (x, y) => pixels[(y * TEX_W + x) * 4 + 3];
[[0, 0], [TEX_W - 1, 0], [0, TEX_H - 1], [TEX_W - 1, TEX_H - 1]].forEach(([x, y]) => {
  assertEqual(alpha(x, y), 0, `corner transparent ${x},${y}`);
});

// No opaque greenscreen on the outer border.
let borderGreen = 0;
for (let x = 0; x < TEX_W; x += 8) {
  [[x, 0], [x, TEX_H - 1]].forEach(([bx, by]) => {
    const i = (by * TEX_W + bx) * 4;
    if (pixels[i + 3] > 32 && pixels[i + 1] > pixels[i] + 25 && pixels[i + 1] > pixels[i + 2] + 25 && pixels[i + 1] > 100) {
      borderGreen += 1;
    }
  });
}
assertEqual(borderGreen, 0, 'no green border');

// Content bbox + 16 px padding on every side.
let minX = TEX_W;
let minY = TEX_H;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < TEX_H; y += 1) {
  for (let x = 0; x < TEX_W; x += 1) {
    if (alpha(x, y) > prepare.ALPHA_THRESHOLD) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const CONTENT_W = maxX - minX + 1;
const CONTENT_H = maxY - minY + 1;
assertEqual(minX, prepare.PADDING, 'left pad 16');
assertEqual(minY, prepare.PADDING, 'top pad 16');
assertEqual(TEX_W - 1 - maxX, prepare.PADDING, 'right pad 16');
assertEqual(TEX_H - 1 - maxY, prepare.PADDING, 'bottom pad 16');
assert(CONTENT_W > 0 && CONTENT_H > 0, 'content present');
assert(CONTENT_H > CONTENT_W, 'humanoid silhouette taller than wide');

// No large interior greenscreen component survived the flood-fill (only a few
// isolated natural-green pixels tolerated). This mirrors the BOWMAN guard.
{
  const GREEN_REFERENCE = { r: 14, g: 245, b: 16 };
  const DOMINANCE = prepare.INNER_GREEN_DOMINANCE;
  const MIN_G = prepare.INNER_GREEN_MIN;
  const DIST_SQ = prepare.INNER_KEY_DISTANCE_SQ;
  const OPAQUE = 32;
  const MAX_TOTAL = 24;
  const MAX_COMPONENT = 12;

  const isBrightGreen = (o) => {
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    if (pixels[o + 3] <= OPAQUE) return false;
    if (!(g > r + DOMINANCE && g > b + DOMINANCE && g >= MIN_G)) return false;
    const dr = r - GREEN_REFERENCE.r;
    const dg = g - GREEN_REFERENCE.g;
    const db = b - GREEN_REFERENCE.b;
    return (dr * dr + dg * dg + db * db) <= DIST_SQ;
  };

  const visited = new Uint8Array(TEX_W * TEX_H);
  let total = 0;
  let largest = 0;
  for (let y = 0; y < TEX_H; y += 1) {
    for (let x = 0; x < TEX_W; x += 1) {
      const idx = y * TEX_W + x;
      if (visited[idx]) continue;
      if (!isBrightGreen(idx * 4)) { visited[idx] = 1; continue; }
      const stack = [idx];
      visited[idx] = 1;
      let size = 0;
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % TEX_W;
        const cy = (cur - cx) / TEX_W;
        size += 1;
        total += 1;
        const neighbors = [];
        if (cx > 0) neighbors.push(cur - 1);
        if (cx + 1 < TEX_W) neighbors.push(cur + 1);
        if (cy > 0) neighbors.push(cur - TEX_W);
        if (cy + 1 < TEX_H) neighbors.push(cur + TEX_W);
        neighbors.forEach((n) => {
          if (!visited[n]) {
            visited[n] = 1;
            if (isBrightGreen(n * 4)) stack.push(n);
          }
        });
      }
      if (size > largest) largest = size;
    }
  }
  assert(total <= MAX_TOTAL && largest <= MAX_COMPONENT,
    `interior greenscreen remnant: total=${total} (max ${MAX_TOTAL}), largest=${largest} (max ${MAX_COMPONENT})`);
}

// Idempotency: two prepare runs give identical dims / bbox / hash.
{
  const hashBefore = crypto.createHash('sha256').update(buffer).digest('hex');
  const first = prepare.prepareNazarAsset();
  const second = prepare.prepareNazarAsset();
  assertEqual(first.sha256, hashBefore, 'prepare idempotent (already-prepared hash)');
  assertEqual(second.sha256, first.sha256, 'two-run same hash');
  assertEqual(first.newWidth, TEX_W, 'two-run width');
  assertEqual(first.newHeight, TEX_H, 'two-run height');
  assertEqual(second.newWidth, first.newWidth, 'stable width');
  assertEqual(second.newHeight, first.newHeight, 'stable height');
  assertEqual(JSON.stringify(second.contentBBox), JSON.stringify(first.contentBBox), 'stable content bbox');
}

// ---- Texture / build wiring ----
{
  const generatedPath = path.join(root, 'src/generated/NazarTextureData.js');
  assert(fs.existsSync(generatedPath), 'NazarTextureData.js exists');
  const generated = fs.readFileSync(generatedPath, 'utf8');
  assert(
    generated.includes("const NAZAR_TEXTURE_DATA_URL = 'data:image/png;base64,"),
    'NAZAR_TEXTURE_DATA_URL data URL export'
  );

  assert(/const PLAYER_NAZAR_TEXTURE_KEY = 'nazar-texture';/.test(gameScene), 'texture key const');
  assert(
    /this\.load\.image\(\s*PLAYER_NAZAR_TEXTURE_KEY\s*,\s*NAZAR_TEXTURE_DATA_URL\s*\)/.test(gameScene),
    'preload registers nazar-texture'
  );
  assert(
    /this\.physics\.add\.sprite\([\s\S]*?useNazarTexture \? PLAYER_NAZAR_TEXTURE_KEY/.test(gameScene),
    'player sprite uses nazar-texture'
  );

  const offline = fs.readFileSync(path.join(root, 'dist/gamefromnazar-offline.html'), 'utf8');
  assert(offline.includes("const NAZAR_TEXTURE_DATA_URL = 'data:image/png;base64,"), 'offline embeds nazar data URL');
  assert(offline.includes("'nazar-texture'") || offline.includes('PLAYER_NAZAR_TEXTURE_KEY'), 'offline registers texture key');
  assert(!/nazar\.png['"]/.test(offline), 'offline does not load nazar.png externally');
}

// ---- Render / body geometry (single uniform scale, reduced exactly 1.5x) ----
{
  // The player is scaled with ONE uniform factor derived from the initial pass
  // and divided by exactly 1.5. Verify the source encodes that and applies it
  // via setScale (not per-axis setDisplaySize).
  assert(/const PLAYER_NAZAR_PREVIOUS_SCALE = 103 \/ 1039;/.test(gameScene), 'previous scale documented (103/1039)');
  assert(/const PLAYER_NAZAR_SCALE = PLAYER_NAZAR_PREVIOUS_SCALE \/ 1\.5;/.test(gameScene), 'scale reduced by exactly 1.5');
  assert(/this\.player\.setScale\(PLAYER_NAZAR_SCALE\)/.test(gameScene), 'player uses a single uniform setScale');
  assert(!/setDisplaySize\(PLAYER_NAZAR/.test(gameScene), 'no per-axis display size for the player');

  const PREV_SCALE = 103 / 1039;
  const SCALE = PREV_SCALE / 1.5;
  const BODY_W = readConst(gameScene, 'PLAYER_NAZAR_BODY_WIDTH');
  const BODY_H = readConst(gameScene, 'PLAYER_NAZAR_BODY_HEIGHT');
  const OFF_X = readConst(gameScene, 'PLAYER_NAZAR_BODY_OFFSET_X');
  const OFF_Y = readConst(gameScene, 'PLAYER_NAZAR_BODY_OFFSET_Y');

  // Reduction factor is exactly 1.5.
  assert(Math.abs(PREV_SCALE / SCALE - 1.5) < 1e-6, 'scale reduced by exactly 1.5x');

  // Display size ~45x69 (single uniform scale over the source texture).
  const displayW = TEX_W * SCALE;
  const displayH = TEX_H * SCALE;
  assert(Math.abs(displayW - 45) <= 1.5, `display width ~45 (got ${displayW.toFixed(1)})`);
  assert(Math.abs(displayH - 69) <= 1.5, `display height ~69 (got ${displayH.toFixed(1)})`);

  // Visible silhouette height ~66-67 px, aspect exactly the source aspect.
  const visibleW = CONTENT_W * SCALE;
  const visibleH = CONTENT_H * SCALE;
  assert(visibleH >= 65 && visibleH <= 68, `visible height ~66-67 (got ${visibleH.toFixed(1)})`);
  assert(Math.abs(visibleW / visibleH - CONTENT_W / CONTENT_H) < 1e-6, 'aspect ratio preserved (uniform scale)');

  // texture-space body must NOT be shrunk a second time (still 300x424 @ 185,416).
  assertEqual(BODY_W, 300, 'texture-space body width unchanged');
  assertEqual(BODY_H, 424, 'texture-space body height unchanged');
  assertEqual(OFF_X, 185, 'texture-space body offset X unchanged');
  assertEqual(OFF_Y, 416, 'texture-space body offset Y unchanged');

  // Body fully inside texture bounds and excludes the transparent padding band.
  assert(OFF_X >= prepare.PADDING, 'body left excludes padding');
  assert(OFF_Y >= prepare.PADDING, 'body top excludes padding');
  assert(OFF_X + BODY_W <= TEX_W - prepare.PADDING, 'body right within texture');
  assert(OFF_Y + BODY_H <= TEX_H - prepare.PADDING, 'body bottom within texture');

  // Body sits below the head and above the feet (torso/pelvis/upper legs).
  assert(OFF_Y - minY >= 0.15 * CONTENT_H, 'body starts below head region');
  assert(OFF_Y + BODY_H <= maxY, 'body does not reach the very bottom (feet)');

  // World footprint ~20x28 px (single scale applied once, not twice).
  const bodyWorldW = BODY_W * SCALE;
  const bodyWorldH = BODY_H * SCALE;
  assert(Math.abs(bodyWorldW - 20) <= 2, `world body width ~20 (got ${bodyWorldW.toFixed(1)})`);
  assert(Math.abs(bodyWorldH - 28) <= 2, `world body height ~28 (got ${bodyWorldH.toFixed(1)})`);
  // Guard against a double-shrunk collider: it must stay clearly larger than a
  // 1.5x-of-1.5x mistake would produce (~13x18).
  assert(bodyWorldW > 16 && bodyWorldH > 22, 'collider not shrunk twice');

  // flipX must not move the body: the player is never flipped and the body
  // offset is applied once from constants (no flip-conditional mutation).
  assert(!/this\.player\.setFlipX/.test(gameScene), 'player is not flipped (no body drift)');
  assert(!/this\.player\.flipX\s*=/.test(gameScene), 'player flipX not mutated');
  assert(
    /this\.player\.body\.setOffset\(PLAYER_NAZAR_BODY_OFFSET_X, PLAYER_NAZAR_BODY_OFFSET_Y\)/.test(gameScene),
    'body offset applied from constants'
  );
}

// ---- Regression: same player runtime, untouched gameplay wiring ----
{
  const sprites = gameScene.match(/this\.player = this\.physics\.add\.sprite/g) || [];
  assertEqual(sprites.length, 1, 'exactly one player sprite is created');

  assert(/const PLAYER_SPEED = 260;/.test(gameScene), 'movement speed unchanged (260)');
  assert(/const PLAYER_MELEE_ATTACK = Object\.freeze\(\{ damage: 10, radius: 52, cooldownMs: 450 \}\)/.test(gameScene),
    'melee params unchanged');
  assert(/startFollow\(this\.player/.test(gameScene), 'camera follows player');
  assert(/damagePlayer\(amount, source\)/.test(gameScene), 'damagePlayer API unchanged');
  assert(gameScene.includes('this.player.x') && gameScene.includes('this.player.y'), 'systems read live player position');

  const chunkInstance = fs.readFileSync(path.join(root, 'src/world/ChunkInstance.js'), 'utf8');
  assert(/this\.scene\.player/.test(chunkInstance), 'hostile targeting reads scene.player');

  const saveSystem = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
  assert(!/nazar/i.test(saveSystem), 'save schema has no nazar-specific state');
  assert(!/texture/i.test(saveSystem), 'save schema has no texture-specific state');
}

console.log('test-nazar-player: ok');
