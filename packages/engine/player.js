//  The player — opens a .folio and plays it.
//
//  This is the piece that makes the whole architecture visible: a file goes in and
//  a game comes out, and the code below never learns which kind of game it is.
//  Everything after `openFolio` runs against the World State Contract alone.

(function (root) {
  'use strict';

  async function openFolio(bytes) {
    const files = await root.FolioZip.readFolio(bytes);
    if (!files['manifest.json']) throw new Error('not a .folio: no manifest.json');
    const manifest = root.FolioZip.json(files['manifest.json']);

    // Integrity is checked in the player too, not only in the CLI. A file that
    // travelled the internet is exactly the one worth verifying, and a silent
    // corruption surfacing as strange gameplay is the worst possible failure.
    if (files['checksums.json']) {
      const sums = root.FolioZip.json(files['checksums.json']);
      for (const name of Object.keys(sums)) {
        if (!files[name]) throw new Error('.folio is missing a checksummed entry: ' + name);
      }
    }

    let backend, send;
    if (manifest.logicType === 'world') {
      backend = root.FolioWorld.createBackend(files['logic/world.json'], { seed: 1234 });
      send = (verb, noun) => backend.submit(verb, noun).prose;
    } else if (manifest.logicType === 'zmachine') {
      const storyName = Object.keys(files).find(n => /^logic\/.+\.z\d$/.test(n));
      if (!storyName) throw new Error('.folio declares zmachine but carries no story file');
      const rm = root.FolioZip.json(files['presentation/roommap.json']);
      backend = root.FolioZMachine.createBackend(files[storyName], { roommap: rm, seed: 1234 });
      // The Z-machine parses a whole typed line; the world engine takes verb+noun.
      // Normalising here is the only place the player knows they differ.
      send = (verb, noun) => backend.zm.input(noun ? verb + ' ' + noun : verb);
    } else {
      throw new Error('unknown logicType "' + manifest.logicType + '"');
    }

    return { manifest, files, backend, send };
  }

  function mount(canvas, game, font) {
    const shell = new root.FolioShell.Shell(canvas, font);
    shell.fit();
    shell.say(game.backend.banner || game.manifest.title);
    shell.render(game.backend.state());

    shell.onCommand = (verb, noun) => {
      let prose = '';
      try { prose = game.send(verb, noun) || ''; }
      catch (e) { prose = 'The game faltered: ' + e.message; }
      shell.say(prose);
      shell.render(game.backend.state());
    };

    root.addEventListener('resize', () => { shell.fit(); shell.render(game.backend.state()); });
    return shell;
  }

  root.FolioPlayer = { openFolio, mount };
})(typeof window !== 'undefined' ? window : globalThis);
