#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Reading an authoring session back.
//
//  The suite proves the engine is correct. It says nothing about whether building
//  a game with it is bearable, and those fail differently: a bad error message is
//  a passing test. So this reads a FOLIO_TRACE log and answers the questions that
//  only show up across a whole session.
//
//  The number that matters most is repeats. A finding code that appears once
//  taught somebody something. The same code appearing four times means the message
//  did not, and that is a docs or wording defect hiding inside a green run.
//
//  Usage:  FOLIO_TRACE=run.jsonl <do the work>
//          node tools/trace-report.js run.jsonl
//
'use strict';

const fs = require('fs');
const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m',
  green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' };

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('usage: trace-report.js <trace.jsonl>');
  process.exit(1);
}

const events = fs.readFileSync(file, 'utf8').split('\n')
  .filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
  .filter(Boolean);

if (!events.length) {
  console.log('nothing recorded. Was FOLIO_TRACE set for the run?');
  process.exit(0);
}

// Wall clock across the whole session, which may span many processes.
const stamps = events.map(e => e.at).filter(Boolean);
const dur = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0]
  : events[events.length - 1].ms;
console.log('\n=== ' + C.bold + 'authoring session' + C.off + ' ===\n');
// Tool time, not human time: the clock starts at the first call, so thinking,
// typing and reading are not in here. A session that reads as 138ms took a person
// considerably longer, and that is the right thing to measure — the tools should
// never be the slow part.
const human = dur > 60000 ? Math.round(dur / 60000) + ' min'
  : dur >= 1000 ? (dur / 1000).toFixed(1) + 's'
  : dur + 'ms';
console.log('  ' + events.length + ' calls, ' + human + ' of tool time');

// ---------------------------------------------------------------- what ran
const byName = new Map();
for (const e of events) {
  if (e.kind === 'note') continue;
  const k = e.name;
  const r = byName.get(k) || { n: 0, ms: 0, threw: 0 };
  r.n++; r.ms += e.took || 0; if (e.threw) r.threw++;
  byName.set(k, r);
}
console.log('\n  ' + C.bold + 'calls' + C.off);
for (const [name, r] of [...byName].sort((a, b) => b[1].n - a[1].n)) {
  console.log('    ' + String(r.n).padStart(3) + '  ' + name.padEnd(22) +
    C.dim + (r.ms ? r.ms + 'ms total' : '') +
    (r.threw ? C.red + '  ' + r.threw + ' threw' + C.off : '') + C.off);
}

// -------------------------------------------------------------- iteration
// How many checks it took to get clean. This is the friction number: it should
// fall when the docs, the schema or the messages get better.
const checks = events.filter(e => /validate/.test(e.name));
const firstClean = checks.findIndex(e => e.ok === true || e.errors === 0);
console.log('\n  ' + C.bold + 'iteration' + C.off);
console.log('    ' + checks.length + ' checks run');
console.log('    ' + (firstClean < 0 ? C.red + 'never came back clean' + C.off
  : firstClean === 0 ? C.green + 'clean on the first try' + C.off
  : firstClean + ' failed check' + (firstClean > 1 ? 's' : '') + ' before the first clean one'));

// ---------------------------------------------------------------- findings
const seen = new Map();
const seenErr = new Map();
for (const e of events) {
  for (const code of (e.codes || [])) seen.set(code, (seen.get(code) || 0) + 1);
  for (const code of (e.errorCodes || [])) seenErr.set(code, (seenErr.get(code) || 0) + 1);
}
if (seen.size) {
  console.log('\n  ' + C.bold + 'findings encountered' + C.off);
  const rows = [...seen].sort((a, b) => b[1] - a[1]);
  for (const [code, n] of rows) {
    const errN = seenErr.get(code) || 0;
    const stuck = errN > 2;
    console.log('    ' + (stuck ? C.yellow : C.dim) + String(n).padStart(3) + '×' + C.off +
      '  ' + code + (errN ? C.dim + '  (' + errN + ' as an error)' + C.off : '') +
      (stuck ? C.yellow + '   still failing after ' + errN + ' attempts' + C.off : ''));
  }
  // Only repeated ERRORS count as a wording problem. A warning seen five times is
  // usually somebody who read it and decided otherwise, which is the system
  // working rather than failing.
  const stuck = [...seenErr].filter(([, n]) => n > 2);
  if (stuck.length) {
    console.log('\n    ' + C.yellow + 'Worth rewording: ' + stuck.map(r => r[0]).join(', ') + C.off);
    console.log('    ' + C.dim + 'An error that had to be read three times did not say enough ' +
      'the first time.' + C.off);
  } else {
    console.log('\n    ' + C.dim + 'No error had to be read more than twice.' + C.off);
  }
}

// ------------------------------------------------------------------ stages
const notes = events.filter(e => e.kind === 'note');
if (notes.length) {
  console.log('\n  ' + C.bold + 'stages' + C.off);
  for (let i = 0; i < notes.length; i++) {
    const span = (i + 1 < notes.length ? notes[i + 1].ms : dur) - notes[i].ms;
    console.log('    ' + notes[i].name.padEnd(34) + C.dim +
      Math.round(span / 1000) + 's' + C.off);
  }
}

// ------------------------------------------------------------------ faults
const threw = events.filter(e => e.threw);
if (threw.length) {
  console.log('\n  ' + C.red + C.bold + 'threw' + C.off);
  for (const e of threw) console.log('    ' + e.name + '  ' + C.dim + e.threw + C.off);
}

console.log('');
