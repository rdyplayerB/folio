#!/usr/bin/env node
/* eslint-disable no-console */
// Builds the full player: the real shell, plus everything it needs, in one file.
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

// Order matters: font and art before the shell, because the shell reads them at
// module scope. The shell boots itself on DOMContentLoaded, so the .folio must be
// staged into globals BEFORE it loads — which is why it comes last.
const engine=[
  'window.GUE=window.GUE||{};',
  read('packages/engine/vendor/font.js'),
  read('packages/engine/vendor/kit.js'),
  read('packages/engine/vendor/sprites.js'),
  read('packages/engine/browser-zip.js'),
  read('packages/zmachine/src/zmachine.js'),
  read('packages/zmachine/src/bridge.js'),
  read('packages/engine/player-full.js')
].join('\n');

// The shell is carried in a text/plain block and injected after the container has
// staged its globals. Any literal close-script tag inside it would end that block
// early, so it is neutralised — the classic inline-script embedding hazard.
const CLOSE = '<' + '/script>';
const shell = read('packages/engine/vendor/shell.js').split(CLOSE).join('<\\/script>');

const html=`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Folio Player</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0b0b10;color:#d8d8d8;
    font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:14px}
  canvas{image-rendering:pixelated;display:block}
  #bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
  label.file{border:1px solid #3a3a44;padding:7px 12px;cursor:pointer;color:#f8d878;
    letter-spacing:.06em;text-transform:uppercase;font-size:11px}
  label.file:hover,label.file:focus-within{background:#16161c}
  input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
  #title{color:#9a9aa4}
  #err{color:#f87858;max-width:60ch;text-align:center}
</style></head><body>
<div id="bar">
  <label class="file" tabindex="0">Open .folio<input type="file" id="pick" accept=".folio"></label>
  <span id="title"></span>
</div>
<div id="err" role="alert"></div>
<script>
${engine}
</script>
<script id="shell-src" type="text/plain">
${shell}
</script>
<script>
(function(){
  'use strict';
  var errEl=document.getElementById('err'),titleEl=document.getElementById('title');
  var booted=false;

  async function boot(bytes){
    if(booted){ location.reload(); return; }
    errEl.textContent='';
    try{
      var game=await FolioFullPlayer.load(bytes);
      titleEl.textContent=game.manifest.title+'  ·  by '+game.manifest.author;
      // The shell boots on load and reads globals, so it runs only once the
      // container has staged them. Injecting it here is what sequences that.
      var s=document.createElement('script');
      s.textContent=document.getElementById('shell-src').textContent;
      document.body.appendChild(s);
      booted=true;
      window.__folioReady=true;
    }catch(e){
      errEl.textContent=String(e.message||e);
      window.__folioError=String(e.message||e);
    }
  }

  document.getElementById('pick').addEventListener('change',async function(ev){
    var f=ev.target.files&&ev.target.files[0];
    if(f) boot(await f.arrayBuffer());
  });
  document.addEventListener('dragover',e=>e.preventDefault());
  document.addEventListener('drop',async function(e){
    e.preventDefault();
    var f=e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f) boot(await f.arrayBuffer());
  });
  // ?game= takes a library id (short, stable) or a full URL (so anyone can host
  // their own game and still use this player).
  var q=new URLSearchParams(location.search).get('game');
  if(q){
    if(/^https?:/i.test(q)||q.indexOf('/')>=0){ fetchGame(q); }
    else {
      fetch('/games.json').then(function(r){return r.json();}).then(function(list){
        var g=list.filter(function(x){return x.id===q;})[0];
        if(!g) throw new Error('no game with id "'+q+'"');
        titleEl.textContent=g.title+'  ·  by '+g.author;
        return fetchGame(g.file);
      }).catch(function(e){errEl.textContent=e.message;});
    }
  }
  function fetchGame(u){
    return fetch(u).then(function(r){
      if(!r.ok) throw new Error('could not load the game ('+r.status+')');
      return r.arrayBuffer();
    }).then(boot).catch(function(e){errEl.textContent=e.message;});
  }
  window.__folioBoot=boot;
})();
</script>
</body></html>`;

// Built into the site so the whole thing deploys as one static directory, and
// also into dist/ for anyone who wants to host the player themselves.
for (const out of ['dist/player-full.html','site/play/index.html']) {
  fs.mkdirSync(path.dirname(path.join(ROOT,out)),{recursive:true});
  fs.writeFileSync(path.join(ROOT,out),html);
}
console.log('built site/play/index.html and dist/player-full.html  ('+Math.round(html.length/1024)+' KB)');
