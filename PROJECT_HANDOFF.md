# Передача проекта gamefrompchelka

## Актуальный статус: Nazar Survival

- Project: Nazar Survival
- Repository: gamefromnazar
- Local path: `C:\Users\PC\Documents\GitHub\gamefromnazar`
- Base project: gamefrompchelka
- Base tag: base-game-v1
- Repository status: independent
- Project type: expanded survival version
- Current stage: chunked world stage 1
- Planned expansion:
  - larger map;
  - new characters;
  - additional world content.

Исходная игра `gamefrompchelka` (тег `base-game-v1`) служит стабильной базой. Изменения в `gamefromnazar` не должны затрагивать `gamefrompchelka`. Увеличение карты и добавление персонажей будут отдельными этапами. Изменение SaveState потребует отдельного решения о версии и миграции.

## Chunked World Stage 1

- New modules: src/world/ChunkMath.js, SeededRandom.js, ChunkGenerator.js, ChunkInstance.js, ChunkManager.js.
- Owner: GameScene creates and destroys ChunkManager; ChunkManager owns active ChunkInstance map.
- Lifecycle: sync 3×3 around player on chunk change; idempotent ChunkManager.destroy() / ChunkInstance.destroy() on scene shutdown.
- Seed: created on new game (Date.now()), stored as optional SaveState worldSeed, restored on continue/load; SAVE does not regenerate it.
- SaveState decision: VERSION remains 1; worldSeed is optional so old saves stay valid and receive a seed once on load.
- Fallback: USE_CHUNKED_WORLD in GameScene.js; false keeps FixedMapData path.
- Stage 1 limits: no chunk mutation persistence; no procedural enemies; harvested resources may respawn after unload.
- Building in chunked mode: previously blocked by `GameScene.canBuild()` (`if (this.useChunkedWorld) return false`). That gate is removed. Reused unchanged: BuildCatalog, InputController BUILD UI, BuildingSystem preview/place/cost flow, `blockingWorldObjects` StaticGroup, facing-cell placement.
- Building coordinates: `ChunkWorldGrid.worldToCell` / `cellToWorldCenter` use `Math.floor(world / tileSize)` and work for negative world positions; no FixedMapData bounds.
- Building ownership: placements belong to `GameScene` / `BuildingSystem` (ids `building-N`), not to `ChunkInstance`. Chunk unload does not destroy player-built objects.
- Building persistence: still not restored in chunked mode (`restoreState([])` on load). Save may still export walls via existing SaveState fields, but Continue clears them until a later persistence stage.
- Visual fix: player/objects used `bottom * 0.1` depth; at negative world Y this fell below terrain Graphics (`-12`), so the player appeared missing. Terrain now uses `ChunkMath.CHUNK_TERRAIN_DEPTH = -1000000`. Entity depth still uses the existing Y-sort formula and stays under UI (`INTERFACE_DEPTH`).
- Ownership (chunks): `ChunkInstance.destroy()` only removes ids prefixed with `chunk_` that it created; player is guarded in unregister.
- Sync order: load missing 3×3 chunks, then unload outsiders; camera follow is not restarted; collideWorldBounds stays off in chunked mode.
- Save-and-exit: `unregisterChunkWorldObject` guards destroyed StaticGroup (`group.children`) before `contains`/`remove`.

Ниже сохранена техническая история и описание базового проекта; при расхождении приоритет у актуального статуса и фактического кода `gamefromnazar`.

## Назначение документа

Этот файл предназначен для передачи проекта новому чату ChatGPT/Codex или другому разработчику. Он фиксирует технический контекст и состояние проекта на момент создания документа — 14 июля 2026 года.

Перед любыми изменениями необходимо изучить фактический код, выполнить проверку Git и проверить последние коммиты. Этот документ помогает восстановить контекст, но не заменяет анализ исходников. При любом расхождении окончательным источником истины являются Git и файлы проекта.

Документ не содержит токенов, паролей, содержимого пользовательских сохранений и других секретов.

## Краткая карточка проекта

