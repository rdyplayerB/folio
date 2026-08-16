#!/usr/bin/env node
/* eslint-disable no-console */
// Capture a gallery thumbnail from a .folio by booting it and screenshotting the
// scene pane. The tile makes itself — a maker supplies no artwork, because the
// engine already renders every room.
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
  await p.setViewport({ width: 900, height: 800, deviceScaleFactor: 3 });
  await p.goto('file://' + path.join(ROOT, 'dist', 'player.html'), { waitUntil: 'domcontentloaded' });
  await p.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await window.__folioBoot(u8.buffer);
  }, fs.readFileSync(folio).toString('base64'));
  await new Promise(r => setTimeout(r, 400));

  // Crop to the scene pane only: the gallery wants the game's world, not its chrome.
  const box = await p.evaluate(() => {
    const c = document.getElementById('screen');
    const r = c.getBoundingClientRect();
    const s = r.width / 256;
    return { x: r.left + 8 * s, y: r.top + 20 * s, width: 240 * s, height: 96 * s };
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await p.screenshot({ path: out, clip: box });
  await b.close();
  console.log('shot ' + out);
})();
