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

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert(error instanceof Error, `${message}: expected Error`);
    assert(
      typeof error.message === 'string' && error.message.length > 0,
      `${message}: expected non-empty error message`
    );
  }
  assert(threw, `${message}: expected throw`);
}

const helperPath = path.join(root, 'src/world/ChunkNpcWander.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');
assert(!/\bMath\.random\s*\(/.test(helperSource), 'production helper must not call Math.random()');
assert(!/\bPhaser\b/.test(helperSource), 'production helper must not reference Phaser');
assert(!/\bphysics\b/i.test(helperSource), 'production helper must not reference physics');
assert(!/\bcollider\b/i.test(helperSource), 'production helper must not reference collider');
assert(!/\boverlap\b/i.test(helperSource), 'production helper must not reference overlap');
assert(!/\bvelocity\b/i.test(helperSource), 'production helper must not reference velocity');
assert(!/\btween\b/i.test(helperSource), 'production helper must not reference tween');
assert(!/\bdelayedCall\b/.test(helperSource), 'production helper must not reference delayedCall');
assert(!/\btime\.addEvent\b/.test(helperSource), 'production helper must not reference time.addEvent');

const context = {
  console,
  Math,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  Error,
  exports: {}
};
vm.createContext(context);
vm.runInContext(
  `${helperSource}\n;exports.chooseNpcWanderTarget = chooseNpcWanderTarget;`,
  context,
  { filename: 'npc-wander-bundle.js' }
);

const { chooseNpcWanderTarget } = context.exports;

function cloneOptions(options) {
  return {
    ...options,
    blockedCells: new Set(options.blockedCells)
  };
}

const base = {
  localTileX: 5,
  localTileY: 7,
  chunkSize: 16,
  blockedCells: new Set(['5,6', '6,7']),
  randomValue: 0.25
};

const first = chooseNpcWanderTarget(cloneOptions(base));
const second = chooseNpcWanderTarget(cloneOptions(base));
assert(first && typeof first.localTileX === 'number', 'helper returns tile object');
assertEqual(JSON.stringify(first), JSON.stringify(second), 'same inputs yield same result');

const open = chooseNpcWanderTarget({
  localTileX: 5,
  localTileY: 5,
  chunkSize: 16,
  blockedCells: new Set(),
  randomValue: 0
});
assertEqual(JSON.stringify(open), JSON.stringify({ localTileX: 5, localTileY: 4 }), 'randomValue 0 picks first candidate (up)');

const allOpenOrder = [];
[0, 0.25, 0.5, 0.75].forEach((randomValue) => {
  allOpenOrder.push(chooseNpcWanderTarget({
    localTileX: 5,
    localTileY: 5,
    chunkSize: 16,
    blockedCells: new Set(),
    randomValue
  }));
});
assertEqual(
  JSON.stringify(allOpenOrder),
  JSON.stringify([
    { localTileX: 5, localTileY: 4 },
    { localTileX: 6, localTileY: 5 },
    { localTileX: 5, localTileY: 6 },
    { localTileX: 4, localTileY: 5 }
  ]),
  'fixed candidate order is up, right, down, left'
);

allOpenOrder.forEach((tile) => {
  const dx = Math.abs(tile.localTileX - 5);
  const dy = Math.abs(tile.localTileY - 5);
  assert(dx + dy === 1, 'only orthogonal neighbors are chosen');
  assert(!(dx === 1 && dy === 1), 'diagonal cells are never chosen');
});

const nearEdge = chooseNpcWanderTarget({
  localTileX: 0,
  localTileY: 0,
  chunkSize: 16,
  blockedCells: new Set(),
  randomValue: 0
});
assertEqual(nearEdge.localTileX, 1, 'edge pick stays in-bounds (right)');
assertEqual(nearEdge.localTileY, 0, 'edge pick stays in-bounds y');
assert(nearEdge.localTileX >= 0 && nearEdge.localTileX < 16, 'x inside chunk');
assert(nearEdge.localTileY >= 0 && nearEdge.localTileY < 16, 'y inside chunk');

const blocked = new Set(['5,4', '6,5', '5,6']);
const onlyLeft = chooseNpcWanderTarget({
  localTileX: 5,
  localTileY: 5,
  chunkSize: 16,
  blockedCells: blocked,
  randomValue: 0.9
});
assertEqual(JSON.stringify(onlyLeft), JSON.stringify({ localTileX: 4, localTileY: 5 }), 'only free neighbor is chosen');
assert(!blocked.has('4,5') || true, 'sanity');
assertEqual(blocked.size, 3, 'blockedCells size unchanged');
assert(blocked.has('5,4') && blocked.has('6,5') && blocked.has('5,6'), 'blockedCells contents unchanged');

const none = chooseNpcWanderTarget({
  localTileX: 5,
  localTileY: 5,
  chunkSize: 16,
  blockedCells: new Set(['5,4', '6,5', '5,6', '4,5']),
  randomValue: 0.1
});
assertEqual(none, null, 'no free neighbors returns null');

const last = chooseNpcWanderTarget({
  localTileX: 5,
  localTileY: 5,
  chunkSize: 16,
  blockedCells: new Set(),
  randomValue: 0.999999
});
assertEqual(JSON.stringify(last), JSON.stringify({ localTileX: 4, localTileY: 5 }), 'randomValue near 1 picks last candidate');

const optionsSnapshot = {
  localTileX: 3,
  localTileY: 3,
  chunkSize: 8,
  blockedCells: new Set(['3,2']),
  randomValue: 0.1
};
const blockedBefore = Array.from(optionsSnapshot.blockedCells).sort().join('|');
const optionsJsonBefore = JSON.stringify({
  localTileX: optionsSnapshot.localTileX,
  localTileY: optionsSnapshot.localTileY,
  chunkSize: optionsSnapshot.chunkSize,
  randomValue: optionsSnapshot.randomValue
});
chooseNpcWanderTarget(optionsSnapshot);
assertEqual(
  Array.from(optionsSnapshot.blockedCells).sort().join('|'),
  blockedBefore,
  'blockedCells not mutated'
);
assertEqual(
  JSON.stringify({
    localTileX: optionsSnapshot.localTileX,
    localTileY: optionsSnapshot.localTileY,
    chunkSize: optionsSnapshot.chunkSize,
    randomValue: optionsSnapshot.randomValue
  }),
  optionsJsonBefore,
  'options scalar fields not mutated'
);

assertThrows(() => chooseNpcWanderTarget(null), 'null options');
assertThrows(() => chooseNpcWanderTarget(undefined), 'undefined options');
assertThrows(() => chooseNpcWanderTarget('bad'), 'non-object options');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  chunkSize: 0
}), 'chunkSize 0');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  chunkSize: -1
}), 'negative chunkSize');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  chunkSize: 1.5
}), 'non-integer chunkSize');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  localTileX: 1.2,
  localTileY: 7
}), 'non-integer localTileX');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  localTileX: 5,
  localTileY: 7.1
}), 'non-integer localTileY');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  localTileX: -1,
  localTileY: 0,
  chunkSize: 16,
  blockedCells: new Set(),
  randomValue: 0
}), 'current cell outside chunk');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  localTileX: 16,
  localTileY: 0,
  chunkSize: 16,
  blockedCells: new Set(),
  randomValue: 0
}), 'current cell at chunkSize boundary');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  blockedCells: ['5,6']
}), 'blockedCells not a Set');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  randomValue: -0.1
}), 'randomValue < 0');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  randomValue: 1
}), 'randomValue >= 1');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  randomValue: Number.NaN
}), 'NaN randomValue');
assertThrows(() => chooseNpcWanderTarget({
  ...base,
  randomValue: Number.POSITIVE_INFINITY
}), 'Infinity randomValue');

console.log('test-npc-wander: ok');
