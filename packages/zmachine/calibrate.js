//  Calibration — deriving a room map from a Z-machine story file alone.
//
//  A Z-machine binary does not know it has rooms called anything. It has numbered
//  objects. Before the engine can draw a picture of the kitchen it needs a table
//  saying object 27 is the kitchen, and producing that table by hand is the whole
//  difficulty of porting a game.
//
//  The origin project solved this for one game by constraint satisfaction against
//  a hand-written description of Zork's world. That worked and does not generalise,
//  because it was answering a question a new port never asks: "which of these
//  fifteen objects named Maze is the one I already decided to call MAZE-7?" When
//  nobody has named anything yet, the ids are ours to mint, and the hard half of
//  the problem disappears. What is left is real but smaller:
//
//    1. decode the object table and every short name from the binary   (certain)
//    2. work out which properties hold exits, and which is which       (solved)
//    3. tell rooms from objects                                        (solved)
//    4. mint stable ids, disambiguating repeated names                 (certain)
//    5. work out which attribute bit means TAKEBIT, OPENBIT, and so on (inferred)
//
//  Step 5 is the one that cannot be finished from a bare binary. The compiler
//  assigns attribute numbers per game, so their meanings have to be recovered from
//  structure, and some flags leave a much clearer trace than others. Every guess
//  is scored and reported rather than quietly written out, because a wrong
//  TAKEBIT means the engine believes nothing in the game can be picked up, and
//  that is not a failure anyone wants to discover from a player.
//
//  Nothing here executes the story. It is a static read of the binary.

'use strict';

const DIRS = ['NORTH', 'EAST', 'WEST', 'SOUTH', 'NE', 'NW', 'SE', 'SW',
  'UP', 'DOWN', 'IN', 'OUT', 'LAND'];

// The reciprocal of each direction. This is the lever that replaces the
// hand-written world: a map is mostly two-way, so the assignment of property
// numbers to direction names can be scored by how many exits lead back.
const OPPOSITE = {
  NORTH: 'SOUTH', SOUTH: 'NORTH', EAST: 'WEST', WEST: 'EAST',
  NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW',
  UP: 'DOWN', DOWN: 'UP', IN: 'OUT', OUT: 'IN'
};

// Exit property lengths, per the ZIL library (gverbs.zil).
//   1 UEXIT [room]              2 NEXIT [string]        3 FEXIT [routine, pad]
//   4 CEXIT [room, var, string] 5 DEXIT [room, door, string]
// Lengths 1, 4 and 5 begin with the destination room's object number.
const EXIT_HAS_ROOM = [1, 4, 5];

// The ten flags the bridge projects into the World State Contract. Anything else
// in the game's attribute table is real but nothing reads it.
const NEEDED_FLAGS = ['TAKEBIT', 'OPENBIT', 'ONBIT', 'DOORBIT', 'CONTBIT',
  'TRANSBIT', 'SURFACEBIT', 'LIGHTBIT', 'INVISIBLE', 'ACTORBIT'];

// ---------------------------------------------------------------- text decode
const A0 = 'abcdefghijklmnopqrstuvwxyz';
const A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const A2 = ' \n0123456789.,!?_#\'"/\\-:()';

/**
 * Read a story file into everything statically knowable about its objects.
 * @param {Buffer|Uint8Array} bytes  an unmodified Z-machine story file
 */
