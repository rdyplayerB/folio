#!/usr/bin/env node
/* eslint-disable no-console */
//
//  T2 graph analysis — proven to bite, and proven not to cry wolf.
//
//  Both halves matter. A validator that misses real dead ends is useless; one that
//  flags healthy authoring gets switched off, which is worse, because then it
//  misses the real dead ends too and everyone believes it didn't.
//
'use strict';

const fs = require('fs');
const path = require('path');
const { analyse } = require('../graph.js');

const FIXTURE = path.join(__dirname, '..', '..', '..', 'conformance', 'cellar-door', 'logic', 'world.json');
const good = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}
function expect(label, world, code) {
  const r = analyse(world);
  const hit = r.findings.some(f => f.code === code);
  check(label, hit, hit ? code : 'got [' + r.findings.map(f => f.code).join(',') + ']');
}

// -------------------------------------------------------------------- control
const base = analyse(good());
check('a completable game passes T2 clean', base.ok && base.findings.length === 0,
  JSON.stringify(base.stats));
check('the win state is proved reachable', base.stats.winReachable === true);
check('every room is proved reachable',
  base.stats.reachable === base.stats.rooms,
  base.stats.reachable + '/' + base.stats.rooms);

// The failure branch — "you grope in the dark" — must NOT be reported as dead.
// This is the regression guard for the false positive found on first run.
check('a wrong-order failure branch is not flagged as dead code',
  !base.findings.some(f => f.code === 'W313'),
  base.findings.filter(f => f.code === 'W313').map(f => f.msg).join('; ') || 'none flagged');

// ---------------------------------------------------------------- real defects
let w;

w = good(); w.rooms[0].exits[0].to = 'NOWHERE-ROOM';
expect('an exit to a room that does not exist', w, 'E301');

w = good(); w.items[0].location = 'ATLANTIS';
expect('an item starting in a place that does not exist', w, 'E303');

w = good(); w.rules[0].do.push({ type: 'goto', room: 'THE-MOON' });
expect('a rule sending the player to a room that does not exist', w, 'E304');

// Remove the key: the cellar door can never be unlocked, so the cellar is
// unreachable and the locket — and therefore the win — is out of reach.
w = good(); w.items = w.items.filter(i => i.id !== 'KEY');
w.rules = w.rules.filter(r => !(r.if || []).some(c => c.item === 'KEY'));
const noKey = analyse(w);
check('a game whose win cannot be reached fails T2',
  noKey.findings.some(f => f.code === 'E310'), 'win reachable=' + noKey.stats.winReachable);
check('and it names the room that became unreachable',
  noKey.findings.some(f => f.code === 'E311' && /CELLAR/.test(f.msg)));

// An orphan room nothing leads to.
w = good(); w.rooms.push({ id: 'ATTIC', name: 'Attic', prose: 'Dust.', exits: [] });
expect('a room nothing leads to', w, 'E311');

// Softlock: something destroyable that a later rule still needs.
w = good();
w.rules.push({ on: { verb: 'BURN', noun: 'KEY' }, do: [{ type: 'destroy', item: 'KEY' }] });
expect('an item that can be destroyed but is still required', w, 'W314');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
