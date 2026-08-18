//  @folio/world — Path B logic backend: a declarative world interpreter.
//
//  Runs a world.json directly. This is how a story that was never a game becomes
//  one: there is no compiler and no scripting language, only data. A .folio can
//  therefore never contain executable code, which is a security property worth
//  advertising and the reason a game is safe to open from a stranger.
//
//  Deliberately less expressive than ZIL or Inform. A bounded model is what makes
//  generation reliable and validation tractable: because every effect comes from a
//  closed vocabulary, the validator can see statically everything a game can ever
//  do. When the vocabulary genuinely cannot express something the community needs,
//  it grows in a spec revision — with conformance fixtures keeping old games alive.
//
//  It emits the same World State Contract as @folio/zmachine. That is the whole
//  point: one shell, two backends, and a cross-path parity suite to keep them
//  honest as both evolve.

'use strict';

const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW', 'UP', 'DOWN', 'IN', 'OUT'];

class World {
  constructor(world, opts) {
    opts = opts || {};
    this.def = world;
    this.rng = mulberry32(opts.seed !== undefined ? opts.seed : (world.meta && world.meta.seed) || 1);

    this.rooms = index(world.rooms);
    this.items = index(world.items);
    this.actors = index(world.actors || []);
    this.rules = world.rules || [];
    this.timers = (world.timers || []).map(t => Object.assign({ elapsed: 0 }, t));

    this.flags = Object.assign({}, world.flags);
    // Numbers. Flags are booleans, and without counters an author has no way to
    // say "the third time" except by chaining near-identical rules and reading
    // trip number out of flag state. That was the workaround the first cold build
    // reached for, and it called it out as the idiom nothing had taught it.
    this.counters = Object.assign({}, world.counters);
    this.here = world.meta.start;
    this.moves = 0;
    this.score = 0;
    this.ended = null;             // null | {win:boolean, reason:string}
    this.visited = new Set([this.here]);

    // Live location per item: room id, 'PLAYER', or a container's id.
    this.loc = {};
    for (const it of world.items) this.loc[it.id] = it.location;
    this.actorLoc = {};
    for (const a of (world.actors || [])) this.actorLoc[a.id] = a.location;
    this.actorClock = {};

    this.log = [];
  }

  // -------------------------------------------------------------- contract
  /** Project into the World State Contract — identical shape to @folio/zmachine. */
  state() {
    const room = this.rooms[this.here] || {};
    const objects = [];
    const contents = {};
    const flags = {};

    for (const id of Object.keys(this.loc)) {
      const where = this.loc[id];
      const item = this.items[id];
      if (!item) continue;
      if (where === this.here) {
        objects.push(id);
        flags[id] = this.flagsOf(id);
      } else if (this.items[where] && this.loc[where] === this.here && this.isOpen(where)) {
        // One level into open containers, matching the Z-machine projection.
        objects.push(id);
        flags[id] = this.flagsOf(id);
        (contents[where] = contents[where] || []).push(id);
      }
    }
    for (const id of Object.keys(this.actorLoc)) {
      // "PLAYER" means travelling with you, the same way it means carried for an
      // item. An adaptation of a novel about three people walking together had no
      // way to say Hans follows, so he was teleported between his eight
      // plot-critical rooms and existed as prose everywhere else, which meant
      // speaking to him anywhere else hit the absent default.
      if (this.actorLoc[id] === this.here || this.actorLoc[id] === 'PLAYER') {
        objects.push(id);
        flags[id] = this.flagsOf(id);
      }
    }

    const inventory = Object.keys(this.loc).filter(id => this.loc[id] === 'PLAYER');
    for (const id of inventory) flags[id] = this.flagsOf(id);

    return {
      roomId: this.here,
      roomName: room.name || this.here,
      score: this.score,
      moves: this.moves,
      dark: this.isDark(),
      objects,
      inventory,
      contents,
      flags,
      exits: this.exits(),
      // Counters live alongside flags in globals rather than in a key of their
      // own, because the contract has to look identical on both paths and a
      // Z-machine game has no counters to report.
      globals: Object.assign({}, this.flags, this.counters),
      fighting: objects.some(id => this.actors[id] && this.actors[id].hostile),
      lampTurns: this.lampTurns()
    };
  }

