#!/usr/bin/env node
/* eslint-disable no-console */
//
//  A validator that only ever says VALID is decoration. This deliberately breaks
//  a known-good game one way at a time and asserts the specific finding fires.
//
'use strict';

const { validate } = require('../index.js');

// A minimal well-formed game, used as the control and then damaged per case.
function good() {
  const story = Buffer.alloc(64); story[0] = 3;          // v3 header
  return {
    manifest: {
      id: 'x', title: 'X', author: 'Y', folioVersion: '0.1.0',
      logicType: 'zmachine', license: 'MIT', contentRating: 'all-ages',
      capabilities: ['darkness'], aiDisclosure: { prose: 'none' }
    },
    walkthrough: 'north\nsouth\n',
    files: {
      'logic/game.z3': story,
      'presentation/roommap.json': Buffer.from(JSON.stringify({
        ROOMMAP: { 1: 'A' }, OBJMAP: { 2: 'B' }, ADVENTURER: 44,
        // The full table the bridge reads. This fixture used to carry an empty
        // ATTR and pass, which is the defect E206 now catches.
        ATTR: { TAKEBIT: 17, OPENBIT: 11, ONBIT: 19, DOORBIT: 22, CONTBIT: 18,
                TRANSBIT: 12, SURFACEBIT: 10, LIGHTBIT: 31, INVISIBLE: 7, ACTORBIT: 30 }
      }))
    }
  };
}

let failed = 0;
function expect(label, game, code) {
  const r = validate(game);
  const hit = r.findings.some(x => x.code === code);
  console.log((hit ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    '  -- expected ' + code + (hit ? '' : ', got [' + r.findings.map(x => x.code).join(',') + ']'));
  if (!hit) failed++;
}

// Control: the good game must pass, or every case below is meaningless.
const base = validate(good());
console.log((base.ok ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') +
  'a well-formed game validates  -- ' + base.summary);
if (!base.ok) failed++;

let g;
g = good(); delete g.manifest.license;
expect('missing mandatory manifest field', g, 'E100');

g = good(); g.manifest.folioVersion = '1.0';
expect('non-semver folioVersion', g, 'E102');

g = good(); g.manifest.contentRating = 'spicy';
expect('unknown content rating', g, 'E104');

g = good(); g.manifest.license = 'unknown';
expect('unknown license warns as not-hostable', g, 'W105');

g = good(); delete g.manifest.aiDisclosure;
expect('missing AI disclosure warns', g, 'W106');

g = good(); g.walkthrough = '   ';
expect('empty walkthrough blocks certification', g, 'E107');

g = good(); delete g.files['logic/game.z3'];
expect('zmachine game with no story file', g, 'E200');

g = good(); g.files['logic/game.z3'][0] = 99;
expect('story file with a bogus version byte', g, 'E201');

g = good();
g.files['logic/game.z5'] = g.files['logic/game.z3']; delete g.files['logic/game.z3'];
expect('story named .z5 whose header says v3', g, 'E202');

g = good(); delete g.files['presentation/roommap.json'];
expect('zmachine game with no presentation binding', g, 'E203');

g = good(); g.files['presentation/roommap.json'] = Buffer.from('{not json');
expect('unparseable roommap', g, 'E204');

g = good(); g.manifest.capabilities = ['time-travel'];
expect('capability this format version cannot honour', g, 'E220');

g = good(); g.files['art/cover.png'] = Buffer.from('definitely not a png');
expect('a .png that is not a PNG', g, 'E230');


// A room map that is present but unfinished.
//
// Found by porting a real game end to end for the first time. Two of the ten
// attribute flags were filled in and everything passed: the game booted, played
// correctly in a terminal, and would have been silently wrong everywhere it was
// drawn, because attr() fails safe to false. Nothing takeable, no container ever
// open, the lamp never lit, and no error anywhere to read.
const FULL_ATTR = { TAKEBIT: 17, OPENBIT: 11, ONBIT: 19, DOORBIT: 22, CONTBIT: 18,
  TRANSBIT: 12, SURFACEBIT: 10, LIGHTBIT: 31, INVISIBLE: 7, ACTORBIT: 30 };
const withRoommap = (rm) => {
  const gg = good();
  gg.files['presentation/roommap.json'] = Buffer.from(JSON.stringify(rm));
  return gg;
};

expect('a room map with most attribute flags missing',
  withRoommap({ ROOMMAP: {}, OBJMAP: {}, ADVENTURER: 44, ATTR: { DOORBIT: 22 } }), 'E206');

expect('a room map still carrying its calibration to-do list',
  withRoommap({ ROOMMAP: {}, OBJMAP: {}, ADVENTURER: 44, ATTR: FULL_ATTR,
    _confirm: { flags: ['TAKEBIT'] } }), 'E207');

expect('a room map with no player object',
  withRoommap({ ROOMMAP: {}, OBJMAP: {}, ATTR: FULL_ATTR }), 'E205');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
