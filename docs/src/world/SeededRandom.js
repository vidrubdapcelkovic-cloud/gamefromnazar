class SeededRandom {
  constructor(seed) {
    let value = Number(seed);
    if (!Number.isFinite(value)) value = 1;
    this.state = (value >>> 0) || 1;
  }

  static hashParts(worldSeed, chunkX, chunkY, stream) {
    let hash = 2166136261;

    const mix = (value) => {
      hash ^= value >>> 0;
      hash = Math.imul(hash, 16777619);
    };

    if (typeof worldSeed === 'string') {
      for (let index = 0; index < worldSeed.length; index += 1) {
        mix(worldSeed.charCodeAt(index));
      }
    } else {
      mix(Number(worldSeed) || 0);
    }

    mix(chunkX | 0);
    mix(chunkY | 0);

    if (typeof stream === 'string') {
      for (let index = 0; index < stream.length; index += 1) {
        mix(stream.charCodeAt(index));
      }
    } else {
      mix(Number(stream) || 0);
    }

    return hash >>> 0;
  }

  static fromParts(worldSeed, chunkX, chunkY, stream) {
    return new SeededRandom(SeededRandom.hashParts(worldSeed, chunkX, chunkY, stream));
  }

  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive, maxExclusive) {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new Error('SeededRandom.nextInt expects integer min < max.');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }
}