//  Does the published schema still describe the engine that exists?
//
//  A schema nobody checks is a lie with a version number on it. The vocabularies
//  live in two places now: the switch statements in @folio/world, which decide
//  what actually happens, and world.schema.json, which is what other people's
//  tools and other people's models are told to trust. If those drift, an author
//  gets a green schema check and a game that silently does nothing.
//
//  So the interesting assertions here are not "the example validates". They are
//  "the schema's condition list is EXACTLY the interpreter's condition list", read
//  out of the source rather than copied.

'use strict';

const fs = require('fs');
const path = require('path');
const { validateWorld, vocabulary } = require('../schema.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

console.log('\n=== \x1b[1mthe world schema\x1b[0m ===\n');

const vocab = vocabulary();

// ---------------------------------------------------------------- no drift
// Pull the real vocabularies out of the interpreter's switch statements. If
// somebody adds an effect and forgets the schema, this is what says so.
const worldSrc = fs.readFileSync(path.join(__dirname, '../../world/index.js'), 'utf8');
const casesIn = (fnName) => {
  const start = worldSrc.indexOf(fnName);
  if (start < 0) return [];
  // Read to the end of that function's switch block, which is the next line that
  // closes at the method's indentation.
  const body = worldSrc.slice(start, worldSrc.indexOf('\n  }\n', start));
  return [...body.matchAll(/case '([a-z-]+)':/g)].map(m => m[1]);
};

const implConditions = casesIn('test(c) {');
const implEffects = casesIn('apply(effects) {');

const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

ok('schema conditions are exactly the interpreter\'s conditions',
  same(vocab.conditions, implConditions),
  vocab.conditions.length + ' in schema, ' + implConditions.length + ' in @folio/world' +
  (same(vocab.conditions, implConditions) ? '' :
    ' | only in schema: ' + vocab.conditions.filter(c => !implConditions.includes(c)) +
    ' | only in engine: ' + implConditions.filter(c => !vocab.conditions.includes(c))));

ok('schema effects are exactly the interpreter\'s effects',
  same(vocab.effects, implEffects),
  vocab.effects.length + ' in schema, ' + implEffects.length + ' in @folio/world' +
  (same(vocab.effects, implEffects) ? '' :
    ' | only in schema: ' + vocab.effects.filter(c => !implEffects.includes(c)) +
    ' | only in engine: ' + implEffects.filter(c => !vocab.effects.includes(c))));

const implDirs = (worldSrc.match(/const DIRS = \[([^\]]+)\]/) || [])[1] || '';
ok('schema directions match the interpreter\'s',
  same(vocab.directions, implDirs.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean)),
  vocab.directions.length + ' directions');

// The tone overrides are read as tone.<key> in builtin(), and once as
// defaults.dark in describe(). Both spellings count, or the schema gets blamed
// for a key the engine really does speak.
const toneKeys = [...new Set(
  [...worldSrc.matchAll(/(?:tone|defaults)\.([A-Za-z]+)/g)].map(m => m[1])
)];
const missingTone = toneKeys.filter(k => !vocab.defaults.includes(k));
const extraTone = vocab.defaults.filter(k => !toneKeys.includes(k));
ok('schema meta.defaults covers every override the engine reads',
  missingTone.length === 0 && extraTone.length === 0,
  vocab.defaults.length + ' keys' +
  (missingTone.length ? ' | missing: ' + missingTone.join(',') : '') +
  (extraTone.length ? ' | unused: ' + extraTone.join(',') : ''));

// ------------------------------------------------------- the shipped example
const example = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../../conformance/cellar-door/logic/world.json'), 'utf8'));
const r = validateWorld(example);
ok('the worked example validates against the schema', r.ok,
  r.ok ? '' : r.errors.slice(0, 3).map(e => e.path + ': ' + e.msg).join(' | '));

// -------------------------------------------------------------- it catches
const base = () => JSON.parse(JSON.stringify(example));
const rejects = (label, mutate, expectPath) => {
  const w = base();
  mutate(w);
  const res = validateWorld(w);
  const hit = res.errors.some(e => !expectPath || e.path.indexOf(expectPath) >= 0);
  ok(label, !res.ok && hit,
    res.ok ? 'accepted it' : res.errors[0].path + ': ' + res.errors[0].msg);
};

rejects('a missing meta.start', w => { delete w.meta.start; }, 'meta');
rejects('a room with no id', w => { delete w.rooms[0].id; }, 'rooms[0]');
rejects('a misspelled direction', w => { w.rooms[0].exits[0].dir = 'NORTHWEST'; }, 'dir');
rejects('an unknown condition type',
  w => { w.rules[0].if[0] = { type: 'holding', item: 'KEY' }; }, 'if[0]');
rejects('an unknown effect type',
  w => { w.rules[0].do[0] = { type: 'teleport', room: 'CELLAR' }; }, 'do[0]');
rejects('a condition missing its operand',
  w => { w.rules[0].if[0] = { type: 'carrying' }; }, 'if[0]');
rejects('a stray field nobody reads',
  w => { w.rooms[0].descriptoin = 'typo'; }, 'descriptoin');
rejects('a fuel value that is not a number',
  w => { w.items[1].fuel = 'forty'; }, 'fuel');
rejects('an effect list that is empty', w => { w.rules[0].do = []; }, 'do');

// A discriminated union has to produce a useful message, not "matched none of 14".
const bad = base();
bad.rules[0].do[0] = { type: 'print' };            // print with no text
const msg = validateWorld(bad).errors[0];
ok('a wrong field in a known effect names that effect, not all fourteen',
  /is missing "text"/.test(msg.msg), msg.path + ': ' + msg.msg);

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
