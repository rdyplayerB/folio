//  Recording what it is like to actually build a game with this.
//
//  Not a debug log. A debug log tells you what crashed, and crashes are the easy
//  problems: they announce themselves. What is invisible is friction — the check
//  that had to be run eleven times, the error message that had to be read twice
//  because it did not teach anything the first time, the step the tooling
//  recommended that turned out to be the wrong one.
//
//  Those are the things that decide whether somebody finishes a game or gives up,
//  and none of them show up in a test suite, because every one of them is a
//  success as far as the code is concerned.
//
//  So this records the shape of a session: what was called, in what order, what
//  came back, and how long it took. tools/trace-report.js reads it back and
//  answers the questions worth asking. Same idea as the corpus profiler, pointed
//  at the authoring process instead of at a finished game.
//
//  Off unless FOLIO_TRACE names a file. Nothing is recorded by default and no
//  world content is ever written out, only its shape.

'use strict';

const fs = require('fs');
const path = require('path');

const FILE = process.env.FOLIO_TRACE || null;
const started = Date.now();
let n = 0;

/** A compact, content-free description of whatever was passed in. */
function shapeOf(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return { n: v.length };
  if (typeof v === 'string') return { chars: v.length, lines: v.split('\n').length };
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      out[k] = Array.isArray(x) ? x.length
        : typeof x === 'string' ? x.length
        : typeof x === 'object' && x ? Object.keys(x).length
        : x;
    }
    return out;
  }
  return v;
}

/**
 * Record one event.
 * @param {string} kind   'tool' | 'cli' | 'note'
 * @param {string} name   what was called
 * @param {object} detail anything worth keeping, kept small
 */
function record(kind, name, detail) {
  if (!FILE) return;
  // An absolute stamp as well as the offset. Each CLI invocation is its own
  // process, so ms-since-start resets every call and a session spanning several
  // commands appeared to take no time at all.
  const line = JSON.stringify(Object.assign({
    i: ++n,
    at: Date.now(),
    ms: Date.now() - started,
    kind,
    name
  }, detail || {}));
  try {
    fs.mkdirSync(path.dirname(path.resolve(FILE)), { recursive: true });
    fs.appendFileSync(FILE, line + '\n');
  } catch (e) { /* tracing must never be the thing that breaks a run */ }
}

/** Wrap a call so its duration, result and any findings are recorded. */
function around(kind, name, args, fn) {
  if (!FILE) return fn();
  const t0 = Date.now();
  let out, threw = null;
  try { out = fn(); }
  catch (e) { threw = e; }
  const detail = { args: shapeOf(args), took: Date.now() - t0 };
  if (threw) detail.threw = threw.message;
  else if (out && typeof out === 'object') {
    // Findings are the interesting part: which codes appeared, and how often the
    // same one had to appear again before it was understood.
    const f = out.findings || (out.report && out.report.findings);
    if (Array.isArray(f)) {
      detail.codes = f.map(x => x.code).filter(Boolean);
      // Errors kept apart from warnings on purpose. Seeing the same ERROR again
      // means the author could not act on it, which is a message defect. Seeing
      // the same warning again usually means they read it and chose otherwise,
      // which is not a defect at all.
      detail.errorCodes = f.filter(x => x.level === 'error').map(x => x.code);
      detail.errors = detail.errorCodes.length;
    }
    if (out.tier) detail.tier = out.tier;
    if (out.ok !== undefined) detail.ok = out.ok;
  }
  record(kind, name, detail);
  if (threw) throw threw;
  return out;
}

/** A free-text marker, for stage boundaries in a scripted run. */
const note = (text, detail) => record('note', text, detail);

module.exports = { record, around, note, enabled: !!FILE, file: FILE };
