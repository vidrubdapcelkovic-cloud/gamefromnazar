/**
 * Deterministic preparation of assets/generated/llama.png.
 *
 * Input is typically an RGB PNG with a bright greenscreen background.
 * This script:
 * 1. Decodes RGB or RGBA into memory.
 * 2. Samples the border to estimate the greenscreen key colour.
 * 3. Flood-fills green background from the outer perimeter to alpha=0.
 * 4. Applies a minimal local green-fringe decontamination on silhouette edges.
 * 5. Crops to the opaque content bbox + 16 px transparent padding (no resize).
 * 6. Writes RGBA PNG to assets/generated/llama.png via a temp file.
 *
 * Re-running on the already-prepared RGBA result is idempotent: the content
 * already sits on transparent padding, so the second crop reproduces the same
 * canvas, dimensions and hash.
 *
 * Alpha content threshold for crop: alpha > 4.
 * Padding: 16 px (clamped to canvas edges).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TARGET_RELATIVE = 'assets/generated/llama.png';
const TARGET_PATH = path.join(ROOT, TARGET_RELATIVE);
const ALPHA_THRESHOLD = 4;
const PADDING = 16;
const GREEN_DOMINANCE = 18;
const GREEN_MIN = 80;
const KEY_DISTANCE_SQ = 70 * 70;
const FRINGE_DOMINANCE = 12;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function decodeFiltered(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let ip = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[ip];
    ip += 1;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[ip + i];
      let a = 0;
      let b = 0;
      let c = 0;
      if (i >= bpp) a = out[y * stride + i - bpp];
      if (prev) b = prev[i];
      if (prev && i >= bpp) c = prev[i - bpp];
      let value;
      if (filterType === 0) value = x;
      else if (filterType === 1) value = (x + a) & 255;
      else if (filterType === 2) value = (x + b) & 255;
      else if (filterType === 3) value = (x + ((a + b) >> 1)) & 255;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        value = (x + pr) & 255;
      } else {
        throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }
      out[y * stride + i] = value;
    }
    ip += stride;
  }
  return out;
}

function readPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert(
    buffer.length >= 8 && buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a',
    `Invalid PNG signature: ${filePath}`
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  assert(width > 0 && height > 0, 'PNG missing IHDR');
  assert(bitDepth === 8, `Expected 8-bit PNG, got bitDepth=${bitDepth}`);
  assert(colorType === 2 || colorType === 6, `Expected RGB or RGBA PNG, got colorType=${colorType}`);
  assert(idat.length > 0, 'PNG missing IDAT');

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const decoded = decodeFiltered(raw, width, height, bpp);
  return { width, height, colorType, bpp, pixels: decoded, buffer };
}

function toRgbaBuffer(image) {
  const { width, height, colorType, pixels } = image;
  if (colorType === 6) return Buffer.from(pixels);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i += 1, p += 3) {
    const o = i * 4;
    rgba[o] = pixels[p];
    rgba[o + 1] = pixels[p + 1];
    rgba[o + 2] = pixels[p + 2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

function sampleGreenKey(rgba, width, height) {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  const consider = (x, y) => {
    const o = (y * width + x) * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    if (a <= ALPHA_THRESHOLD) return;
    if (!(g > r + GREEN_DOMINANCE && g > b + GREEN_DOMINANCE && g >= GREEN_MIN)) return;
    count += 1;
    sumR += r;
    sumG += g;
    sumB += b;
  };

  for (let x = 0; x < width; x += 1) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    consider(0, y);
    consider(width - 1, y);
  }

  if (count === 0) {
    return null;
  }

  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
    samples: count
  };
}

function isGreenscreen(r, g, b, key) {
  if (!(g > r + GREEN_DOMINANCE && g > b + GREEN_DOMINANCE && g >= GREEN_MIN)) {
    return false;
  }
  const dr = r - key.r;
  const dg = g - key.g;
  const db = b - key.b;
  return (dr * dr + dg * dg + db * db) <= KEY_DISTANCE_SQ;
}

function floodFillGreenBackground(rgba, width, height, key) {
  const bg = new Uint8Array(width * height);
  const queue = [];
  let keyed = 0;

  const tryPush = (x, y) => {
    const idx = y * width + x;
    if (bg[idx]) return;
    const o = idx * 4;
    if (rgba[o + 3] <= ALPHA_THRESHOLD) {
      // Already transparent (prepared asset): treat as background seed.
      bg[idx] = 1;
      queue.push(x, y);
      return;
    }
    if (!isGreenscreen(rgba[o], rgba[o + 1], rgba[o + 2], key)) return;
    bg[idx] = 1;
    queue.push(x, y);
  };

  for (let x = 0; x < width; x += 1) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  for (let qi = 0; qi < queue.length; qi += 2) {
    const x = queue[qi];
    const y = queue[qi + 1];
    if (x > 0) tryPush(x - 1, y);
    if (x + 1 < width) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y + 1 < height) tryPush(x, y + 1);
  }

  for (let i = 0; i < bg.length; i += 1) {
    if (!bg[i]) continue;
    const o = i * 4;
    if (rgba[o + 3] !== 0) keyed += 1;
    rgba[o + 3] = 0;
  }

  return { bg, keyed };
}

function decontaminateGreenFringe(rgba, width, height, bg) {
  let touched = 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (bg[idx]) continue;
      const o = idx * 4;
      if (rgba[o + 3] <= ALPHA_THRESHOLD) continue;

      let nearBg = false;
      for (let n = 0; n < neighbors.length; n += 1) {
        const nx = x + neighbors[n][0];
        const ny = y + neighbors[n][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          nearBg = true;
          break;
        }
        if (bg[ny * width + nx] || rgba[(ny * width + nx) * 4 + 3] <= ALPHA_THRESHOLD) {
          nearBg = true;
          break;
        }
      }
      if (!nearBg) continue;

      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      if (!(g > r + FRINGE_DOMINANCE && g > b + FRINGE_DOMINANCE)) continue;

      // Local despill only: pull G toward the stronger of R/B, keep RGB otherwise.
      const target = Math.max(r, b);
      if (g > target) {
        rgba[o + 1] = target;
        touched += 1;
      }
    }
  }

  return touched;
}

function findContentBBox(width, height, pixels, alphaThreshold) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > alphaThreshold) {
        opaque += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  assert(opaque > 0 && maxX >= minX && maxY >= minY, 'No opaque content found');
  return {
    minX,
    minY,
    maxX,
    maxY,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1,
    opaque
  };
}

function writePngRgba(filePath, width, height, pixels) {
  assert(pixels.length === width * height * 4, 'Pixel buffer size mismatch');
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const out = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, out);
}

function prepareLlamaAsset() {
  assert(fs.existsSync(TARGET_PATH), `Missing ${TARGET_RELATIVE}`);

  // Read the entire input into memory first so the same path can be overwritten safely.
  const source = readPng(TARGET_PATH);
  const rgba = toRgbaBuffer(source);
  const key = sampleGreenKey(rgba, source.width, source.height);

  let keyed = 0;
  let fringeTouched = 0;
  let usedKey = null;

  if (key) {
    usedKey = key;
    const fill = floodFillGreenBackground(rgba, source.width, source.height, key);
    keyed = fill.keyed;
    fringeTouched = decontaminateGreenFringe(rgba, source.width, source.height, fill.bg);
  } else {
    // Already prepared transparent asset: no greenscreen left on the border.
    // Crop still recomputes padding for idempotency.
  }

  const bbox = findContentBBox(source.width, source.height, rgba, ALPHA_THRESHOLD);
  const cropLeft = bbox.minX;
  const cropTop = bbox.minY;
  const left = Math.max(0, cropLeft - PADDING);
  const top = Math.max(0, cropTop - PADDING);
  const right = Math.min(source.width - 1, bbox.maxX + PADDING);
  const bottom = Math.min(source.height - 1, bbox.maxY + PADDING);
  const paddingX = cropLeft - left;
  const paddingY = cropTop - top;
  const newWidth = right - left + 1;
  const newHeight = bottom - top + 1;

  const cropped = Buffer.alloc(newWidth * newHeight * 4, 0);
  for (let y = 0; y < newHeight; y += 1) {
    const srcStart = ((top + y) * source.width + left) * 4;
    cropped.set(rgba.subarray(srcStart, srcStart + newWidth * 4), y * newWidth * 4);
  }

  const tempPath = path.join(
    path.dirname(TARGET_PATH),
    `.llama-prep-tmp-${process.pid}-${Date.now()}.png`
  );

  try {
    writePngRgba(tempPath, newWidth, newHeight, cropped);
    const verified = readPng(tempPath);
    assert(verified.colorType === 6, 'Prepared PNG must be RGBA');
    assert(verified.width === newWidth && verified.height === newHeight, 'Unexpected prepared dimensions');
    const verifiedBBox = findContentBBox(verified.width, verified.height, verified.pixels, ALPHA_THRESHOLD);
    assert(
      verifiedBBox.contentWidth === bbox.contentWidth
      && verifiedBBox.contentHeight === bbox.contentHeight,
      'Prepared content size must match pre-crop content size'
    );
    assert(
      verifiedBBox.minX === paddingX && verifiedBBox.minY === paddingY,
      'Prepared content must sit at the applied padding'
    );
    fs.renameSync(tempPath, TARGET_PATH);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      // ignore cleanup failure
    }
    throw error;
  }

  const finalBytes = fs.statSync(TARGET_PATH).size;
  const finalHash = crypto.createHash('sha256').update(fs.readFileSync(TARGET_PATH)).digest('hex');

  return {
    sourceColorType: source.colorType,
    sourceWidth: source.width,
    sourceHeight: source.height,
    key: usedKey,
    keyed,
    fringeTouched,
    alphaThreshold: ALPHA_THRESHOLD,
    padding: PADDING,
    contentBBox: bbox,
    cropLeft,
    cropTop,
    paddingX,
    paddingY,
    newWidth,
    newHeight,
    bytes: finalBytes,
    sha256: finalHash
  };
}

if (require.main === module) {
  const result = prepareLlamaAsset();
  console.log('prepare-llama-asset: ok');
  console.log(JSON.stringify({
    sourceColorType: result.sourceColorType,
    source: `${result.sourceWidth}x${result.sourceHeight}`,
    key: result.key,
    keyed: result.keyed,
    fringeTouched: result.fringeTouched,
    content: `${result.contentBBox.contentWidth}x${result.contentBBox.contentHeight}`,
    contentBBox: {
      minX: result.contentBBox.minX,
      minY: result.contentBBox.minY,
      maxX: result.contentBBox.maxX,
      maxY: result.contentBBox.maxY
    },
    cropLeft: result.cropLeft,
    cropTop: result.cropTop,
    paddingX: result.paddingX,
    paddingY: result.paddingY,
    result: `${result.newWidth}x${result.newHeight}`,
    bytes: result.bytes,
    sha256: result.sha256
  }, null, 2));
}

module.exports = {
  ALPHA_THRESHOLD,
  PADDING,
  TARGET_RELATIVE,
  prepareLlamaAsset,
  readPng,
  findContentBBox
};
