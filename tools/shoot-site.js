'use strict';
const path=require('path');
const puppeteer=require(path.join(process.env.HOME,'projects-games/zork1/node_modules/puppeteer'));
(async()=>{
  const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  await p.setViewport({width:1100,height:900,deviceScaleFactor:2});
  await p.goto('http://localhost:8899/site/index.html',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,500));
  const count=await p.$eval('#count',e=>e.textContent);
  const cards=await p.$$eval('.cart',els=>els.length);
  console.log('banner:',count,'| cards:',cards,'| errors:',errs.length||'none');
  await p.screenshot({path:path.join(__dirname,'..','dist','site-shot.png'),fullPage:false});
  await b.close();
})();
