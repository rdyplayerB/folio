//  The blind solver — playing a game without being told the answer.
//
//  Every check before this one asks whether a game is coherent and finishable.
//  None of them asks whether a player could have done anything else, and three
//  separate cold builds independently reported the same verdict about their own
//  certified games: a corridor with good prose on it. One put it exactly right —
//  the audit "measured seven design properties and cleared all seven while being
//  structurally unable to see whether any choice could have gone another way."
//
//  This is that missing half. It searches the game from a cold start with the
//  walkthrough withheld, using only what a player can see: the objects in the
//  room, the things in hand, the exits on the compass, and the eight verbs on the
//  board. It answers two questions the tiers cannot.
//
//    FINDABLE     Can the ending be reached without being told how? A game whose
//                 solution needs a word nobody could guess is completable and not
//                 fair, and the badge has never been able to tell those apart.
//
//    CHOICE       On the way there, how often does more than one thing work? If
//                 exactly one action advances the world at every step, the map is
//                 decoration. This is the corridor measure, and it is the number
//                 the design audit could never see.
//
//  It also finds softlocks properly, by search rather than by heuristic: a state
//  a player can reach and cannot win from. W314 and W510 guess at that shape;
//  this proves it.
//
//  Bounded on purpose. An exhaustive search of a thirty-room game is not
//  finite in any useful sense, so it explores until it runs out of budget and
//  says so rather than pretending the answer is complete.

'use strict';

const world = require('../world/index.js');

// What the board can send. A blind player has these and nothing else.
const VERBS = ['LOOK', 'TAKE', 'DROP', 'OPEN', 'CLOSE', 'USE', 'HIT', 'SPEAK'];
const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW',
  'UP', 'DOWN', 'IN', 'OUT'];

/**
 * Everything that distinguishes one world state from another.
 *
 * Built against a vocabulary worked out once, because this is called for every
 * candidate action of every state and an earlier version re-derived and re-sorted
 * the whole world each time. On a game with seventy-five items that was most of
 * the running cost.
 */
function keyer(def) {
  const names = new Set();
  const walk = (c) => {
    if (!c || typeof c !== 'object') return;
    if (c.flag) names.add(c.flag);
    if (c.condition) walk(c.condition);
    for (const sub of (c.conditions || [])) walk(sub);
  };
  for (const k of Object.keys(def.flags || {})) names.add(k);
  for (const r of (def.rules || []).concat(def.timers || [])) {
    for (const c of (r.if || [])) walk(c);
    for (const e of (r.do || [])) {
      if (e.flag) names.add(e.flag);
      if (e.item) { names.add('_open_' + e.item); names.add('_lit_' + e.item); }
    }
  }
  for (const it of (def.items || [])) {
    names.add('_open_' + it.id); names.add('_lit_' + it.id);
  }
  const flagNames = [...names].sort();
  const counterNames = Object.keys(def.counters || {}).sort();
  const itemIds = (def.items || []).map(i => i.id).sort();
  const actorIds = (def.actors || []).map(a => a.id).sort();
  const roomIds = (def.rooms || []).map(r => r.id).sort();

  return function key(w) {
    let s = w.here + '|' + w.score + '|';
    for (const f of flagNames) s += w.flags[f] ? '1' : '0';
    s += '|';
    for (const c of counterNames) s += (w.counters[c] || 0) + ',';
    s += '|';
    for (const id of itemIds) s += (w.loc[id] || '-') + ',';
    s += '|';
    for (const id of actorIds) s += (w.actorLoc[id] || '-') + ',';
    s += '|';
    for (const id of roomIds) s += w.visited.has(id) ? '1' : '0';
    s += '|';
    // Whether a timer has FIRED, never how far along it is. A running clock makes
    // every action produce a technically-new state, and the search happily burned
    // four hundred turns opening the same door because each attempt ticked the
    // lamp. Two states that differ only by a tick are the same state to a player.
    //
    // The consequence is deliberate: a game that can only be advanced by idling
    // comes back unsolvable, which is the right answer. WAIT has no button, so
    // nothing reachable by clicking should ever require it.
    for (const t of w.timers) s += (t.done ? 'd' : '-');
    return s + '|' + (w.ended ? (w.ended.win ? 'W' : 'L') : '');
  };
}

