//  Every shipped example still packs, validates and completes.
//
//  Two fixtures, on purpose. One of them was written the way the engine's author
//  would write it; the other was written from the published spec by somebody
//  working only from llms.txt, deliberately reaching for the parts of the
//  vocabulary the first one never touches: an actor you have to deal with, a
//  container you have to open, a timer that can kill you, and two verbs with no
//  built-in behaviour at all.
//
//  That second exercise is worth repeating whenever the format changes. It found
//  three real defects the first time it was run, including one that rejected every
//  game containing a character.

'use strict';

const fs = require('fs');
const path = require('path');
const { pack, load } = require('../packages/format/pack.js');
const { validate } = require('../packages/validator/index.js');
const { validateWorld } = require('../packages/format/schema.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

const FIXTURES = [
  { dir: 'cellar-door', covers: 'darkness, a locked door, fuel' },
  { dir: 'lighthouse', covers: 'an actor, a container, a killing timer, verbs with no built-in' }
];

console.log('\n=== \x1b[1mshipped fixtures\x1b[0m ===\n');

for (const f of FIXTURES) {
  const dir = path.join(__dirname, f.dir);
  console.log('  \x1b[2m' + f.dir + ' — ' + f.covers + '\x1b[0m');

  let buf = null;
  try { buf = pack(dir); } catch (e) {
    ok(f.dir + ' packs', false, e.message);
    continue;
  }
  ok('packs', true, buf.length.toLocaleString() + ' bytes');

  const game = load(buf);
  ok('survives a checksum-verified round trip', !!game.manifest.id);

  const world = JSON.parse(game.files['logic/world.json'].toString('utf8'));
  const shape = validateWorld(world);
  ok('matches the published schema', shape.ok,
    shape.ok ? '' : shape.errors.slice(0, 2).map(e => e.path + ' ' + e.msg).join(' | '));

  const r = validate(game);
  ok('validates without errors', r.ok,
    r.findings.filter(x => x.level === 'error').map(x => x.code + ' ' + x.msg).join(' | '));
  ok('reaches at least "playable"', r.tier === 'playable' || r.tier === 'certified',
    'tier=' + r.tier + ', ran ' + r.ran.join('+'));
  ok('the walkthrough actually wins', !!(r.stats && r.stats.won),
    r.stats ? r.stats.moves + ' moves, ' + r.stats.score + ' points, ' +
      r.stats.roomCoverage + '% of rooms seen' : 'no stats');
  console.log('');
}

console.log((fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
