//  Does calibration actually recover a room map from a bare binary?
//
//  There is exactly one story file in the world we can check this against with a
//  known-correct answer, and it is not in this repository. The origin project
//  derived Zork I's map by constraint satisfaction against a hand-written world
//  description, verified it against a 428-command playthrough, and cross-checked
//  the decoder against the interpreter's own. That output is the ground truth.
//
//  What this proves is the interesting claim: that the same map can be recovered
//  from the binary ALONE, with no hand-written world to match against. If that
//  holds, porting a game nobody has mapped before is tractable.
//
//  It also pins the honest half. Eight of the ten attribute flags cannot be
//  derived statically and come back as a census for a human to read, and this
//  asserts that they come back as *absent* rather than as a confident guess.
//  A wrong TAKEBIT is worse than a missing one.

'use strict';

const fs = require('fs');
const path = require('path');
const origin = require('./origin.js');
const { calibrate } = require('../packages/zmachine/calibrate.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

// The compiled story lives in the origin checkout, not here. Folio ships no game
// data, so this skips loudly rather than failing when it is absent.
const STORY = path.join(origin.ORIGIN, 'reference/zil-source/COMPILED/zork1.z3');
if (!fs.existsSync(STORY) || !origin.available()) {
  origin.skip('calibration against a known-correct room map');
}

const truth = origin.roommap();
const r = calibrate(fs.readFileSync(STORY));

console.log('\n=== \x1b[1mcalibration from the binary alone\x1b[0m ===\n');

// ---- the structural half, which should be exact -------------------------
const trueRooms = Object.keys(truth.ROOMMAP).map(Number).sort((a, b) => a - b);
const gotRooms = Object.keys(r.roommap.ROOMMAP).map(Number).sort((a, b) => a - b);
ok('every room is found, and nothing else is',
  JSON.stringify(trueRooms) === JSON.stringify(gotRooms),
  gotRooms.length + ' rooms, expected ' + trueRooms.length);

const trueObjs = Object.keys(truth.OBJMAP).map(Number);
const gotObjs = new Set(Object.keys(r.roommap.OBJMAP).map(Number));
ok('every mapped object is accounted for',
  trueObjs.every(n => gotObjs.has(n)),
  gotObjs.size + ' mapped');

ok('rooms and objects do not overlap',
  gotRooms.every(n => !gotObjs.has(n)));

const dirs = Object.keys(truth.DIRPROP);
ok('all ' + dirs.length + ' direction properties are named correctly',
  dirs.every(d => r.roommap.DIRPROP[d] === truth.DIRPROP[d]) &&
  Object.keys(r.roommap.DIRPROP).length === dirs.length,
  'reciprocity ' + Math.round(r.report.directions.reciprocity * 100) + '%');

ok('the player object is found',
  r.roommap.ADVENTURER === truth.ADVENTURER,
  'got ' + r.roommap.ADVENTURER + ', expected ' + truth.ADVENTURER);

ok('exit property lengths match',
  JSON.stringify(r.roommap.EXIT_HAS_ROOM) === JSON.stringify(truth.EXIT_HAS_ROOM));

// Ids are minted rather than matched, so they will not equal the origin's names.
// What has to hold is that they are stable and unique, because scene art is bound
// to them and a re-run must not shuffle the map out from under it.
const allIds = Object.values(r.roommap.ROOMMAP).concat(Object.values(r.roommap.OBJMAP));
ok('minted ids are unique', new Set(allIds).size === allIds.length,
  allIds.length + ' ids');
const again = calibrate(fs.readFileSync(STORY));
ok('calibration is deterministic across runs',
  JSON.stringify(again.roommap) === JSON.stringify(r.roommap));

// ---- the inferred half, which must not overclaim -------------------------
ok('DOORBIT is derived, because DEXIT names its door',
  r.roommap.ATTR.DOORBIT === truth.ATTR.DOORBIT,
  'got ' + r.roommap.ATTR.DOORBIT + ', expected ' + truth.ATTR.DOORBIT);

ok('ACTORBIT is derived, via the one unplaced actor',
  r.roommap.ATTR.ACTORBIT === truth.ATTR.ACTORBIT,
  'got ' + r.roommap.ATTR.ACTORBIT + ', expected ' + truth.ATTR.ACTORBIT);

// The point of this one: every flag it did claim is right. A tool that guesses
// eight flags and gets six of them is worse than this, because the two wrong ones
// are indistinguishable from the six right ones.
const claimed = Object.keys(r.roommap.ATTR);
ok('no flag is claimed incorrectly',
  claimed.every(f => r.roommap.ATTR[f] === truth.ATTR[f]),
  claimed.length + ' claimed: ' + claimed.join(', '));

ok('the rest are reported as unresolved rather than guessed',
  r.report.missingFlags.length > 0 &&
  r.report.missingFlags.every(f => r.roommap.ATTR[f] === undefined),
  r.report.missingFlags.length + ' left for a human');

// And the census has to be good enough to actually resolve them, which means the
// correct bit must be present with enough object names to recognise it by.
const census = new Map(r.report.census.map(c => [c.bit, c]));
const resolvable = r.report.missingFlags.filter(f => {
  const c = census.get(truth.ATTR[f]);
  return c && c.sample.length >= 3;
});
ok('the census carries the right bit, with names, for every unresolved flag',
  resolvable.length === r.report.missingFlags.length,
  resolvable.length + '/' + r.report.missingFlags.length + ' resolvable by reading');

//  The survey — the same tables, arranged as a map somebody can look at.
//
//  It is checked here rather than in the editor's own tests because this is the
//  only place a real compiled game is available to check it against.
const { survey } = require('../packages/zmachine/calibrate.js');
const s = survey(fs.readFileSync(STORY));

ok('a survey finds the same rooms the calibration does',
  s.rooms.length === Object.keys(r.roommap.ROOMMAP).length,
  s.rooms.length + ' rooms');

ok('every exit leads to a room that is in the survey',
  s.rooms.every(rm => rm.exits.every(x => s.rooms.some(o => o.id === x.to))),
  s.survey.exits + ' exits');

//  Spot-checked against the map anyone who has played it can draw from memory.
//  If the direction assignment ever drifts, this is what notices.
const west = s.rooms.find(rm => rm.id === 'WEST-OF-HOUSE');
const goes = (room, dir) => ((room || {}).exits || []).filter(x => x.dir === dir).map(x => x.to);
ok('west of house still runs north to north of house',
  goes(west, 'NORTH').includes('NORTH-OF-HOUSE'), goes(west, 'NORTH').join(','));
ok('west of house still runs south to south of house',
  goes(west, 'SOUTH').includes('SOUTH-OF-HOUSE'), goes(west, 'SOUTH').join(','));
ok('the kitchen is still west of the living room',
  goes(s.rooms.find(rm => rm.id === 'KITCHEN'), 'WEST').includes('LIVING-ROOM'));

//  The one thing it must not do is invent a starting room. Zork places the
//  player from code, so the initial object table does not say where you begin,
//  and a survey that guessed would put a START label on an arbitrary room.
ok('no start room is claimed, because the story file does not state one',
  s.meta.start === undefined && !!s.meta.layoutRoot,
  'laid out from ' + s.meta.layoutRoot);

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
