//  T2 — dependency-graph analysis for a Path B world.
//
//  A .folio is a puzzle dependency chart in disguise (Ron Gilbert's LucasArts
//  technique), and once the world is machine-readable the chart can be computed
//  rather than drawn. T2 and T3 are complementary and neither implies the other:
//
//    the graph proves NO DEAD ENDS EXIST
//    the replay proves ONE PATH COMPLETES
//
//  The method is a fixpoint reachability analysis. Start where the player starts,
//  holding nothing. Repeatedly work out everything reachable with what is held,
//  collect whatever that exposes, fire whatever rules become satisfiable, and go
//  again until nothing changes. What the fixpoint cannot reach, a player cannot
//  reach either — which is the whole question.
//
//  It is deliberately optimistic about ordering (it assumes the player does the
//  right things in the right order) and pessimistic about availability (it will
//  not use an item it has not proved obtainable). That combination means a T2
//  failure is a real defect, not a scheduling quibble — the property that makes
//  the findings worth acting on.

'use strict';

function analyse(world) {
  const findings = [];
  const err = (code, msg, hint) => findings.push({ level: 'error', code, msg, hint });
  const warn = (code, msg, hint) => findings.push({ level: 'warning', code, msg, hint });

  const rooms = index(world.rooms);
  const items = index(world.items);
  const rules = world.rules || [];
  const start = world.meta && world.meta.start;

  if (!start || !rooms[start]) {
    err('E300', 'meta.start does not name a real room: "' + start + '"');
    return { ok: false, findings };
  }

  // ------------------------------------------------------- referential integrity
  // Cheap, and it catches the overwhelmingly common authoring mistake: a typo in
  // a room or item id that would otherwise surface as a dead end at play time.
  for (const room of world.rooms) {
    for (const ex of (room.exits || [])) {
      if (!rooms[ex.to]) {
        err('E301', 'room "' + room.id + '" has an exit ' + ex.dir + ' to "' + ex.to +
          '", which does not exist');
      }
      if (ex.door && !items[ex.door]) {
        err('E302', 'room "' + room.id + '" has a door "' + ex.door + '" that is not an item');
      }
    }
  }
  for (const it of world.items) {
    if (it.location && it.location !== 'PLAYER' && it.location !== 'NOWHERE' &&
        !rooms[it.location] && !items[it.location]) {
      err('E303', 'item "' + it.id + '" starts in "' + it.location + '", which is neither ' +
        'a room nor a container');
    }
  }
  for (let i = 0; i < rules.length; i++) {
    for (const e of (rules[i].do || [])) {
      if (e.type === 'goto' && !rooms[e.room]) {
        err('E304', 'rule ' + i + ' sends the player to "' + e.room + '", which does not exist');
      }
      if ((e.type === 'move-item' || e.type === 'take' || e.type === 'destroy') &&
          e.item && !items[e.item]) {
        err('E305', 'rule ' + i + ' acts on item "' + e.item + '", which does not exist');
      }
    }
  }

  // ------------------------------------------------------------------- fixpoint
  const reachRooms = new Set([start]);
  const held = new Set();
  const flags = new Set(
    Object.keys(world.flags || {}).filter(k => world.flags[k]));
  const firedRules = new Set();
  let won = false;

  const canSatisfy = (c) => {
    if (!c) return true;
    switch (c.type) {
      case 'flag': return c.value === false ? !flags.has(c.flag) : flags.has(c.flag);
      case 'carrying': return held.has(c.item);
      case 'in-room': return itemReachable(c.item);
      case 'present': return held.has(c.item) || itemReachable(c.item);
      case 'at': return reachRooms.has(c.room);
      case 'visited': return reachRooms.has(c.room);
      case 'open': return flags.has('_open_' + c.item);
      case 'lit': return flags.has('_lit_' + c.item);
      case 'score-at-least': return true;   // score is monotonic; assume attainable
      case 'not': return !canSatisfy(c.condition);
      default: return false;
    }
  };

  // An item is reachable if it sits in a reachable room, or inside a container
  // that is itself reachable and open.
  function itemReachable(id) {
    const it = items[id];
    if (!it) return false;
    if (held.has(id)) return true;
    const where = itemLoc[id];
    if (where === 'PLAYER') return true;
    if (where === 'NOWHERE') return false;
    if (rooms[where]) return reachRooms.has(where);
    if (items[where]) return itemReachable(where) && flags.has('_open_' + where);
    return false;
  }

  const itemLoc = {};
  for (const it of world.items) itemLoc[it.id] = it.location;

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;

    // 1. Walk every passable exit out of every reachable room.
    for (const rid of Array.from(reachRooms)) {
      for (const ex of ((rooms[rid] || {}).exits || [])) {
        if (!rooms[ex.to]) continue;
        if (ex.condition && !canSatisfy(ex.condition)) continue;
        if (ex.door && !flags.has('_open_' + ex.door)) continue;
        if (!reachRooms.has(ex.to)) { reachRooms.add(ex.to); changed = true; }
      }
    }

    // 2. Pick up everything takeable that is now reachable.
    for (const it of world.items) {
      if (held.has(it.id)) continue;
      if (!(it.attributes && it.attributes.TAKEBIT)) continue;
      if (itemReachable(it.id)) { held.add(it.id); changed = true; }
    }

    // 3. Fire every rule whose trigger is now performable and whose conditions hold.
    for (let i = 0; i < rules.length; i++) {
      if (firedRules.has(i)) continue;
      const r = rules[i];
      const on = r.on || {};
      if (on.room && !reachRooms.has(on.room)) continue;
      // The noun must be present for the player to act on it at all.
      if (on.noun && !(held.has(on.noun) || itemReachable(on.noun))) continue;
      if (r.if && !r.if.every(canSatisfy)) continue;

      firedRules.add(i);
      changed = true;
      for (const e of (r.do || [])) {
        switch (e.type) {
          case 'set-flag': if (e.value !== false) flags.add(e.flag); else flags.delete(e.flag); break;
          case 'open': flags.add('_open_' + e.item); break;
          case 'light': flags.add('_lit_' + e.item); break;
          case 'take': held.add(e.item); break;
          case 'move-item': itemLoc[e.item] = e.to; break;
          case 'goto': reachRooms.add(e.room); break;
          case 'win': won = true; break;
          default: break;
        }
      }
    }
  }

  // --------------------------------------------------------------- the verdict
  if (!won) {
    err('E310', 'the win state is not reachable',
      'No sequence of reachable actions fires a "win" effect. Either a puzzle has ' +
      'no solution from the start state, or nothing declares a win.');
  }

  for (const room of world.rooms) {
    if (!reachRooms.has(room.id)) {
      err('E311', 'room "' + room.id + '" is unreachable',
        'Nothing the player can do leads here. Usually a missing exit or an ' +
        'unsatisfiable condition.');
    }
  }

  for (const it of world.items) {
    if (it.location === 'NOWHERE') continue;
    if (!itemReachable(it.id) && !held.has(it.id)) {
      warn('W312', 'item "' + it.id + '" can never be reached',
        'It exists but no player will ever see it.');
    }
  }

  // Dead-rule reporting keys off the TRIGGER, not the conditions — a distinction
  // this analysis got wrong on its first run and that matters a great deal.
  //
  // The fixpoint is optimistic about ordering: it assumes the player lights the
  // lamp before descending. So a rule guarding the *wrong* order ("you grope in
  // the dark and find nothing") never fires during analysis, even though a real
  // player hits it constantly. Flagging those would train authors to delete their
  // failure branches — exactly the writing that makes a game feel authored.
  //
  // A rule is genuinely dead only when the player can never even attempt it:
  // its room is unreachable, or its noun can never be present.
  for (let i = 0; i < rules.length; i++) {
    if (firedRules.has(i)) continue;
    const on = rules[i].on || {};
    const roomDead = on.room && !reachRooms.has(on.room);
    const nounDead = on.noun && !held.has(on.noun) && !itemReachable(on.noun);
    if (roomDead || nounDead) {
      warn('W313', 'rule ' + i + ' (' + (on.verb || '?') + ' ' + (on.noun || '') +
        ') can never fire',
        roomDead ? 'Its room "' + on.room + '" is unreachable.'
                 : 'Its noun "' + on.noun + '" can never be present.');
    }
  }

  // Softlock heuristic: an item that some rule destroys, and that another rule
  // still requires. Destroying it first is a dead end the player cannot undo.
  const destroyed = new Set();
  for (const r of rules) for (const e of (r.do || [])) if (e.type === 'destroy') destroyed.add(e.item);
  for (const id of destroyed) {
    const needed = rules.some(r => (r.if || []).some(c =>
      (c.type === 'carrying' || c.type === 'present') && c.item === id));
    if (needed) {
      warn('W314', 'item "' + id + '" can be destroyed but is also required by a rule',
        'A player who destroys it first may be unable to finish. Consider making it ' +
        'unbreakable, replaceable, or the destruction itself a win/lose branch.');
    }
  }

  const errors = findings.filter(f => f.level === 'error');
  return {
    ok: errors.length === 0,
    findings,
    stats: {
      rooms: world.rooms.length,
      reachable: reachRooms.size,
      items: world.items.length,
      obtainable: held.size,
      rules: rules.length,
      live: firedRules.size,
      winReachable: won
    }
  };
}

function index(list) {
  const out = {};
  for (const x of (list || [])) out[x.id] = x;
  return out;
}

module.exports = { analyse };
