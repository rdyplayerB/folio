//  The corpus profiler, which had no test at all.
//
//  That is why `folio profile` shipped throwing "e is not defined" on every game
//  it was pointed at, for two commits, and was found by an author rather than by
//  the suite. It is the one command whose job is to measure a finished game
//  against its own brief, so it being dead is not a small thing.
//
//  The regression came from unifying the loop measure: `const e = edges.size` was
//  removed and `mapEdges: e` was left behind. Nothing caught it because nothing
//  ever ran it.

'use strict';

const { profile } = require('../profile.js');
const { audit } = require('../design.js');
const world = require('../../world/index.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

console.log('\n=== \x1b[1mthe profiler\x1b[0m ===\n');

// A small world with a genuine circuit in it, so loops are not trivially zero.
const WORLD = {
  meta: { start: 'A' },
  rooms: [
    { id: 'A', exits: [{ dir: 'NORTH', to: 'B' }, { dir: 'EAST', to: 'C' }] },
    { id: 'B', exits: [{ dir: 'SOUTH', to: 'A' }, { dir: 'EAST', to: 'C' }] },
    { id: 'C', exits: [{ dir: 'WEST', to: 'A' }] }
  ],
  items: [{ id: 'GEM', location: 'C', attributes: { TAKEBIT: true } },
          { id: 'ROCK', location: 'A', attributes: {} }],
  rules: [{ on: { verb: 'LOOK' }, if: [{ type: 'carrying', item: 'GEM' }],
            do: [{ type: 'score', value: 10 }, { type: 'print', text: 'ok' },
                 { type: 'win', text: 'done' }] }]
};
// Walks every connection, so the observed graph and the declared graph are the
// same graph. That matters for the last assertion below.
const WALK = 'north\neast\ntake gem\nwest\nlook';

const be = world.createBackend(WORLD, { seed: 1234 });
const backend = {
  banner: be.banner,
  state: be.state,
  submit: be.submit
};
// The CLI hands the profiler a backend plus a send() that flattens a line.
backend.send = (line) => {
  const parts = String(line).trim().split(/\s+/);
  const verb = parts.shift();
  const noun = parts.length ? parts.shift().toUpperCase() : null;
  const second = parts.length ? parts.join(' ').toUpperCase() : null;
  return be.submit(verb, noun, second).prose;
};

let p = null, threw = null;
try { p = profile(backend, WALK); } catch (e) { threw = e; }

ok('it runs at all', !threw, threw ? threw.message : '');
if (threw) { console.log(''); process.exit(1); }

ok('it returns numbers rather than undefined',
  typeof p.rooms === 'number' && typeof p.moves === 'number',
  'rooms=' + p.rooms + ' moves=' + p.moves);
ok('every reported field is defined',
  Object.entries(p).every(([, v]) => v !== undefined),
  Object.entries(p).filter(([, v]) => v === undefined).map(([k]) => k).join(',') || 'all set');

// The regression that shipped: this field referenced a variable that no longer
// existed, so the whole command threw before printing anything.
ok('mapEdges survived the loop-measure change', p.mapEdges !== undefined,
  String(p.mapEdges));

// And the point of unifying the measure: these two reported different numbers
// for the same file until they were made to share one definition.
//
// They are not measuring the same graph, and that is deliberate rather than a
// discrepancy. The audit reads the world as declared; the profiler counts only
// what a playthrough actually walked, which is how the Zork corpus figures were
// derived in the first place. So the profiler can report less, never more, and
// with a walkthrough that covers every connection the two must agree exactly.
const m = audit(WORLD).metrics;
ok('the profiler never reports more loops than the world declares',
  p.mapLoops <= m.mapLoops, 'profile=' + p.mapLoops + ' audit=' + m.mapLoops);
ok('and agrees exactly when the walkthrough covers every connection',
  p.mapLoops === m.mapLoops, 'profile=' + p.mapLoops + ' audit=' + m.mapLoops);

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