function decode(bytes) {
  const data = bytes;
  const W = (a) => (data[a] << 8) | data[a + 1];

  const version = data[0];
  if (version !== 3) {
    throw new Error('calibrate: only v3 story files are supported, got v' + version);
  }
  const objtab = W(0x0a);
  const abbrev = W(0x18);

  // --- zscii ---------------------------------------------------------------
  function zchars(addr) {
    const out = [];
    for (;;) {
      const word = W(addr);
      addr += 2;
      out.push((word >> 10) & 31, (word >> 5) & 31, word & 31);
      if (word & 0x8000) break;
    }
    return out;
  }
  const abbrevCache = new Map();
  function abbreviation(n) {
    // v3 forbids nested abbreviations, so the expansion decodes without them.
    if (!abbrevCache.has(n)) abbrevCache.set(n, chars(zchars(W(abbrev + n * 2) * 2), false));
    return abbrevCache.get(n);
  }
  function chars(cs, allowAbbrev) {
    let s = '';
    let alpha = 0;   // v3: shift zchars 4 and 5 affect exactly one character
    for (let i = 0; i < cs.length; i++) {
      const z = cs[i];
      if (z === 0) { s += ' '; alpha = 0; continue; }
      if (z === 1 || z === 2 || z === 3) {
        const nz = cs[++i];
        if (allowAbbrev && nz !== undefined) s += abbreviation(32 * (z - 1) + nz);
        alpha = 0; continue;
      }
      if (z === 4) { alpha = 1; continue; }
      if (z === 5) { alpha = 2; continue; }
      if (alpha === 2 && z === 6) {                     // 10-bit ZSCII escape
        const hi = cs[++i], lo = cs[++i];
        if (lo !== undefined) s += String.fromCharCode((hi << 5) | lo);
        alpha = 0; continue;
      }
      s += (alpha === 0 ? A0 : alpha === 1 ? A1 : A2)[z - 6];
      alpha = 0;
    }
    return s;
  }

  // --- object table --------------------------------------------------------
  const objStart = objtab + 31 * 2;   // 31 property-default words come first
  const ENTRY = 9;                    // v3: 4 attribute bytes, 3 tree bytes, 2-byte pointer
  const addrOf = (n) => objStart + (n - 1) * ENTRY;
  // Object 1's property table sits immediately past the entry array, which is
  // what fixes the object count without the header telling us.
  const count = Math.floor((W(addrOf(1) + 7) - objStart) / ENTRY);

  function attrsOf(n) {
    const a = addrOf(n), out = [];
    // Attribute 0 is the MOST significant bit of the first byte.
    for (let i = 0; i < 32; i++) {
      if ((data[a + (i >> 3)] >> (7 - (i & 7))) & 1) out.push(i);
    }
    return out;
  }
  function propsOf(n) {
    const p = W(addrOf(n) + 7);
    let a = p + 1 + data[p] * 2;
    const out = new Map();
    for (;;) {
      const b = data[a];
      if (b === 0) break;
      const len = (b >> 5) + 1;                 // v3: bits 0-4 number, 5-7 length-1
      out.set(b & 31, { len, addr: a + 1, b0: data[a + 1], b1: data[a + 2] });
      a += 1 + len;
    }
    return out;
  }

  const objects = [null];
  for (let n = 1; n <= count; n++) {
    const p = W(addrOf(n) + 7);
    objects.push({
      num: n,
      name: data[p] === 0 ? '' : chars(zchars(p + 1), true),
      parent: data[addrOf(n) + 4],
      sibling: data[addrOf(n) + 5],
      child: data[addrOf(n) + 6],
      attrs: new Set(attrsOf(n)),
      props: propsOf(n)
    });
  }

  return {
    version, release: W(2),
    serial: Array.from(data.slice(0x12, 0x18)).map(c => String.fromCharCode(c)).join(''),
    count, objects
  };
}

// ------------------------------------------------------- exits and directions
/**
 * Find the property numbers that behave like exits, then decide which direction
 * each one is.
 *
 * Finding them is easy: a property whose length is 1, 4 or 5 and whose first byte
 * is a valid object number is shaped like an exit. Naming them is the interesting
 * part, and it is done by reciprocity. Under a correct assignment, walking NORTH
 * out of a room and then SOUTH out of where you landed brings you back most of
 * the time. Under a wrong one it almost never does.
 */
