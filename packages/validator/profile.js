//  The corpus profiler — reverse-engineering the recipe from games that worked.
//
//  T4 measures a game's design shape, but "is depth 3 good?" is unanswerable
//  without a reference. Rather than invent thresholds, we take them from the
//  classics: replay a real adventure against its published walkthrough, observe
//  what happens, and derive the shape of a game people actually loved.
//
//  A Z-machine binary is opaque — we cannot read its rule graph the way we read a
//  world.json — so structure is recovered by EXPLORATION instead. Every turn the
//  backend projects the World State Contract, and that projection is enough: the
//  room graph assembles itself from observed exits, the pacing curve from score
//  events, the item economy from what appears and what is taken. The contract
//  earns its keep here in a way that was not obvious when it was written.
//
//  What this cannot see, it does not claim: puzzle chain depth needs the rule
//  graph, and a binary does not expose one. The profile reports the metrics it
//  genuinely observed and stays silent on the rest.

'use strict';

/**
 * Profile a game by replaying its walkthrough and watching the contract.
 * @param {{state:function, zm?:object, submit?:function}} backend
 * @param {string} walkthrough
 */
function profile(backend, walkthrough, opts) {
  opts = opts || {};
  const cmds = String(walkthrough || '')
    .split('\n').map(l => l.split('#')[0].trim()).filter(Boolean);

  const send = backend.zm
    ? (line) => backend.zm.input(line)
    : (line) => { const [v, ...r] = line.split(/\s+/); return backend.submit(v, r.join(' ').toUpperCase() || null).prose; };

  const rooms = new Map();           // roomId -> Set(exit directions seen open)
  const edges = new Set();           // "A>B" pairs, for map shape
  const seenObjects = new Set();
  const takenObjects = new Set();
  const scoreEvents = [];            // { move, delta, room, cmd }
  const roomFirstSeen = new Map();

  let prev = backend.state();
  note(prev, 0);

  for (let i = 0; i < cmds.length; i++) {
    const line = cmds[i];
    if (/^expect:/i.test(line)) continue;
    let out = '';
    try { out = send(line) || ''; } catch (e) { break; }
    const s = backend.state();

    note(s, i + 1);
    if (s.roomId && prev.roomId && s.roomId !== prev.roomId) {
      edges.add(prev.roomId + '>' + s.roomId);
    }
    if (s.score !== prev.score) {
      scoreEvents.push({ move: s.moves, delta: s.score - prev.score, room: s.roomId, cmd: line });
    }
    for (const id of s.inventory) takenObjects.add(id);
    prev = s;
    if (opts.stopWhen && opts.stopWhen(s, out)) break;
  }

  function note(s, turn) {
    if (!s.roomId) return;
    if (!rooms.has(s.roomId)) { rooms.set(s.roomId, new Set()); roomFirstSeen.set(s.roomId, turn); }
    const set = rooms.get(s.roomId);
    for (const [dir, dest] of Object.entries(s.exits || {})) {
      if (dest) set.add(dir);
    }
    for (const id of (s.objects || [])) seenObjects.add(id);
  }

  // ------------------------------------------------------------- map shape
  // Cyclomatic complexity over the observed graph. A corridor scores ~0; a map
  // that loops back on itself scores higher, and looping is what lets a player
  // build a mental model instead of following a rail.
  const n = rooms.size;
  const e = edges.size;
  const loops = n ? Math.max(0, e - n + 1) : 0;

  // ------------------------------------------------------------ the pacing curve
  // Where the rewards fall across the run. A game that pays out evenly reads as a
  // treadmill; one that pays in bursts has acts. Quartiles are enough to see it.
  const totalMoves = prev.moves || 1;
  const quartiles = [0, 0, 0, 0];
  for (const ev of scoreEvents) {
    const q = Math.min(3, Math.floor((ev.move / totalMoves) * 4));
    quartiles[q] += ev.delta;
  }

  // Gaps between rewards: the dry spells. The longest one is the real measure of
  // how much faith a game asks the player for.
  const gaps = [];
  let last = 0;
  for (const ev of scoreEvents) { gaps.push(ev.move - last); last = ev.move; }
  const meanGap = gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
  const maxGap = gaps.length ? Math.max(...gaps) : 0;

  return {
    rooms: n,
    mapEdges: e,
    mapLoops: loops,
    loopsPerRoom: n ? round2(loops / n) : 0,
    objectsSeen: seenObjects.size,
    objectsTaken: takenObjects.size,
    takeRate: seenObjects.size ? Math.round((takenObjects.size / seenObjects.size) * 100) : 0,
    moves: totalMoves,
    finalScore: prev.score,
    scoreEvents: scoreEvents.length,
    movesPerScoreEvent: scoreEvents.length ? round1(totalMoves / scoreEvents.length) : 0,
    meanRewardGap: meanGap,
    longestDrySpell: maxGap,
    pacingQuartiles: quartiles,
    roomsPerScoreEvent: scoreEvents.length ? round1(n / scoreEvents.length) : 0
  };
}

/** Combine several profiles into the corpus reference T4 scores against. */
function summarise(profiles) {
  const keys = ['rooms', 'mapLoops', 'loopsPerRoom', 'takeRate', 'moves',
    'scoreEvents', 'movesPerScoreEvent', 'meanRewardGap', 'longestDrySpell',
    'roomsPerScoreEvent'];
  const out = {};
  for (const k of keys) {
    const vals = profiles.map(p => p[k]).filter(v => typeof v === 'number').sort((a, b) => a - b);
    if (!vals.length) continue;
    out[k] = {
      min: vals[0],
      median: vals[Math.floor(vals.length / 2)],
      max: vals[vals.length - 1]
    };
  }
  out.sampleSize = profiles.length;
  return out;
}

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

module.exports = { profile, summarise };
