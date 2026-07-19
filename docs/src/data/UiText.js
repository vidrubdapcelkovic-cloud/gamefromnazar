// Single source for player-visible UI strings (display-only Russian text).
//
// Internal identifiers stay unchanged: item/resource keys, recipe/build IDs,
// input actions, texture keys, enum values, save fields and the storage key all
// keep their original English names. Only the rendered labels below are Russian.
//
// Item / building / recipe names are NOT duplicated here: their single source is
// the catalogs (ItemCatalog / RecipeCatalog / BuildCatalog `displayName`), read
// directly by the UI so there is exactly one place to translate each name.
const UiText = Object.freeze({
  buttons: Object.freeze({
    interactKey: 'E',
    use: 'ВЗЯТЬ',
    attack: 'АТАКА',
    save: 'СОХР.',
    load: 'ЗАГР.',
    menu: 'МЕНЮ',
    build: 'СТРОИТЬ',
    place: 'ПОСТАВИТЬ',
    craft: 'КРАФТ',
    craftConfirm: 'Создать'
  }),
  hud: Object.freeze({
    health: 'Здоровье',
    hunger: 'Голод'
  }),
  panels: Object.freeze({
    crafting: 'Крафт',
    inventory: 'Инвентарь',
    chest: 'Сундук',
    chestStorage: 'Хранилище'
  }),
  actions: Object.freeze({
    close: 'Закрыть',
    cancel: 'ОТМЕНА',
    confirm: 'ПОДТВЕРДИТЬ',
    saveAndExit: 'СОХРАНИТЬ'
  }),
  menu: Object.freeze({
    continueGame: 'ПРОДОЛЖИТЬ',
    newGame: 'НОВАЯ ИГРА',
    resetSlot: 'СБРОСИТЬ СЛОТ'
  })
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UiText;
}