  /**
   * Live exits, keyed by direction. Three states, not two:
   *   "ROOM-ID"  passable now
   *   false      the passage exists but is blocked (locked door, boarded window)
   *   absent     no passage in that direction at all
   *
   * The middle state is the one worth having: it lets the compass grey out a door
   * the player can see but cannot yet use, which is information the player needs.
   * Path A emits it natively (Zork's boarded front door reports EAST: false), and
   * cross-path parity is what surfaced that Path B was collapsing it. An author who
   * genuinely wants a passage concealed marks the exit `hidden` and it disappears
   * entirely until its condition is met.
   */
  exits() {
    const room = this.rooms[this.here];
    const out = {};
    if (!room) return out;
    for (const ex of (room.exits || [])) {
      if (!DIRS.includes(ex.dir)) continue;
      const blocked = (ex.condition && !this.test(ex.condition)) ||
                      (ex.door && !this.isOpen(ex.door));
      if (blocked) {
        if (!ex.hidden) out[ex.dir] = false;
      } else {
        out[ex.dir] = ex.to;
      }
    }
    return out;
  }

  flagsOf(id) {
    const thing = this.items[id] || this.actors[id] || {};
    const a = Object.assign({}, thing.attributes);
    if (this.flags['_open_' + id] !== undefined) a.OPENBIT = !!this.flags['_open_' + id];
    if (this.flags['_lit_' + id] !== undefined) a.ONBIT = !!this.flags['_lit_' + id];
    return a;
  }

  /** Is this thing somewhere the player could look at it? */
  visibleHere(id) {
    if (this.loc[id] === 'PLAYER' || this.loc[id] === this.here) return true;
    if (this.actorLoc[id] === this.here || this.actorLoc[id] === 'PLAYER') return true;
    const where = this.loc[id];
    return !!(where && this.items[where] && this.loc[where] === this.here && this.isOpen(where));
  }

  isOpen(id) {
    if (this.flags['_open_' + id] !== undefined) return !!this.flags['_open_' + id];
    const it = this.items[id] || {};
    return !!(it.attributes && (it.attributes.OPENBIT || it.attributes.TRANSPARENT));
  }

  isLit(id) {
    if (this.flags['_lit_' + id] !== undefined) return !!this.flags['_lit_' + id];
    const it = this.items[id] || {};
    return !!(it.attributes && it.attributes.ONBIT);
  }

  isDark() {
    const room = this.rooms[this.here] || {};
    if (!room.dark) return false;
    // A lit light source in the room or carried defeats the dark.
    for (const id of Object.keys(this.loc)) {
      const it = this.items[id];
      if (!it || !it.attributes || !it.attributes.LIGHTSOURCE) continue;
      if (!this.isLit(id)) continue;
      if (this.loc[id] === 'PLAYER' || this.loc[id] === this.here) return false;
    }
    return true;
  }

  lampTurns() {
    const lamp = Object.keys(this.items).find(id =>
      this.items[id].attributes && this.items[id].attributes.LIGHTSOURCE &&
      this.items[id].fuel !== undefined);
    if (!lamp) return null;
    const used = this.flags['_fuelUsed_' + lamp] || 0;
    return Math.max(0, this.items[lamp].fuel - used);
  }

  // ---------------------------------------------------------------- command
  /**
   * Submit a command. Returns verbatim authored prose plus the new state.
   * Rules are consulted first; the engine's default responses only speak when no
   * rule matched, so authors write the interesting cases and nothing else.
   */
  submit(verb, noun, indirect) {
    if (this.ended) return { prose: this.endText(), state: this.state() };
    verb = String(verb || '').toUpperCase();
    noun = noun ? String(noun).toUpperCase() : null;

    indirect = indirect ? String(indirect).toUpperCase() : null;

    let prose = null;
    for (const rule of this.rules) {
      if (!this.matches(rule, verb, noun, indirect)) continue;
      if (rule.if && !rule.if.every(c => this.test(c))) continue;
      prose = this.apply(rule.do || []);
      break;
    }
    if (prose === null) prose = this.builtin(verb, noun);

    this.moves++;
    const timed = this.tickTimers();
    if (timed) prose += '\n\n' + timed;
    const moved = this.tickActors();
    if (moved) prose += '\n\n' + moved;
    if (this.ended) prose += '\n\n' + this.endText();

    this.log.push({ verb, noun, prose });
    return { prose, state: this.state() };
  }

