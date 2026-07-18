const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

const bundle = [
  'src/data/HostileNpcConfig.js',
  'src/world/HostileNpcController.js'
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n;\n');

const context = { console, Math, Number, String, Array, Object, Set, Map, Error, exports: {} };
vm.createContext(context);
vm.runInContext(
  `${bundle}
;exports.HostileNpcConfig = HostileNpcConfig;
;exports.getHostileNpcConfig = getHostileNpcConfig;
;exports.isHostileNpcType = isHostileNpcType;
;exports.HOSTILE_NPC_STATE = HOSTILE_NPC_STATE;
;exports.HostileNpcController = HostileNpcController;`,
  context,
  { filename: 'hostile-npc-core-bundle.js' }
);

const {
  getHostileNpcConfig,
  isHostileNpcType,
  HOSTILE_NPC_STATE,
  HostileNpcController
} = context.exports;

function createHarness(overrides) {
  const state = {
    x: 0,
    y: 0,
    player: null,
    wanderStops: 0,
    wanderResumes: 0,
    damageCalls: [],
    config: getHostileNpcConfig('TALL_MONSTER')
  };
  Object.assign(state, overrides || {});

  const controller = new HostileNpcController({
    config: state.config,
    homeX: state.homeX != null ? state.homeX : 0,
    homeY: state.homeY != null ? state.homeY : 0,
    getPosition: () => ({ x: state.x, y: state.y }),
    setPosition: (x, y) => {
      state.x = x;
      state.y = y;
    },
    getPlayerPosition: () => state.player,
    stopWander: () => { state.wanderStops += 1; },
    resumeWander: () => { state.wanderResumes += 1; },
    damagePlayer: (amount) => {
      state.damageCalls.push(amount);
      return amount;
    },
    canOccupy: () => true
  });

  return { state, controller };
}

// Config API
{
  assert(typeof getHostileNpcConfig === 'function', 'getHostileNpcConfig exists');
  assert(typeof isHostileNpcType === 'function', 'isHostileNpcType exists');
  assertEqual(getHostileNpcConfig('UNKNOWN'), null, 'unknown type rejected');
  assertEqual(isHostileNpcType('UNKNOWN'), false, 'unknown type false');
  assertEqual(isHostileNpcType('TALL_MONSTER'), true, 'TALL_MONSTER known');

  const cfg = getHostileNpcConfig('TALL_MONSTER');
  assert(cfg, 'TALL_MONSTER config exists');
  [
    'textureKey', 'maxHp', 'renderWidth', 'renderHeight',
    'bodyWidth', 'bodyHeight', 'bodyOffsetX', 'bodyOffsetY',
    'lootType', 'lootQuantity', 'wanderTweenDuration', 'wanderPauseDuration',
    'detectionRadius', 'disengageRadius', 'attackRange', 'attackDamage',
    'attackCooldown', 'chaseSpeed', 'returnRadius'
  ].forEach((key) => {
    assert(Object.prototype.hasOwnProperty.call(cfg, key), `field ${key}`);
  });

  assert(cfg.attackRange > 0, 'attackRange > 0');
  assert(cfg.attackRange < cfg.detectionRadius, 'attackRange < detectionRadius');
  assert(cfg.detectionRadius < cfg.disengageRadius, 'detectionRadius < disengageRadius');
  assert(cfg.returnRadius > 0, 'returnRadius > 0');
  assert(cfg.attackDamage > 0, 'attackDamage > 0');
  assert(cfg.attackCooldown > 0, 'attackCooldown > 0');
  assert(cfg.chaseSpeed > 0, 'chaseSpeed > 0');
}

// State machine
{
  const { state, controller } = createHarness();
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'starts IDLE_WANDER');

  state.player = { x: 200, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'far player no chase');

  state.player = { x: 100, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'detection enters CHASE');
  assertEqual(state.wanderStops, 1, 'chase stops wander');

  // Move into attack range via chase steps
  state.x = 0;
  state.y = 0;
  state.player = { x: 20, y: 0 };
  controller.update(100, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.ATTACK, 'close range enters ATTACK');

  assertEqual(state.damageCalls.length, 1, 'first attack deals damage');
  assertEqual(state.damageCalls[0], 5, 'attackDamage is 5');

  controller.update(500, 16);
  assertEqual(state.damageCalls.length, 1, 'no damage before cooldown');

  controller.update(1100, 16);
  assertEqual(state.damageCalls.length, 2, 'damage after cooldown');

  state.player = { x: 50, y: 0 };
  controller.update(1200, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'leave attackRange -> CHASE');

  state.player = { x: 300, y: 0 };
  controller.update(1300, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.RETURN, 'leave disengage -> RETURN');

  state.x = 5;
  state.y = 0;
  state.player = null;
  controller.update(1400, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'home returnRadius -> IDLE');
  assertEqual(state.wanderResumes, 1, 'idle resumes wander');
}

// Independent cooldowns
{
  const a = createHarness({ x: 0, y: 0 });
  const b = createHarness({ x: 0, y: 0 });
  a.state.player = { x: 10, y: 0 };
  b.state.player = { x: 10, y: 0 };
  a.controller.update(0, 16);
  b.controller.update(0, 16);
  assertEqual(a.controller.getState(), HOSTILE_NPC_STATE.ATTACK, 'a attack');
  assertEqual(b.controller.getState(), HOSTILE_NPC_STATE.ATTACK, 'b attack');
  assertEqual(a.state.damageCalls.length, 1, 'a damaged once');
  assertEqual(b.state.damageCalls.length, 1, 'b damaged once');
  a.controller.update(500, 16);
  b.controller.update(1100, 16);
  assertEqual(a.state.damageCalls.length, 1, 'a still cooling');
  assertEqual(b.state.damageCalls.length, 2, 'b cooled independently');
}

