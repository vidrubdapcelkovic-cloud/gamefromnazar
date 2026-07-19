// Localization guard: every player-visible UI string must be Russian, while
// internal identifiers (handlers, pending flags, enum keys, item/recipe/build
// IDs, save fields) stay unchanged. This is a source-level test because the
// scenes require a live Phaser runtime to instantiate; it targets the specific
// visible labels/messages and verifies that display strings come from the
// single-source catalogs instead of leaking internal item IDs.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const inputController = read('src/controllers/InputController.js');
const craftingUI = read('src/ui/CraftingUI.js');
const gameScene = read('src/GameScene.js');
const statusHUD = read('src/ui/StatusHUD.js');
const menuScene = read('src/MenuScene.js');
const itemCatalog = read('src/data/ItemCatalog.js');
const recipeCatalog = read('src/data/RecipeCatalog.js');
const buildCatalog = read('src/data/BuildCatalog.js');

// ---- Visible action buttons localised (InputController) ----
assert(/add\.text\(0, 0, 'ВЗЯТЬ'/.test(inputController), 'USE button localised to ВЗЯТЬ');
assert(/add\.text\(0, 0, 'АТАКА'/.test(inputController), 'ATTACK button localised to АТАКА');
assert(/make\('СОХР\.'\)/.test(inputController), 'SAVE button localised to СОХР.');
assert(/make\('ЗАГР\.'\)/.test(inputController), 'LOAD button localised to ЗАГР.');
assert(/add\.text\(0, 0, 'МЕНЮ'/.test(inputController), 'MENU button is МЕНЮ');
assert(/add\.text\(0, 0, 'СТРОИТЬ'/.test(inputController), 'BUILD button is СТРОИТЬ');
assert(/add\.text\(0, 0, 'ПОСТАВИТЬ'/.test(inputController), 'PLACE button localised to ПОСТАВИТЬ');

// ---- No English visible button labels remain ----
assert(!/add\.text\(0, 0, 'USE'/.test(inputController), 'no visible USE label');
assert(!/add\.text\(0, 0, 'ATTACK'/.test(inputController), 'no visible ATTACK label');
assert(!/add\.text\(0, 0, 'PLACE'/.test(inputController), 'no visible PLACE label');
assert(!/make\('SAVE'\)/.test(inputController), 'no visible SAVE label');
assert(!/make\('LOAD'\)/.test(inputController), 'no visible LOAD label');

// ---- Internal identifiers preserved (behaviour unchanged) ----
assert(/consumeSavePressed/.test(inputController), 'internal save handler name preserved');
assert(/consumeAttackPressed/.test(inputController), 'internal attack handler name preserved');
assert(/this\.pending\.use/.test(inputController), 'internal use flag preserved');
assert(/savePointers = \{ save: null, load: null \}/.test(inputController), 'internal pointer map keys preserved');

// ---- CraftingUI localised, ingredients show display names (no raw item IDs) ----
assert(/add\.text\(0, 0, 'КРАФТ'/.test(craftingUI), 'CRAFT toggle is КРАФТ');
assert(/'Крафт'/.test(craftingUI), 'crafting panel title is Крафт');
assert(/'Создать'/.test(craftingUI), 'craft action button is Создать');
assert(/ItemCatalog\[ingredient\.itemType\]\.displayName/.test(craftingUI), 'ingredients use catalog display names');
assert(!/\$\{ingredient\.itemType\} ×/.test(craftingUI), 'no raw ingredient item id shown');
assert(/onCraftKey/.test(craftingUI), 'internal craft handler name preserved');

// ---- Build-cost labels use display names (InputController) ----
assert(/ItemCatalog\[cost\.itemType\]\.displayName/.test(inputController), 'build cost uses catalog display names');
assert(!/\$\{cost\.itemType\} ×/.test(inputController), 'no raw build cost item id in label');

// ---- Player-facing GameScene messages use display names, not internal IDs ----
assert(/ItemCatalog\[drop\.itemType\]\.displayName/.test(gameScene), 'harvest drop message uses display name');
assert(/ItemCatalog\[refund\.itemType\]\.displayName/.test(gameScene), 'dismantle refund message uses display name');
assert(/ItemCatalog\[item\.itemType\]\.displayName/.test(gameScene), 'pickup message uses display name');
assert(!/showInteractionMessage\(`\$\{drop\.itemType\} ×/.test(gameScene), 'no raw drop item id message');
assert(!/Подобрано: \$\{item\.itemType\} ×/.test(gameScene), 'no raw pickup item id message');

// ---- Status HUD localised ----
assert(/Здоровье: \$\{roundedHealth\}\/100/.test(statusHUD), 'health label localised to Здоровье');
assert(/Голод: \$\{roundedHunger\}\/100/.test(statusHUD), 'hunger label is Голод');
assert(!/HP:/.test(statusHUD), 'no English HP label');

// ---- MenuScene visible strings are Russian ----
assert(/'ПРОДОЛЖИТЬ'/.test(menuScene), 'menu Continue is ПРОДОЛЖИТЬ');
assert(/'НОВАЯ ИГРА'/.test(menuScene), 'menu New Game is НОВАЯ ИГРА');
assert(/'СБРОСИТЬ СЛОТ'/.test(menuScene), 'menu Reset is СБРОСИТЬ СЛОТ');
assert(/'ПОДТВЕРДИТЬ'/.test(menuScene), 'modal Confirm is ПОДТВЕРДИТЬ');
assert(/'ОТМЕНА'/.test(menuScene), 'modal Cancel is ОТМЕНА');

// ---- Single-source display names are Russian (Cyrillic) in catalogs ----
const cyrillic = /[А-Яа-яЁё]/;
['WOOD', 'STONE', 'BERRIES', 'RAW_MEAT', 'STONE_AXE', 'BOW'].forEach((id) => {
  const match = new RegExp(`${id}: Object\\.freeze\\(\\{[\\s\\S]*?displayName: '([^']+)'`).exec(itemCatalog);
  assert(match && cyrillic.test(match[1]), `ItemCatalog ${id} has Russian display name`);
});
assert(/displayName: 'Лук'/.test(recipeCatalog), 'RecipeCatalog BOW display name is Russian');
assert(/displayName: 'Сундук'/.test(buildCatalog), 'BuildCatalog CHEST display name is Russian');
assert(/displayName: 'Костёр'/.test(buildCatalog), 'BuildCatalog CAMPFIRE display name is Russian');

// ---- Internal IDs / save fields unchanged ----
assert(/id: 'WOOD'/.test(itemCatalog), 'internal WOOD id preserved');
assert(/id: 'STONE_AXE'/.test(recipeCatalog), 'internal STONE_AXE recipe id preserved');
assert(/id: 'CHEST'/.test(buildCatalog), 'internal CHEST build id preserved');

console.log('test-russian-ui: ok');
