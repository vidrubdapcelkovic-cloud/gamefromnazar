/**
 * Deterministic crop of transparent padding from assets/generated/pig.png.
 *
 * - Finds the alpha content bbox (threshold documented below).
 * - Adds a fixed padding around the content (clamped to source edges).
 * - Copies pixels without colour changes and without resize.
 * - Overwrites assets/generated/pig.png via a temp file.
 * - Re-running on an already-cropped PNG yields an identical result.
 *
 * Alpha threshold: alpha > 4
 * Reason: alpha > 0 includes ~2k nearly-invisible outliers (alpha 1–3) far from
 * the pig that stretch the bbox almost to the full 1536×1024 canvas. Threshold
 * 4 removes those outliers while preserving the real silhouette (matches the
 * documented content region ~305..1165 × 304..703).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TARGET_RELATIVE = 'assets/generated/pig.png';
const TARGET_PATH = path.join(ROOT, TARGET_RELATIVE);
const ALPHA_THRESHOLD = 4;
const PADDING = 16;

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

function readPngRgba(filePath) {
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
  assert(colorType === 6, `Expected RGBA PNG (colorType 6), got ${colorType}`);
  assert(idat.length > 0, 'PNG missing IDAT');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let ip = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[ip];
    ip += 1;
    const prev = y > 0 ? pixels.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[ip + i];
      let a = 0;
      let b = 0;
      let c = 0;
      if (i >= bpp) a = pixels[y * stride + i - bpp];
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
      pixels[y * stride + i] = value;
    }
    ip += stride;
  }

  return { width, height, pixels };
}

function findContentBBox(image, alphaThreshold) {
  const { width, height, pixels } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
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

  // Filter type 0 (None) for deterministic encoding.
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const out = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, out);
}

function cropPigAsset() {
  assert(fs.existsSync(TARGET_PATH), `Missing ${TARGET_RELATIVE}`);

  const source = readPngRgba(TARGET_PATH);
  const bbox = findContentBBox(source, ALPHA_THRESHOLD);

  // Crop origin in source coordinates = content origin; padding is then applied.
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
    const srcY = top + y;
    const srcStart = (srcY * source.width + left) * 4;
    const dstStart = y * newWidth * 4;
    source.pixels.copy(cropped, dstStart, srcStart, srcStart + newWidth * 4);
  }

  const tempPath = path.join(
    path.dirname(TARGET_PATH),
    `.pig-crop-tmp-${process.pid}-${Date.now()}.png`
  );

  try {
    writePngRgba(tempPath, newWidth, newHeight, cropped);

    // Verify the temp result before replacing the production asset.
    const verified = readPngRgba(tempPath);
    assertEqualDims(verified, newWidth, newHeight);
    const verifiedBBox = findContentBBox(verified, ALPHA_THRESHOLD);
    assert(
      verifiedBBox.contentWidth === bbox.contentWidth
      && verifiedBBox.contentHeight === bbox.contentHeight,
      'Cropped content size must match source content size'
    );
    assert(
      verifiedBBox.minX === paddingX && verifiedBBox.minY === paddingY,
      'Cropped content must sit at the applied padding'
    );

    fs.renameSync(tempPath, TARGET_PATH);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      // Ignore cleanup failures; surface the original error.
    }
    throw error;
  }

  const finalBytes = fs.statSync(TARGET_PATH).size;
  const finalHash = crypto.createHash('sha256').update(fs.readFileSync(TARGET_PATH)).digest('hex');

  return {
    alphaThreshold: ALPHA_THRESHOLD,
    padding: PADDING,
    sourceWidth: source.width,
    sourceHeight: source.height,
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

function assertEqualDims(image, width, height) {
  assert(image.width === width && image.height === height, 'Unexpected PNG dimensions after write');
}

if (require.main === module) {
  const result = cropPigAsset();
  console.log('crop-pig-asset: ok');
  console.log(JSON.stringify({
    alphaThreshold: result.alphaThreshold,
    padding: result.padding,
    source: `${result.sourceWidth}x${result.sourceHeight}`,
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
  cropPigAsset,
  readPngRgba,
  findContentBBox
};
