/** Real pointer/keyboard regression, synthetic codes only. */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as playwright from 'playwright';
const engine=process.env.BROWSER_ENGINE??'chromium',root=fileURLToPath(new URL('../src/',import.meta.url));
const output=path.resolve(process.argv[2]??'../PortableCardQA/codes');
const allowed=new Set(['code-ui.js','ui-kit.js']);
const server=createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!name){res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="max-width:440px;margin:30px auto;font:16px system-ui;background:#141324;color:#f5efff"><h1>Private code reveals</h1><script type="module">
    import {renderCodeReveal} from '/code-ui.js';window.calls=[];
    for(const mode of ['scratch','peel','open']){const heading=document.createElement('h2');heading.textContent=mode;document.body.append(heading);const view=renderCodeReveal({codeId:mode,mode},{key:()=>mode,reveal:async input=>{window.calls.push(input);return {code:'SYNTHETIC-'+mode.toUpperCase()};}});view.node.id=mode;document.body.append(view.node);}window.ready=true;
  </script></body></html>`);return;}
  if(!allowed.has(name)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(root,name)));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  try{browser=await playwright[engine].launch({headless:true});}catch(e){if(engine!=='chromium'||process.platform!=='win32')throw e;browser=await playwright.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:430,height:932},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.locator('#open[data-state="revealed"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.codeId)),['open']);
  const peel=await page.locator('#peel .dc-code-surface').boundingBox();await page.mouse.move(peel.x+5,peel.y+35);await page.mouse.down();await page.mouse.move(peel.x+peel.width*.2,peel.y+35,{steps:5});
  assert.equal(await page.locator('#peel').getAttribute('data-state'),'covered');
  await page.mouse.move(peel.x+peel.width*.75,peel.y+35,{steps:8});await page.mouse.up();await page.locator('#peel[data-state="revealed"]').waitFor();
  const scratch=await page.locator('#scratch .dc-code-surface').boundingBox();
  await page.mouse.move(scratch.x+8,scratch.y+20);await page.mouse.down();
  for(const [x,y] of [[.95,.2],[.95,.6],[.05,.6]])await page.mouse.move(scratch.x+scratch.width*x,scratch.y+scratch.height*y,{steps:12});
  await page.mouse.up();await page.locator('#scratch[data-state="revealed"]').waitFor();
  assert.deepEqual((await page.evaluate(()=>window.calls.map(x=>x.codeId))).sort(),['open','peel','scratch']);
  assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,engine+'-revealed.png'),fullPage:true});
  await page.reload();await page.waitForFunction(()=>window.ready);await page.locator('#scratch button').focus();await page.keyboard.press('Enter');await page.locator('#scratch[data-state="revealed"]').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  console.log(engine+': pointer scratch, partial/full peel, open, keyboard reveal and no browser storage passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
