class ChunkGenerator {
  static generate(worldSeed, chunkX, chunkY) {
    const chunkSize = ChunkMath.CHUNK_SIZE;
    const terrain = [];
    for (let localY = 0; localY < chunkSize; localY += 1) {
      const row = [];
      for (let localX = 0; localX < chunkSize; localX += 1) {
        row.push('G');
      }
      terrain.push(row);
    }

    const objects = [];
    const occupied = new Set();
    const isStartChunk = chunkX === 0 && chunkY === 0;
    const clearMin = 8 - 3;
    const clearMax = 8 + 3;
    const rng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-objects');

    const isInStartClearZone = (localX, localY) => (
      isStartChunk
      && localX >= clearMin
      && localX <= clearMax
      && localY >= clearMin
      && localY <= clearMax
    );

    const tryPlace = (type, localX, localY, variant) => {
      if (!Number.isInteger(localX) || !Number.isInteger(localY)) return false;
      if (localX < 0 || localX >= chunkSize || localY < 0 || localY >= chunkSize) return false;
      const key = `${localX},${localY}`;
      if (occupied.has(key) || isInStartClearZone(localX, localY)) return false;
      occupied.add(key);
      objects.push({
        type,
        localTileX: localX,
        localTileY: localY,
        variant
      });
      return true;
    };

    const placeScattered = (type, count, variantBase) => {
      let placed = 0;
      let attempts = 0;
      const maxAttempts = count * 24;
      while (placed < count && attempts < maxAttempts) {
        attempts += 1;
        const localX = rng.nextInt(0, chunkSize);
        const localY = rng.nextInt(0, chunkSize);
        if (tryPlace(type, localX, localY, variantBase + placed)) {
          placed += 1;
        }
      }
    };

    const treeCount = isStartChunk ? rng.nextInt(4, 7) : rng.nextInt(5, 9);
    const stoneCount = isStartChunk ? rng.nextInt(3, 6) : rng.nextInt(4, 7);
    placeScattered('TREE', treeCount, 0);
    placeScattered('ROCK', stoneCount, 0);

    const spawnPoints = [];
    if (isStartChunk) {
      spawnPoints.push({ localTileX: 8, localTileY: 8 });
    }

    const npcs = [];
    const npcRng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-npcs');
    // Keep TREE/ROCK layout unchanged by using a separate stream for NPC chance/placement.
    if (npcRng.next() < 0.35) {
      let placedNpc = false;
      for (let attempt = 0; attempt < 48 && !placedNpc; attempt += 1) {
        const localX = npcRng.nextInt(0, chunkSize);
        const localY = npcRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        // Current terrain is always walkable grass; still skip occupied resource cells.
        occupied.add(key);
        npcs.push({
          type: 'RABBIT',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
        placedNpc = true;
      }
    }

    return {
      chunkX,
      chunkY,
      terrain,
      objects,
      npcs,
      spawnPoints
    };
  }
}