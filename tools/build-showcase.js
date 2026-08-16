'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const ORIGIN=process.env.FOLIO_ORIGIN||path.join(process.env.HOME,'projects-games','zork1');
const read=p=>fs.readFileSync(p,'utf8');
const engine=[
  'window.GUE=window.GUE||{};',
  read(path.join(ORIGIN,'ui','font.js')),
  read(path.join(ROOT,'packages/engine/browser-zip.js')),
  read(path.join(ROOT,'packages/world/index.js')),
  read(path.join(ROOT,'packages/engine/shell.js')),
  read(path.join(ROOT,'packages/engine/player.js'))
].join('\n');
const folioB64=fs.readFileSync(path.join(ROOT,'site/games/cellar-door.folio')).toString('base64');
const shotB64=fs.readFileSync(path.join(ROOT,'site/shots/cellar-door.png')).toString('base64');
fs.writeFileSync(path.join(ROOT,'dist/showcase-engine.js'),engine);
fs.writeFileSync(path.join(ROOT,'dist/showcase-data.json'),JSON.stringify({folio:folioB64,shot:shotB64}));
console.log('engine',Math.round(engine.length/1024)+'KB  folio',Math.round(folioB64.length/1024)+'KB  shot',Math.round(shotB64.length/1024)+'KB');
