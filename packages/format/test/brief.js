#!/usr/bin/env node
/* eslint-disable no-console */
//
//  The dials must actually move things, and must silence the warnings they
//  authorise. A difficulty setting that changes nothing measurable is decoration.
//
'use strict';

const { resolve, ZORK } = require('../brief.js');

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}

const gentle = resolve({ length: 'short', difficulty: 'gentle', deadliness: 'none' });
const cruel = resolve({ length: 'epic', difficulty: 'cruel', deadliness: 'classic',
  sprawl: 'open', density: 'balanced' });

check('difficulty moves chain depth', cruel.targets.chainDepth > gentle.targets.chainDepth,
  gentle.targets.chainDepth + ' vs ' + cruel.targets.chainDepth);
check('difficulty moves how far a key sits from its lock',
  cruel.targets.gateDistance > gentle.targets.gateDistance,
  gentle.targets.gateDistance + ' vs ' + cruel.targets.gateDistance);
check('difficulty moves the patience budget',
  cruel.targets.longestDrySpell > gentle.targets.longestDrySpell,
  gentle.targets.longestDrySpell + ' vs ' + cruel.targets.longestDrySpell);

// The strongest evidence the calibration is real: asking for a Zork-scale, Zork-hard,
// Zork-shaped game reproduces Zork's measured numbers rather than approximating them.
check('a Zork-scale brief reproduces Zork\'s measured shape',
  cruel.targets.rooms === ZORK.rooms &&
  cruel.targets.loopsPerRoom === ZORK.loopsPerRoom &&
  cruel.targets.takeRate === ZORK.takeRate &&
  cruel.targets.chainDepth === ZORK.chainDepth,
  cruel.targets.rooms + ' rooms, ' + cruel.targets.loopsPerRoom + ' loops/room, ' +
  cruel.targets.takeRate + '% take rate, depth ' + cruel.targets.chainDepth);

// A dial must silence its own warning.
check('deadliness "none" stops T4 asking for a death state',
  gentle.thresholds.expectDeaths === false);
check('deadliness "classic" expects one', cruel.thresholds.expectDeaths === true);

// Scale from the source is the answer to "a long novel must not compile to six rooms".
const fromBook = resolve({ source: { locations: 47, objects: 31 }, difficulty: 'cruel' });
check('scale is inferred from what the source contains',
  fromBook.targets.rooms === 47,
  fromBook.notes.find(n => /inferred/.test(n)));
check('and the floor moves with it, so a hollow adaptation is caught',
  fromBook.thresholds.minRooms > gentle.thresholds.minRooms,
  'floor ' + fromBook.thresholds.minRooms + ' vs ' + gentle.thresholds.minRooms);

// Honesty about impossible asks, rather than silently pretending.
const tinyCruel = resolve({ length: 'short', difficulty: 'cruel' });
check('a small world cannot carry a huge chain, and says so',
  tinyCruel.targets.chainDepth < 9 && tinyCruel.notes.some(n => /capped/.test(n)),
  tinyCruel.notes.find(n => /capped/.test(n)));

check('thresholds sit below targets so near-misses are not nagged',
  gentle.thresholds.minRooms < gentle.targets.rooms,
  gentle.thresholds.minRooms + ' floor under a ' + gentle.targets.rooms + ' target');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