- Путь: `C:\Users\PC\Documents\GitHub\gamefrompchelka`.
- Жанр: мобильная и настольная 2D-выживалка с видом сверху.
- Движок: Phaser 3.90.0, локальный `lib/phaser.min.js`.
- Язык: обычный JavaScript без TypeScript.
- Страница: HTML/CSS без React, Vue и других фреймворков.
- Физика: Phaser Arcade Physics без гравитации.
- Модули: обычные `<script>`, ES-модули не используются.
- Bundler и npm-зависимости отсутствуют.
- Внутреннее разрешение: 960 × 540.
- Масштабирование: `Phaser.Scale.FIT` и `Phaser.Scale.CENTER_BOTH`.
- Пиксельный режим: `pixelArt: true`, `antialias: false`, `roundPixels: true`.
- Карта: 48 × 36 клеток.
- Размер клетки: 32 px.
- Размер мира: 1536 × 1152 px.
- Целевые платформы: desktop, Android Chrome, iPhone Safari.
- Сборка: `node build.js`.
- GitHub Pages: многофайловая версия в `docs`.
- Автономная версия: `dist/gamefromnazar-offline.html`.
- Папку `docs` нельзя редактировать вручную: она обновляется через `node build.js`.

## Текущая архитектура запуска

`index.html` загружает локальный Phaser и исходники обычными `<script>` в определённом порядке. `src/main.js` создаёт один `Phaser.Game` с двумя зарегистрированными сценами:

```text
MenuScene → GameScene → MenuScene
```

Конфигурация сцен имеет вид:

```javascript
scene: [MenuScene, GameScene]
```

Поэтому первой автоматически запускается `MenuScene`. `GameScene` запускается только после явного выбора слота и получает данные `{ slotId, mode }` через стандартный переход Phaser.

Главная игровая сцена пока крупная и координирует создание мира, игрока, объектов, интерфейсов, боя, строительства, существ, сохранений и lifecycle. Это основная причина планируемого отдельного архитектурного этапа.

## Основные файлы и ответственность

### Точка входа и сцены

- `index.html` — исходная HTML-страница, CSS, порядок обычных `<script>`.
- `src/main.js` — конфигурация Phaser, Arcade Physics, масштабирование и регистрация сцен.
- `src/MenuScene.js` — главное меню, две карточки сохранений и одно переиспользуемое модальное окно.
- `src/GameScene.js` — координация игрового мира, UI, управления, механик, SAVE/LOAD и lifecycle.
- `src/VirtualJoystick.js` — виртуальный джойстик и lifecycle мобильного pointer.

### Данные

- `src/data/FixedMapData.js` — фиксированная карта, размеры и старт `{ col: 24, row: 18 }`.
- `src/data/FixedWorldObjects.js` — 14 деревьев, 10 камней и 8 ягодных кустов с фиксированными ID и клетками.
- `src/data/ItemCatalog.js` — предметы, размеры стаков, еда, инструменты и оружие.
- `src/data/RecipeCatalog.js` — рецепты крафта и рецепт костра.
- `src/data/BuildCatalog.js` — стена, костёр и сундук.
- `src/data/CreatureCatalog.js` — параметры слизня и его лут.
- `src/data/CombatConfig.js` — длительности неуязвимости и визуальных вспышек.

### Мир и системы

- `src/world/WorldGrid.js` — независимые от Phaser координаты сетки.
- `src/systems/InteractionSystem.js` — выбор ближайшей доступной цели.
- `src/systems/HoldActionSystem.js` — запуск, прогресс, отмена и завершение удерживаемого действия.
- `src/systems/InventoryModel.js` — модель инвентаря на 25 слотов.
- `src/systems/ChestStorageModel.js` — модель хранилища сундука и атомарный перенос между контейнерами.
- `src/systems/CraftingModel.js` — проверка и выполнение рецептов.
- `src/systems/PlayerStatsModel.js` — здоровье, голод и смерть.
- `src/systems/GroundItemSystem.js` — стаки предметов на земле.
- `src/systems/BuildingSystem.js` — превью, размещение, стабильные ID, восстановление построек и сундуков.
- `src/systems/CreatureSystem.js` — создание, AI, контактный урон, получение урона, смерть и восстановление слизней.
- `src/systems/ProjectileSystem.js` — создание, движение, дальность и удаление стрел.
- `src/systems/DayNightSystem.js` — время, фаза, визуальная alpha и сериализация цикла.
- `src/systems/SaveSlotManager.js` — ключи localStorage, состояния двух слотов и миграция старого сохранения.
- `src/systems/SaveSystem.js` — валидация SaveState и SAVE/LOAD активного слота.

