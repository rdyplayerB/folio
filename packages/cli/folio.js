#!/usr/bin/env node
/* eslint-disable no-console */
//
//  folio — the command line for building, checking and playing .folio games.
//
//    folio pack <dir> <out.folio>    assemble a game
//    folio validate <file.folio>     run the tiered checks
//    folio info <file.folio>         what is inside
//    folio play <file.folio>         play it in the terminal
//
//  `play` exists deliberately: a headless player is what makes the walkthrough
//  replay, the blind solver, and the corpus profiler possible later, and being
//  able to actually play a game from a terminal is the fastest way to notice
//  that something is wrong with it.
//
'use strict';

const fs = require('fs');
const path = require('path');
const { pack, load } = require('../format/pack.js');
const { validate } = require('../validator/index.js');
const { createBackend } = require('../zmachine/index.js');
const world = require('../world/index.js');

const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' };

// Both logic paths open the same way from the caller's side. That symmetry is not
// cosmetic — it is the World State Contract doing its job, and if this function
// ever needs to know which backend it has beyond construction, the contract has
// sprung a leak.
function openGame(file) {
  const game = load(fs.readFileSync(file));

  if (game.manifest.logicType === 'zmachine') {
    const rmFile = game.files['presentation/roommap.json'];
    if (!rmFile) throw new Error('game is missing presentation/roommap.json');
    const story = Object.keys(game.files).find(n => /^logic\/.+\.z\d$/.test(n));
    const be = createBackend(game.files[story], {
      roommap: JSON.parse(rmFile.toString('utf8')), seed: 1234
    });
    // The Z-machine parses a whole typed line; the world engine takes verb+noun.
    // Normalising here keeps the play loop identical for both.
    return { game, backend: be, send: (line) => be.zm.input(line) };
  }

  if (game.manifest.logicType === 'world') {
    const be = world.createBackend(game.files['logic/world.json'], { seed: 1234 });
    return {
      game,
      backend: be,
      send: (line) => {
        const [verb, ...rest] = line.split(/\s+/);
        return be.submit(verb, rest.length ? rest.join(' ').toUpperCase() : null).prose;
      }
    };
  }

  throw new Error('unknown logicType "' + game.manifest.logicType + '"');
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'pack') {
    const [dir, out] = args;
    if (!dir || !out) throw new Error('usage: folio pack <dir> <out.folio>');
    const buf = pack(dir);
    fs.writeFileSync(out, buf);
    console.log('packed ' + out + '  ' + C.dim + buf.length.toLocaleString() + ' bytes' + C.off);

  } else if (cmd === 'validate') {
    const [file] = args;
    if (!file) throw new Error('usage: folio validate <file.folio>');
    const game = load(fs.readFileSync(file));
    const r = validate(game);
    for (const x of r.findings) {
      const col = x.level === 'error' ? C.red : C.yellow;
      console.log(col + x.level.toUpperCase() + C.off + ' ' + C.dim + x.code + C.off + '  ' + x.msg);
      if (x.hint) console.log('        ' + C.dim + x.hint + C.off);
    }
    const badge = !r.ok ? C.red + 'INVALID' + C.off
      : r.tier === 'playable' ? C.green + 'PLAYABLE' + C.off
      : C.green + 'VALID' + C.off;
    console.log('\n' + badge + '  ' + path.basename(file) + '  ' + C.dim + r.summary + C.off);
    if (r.stats && r.stats.won !== undefined) {
      console.log(C.dim + '  completed in ' + r.stats.moves + ' moves for ' + r.stats.score +
        ' points, ' + r.stats.roomCoverage + '% of rooms visited' + C.off);
    }
    // Honest about what has not been checked. A badge implying more verification
    // than was performed is the one thing that would discredit certification
    // entirely, so every run states its own limits.
    const all = ['T0', 'T1', 'T2', 'T3', 'T4'];
    const missing = all.filter(t => !r.ran.includes(t));
    console.log(C.dim + '  ran ' + r.ran.join(', ') +
      (missing.length ? '. Not checked: ' + missing.join(', ') : '') + C.off);
    if (r.tier === 'playable') {
      console.log(C.dim + '  "playable" means a path exists, not that a human can find it.' + C.off);
    }
    process.exit(r.ok ? 0 : 1);

  } else if (cmd === 'info') {
    const [file] = args;
    if (!file) throw new Error('usage: folio info <file.folio>');
    const g = load(fs.readFileSync(file));
    const m = g.manifest;
    console.log(C.bold + m.title + C.off + '  ' + C.dim + 'by ' + m.author + C.off);
    console.log('  format ' + m.folioVersion + ' · ' + m.logicType + ' · ' + m.license +
      ' · rated ' + m.contentRating);
    if (m.capabilities) console.log('  capabilities: ' + m.capabilities.join(', '));
    console.log('  walkthrough: ' + g.walkthrough.split('\n')
      .filter(l => l.split('#')[0].trim()).length + ' commands');
    console.log('  entries:');
    for (const n of Object.keys(g.files).sort()) {
      console.log('    ' + C.dim + String(g.files[n].length).padStart(8) + C.off + '  ' + n);
    }

  } else if (cmd === 'play') {
    const [file] = args;
    if (!file) throw new Error('usage: folio play <file.folio>');
    const { game, backend, send } = openGame(file);
    console.log(C.bold + game.manifest.title + C.off + C.dim + '  (ctrl-c to quit)' + C.off + '\n');
    console.log(backend.banner.trim() + '\n');
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const prompt = () => {
      const s = backend.state();
      rl.question(C.dim + s.roomId + '  ' + s.score + '/' + s.moves + C.off + ' > ', (line) => {
        if (line.trim()) console.log('\n' + (send(line.trim()) || '').trim() + '\n');
        prompt();
      });
    };
    prompt();

  } else {
    console.log('folio — build, check and play .folio games\n');
    console.log('  folio pack <dir> <out.folio>   assemble a game');
    console.log('  folio validate <file.folio>    run the tiered checks');
    console.log('  folio info <file.folio>        what is inside');
    console.log('  folio play <file.folio>        play it in the terminal');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(C.red + 'error' + C.off + '  ' + e.message);
  process.exit(2);
}
