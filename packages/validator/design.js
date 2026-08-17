//  T4 — the design audit. Is this a *game*, or merely a completable artifact?
//
//  T0–T3 have a blind spot big enough to drive a demo through: a single room
//  containing a lamp, where `take lamp` fires a win, passes every one of them. It
//  is schema-valid, referentially sound, has no dead ends, and its walkthrough
//  completes. It is also not a game.
//
//  This matters most for generated games. A Zork port inherits Infocom's design;
//  a world compiled from a novel inherits nothing, and the failure mode is not a
//  broken game but a *hollow* one — beautiful rooms with nothing to do in them.
//  Scale is the specific risk with a long source: a thousand-page novel that
//  compiles to six rooms has not been adapted, it has been abandoned.
//
//  So T4 reports a PROFILE, not a verdict. "Good" is not binary and pretending
//  otherwise would produce a number nobody trusts. The thresholds that gate the
//  certified badge are calibrated against the classics by the corpus profiler;
//  what this module owns is the measurement.

'use strict';

/**
 * Measure the design shape of a Path B world.
 * @returns {{metrics:object, findings:Array}}
 */
function audit(world, opts) {
  opts = opts || {};
  const findings = [];
  const warn = (code, msg, hint) => findings.push({ level: 'warning', code, msg, hint });

  const rooms = world.rooms || [];
  const items = world.items || [];
  const rules = world.rules || [];

  // ------------------------------------------------------- 1. puzzle chain depth
  //
  // The headline metric, and the one that separates a game from a demo. A demo is
  // 1. Zork's deepest chains run to roughly 9. Depth is what "you had to work for
  // this" actually feels like from the inside.
  //
  // Measured by layered reachability rather than by rule-to-rule edges, because a
  // first attempt at the latter scored this project's own fixture at 1 when its
  // real chain is four steps long. Dependencies do not only run rule→rule: they
  // run through picking an item up (no rule involved), and through an exit whose
  // condition a rule satisfied (no second rule involved). Counting only rule edges
  // silently under-reports every game, which is worse than not measuring at all.
  //
  // So: run the same fixpoint T2 uses, but record which ROUND each thing first
  // becomes available. The number of rounds needed to converge is precisely the
  // length of the longest dependency chain in the world.
  const requires = rules.map(r => new Set(statesRequired(r)));
  const depth = chainDepth(world);

  // --------------------------------------------------- 2. participation & utility
  //
  // What proportion of the world is load-bearing? Decorative items and empty rooms
  // are not sins in themselves — Zork is full of scenery — but a game that is
  // mostly decoration is a set, not a game.
  const referenced = new Set();
  for (const r of rules) {
    for (const c of (r.if || [])) if (c.item) referenced.add(c.item);
    if (r.on && r.on.noun) referenced.add(r.on.noun);
    for (const e of (r.do || [])) if (e.item) referenced.add(e.item);
  }
  const takeable = items.filter(i => i.attributes && i.attributes.TAKEBIT);
  const itemParticipation = items.length
    ? Math.round((items.filter(i => referenced.has(i.id)).length / items.length) * 100) : 0;

  const activeRooms = new Set();
  for (const r of rules) if (r.on && r.on.room) activeRooms.add(r.on.room);
  for (const it of items) if (it.location && rooms.some(rm => rm.id === it.location)) activeRooms.add(it.location);
  const roomUtility = rooms.length
    ? Math.round((activeRooms.size / rooms.length) * 100) : 0;

  // ------------------------------------------------------------- 3. map shape
  //
  // Corridors are the signature of a generated map. Real adventure maps loop: they
  // let a player wander, return, and recognise. Cyclomatic complexity over the room
  // graph distinguishes the two — a tree scores 1, a looping map scores higher.
  let exitCount = 0;
  for (const rm of rooms) exitCount += (rm.exits || []).length;
  const loops = rooms.length ? (exitCount / 2) - rooms.length + 1 : 0;

  // -------------------------------------------------------- 4. gate separation
  //
  // How far is a key from its lock? Zero means the key sits beside the door, which
  // is a formality rather than a puzzle. Distance is what makes the player carry
  // something in the hope it matters.
  const dist = roomDistances(rooms);
  const gaps = [];
  for (const r of rules) {
    const needed = [...requires[rules.indexOf(r)]].filter(s => s.startsWith('carry:'));
    for (const n of needed) {
      const itemId = n.slice(6);
      const it = items.find(i => i.id === itemId);
      const gateRoom = (r.on && r.on.room) || roomOf(items, (r.on || {}).noun);
      if (it && it.location && gateRoom && dist[it.location] && dist[it.location][gateRoom] !== undefined) {
        gaps.push(dist[it.location][gateRoom]);
      }
    }
  }
  const meanGateDistance = gaps.length
    ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : 0;

  // --------------------------------------------------------------- 5. stakes
  // Timers count. A hazard on a clock is the commonest way a world kills you and
  // often the only one, so looking at rules alone told an author with a drowning
  // timer that nothing in their world had any stakes.
  const killsIn = (list) => (list || []).some(x => (x.do || []).some(e => e.type === 'lose'));
  const hasDeath = killsIn(rules) || killsIn(world.timers);
  const scoringRules = rules.filter(r => (r.do || []).some(e => e.type === 'score')).length;

  const metrics = {
    rooms: rooms.length,
    items: items.length,
    takeableItems: takeable.length,
    rules: rules.length,
    puzzleChainDepth: depth,
    itemParticipation,
    roomUtility,
    mapLoops: Math.max(0, loops),
    loopsPerRoom: rooms.length ? Math.round((Math.max(0, loops) / rooms.length) * 100) / 100 : 0,
    meanGateDistance,
    scoringMoments: scoringRules,
    hasDeathState: hasDeath
  };

  // ------------------------------------------------------------- the findings
  //
  // Thresholds are calibrated against conformance/corpus/zork-1.json — measured by
  // replaying the real game, not estimated. Two of my original guesses were wrong
  // in instructive ways, and the corrections are the point of having a corpus:
  //
  //   participation: guessed a 40% floor. Zork's take rate is 43%, meaning most of
  //     its world is scenery ON PURPOSE. A world where everything is takeable reads
  //     as a shopping list; scenery is what makes the takeable things feel chosen.
  //     So the floor drops, and a HIGH ratio becomes its own (gentler) warning.
  //
  //   map loops: guessed "at least one". Zork runs 0.67 loops per room — nearly
  //     every room sits on a circuit. A single loop in a fifty-room map is still a
  //     corridor, so the test has to be scale-free.
  //
  // Scale itself is deliberately NOT taken from the corpus. Zork has 82 rooms
  // because Zork is Zork; a game adapted from a short story should not be held to
  // that. Absolute size comes from the source material via the Story Compiler's
  // budget, and `opts.sourceScale` carries it when the caller knows it.
  const scale = opts.sourceScale || {};
  const T = Object.assign({
    minRooms: scale.expectedRooms ? Math.round(scale.expectedRooms * 0.6) : 8,
    minDepth: 3,
    minParticipation: 25,
    maxParticipation: 90,
    minRoomUtility: 60,
    minLoopsPerRoom: 0.15,
    expectDeaths: true
  }, opts.thresholds);

  if (metrics.rooms < T.minRooms) {
    warn('W500', 'only ' + metrics.rooms + ' rooms' +
      (scale.expectedRooms ? ', against ~' + scale.expectedRooms + ' the source suggests' : ''),
      scale.expectedRooms
        ? 'The source carries more places than the adaptation used. This is the ' +
          'characteristic failure of compiling a long book: a hollow game that is ' +
          'faithful to the plot and ignores the world.'
        : 'Short enough to read as a demo. Zork I runs 82 rooms; a short story ' +
          'need not, but a novel should not come out this size.');
  }
  if (metrics.puzzleChainDepth < T.minDepth) {
    warn('W501', 'longest puzzle chain is ' + metrics.puzzleChainDepth,
      'Nothing here requires several steps of planning. Depth is what makes a ' +
      'solution feel earned; a chain of 1 is an errand.');
  }
  if (metrics.itemParticipation < T.minParticipation) {
    warn('W502', 'only ' + metrics.itemParticipation + '% of items do anything',
      'Almost nothing here is load-bearing. Zork carries a lot of scenery too — ' +
      'only 43% of what a player sees is ever picked up — but below about a ' +
      'quarter the world stops rewarding curiosity at all.');
  }
  if (metrics.itemParticipation > T.maxParticipation && metrics.items > 6) {
    warn('W507', metrics.itemParticipation + '% of items are load-bearing — almost no scenery',
      'A world where everything matters reads as a shopping list. Zork keeps ' +
      'roughly half its objects as pure scenery, and that is what makes the ' +
      'useful ones feel chosen rather than issued.');
  }
  if (metrics.roomUtility < T.minRoomUtility) {
    warn('W503', 'only ' + metrics.roomUtility + '% of rooms contain anything',
      'The rest are corridors. Empty rooms are the most common way a generated ' +
      'map inflates its size without adding a game.');
  }
  if (metrics.loopsPerRoom < T.minLoopsPerRoom) {
    warn('W504', 'the map runs ' + metrics.loopsPerRoom + ' loops per room' +
      (metrics.mapLoops === 0 ? ' (a tree)' : ''),
      'Corridor maps are the signature of generated geography. Zork runs 0.67 ' +
      'loops per room — nearly every room sits on a circuit — which is what lets ' +
      'a player take a shortcut and feel the map as a place rather than a menu.');
  }
  if (!metrics.hasDeathState && T.expectDeaths) {
    warn('W505', 'nothing in this world can kill or defeat the player',
      'Without stakes, exploration carries no tension. Not mandatory — some fine ' +
      'games have no death — but worth having decided rather than defaulted.');
  }
  if (metrics.meanGateDistance === 0 && metrics.rules > 2) {
    warn('W506', 'keys sit in the same room as their locks',
      'A key beside its door is a formality, not a puzzle. Distance is what makes ' +
      'a player carry something in the hope that it matters.');
  }

  // Rules that fire and say nothing.
  //
  // Found by playing a freshly built game through the tools rather than by
  // testing it. "unlock gate" set the flag, opened the way, and printed an empty
  // line. The command had worked perfectly and the player had no way to know: a
  // successful rule with no print is indistinguishable from a command the game
  // did not understand.
  //
  // Only player-triggered rules count. A rule with no verb is machinery, and a
  // timer appends to whatever else happened that turn.
  const silent = (world.rules || []).filter(r =>
    (r.on || {}).verb && !(r.do || []).some(e => e.type === 'print'));
  if (silent.length) {
    warn('W508', silent.length + ' rule' + (silent.length > 1 ? 's fire' : ' fires') +
      ' without printing anything',
      'A rule that succeeds silently looks exactly like a command the game did not ' +
      'understand. Triggers: ' +
      silent.slice(0, 5).map(r => (r.on.verb + ' ' + (r.on.noun || '')).trim()).join(', ') +
      '. Add a print effect, even a short one.');
  }

  return { metrics, findings };
}

