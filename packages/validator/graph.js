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
  const actors = index(world.actors || []);
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
      if (e.type === 'move-actor' && e.actor && !index(world.actors || [])[e.actor]) {
        err('E305', 'rule ' + i + ' moves actor "' + e.actor + '", which does not exist');
      }
    }
  }

  // ------------------------------------------------------------------- fixpoint
  const reachRooms = new Set([start]);
  const held = new Set();
  const flags = new Set(
    Object.keys(world.flags || {}).filter(k => world.flags[k]));

  // Seed the state the runtime already considers true at boot.
  //
  // isOpen() falls back to OPENBIT or TRANSPARENT and isLit() falls back to
  // ONBIT, and this analysis knew about neither, so it began every run believing
  // nothing was open and nothing was alight. A treasure in a chest declared open
  // was therefore unreachable, and a puzzle gated on a lamp that starts lit could
  // never be solved. Both play perfectly; only the checker could refuse to ship
  // them, and it did.
  for (const it of (world.items || [])) {
    const a = it.attributes || {};
    if (a.OPENBIT || a.TRANSPARENT) flags.add('_open_' + it.id);
    if (a.ONBIT) flags.add('_lit_' + it.id);
  }
  const firedRules = new Set();
  // Every noun that was reachable at any point in the analysis. Reachability is
  // not monotonic once actors and items start moving, so the final state is not a
  // safe thing to conclude "never" from.
  const everPresent = new Set();
  const firedTimers = new Set();
  let won = false;

  // Shared by rules and timers, because both advance the world the same way and
  // an earlier version that only understood rules could not see half of it.
  function applyEffects(list) {
    for (const e of list) {
      switch (e.type) {
        case 'set-flag': if (e.value !== false) flags.add(e.flag); else flags.delete(e.flag); break;
        case 'open': flags.add('_open_' + e.item); break;
        case 'light': flags.add('_lit_' + e.item); break;
        case 'take': held.add(e.item); break;
        // This fixpoint only ever ADDS capability, which is what makes it
        // optimistic about ordering and therefore trustworthy: a T2 failure is a
        // real defect rather than a scheduling quibble. destroy, close and
        // extinguish only take capability away, and modelling them turned a
        // perfectly ordinary pattern, spend an item after its last use, into a
        // hard error the moment any later rule mentioned it. W314 is the check
        // that owns that hazard, and it is advisory on purpose.
        case 'move-item':
          itemLoc[e.item] = e.to;
          // Being handed something is the same as taking it. Without this an
          // item a rule gave you was never counted as carried, so every
          // condition depending on it failed and the win looked unreachable.
          if (e.to === 'PLAYER') held.add(e.item);
          break;
        case 'move-actor': actorLoc[e.actor] = e.to; break;
        case 'goto': reachRooms.add(e.room); break;
        case 'win': won = true; break;
        default: break;
      }
    }
  }

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
      // Counters, like score, only ever climb toward a threshold, so a
      // counter gate is assumed reachable for the same reason.
      case 'counter-at-least': return true;
      case 'counter-equals': return true;
      // Optimistic, like the rest of this analysis: a roll that can come up will.
      // T3 then replays the real sequence and catches a game that actually
      // depends on winning one.
      case 'chance': return true;
      case 'actor-here': return actorReachable(c.actor) ||
        (actorLoc[c.actor] !== undefined && actorLoc[c.actor] !== 'NOWHERE');
      case 'fighting': return (world.actors || []).some(a => a.hostile);
      case 'not': return !canSatisfy(c.condition);
      case 'all': return (c.conditions || []).every(canSatisfy);
      case 'any': return (c.conditions || []).some(canSatisfy);
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

  // Actors are nouns too, and this analysis used to forget that entirely.
  //
  // The effect was not subtle: every rule whose trigger named a character was
  // reported as unfireable, so the flag it set was unreachable, so every room
  // behind that flag was unreachable, and a perfectly good game came back with a
  // cascade of E311s and an unreachable win. Any world with an NPC puzzle in it
  // was rejected. Found by writing a game against the published spec rather than
  // against the engine, which is exactly what that exercise is for.
  function actorReachable(id) {
    if (!actors[id]) return false;
    const where = actorLoc[id];
    if (where === 'NOWHERE') return false;
    if (where === 'PLAYER') return true;      // travelling with you, so always here
    return rooms[where] ? reachRooms.has(where) : false;
  }

  /** Anything the player could name in a command: an item or an actor. */
  function nounReachable(id) {
    return held.has(id) || itemReachable(id) || actorReachable(id);
  }

  const itemLoc = {};
  for (const it of world.items) itemLoc[it.id] = it.location;
  const actorLoc = {};
  for (const a of (world.actors || [])) actorLoc[a.id] = a.location;

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

    // 2b. Remember what was reachable this round, before any rule moves it.
    for (const it of world.items) if (nounReachable(it.id)) everPresent.add(it.id);
    for (const a of (world.actors || [])) if (nounReachable(a.id)) everPresent.add(a.id);

    // 2c. Fire every timer whose start condition is reachable.
    //
    // Timers were invisible here, and the consequences were severe and badly
    // diagnosed. A world that hid the player in an oven while timers brought the
    // ogre home, fed him and put him to sleep came back with an unreachable win,
    // an unreachable room and twelve dead rules — every one a symptom, with the
    // cause reported nowhere. The author found it by noticing that everything
    // broken traced back to a timer-set flag.
    //
    // Treating them as reachable is sound rather than generous. Nothing in the
    // vocabulary can cancel a timer, so one whose startFlag is satisfiable WILL
    // fire given enough turns, and this analysis is already optimistic about
    // ordering. Leaving them out was not caution, it was a hole.
    for (let ti = 0; ti < (world.timers || []).length; ti++) {
      if (firedTimers.has(ti)) continue;
      const t = world.timers[ti];
      if (t.startFlag && !flags.has(t.startFlag)) continue;
      firedTimers.add(ti);
      changed = true;
      applyEffects(t.do || []);
    }

    // 3. Fire every rule whose trigger is now performable and whose conditions hold.
    for (let i = 0; i < rules.length; i++) {
      if (firedRules.has(i)) continue;
      const r = rules[i];
      const on = r.on || {};
      if (on.room && !reachRooms.has(on.room)) continue;
      // The noun must be present for the player to act on it at all.
      if (on.noun && !nounReachable(on.noun)) continue;
      // A pairing needs both halves. Without this a rule gated on an unobtainable
      // second object would be assumed firable and mask a real dead end.
      if (on.second && !nounReachable(on.second)) continue;
      if (r.if && !r.if.every(canSatisfy)) continue;

      firedRules.add(i);
      changed = true;
      applyEffects(r.do || []);
    }
  }

  // --------------------------------------------------------------- the verdict
  if (!won) {
    err('E310', 'the win state is not reachable',
      'No sequence of reachable actions fires a "win" effect. Either a puzzle has ' +
      'no solution from the start state, or nothing declares a win.');
  }

  // Naming the blocker rather than guessing at it.
  //
  // This used to say "usually a missing exit or an unsatisfiable condition",
  // which was actively wrong in the case that mattered: the condition was
  // perfectly satisfiable and the analysis simply could not see what set it. A
  // report of fourteen unreachable things, none of which named a cause, cost the
  // author most of a build. Every entrance to the room is now listed with the
  // reason it does not open.
  const setters = new Map();
  const noteSetter = (list, what, index) => {
    for (const e of (list || [])) {
      if (e.type === 'set-flag' && e.value !== false) {
        if (!setters.has(e.flag)) setters.set(e.flag, { what, index });
      }
    }
  };
  rules.forEach((r, i) => noteSetter(r.do, 'rule ' + i +
    ' (' + (((r.on || {}).verb || '?') + ' ' + ((r.on || {}).noun || '')).trim() + ')', i));
  (world.timers || []).forEach((t, i) => noteSetter(t.do, 'timer ' + i, -1));

  // Why can that rule not fire? Naming the flag and the rule that sets it was
  // an improvement and still stopped one step short of the answer, which is
  // always one link further down the chain.
  function whyRuleStuck(idx) {
    const r = rules[idx];
    if (!r) return '';
    const on = r.on || {};
    if (on.room && !reachRooms.has(on.room)) {
      return ', and that rule needs the player in "' + on.room + '", which is also unreachable';
    }
    if (on.noun && !nounReachable(on.noun) && !everPresent.has(on.noun)) {
      return ', and that rule needs "' + on.noun + '", which the player can never reach';
    }
    if (on.second && !nounReachable(on.second) && !everPresent.has(on.second)) {
      return ', and that rule needs "' + on.second + '" in hand, which the player can never get';
    }
    const bad = (r.if || []).find(c => !canSatisfy(c));
    if (bad) {
      const what = bad.item || bad.room || bad.flag || bad.actor || bad.counter;
      return ', and that rule is itself waiting on ' + bad.type +
        (what ? ' "' + what + '"' : '') + ', which never becomes true';
    }
    return '';
  }

  function whyBlocked(ex, fromReachable) {
    if (!fromReachable) return 'its source room is itself unreachable';
    if (ex.door && !flags.has('_open_' + ex.door)) {
      return 'its door "' + ex.door + '" is never opened';
    }
    if (ex.condition && !canSatisfy(ex.condition)) {
      const f = ex.condition.flag;
      if (f) {
        if (!setters.has(f)) return 'it is gated on flag "' + f + '", which nothing ever sets';
        const set = setters.get(f);
        return 'it is gated on flag "' + f + '", set by ' + set.what +
          ', which never becomes reachable' + whyRuleStuck(set.index);
      }
      return 'its condition is never satisfied';
    }
    return 'no reason found, which is a bug worth reporting';
  }

  for (const room of world.rooms) {
    if (reachRooms.has(room.id)) continue;
    const ways = [];
    for (const other of world.rooms) {
      for (const ex of (other.exits || [])) {
        if (ex.to !== room.id) continue;
        ways.push(other.id + ' ' + ex.dir + ': ' + whyBlocked(ex, reachRooms.has(other.id)));
      }
    }
    const goes = rules.some(r => (r.do || []).some(e => e.type === 'goto' && e.room === room.id));
    err('E311', 'room "' + room.id + '" is unreachable',
      ways.length
        ? 'Every way in is closed. ' + ways.slice(0, 4).join('; ') + '.'
        : (goes ? 'No exit leads here. A rule sends the player here with goto, but that ' +
                  'rule is not reachable either.'
                : 'No exit anywhere leads to this room, and no rule sends the player here.'));
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
  //
  // "Can never be present" also has to mean EVER, not "at the end of the
  // analysis". The fixpoint moves things: feeding the dog sends it to NOWHERE, so
  // by the last round the dog is unreachable and the unguarded "it shows you its
  // teeth" fallback looked dead. A player meets that line every time they try the
  // dog empty-handed. Same failure as the ordering one above, arriving by a
  // different route, so the test is against everything that was reachable at any
  // point rather than against the final state.
  for (let i = 0; i < rules.length; i++) {
    if (firedRules.has(i)) continue;
    const on = rules[i].on || {};
    const roomDead = on.room && !reachRooms.has(on.room);
    const nounDead = (on.noun && !nounReachable(on.noun) && !everPresent.has(on.noun)) ||
      (on.second && !nounReachable(on.second) && !everPresent.has(on.second));
    if (roomDead || nounDead) {
      warn('W313', 'rule ' + i + ' (' + (on.verb || '?') + ' ' + (on.noun || '') +
        ') can never fire',
        roomDead ? 'Its room "' + on.room + '" is unreachable.'
                 : 'Its noun "' + on.noun + '" can never be present.');
    }
  }

  // Walks that are really cuts.
  //
  // A film cuts and a map cannot. An adaptation wired its scene changes as
  // compass exits, because that was the only way the format let anything move
  // between rooms, and the result was a game where leaving a Humvee on a road in
  // Afghanistan and heading OUT put you on the floor of Caesars Palace. Six more
  // like it: a Malibu roof to an Afghan village by walking south-east, a desert
  // to an airbase in California by walking west.
  //
  // A compass exit is a claim that two places are next to each other. When rooms
  // declare which region they are in, that claim is checkable, and the honest way
  // to express a jump is a rule with a goto: the player does something and the
  // story moves, which is what a cut actually is.
  //
  // Silent unless a world uses regions at all, because a game with none has made
  // no claim to check.
  const regionOf = {};
  let anyRegion = false;
  for (const room of world.rooms) {
    if (room.region) { regionOf[room.id] = room.region; anyRegion = true; }
  }
  if (anyRegion) {
    const crossings = [];
    for (const room of world.rooms) {
      const from = regionOf[room.id];
      for (const ex of (room.exits || [])) {
        const to = regionOf[ex.to];
        if (!from || !to || from === to) continue;
        crossings.push(room.id + ' ' + ex.dir + ' to ' + ex.to +
          ' (' + from + ' to ' + to + ')');
      }
    }
    if (crossings.length) {
      warn('W512', crossings.length + ' exit' + (crossings.length > 1 ? 's walk' : ' walks') +
        ' between regions',
        'A compass exit says two places are next to each other. These cross a region ' +
        'boundary, so a player walks from one part of the world to another in a step: ' +
        crossings.slice(0, 5).join('; ') +
        '. A scene change belongs in a rule with a goto, where the player does ' +
        'something and the story moves, rather than on the compass.');
    }
  }

  // Rules standing in front of rules.
  //
  // Two written, working scenes shipped certified and never played, because a
  // build step put expanded fallbacks above the room-specific rules they were
  // meant to back up. First match wins, so the general rule answered every time
  // and the specific one was dead. Nothing noticed: the world was sound, the
  // walkthrough finished, and the only way it was found was grepping a play
  // transcript for lines that should have been in it.
  //
  // A rule shadows a later one when it is unguarded and its trigger is at least
  // as broad: same verb or no verb at all, same noun or any noun, same room or
  // anywhere. The two-object case is the exception that matters, since a rule
  // without `second` never matches a paired command and so cannot shadow one.
  const broaderThan = (a, b) => {
    const A = a.on || {}, B = b.on || {};
    if (a.if && a.if.length) return false;              // guarded: may fall through
    if (A.enter || B.enter) return A.enter === B.enter;  // arrivals are their own path
    if (A.verb && String(A.verb).toUpperCase() !== String(B.verb || '').toUpperCase()) return false;
    if (A.noun && String(A.noun).toUpperCase() !== String(B.noun || '').toUpperCase()) return false;
    if (A.room && A.room !== B.room) return false;
    if (A.second) {
      return String(A.second).toUpperCase() === String(B.second || '').toUpperCase();
    }
    return !B.second;      // a bare rule cannot swallow a pairing
  };
  const shadowed = [];
  for (let j = 0; j < rules.length; j++) {
    for (let i = 0; i < j; i++) {
      if (!broaderThan(rules[i], rules[j])) continue;
      const on = rules[j].on || {};
      shadowed.push('rule ' + j + ' (' +
        ((on.verb || 'any') + ' ' + (on.noun || '')).trim() +
        (on.room ? ' in ' + on.room : '') + ') is shadowed by rule ' + i);
      break;
    }
  }
  if (shadowed.length) {
    warn('W511', shadowed.length + ' rule' + (shadowed.length > 1 ? 's are' : ' is') +
      ' unreachable behind an earlier one',
      'First match wins, so an unguarded rule answers every command a later, more ' +
      'specific one was written for, and the later one never runs. The world still ' +
      'works and the scene never plays. ' + shadowed.slice(0, 4).join('; ') +
      '. Move the specific rules above the general ones.');
  }

  // One-way passages you can walk through under-equipped.
  //
  // T2 proves a path exists. It is optimistic about ordering, so it assumes the
  // player picks everything up while it is still reachable, and that assumption
  // is exactly what a one-way passage breaks. A Verne adaptation certified with a
  // player who leaves the gun cotton in Hamburg unwinnable ninety moves later,
  // with no warning anywhere, because a path did exist: the one where you took it.
  //
  // So: for each passage with no way back, anything required on the far side and
  // obtainable only on the near side is a trap the player cannot undo.
  const canReturn = (from, to) => {
    const seen = new Set([to]);
    const queue = [to];
    while (queue.length) {
      const at = queue.shift();
      if (at === from) return true;
      for (const ex of ((rooms[at] || {}).exits || [])) {
        if (!seen.has(ex.to)) { seen.add(ex.to); queue.push(ex.to); }
      }
    }
    return false;
  };
  const reachableFrom = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      for (const ex of ((rooms[at] || {}).exits || [])) {
        if (!seen.has(ex.to)) { seen.add(ex.to); queue.push(ex.to); }
      }
    }
    return seen;
  };
  const neededBy = new Map();      // item -> a rule that requires carrying it
  rules.forEach((r, i) => {
    for (const c of (r.if || [])) {
      const walk = (x) => {
        if (!x) return;
        if (x.type === 'carrying' && !neededBy.has(x.item)) neededBy.set(x.item, i);
        if (x.type === 'not') walk(x.condition);
        for (const sub of (x.conditions || [])) walk(sub);
      };
      walk(c);
    }
    if ((r.on || {}).second && !neededBy.has(r.on.second)) neededBy.set(r.on.second, i);
  });

  const traps = [];
  for (const room of world.rooms) {
    for (const ex of (room.exits || [])) {
      if (!rooms[ex.to] || canReturn(room.id, ex.to)) continue;
      const beyond = reachableFrom(ex.to);
      for (const [itemId, ruleIdx] of neededBy) {
        const it = items[itemId];
        if (!it || !(it.attributes && it.attributes.TAKEBIT)) continue;
        const home = itemLoc[itemId];
        if (home === 'PLAYER' || beyond.has(home)) continue;     // still gettable
        const gateRoom = (rules[ruleIdx].on || {}).room;
        const gateNoun = (rules[ruleIdx].on || {}).noun;
        const gateAt = gateRoom || (gateNoun && itemLoc[gateNoun]);
        if (gateAt && !beyond.has(gateAt)) continue;             // needed before the drop
        traps.push(itemId + ' (left behind at ' + home + ', needed past ' +
          room.id + ' ' + ex.dir + ')');
      }
    }
  }
  if (traps.length) {
    warn('W510', traps.length + ' item' + (traps.length > 1 ? 's' : '') +
      ' can be left behind before a passage with no way back',
      'The walkthrough works because it carries them. A player who does not is ' +
      'stuck with no way to tell: ' + [...new Set(traps)].slice(0, 4).join('; ') +
      '. Give the passage a warning, put the item past it, or open a way back.');
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
