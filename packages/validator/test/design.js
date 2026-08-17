#!/usr/bin/env node
/* eslint-disable no-console */
//
//  T4 — does the audit tell a game from a demo?
//
//  The tier exists because everything below it happily certifies a single room
//  containing a lamp. These tests pin the distinction.
//
'use strict';

const fs = require('fs');
const path = require('path');
const { audit } = require('../design.js');

const FIXTURE = path.join(__dirname, '..', '..', '..', 'conformance', 'cellar-door', 'logic', 'world.json');
const cellar = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}

// The degenerate case: one room, one item, take-it-and-win. Passes T0-T3 cleanly.
const demo = {
  meta: { start: 'R' },
  rooms: [{ id: 'R', name: 'Room', prose: 'A room.', exits: [] }],
  items: [{ id: 'LAMP', name: 'lamp', location: 'R', attributes: { TAKEBIT: true } }],
  rules: [{ on: { verb: 'TAKE', noun: 'LAMP' }, do: [{ type: 'win', text: 'You win.' }] }]
};

const d = audit(demo);
const c = audit(cellar());

check('a one-room demo scores the minimum chain depth', d.metrics.puzzleChainDepth === 1,
  'depth ' + d.metrics.puzzleChainDepth);
check('a real game scores deeper than a demo',
  c.metrics.puzzleChainDepth > d.metrics.puzzleChainDepth,
  c.metrics.puzzleChainDepth + ' vs ' + d.metrics.puzzleChainDepth);

// Depth must count chains that run through item pickups and exit conditions, not
// only rule-to-rule edges. Pinning the number guards the regression that a first
// implementation of this metric scored the fixture at 1.
check('depth counts pickups and exits, not just rules',
  c.metrics.puzzleChainDepth === 5,
  'reach hall > take key > unlock > descend > take locket = ' + c.metrics.puzzleChainDepth);

check('a tiny world is flagged as too small', d.findings.some(f => f.code === 'W500'));
check('a shallow world is flagged as shallow', d.findings.some(f => f.code === 'W501'),
  d.findings.map(f => f.code).join(','));
check('the real game is NOT flagged as shallow', !c.findings.some(f => f.code === 'W501'));

// Item economy has a floor AND a ceiling, both taken from Zork's measured 43%
// take rate. Too little load-bearing and curiosity goes unrewarded; too much and
// the world reads as a shopping list with no scenery to make choices feel chosen.
const scenery = cellar();
for (let i = 0; i < 20; i++) {
  scenery.items.push({ id: 'DECOR' + i, name: 'thing', location: 'HALL', attributes: {} });
}
const sceneryAudit = audit(scenery);
check('a world that is almost entirely scenery is flagged',
  sceneryAudit.findings.some(f => f.code === 'W502'),
  sceneryAudit.metrics.itemParticipation + '% participate');

// Every item load-bearing, in a world big enough for the judgement to be fair —
// the >6-item guard exists so a four-object fixture is not nagged about scenery.
//
// Each gem is REQUIRED by a rule rather than merely answered by one. Answering
// is what makes a thing scenery, and counting that as participation meant an
// author who wrote a flavour line per prop was told their world was a shopping
// list and had to delete the texture to pass.
const shoppingList = cellar();
for (let i = 0; i < 6; i++) {
  shoppingList.items.push({ id: 'GEM' + i, name: 'gem', location: 'HALL',
    attributes: { TAKEBIT: true } });
  shoppingList.rules.push({ on: { verb: 'USE', noun: 'ALTAR' },
    // The door is named in a condition too, so every single item in the world is
    // depended on and the fixture really is 100 per cent load-bearing.
    if: [{ type: 'carrying', item: 'GEM' + i },
         { type: 'open', item: 'CELLAR-DOOR' }],
    do: [{ type: 'print', text: 'It glows.' }] });
}
const slAudit = audit(shoppingList);
check('a world where EVERYTHING is load-bearing is also flagged',
  slAudit.findings.some(f => f.code === 'W507'),
  slAudit.metrics.itemParticipation + '% participate across ' + slAudit.metrics.items + ' items');

check('but a small world is not nagged about scenery',
  !audit(cellar()).findings.some(f => f.code === 'W507'),
  'only ' + audit(cellar()).metrics.items + ' items — too few to judge');

// Corridor maps: the signature of generated geography.
check('a map with no loops is flagged', c.findings.some(f => f.code === 'W504'),
  c.metrics.loopsPerRoom + ' loops/room vs Zork\'s 0.67');
const looped = cellar();
looped.rooms.push({ id: 'YARD', name: 'Yard', prose: 'Grass.', exits: [
  { dir: 'NORTH', to: 'HALL' }, { dir: 'SOUTH', to: 'PORCH' }] });
looped.rooms[0].exits.push({ dir: 'EAST', to: 'YARD' });
looped.rooms[1].exits.push({ dir: 'WEST', to: 'YARD' });
check('a looping map is not flagged', !audit(looped).findings.some(f => f.code === 'W504'),
  audit(looped).metrics.mapLoops + ' loops');