// --------------------------------------------------------------------- helpers

// The state vocabulary is closed, so what a rule produces and requires can be
// named exactly — which is what makes the dependency DAG computable at all.
function statesProduced(r) {
  const out = [];
  for (const e of (r.do || [])) {
    if (e.type === 'set-flag' && e.value !== false) out.push('flag:' + e.flag);
    if (e.type === 'open') out.push('open:' + e.item);
    if (e.type === 'light') out.push('lit:' + e.item);
    if (e.type === 'take') out.push('carry:' + e.item);
    if (e.type === 'move-item') out.push('at:' + e.item + '@' + e.to);
    if (e.type === 'goto') out.push('room:' + e.room);
  }
  return out;
}

function statesRequired(r) {
  const out = [];
  const walk = (c) => {
    if (!c) return;
    if (c.type === 'flag' && c.value !== false) out.push('flag:' + c.flag);
    if (c.type === 'carrying') out.push('carry:' + c.item);
    if (c.type === 'open') out.push('open:' + c.item);
    if (c.type === 'lit') out.push('lit:' + c.item);
    if (c.type === 'at' || c.type === 'visited') out.push('room:' + c.room);
    if (c.type === 'not') walk(c.condition);
  };
  for (const c of (r.if || [])) walk(c);
  return out;
}

