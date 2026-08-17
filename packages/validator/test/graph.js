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


// --- actors are nouns ------------------------------------------------------
// Regression. The analysis knew about items and forgot actors entirely, so any
// rule triggered by a character was reported unfireable, and everything behind
// the flag it set became unreachable. A whole class of game, the kind with a
// person in it, could not certify. Found by writing a game from the published
// spec rather than from the engine, which is what that exercise is for.
const npc = {
  meta: { start: 'GATE' },
  flags: { paid: false },
  rooms: [
    { id: 'GATE', exits: [{ dir: 'NORTH', to: 'CITY',
        condition: { type: 'flag', flag: 'paid' } }] },
    { id: 'CITY', exits: [{ dir: 'SOUTH', to: 'GATE' }] }
  ],
  items: [{ id: 'COIN', location: 'GATE', attributes: { TAKEBIT: true } }],
  actors: [{ id: 'GUARD', location: 'GATE' }],
  rules: [
    { on: { verb: 'GIVE', noun: 'GUARD' },
      if: [{ type: 'carrying', item: 'COIN' }],
      do: [{ type: 'destroy', item: 'COIN' },
           { type: 'move-actor', actor: 'GUARD', to: 'NOWHERE' },
           { type: 'set-flag', flag: 'paid', value: true }] },
    // Unguarded fallback on the same trigger. A player meets this every time they
    // try the guard empty-handed, so it is not dead code.
    { on: { verb: 'GIVE', noun: 'GUARD' },
      do: [{ type: 'print', text: 'He does not move.' }] },
    { on: { verb: 'LOOK', noun: 'COIN' }, if: [{ type: 'at', room: 'CITY' }],
      do: [{ type: 'win', text: 'done' }] }
  ]
};
const g = analyse(npc);
const gErr = g.findings.filter(f => f.level === 'error');
check('a puzzle gated on an actor is not reported unreachable',
  !gErr.some(e => e.code === 'E310' || e.code === 'E311'),
  gErr.map(e => e.code + ' ' + e.msg).join(' | ') || 'no errors');
check('a fallback whose noun a later rule removes is not called dead code',
  !g.findings.some(f => f.code === 'W313' && /GUARD/.test(f.msg)),
  (g.findings.find(f => f.code === 'W313') || {}).msg || 'no W313');


// Timers advance the world, and reachability used to be blind to them.
//
// The design this broke was the faithful one: hide in the oven while timers
// bring the ogre home, feed him and put him to sleep, setting the flag that
// opens the great hall. It came back with an unreachable win, an unreachable
// room and twelve dead rules, none of which named the cause. Nothing in the
// vocabulary can cancel a timer, so one whose startFlag is satisfiable will fire
// given enough turns, and this analysis is already optimistic about ordering.
const timed = {
  meta: { start: 'OVEN' }, flags: { asleep: false },
  rooms: [{ id: 'OVEN', exits: [{ dir: 'OUT', to: 'HALL',
              condition: { type: 'flag', flag: 'asleep' } }] },
          { id: 'HALL', exits: [{ dir: 'IN', to: 'OVEN' }] }],
  items: [{ id: 'GOLD', location: 'HALL', attributes: { TAKEBIT: true } }],
  rules: [{ on: { verb: 'TAKE', noun: 'GOLD' }, if: [{ type: 'in-room', item: 'GOLD' }],
            do: [{ type: 'take', item: 'GOLD' }, { type: 'print', text: 'Got it.' },
                 { type: 'win', text: 'done' }] }],
  timers: [{ turns: 6, do: [{ type: 'set-flag', flag: 'asleep', value: true }] }]
};
check('a room gated on a timer-set flag is reachable',
  analyse(timed).findings.filter(f => f.level === 'error').length === 0,
  analyse(timed).findings.filter(f => f.level === 'error').map(f => f.code).join(',') || 'clean');

// And the diagnosis has to name the blocker, not guess at it. The old text said
// "usually a missing exit or an unsatisfiable condition", which was exactly
// wrong for the case above and cost most of a build to see past.
const stuck = JSON.parse(JSON.stringify(timed));
stuck.timers = [];
const why = analyse(stuck).findings.find(f => f.code === 'E311');
check('an unreachable room names the flag that gates it',
  !!why && /asleep/.test(why.hint) && /nothing ever sets/.test(why.hint),
  why ? why.hint : 'no E311');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
