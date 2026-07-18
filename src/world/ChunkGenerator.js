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

    // River water mask is computed from the world seed and absolute coordinates
    // (see RiverGenerator) BEFORE any TREE/ROCK/NPC placement. Water cells are a
    // pure function of position, independent of chunk load order and of the
    // object/NPC RNG streams below.
    const isWaterCell = (localX, localY) => {
      const worldTile = ChunkMath.chunkLocalToWorldTile(chunkX, chunkY, localX, localY);
      return RiverGenerator.isWaterTile(worldSeed, worldTile.tileX, worldTile.tileY);
    };

    const water = [];
    for (let localY = 0; localY < chunkSize; localY += 1) {
      for (let localX = 0; localX < chunkSize; localX += 1) {
        if (!isWaterCell(localX, localY)) continue;
        water.push({
          type: 'RIVER_WATER',
          localTileX: localX,
          localTileY: localY,
          // Stable id mirrors buildChunkResourceId's format without coupling the
          // generator to that module: chunk_X_Y_RIVER_WATER_localX_localY.
          id: `chunk_${chunkX}_${chunkY}_RIVER_WATER_${localX}_${localY}`
        });
      }
    }

    const tryPlace = (type, localX, localY, variant) => {
      if (!Number.isInteger(localX) || !Number.isInteger(localY)) return false;
      if (localX < 0 || localX >= chunkSize || localY < 0 || localY >= chunkSize) return false;
      const key = `${localX},${localY}`;
      if (occupied.has(key) || isInStartClearZone(localX, localY)) return false;
      occupied.add(key);
      // Water consumes the candidate slot but places no object. This keeps the
      // existing RNG draw sequence identical, so object positions/IDs outside
      // water are unchanged; objects that would land on water are simply omitted.
      if (isWaterCell(localX, localY)) return true;
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
        placedNpc = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'RABBIT',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // PIG uses its own deterministic stream so the RABBIT chance/placement above is
    // untouched. PIG appears about 2.5x rarer than RABBIT and is not guaranteed.
    const pigRng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-npcs-pig');
    if (pigRng.next() < 0.14) {
      let placedPig = false;
      for (let attempt = 0; attempt < 48 && !placedPig; attempt += 1) {
        const localX = pigRng.nextInt(0, chunkSize);
        const localY = pigRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        // occupied already contains TREE/ROCK cells and any RABBIT tile.
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedPig = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'PIG',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // LLAMA uses its own deterministic stream so RABBIT/PIG placement stays unchanged.
    // Slightly rarer than PIG; not guaranteed in every chunk.
    const llamaRng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-npcs-llama');
    if (llamaRng.next() < 0.12) {
      let placedLlama = false;
      for (let attempt = 0; attempt < 48 && !placedLlama; attempt += 1) {
        const localX = llamaRng.nextInt(0, chunkSize);
        const localY = llamaRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedLlama = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'LLAMA',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // BUFFALO uses its own deterministic stream so RABBIT/PIG/LLAMA placement stays unchanged.
    // Rarer than PIG and LLAMA; not guaranteed in every chunk.
    const buffaloRng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-npcs-buffalo');
    if (buffaloRng.next() < 0.08) {
      let placedBuffalo = false;
      for (let attempt = 0; attempt < 48 && !placedBuffalo; attempt += 1) {
        const localX = buffaloRng.nextInt(0, chunkSize);
        const localY = buffaloRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedBuffalo = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'BUFFALO',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // TALL_MONSTER uses a separate enemy stream so passive NPC placement stays unchanged.
    const tallMonsterRng = SeededRandom.fromParts(
      worldSeed,
      chunkX,
      chunkY,
      'chunk-enemies-tall-monster'
    );
    if (tallMonsterRng.next() < 0.10) {
      let placedTallMonster = false;
      for (let attempt = 0; attempt < 48 && !placedTallMonster; attempt += 1) {
        const localX = tallMonsterRng.nextInt(0, chunkSize);
        const localY = tallMonsterRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedTallMonster = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'TALL_MONSTER',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // ELECTRICMAN uses its own enemy stream so TALL_MONSTER placement stays unchanged.
    const electricmanRng = SeededRandom.fromParts(
      worldSeed,
      chunkX,
      chunkY,
      'chunk-enemies-electricman'
    );
    if (electricmanRng.next() < 0.12) {
      let placedElectricman = false;
      for (let attempt = 0; attempt < 48 && !placedElectricman; attempt += 1) {
        const localX = electricmanRng.nextInt(0, chunkSize);
        const localY = electricmanRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedElectricman = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'ELECTRICMAN',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // BOWMAN uses its own enemy stream so prior hostile placement stays unchanged.
    // Melee-only on this stage; bow art is static (ranged attack is a later stage).
    const bowmanRng = SeededRandom.fromParts(
      worldSeed,
      chunkX,
      chunkY,
      'chunk-enemies-bowman'
    );
    if (bowmanRng.next() < 0.10) {
      let placedBowman = false;
      for (let attempt = 0; attempt < 48 && !placedBowman; attempt += 1) {
        const localX = bowmanRng.nextInt(0, chunkSize);
        const localY = bowmanRng.nextInt(0, chunkSize);
        const key = `${localX},${localY}`;
        if (occupied.has(key) || isInStartClearZone(localX, localY)) continue;
        occupied.add(key);
        placedBowman = true;
        if (isWaterCell(localX, localY)) break;
        npcs.push({
          type: 'BOWMAN',
          index: 0,
          localTileX: localX,
          localTileY: localY
        });
      }
    }

    // BERRY_BUSH is a harvestable, non-blocking resource. It uses its own
    // deterministic stream and is placed AFTER every other object/NPC, so the
    // existing TREE/ROCK/NPC streams and positions stay byte-for-byte identical.
    // tryPlace reuses the shared occupied/clear-zone/water checks, so bushes
    // never overlap TREE/ROCK/NPC, never appear in the start clear zone and
    // never appear on water (only real water candidates are omitted; dry land
    // and passable banks remain valid). Harvest yields BERRIES ×2 (see
    // GameScene WORLD_OBJECT_DROPS) and the stable id is
    // chunk_X_Y_BERRY_BUSH_localX_localY.
    const BERRY_BUSH_SPAWN_CHANCE = 0.55;
    const BERRY_BUSH_MAX_PER_CHUNK = 3;
    const berryRng = SeededRandom.fromParts(worldSeed, chunkX, chunkY, 'chunk-berry-bushes');
    if (berryRng.next() < BERRY_BUSH_SPAWN_CHANCE) {
      const berryTarget = berryRng.nextInt(1, BERRY_BUSH_MAX_PER_CHUNK + 1);
      let berryPlaced = 0;
      let berryAttempts = 0;
      const berryMaxAttempts = berryTarget * 24;
      while (berryPlaced < berryTarget && berryAttempts < berryMaxAttempts) {
        berryAttempts += 1;
        const localX = berryRng.nextInt(0, chunkSize);
        const localY = berryRng.nextInt(0, chunkSize);
        if (tryPlace('BERRY_BUSH', localX, localY, berryPlaced)) {
          berryPlaced += 1;
        }
      }
    }

    return {
      chunkX,
      chunkY,
      terrain,
      objects,
      water,
      npcs,
      spawnPoints
    };
  }
}