  matches(rule, verb, noun, indirect) {
    const on = rule.on || {};
    // Arrival and encounter rules are dispatched by fireEnter and tickActors and
    // nowhere else. Every other field here is optional, so without this they
    // would match the first command of any kind and answer the whole game.
    if (on.enter || on.meets) return false;
    if (on.verb && String(on.verb).toUpperCase() !== verb) return false;
    if (on.noun && String(on.noun).toUpperCase() !== noun) return false;
    if (on.room && on.room !== this.here) return false;
    // Two-object interactions: USE KEY ON DOOR, PUT EGG IN CASE.
    //
    // The board has always had this. TWO_OBJ marks USE and HIT as taking a
    // second target, so the interface asks the player to click another thing and
    // sends it. matches() then dropped it on the floor, and no rule could ever
    // name it, so the player picked two objects and the game said nothing. The
    // central MacVenture gesture was wired up at both ends and connected to
    // nothing in the middle.
    if (on.second && String(on.second).toUpperCase() !== indirect) return false;
    // A rule with no `second` must not swallow a two-object command, or the
    // one-object fallback fires first and the specific pairing never runs.
    if (!on.second && indirect) return false;
    return true;
  }

  /** Closed condition vocabulary — everything the validator must reason about. */
  test(c) {
    switch (c.type) {
      case 'flag': return !!this.flags[c.flag] === (c.value === undefined ? true : !!c.value);
      case 'carrying': return this.loc[c.item] === 'PLAYER';
      case 'in-room': return this.loc[c.item] === this.here;
      case 'present': return this.loc[c.item] === 'PLAYER' || this.loc[c.item] === this.here;
      case 'at': return this.here === c.room;
      case 'visited': return this.visited.has(c.room);
      case 'open': return this.isOpen(c.item);
      case 'lit': return this.isLit(c.item);
      // Rolls come off the world's own seeded generator, so a game plays the same
      // way every time it is played and a walkthrough that passed keeps passing.
      // Within a single run the rolls differ, which is what a fight needs.
      case 'chance': return this.rng() * 100 < (c.percent === undefined ? 50 : c.percent);
      case 'score-at-least': return this.score >= c.value;
      case 'counter-at-least': return (this.counters[c.counter] || 0) >= c.value;
      case 'counter-equals': return (this.counters[c.counter] || 0) === c.value;
      case 'actor-here':
        return this.actorLoc[c.actor] === this.here || this.actorLoc[c.actor] === 'PLAYER';
      case 'fighting': return Object.keys(this.actorLoc).some(id =>
        (this.actorLoc[id] === this.here || this.actorLoc[id] === 'PLAYER') &&
        this.actors[id] && this.actors[id].hostile);
      case 'not': return !this.test(c.condition);
      // Boolean composition. Only `not` nested before, so an author needing OR
      // had to mirror it into a flag by hand and keep the two in step.
      case 'all': return (c.conditions || []).every(x => this.test(x));
      case 'any': return (c.conditions || []).some(x => this.test(x));
      default: return false;
    }
  }

