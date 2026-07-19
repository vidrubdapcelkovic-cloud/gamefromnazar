// Localization guard: every player-visible UI string must be Russian and come
// from a single source, while internal identifiers (handlers, pending flags,
// enum keys, item/recipe/build IDs, input actions, save fields, storage key)
// stay unchanged. Repeated chrome strings live in src/data/UiText.js; item /
// building / recipe names live once in their catalogs and are read by the UI.
// This is a source-level test because the scenes need a live Phaser runtime.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const UiText = require('../src/data/UiText.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const cyrillic = /[А-Яа-яЁё]/;

const inputController = read('src/controllers/InputController.js');
const craftingUI = read('src/ui/CraftingUI.js');
const inventoryUI = read('src/ui/InventoryUI.js');
const chestUI = read('src/ui/ChestUI.js');
const statusHUD = read('src/ui/StatusHUD.js');
const menuScene = read('src/MenuScene.js');
const gameScene = read('src/GameScene.js');
const itemCatalog = read('src/data/ItemCatalog.js');
const recipeCatalog = read('src/data/RecipeCatalog.js');
const buildCatalog = read('src/data/BuildCatalog.js');

// ---- Single source: UiText holds Russian display strings ----
const requiredButtons = {
  use: 'ВЗЯТЬ', attack: 'АТАКА', save: 'СОХР.', load: 'ЗАГР.',
  menu: 'МЕНЮ', build: 'СТРОИТЬ', place: 'ПОСТАВИТЬ', craft: 'КРАФТ'
};
Object.entries(requiredButtons).forEach(([key, value]) => {
  assert(UiText.buttons[key] === value, `UiText.buttons.${key} === ${value}`);
});
assert(UiText.buttons.interactKey === 'E', 'interact key label stays E');
assert(UiText.hud.health === 'Здоровье' && UiText.hud.hunger === 'Голод', 'HUD labels Russian');
['crafting', 'inventory', 'chest', 'chestStorage'].forEach((key) => {
  assert(cyrillic.test(UiText.panels[key]), `UiText.panels.${key} is Russian`);
});
['close', 'cancel', 'confirm', 'saveAndExit'].forEach((key) => {
  assert(cyrillic.test(UiText.actions[key]), `UiText.actions.${key} is Russian`);
});
['continueGame', 'newGame', 'resetSlot'].forEach((key) => {
  assert(cyrillic.test(UiText.menu[key]), `UiText.menu.${key} is Russian`);
});
// UiText is immutable.
assert(Object.isFrozen(UiText) && Object.isFrozen(UiText.buttons), 'UiText is frozen');

// ---- Visible buttons read from UiText (single source), not inline English ----
assert(/UiText\.buttons\.use/.test(inputController), 'USE button uses UiText');
assert(/UiText\.buttons\.attack/.test(inputController), 'ATTACK button uses UiText');
assert(/make\(UiText\.buttons\.save\)/.test(inputController), 'SAVE button uses UiText');
assert(/make\(UiText\.buttons\.load\)/.test(inputController), 'LOAD button uses UiText');
assert(/UiText\.buttons\.menu/.test(inputController), 'MENU button uses UiText');
assert(/UiText\.buttons\.build/.test(inputController), 'BUILD button uses UiText');
assert(/UiText\.buttons\.place/.test(inputController), 'PLACE button uses UiText');
assert(/UiText\.buttons\.craft\b/.test(craftingUI), 'CRAFT toggle uses UiText');
assert(/UiText\.panels\.crafting/.test(craftingUI), 'crafting title uses UiText');
assert(/UiText\.buttons\.craftConfirm/.test(craftingUI), 'craft action button uses UiText');

// No visible English action labels remain anywhere in production UI text.
const uiFiles = { inputController, craftingUI, menuScene };
Object.entries(uiFiles).forEach(([name, source]) => {
  ["'USE'", "'ATTACK'", "'SAVE'", "'LOAD'", "'CRAFT'", "'BUILD'", "'PLACE'", "'MENU'"]
    .forEach((literal) => {
      const visible = new RegExp(`add\\.text\\([^\\n]*${literal}`).test(source)
        || new RegExp(`make\\(${literal}\\)`).test(source);
      assert(!visible, `no visible English label ${literal} in ${name}`);
    });
});

