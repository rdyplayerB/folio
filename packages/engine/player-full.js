//  The full player — boots the real shell from a .folio.
//
//  An earlier version of this file rendered through a shell I wrote from scratch,
//  and it was wrong in a way worth recording: it threw away years of refinement.
//  The real shell carries a portrait phone board, an inventory strip, the status
//  bar with its lamp gauge, an on-screen keyboard, save slots, hover labels, and a
//  layout tuned by actual play. Reimplementing it produced something that worked
//  and looked nothing like the game.
//
//  So the engine ships the real shell verbatim in vendor/, and the .folio supplies
//  the parts that belong to a game rather than to the engine: the story, the
//  presentation binding, the verb map, and the scene art.
//
//  The shell still boots itself from globals — it was written for a page with
//  script tags, not for a container. Bridging that here is deliberate and
//  temporary: the shell becomes backend-agnostic when it takes a contract-speaking
//  object instead of reading GUE.STORY_BASE64, and that refactor is the next step,
//  not a thing to fake now.

(function (root) {
  'use strict';

  async function load(bytes) {
    const files = await root.FolioZip.readFolio(bytes);
    if (!files['manifest.json']) throw new Error('not a .folio: no manifest.json');
    const manifest = root.FolioZip.json(files['manifest.json']);
    if (manifest.logicType !== 'zmachine') {
      throw new Error('the full shell currently boots zmachine games; this is "' +
        manifest.logicType + '"');
    }

    const GUE = root.GUE = root.GUE || {};

    // --- logic: the story file, handed over as the base64 the shell expects ---
    const storyName = Object.keys(files).find(n => /^logic\/.+\.z\d$/.test(n));
    if (!storyName) throw new Error('.folio declares zmachine but carries no story file');
    GUE.STORY_BASE64 = bytesToB64(files[storyName]);

    // --- presentation: the binding from story object numbers to stable ids ---
    const rm = root.FolioZip.json(files['presentation/roommap.json']);
    Object.assign(GUE, rm);

    // --- presentation: verb map and scene art are code that draws, and they
    //     belong to THIS GAME, so they travel inside its container ---
    for (const name of Object.keys(files).sort()) {
      if (!/^presentation\/.*\.js$/.test(name)) continue;
      runInPage(root.FolioZip.text(files[name]));
    }

    return { manifest, files };
  }

  // Evaluate a presentation script against the page's own globals. These files use
  // the same attach-to-GUE pattern as the engine, so they need the same names bound
  // that a browser would have leaked to them from `window.GUE = ...`.
  function runInPage(src) {
    const fn = new Function('window', 'globalThis', 'GUE', 'module', src);
    fn(root, root, root.GUE, undefined);
  }

  function bytesToB64(u8) {
    let s = '';
    const CHUNK = 0x8000;   // chunked: String.fromCharCode blows the stack on 86KB
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  root.FolioFullPlayer = { load };
})(typeof window !== 'undefined' ? window : globalThis);
