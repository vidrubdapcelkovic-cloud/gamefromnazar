// Narrow UI guard: the technical world-debug overlay (seed/tile/chunk/active/
// pos/depth/vis) AND the top resource HUD (WOOD/STONE/BERRIES) must be gone from
// the production GameScene, while other gameplay UI (HP, day/night) and the
// resource model stay intact. Visible CRAFT/BUILD buttons must be localised to
// КРАФТ/СТРОИТЬ (internal names may keep English). This is a source-level test
// because the scene requires a live Phaser runtime to instantiate; it targets
// the specific overlay/HUD only and does not blanket-ban the word "debug".
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

// ---- Top resource HUD (WOOD/STONE/BERRIES) fully removed ----
assert(!/inventoryHudText/.test(gameScene), 'inventoryHudText HUD removed');
assert(!/updateInventoryHud/.test(gameScene), 'updateInventoryHud method + calls removed');
assert(!/createInterface\b/.test(gameScene), 'createInterface (resource HUD) removed');
assert(!/WOOD: \$\{this\.inventoryModel\.getTotal/.test(gameScene), 'WOOD HUD readout removed');
assert(!/STONE: \$\{this\.inventoryModel\.getTotal/.test(gameScene), 'STONE HUD readout removed');
assert(!/BERRIES: \$\{this\.inventoryModel\.getTotal/.test(gameScene), 'BERRIES HUD readout removed');

// ---- Resource model + economy preserved ----
assert(/this\.inventoryModel/.test(gameScene), 'inventory/resource model preserved');
assert(
  /BERRY_BUSH: Object\.freeze\(\{ itemType: 'BERRIES', quantity: 2 \}\)/.test(gameScene),
  'BERRY_BUSH drop economy preserved (BERRIES x2)'
);

// ---- Other gameplay UI untouched ----
assert(/dayNightHudText/.test(gameScene), 'day/night HUD preserved');
assert(/new StatusHUD\(/.test(gameScene) || /StatusHUD/.test(gameScene), 'StatusHUD (HP) preserved');

// ---- Visible CRAFT/BUILD buttons localised ----
const craftingUI = fs.readFileSync(path.join(root, 'src/ui/CraftingUI.js'), 'utf8');
const inputController = fs.readFileSync(path.join(root, 'src/controllers/InputController.js'), 'utf8');
assert(/add\.text\(0, 0, 'КРАФТ'/.test(craftingUI), 'CRAFT button label localised to КРАФТ');
assert(!/add\.text\(0, 0, 'CRAFT'/.test(craftingUI), 'visible CRAFT English label removed');
assert(/add\.text\(0, 0, 'СТРОИТЬ'/.test(inputController), 'BUILD button label localised to СТРОИТЬ');
assert(!/add\.text\(0, 0, 'BUILD'/.test(inputController), 'visible BUILD English label removed');
// Internal handlers/keys keep their English names (unchanged behaviour).
assert(/onCraftKey/.test(craftingUI), 'internal craft handler name preserved');
assert(/toggleBuildMode/.test(gameScene), 'internal build toggle handler preserved');

// ---- Gameplay constants unchanged ----
assert(/const PLAYER_SPEED = 260;/.test(gameScene), 'PLAYER_SPEED unchanged');
assert(/const PLAYER_NAZAR_SCALE = PLAYER_NAZAR_PREVIOUS_SCALE \/ 1\.5;/.test(gameScene), 'player scale unchanged');

// ---- Save schema has no debug/overlay/HUD state ----
const saveSystem = fs.readFileSync(path.join(root, 'src/systems/SaveSystem.js'), 'utf8');
assert(!/chunkDebug/i.test(saveSystem), 'save schema has no debug overlay state');
assert(!/inventoryHudText/i.test(saveSystem), 'save schema has no resource HUD state');

console.log('test-hud-debug-overlay: ok');
