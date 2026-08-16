//  Locating a Z-machine story to test Path A against.
//
//  Folio ships NO GAME DATA — the same posture ScummVM has held for twenty years,
//  and the reason it survived a cease-and-desist that a less careful project would
//  not have. So the Path A tests need a story file supplied from outside, and must
//  skip cleanly when there isn't one rather than failing.
//
//  Skipping loudly matters. A suite that silently reports success while quietly
//  testing half of what it claims is worse than one that fails, because nobody
//  investigates a green run.

'use strict';

const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.FOLIO_ORIGIN ||
  path.join(process.env.HOME || '', 'projects-games', 'zork1');

function available() {
  try {
    return fs.existsSync(path.join(ORIGIN, 'data', 'story.js')) &&
           fs.existsSync(path.join(ORIGIN, 'data', 'roommap.js'));
  } catch (e) { return false; }
}

/** Exit 0 with an explanation. Used by suites that are entirely Path A. */
function skip(what) {
  console.log('\x1b[33mSKIPPED\x1b[0m  ' + what);
  console.log('  No Z-machine story available. Folio ships no game data, so Path A');
  console.log('  tests need one supplied: set FOLIO_ORIGIN to a checkout containing');
  console.log('  data/story.js and data/roommap.js.');
  process.exit(0);
}

function storyBytes() {
  const src = fs.readFileSync(path.join(ORIGIN, 'data', 'story.js'), 'utf8');
  const m = src.match(/["']([A-Za-z0-9+/=]{2000,})["']/);
  if (!m) throw new Error('no base64 story payload found');
  return Buffer.from(m[1], 'base64');
}

function roommap() {
  const ns = {};
  const sandbox = { GUE: ns };
  sandbox.window = sandbox;
  const src = fs.readFileSync(path.join(ORIGIN, 'data', 'roommap.js'), 'utf8');
  new Function('window', 'globalThis', 'global', 'GUE', 'module', src)(
    sandbox, sandbox, sandbox, ns, undefined);
  return {
    ROOMMAP: ns.ROOMMAP, OBJMAP: ns.OBJMAP, ADVENTURER: ns.ADVENTURER,
    ATTR: ns.ATTR, DIRPROP: ns.DIRPROP, EXIT_HAS_ROOM: ns.EXIT_HAS_ROOM
  };
}

module.exports = { ORIGIN, available, skip, storyBytes, roommap };
