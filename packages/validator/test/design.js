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
const shoppingList = cellar();
for (let i = 0; i < 6; i++) {
  shoppingList.items.push({ id: 'GEM' + i, name: 'gem', location: 'HALL',
    attributes: { TAKEBIT: true } });
  shoppingList.rules.push({ on: { verb: 'RUB', noun: 'GEM' + i },
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

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