function findExits(story) {
  const { objects, count } = story;
  const valid = (t) => t >= 1 && t <= count;

  // Candidate exit properties, with the edges each one implies.
  const byProp = new Map();
  for (let n = 1; n <= count; n++) {
    for (const [prop, p] of objects[n].props) {
      if (!EXIT_HAS_ROOM.includes(p.len) || !valid(p.b0)) continue;
      if (!byProp.has(prop)) byProp.set(prop, []);
      byProp.get(prop).push({ from: n, to: p.b0, len: p.len, door: p.len === 5 ? p.b1 : 0 });
    }
  }

  // Rooms are the children of a single container object.
  //
  // ZIL declares every room inside one pseudo-object, conventionally ROOMS, and
  // that turns out to be the cleanest signal in the whole binary. An earlier
  // version of this guessed from exit shape instead and pulled in 62 false
  // positives: buttons, ropes, a kitchen table, anything whose properties happened
  // to hold a small number. Finding the container instead is exact.
  //
  // Which container is it? The one whose children carry the most exits. Nothing
  // else in the tree comes close, because nothing else contains a map.
  const carries = new Set([...byProp.values()].flat().map(e => e.from));
  const tally = new Map();
  for (const n of carries) {
    const p = objects[n].parent;
    if (!p) continue;
    tally.set(p, (tally.get(p) || 0) + 1);
  }
  let roomsParent = null, most = 0;
  for (const [p, k] of tally) if (k > most) { most = k; roomsParent = p; }

  const rooms = new Set();
  if (roomsParent) {
    // Take every child, including rooms with no exits of their own, which are
    // real: a cell you can only be put into is still a room.
    let c = objects[roomsParent].child;
    let guard = 0;
    while (c && guard++ < 1024) { rooms.add(c); c = objects[c].sibling; }
  }
  // If the tree does not look like that, fall back to the mutual-exit test rather
  // than returning nothing. Less accurate, and the report says so.
  const byTree = rooms.size > 0;
  if (!byTree) {
    const pointed = new Set([...byProp.values()].flat().map(e => e.to));
    for (const n of carries) if (pointed.has(n)) rooms.add(n);
  }

  // Keep only properties that are mostly room-to-room. Ordinary objects carry
  // properties in the same numeric range that happen to hold small numbers.
  const props = [...byProp.keys()].filter(prop => {
    const edges = byProp.get(prop);
    const good = edges.filter(e => rooms.has(e.from) && rooms.has(e.to)).length;
    return edges.length > 0 && good / edges.length >= 0.6;
  }).sort((a, b) => b - a);   // ZIL assigns directions downward from 31

  return { byProp, rooms, props, roomsParent, byTree };
}

/**
 * Assign direction names to exit property numbers.
 *
 * ZIL declares directions in a fixed order and the compiler numbers them downward
 * from the top of the property space, so the descending order of the properties we
 * found is the first hypothesis. It is only a hypothesis: a game is free to
 * declare them differently. So it is scored by reciprocity and compared against
 * swaps of each opposite pair, which is the mistake the ordering assumption would
 * actually make.
 */
function assignDirections(story, exits) {
  const { byProp, rooms, props } = exits;

  const edgesOf = (prop) => (byProp.get(prop) || [])
    .filter(e => rooms.has(e.from) && rooms.has(e.to));

  // Score an assignment by how many of its edges have a matching edge back.
  function score(map) {
    let pairs = 0, total = 0;
    for (const dir of Object.keys(map)) {
      const back = OPPOSITE[dir];
      if (!back || !map[back]) continue;
      const there = edgesOf(map[dir]);
      const home = edgesOf(map[back]);
      for (const e of there) {
        total++;
        if (home.some(h => h.from === e.to && h.to === e.from)) pairs++;
      }
    }
    return total ? pairs / total : 0;
  }

  const base = {};
  DIRS.slice(0, props.length).forEach((d, i) => { base[d] = props[i]; });

  let best = base, bestScore = score(base);
  // Try swapping each opposite pair. A single wrong pairing is the failure the
  // convention can produce, and it shows up as a collapse in reciprocity.
  let improved = true, guard = 0;
  while (improved && guard++ < 24) {
    improved = false;
    for (const dir of Object.keys(best)) {
      const back = OPPOSITE[dir];
      if (!back || !best[back]) continue;
      const trial = Object.assign({}, best);
      trial[dir] = best[back]; trial[back] = best[dir];
      const s = score(trial);
      if (s > bestScore + 1e-9) { best = trial; bestScore = s; improved = true; }
    }
  }

  return { dirprop: best, reciprocity: bestScore, considered: props };
}