  /** Closed effect vocabulary. No scripting; a .folio can contain no code. */
  apply(effects) {
    const said = [];
    for (const e of effects) {
      switch (e.type) {
        case 'print': said.push(e.text); break;
        case 'set-flag': this.flags[e.flag] = e.value === undefined ? true : e.value; break;
        case 'move-item': this.loc[e.item] = e.to; break;
        case 'take': this.loc[e.item] = 'PLAYER'; break;
        case 'destroy': this.loc[e.item] = 'NOWHERE'; break;
        case 'open': this.flags['_open_' + e.item] = true; break;
        case 'close': this.flags['_open_' + e.item] = false; break;
        case 'light': this.flags['_lit_' + e.item] = true; break;
        case 'extinguish': this.flags['_lit_' + e.item] = false; break;
        case 'goto': this.here = e.room; this.visited.add(e.room); break;   // arrival fires via goTo
        case 'score': this.score += e.value; break;
        case 'set-counter': this.counters[e.counter] = e.value; break;
        case 'add-counter':
          this.counters[e.counter] = (this.counters[e.counter] || 0) + e.value; break;
        case 'move-actor': this.actorLoc[e.actor] = e.to; break;
        // An ending is allowed more than one breath. A single string made the
        // whole epilogue of a novel-length adaptation one monolithic wall: it
        // read well and it was a scroll rather than a scene.
        case 'win':
          this.ended = { win: true, reason: endingText(e), pages: endingPages(e) }; break;
        case 'lose':
          this.ended = { win: false, reason: endingText(e), pages: endingPages(e) }; break;
        default: break;   // unknown effects are inert; T1 rejects them at validation
      }
    }
    return said.join('\n');
  }

  /**
   * Characters that go about their business.
   *
   * The largest single thing the format could not express was Zork's thief: a
   * person who wanders the map, takes what you are carrying, and keeps it
   * somewhere. Measured against the ZIL source, characters and combat are 39 of
   * the 72 routines that need real code — more than half of everything the closed
   * vocabulary could not reach.
   *
   * This is that shape without the code. An actor with a `patrol` moves; one with
   * `takes` helps itself; a rule with `on.meets` answers when it turns up. None of
   * it is scripting, so the dependency analysis can still see everything the world
   * is able to do, which is the whole reason the vocabulary is closed.
   */
  tickActors() {
    const said = [];
    for (const actor of (this.def.actors || [])) {
      const at = this.actorLoc[actor.id];
      if (at === 'NOWHERE' || at === 'PLAYER') continue;

      // ---- moving --------------------------------------------------------
      const p = actor.patrol;
      if (p) {
        const clock = this.actorClock[actor.id] = (this.actorClock[actor.id] || 0) + 1;
        const every = p.every || 1;
        const willing = p.chance === undefined ? true : this.rng() * 100 < p.chance;
        if (clock % every === 0 && willing) {
          const route = (p.rooms && p.rooms.length)
            ? p.rooms
            : (this.def.rooms || []).map(r => r.id);
          if (route.length) {
            // Round the route in order when one is given, because a patrol is a
            // beat a player can learn. A named route that shuffled would be
            // indistinguishable from teleporting.
            const i = route.indexOf(at);
            const next = (p.rooms && p.rooms.length)
              ? route[(i + 1) % route.length]
              : route[(this.rng() * route.length) | 0];
            if (next && next !== at) {
              const wasHere = at === this.here, nowHere = next === this.here;
              this.actorLoc[actor.id] = next;
              if (wasHere && !nowHere && p.leaves) said.push(p.leaves);
              if (!wasHere && nowHere && p.arrives) said.push(p.arrives);
            }
          }
        }
      }

      // ---- helping itself -------------------------------------------------
      const t = actor.takes;
      if (t && this.actorLoc[actor.id] === this.here) {
        const willing = t.chance === undefined ? true : this.rng() * 100 < t.chance;
        if (willing) {
          const wanted = Object.keys(this.loc).filter(id => {
            if (this.loc[id] !== 'PLAYER') return false;
            if (Array.isArray(t.what)) return t.what.indexOf(id) >= 0;
            const it = this.items[id];
            return !!(it && it.attributes && it.attributes.TAKEBIT);
          });
          if (wanted.length) {
            const got = wanted[(this.rng() * wanted.length) | 0];
            this.loc[got] = t.to || 'NOWHERE';
            said.push(t.says ||
              ('The ' + (actor.name || actor.id).toLowerCase() + ' takes the ' +
                ((this.items[got] || {}).name || got.toLowerCase()) + '.'));
          }
        }
      }

      // ---- and what happens when it is here -------------------------------
      if (this.actorLoc[actor.id] === this.here) {
        for (const rule of this.rules) {
          if ((rule.on || {}).meets !== actor.id) continue;
          if (rule.if && !rule.if.every(c => this.test(c))) continue;
          const text = this.apply(rule.do || []);
          if (text) said.push(text);
          break;
        }
      }
    }
    return said.join('\n');
  }

