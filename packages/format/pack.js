#!/usr/bin/env node
/* eslint-disable no-console */
//
//  pack.js — build a .folio from a source directory, and read one back.
//
//  A .folio is the unit of creation, sharing, validation and play. Everything a
//  game needs is inside it, because the one rule the prior art agrees on without
//  exception is that what lives inside the file survives and what lives outside
//  it rots — PuzzleScript's entire library is unreachable today because its share
//  links pointed at someone else's free tier.
//
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zip = require('./zip.js');

const REQUIRED = ['manifest.json', 'walkthrough.folioscript'];

/**
 * Assemble a .folio buffer from a directory tree.
 * Adds checksums.json so tampering and truncation are detectable on load.
 */
function pack(dir) {
  const files = {};
  (function walk(d, prefix) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else files[rel] = fs.readFileSync(full);
    }
  })(dir, '');

  for (const req of REQUIRED) {
    if (!files[req]) throw new Error('.folio is missing ' + req);
  }

  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  for (const field of ['id', 'title', 'author', 'folioVersion', 'logicType', 'license', 'contentRating']) {
    if (manifest[field] === undefined) {
      throw new Error('manifest.json is missing the mandatory field: ' + field);
    }
  }
  // "unknown" licence means not hostable — the interactive-fiction archive's
  // metadata standard deliberately omitted a licence field and its curators have
  // been unable to tell mechanically what they may serve ever since.
  if (manifest.license === 'unknown') {
    console.warn('  warning: license is "unknown" — this .folio is playable but not hostable');
  }

  const sums = {};
  for (const name of Object.keys(files).sort()) {
    if (name === 'checksums.json') continue;
    sums[name] = crypto.createHash('sha256').update(files[name]).digest('hex');
  }
  files['checksums.json'] = Buffer.from(JSON.stringify(sums, null, 2), 'utf8');

  return zip.write(files);
}

/** Read a .folio buffer, verifying integrity. Throws on any mismatch. */
function load(buf) {
  const files = zip.read(buf);
  for (const req of REQUIRED) {
    if (!files[req]) throw new Error('.folio is missing ' + req);
  }
  if (files['checksums.json']) {
    const sums = JSON.parse(files['checksums.json'].toString('utf8'));
    for (const name of Object.keys(sums)) {
      if (!files[name]) throw new Error('.folio is missing a checksummed entry: ' + name);
      const got = crypto.createHash('sha256').update(files[name]).digest('hex');
      if (got !== sums[name]) throw new Error('.folio entry failed its checksum: ' + name);
    }
  }
  return {
    manifest: JSON.parse(files['manifest.json'].toString('utf8')),
    walkthrough: files['walkthrough.folioscript'].toString('utf8'),
    files
  };
}

module.exports = { pack, load };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'pack' && a && b) {
    const out = pack(a);
    fs.writeFileSync(b, out);
    console.log('packed ' + b + '  (' + out.length.toLocaleString() + ' bytes)');
  } else if (cmd === 'info' && a) {
    const g = load(fs.readFileSync(a));
    console.log(g.manifest.title + ' by ' + g.manifest.author);
    console.log('  format ' + g.manifest.folioVersion + ' · ' + g.manifest.logicType +
      ' · ' + g.manifest.license + ' · rated ' + g.manifest.contentRating);
    console.log('  ' + Object.keys(g.files).length + ' entries, integrity verified');
  } else {
    console.log('usage: pack.js pack <dir> <out.folio> | info <file.folio>');
    process.exit(1);
  }
}
