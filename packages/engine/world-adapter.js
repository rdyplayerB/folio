//  Path B, rendered by the real shell.
//
//  The shell was written against a Z-machine and reads three globals to do its
//  work: an interpreter, a bridge that projects the world, and a verb map that
//  turns a click into a command. Rewriting 1,500 lines of tuned interface code to
//  take a backend parameter would risk every pixel of a layout that works, so this
//  presents a declarative world THROUGH those same interfaces instead.
//
//  The surface the shell actually touches is small, which is what makes the
//  adapter viable rather than a second implementation:
//
//    interpreter   start · input · snapshot · restore · getGlobal
//    bridge        init · state · lampFraction
//    verb map      noun · command · needsSecond · magicWords
//
//  Everything else the shell does — scenes, hit testing, the inventory strip, the
//  save UI, the portrait board — already runs off the World State Contract, so it
//  works unchanged the moment `state()` returns something sensible.
//
//  This is a bridge in the temporary sense. The shell becomes properly
//  backend-agnostic when it accepts a contract-speaking object directly, and at
//  that point this file deletes itself. Until then it is honest about what it is.

(function (root) {
  'use strict';

  var World = (root.FolioWorld && root.FolioWorld.World) || null;

  /**
   * Install a Path B world into the globals the shell reads.
   * @param {object} def  a parsed world.json
   */
  function install(def, opts) {
    opts = opts || {};
    var GUE = root.GUE = root.GUE || {};
    if (!World) throw new Error('world-adapter: @folio/world must load first');

    var world = null;

    // ---- the interpreter shim ------------------------------------------------
    // Constructed the way the shell constructs a Z-machine, so boot() needs no
    // special case: `new GUE.ZMachine(story)` works and the story argument is
    // ignored, since a world carries its own definition.
    function WorldMachine() {
      world = new World(def, { seed: opts.seed === undefined ? 1234 : opts.seed });
      this.world = world;
    }

    WorldMachine.prototype.start = function () {
      return (def.meta && def.meta.title ? def.meta.title + '\n\n' : '') + world.describe();
    };

    // The shell hands over a whole typed line; the world engine wants verb and
    // noun. Splitting here keeps that difference in one place.
    WorldMachine.prototype.input = function (line) {
      var parts = String(line || '').trim().split(/\s+/);
      var verb = parts.shift() || '';
      var noun = parts.length ? parts.join(' ').toUpperCase() : null;
      return world.submit(verb, noun).prose;
    };

    // Saves. A declarative world's whole state is plain data, so a snapshot is a
    // structured clone rather than a memory image.
    WorldMachine.prototype.snapshot = function () {
      return {
        here: world.here, moves: world.moves, score: world.score,
        flags: JSON.parse(JSON.stringify(world.flags)),
        counters: JSON.parse(JSON.stringify(world.counters || {})),
        actorClock: JSON.parse(JSON.stringify(world.actorClock || {})),
        loc: JSON.parse(JSON.stringify(world.loc)),
        actorLoc: JSON.parse(JSON.stringify(world.actorLoc)),
        visited: Array.from(world.visited),
        timers: world.timers.map(function (t) { return { elapsed: t.elapsed, done: !!t.done }; }),
        ended: world.ended
      };
    };

    WorldMachine.prototype.restore = function (snap) {
      if (!snap) return false;
      world.here = snap.here;
      world.moves = snap.moves;
      world.score = snap.score;
      world.flags = JSON.parse(JSON.stringify(snap.flags));
      world.counters = JSON.parse(JSON.stringify(snap.counters || {}));
      world.actorClock = JSON.parse(JSON.stringify(snap.actorClock || {}));
      world.loc = JSON.parse(JSON.stringify(snap.loc));
      world.actorLoc = JSON.parse(JSON.stringify(snap.actorLoc));
      world.visited = new Set(snap.visited || []);
      (snap.timers || []).forEach(function (t, i) {
        if (world.timers[i]) { world.timers[i].elapsed = t.elapsed; world.timers[i].done = t.done; }
      });
      world.ended = snap.ended || null;
      return true;
    };

    // The shell reads globals 1 and 2 for score and moves when the bridge has not
    // produced them yet.
    WorldMachine.prototype.getGlobal = function (n) {
      if (n === 1) return world.score;
      if (n === 2) return world.moves;
      return 0;
    };

    GUE.ZMachine = WorldMachine;

    // ---- the bridge shim -----------------------------------------------------
    GUE.bridge = {
      init: function () { return this; },
      state: function () { return world.state(); },
      lampFraction: function () {
        var t = world.lampTurns();
        if (t === null) return null;
        // Fuel capacity comes from the item that declares it, so the gauge is
        // right for any game rather than for one lamp in one game.
        var max = 1;
        for (var id in world.items) {
          var it = world.items[id];
          if (it.attributes && it.attributes.LIGHTSOURCE && it.fuel) { max = it.fuel; break; }
        }
        return Math.max(0, Math.min(1, t / max));
      }
    };

    // ---- the verb map shim ---------------------------------------------------
    // A Z-machine game ships a hand-written verb map because its parser has
    // idioms. A declarative world does not: verbs and nouns are already the ids
    // the rules match on, so the mapping is mechanical.
    var names = {};
    (def.items || []).concat(def.actors || []).forEach(function (x) {
      names[x.id] = x.name || x.id;
    });

    GUE.verbmap = {
      noun: function (objId) {
        if (!objId) return '';
        if (String(objId).charAt(0) === '_') return '';   // shell pseudo-objects
        return names[objId] || String(objId).toLowerCase().replace(/-/g, ' ');
      },
      command: function (verb, objId, obj2Id) {
        var v = String(verb || '').toUpperCase();
        if (!objId) return v;
        // The world engine matches on ids, so the id is what gets sent. The
        // display name is only ever for the player's eyes.
        return v + ' ' + objId + (obj2Id ? ' ' + obj2Id : '');
      },
      // Whether to ask for a second target, decided per verb AND NOUN.
      //
      // Asking per verb alone was a real bug and a bad one. One rule anywhere in
      // the game pairing something with USE made every USE wait for a second
      // object, so a player who selected USE and clicked the thing that opens the
      // first room got silence and stayed there. Any game mixing paired and
      // unpaired uses of the same verb was unfinishable by clicking.
      //
      // A second object is wanted only when a rule actually pairs THIS thing.
      needsSecond: function (verb, objId) {
        var v = String(verb || '').toUpperCase();
        var n = objId ? String(objId).toUpperCase() : null;
        return (def.rules || []).some(function (r) {
          if (!r.on || !r.on.second) return false;
          if (String(r.on.verb || '').toUpperCase() !== v) return false;
          // With no noun yet the answer is about the verb in general, which is
          // what the interface wants before anything has been picked.
          if (!n) return true;
          return String(r.on.noun || '').toUpperCase() === n;
        });
      },
      magicWords: (def.meta && def.meta.magicWords) || []
    };

    // ---- static world table --------------------------------------------------
    // The shell falls back to this when live exits are unavailable.
    GUE.WORLD = { rooms: {} };
    (def.rooms || []).forEach(function (r) {
      GUE.WORLD.rooms[r.id] = { name: r.name || r.id, exits: r.exits || [] };
    });

    // A Z-machine game boots from base64; the shell checks for it before doing
    // anything else, so give it something non-empty to find.
    GUE.STORY_BASE64 = GUE.STORY_BASE64 || 'AA==';

    return GUE;
  }

  root.FolioWorldAdapter = { install };
})(typeof window !== 'undefined' ? window : globalThis);
