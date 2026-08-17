//  The blind solver.
//
//  Two claims worth pinning. It has to find the ending of a fair game without
//  being shown the walkthrough, and it has to report a corridor as a corridor:
//  that is the whole reason it exists, and the number no other check can produce.
//
//  Both of the searches that seem obvious are wrong here, and both failures are
//  pinned below. Breadth-first drowns in a game of any size. Greedy best-first
//  finds a path and not a short one, and returned a four-hundred-move route
//  through an eight-move game, which is useless as evidence that a person could
//  find it.

'use strict';

const { solve } = require('../solve.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

console.log('\n=== \x1b[1mthe blind solver\x1b[0m ===\n');

const cellar = require('../../../conformance/cellar-door/logic/world.json');
const lighthouse = require('../../../conformance/lighthouse/logic/world.json');

// ---- it finds a fair game -------------------------------------------------
const a = solve(cellar, { maxMs: 20000 });
ok('it finishes a game without being told how', a.solvedBlind,
  a.solutionMoves + ' moves, ' + a.statesExplored + ' states');
ok('and finds a route no longer than the authored walkthrough',
  a.solutionMoves <= 8, a.solutionMoves + ' moves against a walkthrough of 8');
ok('the route it reports is a real one, ending in the winning move',
  /LOCKET/.test((a.path[a.path.length - 1] || {}).command || ''),
  (a.path[a.path.length - 1] || {}).command);

const b = solve(lighthouse, { maxMs: 20000 });
ok('it solves a game with an actor, a container and a pairing', b.solvedBlind,
  b.solutionMoves + ' moves');
ok('and works out the two-object move on its own',
  b.path.some(p => /USE DOG BISCUIT/.test(p.command)),
  b.path.map(p => p.command).join(' → ').slice(0, 70));

// ---- it calls a corridor a corridor ---------------------------------------
// Ten rooms in a line, one thing to do in each. Every step has exactly one
// action that advances the world, which is precisely what the design audit
// cleared seven times over while being unable to see it.
const corridor = { meta: { start: 'R0' }, flags: {}, rooms: [], items: [], rules: [] };
for (let i = 0; i < 10; i++) {
  corridor.rooms.push({ id: 'R' + i, exits: i < 9
    ? [{ dir: 'NORTH', to: 'R' + (i + 1), condition: { type: 'flag', flag: 'k' + i } }]
    : [] });
  corridor.flags['k' + i] = false;
  corridor.items.push({ id: 'LEVER' + i, location: 'R' + i, attributes: {} });
  corridor.rules.push({ on: { verb: 'USE', noun: 'LEVER' + i, room: 'R' + i },
    do: [{ type: 'set-flag', flag: 'k' + i }, { type: 'print', text: 'click' }] });
}
// The prize sits in the last room and is the only way out. Written as its own
// object because an earlier version put a second rule on LEVER9 and the win was
// shadowed by the lever rule above it, which is the exact defect W511 reports.
corridor.items.push({ id: 'PRIZE', location: 'R9', attributes: { TAKEBIT: true } });
corridor.rules.push({ on: { verb: 'USE', noun: 'PRIZE' },
  if: [{ type: 'carrying', item: 'PRIZE' }],
  do: [{ type: 'print', text: 'out' }, { type: 'win', text: 'out' }] });

const c = solve(corridor, { maxMs: 20000 });
ok('it solves a corridor', c.solvedBlind, c.solutionMoves + ' moves');
ok('and reports that almost every step was forced',
  c.forcedFraction >= 60, c.forcedFraction + '% of steps had one option');

// The same ten rooms, fully connected and with nothing locked: a player has
// somewhere to go at every point, and the measure has to tell them apart.
const open = { meta: { start: 'R0' }, rooms: [], items: [], rules: [] };
for (let i = 0; i < 10; i++) {
  const exits = [];
  if (i < 9) exits.push({ dir: 'NORTH', to: 'R' + (i + 1) });
  if (i > 0) exits.push({ dir: 'SOUTH', to: 'R' + (i - 1) });
  open.rooms.push({ id: 'R' + i, exits });
  open.items.push({ id: 'GEM' + i, location: 'R' + i, attributes: { TAKEBIT: true } });
}
open.rules.push({ on: { verb: 'USE', noun: 'GEM9' },
  if: [{ type: 'carrying', item: 'GEM9' }], do: [{ type: 'win', text: 'out' }] });
const d = solve(open, { maxMs: 20000 });
ok('an open map is not reported as a corridor',
  d.solvedBlind && d.forcedFraction < c.forcedFraction,
  'open ' + d.forcedFraction + '% against corridor ' + c.forcedFraction + '%');

// ---- and it is honest when it runs out ------------------------------------
const e = solve(cellar, { maxMs: 1, maxStates: 1 });
ok('a search that ran out of budget says so rather than claiming unfair',
  e.truncated && !e.solvedBlind, 'truncated=' + e.truncated);

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