function snapshot(w) {
  return {
    here: w.here, score: w.score, moves: w.moves,
    flags: Object.assign({}, w.flags),
    counters: Object.assign({}, w.counters || {}),
    loc: Object.assign({}, w.loc),
    actorLoc: Object.assign({}, w.actorLoc),
    visited: [...w.visited],
    timers: w.timers.map(t => ({ elapsed: t.elapsed, done: !!t.done })),
    ended: w.ended
  };
}

function restore(w, s) {
  w.here = s.here; w.score = s.score; w.moves = s.moves;
  w.flags = Object.assign({}, s.flags);
  w.counters = Object.assign({}, s.counters);
  w.loc = Object.assign({}, s.loc);
  w.actorLoc = Object.assign({}, s.actorLoc);
  w.visited = new Set(s.visited);
  s.timers.forEach((t, i) => {
    if (w.timers[i]) { w.timers[i].elapsed = t.elapsed; w.timers[i].done = t.done; }
  });
  w.ended = s.ended;
}

/**
 * The commands a player could try from here, given only what they can see.
 *
 * Deliberately not read off the rules. A solver that consults the rule list to
 * decide what to try is not blind, and would report every game as perfectly
 * findable. The one concession is which verbs take a second object, because the
 * board itself knows that: it is what decides whether the interface asks for a
 * second click.
 */
function moves(def, state, pairVerbs) {
  const out = [];
  for (const dir of DIRS) if (state.exits[dir]) out.push([dir, null, null]);

  const here = state.objects || [];
  const held = state.inventory || [];
  const seen = [...new Set(here.concat(held))];

  for (const verb of VERBS) {
    if (verb === 'DROP') continue;
    // Dropping is never required to finish a Folio game: there is no carry limit,
    // so anything you can hold you can keep holding. Leaving it in multiplied the
    // reachable states by every arrangement of every item across every room, and
    // a thirty-room game did not finish inside forty thousand states.
    if (verb === 'LOOK') out.push(['LOOK', null, null]);
    for (const obj of seen) {
      out.push([verb, obj, null]);
      if (!pairVerbs.has(verb)) continue;
      // Pairing is the expensive one, so only carried things are offered as the
      // second object. That is also what a player does: you use the thing in your
      // hand on the thing in the room.
      for (const other of held) if (other !== obj) out.push([verb, obj, other]);
    }
  }
  return out;
}

/**
 * How far along does this state look?
 *
 * Breadth-first is the wrong shape for this. It treats "walk one room west" and
 * "solve the puzzle" as equally interesting and drowns in a game of any size. A
 * player does not do that: they chase whatever looks like progress and back up
 * when it stops paying. So the frontier is ordered by the things a player would
 * notice happening — points, doors opening, new ground, new possessions — and the
 * search behaves like somebody trying to get somewhere.
 *
 * This makes the search good rather than exhaustive, which is the honest trade.
 * A solution found proves findability; no solution found proves nothing, and the
 * report says truncated so nobody reads it as proof.
 */
function progress(w) {
  let flags = 0;
  for (const k in w.flags) if (w.flags[k]) flags++;
  let held = 0;
  for (const id in w.loc) if (w.loc[id] === 'PLAYER') held++;
  return w.score * 10 + flags * 4 + w.visited.size * 2 + held;
}

/**
 * Search a world for its ending, blind.
 *
 * Iterative deepening, because the two obvious searches are both wrong here.
 * Breadth-first drowns: a thirty-room game did not finish inside forty thousand
 * states. Greedy best-first finds a path and not a short one, and came back with
 * a four-hundred-move route through an eight-move game, which is useless as a
 * measure of whether a person could find it. Deepening the cap until something
 * solves gives a path close to the shortest one, and the shallow rounds cost
 * almost nothing.
 *
 * @param {object} def            a world.json
 * @param {object} [opts]
 * @param {number} [opts.maxStates]  states to explore before giving up
 * @param {number} [opts.maxMs]      wall-clock budget
 * @param {number} [opts.maxDepth]   deepest solution worth looking for
 */
