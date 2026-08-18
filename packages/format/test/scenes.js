//  The scene scaffold.
//
//  The thing it has to get right is the hotspots, because they are the part that
//  makes a game playable and the part that silently disagrees with everything
//  else. They have to match the world's item ids, the room's exits, and the
//  picture, and a mismatch is invisible until somebody clicks the wrong thing.
//  Generating them from the world is what makes that impossible.
//
//  It also has to emit code that runs. A scaffold that produces a syntax error,
//  or calls a primitive that does not exist, or names a colour that is not in the
//  palette, wastes exactly the time it was meant to save.

'use strict';

const fs = require('fs');
const path = require('path');
const { scaffold, backdropFor, objectRects } = require('../scenes.js');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
    (detail ? '  \x1b[2m-- ' + detail + '\x1b[0m' : ''));
  cond ? pass++ : fail++;
};

console.log('\n=== \x1b[1mthe scene scaffold\x1b[0m ===\n');

const WORLD = require('../../../conformance/lighthouse/logic/world.json');
const out = scaffold(WORLD);

ok('it writes a scene for every room', out.rooms === WORLD.rooms.length,
  out.rooms + ' of ' + WORLD.rooms.length);

// ---- does it run? ---------------------------------------------------------
// Evaluated against a stub kit that records what was asked for, so a call to a
// primitive that does not exist, or a colour that is not in the palette, fails
// here rather than as a blank pane in front of a player.
const kitSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'engine', 'vendor', 'kit.js'), 'utf8');
const root = { };
root.window = root;
new Function('window', 'globalThis', 'GUE', kitSrc)(root, root, root.GUE = {});
const KIT = root.GUE.kit;
ok('the engine kit loads', !!KIT && typeof KIT.sky === 'function');

const calls = [];
const stubKit = { PAL: KIT.PAL, SCENE_W: 144, SCENE_H: 104 };
for (const name of Object.keys(KIT)) {
  if (typeof KIT[name] !== 'function') continue;
  stubKit[name] = function () { calls.push(name); };
}
const page = { GUE: { kit: stubKit } };
page.window = page;

let threw = null;
try { new Function('window', 'globalThis', out.source)(page, page); }
catch (e) { threw = e; }
ok('the scaffold it writes is valid JavaScript', !threw, threw && threw.message);

const scenes = page.GUE.scenes || {};
ok('and installs every room', Object.keys(scenes).length === WORLD.rooms.length,
  Object.keys(scenes).join(', ').slice(0, 60));

// Draw them all, so an unknown primitive or a mistyped colour surfaces now.
const ctx = {};
let drewOk = true, drawErr = '';
for (const id of Object.keys(scenes)) {
  try { scenes[id].draw(ctx, { roomId: id }, 0); }
  catch (e) { drewOk = false; drawErr = id + ': ' + e.message; break; }
}
ok('every scene draws without throwing', drewOk, drawErr);
ok('and every one of them actually paints something', calls.length >= Object.keys(scenes).length,
  calls.length + ' kit calls');

// Every colour it names has to exist. K.PAL.white would draw with undefined and
// show nothing, which is the sort of bug that survives a screenshot.
const named = [...new Set((out.source.match(/K\.PAL\.[A-Za-z_]+/g) || [])
  .map(s => s.slice(6)))];
const bad = named.filter(n => KIT.PAL[n] === undefined);
ok('every palette colour it names exists', bad.length === 0,
  bad.length ? 'missing: ' + bad.join(', ') : named.join(', '));

// ---- the hotspots, which are the point ------------------------------------
const ids = new Set((WORLD.items || []).map(i => i.id)
  .concat((WORLD.actors || []).map(a => a.id)));
let everyObjReal = true, everyThingPlaced = true, inBounds = true;

for (const room of WORLD.rooms) {
  const spots = scenes[room.id].hotspots({ roomId: room.id });
  const objs = spots.filter(h => h.obj).map(h => h.obj);
  for (const o of objs) if (!ids.has(o)) everyObjReal = false;

  // Everything the world puts in this room has to be reachable in the picture.
  const here = (WORLD.items || []).filter(i => i.location === room.id).map(i => i.id)
    .concat((WORLD.actors || []).filter(a => a.location === room.id).map(a => a.id));
  for (const t of here) if (objs.indexOf(t) < 0) everyThingPlaced = false;

  for (const h of spots) {
    if (h.x < 0 || h.y < 0 || h.x + h.w > 144 || h.y + h.h > 104) inBounds = false;
  }

  // An exit on the compass and an exit in the picture have to be the same set,
  // or the two halves of the interface disagree about the map.
  const drawnDirs = spots.filter(h => h.dir).map(h => h.dir).sort();
  const realDirs = (room.exits || []).map(e => e.dir).sort();
  if (drawnDirs.join() !== realDirs.join()) everyThingPlaced = false;
}
ok('every hotspot names a thing that exists in the world', everyObjReal);
ok('everything in a room is clickable, and every exit is drawn', everyThingPlaced);
ok('no hotspot falls outside the 144x104 pane', inBounds);

// ---- the backdrop guess ---------------------------------------------------
ok('a cave reads as a cave',
  backdropFor({ prose: 'A low tunnel of wet rock.' }).name === 'cave');
ok('a shore reads as water',
  backdropFor({ prose: 'The lake laps at the shore.' }).name === 'water');
ok('a kitchen reads as an interior',
  backdropFor({ name: 'The Kitchen', prose: 'Cold flags underfoot.' }).name === 'interior');
ok('something it cannot place still gets a backdrop',
  backdropFor({ prose: 'Indescribable.' }).name === 'plain');

ok('objects are laid out without overlapping', (() => {
  const r = objectRects([1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: 'I' + n })));
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
    }
  }
  return true;
})());

console.log('\n' + (fail ? '\x1b[31m' + fail + ' failed\x1b[0m, ' : '') +
  '\x1b[32m' + pass + ' passed\x1b[0m\n');
process.exit(fail ? 1 : 0);
