//  Does the checker understand the language the engine speaks?
//
//  This is the failure the third cold build spent more than half its run on. The
//  runtime honours the whole documented vocabulary; the dependency analysis
//  honoured a subset; and only the analysis can stop you shipping. So a game
//  built on idioms the spec advertises played perfectly and would not certify,
//  and none of it came from an error message.
//
//  The three that actually bit: an item handed over with move-item to "PLAYER"
//  was never counted as carried, a lamp declared ONBIT was never counted as lit,
//  and a chest declared OPENBIT was never counted as open, which made anything
//  inside it unreachable.
//
//  Those are fixed. This is here so the next one cannot happen quietly: the case
//  labels are read out of both sources and compared, so adding a condition or an
//  effect to the engine without teaching the checker fails the build.

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

console.log('\n=== \x1b[1mthe checker speaks the engine\x1b[0m ===\n');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const world = read('world/index.js');
const graph = read('validator/graph.js');

// Case labels inside a named function body, read out of the source so the two
// lists cannot be kept in step by hand and quietly stop being.
function casesIn(src, marker, stop) {
  const start = src.indexOf(marker);
  if (start < 0) return [];
  const end = src.indexOf(stop, start);
  const body = src.slice(start, end < 0 ? src.length : end);
  return [...body.matchAll(/case '([a-z-]+)':/g)].map(m => m[1]);
}

const runtimeConditions = casesIn(world, 'test(c) {', '\n  }\n');
const runtimeEffects = casesIn(world, 'apply(effects) {', '\n  }\n');
const checkerConditions = casesIn(graph, 'const canSatisfy = (c) => {', '\n  };');
const checkerEffects = casesIn(graph, 'function applyEffects(list) {', '\n  }\n');

ok('the engine was read', runtimeConditions.length > 0 && runtimeEffects.length > 0,
  runtimeConditions.length + ' conditions, ' + runtimeEffects.length + ' effects');
ok('the checker was read', checkerConditions.length > 0 && checkerEffects.length > 0,
  checkerConditions.length + ' conditions, ' + checkerEffects.length + ' effects');

const missingConditions = runtimeConditions.filter(c => !checkerConditions.includes(c));
ok('every condition the engine evaluates, the checker reasons about',
  missingConditions.length === 0,
  missingConditions.length ? 'missing: ' + missingConditions.join(', ')
    : runtimeConditions.length + ' covered');

// Effects are allowed to be deliberately ignored, but only on purpose. Anything
// that cannot change what a player can reach is listed here by name, so an
// omission is a decision somebody wrote down rather than something forgotten.
// The fixpoint only ever adds capability. That is what makes it optimistic about
// ordering, and optimism is what makes a T2 failure mean something: a real defect
// rather than a complaint about the order you did things in. So every effect that
// can only REMOVE capability is ignored here on purpose. Modelling destroy turned
// spending an item after its last use into a hard error the moment any later rule
// mentioned it; W314 owns that hazard and is advisory for exactly that reason.
const NO_BEARING = [
  'print',        // text, not state
  'score',        // a score gate is treated as always attainable
  'set-counter',  // as is a counter gate
  'add-counter',
  'lose',         // ending a run badly opens nothing
  'destroy',      // removes only. W314 reports the softlock risk instead
  'close',        // removes only
  'extinguish'    // removes only
];
const missingEffects = runtimeEffects
  .filter(e => !checkerEffects.includes(e) && !NO_BEARING.includes(e));
ok('every effect that can change reachability is modelled by the checker',
  missingEffects.length === 0,
  missingEffects.length ? 'missing: ' + missingEffects.join(', ')
    : checkerEffects.length + ' modelled, ' + NO_BEARING.length + ' ignored on purpose');

const staleExemptions = NO_BEARING.filter(e => !runtimeEffects.includes(e));
ok('nothing is exempted that the engine no longer has',
  staleExemptions.length === 0, staleExemptions.join(', '));

// --------------------------------------------------- and the behaviour itself
// The lists agreeing is necessary and not sufficient: the checker has to start
// from the same world the runtime does. Each of these shipped broken.
const { analyse } = require('../graph.js');
const clean = (w) => analyse(w).findings.filter(f => f.level === 'error').length === 0;
const ROOM = { id: 'A', exits: [] };

ok('an item handed over by a rule counts as carried', clean({
  meta: { start: 'A' }, rooms: [ROOM],
  items: [{ id: 'GEM', location: 'NOWHERE', attributes: {} }],
  rules: [{ on: { verb: 'OPEN' }, do: [{ type: 'move-item', item: 'GEM', to: 'PLAYER' }] },
          { on: { verb: 'LOOK' }, if: [{ type: 'carrying', item: 'GEM' }],
            do: [{ type: 'win', text: 'd' }] }]
}));

ok('a lamp declared ONBIT counts as lit', clean({
  meta: { start: 'A' }, rooms: [ROOM],
  items: [{ id: 'LAMP', location: 'A', attributes: { ONBIT: true, LIGHTSOURCE: true } }],
  rules: [{ on: { verb: 'LOOK' }, if: [{ type: 'lit', item: 'LAMP' }],
            do: [{ type: 'win', text: 'd' }] }]
}));

ok('a chest declared OPENBIT counts as open', clean({
  meta: { start: 'A' }, rooms: [ROOM],
  items: [{ id: 'BOX', location: 'A', attributes: { OPENBIT: true } }],
  rules: [{ on: { verb: 'LOOK' }, if: [{ type: 'open', item: 'BOX' }],
            do: [{ type: 'win', text: 'd' }] }]
}));

ok('and what is inside that chest is reachable', clean({
  meta: { start: 'A' }, rooms: [ROOM],
  items: [{ id: 'BOX', location: 'A', attributes: { OPENBIT: true } },
          { id: 'GEM', location: 'BOX', attributes: { TAKEBIT: true } }],
  rules: [{ on: { verb: 'LOOK' }, if: [{ type: 'carrying', item: 'GEM' }],
            do: [{ type: 'win', text: 'd' }] }]
}));

ok('a transparent container works the same way', clean({
  meta: { start: 'A' }, rooms: [ROOM],
  items: [{ id: 'JAR', location: 'A', attributes: { TRANSPARENT: true } },
          { id: 'FLY', location: 'JAR', attributes: { TAKEBIT: true } }],
  rules: [{ on: { verb: 'LOOK' }, if: [{ type: 'carrying', item: 'FLY' }],
            do: [{ type: 'win', text: 'd' }] }]
}));

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