function solve(def, opts) {
  opts = opts || {};
  const budget = {
    states: opts.maxStates || 60000,
    until: Date.now() + (opts.maxMs || 30000),
    depth: opts.maxDepth || 256
  };

  const pairVerbs = new Set();
  for (const r of (def.rules || [])) {
    if (r.on && r.on.second && r.on.verb) pairVerbs.add(String(r.on.verb).toUpperCase());
  }

  const key = keyer(def);
  const be = world.createBackend(def, { seed: opts.seed === undefined ? 1234 : opts.seed });
  const start = snapshot(be.world);

  let totalStates = 0;
  let truncated = false;
  let result = null;

  for (let cap = 8; cap <= budget.depth && !result; cap *= 2) {
    const round = search(cap);
    totalStates += round.explored;
    if (round.win) result = round;
    if (round.outOfBudget) { truncated = true; break; }
  }
  if (!result) truncated = true;

  // ------------------------------------------------------------- the path back
  const path = [];
  if (result) {
    let at = result.winKey;
    while (at && result.seen.get(at) && result.seen.get(at).via) {
      const node = result.seen.get(at);
      path.unshift({ command: node.via, choices: (result.seen.get(node.from) || {}).branch || 0 });
      at = node.from;
    }
  }

  // How often did more than one thing work? This is the corridor number: a game
  // where exactly one action ever advances the world is a sequence wearing a map.
  const branches = path.map(p => p.choices).filter(n => n > 0);
  const forced = branches.filter(n => n === 1).length;
  const meanChoices = branches.length
    ? Math.round((branches.reduce((a, b) => a + b, 0) / branches.length) * 10) / 10 : 0;

  return {
    solvedBlind: !!result,
    truncated,
    statesExplored: totalStates,
    solutionMoves: path.length,
    path,
    meanChoices,
    forcedSteps: forced,
    forcedFraction: branches.length ? Math.round((forced / branches.length) * 100) : 0,
    deaths: result ? result.losses : 0,
    deadEnds: result ? result.leaves : 0
  };

  // ---------------------------------------------------------------- one round
  function search(cap) {
    const seen = new Map();
    restore(be.world, start);
    seen.set(key(be.world), { depth: 0, from: null, via: null, branch: 0 });

    let queue = [start];
    let explored = 0, losses = 0, leaves = 0;
    let win = null, winKey = null, outOfBudget = false;

    while (queue.length && !win) {
      const next = [];
      for (const state of queue) {
        if (Date.now() > budget.until || explored >= budget.states) {
          outOfBudget = true; break;
        }
        restore(be.world, state);
        if (be.world.ended) continue;
        const from = key(be.world);
        const node = seen.get(from);
        if (!node || node.depth >= cap) continue;

        const options = moves(def, be.world.state(), pairVerbs);
        let advanced = 0, anyChild = false;

        for (const [verb, noun, second] of options) {
          restore(be.world, state);
          try { be.world.submit(verb, noun, second); } catch (e) { continue; }
          const k = key(be.world);
          if (k === from) continue;               // nothing happened
          advanced++; anyChild = true;
          if (seen.has(k)) continue;
          seen.set(k, { depth: node.depth + 1, from,
            via: verb + (noun ? ' ' + noun : '') + (second ? ' ' + second : '') });
          explored++;
          if (be.world.ended && be.world.ended.win) { win = true; winKey = k; break; }
          if (be.world.ended) { losses++; continue; }   // a death is not worth expanding
          next.push(snapshot(be.world));
        }

        node.branch = advanced;
        if (!anyChild) leaves++;
        if (win) break;
      }
      if (win || outOfBudget) break;
      queue = next;
    }
    return { win, winKey, seen, explored, losses, leaves, outOfBudget };
  }
}

module.exports = { solve, VERBS, DIRS };
