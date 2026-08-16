#!/usr/bin/env node
/* eslint-disable no-console */
//
//  @folio/zmachine smoke test — proves the extracted package boots a real story
//  file and emits the World State Contract *without* any of the origin project's
//  globals, script tags, or file layout. If this passes, the interpreter is
//  genuinely portable and the .folio loader has something real to build on.
//
'use strict';

const fs = require('fs');
const path = require('path');
const { createBackend } = require('../index.js');

const ORIGIN = process.env.FOLIO_ORIGIN ||
  path.join(process.env.HOME, 'projects-games', 'zork1');

// Pull the story bytes out of the origin's global-attachment data file. A real
// .folio would hand us logic/game.z3 directly; this keeps the smoke test honest
// while the packaging work is still in flight.
function storyBytes() {
  const src = fs.readFileSync(path.join(ORIGIN, 'data', 'story.js'), 'utf8');
  const m = src.match(/["']([A-Za-z0-9+/=]{2000,})["']/);
  if (!m) throw new Error('no base64 story payload found in data/story.js');
  return Buffer.from(m[1], 'base64');
}

// Same for the presentation binding, which in a .folio is presentation/roommap.json.
function roommap() {
  const ns = {};
  const sandbox = { GUE: ns };
  sandbox.window = sandbox;
  const src = fs.readFileSync(path.join(ORIGIN, 'data', 'roommap.js'), 'utf8');
  new Function('window', 'globalThis', 'global', 'GUE', 'module', src)(
    sandbox, sandbox, sandbox, ns, undefined);
  return ns;
}

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}

const bytes = storyBytes();
check('story file loads', bytes.length > 80000, bytes.length + ' bytes');

const game = createBackend(bytes, { roommap: roommap(), seed: 1234 });
check('backend constructs with injected roommap', !!game.zm);
check('game is started, not merely loaded', /West of House|WEST OF HOUSE/i.test(game.banner || ''),
  String(game.banner || '').split('\n').filter(Boolean)[0]);

const s0 = game.state();
check('contract: roomId is a stable string', typeof s0.roomId === 'string', s0.roomId);
check('contract: score and moves are numbers',
  typeof s0.score === 'number' && typeof s0.moves === 'number',
  's=' + s0.score + ' m=' + s0.moves);
check('contract: objects is an array', Array.isArray(s0.objects), s0.objects.join(','));
check('contract: exits are live, keyed by direction',
  s0.exits && typeof s0.exits === 'object' && !Array.isArray(s0.exits),
  Object.keys(s0.exits).join(' '));
check('contract: dark is a boolean', typeof s0.dark === 'boolean', String(s0.dark));

// The rejection path matters as much as the happy path: a caller who forgets the
// presentation binding should get a sentence explaining the architecture, not a
// stack trace from three files away.
let threw = '';
try { createBackend(bytes, {}); } catch (e) { threw = e.message; }
check('missing roommap fails with an explanatory error',
  /roommap is required/.test(threw), threw.slice(0, 60) + '…');

console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
