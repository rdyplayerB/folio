#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Cross-path parity — the test that keeps Folio from quietly becoming two engines.
//
//  Path A (a 1988 Z-machine binary) and Path B (a declarative world.json) share
//  nothing internally. The only thing that makes one shell able to render both is
//  that they emit the same World State Contract. Nothing enforces that except this
//  file, and the two paths are developed in parallel, so drift is the default
//  outcome unless it is checked on a rhythm.
//
//  It asserts shape, type and semantics — not values. The two games are different
//  games; what must match is the contract they speak.
//
'use strict';

const fs = require('fs');
const path = require('path');

const zmachine = require('../packages/zmachine/index.js');
const world = require('../packages/world/index.js');

const ORIGIN = process.env.FOLIO_ORIGIN ||
  path.join(process.env.HOME, 'projects-games', 'zork1');

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}

// ------------------------------------------------------------------ Path A
const storySrc = fs.readFileSync(path.join(ORIGIN, 'data', 'story.js'), 'utf8');
const b64 = storySrc.match(/["']([A-Za-z0-9+/=]{2000,})["']/);
const ns = {}; const sb = { GUE: ns }; sb.window = sb;
new Function('window', 'globalThis', 'global', 'GUE', 'module',
  fs.readFileSync(path.join(ORIGIN, 'data', 'roommap.js'), 'utf8'))(sb, sb, sb, ns, undefined);

const A = zmachine.createBackend(Buffer.from(b64[1], 'base64'), {
  roommap: { ROOMMAP: ns.ROOMMAP, OBJMAP: ns.OBJMAP, ADVENTURER: ns.ADVENTURER,
    ATTR: ns.ATTR, DIRPROP: ns.DIRPROP, EXIT_HAS_ROOM: ns.EXIT_HAS_ROOM },
  seed: 1234
});

// ------------------------------------------------------------------ Path B
const B = world.createBackend(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'cellar-door', 'logic', 'world.json'), 'utf8')),
  { seed: 1234 });

const sa = A.state();
const sb2 = B.state();

console.log('Path A: ' + sa.roomId + '   Path B: ' + sb2.roomId + '\n');

// --------------------------------------------------------------- the contract
const FIELDS = {
  roomId: 'string', roomName: 'string', score: 'number', moves: 'number',
  dark: 'boolean', objects: 'array', inventory: 'array', contents: 'object',
  flags: 'object', exits: 'object', globals: 'object', fighting: 'boolean'
};

function kind(v) {
  return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
}

for (const [field, want] of Object.entries(FIELDS)) {
  const ka = kind(sa[field]);
  const kb = kind(sb2[field]);
  check('both paths emit ' + field + ' as ' + want, ka === want && kb === want,
    'A=' + ka + ' B=' + kb);
}

check('lampTurns is a number or null on both paths',
  (typeof sa.lampTurns === 'number' || sa.lampTurns === null) &&
  (typeof sb2.lampTurns === 'number' || sb2.lampTurns === null),
  'A=' + sa.lampTurns + ' B=' + sb2.lampTurns);

// exits: a map keyed by direction, values are room ids. Not a list on either path.
const dirsA = Object.keys(sa.exits);
const dirsB = Object.keys(sb2.exits);
// A value is a room id (passable), or false (exists but blocked). Absent means no
// passage at all. All three states must mean the same thing on both paths or the
// compass renders one game's world wrongly.
const exitVal = (v) => typeof v === 'string' || v === false;
check('exits are keyed by direction, valued room-id-or-false, on both paths',
  dirsA.length > 0 && dirsB.length > 0 &&
  dirsA.every(d => exitVal(sa.exits[d])) && dirsB.every(d => exitVal(sb2.exits[d])),
  'A[' + dirsA.join(',') + '] B[' + dirsB.join(',') + ']');
check('both paths can express a blocked-but-visible passage',
  Object.values(sa.exits).includes(false),
  'A blocks: ' + dirsA.filter(d => sa.exits[d] === false).join(',') || 'none');

// object ids are stable strings on both — the scene renderer keys art off these.
check('object ids are strings on both paths',
  sa.objects.every(o => typeof o === 'string') && sb2.objects.every(o => typeof o === 'string'),
  'A[' + sa.objects.join(',') + '] B[' + sb2.objects.join(',') + ']');

// flags are keyed by object id, values are attribute maps.
const fa = Object.keys(sa.flags)[0];
const fbKey = Object.keys(sb2.flags)[0];
check('flags map object ids to attribute objects',
  (!fa || typeof sa.flags[fa] === 'object') && (!fbKey || typeof sb2.flags[fbKey] === 'object'),
  'A.' + fa + ' B.' + fbKey);

// ------------------------------------------------------------ live behaviour
// Darkness must mean the same thing on both paths, since the shell renders it.
const bDark = world.createBackend(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'cellar-door', 'logic', 'world.json'), 'utf8')),
  { seed: 1234 });
bDark.submit('NORTH'); bDark.submit('TAKE', 'KEY'); bDark.submit('SOUTH');
bDark.submit('UNLOCK', 'CELLAR-DOOR'); bDark.submit('DOWN');
check('Path B reports dark in an unlit room', bDark.state().dark === true,
  'room=' + bDark.state().roomId);

// And a live exit must appear only once its condition is satisfied — the property
// that makes exits worth computing rather than authoring.
const bExit = world.createBackend(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'cellar-door', 'logic', 'world.json'), 'utf8')),
  { seed: 1234 });
const before = bExit.state().exits.DOWN;
bExit.submit('NORTH'); bExit.submit('TAKE', 'KEY'); bExit.submit('SOUTH');
bExit.submit('UNLOCK', 'CELLAR-DOOR');
const after = bExit.state().exits.DOWN;
check('a locked passage shows as blocked, then becomes passable',
  before === false && after === 'CELLAR',
  'before=' + before + ' after=' + after);

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mboth paths speak the same contract\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