check('a world with no death state is flagged', c.findings.some(f => f.code === 'W505'));


// A hazard on a clock is the commonest way a world kills you, and often the only
// one. Looking at rules alone told an author with a drowning timer that nothing
// in their world had any stakes.
const timed = {
  meta: { start: 'A' },
  rooms: [{ id: 'A', exits: [] }],
  items: [],
  rules: [{ on: { verb: 'WAIT' }, do: [{ type: 'win', text: 'out' }] }],
  timers: [{ turns: 40, do: [{ type: 'lose', text: 'The sea takes you.' }] }]
};
check('a lose that only a timer can reach still counts as stakes',
  !audit(timed).findings.some(f => f.code === 'W505'),
  (audit(timed).findings.find(f => f.code === 'W505') || {}).msg || 'no W505');


// A rule that succeeds and says nothing looks, to a player, exactly like a
// command the game did not understand. Found by playing a freshly built game
// rather than by testing it: "unlock gate" opened the way and printed a blank
// line.
const silentRule = {
  meta: { start: 'A' },
  rooms: [{ id: 'A', exits: [] }],
  items: [{ id: 'GATE', location: 'A', attributes: {} }],
  rules: [
    { on: { verb: 'UNLOCK', noun: 'GATE' }, do: [{ type: 'set-flag', flag: 'open' }] },
    { on: { verb: 'WAIT' }, do: [{ type: 'print', text: 'Time passes.' },
                                 { type: 'win', text: 'done' }] }
  ]
};
check('a player-triggered rule that prints nothing is flagged',
  audit(silentRule).findings.some(f => f.code === 'W508'),
  (audit(silentRule).findings.find(f => f.code === 'W508') || {}).hint || 'not flagged');

// Machinery without a verb is not player-facing and must not be nagged about.
const machinery = {
  meta: { start: 'A' },
  rooms: [{ id: 'A', exits: [] }],
  items: [],
  rules: [{ on: {}, do: [{ type: 'set-flag', flag: 'x' }] },
          { on: { verb: 'WAIT' }, do: [{ type: 'print', text: 'ok' }, { type: 'win', text: 'd' }] }],
  timers: [{ turns: 5, do: [{ type: 'set-flag', flag: 'y' }] }]
};
check('a rule with no verb, and a timer, are not flagged as silent',
  !audit(machinery).findings.some(f => f.code === 'W508'));


// A death scene is not silence. Counting print effects alone reported five
// working death rules as saying nothing, and the author added redundant prose in
// front of each purely to quiet it, which made the writing worse.
const deadly = {
  meta: { start: 'A' }, rooms: [{ id: 'A', exits: [] }],
  items: [{ id: 'OGRE', location: 'A', attributes: {} }],
  rules: [{ on: { verb: 'HIT', noun: 'OGRE' },
            do: [{ type: 'lose', text: 'He eats you, boots and all.' }] },
          { on: { verb: 'USE', noun: 'OGRE' },
            do: [{ type: 'print', text: 'ok' }, { type: 'win', text: 'd' }] }]
};
check('a rule whose only output is lose text is not called silent',
  !audit(deadly).findings.some(f => f.code === 'W508'),
  (audit(deadly).findings.find(f => f.code === 'W508') || {}).msg || 'not flagged');

// Verbs the player cannot click. This project's own worked example failed it.
const offgrid = {
  meta: { start: 'A' }, rooms: [{ id: 'A', exits: [] }],
  items: [{ id: 'DOOR', location: 'A', attributes: {} }],
  rules: [{ on: { verb: 'UNLOCK', noun: 'DOOR' },
            do: [{ type: 'print', text: 'click' }, { type: 'win', text: 'd' }] }]
};
check('a verb that is not on the grid is flagged',
  audit(offgrid).findings.some(f => f.code === 'W509'),
  (audit(offgrid).findings.find(f => f.code === 'W509') || {}).msg || 'not flagged');

const ongrid = JSON.parse(JSON.stringify(offgrid));
ongrid.rules[0].on.verb = 'USE';
check('the same rule on USE is not flagged',
  !audit(ongrid).findings.some(f => f.code === 'W509'));


// The other half of the same fix: a world full of flavour responses is textured,
// not load-bearing, and must not be told it is a shopping list.
const textured = cellar();
for (let i = 0; i < 6; i++) {
  textured.items.push({ id: 'PROP' + i, name: 'prop', location: 'HALL', attributes: {} });
  textured.rules.push({ on: { verb: 'USE', noun: 'PROP' + i },
    do: [{ type: 'print', text: 'Nothing turns on it.' }] });
}
check('flavour responses do not make a world read as a shopping list',
  !audit(textured).findings.some(f => f.code === 'W507'),
  audit(textured).metrics.itemParticipation + '% participate');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