// Layered reachability. Each round unlocks everything the previous round made
// possible; the round count on convergence is the longest dependency chain.
// Dependencies flow through three channels, and all three must be modelled:
// picking things up, firing rules, and walking through exits that a rule opened.
function chainDepth(world) {
  const rooms = {};
  for (const r of (world.rooms || [])) rooms[r.id] = r;
  const items = {};
  for (const i of (world.items || [])) items[i.id] = i;
  const rules = world.rules || [];
  const start = world.meta && world.meta.start;
  if (!start) return 0;

  const reach = new Set([start]);
  const held = new Set();
  const flags = new Set(Object.keys(world.flags || {}).filter(k => world.flags[k]));
  const fired = new Set();

  const loc = {};
  for (const i of (world.items || [])) loc[i.id] = i.location;

  const present = (id) => {
    if (held.has(id)) return true;
    const w = loc[id];
    if (w === 'PLAYER') return true;
    if (rooms[w]) return reach.has(w);
    if (items[w]) return present(w) && flags.has('_open_' + w);
    return false;
  };
  const sat = (c) => {
    if (!c) return true;
    switch (c.type) {
      case 'flag': return c.value === false ? !flags.has(c.flag) : flags.has(c.flag);
      case 'carrying': return held.has(c.item);
      case 'in-room': case 'present': return present(c.item);
      case 'at': case 'visited': return reach.has(c.room);
      case 'open': return flags.has('_open_' + c.item);
      case 'lit': return flags.has('_lit_' + c.item);
      case 'score-at-least': return true;
      case 'not': return !sat(c.condition);
      default: return false;
    }
  };

  // Strict layering: every test in a round is evaluated against the world as it
  // stood at the START of that round, and results land in the next layer. Without
  // the snapshot, a single round cascades — reach a room, grab the key it holds,
  // unlock a door with it, and walk through, all "simultaneously" — which collapses
  // a four-step chain into one and reports every game as shallower than it is.
  let rounds = 0;
  for (let guard = 0; guard < 200; guard++) {
    const snapReach = new Set(reach);
    const snapHeld = new Set(held);
    const snapFlags = new Set(flags);
    const snapLoc = Object.assign({}, loc);

    const presentAt = (id) => {
      if (snapHeld.has(id)) return true;
      const w = snapLoc[id];
      if (w === 'PLAYER') return true;
      if (rooms[w]) return snapReach.has(w);
      if (items[w]) return presentAt(w) && snapFlags.has('_open_' + w);
      return false;
    };
    const satAt = (c) => {
      if (!c) return true;
      switch (c.type) {
        case 'flag': return c.value === false ? !snapFlags.has(c.flag) : snapFlags.has(c.flag);
        case 'carrying': return snapHeld.has(c.item);
        case 'in-room': case 'present': return presentAt(c.item);
        case 'at': case 'visited': return snapReach.has(c.room);
        case 'open': return snapFlags.has('_open_' + c.item);
        case 'lit': return snapFlags.has('_lit_' + c.item);
        case 'score-at-least': return true;
        case 'not': return !satAt(c.condition);
        default: return false;
      }
    };

    let changed = false;

    for (const rid of snapReach) {
      for (const ex of ((rooms[rid] || {}).exits || [])) {
        if (!rooms[ex.to] || reach.has(ex.to)) continue;
        if (ex.condition && !satAt(ex.condition)) continue;
        if (ex.door && !snapFlags.has('_open_' + ex.door)) continue;
        reach.add(ex.to); changed = true;
      }
    }
    for (const id of Object.keys(items)) {
      if (held.has(id)) continue;
      if (!(items[id].attributes && items[id].attributes.TAKEBIT)) continue;
      if (presentAt(id)) { held.add(id); changed = true; }
    }
    for (let i = 0; i < rules.length; i++) {
      if (fired.has(i)) continue;
      const on = rules[i].on || {};
      if (on.room && !snapReach.has(on.room)) continue;
      if (on.noun && !presentAt(on.noun)) continue;
      if (rules[i].if && !rules[i].if.every(satAt)) continue;
      fired.add(i); changed = true;
      for (const e of (rules[i].do || [])) {
        if (e.type === 'set-flag') { if (e.value !== false) flags.add(e.flag); else flags.delete(e.flag); }
        else if (e.type === 'open') flags.add('_open_' + e.item);
        else if (e.type === 'light') flags.add('_lit_' + e.item);
        else if (e.type === 'take') held.add(e.item);
        else if (e.type === 'move-item') loc[e.item] = e.to;
        else if (e.type === 'goto') reach.add(e.room);
      }
    }

    if (!changed) break;
    rounds++;
  }
  return rounds;
}

function roomOf(items, id) {
  const it = items.find(i => i.id === id);
  return it ? it.location : null;
}

// All-pairs shortest paths over the room graph, ignoring conditions — the question
// is how far apart things are in the world, not whether a route is open yet.
function roomDistances(rooms) {
  const ids = rooms.map(r => r.id);
  const adj = {};
  for (const r of rooms) {
    adj[r.id] = (r.exits || []).map(e => e.to).filter(t => ids.includes(t));
  }
  const out = {};
  for (const start of ids) {
    const d = { [start]: 0 };
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      for (const nx of (adj[cur] || [])) {
        if (d[nx] === undefined) { d[nx] = d[cur] + 1; q.push(nx); }
      }
    }
    out[start] = d;
  }
  return out;
}

module.exports = { audit };