  tickTimers() {
    const fired = [];
    for (const t of this.timers) {
      if (t.done) continue;
      if (t.startFlag && !this.flags[t.startFlag]) continue;
      // A countdown you cannot defeat is a cutscene. Without a stop condition
      // the most Verne-appropriate mechanic in the book, dying of thirst unless
      // you find water, was unwritable: a lose inside a timer could not be
      // cancelled or guarded by any means the format offered.
      if (t.stopFlag && this.flags[t.stopFlag]) { t.done = true; continue; }
      if (t.if && !t.if.every(c => this.test(c))) continue;
      t.elapsed++;
      if (t.fuelFor) this.flags['_fuelUsed_' + t.fuelFor] = t.elapsed;
      if (t.elapsed >= t.turns) {
        t.done = !t.repeat;
        if (!t.repeat) t.elapsed = 0;
        const text = this.apply(t.do || []);
        if (text) fired.push(text);
      }
    }
    return fired.join('\n');
  }

  /**
   * Move the player, then let the room react to their arrival.
   *
   * Nothing could happen BECAUSE the player arrived somewhere: every consequence
   * had to hang off a verb, so a floor that gives way when you step on it, or an
   * ambush, or a door closing behind you, were all unwritable. That is a large
   * part of what an adventure does to you rather than for you.
   */
  goTo(dest, depth) {
    this.here = dest;
    this.visited.add(dest);
    let text = this.describe();
    const extra = this.fireEnter(dest, depth || 0);
    return extra ? text + '\n\n' + extra : text;
  }

  fireEnter(room, depth) {
    if (depth > 8) return '';         // an entry rule that walks you onward
    for (const rule of this.rules) {
      const on = rule.on || {};
      if (on.enter !== room) continue;
      if (rule.if && !rule.if.every(c => this.test(c))) continue;
      const before = this.here;
      const said = this.apply(rule.do || []);
      // If the rule moved the player on, describe where they ended up.
      if (this.here !== before) {
        return said + (said ? '\n\n' : '') + this.goTo(this.here, depth + 1);
      }
      return said;
    }
    return '';
  }

  endText() {
    return this.ended ? this.ended.reason : '';
  }

  /** Default responses. Tone is configurable so authors only write what matters. */
  builtin(verb, noun) {
    const room = this.rooms[this.here] || {};
    const tone = (this.def.meta && this.def.meta.defaults) || {};
    if (DIRS.includes(verb)) {
      const dest = this.exits()[verb];
      if (!dest) {
        // A refusal that belongs to the passage rather than to the whole game.
        // One global `blocked` string was shown for a locked gate in Hamburg and
        // a granite wall thirty leagues under the Atlantic, and the only way to
        // say anything specific was a guarded rule sitting above every exit.
        const ex = ((room.exits || []).find(x => x.dir === verb) || {});
        return ex.blocked || tone.blocked || 'You cannot go that way.';
      }
      return this.goTo(dest);
    }
    switch (verb) {
      case 'LOOK': {
        // LOOK with a noun is EXAMINE. It used to ignore the noun entirely and
        // re-describe the room, so clicking LOOK on an object told you about the
        // floor, and inspecting anything had to be hand-rolled as a USE rule,
        // which then counted the object as load-bearing.
        if (!noun) return this.describe();
        const it = this.items[noun] || this.actors[noun];
        if (!it) return tone.absent || 'You do not see that here.';
        if (!this.visibleHere(noun)) return tone.absent || 'You do not see that here.';
        return it.description || tone.plain ||
          ('You see nothing special about the ' + (it.name || String(noun).toLowerCase()) + '.');
      }
      // Letting a turn go by is a move in its own right, and every parser since
      // 1977 has had it. LOOK passed a turn as a side effect, which is not the
      // same as being able to say "I wait".
      case 'WAIT': case 'Z': return tone.wait || 'Time passes.';
      case 'TAKE': {
        if (!noun) return tone.what || 'Take what?';
        if (this.loc[noun] === 'PLAYER') return tone.already || 'You already have that.';
        if (this.loc[noun] !== this.here) return tone.absent || 'You do not see that here.';
        const it = this.items[noun] || {};
        if (!(it.attributes && it.attributes.TAKEBIT)) return tone.fixed || 'That is not something you can carry.';
        this.loc[noun] = 'PLAYER';
        return tone.taken || 'Taken.';
      }
      case 'DROP':
        if (this.loc[noun] !== 'PLAYER') return tone.nothave || 'You are not carrying that.';
        this.loc[noun] = this.here;
        return tone.dropped || 'Dropped.';
      case 'OPEN':
        if (!this.items[noun]) return tone.absent || 'You do not see that here.';
        if (this.isOpen(noun)) return tone.alreadyOpen || 'It is already open.';
        return tone.locked || 'It will not open.';
      case 'INVENTORY': {
        const inv = Object.keys(this.loc).filter(i => this.loc[i] === 'PLAYER');
        if (!inv.length) return tone.empty || 'You are empty-handed.';
        return 'You are carrying:\n' + inv.map(i => '  ' + ((this.items[i] || {}).name || i)).join('\n');
      }
      default:
        return tone.unknown || 'Nothing happens.';
    }
  }

