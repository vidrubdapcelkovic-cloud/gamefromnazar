function buildChunkNpcId(chunkX, chunkY, type, index) {
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    throw new Error('Некорректные координаты чанка для NPC ID.');
  }
  if (typeof type !== 'string') {
    throw new Error('Некорректный тип NPC для ID.');
  }
  const normalizedType = type.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!normalizedType) {
    throw new Error('Пустой или небезопасный тип NPC для ID.');
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Некорректный индекс NPC для ID.');
  }
  return `chunk_${chunkX}_${chunkY}_NPC_${normalizedType}_${index}`;
}