// ------------------------------------------------------------------- id minting
/** A stable, readable id from a short name. */
function slug(name, fallback) {
  const s = String(name || '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

/**
 * Turn object numbers into stable ids.
 *
 * Repeated short names are the thing that made this look impossible, and they are
 * only a problem when the ids already exist and have to be matched. Minting them
 * fresh, MAZE-1 through MAZE-15 is as correct as any other assignment, because
 * nothing downstream knows or cares which physical maze room got which number.
 * The numbering is stable for a given binary, which is what actually matters:
 * re-running this produces the same ids, so scene art keeps pointing at the same
 * rooms.
 */
function mintIds(story, rooms) {
  const seen = new Map();
  const counts = new Map();
  for (let n = 1; n <= story.count; n++) {
    const base = slug(story.objects[n].name, 'OBJ-' + n);
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  const used = new Map();
  const roommap = {}, objmap = {};
  for (let n = 1; n <= story.count; n++) {
    const o = story.objects[n];
    if (!o.name) continue;                       // nameless internals stay unmapped
    const base = slug(o.name, 'OBJ-' + n);
    let id = base;
    if (counts.get(base) > 1) {
      const k = (used.get(base) || 0) + 1;
      used.set(base, k);
      id = base + '-' + k;
    }
    seen.set(n, id);
    if (rooms.has(n)) roommap[String(n)] = id;
    else objmap[String(n)] = id;
  }
  return { roommap, objmap, ids: seen };
}

// --------------------------------------------------------------- attribute bits
/**
 * Work out which attribute bit carries which ZIL flag.
 *
 * This is the part that cannot be finished from a bare binary, so it is done as
 * evidence rather than as an answer. For each flag we build the set of objects
 * that structure says should carry it, then look for the attribute bit whose
 * actual membership matches best, and report how well it matched.
 *
 * The evidence is genuinely uneven. A door is named as the door operand of a
 * DEXIT, so DOORBIT leaves a clean trace. Nothing in a static binary says which
 * objects a player may pick up, so TAKEBIT is inferred from the weakest possible
 * signal and should be confirmed by a human. Saying so is the whole point of
 * reporting a score.
 */
function inferAttributes(story, exits, dirprop) {
  const { objects, count } = story;
  const { byProp, rooms } = exits;
  const dirProps = new Set(Object.values(dirprop));

  // --- structural evidence per flag ---------------------------------------
  const doors = new Set();
  for (const [prop, edges] of byProp) {
    if (!dirProps.has(prop)) continue;
    for (const e of edges) if (e.len === 5 && e.door >= 1 && e.door <= count) doors.add(e.door);
  }

  const hasChildren = new Set();
  for (let n = 1; n <= count; n++) {
    if (objects[n].child && !rooms.has(n)) hasChildren.add(n);
  }

  // Things sitting loose in a room, which is the population a takeable object is
  // drawn from. Weak, and labelled as such downstream.
  const looseInRoom = new Set();
  for (let n = 1; n <= count; n++) {
    if (!rooms.has(n) && objects[n].parent && rooms.has(objects[n].parent)) looseInRoom.add(n);
  }

  // --- which objects actually carry each bit ------------------------------
  const bitSets = [];
  for (let b = 0; b < 32; b++) {
    const s = new Set();
    for (let n = 1; n <= count; n++) if (objects[n].attrs.has(b)) s.add(n);
    bitSets.push(s);
  }
  const nonRoom = (set) => [...set].filter(n => !rooms.has(n)).length;
  const contains = (big, small) => {
    if (!small.size) return 0;
    let k = 0;
    for (const x of small) if (big.has(x)) k++;
    return k / small.size;
  };

  const attr = {}, report = [];
  const taken = new Set();
  const claim = (flag, bit, confidence, why) => {
    if (bit !== null && !taken.has(bit)) { attr[flag] = bit; taken.add(bit); }
    else if (bit !== null) bit = null;
    report.push({ flag, bit, confidence, why });
  };

  // DOORBIT. A door is named as the second operand of a DEXIT, so this is not an
  // inference so much as a reading. The bit is the one all of them share.
  let doorBit = null, doorScore = 0;
  for (let b = 0; b < 32; b++) {
    if (!bitSets[b].size || bitSets[b].size > count / 4) continue;
    const c = contains(bitSets[b], doors);
    // Prefer full coverage by the tightest set, so a broad flag that happens to
    // cover the doors cannot outrank the flag that means "door".
    const s = c - (bitSets[b].size - doors.size) / (count || 1);
    if (c >= 0.9 && s > doorScore) { doorScore = s; doorBit = b; }
  }
  claim('DOORBIT', doorBit, doorBit === null ? 0 : 1,
    'every object named as the door of a DEXIT exit carries it');

  // ACTORBIT, and the player along with it.
  //
  // Actors are a small set, and the player is the one member the game has not
  // placed anywhere: ZIL leaves it parentless and its init routine puts it in the
  // first room. That narrows it but does not finish the job, because other small
  // flags also happen to have exactly one unplaced member. In Zork I, SEARCHBIT
  // covers seven objects with one loose one, which is the same shape and the
  // wrong answer.
  //
  // The name breaks the tie. ZIL's own name for the player object is a word no
  // other object uses, and every candidate here is being read out of the binary
  // anyway, so checking it costs nothing.
  const PLAYER_NAME = /^(cretin|adventurer|yourself|you|me|player|hero)$/i;
  let actorBit = null, actorLoose = null, actorNamed = false;
  for (let b = 0; b < 32; b++) {
    const set = bitSets[b];
    if (set.size < 2 || set.size > 20) continue;
    const loose = [...set].filter(n => !objects[n].parent && objects[n].name);
    if (loose.length !== 1) continue;
    const named = PLAYER_NAME.test(String(objects[loose[0]].name).trim());
    // A named match wins outright; otherwise the smallest set is the better bet.
    if (named && !actorNamed) { actorBit = b; actorLoose = loose[0]; actorNamed = true; continue; }
    if (named === actorNamed &&
        (actorBit === null || set.size < bitSets[actorBit].size)) {
      actorBit = b; actorLoose = loose[0];
    }
  }
  claim('ACTORBIT', actorBit, actorBit === null ? 0 : (actorNamed ? 0.95 : 0.4),
    actorNamed
      ? 'the one actor the game never placed, and its name says who it is'
      : 'a small set with exactly one unplaced member; unconfirmed');
  if (!actorNamed) actorLoose = null;   // do not hand back a guessed player

  // Everything else has no signal in a static binary worth trusting.
  //
  // TAKEBIT is the one that matters most and the one with the least evidence:
  // nothing in a compiled object table says what a player may pick up. Earlier
  // versions of this guessed by proxy and were confidently wrong, which is worse
  // than saying nothing, because an absent flag reads as false everywhere and at
  // least stays consistent. So the remaining flags come back as a census instead,
  // which a human resolves in about two minutes by reading the object names.
  for (const flag of NEEDED_FLAGS) {
    if (attr[flag] !== undefined || report.some(r => r.flag === flag)) continue;
    report.push({ flag, bit: null, confidence: 0,
      why: 'no reliable static signal; confirm from the census' });
  }

  const census = [];
  for (let b = 0; b < 32; b++) {
    if (!bitSets[b].size) continue;
    census.push({
      bit: b,
      count: bitSets[b].size,
      rooms: bitSets[b].size - nonRoom(bitSets[b]),
      claimed: Object.keys(attr).find(f => attr[f] === b) || null,
      sample: [...bitSets[b]].slice(0, 8).map(n => objects[n].name).filter(Boolean)
    });
  }

  return { attr, report, bitSets, census, player: actorLoose };
}

// --------------------------------------------------------------------- player
/**
 * Find the player object.
 *
 * The obvious approaches both fail. Global 0 holds the current room at runtime but
 * is zero in the file, because the game's init routine sets it. And the player's
 * parent is zero for the same reason: ZIL leaves the object unplaced and moves it
 * into the first room on startup.
 *
 * That last fact is the tell rather than the obstacle. Every other actor in the
 * game is placed in the world at compile time, so the player is the one actor the
 * file leaves nowhere. Attribute inference finds it while it is working out which
 * bit means ACTORBIT, and this only has to break the tie if that came back empty.
 */
function findPlayer(story, rooms, fromAttrs) {
  const { objects, count } = story;
  if (fromAttrs) return { player: fromAttrs, candidates: [fromAttrs], how: 'the unplaced actor' };

  // Fallback: parentless named objects, preferring one that reads like a person.
  // ZIL's own name for it is "cretin", which is not a word any other object uses.
  const loose = [];
  for (let n = 1; n <= count; n++) {
    if (rooms.has(n) || objects[n].parent || !objects[n].name) continue;
    loose.push(n);
  }
  const byName = loose.find(n => /^(cretin|adventurer|yourself|you|me)$/i.test(objects[n].name.trim()));
  return {
    player: byName || null,
    candidates: loose,
    how: byName ? 'name' : 'unresolved, confirm from the candidates'
  };
}

// ----------------------------------------------------------------------- main
/**
 * Derive a room map from a story file.
 * @param {Buffer|Uint8Array} bytes
 * @returns {{roommap:object, report:object}}
 */
function calibrate(bytes) {
  const story = decode(bytes);
  const exits = findExits(story);
  const dirs = assignDirections(story, exits);
  const { roommap, objmap } = mintIds(story, exits.rooms);
  const attrs = inferAttributes(story, exits, dirs.dirprop);
  const player = findPlayer(story, exits.rooms, attrs.player);

  const out = {
    ROOMMAP: roommap,
    OBJMAP: objmap,
    ATTR: attrs.attr,
    ADVENTURER: player.player,
    DIRPROP: dirs.dirprop,
    EXIT_HAS_ROOM: EXIT_HAS_ROOM.slice()
  };

  const missing = NEEDED_FLAGS.filter(f => out.ATTR[f] === undefined);
  return {
    roommap: out,
    report: {
      story: { version: story.version, release: story.release, serial: story.serial,
        objects: story.count },
      rooms: Object.keys(roommap).length,
      objects: Object.keys(objmap).length,
      unnamed: story.count - Object.keys(roommap).length - Object.keys(objmap).length,
      roomsFoundBy: exits.byTree ? 'containment tree' : 'exit shape (less reliable)',
      directions: dirs,
      attributes: attrs.report,
      census: attrs.census,
      missingFlags: missing,
      player,
      // Stated rather than implied. A port whose attribute table is half guessed
      // will run and misbehave subtly, and the person running this is the only
      // one positioned to catch it.
      confident: missing.length === 0 && dirs.reciprocity >= 0.8
    }
  };
}

module.exports = { calibrate, decode, findExits, assignDirections, mintIds,
  inferAttributes, findPlayer, DIRS, OPPOSITE, NEEDED_FLAGS };
