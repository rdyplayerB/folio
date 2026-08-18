#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Zork, translated into a Folio world — as far as it goes.
//
//  This is a measuring instrument, not an importer. It takes the machine-readable
//  extraction of Zork's world from its ZIL source and re-expresses it using only
//  what the format can say. Everything it cannot express it refuses to guess at:
//  it records a gap and carries on.
//
//  The output is therefore two things, and the second is the valuable one:
//
//    a world.json   openable in the editor, so the map of a real game can be
//                   looked at rather than imagined
//    a gap report   what the format still cannot hold, counted, in the order a
//                   finished game actually needed it
//
//  What it emits is not a playable Zork and never will be. The prose is not ours
//  to redistribute, and 39 of the 72 routines it cannot translate are the thief,
//  the troll and the cyclops. The point is the count.
//
//  Usage:  node tools/zork-to-world.js [--out world.json]
//
'use strict';

const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.FOLIO_ORIGIN ||
  path.join(process.env.HOME || '', 'projects-games', 'zork1');
const SOURCE = path.join(ORIGIN, 'data', 'zork1_world.json');

if (!fs.existsSync(SOURCE)) {
  console.log('\x1b[33mSKIPPED\x1b[0m  no Zork world description available.');
  console.log('  This reads data/zork1_world.json from the origin checkout. Folio ships');
  console.log('  no game data, so point FOLIO_ORIGIN at a checkout that has it.');
  process.exit(0);
}

const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const rooms = Object.values(src.rooms);
const objects = Object.values(src.objects);

// Gaps are counted by kind, with an example, so the report reads as a backlog
// rather than as a list of complaints.
const gaps = new Map();
function gap(kind, detail) {
  const g = gaps.get(kind) || { n: 0, eg: [] };
  g.n++;
  if (g.eg.length < 3) g.eg.push(detail);
  gaps.set(kind, g);
}

const unquote = (s) => String(s || '').replace(/^"/, '').replace(/"$/, '').trim();
const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW',
  'UP', 'DOWN', 'IN', 'OUT'];

// ZIL's flags, and the ones the engine understands. The rest travel through as
// attributes, which the presentation layer may read and the logic ignores.
const FLAGMAP = {
  TAKEBIT: 'TAKEBIT', CONTBIT: 'CONTBIT', OPENBIT: 'OPENBIT',
  TRANSBIT: 'TRANSPARENT', ONBIT: 'ONBIT', LIGHTBIT: 'LIGHTSOURCE'
};

const roomIds = new Set(rooms.map(r => r.name));

// ------------------------------------------------------------------- rooms
const outRooms = [];
for (const r of rooms) {
  const room = { id: r.name, name: titleOf(r), exits: [] };
  const desc = unquote((r.props || {}).LDESC || (r.props || {}).DESC);
  if (desc) room.prose = desc;
  if (!(r.props || {}).RLANDBIT && (r.props || {}).FLAGS &&
      /ONBIT/.test(r.props.FLAGS) === false) {
    // A room without ONBIT is dark. Zork says this by omission, which is the
    // opposite of how the format says it.
    room.dark = true;
  }
  if ((r.props || {}).ACTION) {
    gap('a room that runs its own code', r.name + ' → ' + r.props.ACTION);
  }

  for (const dir of Object.keys(r.exits || {})) {
    const ex = r.exits[dir];
    if (!DIRS.includes(dir)) { gap('a direction the compass does not have', r.name + ' ' + dir); continue; }

    if (ex.type === 'to') {
      if (!roomIds.has(ex.to)) { gap('an exit to somewhere not in the world', r.name + ' ' + dir); continue; }
      room.exits.push({ dir, to: ex.to });

    } else if (ex.type === 'cond') {
      if (!roomIds.has(ex.to)) { gap('an exit to somewhere not in the world', r.name + ' ' + dir); continue; }
      const e = { dir, to: ex.to, condition: { type: 'flag', flag: flagName(ex.cond) } };
      if (ex.msg) e.blocked = unquote(ex.msg);
      room.exits.push(e);

    } else if (ex.type === 'msg') {
      //  A wall that talks: no destination, just a refusal with a reason. Zork has
      //  37 of them and they are some of its best writing — the boarded front
      //  door, the cliff you will not climb. The format cannot say this, because
      //  `blocked` needs a `to` to hang off.
      gap('a refusal with nowhere to go', r.name + ' ' + dir + ': ' +
        unquote(ex.msg).slice(0, 46));

    } else if (ex.type === 'per') {
      gap('an exit decided by code', r.name + ' ' + dir);
    }
  }
  outRooms.push(room);
}