### Интерфейс

- `src/ui/StatusHUD.js` — здоровье и голод.
- `src/ui/InventoryUI.js` — хотбар, основная панель и перенос предметов последовательными нажатиями.
- `src/ui/CraftingUI.js` — выбор рецепта и создание предмета.
- `src/ui/ChestUI.js` — 15 слотов сундука и перенос между сундуком и инвентарём.

### Сборка

- `build.js` — проверяет обязательные файлы, обновляет `docs` и создаёт автономный HTML.
- `docs/index.html` — точка входа GitHub Pages.
- `docs/src` — сгенерированная копия исходников.
- `docs/lib/phaser.min.js` — локальный Phaser для GitHub Pages.
- `dist/gamefromnazar-offline.html` — Phaser, CSS и весь игровой JavaScript в одном файле.

## Фактические API, которые нужно сохранять

Новый разработчик обязан повторно прочитать реализации перед изменениями. На момент handoff используются следующие реальные сигнатуры.

### WorldGrid

```text
constructor(mapData = FixedMapData)
isInside(col, row)
getTileType(col, row)
isWalkable(col, row)
worldToCell(x, y)
cellToWorldCenter(col, row)
```

### InventoryModel

```text
addItem(itemType, quantity)
getSlots()
getSlot(index)
removeFromSlot(index, quantity)
consumeItem(itemType, quantity)
moveOrMerge(fromIndex, toIndex)
canCraftExchange(ingredients, result)
craftExchange(ingredients, result)
getTotal(itemType)
exportState()
importState(slots)
```

### ChestStorageModel

```text
getSlot(index)
getSlots()
addItem(itemType, quantity)
removeFromSlot(index, quantity)
moveOrMerge(fromIndex, toIndex)
exportState()
importState(state)
static normalizeSlots(value)
static transferBetweenContainers(source, sourceIndex, target, targetIndex)
```

### BuildingSystem

```text
constructor(scene, worldGrid, blockingWorldObjects, textureKeys)
enterMode(buildType)
exitMode()
place(col, row, restoredId, storageState)
getPlacements()
getPlacement(id)
getChestStorage(id)
remove(id)
exportState()
restoreState(walls)
clear()
```

### SaveSlotManager и SaveSystem

```text
SaveSlotManager.isValidSlotId(slotId)
SaveSlotManager.getSlotKey(slotId)
SaveSlotManager.read(slotId)
SaveSlotManager.write(slotId, value)
SaveSlotManager.delete(slotId)
SaveSlotManager.inspectSlot(slotId)
SaveSlotManager.migrateLegacySave()

new SaveSystem(slotManager, slotId)
SaveSystem.normalizeState(state)
save(state)
load()
deleteSave()
```

### Интерфейсы

```text
InventoryUI.openPanel() / closePanel() / updateFromModel() / destroy()
CraftingUI.openPanel() / closePanel() / selectRecipe(recipeId) / destroy()
ChestUI.openPanel() / closePanel() / updateFromModels() / destroy()
```

## Обязательный процесс работы

1. Выполнить `git status --short`.
2. Если найдены неожиданные незакоммиченные изменения — перечислить их и остановиться.
3. Если дерево чистое — сохранить текущий HEAD как точку возврата. Не создавать пустой commit.
4. Прочитать последние коммиты, реальные исходники и публичные API.
5. Не придумывать сигнатуры методов по этому документу.
6. Изменять исходники в `src`, `index.html` и другие исходные файлы, но не сгенерированные файлы внутри `docs`.
7. Проверить синтаксис изменённых JavaScript-файлов.
8. Выполнить `node build.js` и сверить `src` с `docs/src`.
9. Проверить HTTP-файлы и провести реальную Canvas-регрессию в доступном браузере.
10. Перед commit пользователь вручную проверяет результат на компьютере и, для мобильных изменений, на телефоне.
11. Commit и push выполнять только после явного подтверждения пользователя.

Для обычной работы владелец проекта использует GitHub Desktop для commit и push. Не изменять глобальные настройки Git.

## Реализованные этапы