// Missing player safety + FPS-independent chase step
{
  const { state, controller } = createHarness();
  state.player = { x: 80, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'chase');
  const before = state.x;
  controller.update(100, 1000);
  const step1 = state.x - before;
  assert(step1 > 0 && step1 <= state.config.chaseSpeed + 0.001, 'chase step uses chaseSpeed * dt');

  state.player = null;
  controller.update(200, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.RETURN, 'no player -> RETURN');
}

// Cleanup
{
  const { state, controller } = createHarness();
  state.player = { x: 10, y: 0 };
  controller.update(0, 16);
  assertEqual(state.damageCalls.length, 1, 'attack before destroy');
  controller.destroy();
  controller.destroy();
  assert(controller.isDestroyed(), 'destroyed');
  const damageBefore = state.damageCalls.length;
  controller.update(5000, 16);
  assertEqual(state.damageCalls.length, damageBefore, 'no damage after destroy');
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'state cleared');
}

// Melee configs stay melee: TALL_MONSTER and ELECTRICMAN reach ATTACK, not RANGED
{
  ['TALL_MONSTER', 'ELECTRICMAN'].forEach((type) => {
    const cfg = getHostileNpcConfig(type);
    assert(cfg.attackMode !== 'RANGED', `${type} is melee`);
    assert(!Object.prototype.hasOwnProperty.call(cfg, 'rangedAttackRange'), `${type} has no ranged range`);
    assert(!Object.prototype.hasOwnProperty.call(cfg, 'projectileSpeed'), `${type} has no projectile fields`);
    const { state, controller } = createHarness({ config: cfg, x: 0, y: 0 });
    state.player = { x: cfg.attackRange - 1, y: 0 };
    controller.update(0, 16);
    assertEqual(controller.getState(), HOSTILE_NPC_STATE.ATTACK, `${type} enters melee ATTACK`);
    assertEqual(state.damageCalls.length, 1, `${type} melee damage`);
    assertEqual(state.damageCalls[0], cfg.attackDamage, `${type} melee damage amount`);
  });
}

// Ranged BOWMAN: RANGED_ATTACK state, timed shots, no movement, no direct damage
{
  const bow = getHostileNpcConfig('BOWMAN');
  assertEqual(bow.attackMode, 'RANGED', 'BOWMAN ranged mode');
  assertEqual(bow.rangedAttackRange, 150, 'ranged range 150');

  const state = {
    x: 0,
    y: 0,
    player: null,
    moves: 0,
    rangedShots: [],
    directDamage: 0
  };
  const controller = new HostileNpcController({
    config: bow,
    homeX: 0,
    homeY: 0,
    getPosition: () => ({ x: state.x, y: state.y }),
    setPosition: (x, y) => { state.x = x; state.y = y; state.moves += 1; },
    getPlayerPosition: () => state.player,
    stopWander: () => {},
    resumeWander: () => {},
    damagePlayer: () => { state.directDamage += 1; return 0; },
    onRangedAttack: (target, time) => { state.rangedShots.push({ x: target.x, y: target.y, time }); },
    canOccupy: () => true
  });

  assertEqual(controller.getState(), HOSTILE_NPC_STATE.IDLE_WANDER, 'ranged starts idle');

  // Within detection (165) but beyond ranged range (150): chase, no shot.
  state.player = { x: 160, y: 0 };
  controller.update(0, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'beyond ranged -> CHASE');
  assertEqual(state.rangedShots.length, 0, 'no shot while chasing');

  // Enter ranged range: RANGED_ATTACK, immediate first shot, movement halted.
  state.x = 0;
  state.y = 0;
  state.player = { x: 120, y: 0 };
  const movesBefore = state.moves;
  controller.update(100, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.RANGED_ATTACK, 'enters RANGED_ATTACK');
  assertEqual(state.rangedShots.length, 1, 'first shot immediate');
  assertEqual(state.rangedShots[0].x, 120, 'shot target x at release');
  assertEqual(state.moves, movesBefore, 'no movement in RANGED_ATTACK');

  // Cooldown blocks a second shot (attackCooldown 1000).
  controller.update(600, 16);
  assertEqual(state.rangedShots.length, 1, 'cooldown blocks second shot');

  // After cooldown, another shot is released.
  controller.update(1100, 16);
  assertEqual(state.rangedShots.length, 2, 'shot after cooldown');

  // Beyond ranged range but within disengage (245): back to CHASE.
  state.player = { x: 200, y: 0 };
  controller.update(1200, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.CHASE, 'leave ranged range -> CHASE');

  // Beyond disengage: RETURN.
  state.player = { x: 300, y: 0 };
  controller.update(1300, 16);
  assertEqual(controller.getState(), HOSTILE_NPC_STATE.RETURN, 'leave disengage -> RETURN');

  assertEqual(state.directDamage, 0, 'ranged never calls direct damagePlayer');

  // Independent cooldowns/state per controller instance.
  const state2 = { x: 0, y: 0, player: { x: 100, y: 0 }, rangedShots: [] };
  const controller2 = new HostileNpcController({
    config: bow,
    homeX: 0,
    homeY: 0,
    getPosition: () => ({ x: state2.x, y: state2.y }),
    setPosition: () => {},
    getPlayerPosition: () => state2.player,
    onRangedAttack: (target, time) => { state2.rangedShots.push({ time }); },
    canOccupy: () => true
  });
  controller2.update(0, 16);
  assertEqual(state2.rangedShots.length, 1, 'second bowman fires independently');
  controller2.update(500, 16);
  assertEqual(state2.rangedShots.length, 1, 'second bowman own cooldown');
}

console.log('test-hostile-npc-core: ok');
