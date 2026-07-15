# Nazar Survival — Game Design

## Project

- Repository: gamefromnazar
- Base project: gamefrompchelka
- Base version: base-game-v1
- Project type: expanded survival version
- Current stage: chunked world stage 1

## Core concept

Расширенная версия исходной survival-игры.

Игрок исследует увеличенный мир, собирает ресурсы, создаёт предметы, строит объекты, сражается с противниками и взаимодействует с новыми персонажами.

Точная история, главная цель и состав персонажей будут определены отдельно.

## Systems inherited from base

- main menu;
- two save slots;
- local save/load;
- inventory and hotbar;
- crafting;
- building;
- chest storage;
- combat;
- enemies;
- projectiles;
- health and hunger;
- day/night;
- mobile controls;
- campfire;
- food and healing;
- resource harvesting.

## Planned expansion

- increase the world map;
- add new map zones;
- add friendly and hostile characters;
- add character interaction;
- add dialogue or simple tasks;
- add new resources;
- add new recipes;
- add new buildings;
- add new enemies;
- expand loot;
- improve world navigation;
- preserve desktop and mobile support.

## Map direction

The current fixed map remains the technical starting point.

The future map will be larger than the base 48 × 36 tile map.

The exact dimensions must be approved before implementation.

Do not change the map during project identity setup.

## Character direction

Future characters may include:

- friendly NPCs;
- traders;
- task givers;
- neutral inhabitants;
- stronger enemies;
- unique named characters.

The exact list and behaviour must be approved before implementation.

## Technical constraints

- Phaser 3.90.0;
- JavaScript;
- Arcade Physics;
- internal resolution 960 × 540;
- current tile size 32 px;
- desktop and mobile browsers;
- no new dependencies without approval;
- preserve the current save architecture unless a separate migration stage is approved.

## Current status

Chunked world Stage 1 is in progress.

Identity isolation is complete. Map streaming uses chunks while FixedMapData remains the fallback. Characters and full persistence are not part of this stage.

## Chunked World — Stage 1

- chunk size: 16 × 16 tiles (512 × 512 px);
- active radius: 1;
- simultaneously loaded: up to 3 × 3 chunks;
- generation is deterministic by world seed;
- each chunk has walkable grass plus trees and stones;
- start chunk `(0, 0)` keeps a free 7 × 7 spawn zone;
- save stores `worldSeed` and player world position;
- harvested chunk changes are not persisted yet (resources may respawn after unload);
- building is temporarily disabled in chunked mode;
- procedural enemies are not spawned in chunked mode;
- FixedMapData fallback remains available via `USE_CHUNKED_WORLD = false`;
- next stage candidates: chunk mutation persistence, enemies, buildings/chests, ground-loot ownership.