- Базовая Phaser 3-сцена, Arcade Physics и камера.
- Мобильное масштабирование, safe-area, поворот экрана и сброс управления.
- FixedMapData и независимый WorldGrid.
- Tilemap с травой, песком, водой и каменной землёй.
- Коллизия воды, границы физического мира и камеры.
- Старт игрока из фиксированной клетки карты.
- Фиксированные деревья, камни и ягодные кусты.
- Коллизия нижней части стволов и камней, проходимые кусты.
- Y-сортировка игрока и объектов.
- InteractionSystem и маркер ближайшей цели.
- HoldActionSystem и удерживаемое взаимодействие.
- Добыча ресурсов, фиксированные drops и автоподбор.
- ItemCatalog и ограничения размеров стаков.
- Инвентарь: 5 слотов хотбара и 20 основных слотов.
- InventoryUI, move, merge, partial merge и swap.
- Здоровье, голод, еда и состояние смерти.
- Крафт и CraftingUI.
- Каменный топор и каменная кирка, ускоряющие подходящую добычу.
- Деревянная стена, строительство и демонтаж.
- Слизни, простое преследование, контактный урон и лут.
- Базовый ближний бой рукой.
- Каменный меч.
- Лук и ProjectileSystem без расходуемых стрел.
- Костёр, лечение, cooldown, готовка и мясная похлёбка.
- Сундук, 15 слотов, независимые хранилища и стабильные ID построек.
- Сохранение и восстановление содержимого сундуков.
- Визуальный цикл дня и ночи и HUD времени.
- Ручной локальный SAVE/LOAD.
- Главное меню и две независимые ячейки сохранения.
- Новая игра, продолжение, сброс и подтверждение перезаписи.
- Сохранение и возврат из GameScene в MenuScene.
- Одноразовая миграция старого сохранения.
- Сборка GitHub Pages и автономного HTML.

## Текущие игровые правила

### Управление

- Клавиатура: WASD или стрелки для движения.
- Мобильное движение: виртуальный джойстик.
- Скорость игрока: 260.
- `E` или мобильная кнопка действия — взаимодействие; добыча и часть действий требуют удержания.
- `F` или `USE` — применить еду из активного слота.
- `I` или кнопка рюкзака — инвентарь.
- `C` или `CRAFT` — крафт.
- `B` или `BUILD` — режим строительства.
- `Enter` или `PLACE` — разместить постройку в ближайшей клетке перед игроком.
- `Space` или `ATTACK` — атака.
- `1`–`5` или нажатие — выбор активного слота хотбара.
- `K`/`SAVE` и `L`/`LOAD` работают только с активным слотом сохранения.
- Панели, смерть, загрузка и подтверждение выхода блокируют несовместимые действия.

### Карта и объекты

- Символы поверхности: `G`, `S`, `W`, `R`.
- Индексы тайлов: `G → 0`, `S → 1`, `W → 2`, `R → 3`.
- Вода блокирует игрока; другие поверхности проходимы.
- Tilemap, физический мир и камера имеют размер 1536 × 1152.
- Деревья и камни блокируют движение; кусты проходимы.
- Точка взаимодействия дерева находится у блокировщика ствола, а не у кроны.
- Фиксированные объекты: 14 деревьев, 10 камней, 8 ягодных кустов.

### Инвентарь и предметы

- Всего 25 слотов: 5 быстрых и 20 основных.
- Drag-and-drop отсутствует.
- Перенос выполняется выбором источника и назначения.
- Поддерживаются move, merge, partial merge и swap.
- Большинство ресурсов имеют `maxStack: 99`.
- `RAW_MEAT`: максимум 20; `MEAT_STEW`: максимум 10.
- Инструменты и оружие имеют максимум 1 и пока не обладают прочностью.

### Добыча и лут

- Дерево оставляет `WOOD ×3`.
- Камень оставляет `STONE ×2`.
- Ягодный куст оставляет `BERRIES ×2`.
- Автоподбор работает в радиусе 28 px при наличии места.
- Каменный топор сокращает добычу дерева до 750 мс.
- Каменная кирка сокращает добычу камня до 850 мс.
- Неподходящий инструмент бонуса не даёт.
- Слизень оставляет `SLIME_GEL ×1–2` и `RAW_MEAT ×1`.

