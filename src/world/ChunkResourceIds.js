function buildChunkResourceId(chunkX, chunkY, type, localTileX, localTileY) {
  return `chunk_${chunkX}_${chunkY}_${type}_${localTileX}_${localTileY}`;
}

function shouldMaterializeChunkResource(id, removedIds) {
  return !(removedIds instanceof Set) || !removedIds.has(id);
}