// ---- Panels / HUD read from UiText ----
assert(/UiText\.panels\.inventory/.test(inventoryUI), 'inventory title uses UiText');
assert(/UiText\.panels\.chest\b/.test(chestUI), 'chest title uses UiText');
assert(/UiText\.panels\.chestStorage/.test(chestUI), 'chest storage label uses UiText');
assert(/UiText\.actions\.close/.test(chestUI), 'chest close uses UiText');
assert(/UiText\.hud\.health/.test(statusHUD) && /UiText\.hud\.hunger/.test(statusHUD), 'HUD uses UiText');
assert(!/HP:/.test(statusHUD), 'no English HP label');

// ---- Menu primary actions read from UiText (no English menu actions) ----
assert(/UiText\.menu\.continueGame/.test(menuScene), 'menu Continue uses UiText');
assert(/UiText\.menu\.newGame/.test(menuScene), 'menu New Game uses UiText');
assert(/UiText\.menu\.resetSlot/.test(menuScene), 'menu Reset uses UiText');
assert(/UiText\.actions\.confirm/.test(menuScene), 'menu Confirm uses UiText');
assert(/UiText\.actions\.cancel/.test(menuScene), 'menu Cancel uses UiText');
['Continue', 'New Game', 'Main Menu', 'Load Game', 'Settings'].forEach((label) => {
  assert(!new RegExp(`'${label}'`).test(menuScene), `no English menu action "${label}"`);
});

// ---- Item / building / recipe names: single source is the catalogs ----
['WOOD', 'STONE', 'BERRIES', 'RAW_MEAT', 'STONE_AXE', 'STONE_PICKAXE', 'STONE_SWORD', 'BOW']
  .forEach((id) => {
    const match = new RegExp(`${id}: Object\\.freeze\\(\\{[\\s\\S]*?displayName: '([^']+)'`).exec(itemCatalog);
    assert(match && cyrillic.test(match[1]), `ItemCatalog ${id} has Russian display name`);
  });
assert(/displayName: 'Лук'/.test(recipeCatalog), 'RecipeCatalog BOW name Russian');
['WOOD_WALL', 'CAMPFIRE', 'CHEST'].forEach((id) => {
  const match = new RegExp(`${id}: Object\\.freeze\\(\\{[\\s\\S]*?displayName: '([^']+)'`).exec(buildCatalog);
  assert(match && cyrillic.test(match[1]), `BuildCatalog ${id} has Russian display name`);
});

// ---- Inventory/hotbar/crafting/building show catalog display names, not IDs ----
assert(/ItemCatalog\[contents\.itemType\]/.test(inventoryUI), 'inventory reads item from catalog');
assert(/ItemCatalog\[ingredient\.itemType\]\.displayName/.test(craftingUI), 'crafting ingredients use display names');
assert(!/\$\{ingredient\.itemType\} ×/.test(craftingUI), 'no raw ingredient id shown');
assert(/ItemCatalog\[cost\.itemType\]\.displayName/.test(inputController), 'build cost uses display names');
assert(!/\$\{cost\.itemType\} ×/.test(inputController), 'no raw build cost id shown');
assert(/ItemCatalog\[drop\.itemType\]\.displayName/.test(gameScene), 'harvest message uses display name');
assert(/ItemCatalog\[refund\.itemType\]\.displayName/.test(gameScene), 'refund message uses display name');
assert(/ItemCatalog\[item\.itemType\]\.displayName/.test(gameScene), 'pickup message uses display name');

// ---- Internal identifiers / handlers / save fields unchanged ----
assert(/consumeSavePressed/.test(inputController), 'internal save handler preserved');
assert(/consumeAttackPressed/.test(inputController), 'internal attack handler preserved');
assert(/this\.pending\.use/.test(inputController), 'internal use flag preserved');
assert(/onCraftKey/.test(craftingUI), 'internal craft handler preserved');
assert(/toggleBuildMode/.test(gameScene), 'internal build toggle preserved');
assert(/id: 'WOOD'/.test(itemCatalog), 'internal WOOD id preserved');
assert(/id: 'STONE_AXE'/.test(recipeCatalog), 'internal STONE_AXE recipe id preserved');
assert(/id: 'CHEST'/.test(buildCatalog), 'internal CHEST build id preserved');

// ---- Removed overlays must not return ----
assert(!/inventoryHudText/.test(gameScene), 'top resource HUD not reintroduced');
assert(!/chunkDebug/i.test(gameScene), 'debug overlay not reintroduced');

console.log('test-russian-ui: ok');
