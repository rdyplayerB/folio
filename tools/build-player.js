#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Builds the LITE player: the fallback shell, for Path B world games that the
//  full shell does not render yet. One HTML file, everything inlined.
//
//  Self-contained is the requirement, not the convenience. A .folio and a player
//  should both survive being emailed, dropped on a USB stick, or hosted on a dead
//  simple static server twenty years from now. Every dependency on a CDN is a
//  future 404, and the prior art here is unambiguous — PuzzleScript's entire
//  library became unreachable because its sharing depended on somebody else's API.
//
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8');

// The engine's own 8x8 bitmap font, from the vendored copy that ships with this
// repository. Reading it from a sibling checkout worked on one machine and broke
// the moment CI ran, which is the whole argument for vendoring it.
const font = read(path.join(ROOT, 'packages/engine/vendor/font.js'));

const parts = [
  '// --- engine font (8x8 bitmap, from the origin engine) ---',
  'window.GUE = window.GUE || {};',
  font,
  '// --- .folio reader ---',
  read(path.join(ROOT, 'packages/engine/browser-zip.js')),
  '// --- Path B: declarative world interpreter ---',
  read(path.join(ROOT, 'packages/world/index.js')),
  '// --- shell: renders the World State Contract ---',
  read(path.join(ROOT, 'packages/engine/shell-lite.js')),
  '// --- player ---',
  read(path.join(ROOT, 'packages/engine/player.js'))
].join('\n\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Folio Player</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: #0b0b10; color: #d8d8d8;
    font: 13px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; padding: 16px;
  }
  #stage { display: grid; place-items: center; width: 100%; max-width: 1024px; flex: 1; }
  canvas { image-rendering: pixelated; display: block; }
  #bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
  label.file {
    border: 1px solid #3a3a44; padding: 7px 12px; cursor: pointer; color: #f8d878;
    letter-spacing: .06em; text-transform: uppercase; font-size: 11px;
  }
  label.file:hover, label.file:focus-within { background: #16161c; }
  input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; }
  #title { color: #9a9aa4; }
  #err { color: #f87858; max-width: 60ch; text-align: center; }
</style>
</head>
<body>
  <div id="stage"><canvas id="screen" width="256" height="240"></canvas></div>
  <div id="bar">
    <label class="file" tabindex="0">Open .folio<input type="file" id="pick" accept=".folio,.zip"></label>
    <span id="title"></span>
  </div>
  <div id="err" role="alert"></div>

<script>
${parts}
</script>

<script>
(function () {
  'use strict';
  const canvas = document.getElementById('screen');
  const errEl = document.getElementById('err');
  const titleEl = document.getElementById('title');

  async function boot(bytes) {
    errEl.textContent = '';
    try {
      const game = await FolioPlayer.openFolio(bytes);
      titleEl.textContent = game.manifest.title + '  ·  by ' + game.manifest.author;
      FolioPlayer.mount(canvas, game, GUE.font);
      window.__folioReady = true;   // headless tests wait on this
    } catch (e) {
      errEl.textContent = String(e.message || e);
      window.__folioError = String(e.message || e);
    }
  }

  document.getElementById('pick').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) boot(await f.arrayBuffer());
  });

  // Drag a .folio anywhere onto the page.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) boot(await f.arrayBuffer());
  });

  // ?game=<url> so a gallery can link straight into a playable game.
  const url = new URLSearchParams(location.search).get('game');
  if (url) fetch(url).then(r => r.arrayBuffer()).then(boot).catch(e => {
    errEl.textContent = 'could not fetch ' + url + ': ' + e.message;
  });

  window.__folioBoot = boot;   // test hook
})();
</script>
</body>
</html>
`;

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'player.html');
fs.writeFileSync(out, html);
console.log('built ' + out + '  (' + Math.round(html.length / 1024) + ' KB, self-contained)');
