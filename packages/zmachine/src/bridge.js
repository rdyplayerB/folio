// engine/bridge.js — turns live Z-machine memory into the world-model view the
// UI renders from. Reads only; never writes to the machine and never decides
// game logic. Every number in here comes from tools/calibrate.js (see
// data/roommap.js), which solved the object map and the flag->attribute
// assignment against data/zork1_world.json and proved them unique.
(typeof window !== 'undefined' ? window : globalThis).GUE =
  (typeof window !== 'undefined' ? window : globalThis).GUE || {};

(function () {
  'use strict';

  var ROOT = (typeof window !== 'undefined') ? window : globalThis;
  var GUE = ROOT.GUE;

  // In node, data/roommap.js has to be loaded before us; in the browser the
  // build concatenates it ahead of this file.
  if (typeof module !== 'undefined' && module.exports && !GUE.ROOMMAP) {
    require('../data/roommap.js');
  }
  if (typeof module !== 'undefined' && module.exports && !GUE.GLOBALS) {
    try { require('../data/globals.js'); } catch (e) { /* optional; S.globals stays empty */ }
  }

  // ---- globals (gmain.zil): G00 = HERE, G01 = SCORE, G02 = MOVES ------------
  var G_HERE = 0, G_SCORE = 1, G_MOVES = 2;

  // Creatures the UI treats as "a fight is happening here".
  var FOES = ['TROLL', 'THIEF', 'CYCLOPS'];

  // Flags surfaced for every object in S.flags. Key = lowercase UI name,
  // value = ZIL flag name in GUE.ATTR.
  var FLAG_VIEW = {
    open:    'OPENBIT',
    on:      'ONBIT',
    light:   'LIGHTBIT',
    take:    'TAKEBIT',
    cont:    'CONTBIT',
    trans:   'TRANSBIT',
    surface: 'SURFACEBIT',
    door:    'DOORBIT',
    read:    'READBIT',
    burn:    'BURNBIT',
    weapon:  'WEAPONBIT',
    tool:    'TOOLBIT',
    climb:   'CLIMBBIT',
    veh:     'VEHBIT',
    actor:   'ACTORBIT',
    ndesc:   'NDESCBIT',
    invis:   'INVISIBLE',
    sacred:  'SACREDBIT'
  };

  var bridge = {
    zm: null,
    ROOM_TO_Z: null,     // world.json room id -> z-object number
    OBJ_TO_Z: null,      // world.json object id -> z-object number
    _cache: null
  };

  // ------------------------------------------------------------------- init
  bridge.init = function (zm) {
    if (!zm) throw new Error('GUE.bridge.init: needs a ZMachine');
    if (!GUE.ROOMMAP || !GUE.OBJMAP || !GUE.ATTR) {
      throw new Error('GUE.bridge.init: data/roommap.js must load first');
    }
    this.zm = zm;
    this.ROOM_TO_Z = invert(GUE.ROOMMAP);
    this.OBJ_TO_Z = invert(GUE.OBJMAP);
    this._cache = null;
    return this;
  };

  function invert(map) {
    var out = {}, k;
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out[map[k]] = +k;
    return out;
  }

  // ------------------------------------------------------------ id <-> z-obj
  // world.json id (room OR object) -> z-object number, or 0 if it has none.
  bridge.zOf = function (id) {
    return this.OBJ_TO_Z[id] || this.ROOM_TO_Z[id] || 0;
  };
  // z-object number -> world.json id, or null for entities world.json doesn't
  // model (the ADVENTURER, pseudo-objects, the LOCAL-GLOBALS bucket).
  bridge.idOf = function (z) {
    return GUE.OBJMAP[z] || GUE.ROOMMAP[z] || null;
  };

  // --------------------------------------------------------------- attributes
  // attr(id, 'OPENBIT') — accepts a world.json id or a raw z-object number.
  bridge.attr = function (idOrZ, flagName) {
    var z = (typeof idOrZ === 'number') ? idOrZ : this.zOf(idOrZ);
    var bit = GUE.ATTR[flagName];
    if (!z || bit === undefined) return false;
    return this.zm.attr(z, bit);
  };

  // Where is this thing right now? -> world.json id of its parent, or null.
  bridge.parentOf = function (id) {
    var z = this.zOf(id);
    return z ? this.idOf(this.zm.objParent(z)) : null;
  };

  bridge.isIn = function (id, containerId) {
    return this.parentOf(id) === containerId;
  };

  bridge.held = function (id) {
    var z = this.zOf(id);
    return !!z && this.zm.objParent(z) === GUE.ADVENTURER;
  };

  // Full flag record for ANY object, wherever it is. Scenes use this for state
  // they can't see in S.objects (is the dam open? is the troll still alive?).
  bridge.flagsOf = function (idOrZ) {
    var z = (typeof idOrZ === 'number') ? idOrZ : this.zOf(idOrZ);
    var out = {}, k;
    if (!z) return out;
    for (k in FLAG_VIEW) out[k] = this.zm.attr(z, GUE.ATTR[FLAG_VIEW[k]]);
    return out;
  };

  // ------------------------------------------------------------- containment
  // Direct children of a z-object, nearest-first, skipping INVISIBLE.
  bridge.childrenZ = function (z) {
    var out = [], c = this.zm.objChild(z), guard = 0;
    var INVIS = GUE.ATTR.INVISIBLE;
    while (c && guard++ < 512) {
      if (!this.zm.attr(c, INVIS)) out.push(c);
      c = this.zm.objSibling(c);
    }
    return out;
  };

  // Can we see inside this container? (open, or transparent)
  bridge.seeInside = function (z) {
    return this.zm.attr(z, GUE.ATTR.OPENBIT) || this.zm.attr(z, GUE.ATTR.TRANSBIT);
  };

  // ------------------------------------------------------------------ lit?
  // ZIL's LIT?: the room itself carries ONBIT, or something in scope (room
  // contents or the player's inventory, recursing through see-through
  // containers) is a light source that is switched on.
  // ONBIT alone is the test, exactly as LIT? does it (gparser.zil:1333 sets
  // P-GWIMBIT to ONBIT and searches for it). Do NOT also require LIGHTBIT: the
  // burning MATCH is lit with <FSET ,MATCH ,ONBIT> (1actions.zil:2277) and has
  // no LIGHTBIT, so an ONBIT+LIGHTBIT test reports darkness in the one window
  // where the match is your only light — the shell would black out a room the
  // game is busy describing. Only LAMP, CANDLES and TORCH carry LIGHTBIT.
  bridge.anyLightIn = function (z, depth) {
    var kids = this.childrenZ(z), i, c;
    var ON = GUE.ATTR.ONBIT;
    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (this.zm.attr(c, ON)) return true;
      if ((depth || 0) < 4 && this.zm.objChild(c) && this.seeInside(c)) {
        if (this.anyLightIn(c, (depth || 0) + 1)) return true;
      }
    }
    return false;
  };

  bridge.isLit = function (roomZ) {
    if (!roomZ) return false;
    if (this.zm.attr(roomZ, GUE.ATTR.ONBIT)) return true;      // daylight / lit room
    return this.anyLightIn(roomZ, 0) || this.anyLightIn(GUE.ADVENTURER, 0);
  };

  // -------------------------------------------------------------- live exits
  // Reads the room's direction properties straight out of memory, so
  // conditional exits reflect the CURRENT game state (trap door barred, grate
  // unlocked, ...) rather than world.json's static declaration.
  //
  // Property length encodes the exit type:
  //   1 UEXIT [room] | 2 NEXIT [msg] | 3 FEXIT [routine]
  //   4 CEXIT [room, globalVar, msgWord] | 5 DEXIT [room, doorObj, msgWord, ?]
  // The gating byte sits at offset +1 in both cases. Verified by decoding the
  // else-message at offset +2: TROLL-ROOM.EAST -> "The troll fends you off with
  // a menacing gesture.", CYCLOPS-ROOM.UP -> "The cyclops doesn't look like
  // he'll let you past." — see tools/globals.js.
  // The 7 FEXIT exits. A ZIL routine picks the destination, so unlike CEXIT/DEXIT
  // there is no room number in the property to read — without this table the
  // compass has to offer all seven unconditionally and lies about the two that
  // are really just a door. UI affordance ONLY: the game still referees the move,
  // and a wrong guess here costs an arrow, never a wrong outcome.
  //
  //   door:  offer only while that door is open; report `to` when it is
  //   to:    the destination to report, or `true` for "offer it, don't say where"
  //
  // LIVING-ROOM  DOWN  TRAP-DOOR-EXIT       1actions.zil:567  RUG-MOVED && TRAP-DOOR open -> CELLAR
  // GRATING-CLR  DOWN  GRATING-EXIT         1dungeon.zil:1400 GRATE-REVEALED && GRATE open -> GRATING-ROOM
  // STUDIO       UP    UP-CHIMNEY-FUNCTION  1actions.zil:553  -> KITCHEN, refused if hands too full
  // MAZE-2/7/9/12 DOWN MAZE-DIODES          1actions.zil:898  -> MAZE-4 / DEAD-END-1 / MAZE-11 / MAZE-5
  //
  // Both door cases really test a global too (RUG-MOVED, GRATE-REVEALED), but the
  // door cannot be opened before that global is set, so OPENBIT alone is exact.
  // The four maze diodes deliberately report `true` rather than their destination:
  // MAZE-DIODES is a one-way drop and naming the far side would spoil the maze.
  var FEXITS = {
    'LIVING-ROOM':      { DOWN: { door: 'TRAP-DOOR', to: 'CELLAR' } },
    'GRATING-CLEARING': { DOWN: { door: 'GRATE', to: 'GRATING-ROOM' } },
    'STUDIO':           { UP:   { to: 'KITCHEN' } },
    'MAZE-2':           { DOWN: { to: true } },
    'MAZE-7':           { DOWN: { to: true } },
    'MAZE-9':           { DOWN: { to: true } },
    'MAZE-12':          { DOWN: { to: true } }
  };

  // Resolve one FEXIT for the compass. Unknown routines fall through to `true`
  // so a future story file degrades to "offer it" instead of hiding an exit.
  bridge.fexit = function (roomId, dir) {
    var rule = FEXITS[roomId] && FEXITS[roomId][dir];
    if (!rule) return true;
    if (rule.door) {
      var doorZ = this.zOf(rule.door);
      if (!doorZ || !this.zm.attr(doorZ, GUE.ATTR.OPENBIT)) return false;
    }
    return rule.to;
  };

  bridge.exitsOf = function (roomZ) {
    var out = {}, dir, prop, addr, len, destZ, id;
    var roomId = this.idOf(roomZ);
    if (!roomZ) return out;
    // propAddr/byte are past the zm surface CONTRACTS.md guarantees. If the
    // interpreter does not offer them, report no live exits rather than throwing
    // out of state() — the shell still has GUE.WORLD's static exit table.
    if (typeof this.zm.propAddr !== 'function' || typeof this.zm.byte !== 'function') {
      this.liveExits = false;
      return out;
    }
    this.liveExits = true;
    for (dir in GUE.DIRPROP) {
      prop = GUE.DIRPROP[dir];
      addr = this.zm.propAddr(roomZ, prop);
      if (!addr) continue;
      len = (this.zm.byte(addr - 1) >> 5) + 1;
      if (GUE.EXIT_HAS_ROOM.indexOf(len) < 0) {
        // NEXIT (2) is a refusal message and never passable. FEXIT (3) hands the
        // decision to a routine — see the FEXITS table above.
        out[dir] = (len === 2) ? false : this.fexit(roomId, dir);
        continue;
      }
      // Field offsets are ZIL's own: CEXITFLAG = DEXITOBJ = byte 1, the message is
      // the word at byte 2 (gverbs.zil:2008-2013 — CEXITSTR/DEXITSTR are word
      // index 1). West of House SW reads "f4 7b 00 00" = room 244 Stone Barrow,
      // gated on variable 0x7b, no refusal message.
      destZ = this.zm.byte(addr);
      if (len === 4) {                                  // CEXIT: gated on a global
        // Variable numbers 16..255 are globals 0..239, hence the -16.
        var flagVar = this.zm.byte(addr + 1);
        if (!this.zm.getGlobal(flagVar - 16)) { out[dir] = false; continue; }
      } else if (len === 5) {                           // DEXIT: gated on a door
        var doorZ = this.zm.byte(addr + 1);
        if (doorZ && !this.zm.attr(doorZ, GUE.ATTR.OPENBIT)) { out[dir] = false; continue; }
      }
      id = this.idOf(destZ);
      out[dir] = id || true;
    }
    return out;
  };

  // ================================================== world-state flags (globals)
  // Numbers come from data/globals.js (generated by tools/globals.js). Counters
  // are reported as numbers; every other flag is reported as a boolean, because
  // ZIL's T is stored as 1 and its false as 0.
  var COUNTERS = { MATCH_COUNT: 1, DEATHS: 1, SCORE: 1, MOVES: 1, HERE: 1 };

  bridge.globals = function () {
    var out = {}, name, n;
    if (!GUE.GLOBALS) return out;
    for (name in GUE.GLOBALS) {
      if (!Object.prototype.hasOwnProperty.call(GUE.GLOBALS, name)) continue;
      n = this.zm.getGlobal(GUE.GLOBALS[name]);
      out[name] = COUNTERS[name] ? n : !!n;
    }
    return out;
  };

  // Lantern fuel. Not a global — it is the tick count of the lamp's clock
  // interrupt, at a fixed address in dynamic memory. Reads 0 until the lamp has
  // been switched on once (the interrupt is not queued before that), so report
  // null rather than pretending the lamp is empty.
  bridge.lampTurns = function () {
    if (!GUE.LAMP_TURNS_ADDR || typeof this.zm.word !== 'function') return null;
    var v = this.zm.word(GUE.LAMP_TURNS_ADDR);
    if (!v || v > GUE.LAMP_TURNS_MAX) return null;
    return v;
  };

  // 0..1 fuel gauge for the UI, or null when not yet meaningful.
  bridge.lampFraction = function () {
    var t = this.lampTurns();
    return t === null ? null : Math.max(0, Math.min(1, t / GUE.LAMP_TURNS_MAX));
  };

  // ===================================================================== state
  bridge.state = function () {
    var zm = this.zm;
    if (!zm) throw new Error('GUE.bridge.state: call init(zm) first');

    var roomZ = zm.getGlobal(G_HERE);
    var roomId = this.idOf(roomZ);
    var lit = this.isLit(roomZ);

    var S = {
      roomId: roomId,
      roomZ: roomZ,
      roomName: zm.objName(roomZ),
      score: sgn(zm.getGlobal(G_SCORE)),
      moves: zm.getGlobal(G_MOVES),
      dark: !lit,
      objects: [],
      inventory: [],
      flags: {},
      fighting: false,
      exits: this.exitsOf(roomZ),
      contents: {},      // { containerId: [ids inside] }, one level deep
      globals: this.globals(),     // world-state flags: dam gates, rainbow, troll...
      lampTurns: this.lampTurns()  // lantern fuel left, or null before it is first lit
    };

    var self = this;
    function record(z) {
      var id = self.idOf(z);
      if (!id) return null;
      S.flags[id] = self.flagsOf(z);
      return id;
    }

    // --- what is in the room (the adventurer is not scenery) ---------------
    this.childrenZ(roomZ).forEach(function (z) {
      if (z === GUE.ADVENTURER) return;
      var id = record(z);
      if (id) S.objects.push(id);
      // one level into open/transparent containers so a lit lamp inside a bag
      // or the leaflet inside the mailbox is visible to the scene.
      // Actors are skipped: the THIEF is CONTBIT+OPENBIT, so descending into him
      // would spill every treasure he has stolen into the room's object list and
      // the scene would draw the loot lying on the floor.
      if (self.seeInside(z) && !self.zm.attr(z, GUE.ATTR.ACTORBIT)) {
        var inner = [];
        self.childrenZ(z).forEach(function (c) {
          var cid = record(c);
          if (!cid) return;
          inner.push(cid);
          if (S.objects.indexOf(cid) < 0) S.objects.push(cid);
        });
        if (inner.length && id) S.contents[id] = inner;
      }
    });

    // --- what the player is carrying ---------------------------------------
    this.childrenZ(GUE.ADVENTURER).forEach(function (z) {
      var id = record(z);
      if (id) S.inventory.push(id);
      if (self.seeInside(z)) {
        var inner = [];
        self.childrenZ(z).forEach(function (c) {
          var cid = record(c);
          if (cid) inner.push(cid);
        });
        if (inner.length && id) S.contents[id] = inner;
      }
    });

    // --- is something trying to kill us right now --------------------------
    for (var i = 0; i < FOES.length; i++) {
      if (S.objects.indexOf(FOES[i]) >= 0) { S.fighting = true; break; }
    }

    this._cache = S;
    return S;
  };

  function sgn(v) { return v & 0x8000 ? v - 0x10000 : v; }

  // ------------------------------------------------------------------ extras
  // Contents of a container, as world.json ids (for the inventory UI).
  bridge.contentsOf = function (id) {
    var z = this.zOf(id), self = this;
    if (!z) return [];
    return this.childrenZ(z).map(function (c) { return self.idOf(c); })
      .filter(function (x) { return !!x; });
  };

  // Everything in the trophy case, i.e. the treasures actually banked.
  bridge.deposited = function () { return this.contentsOf('TROPHY-CASE'); };

  // ------------------------------------------------------------------- debug
  // Live introspection, so a wrong constant can be found and corrected in
  // seconds instead of guessed at. Safe to call from the browser console.
  bridge._debug = {
    // Every ZIL flag currently set on a thing (world.json id or z-object number).
    attrs: function (o) {
      var z = (typeof o === 'number') ? o : bridge.zOf(o), out = [], f;
      for (f in GUE.ATTR) if (bridge.zm.attr(z, GUE.ATTR[f])) out.push(f);
      return out;
    },
    // Raw attribute bit numbers, including any this build has no name for.
    bits: function (o) {
      var z = (typeof o === 'number') ? o : bridge.zOf(o), out = [], i;
      for (i = 0; i < 32; i++) if (bridge.zm.attr(z, i)) out.push(i);
      return out;
    },
    // Snapshot now, call the result later: reports which bits the game flipped.
    // The fast way to confirm what an action actually toggles.
    watch: function (o) {
      var before = bridge._debug.bits(o);
      return function () {
        var after = bridge._debug.bits(o);
        return {
          set: after.filter(function (b) { return before.indexOf(b) < 0; }),
          cleared: before.filter(function (b) { return after.indexOf(b) < 0; })
        };
      };
    },
    // Why is it (not) dark? Each term of LIT? shown separately.
    lit: function () {
      var roomZ = bridge.zm.getGlobal(G_HERE);
      return {
        room: bridge.idOf(roomZ),
        roomOnBit: bridge.zm.attr(roomZ, GUE.ATTR.ONBIT),
        lightInRoom: bridge.anyLightIn(roomZ, 0),
        lightCarried: bridge.anyLightIn(GUE.ADVENTURER, 0),
        dark: !bridge.isLit(roomZ)
      };
    },
    // Containment subtree with names and mapped ids.
    tree: function (o, depth) {
      var z = (typeof o === 'number') ? o : bridge.zOf(o);
      var walk = function (x, d) {
        var node = { z: x, name: bridge.zm.objName(x), id: bridge.idOf(x), kids: [] }, c;
        if (d <= 0) return node;
        for (c = bridge.zm.objChild(x); c; c = bridge.zm.objSibling(c)) node.kids.push(walk(c, d - 1));
        return node;
      };
      return walk(z, depth === undefined ? 2 : depth);
    },
    // Find z-object numbers by short-name substring — covers the 18 objects
    // world.json does not model (pseudo-objects, the ADVENTURER, globals).
    find: function (sub) {
      var out = [], z, nm;
      for (z = 1; z <= 250; z++) {
        nm = bridge.zm.objName(z) || '';
        if (nm.toLowerCase().indexOf(String(sub).toLowerCase()) >= 0) {
          out.push({ z: z, name: nm, id: bridge.idOf(z), parent: bridge.zm.objParent(z) });
        }
      }
      return out;
    },
    // Confirm the loaded story file is the one roommap.js was calibrated against:
    // every mapped z-object must still carry the short name we matched it by.
    verify: function () {
      var world = GUE.WORLD, bad = [], k;
      for (k in GUE.ROOMMAP) if (!bridge.zm.objName(+k)) bad.push(k + ' ' + GUE.ROOMMAP[k]);
      return {
        rooms: Object.keys(GUE.ROOMMAP).length,
        objects: Object.keys(GUE.OBJMAP).length,
        adventurer: GUE.ADVENTURER,
        liveExits: bridge.liveExits !== false,
        nameless: bad,
        worldLoaded: !!world
      };
    }
  };

  GUE.bridge = bridge;
  if (typeof module !== 'undefined' && module.exports) module.exports = bridge;
})();
