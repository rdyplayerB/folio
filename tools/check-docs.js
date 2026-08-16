#!/usr/bin/env node
/* eslint-disable no-console */
//
//  Does the manual still describe the engine that exists?
//
//  Documentation rots quietly. Nothing breaks when a validator gains a code nobody
//  wrote up, or when a page links to a section that was renamed, so the failure is
//  invisible until somebody hits it and gives up. The checks here are the cheap
//  mechanical half of keeping that from happening.
//
//  The first one is a promise the validator makes in its own header: every finding
//  code must have a matching docs anchor, so that "why won't my game certify" is
//  always answerable. That promise was unenforced and already broken by 44 codes
//  when this was written.
//
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'site/docs');
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };

let fail = 0, pass = 0;
const ok = (label, cond, detail) => {
  console.log('  ' + (cond ? C.green + 'PASS' + C.off : C.red + 'FAIL' + C.off) + '  ' +
    label + (detail ? C.dim + '  -- ' + detail + C.off : ''));
  cond ? pass++ : fail++;
};

// ---------------------------------------------------------------- collect
function pages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pages(full));
    else if (e.name === 'index.html') out.push(full);
  }
  return out;
}
const docPages = pages(DOCS);
const urlOf = (f) => {
  const rel = path.dirname(path.relative(DOCS, f));
  return rel === '.' ? '/docs/' : '/docs/' + rel + '/';
};
const html = new Map(docPages.map(f => [f, fs.readFileSync(f, 'utf8')]));

console.log('\n=== ' + C.bold + 'documentation' + C.off + ' ===\n');
ok('the manual has pages', docPages.length > 0, docPages.length + ' pages');