// ------------------------------------------------------------------ objects
const outItems = [];
const outActors = [];
for (const o of objects) {
  const p = o.props || {};
  const flags = String(p.FLAGS || '').split(/\s+/).filter(Boolean);
  const where = p.IN;

  const attributes = {};
  for (const f of flags) {
    if (FLAGMAP[f]) attributes[FLAGMAP[f]] = true;
    else attributes[f] = true;                 // carried through, logic ignores it
  }

  const thing = { id: o.name, name: unquote(p.DESC) || o.name, attributes };
  if (p.TEXT) thing.description = unquote(p.TEXT);
  if (p.FDESC) thing.roomProse = unquote(p.FDESC);

  if (!where) { gap('a thing that starts nowhere in particular', o.name); continue; }
  if (roomIds.has(where)) thing.location = where;
  else if (objects.some(x => x.name === where)) thing.location = where;   // in a container
  else { gap('a thing kept in a pseudo-container', o.name + ' in ' + where); continue; }

  if (p.SIZE) gap('a thing with a weight', o.name);
  if (p.CAPACITY) gap('a container with a limit', o.name);
  if (p.TVALUE) gap('a treasure worth points when deposited', o.name);
  if (p.ACTION) gap('a thing that runs its own code', o.name + ' → ' + p.ACTION);
  if (flags.includes('NDESCBIT')) gap('a thing present but not listed', o.name);

  if (flags.includes('ACTORBIT')) {
    delete thing.attributes.ACTORBIT;
    outActors.push(Object.assign(thing, { hostile: /TROLL|THIEF|CYCLOPS/.test(o.name) }));
  } else {
    outItems.push(thing);
  }
}

function titleOf(r) {
  const d = unquote((r.props || {}).DESC);
  return d || r.name.toLowerCase().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function flagName(cond) {
  return String(cond || 'unknown').toLowerCase().replace(/-/g, '');
}

// Flags the conditional exits refer to. They are declared false, because nothing
// translated sets them: the routines that would have are the gap.
const flags = {};
for (const r of outRooms) {
  for (const e of r.exits) if (e.condition && e.condition.flag) flags[e.condition.flag] = false;
}

const world = {
  meta: {
    title: 'Zork I, as far as the format reaches',
    start: 'WEST-OF-HOUSE',
    defaults: { unknown: 'Nothing happens.' }
  },
  flags,
  rooms: outRooms,
  items: outItems,
  actors: outActors,
  rules: []
};

// ---------------------------------------------------------------- the report
const C = { dim: '\x1b[2m', gold: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' };
console.log('\n' + C.bold + 'Zork I → a Folio world' + C.off + '\n');
console.log('  carried across');
console.log('    ' + String(outRooms.length).padStart(4) + ' rooms of ' + rooms.length);
console.log('    ' + String(outRooms.reduce((n, r) => n + r.exits.length, 0)).padStart(4) + ' exits');
console.log('    ' + String(outItems.length).padStart(4) + ' things');
console.log('    ' + String(outActors.length).padStart(4) + ' characters');

const total = [...gaps.values()].reduce((n, g) => n + g.n, 0);
console.log('\n  ' + C.gold + 'what the format could not hold' + C.off +
  C.dim + '  (' + total + ' in all)' + C.off);
for (const [kind, g] of [...gaps].sort((a, b) => b[1].n - a[1].n)) {
  console.log('    ' + String(g.n).padStart(4) + '  ' + kind);
  console.log('          ' + C.dim + g.eg.join(' · ').slice(0, 96) + C.off);
}

const oi = process.argv.indexOf('--out');
const out = oi > 0 ? process.argv[oi + 1] : null;
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(world, null, 2));
  console.log('\n  wrote ' + out + '  ' + C.dim +
    Math.round(JSON.stringify(world).length / 1024) + 'KB' + C.off);
  console.log('  ' + C.dim + 'Open it in the editor to see the map.' + C.off);
}
console.log('');
