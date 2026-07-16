function chooseNpcWanderTarget(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Некорректные параметры выбора клетки блуждания NPC.');
  }

  const { localTileX, localTileY, chunkSize, blockedCells, randomValue } = options;

  if (!Number.isInteger(localTileX) || !Number.isInteger(localTileY)) {
    throw new Error('Некорректные локальные координаты для блуждания NPC.');
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('Некорректный размер чанка для блуждания NPC.');
  }
  if (
    localTileX < 0
    || localTileY < 0
    || localTileX >= chunkSize
    || localTileY >= chunkSize
  ) {
    throw new Error('Текущая клетка NPC находится вне чанка.');
  }
  if (!(blockedCells instanceof Set)) {
    throw new Error('blockedCells должен быть Set.');
  }
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error('Некорректный randomValue для блуждания NPC.');
  }

  // Fixed orthogonal order: up, right, down, left. Key format: "x,y".
  const neighborOffsets = [
    { localTileX: 0, localTileY: -1 },
    { localTileX: 1, localTileY: 0 },
    { localTileX: 0, localTileY: 1 },
    { localTileX: -1, localTileY: 0 }
  ];

  const candidates = [];
  neighborOffsets.forEach((offset) => {
    const nextX = localTileX + offset.localTileX;
    const nextY = localTileY + offset.localTileY;
    if (!Number.isInteger(nextX) || !Number.isInteger(nextY)) return;
    if (nextX < 0 || nextY < 0 || nextX >= chunkSize || nextY >= chunkSize) return;
    if (nextX === localTileX && nextY === localTileY) return;
    if (blockedCells.has(`${nextX},${nextY}`)) return;
    candidates.push({ localTileX: nextX, localTileY: nextY });
  });

  if (candidates.length === 0) return null;
  const index = Math.floor(randomValue * candidates.length);
  return candidates[index];
}