### Здоровье, голод и еда

- Максимум здоровья и голода: 100.
- Голод уменьшается на 0,1 в секунду.
- При нулевом голоде здоровье уменьшается на 1 в секунду.
- Ягоды восстанавливают 20 голода.
- Сырое мясо не употребляется.
- Рецепт костра: `BERRIES ×2 + RAW_MEAT ×1 → MEAT_STEW ×1`.
- Похлёбка восстанавливает до 45 голода и до 10 здоровья.
- При смерти управление блокируется; возрождения нет.

### Бой

- HP слизня: 30.
- Скорость слизня: 70; радиусы обнаружения/потери: 160/220.
- Контактный урон: 5 с cooldown 1000 мс.
- Неуязвимость игрока после попадания: 650 мс.
- Удар рукой: 10 урона, радиус 52, cooldown 450 мс.
- Каменный меч: 15 урона.
- Лук: 10 урона, cooldown 650 мс, скорость стрелы 320, дальность 220.
- Расходуемых стрел, knockback и полос здоровья врагов нет.
- Есть короткие красные вспышки при попадании.

### Постройки

- Формат runtime/save: `{ id, buildType, col, row, storage? }`.
- Стабильные ID имеют вид `building-N`.
- Деревянная стена: `WOOD ×2`, занимает одну клетку и блокирует движение.
- Стена не имеет HP и стадий повреждения; демонтаж простой.
- Костёр: `WOOD ×2 + STONE ×4`, одна клетка, блокирует движение.
- Лечение у костра: 20 здоровья, cooldown 30 секунд.
- Готовка не изменяет cooldown лечения.
- Топлива и светового радиуса нет.
- Сундук: `WOOD ×6`, одна клетка, блокирует игрока, слизней и стрелы.
- Сундук имеет 15 слотов и собственный `ChestStorageModel`.
- Хранилище связано со стабильным ID и сохраняется.
- Демонтаж сундука пока запрещён.

### День и ночь

- Полный цикл: 600000 мс, то есть 10 минут реального игрового времени.
- Старт: день 1, 08:00.
- День: 06:00–19:59; ночь: 20:00–05:59.
- В 00:00 увеличивается номер дня.
- Рассвет: 06:00–08:00; закат: 18:00–20:00.
- Максимальная ночная alpha: 0,45.
- Эффект только визуальный и не меняет характеристики существ или игрока.
- HUD: `День/Ночь N — HH:MM`.

### Звуки

Звуков и музыки нет. Они исключены из текущего плана и не должны добавляться без нового решения пользователя.

## Сохранения

### Ключи localStorage

В `gamefromnazar` используются отдельные ключи, чтобы не конфликтовать с базовой игрой:

```text
gamefromnazar-save-slot-1-v1
gamefromnazar-save-slot-2-v1
```

Legacy-ключ одноразовой миграции внутри этого проекта: `gamefromnazar-save-v1`. Сохранения `gamefrompchelka` автоматически не импортируются. Маркер попытки миграции:

```text
gamefromnazar-save-migration-slots-v1
```

### Правила слотов

- Допустимы только `slotId` 1 и 2.
- Иные значения возвращают `invalidSlot`.
- `MenuScene` передаёт `{ slotId, mode }`; глобальный active slot отсутствует.
- `SaveSystem` получает `SaveSlotManager` и фиксированный `slotId` на весь запуск GameScene.
- SAVE и LOAD используют только активный слот; fallback на другой слот отсутствует.
- `slotId` не записывается внутрь SaveState.
- Данные двух слотов не смешиваются.
- Валидное старое сохранение копируется без изменения в пустой слот 1 только один раз.
- Слот 2 миграцией не изменяется.
- Старый ключ не удаляется.
- Маркер предотвращает повторный импорт после сброса слота 1.

### SaveState

Версия формата остаётся `VERSION = 1`. Сохраняются:

- `savedAt`;
- позиция, здоровье и голод игрока;
- активный слот хотбара и все 25 слотов инвентаря;
- удалённые фиксированные объекты;
- наземные предметы;
- постройки, их стабильные ID и storage сундуков;
- погибшие существа;
- день и время.

Схема верхнего уровня:

```javascript
{
  version: 1,
  savedAt,
  player: { x, y, health, hunger },
  dayNight: { dayNumber, timeOfDayMs },
  inventory: { activeHotbarIndex, slots },
  world: { removedObjectIds, groundItems, walls, deadCreatureIds }
}
```

## Главное меню

- `MenuScene` запускается первой.
- Отображаются ровно две карточки.
- Состояния: `EMPTY`, `VALID`, `CORRUPT`; ошибка localStorage отображается отдельно.
- Валидная карточка показывает фазу, день и время через `DayNightSystem`.
- Старое валидное сохранение без `dayNight` нормализуется к дню 1, 08:00.
- Пустой слот предлагает «Новая игра».
- Валидный слот предлагает «Продолжить», «Новая игра» и «Сбросить слот».
- Повреждённый слот нельзя продолжить; доступен подтверждённый сброс.
- Перезапись занятого слота требует подтверждения.
- Используется одно переиспользуемое Phaser-модальное окно; `window.confirm()` отсутствует.
- Повторное быстрое нажатие защищено `transitionLocked`.
- Первое сохранение новой игры выполняется после полной инициализации GameScene.
- В GameScene есть кнопка «МЕНЮ» и модальное подтверждение «Сохранить игру и выйти в меню?».
- Возврат в меню выполняется только после успешной записи активного слота.

Созданные для этого этапа исходники:

- `src/MenuScene.js`;
- `src/systems/SaveSlotManager.js`.

## Последний завершённый этап: меню и два слота

- Предыдущая точка возврата перед этапом: `f4cdddeed2b009f55c468d38d2de86b05eace5bb`.
- Этап завершён, вручную и автоматически проверен.
- Этап уже находится в commit `cd526509a027209f21f577a944ae14ea185b2e40` с сообщением `меню safe load`.
- Текущий HEAD совпадает с этим commit.
- `MenuScene` запускается первой; `SaveSlotManager` подключён до `SaveSystem`.
- Новая игра сохраняет начальное состояние после полной инициализации.
- Продолжение повторно проверяет валидность выбранного слота.
- Перезапись и сброс требуют подтверждения; отмена не изменяет слот.
- `CORRUPT` не запускает GameScene.
- Миграция старого валидного JSON выполняется один раз.
- Проверены три полных цикла `MenuScene → GameScene → MenuScene`.
- Найденная при Canvas-проверке lifecycle-ошибка очистки input исправлена до commit.
- Проверены два последовательных LOAD.
- SaveState и `VERSION = 1` не изменены.
- Число регистраций постоянных collider осталось 4.
- Последняя зафиксированная успешная сборка базового проекта создавала `dist/survival-offline.html`; в `gamefromnazar` автономный файл называется `dist/gamefromnazar-offline.html`.
- `src` и `docs/src` совпали по хешам, проверенные HTTP-файлы вернули 200.

## Подтверждённые Canvas-проверки последнего этапа

- Старт приложения с MenuScene.
- Продолжение слота 1.
- Новая игра в слоте 2.
- Начальное время дня 1 около 08:00.
- SAVE и LOAD активного слота.
- Два последовательных LOAD.
- Сохранение и выход в меню.
- Отмена перезаписи занятого слота.
- Отмена сброса.
- Подтверждение сброса только выбранного слота.
- Независимость двух слотов.
- InventoryUI после LOAD.
- CraftingUI после LOAD.
- Три полных перехода между сценами.
- Отсутствие новых ошибок после lifecycle-исправления.

## Что ещё проверить вручную

- Автономный `dist/gamefromnazar-offline.html` интерактивно через локальное открытие файла.
- Повреждённый слот непосредственно в реальном меню.
- ChestUI после повторного LOAD.
- Два сундука в одном сеансе и независимость их содержимого.
- Move, merge, partial merge и swap между инвентарём и сундуком.
- Коллизию игрока и слизня с сундуком.
- Исчезновение стрелы при попадании в сундук.
- Полный десятиминутный цикл дня и ночи.
- SAVE/LOAD ночью и восстановление ночной alpha.
- InventoryUI, CraftingUI и ChestUI ночью.
- Мультитач на физическом Android-устройстве.
- Safari на физическом iPhone.
- Доступность localStorage автономного файла в конкретном мобильном браузере.
- Настоящий `scene.restart()`; проверенные переходы использовали `scene.start()`.

