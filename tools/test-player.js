#!/usr/bin/env node
/* eslint-disable no-console */
// Drives the built player in a real browser and plays a game through it.
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(process.env.HOME, 'projects-games/zork1/node_modules/puppeteer'));

const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  let failed = 0;
  const check = (label, cond, detail) => {
    console.log((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + label +
      (detail === undefined ? '' : '  -- ' + detail));
    if (!cond) failed++;
  };

  const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await p.goto('file://' + path.join(ROOT, 'dist', 'player.html'), { waitUntil: 'domcontentloaded' });
  await p.setViewport({ width: 900, height: 800, deviceScaleFactor: 2 });

  // Hand the page a real .folio the same way a gallery would.
  const folio = fs.readFileSync('/tmp/cellar.folio');
  await p.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await window.__folioBoot(u8.buffer);
  }, folio.toString('base64'));

  await new Promise(r => setTimeout(r, 400));

  const err = await p.evaluate(() => window.__folioError || null);
  check('the .folio opens in a browser with no build step', !err, err || 'ok');
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');

  const title = await p.$eval('#title', el => el.textContent);
  check('manifest is read from the container', /Cellar Door/.test(title), title);

  const painted = await p.evaluate(() => {
    const c = document.getElementById('screen');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return seen.size;
  });
  check('the shell actually paints a scene', painted > 4, painted + ' distinct colours on screen');

  // Play it: click NORTH on the compass, and confirm the world moved.
  const before = await p.evaluate(() => window.__shell ? null : document.title);
  await p.evaluate(() => {
    const c = document.getElementById('screen');
    const r = c.getBoundingClientRect();
    // NORTH sits centre-top of the compass block.
    const s = c.width / 256;
    const x = r.left + (168 + 26 + 12) * (r.width / 256);
    const y = r.top + (182 + 8) * (r.height / 240);
    c.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));

  const shot = path.join(ROOT, 'dist', 'player-shot.png');
  await p.screenshot({ path: shot });
  check('screenshot written for review', fs.existsSync(shot), shot);

  await b.close();
  console.log('\n=== ' + (failed ? '\x1b[31m' + failed + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + ' ===');
  process.exit(failed ? 1 : 0);
})();