// ------------------------------------------------- every finding code is written up
const codes = new Set();
for (const f of ['index.js', 'graph.js', 'replay.js', 'design.js']) {
  const src = fs.readFileSync(path.join(ROOT, 'packages/validator', f), 'utf8');
  for (const m of src.matchAll(/\b(?:err|warn)\(\s*'([EW]\d+)'/g)) codes.add(m[1]);
}
const documented = new Set();
for (const src of html.values()) {
  for (const m of src.matchAll(/class="code [ew]">([EW]\d+)</g)) documented.add(m[1]);
}
const undocumented = [...codes].filter(c => !documented.has(c)).sort();
ok('every finding code the validator can emit is documented',
  undocumented.length === 0,
  codes.size + ' codes' + (undocumented.length ? ', missing: ' + undocumented.join(', ') : ''));

// A code documented but no longer emitted is the opposite rot, and just as
// misleading to somebody searching for it.
const stale = [...documented].filter(c => !codes.has(c)).sort();
ok('no documented code has been removed from the engine',
  stale.length === 0, stale.length ? 'stale: ' + stale.join(', ') : '');

// -------------------------------------------------- every CLI command is written up
const cli = fs.readFileSync(path.join(ROOT, 'packages/cli/folio.js'), 'utf8');
const cmds = new Set([...cli.matchAll(/cmd === '([a-z]+)'/g)].map(m => m[1]));
const allDocs = [...html.values()].join('\n');
const missingCmds = [...cmds].filter(c => !new RegExp('folio(</b>)?\\s+' + c + '\\b').test(allDocs));
ok('every CLI command appears in the manual',
  missingCmds.length === 0,
  cmds.size + ' commands' + (missingCmds.length ? ', missing: ' + missingCmds.join(', ') : ''));

// ------------------------------------------------------- internal links resolve
const known = new Set(docPages.map(urlOf));
const anchors = new Map();
for (const [f, src] of html) {
  anchors.set(urlOf(f), new Set([...src.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
}
const broken = [];
for (const [f, src] of html) {
  for (const m of src.matchAll(/href="(\/docs\/[^"]*)"/g)) {
    const [target, frag] = m[1].split('#');
    if (!known.has(target)) { broken.push(urlOf(f) + ' -> ' + m[1] + ' (no page)'); continue; }
    if (frag && !anchors.get(target).has(frag)) {
      broken.push(urlOf(f) + ' -> ' + m[1] + ' (no anchor)');
    }
  }
}
ok('every internal docs link resolves', broken.length === 0, broken.slice(0, 4).join(' | '));

// --------------------------------------------- every page carries the shared chrome
for (const [f, src] of html) {
  const u = urlOf(f);
  const has = src.includes('/assets/docs.css') && src.includes('/assets/site.css') &&
    src.includes('starfield.js') && /<title>[^<]+<\/title>/.test(src);
  if (!has) ok('chrome complete on ' + u, false);
}
ok('every page loads the shared stylesheets, title and starfield',
  [...html.values()].every(s => s.includes('/assets/docs.css') && s.includes('/assets/site.css') &&
    s.includes('starfield.js') && /<title>[^<]+<\/title>/.test(s)));

// The sidebar is hand-maintained on every page, so it is the thing most likely to
// drift. Each page must list every other page, or a reader hits a dead end.
const navMissing = [];
for (const [f, src] of html) {
  for (const u of known) {
    if (u === urlOf(f)) continue;
    if (!src.includes('href="' + u + '"')) navMissing.push(urlOf(f) + ' omits ' + u);
  }
}
ok('every page can reach every other page from its sidebar',
  navMissing.length === 0, navMissing.slice(0, 4).join(' | '));

// ------------------------------------------- the published spec and schema
// Other people's tools and other people's models are pointed at these URLs, so a
// stale copy is worse than no copy: it is a contract that silently disagrees with
// the engine.
const pkgSchema = fs.readFileSync(path.join(ROOT, 'packages/format/world.schema.json'), 'utf8');
const pubPath = path.join(ROOT, 'site/schema/world-0.1.0.json');
ok('the published schema matches the package schema',
  fs.existsSync(pubPath) && fs.readFileSync(pubPath, 'utf8') === pkgSchema,
  fs.existsSync(pubPath) ? '' : 'site/schema/world-0.1.0.json is missing');

const llmsPath = path.join(ROOT, 'site/llms.txt');
const llms = fs.existsSync(llmsPath) ? fs.readFileSync(llmsPath, 'utf8') : '';
ok('the agent-facing spec exists', llms.length > 0, llms.length + ' bytes');

// llms.txt is the one document an agent is expected to read INSTEAD of the
// manual, so a vocabulary missing from it is a vocabulary that does not exist as
// far as that agent is concerned.
const { vocabulary } = require(path.join(ROOT, 'packages/format/schema.js'));
const vocab = vocabulary();
const absent = (list) => list.filter(v => !new RegExp('`' + v.replace(/[-]/g, '\\-') + '`').test(llms));
const missingCond = absent(vocab.conditions);
const missingEff = absent(vocab.effects);
ok('the spec lists every condition', missingCond.length === 0,
  vocab.conditions.length + ' conditions' + (missingCond.length ? ', missing ' + missingCond.join(', ') : ''));
ok('the spec lists every effect', missingEff.length === 0,
  vocab.effects.length + ' effects' + (missingEff.length ? ', missing ' + missingEff.join(', ') : ''));
const missingDefaults = vocab.defaults.filter(d => !llms.includes('`' + d + '`'));
ok('the spec lists every response override', missingDefaults.length === 0,
  missingDefaults.join(', '));

// -------------------------------------------------------------- referenced images
const imgMissing = [];
for (const src of html.values()) {
  for (const m of src.matchAll(/<img[^>]+src="(\/[^"]+)"/g)) {
    if (!fs.existsSync(path.join(ROOT, 'site', m[1]))) imgMissing.push(m[1]);
  }
}
ok('every referenced image exists', imgMissing.length === 0, imgMissing.join(', '));

console.log('\n' + (fail ? C.red + fail + ' failed' + C.off + ', ' : '') +
  C.green + pass + ' passed' + C.off + '\n');
process.exit(fail ? 1 : 0);