## Оставшаяся работа

Новых игровых механик в текущем плане больше нет. Остаётся финальный технический этап, который необходимо разделить на два самостоятельных запроса.

### Этап A — архитектурный рефакторинг

- Выделить `InputController`.
- Выделить `CombatController`.
- Выделить `MapManager`.
- Не менять поведение игры и публичные контракты без необходимости.
- Сохранить совместимость SaveState и двух слотов.
- После каждого выделения проводить небольшую регрессию, а не один большой перенос.

### Этап B — release-аудит

- Проверить lifecycle обеих сцен и повторные переходы.
- Проверить два независимых слота, повторный LOAD и смерть → LOAD.
- Проверить мобильный pointer lifecycle и мультитач.
- Проверить постоянные collider и отсутствие новых объектов в `update()`.
- Проверить GitHub Pages и автономный HTML.
- Выполнить длительную Canvas-регрессию, включая полный цикл дня/ночи.
- Удалить временную диагностику, если она появится на этапе A.
- После ручного подтверждения пользователя выполнить финальный commit через GitHub Desktop.
- После публикации создать стабильный tag/release.

Этапы A и B не объединять в один большой запрос, особенно при ограниченном лимите контекста.

## Будущие отдельные игры

Будущие проекты предполагаются концептуально разными играми: с другими механиками, сеттингами, картами, предметами, UI и игровыми циклами.

Рекомендации:

- отдельный Git-репозиторий для каждой игры;
- не превращать этот проект в общую кодовую базу с большим количеством feature flags;
- копировать текущий проект только после стабильного release;
- при необходимости создать отдельный чистый Phaser-шаблон;
- использовать отдельные localStorage-ключи;
- не копировать незавершённое или непроверенное состояние.

## Инструкция новому чату

1. Сначала полностью прочитать `PROJECT_HANDOFF.md`.
2. Выполнить `git status --short`, `git rev-parse HEAD`, `git branch --show-current` и изучить последние коммиты.
3. Прочитать реальные исходники, относящиеся к задаче.
4. Не считать handoff заменой анализа кода.
5. Не изменять проект до проверки Git.
6. Не редактировать `docs` вручную.
7. Не выполнять commit и push до ручной проверки и явного разрешения пользователя.
8. Отвечать пользователю на русском языке.
9. Если пользователь просит подготовить следующий промпт, возвращать один цельный блок кода, удобный для копирования.

## Фактическое состояние Git на момент handoff

- Текущий HEAD: `cd526509a027209f21f577a944ae14ea185b2e40`.
- Текущая ветка: `main`.
- Последний commit: `cd52650 меню safe load`.
- Пять последних commit:

  ```text
  cd52650 меню safe load
  f4cddde Add visual day night cycle
  8254434 сундуки
  864934a Add campfire cooking and meat stew
  e2b29a5 создание костра
  ```

- Перед созданием этого файла `git status --short` был пуст: рабочее дерево было чистым.
- Этап меню и двух слотов уже находится в commit `cd52650`, а не только в рабочем дереве.
- После создания handoff ожидаемый единственный незакоммиченный файл: `?? PROJECT_HANDOFF.md`.
- Неожиданных незакоммиченных изменений до создания файла не обнаружено.
- Локальная tracking-ссылка показывает `main...origin/main`, а `git branch -vv` показывает `[origin/main]` на том же commit `cd52650`.
- Это позволяет утверждать только, что локальный HEAD совпадает с локально сохранённой ссылкой `origin/main`.
- Актуальность удалённого сервера не проверялась: `fetch`, `pull`, `push` и другие сетевые Git-операции намеренно не выполнялись.
- URL origin намеренно не включён в handoff, чтобы не переносить сведения об аккаунте.
- Commit, push, pull и fetch при создании этого документа не выполнялись.

## Контроль перед продолжением

Перед следующей задачей новый чат должен подтвердить:

- текущий HEAD и ветку;
- чистоту или ожидаемый состав рабочего дерева;
- наличие нужного commit на локальной ветке;
- фактические API затрагиваемых классов;
- границы задачи и список файлов, которые разрешено изменять;
- отдельный план проверки и ручной регрессии.
