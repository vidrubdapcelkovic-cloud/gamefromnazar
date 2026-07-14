class WorldGrid {
  constructor(mapData = FixedMapData) {
    this.tileSize = mapData.tileSize;
    this.columns = mapData.columns;
    this.rows = mapData.rows;
    this.worldWidth = this.columns * this.tileSize;
    this.worldHeight = this.rows * this.tileSize;
    this.tiles = mapData.tiles;
  }

  isInside(col, row) {
    return Number.isInteger(col)
      && Number.isInteger(row)
      && col >= 0
      && row >= 0
      && col < this.columns
      && row < this.rows;
  }

  getTileType(col, row) {
    if (!this.isInside(col, row)) return null;

    const tileType = this.tiles[row][col];
    return tileType === 'G' || tileType === 'S' || tileType === 'W' || tileType === 'R'
      ? tileType
      : null;
  }

  isWalkable(col, row) {
    const tileType = this.getTileType(col, row);
    return tileType !== null && tileType !== 'W';
  }

  worldToCell(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;

    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);
    return this.isInside(col, row) ? { col, row } : null;
  }

  cellToWorldCenter(col, row) {
    if (!this.isInside(col, row)) return null;

    return {
      x: col * this.tileSize + this.tileSize / 2,
      y: row * this.tileSize + this.tileSize / 2
    };
  }
}
