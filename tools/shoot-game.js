#!/usr/bin/env node
/* eslint-disable no-console */
//
// Capture a gallery thumbnail from a .folio by booting it and screenshotting the
// scene pane. The tile makes itself — a maker supplies no artwork, because the
// engine already renders every room.
//
// The crop is READ FROM THE RUNNING SHELL rather than hardcoded. An earlier
// version assumed a layout and silently captured the wrong rectangle; the shell
// publishes its own geometry, and the portrait board is a different shape again,
// so asking is the only thing that stays correct.
//
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(process.env.HOME, 'projects-games/zork1/node_modules/puppeteer'));
const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const [folio, out] = process.argv.slice(2);
  if (!folio || !out) { console.error('usage: shoot-game.js <file.folio> <out.png>'); process.exit(1); }

  const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 900, deviceScaleFactor: 3 });
  await p.goto('file://' + path.join(ROOT, 'dist', 'player-full.html'), { waitUntil: 'domcontentloaded' });
  await p.evaluate(async (b64) => {
    const s = atob(b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    await window.__folioBoot(u.buffer);
  }, fs.readFileSync(folio).toString('base64'));
  await new Promise(r => setTimeout(r, 1600));

  const box = await p.evaluate(() => {
    if (!window.GUE || !GUE.shell || !GUE.shell.canvas()) return null;
    const c = GUE.shell.canvas();
    const L = GUE.shell.layout;
    const r = c.getBoundingClientRect();
    const sx = r.width / L.W, sy = r.height / L.H;
    return { x: r.left + L.SCENE.x * sx, y: r.top + L.SCENE.y * sy,
             width: L.SCENE.w * sx, height: L.SCENE.h * sy };
  });
  if (!box) { console.error('the shell did not boot; nothing to capture'); process.exit(1); }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await p.screenshot({ path: out, clip: box });
  await b.close();
  console.log('shot ' + out + '  ' + Math.round(box.width) + 'x' + Math.round(box.height));
})();
