#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Build the map editor into one self-contained page.
//
//  The interesting part is that the real validator runs in the browser. Not a
//  reimplementation of it, not a subset: the same graph.js, replay.js, design.js
//  and schema.js that the command line runs, so the badge in the corner of the
//  editor cannot drift from the badge you get when you pack the game.
//
//  Those files are CommonJS and require each other by relative path, so the page
//  gets a twenty-line module registry rather than a build system. schema.js reads
//  its JSON off disk, which a page cannot do, so that one read is replaced with
//  the inlined document at build time.
//
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Every module the editor needs, keyed by the path its siblings require it as.
const MODULES = [
  ['packages/validator/mapshape.js', './mapshape.js'],
  ['packages/world/index.js', '../world/index.js'],
  ['packages/validator/graph.js', './graph.js'],
  ['packages/validator/replay.js', './replay.js'],
  ['packages/validator/design.js', './design.js'],
  ['packages/format/brief.js', '../format/brief.js'],
  ['packages/format/scenes.js', '../format/scenes.js'],
  ['packages/validator/solve.js', './solve.js'],
  ['packages/format/schema.js', '../format/schema.js'],
  // So the editor can open a .folio that holds a compiled game and still show
  // the map. It reads the binary's tables statically and never runs it.
  ['packages/zmachine/calibrate.js', '../zmachine/calibrate.js']
];

const SCHEMA = read('packages/format/world.schema.json');

function moduleSource(file) {
  let src = read(file);
  // schema.js loads its document from disk. A page has no disk.
  if (/world\.schema\.json/.test(src)) {
    src = src.replace(
      /const WORLD_SCHEMA = JSON\.parse\([\s\S]*?\);/,
      'const WORLD_SCHEMA = ' + SCHEMA + ';'
    );
    src = src.replace(/^const fs = require\('fs'\);$/m, '');
    src = src.replace(/^const path = require\('path'\);$/m, '');
  }
  return src;
}

const parts = [];
parts.push('(function () {');
parts.push("  'use strict';");
parts.push('  // A registry standing in for node\'s module resolution. Each file is');
parts.push('  // evaluated once, on first require, exactly as node would.');
parts.push('  var REG = {}, CACHE = {};');
parts.push('  function require(name) {');
parts.push('    var key = String(name).replace(/^\\.\\.?\\//, \'\').replace(/^.*\\//, \'\');');
parts.push('    if (CACHE[key]) return CACHE[key].exports;');
parts.push('    var def = REG[key];');
parts.push('    if (!def) throw new Error(\'no such module: \' + name);');
parts.push('    var m = CACHE[key] = { exports: {} };');
parts.push('    def(m, m.exports, require);');
parts.push('    return m.exports;');
parts.push('  }');

for (const [file, asPath] of MODULES) {
  const key = asPath.replace(/^\.\.?\//, '').replace(/^.*\//, '');
  parts.push('  REG[' + JSON.stringify(key) + '] = function (module, exports, require) {');
  parts.push(moduleSource(file));
  parts.push('  };');
}

parts.push('  window.Folio = {');
parts.push('    world: require(\'index.js\'),');
parts.push('    graph: require(\'graph.js\'),');
parts.push('    replay: require(\'replay.js\'),');
parts.push('    design: require(\'design.js\'),');
parts.push('    schema: require(\'schema.js\'),');
parts.push('    brief: require(\'brief.js\'),');
parts.push('    scenes: require(\'scenes.js\'),');
parts.push('    solve: require(\'solve.js\'),');
parts.push('    calibrate: require(\'calibrate.js\')');
parts.push('  };');
parts.push('})();');

const bundle = parts.join('\n');
const CLOSE = '</' + 'script>';

// The zip reader attaches itself to the page rather than exporting, so it goes
// in as-is. Without it the editor cannot open an existing .folio, which is the
// thing most people will want to do first.
const zip = read('packages/engine/browser-zip.js');

// The drawing kit, so the editor can show a real backdrop rather than a swatch.
// It reads window.GUE at load time, which has to exist first.
const kit = 'window.GUE = window.GUE || {};\n' + read('packages/engine/vendor/kit.js');

const html = read('packages/editor/editor.html')
  .replace('/*ENGINE*/', (zip + '\n' + kit + '\n' + bundle).split(CLOSE).join('<\\/script>'))
  .replace('/*APP*/', read('packages/editor/editor.js').split(CLOSE).join('<\\/script>'))
  .replace('/*STYLE*/', read('packages/editor/editor.css'));

fs.mkdirSync(path.join(ROOT, 'site/editor'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'site/editor/index.html'), html);
console.log('built site/editor/index.html  (' + Math.round(html.length / 1024) + ' KB)');
