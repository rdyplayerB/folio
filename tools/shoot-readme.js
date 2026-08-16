#!/usr/bin/env node
/* eslint-disable no-console */
// Capture the whole game board (not just the scene) for documentation, and play a
// few commands first so the screenshot shows a game in progress rather than a
// title state.
'use strict';
const fs=require('fs'),path=require('path');
const puppeteer=require(path.join(process.env.HOME,'projects-games/zork1/node_modules/puppeteer'));
const ROOT=path.join(__dirname,'..');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async()=>{
  const [folio,out,...cmds]=process.argv.slice(2);
  const b=await puppeteer.launch({headless:'new',executablePath:CHROME,args:['--no-sandbox']});
  const p=await b.newPage();
  await p.setViewport({width:1100,height:1000,deviceScaleFactor:3});
  await p.goto('file://'+path.join(ROOT,'dist','player-full.html'),{waitUntil:'domcontentloaded'});
  await p.evaluate(async(b64)=>{const s=atob(b64),u=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);await window.__folioBoot(u.buffer);},
    fs.readFileSync(folio).toString('base64'));
  await new Promise(r=>setTimeout(r,1600));

  for(const c of cmds){
    await p.evaluate((cmd)=>{ if(window.GUE&&GUE.shell&&GUE.shell.send) GUE.shell.send(cmd); }, c);
    await new Promise(r=>setTimeout(r,320));
  }
  await new Promise(r=>setTimeout(r,600));

  const box=await p.evaluate(()=>{
    const c=GUE.shell.canvas(); const r=c.getBoundingClientRect();
    return {x:r.left,y:r.top,width:r.width,height:r.height};});
  fs.mkdirSync(path.dirname(out),{recursive:true});
  await p.screenshot({path:out,clip:box});
  await b.close();
  console.log('shot '+out+'  '+Math.round(box.width)+'x'+Math.round(box.height));
})();
