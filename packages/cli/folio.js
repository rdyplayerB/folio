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
const trace = require('../format/trace.js');

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
        // "use door key" is a two-object command. Splitting noun from indirect
        // here keeps the terminal able to express everything the board can.
        const [verb, ...rest] = line.split(/\s+/);
        const noun = rest.length ? String(rest.shift()).toUpperCase() : null;
        const second = rest.length ? rest.join(' ').toUpperCase() : null;
        return be.submit(verb, noun, second).prose;
      }
    };
  }

  throw new Error('unknown logicType "' + game.manifest.logicType + '"');
}

const [cmd, ...args] = process.argv.slice(2);
trace.record('cli', cmd || '(help)', { args: args.length });

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
    trace.record('cli', 'validate:result', {
      ok: r.ok, tier: r.tier, ran: r.ran,
      codes: r.findings.map(f => f.code),
      errorCodes: r.findings.filter(f => f.level === 'error').map(f => f.code),
      errors: r.findings.filter(f => f.level === 'error').length
    });
    for (const x of r.findings) {
      const col = x.level === 'error' ? C.red : C.yellow;
      console.log(col + x.level.toUpperCase() + C.off + ' ' + C.dim + x.code + C.off + '  ' + x.msg);
      if (x.hint) console.log('        ' + C.dim + x.hint + C.off);
    }
    // Four tiers, and this ternary only ever handled three. A game that reached
    // the top tier was shown the weakest passing badge, and the first person to
    // earn it concluded from the output that PLAYABLE did not exist. A badge is
    // supposed to claim exactly what was verified; claiming dramatically less is
    // the same defect as claiming more.
    const BADGE = {
      certified: C.green + 'CERTIFIED' + C.off,
      playable:  C.green + 'PLAYABLE' + C.off,
      valid:     C.green + 'VALID' + C.off
    };
    const badge = !r.ok ? C.red + 'INVALID' + C.off : (BADGE[r.tier] || BADGE.valid);
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
    if (r.tier === 'certified') {
      console.log(C.dim + '  certified is the top tier: every check ran and the design ' +
        'audit raised nothing.' + C.off);
      console.log(C.dim + '  It still does not claim a human can find the solution.' + C.off);
    }
    process.exit(r.ok ? 0 : 1);

  } else if (cmd === 'brief') {
    // Turn a creator's intent into concrete targets. The same resolved object is
    // what the compiler builds toward and what T4 grades against.
    const [file] = args;
    const input = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const r = require('../format/brief.js').resolve(input);
    console.log(C.bold + 'Resolved brief' + C.off);
    console.log(r.describe().split('\n').map(l => '  ' + l).join('\n'));
    console.log('');
    for (const n of r.notes) console.log(C.dim + '  · ' + n + C.off);
    console.log('');
    console.log(C.dim + '  targets    ' + JSON.stringify(r.targets) + C.off);
    console.log(C.dim + '  thresholds ' + JSON.stringify(r.thresholds) + C.off);

  } else if (cmd === 'profile') {
    // Reverse-engineer the recipe: replay a game's own walkthrough and measure
    // what a design that worked actually looks like. This is where T4's thresholds
    // come from — measured, not invented.
    const [file] = args;
    if (!file) throw new Error('usage: folio profile <file.folio>');
    const { game, backend } = openGame(file);
    const p = require('../validator/profile.js').profile(backend, game.walkthrough);
    console.log(C.bold + game.manifest.title + C.off + C.dim + ' — measured profile' + C.off);
    for (const [k, v] of Object.entries(p)) {
      console.log('  ' + k.padEnd(22) + C.dim + (Array.isArray(v) ? JSON.stringify(v) : v) + C.off);
    }

  } else if (cmd === 'calibrate') {
    // The first half of porting a Z-machine game: work out which numbered object
    // is which room. Everything structural is derived; the attribute table is
    // partly inference, and the parts that are not confident are handed back as
    // evidence rather than written out as fact.
    const [file] = args;
    if (!file) throw new Error('usage: folio calibrate <story.z3> [-o roommap.json]');
    const oi = args.indexOf('-o');
    const out = oi > 0 ? args[oi + 1] : null;

    const { calibrate, NEEDED_FLAGS } = require('../zmachine/calibrate.js');
    const r = calibrate(fs.readFileSync(file));
    const rep = r.report;

    console.log(C.bold + path.basename(file) + C.off + C.dim +
      '  v' + rep.story.version + ' release ' + rep.story.release +
      ' serial ' + rep.story.serial + ', ' + rep.story.objects + ' objects' + C.off + '\n');

    const row = (k, v, note) =>
      console.log('  ' + k.padEnd(14) + String(v).padStart(5) + '   ' + C.dim + (note || '') + C.off);
    row('rooms', rep.rooms, 'from the ' + rep.roomsFoundBy);
    row('objects', rep.objects, rep.unnamed ? rep.unnamed + ' unnamed internals skipped' : '');
    row('directions', rep.directions.considered.length,
      Math.round(rep.directions.reciprocity * 100) + '% of exits lead back, which is what named them');
    row('player', r.roommap.ADVENTURER === null ? '—' : r.roommap.ADVENTURER,
      rep.player.how);

    console.log('\n  ' + C.bold + 'attribute bits' + C.off);
    for (const a of rep.attributes) {
      const known = a.bit !== null;
      console.log('    ' + (known ? C.green + '✓' + C.off : C.yellow + '?' + C.off) + ' ' +
        a.flag.padEnd(11) + String(known ? a.bit : '—').padStart(3) + '   ' +
        C.dim + a.why + C.off);
    }

    const missing = rep.missingFlags;
    if (missing.length) {
      // This is the part a person finishes. Reading eight rows of object names is
      // a couple of minutes of work and it is never wrong, which beats a solver
      // that is right most of the time and silently wrong the rest.
      console.log('\n  ' + C.yellow + 'Confirm ' + missing.length + ' flags by hand' + C.off +
        C.dim + ' — find the bit whose objects match the meaning' + C.off);
      console.log('  ' + C.dim + missing.join(', ') + C.off + '\n');
      const cens = rep.census
        .filter(c => !c.claimed && c.count > 2 && c.count < rep.story.objects * 0.5)
        .sort((a, b) => b.count - a.count);
      for (const c of cens) {
        console.log('    bit ' + String(c.bit).padStart(2) + C.dim + '  n=' +
          String(c.count).padEnd(4) + (c.rooms ? 'rooms=' + String(c.rooms).padEnd(4) : '        ') +
          C.off + c.sample.slice(0, 5).join(', ').slice(0, 62));
      }
    }

    if (out) {
      const doc = Object.assign({}, r.roommap);
      if (missing.length) {
        doc._confirm = {
          note: 'Fill each of these into ATTR as a bit number, then delete this block. ' +
                'Run folio calibrate again to see the object names behind each bit.',
          flags: missing
        };
      }
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(doc, null, 2));
      console.log('\n  wrote ' + out + '  ' + C.dim +
        (missing.length ? missing.length + ' flags left for you' : 'complete') + C.off);
    } else {
      console.log('\n  ' + C.dim + 'pass -o presentation/roommap.json to write it' + C.off);
    }
    process.exit(rep.rooms > 0 ? 0 : 1);

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
    console.log('  folio profile <file.folio>     measure its design shape');
    console.log('  folio brief [brief.json]       resolve authoring dials into targets');
    console.log('  folio calibrate <story.z3>     derive a room map from a Z-machine story');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(C.red + 'error' + C.off + '  ' + e.message);
  process.exit(2);
}
