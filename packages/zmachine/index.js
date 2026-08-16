//  @folio/zmachine — Path A logic backend for the Folio engine.
//
//  Runs an unmodified Z-machine story file and projects its live memory into the
//  World State Contract (see packages/format/world-state-contract.md). The binary
//  is the referee: this package never writes to interpreter memory, it only reads.
//
//  The interpreter and bridge in src/ are carried over verbatim from the origin
//  project, where they are pinned by a 428-command Zork I playthrough that reaches
//  350 points and is cross-validated against dfrotz. They use a global-attachment
//  pattern (`GUE.*`) so the same files can be dropped into a page with script tags.
//  This entry point gives them a module boundary without touching a line of them —
//  the whole point being that extraction must not be able to change behaviour.

'use strict';

/**
 * Create an isolated Folio logic backend over a Z-machine story file.
 *
 * Each call gets its own global namespace, so two games can run in one process
 * without colliding — which the origin project's script-tag pattern could not do,
 * and which the gallery needs the moment it previews two games at once.
 *
 * @param {Uint8Array|Buffer} storyBytes  the story file, unmodified
 * @param {object} opts
 * @param {object} opts.roommap    presentation binding for this story: at minimum
 *                                 ROOMMAP / OBJMAP (z-object → stable id) and
 *                                 ADVENTURER. Optionally GLOBALS. This is game
 *                                 data, not engine data — in a .folio it ships in
 *                                 presentation/, so the engine must be handed it
 *                                 rather than reaching for a path of its own.
 * @param {number} [opts.seed]     RNG seed; set for reproducible runs
 * @returns {{ zm: object, bridge: object, state: function }}
 */
function createBackend(storyBytes, opts) {
  opts = opts || {};
  if (!opts.roommap || !opts.roommap.ROOMMAP) {
    throw new Error(
      '@folio/zmachine: opts.roommap is required (needs ROOMMAP, OBJMAP, ADVENTURER). ' +
      'It is game data and ships inside the .folio package, not with the engine.'
    );
  }

  // A private namespace per backend instance. The src files read and write ROOT.GUE,
  // so handing each instance its own ROOT is what buys us isolation for free.
  const ns = {};
  const sandbox = { GUE: ns };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  loadInto(sandbox, require.resolve('./src/zmachine.js'));
  if (opts.roommap) Object.assign(ns, opts.roommap);
  loadInto(sandbox, require.resolve('./src/bridge.js'));

  if (typeof ns.ZMachine !== 'function') {
    throw new Error('@folio/zmachine: src/zmachine.js did not export GUE.ZMachine');
  }
  const zm = new ns.ZMachine(storyBytes);
  if (typeof opts.seed === 'number' && zm.rngSeed) zm.rngSeed(opts.seed);

  const bridge = ns.bridge;
  if (bridge && bridge.init) bridge.init(zm);

  // Run to the first prompt. Until this happens the machine has executed no code,
  // so the projection would report an empty world at score 0 — technically true
  // and completely useless. A backend hands back a *started* game.
  const banner = zm.start();

  return {
    zm,
    bridge,
    /** Opening text produced by booting the story file. */
    banner,
    /** Project current interpreter memory into the World State Contract. */
    state: () => bridge.state()
  };
}

// Evaluate a global-attachment source file against a supplied namespace object.
// Deliberately not `vm.runInNewContext`: these files are trusted first-party code
// and a real VM context would break `instanceof` across the boundary.
function loadInto(sandbox, file) {
  const fs = require('fs');
  const src = fs.readFileSync(file, 'utf8');
  // These files were written for a browser, where `window.GUE = …` also creates a
  // bare global `GUE`. Node has no such leak, so bind both names explicitly —
  // otherwise the first file that says `GUE.ROOMMAP = {…}` dies on a ReferenceError.
  const fn = new Function('window', 'globalThis', 'global', 'self', 'GUE', 'module', src);
  fn(sandbox, sandbox, sandbox, sandbox, sandbox.GUE, undefined);
}

module.exports = { createBackend };