  describe() {
    if (this.isDark()) {
      return (this.def.meta && this.def.meta.defaults && this.def.meta.defaults.dark) ||
        'It is pitch black.';
    }
    const room = this.rooms[this.here] || {};
    const here = Object.keys(this.loc).filter(i => this.loc[i] === this.here);
    // A room that reads the same before and after everything that happens in it
    // is a backdrop rather than a place. Variants are tried in order and the
    // first whose conditions hold wins, falling back to `prose`.
    //
    // Without this the only dynamic room text was an item's roomProse, so an
    // author wanting a hall to change once the ogre wakes had to park scenery in
    // NOWHERE and move it in. That trick worked and nothing had taught it, which
    // is a sign the format was missing something rather than that the author was
    // clever.
    let body = room.prose || '';
    for (const v of (room.variants || [])) {
      if ((v.if || []).every(c => this.test(c))) { body = v.prose; break; }
    }
    let out = (room.name || this.here) + '\n' + body;
    for (const id of here) {
      const it = this.items[id];
      if (it && it.roomProse) out += '\n' + it.roomProse;
    }
    return out;
  }
}

// An ending is either one string or a run of beats. Both collapse to `reason`
// for anything that only wants the text; `pages` is there for a presentation
// layer that can pace them.
function endingPages(e) {
  if (Array.isArray(e.pages) && e.pages.length) return e.pages.slice();
  return [e.text || ''];
}
function endingText(e) {
  return endingPages(e).filter(Boolean).join('\n\n') ||
    (e.type === 'win' ? 'You have won.' : 'You have died.');
}

function index(list) {
  const out = {};
  for (const x of (list || [])) out[x.id] = x;
  return out;
}

// Small deterministic PRNG. Determinism is not a nicety here: walkthrough replay,
// the blind solver, and every regression transcript depend on identical runs.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a Path B backend. Mirrors @folio/zmachine's createBackend shape. */
function createBackend(worldJson, opts) {
  // Accept a string, raw bytes (Buffer in node, Uint8Array in a browser), or an
  // already-parsed object. The engine has to run in a page with no build step, so
  // it cannot assume Buffer exists.
  let def = worldJson;
  if (typeof worldJson === 'string') {
    def = JSON.parse(worldJson);
  } else if (worldJson && typeof worldJson.byteLength === 'number') {
    def = JSON.parse(new TextDecoder().decode(worldJson));
  }
  if (!def || !def.meta || !def.meta.start) {
    throw new Error('@folio/world: world.json needs meta.start');
  }
  const w = new World(def, opts);
  return {
    world: w,
    banner: (def.meta.title || 'Untitled') + '\n\n' + w.describe(),
    state: () => w.state(),
    submit: (verb, noun, indirect) => w.submit(verb, noun, indirect)
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBackend, World };
if (typeof window !== 'undefined') { window.FolioWorld = { createBackend, World }; }
