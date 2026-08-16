#!/usr/bin/env node
/* eslint-disable no-console */
//
//  .folio round-trip — the load-bearing test of the whole project.
//
//  Builds a .folio from staged files, reads it back with integrity checking, boots
//  it through a logic backend, and plays real commands out of the walkthrough that
//  ships inside it. If this passes, a Folio game is genuinely a single portable
//  file: no origin project, no globals, no script tags, nothing outside the file.
//
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pack, load } = require('../pack.js');
const { createBackend } = require('../../zmachine/index.js');
const origin = require('../../../conformance/origin.js');

if (!origin.available()) origin.skip('.folio round-trip test (needs a story file)');

const ORIGIN = process.env.FOLIO_ORIGIN ||
  path.join(process.env.HOME, 'projects-games', 'zork1');

let failed = 0;
function check(label, cond, detail) {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail === undefined ? '' : '  -- ' + detail));
  if (!cond) failed++;
}

// ---------------------------------------------------------------- stage
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-'));
fs.mkdirSync(path.join(dir, 'logic'));
fs.mkdirSync(path.join(dir, 'presentation'));

const storySrc = fs.readFileSync(path.join(ORIGIN, 'data', 'story.js'), 'utf8');
const b64 = storySrc.match(/["']([A-Za-z0-9+/=]{2000,})["']/);
if (!b64) { console.error('origin story payload not found'); process.exit(2); }
fs.writeFileSync(path.join(dir, 'logic', 'game.z3'), Buffer.from(b64[1], 'base64'));

const ns = {}; const sb = { GUE: ns }; sb.window = sb;
new Function('window', 'globalThis', 'global', 'GUE', 'module',
  fs.readFileSync(path.join(ORIGIN, 'data', 'roommap.js'), 'utf8'))(sb, sb, sb, ns, undefined);
fs.writeFileSync(path.join(dir, 'presentation', 'roommap.json'), JSON.stringify({
  ROOMMAP: ns.ROOMMAP, OBJMAP: ns.OBJMAP, ADVENTURER: ns.ADVENTURER,
  ATTR: ns.ATTR, DIRPROP: ns.DIRPROP, EXIT_HAS_ROOM: ns.EXIT_HAS_ROOM
}));

fs.copyFileSync(path.join(ORIGIN, 'test', 'walkthrough-350.txt'),
  path.join(dir, 'walkthrough.folioscript'));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
  id: 'zork-1', title: 'ZORK I: The Great Underground Empire', author: 'Infocom',
  folioVersion: '0.1.0', logicType: 'zmachine', license: 'MIT',
  contentRating: 'all-ages', capabilities: ['darkness', 'timed-events', 'combat'],
  aiDisclosure: { prose: 'none', art: 'none' }
}));

// ---------------------------------------------------------------- pack
const buf = pack(dir);
check('packs to a single file', buf.length > 80000, buf.length.toLocaleString() + ' bytes');

// ---------------------------------------------------------------- integrity
const game = load(buf);
check('reads back with integrity verified', !!game.manifest);
check('manifest carries the mandatory fields',
  game.manifest.license && game.manifest.contentRating && game.manifest.folioVersion,
  game.manifest.license + ' / ' + game.manifest.contentRating);

// Corrupting one byte of the story must be caught, or checksums are decoration.
const tampered = Buffer.from(buf);
const at = tampered.indexOf(Buffer.from('logic/game.z3')) + 200;
tampered[at] = tampered[at] ^ 0xFF;
let caught = '';
try { load(tampered); } catch (e) { caught = e.message; }
check('a tampered entry is rejected', /checksum|corrupt|inflate|invalid/i.test(caught),
  caught.slice(0, 48) || 'NOT CAUGHT');

// ---------------------------------------------------------------- play it
const rm = JSON.parse(game.files['presentation/roommap.json'].toString('utf8'));
const be = createBackend(game.files['logic/game.z3'], { roommap: rm, seed: 1234 });
check('boots from the container alone', /ZORK I/.test(be.banner || ''));

const s0 = be.state();
check('opens at the expected room', s0.roomId === 'WEST-OF-HOUSE', s0.roomId);

const cmds = game.walkthrough.split('\n')
  .map(l => l.split('#')[0].trim()).filter(Boolean).slice(0, 8);
for (const c of cmds) be.zm.input(c);
const s1 = be.state();
check('plays its own bundled walkthrough', s1.moves >= 8, cmds.join(' / '));
check('scores through the container', s1.score > 0,
  'score ' + s1.score + ' carrying ' + s1.inventory.join(','));

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
process.exit(failed ? 1 : 0);
