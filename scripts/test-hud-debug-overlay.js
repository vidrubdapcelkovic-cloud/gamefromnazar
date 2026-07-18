// Narrow UI guard: the technical world-debug overlay (seed/tile/chunk/active/
// pos/depth/vis) must be gone from the production GameScene, while the resource
// HUD (STONE/BERRIES) and other gameplay UI stay intact. This is a source-level
// test because GameScene requires a live Phaser runtime to instantiate; it
// targets the specific overlay only and does not blanket-ban the word "debug".
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gameScene = fs.readFileSync(path.join(root, 'src/GameScene.js'), 'utf8');

// ---- World-debug overlay fully removed ----
assert(!/createChunkDebugOverlay/.test(gameScene), 'createChunkDebugOverlay removed');
assert(!/updateChunkDebugOverlay/.test(gameScene), 'updateChunkDebugOverlay removed');
assert(!/chunkDebugText/.test(gameScene), 'chunkDebugText reference removed');
assert(!/CHUNK_WORLD_DEBUG/.test(gameScene), 'CHUNK_WORLD_DEBUG flag removed');

// The specific debug lines must no longer be built anywhere.
assert(!/`seed: \$\{/.test(gameScene), 'seed line removed');
assert(!/`tile: \$\{/.test(gameScene), 'tile line removed');
assert(!/`chunk: \$\{chunk\./.test(gameScene), 'chunk line removed');
assert(!/`active: \$\{this\.chunkManager\.getActiveCount/.test(gameScene), 'active line removed');
assert(!/`vis: \$\{this\.player\.visible/.test(gameScene), 'vis line removed');
assert(!/`depth: \$\{this\.player\.depth/.test(gameScene), 'depth line removed');

// No hidden/leftover overlay object kept alive invisibly.
assert(!/chunkDebug/i.test(gameScene), 'no leftover chunkDebug object');

// ---- Resource HUD (STONE/BERRIES) preserved ----
assert(/inventoryHudText/.test(gameScene), 'inventory/resource HUD text preserved');
assert(
  /STONE: \$\{this\.inventoryModel\.getTotal\('STONE'\)\}/.test(gameScene),
  'STONE resource readout preserved'
);
assert(
  /BERRIES: \$\{this\.inventoryModel\.getTotal\('BERRIES'\)\}/.test(gameScene),
  'BERRIES resource readout preserved'
);

// ---- Other gameplay UI untouched ----
assert(/dayNightHudText/.test(gameScene), 'day/night HUD preserved');
assert(/new StatusHUD\(/.test(gameScene) || /StatusHUD/.test(gameScene), 'StatusHUD (HP) preserved');

// ---- Gameplay constants unchanged ----
assert(/const PLAYER_SPEED = 260;/.test(gameScene), 'PLAYER_SPEED unchanged');
assert(/const PLAYER_NAZAR_SCALE = PLAYER_NAZAR_PREVIOUS_SCALE \/ 1\.5;/.test(gameScene), 'player scale unchanged');

// ---- Save schema has no debug/overlay state ----
const saveSystem = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
assert(!/chunkDebug/i.test(saveSystem), 'save schema has no debug overlay state');

console.log('test-hud-debug-overlay: ok');
