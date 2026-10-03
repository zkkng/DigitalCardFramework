import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import * as playwright from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';

const output=resolve(process.argv[2]??'test-results/admin');
const engine=process.env.BROWSER_ENGINE??'chromium';
const x=fixture();
let api;
const server=createServer(async(req,res)=>{
  try {
    if(await api?.(req,res))return;
    if(new URL(req.url,'http://localhost').pathname==='/host/config'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({brand:'Digital Card Framework',mode:'production',loginUrl:'/auth/login'}));return;
    }
    if(new URL(req.url,'http://localhost').pathname==='/harness'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administration</title><style>body{margin:0;background:#101725;color:#edf1f7;font:16px system-ui}#root{max-width:1240px;margin:auto;padding:20px}*{box-sizing:border-box}</style></head><body><main id="root"></main><script type="module">
import {createClient} from '/src/client.js';
import {mountAdminPanel} from '/src/admin-ui.js';
const client=createClient();const me=await client.me();
window.panel=mountAdminPanel(document.querySelector('#root'),{client,namespace:me.userId});
await window.panel.ready;window.ready=true;
</script></body></html>`);
      return;
    }
    if(await serveReference(req,res))return;
    res.writeHead(404).end();
  } catch(error){res.writeHead(500).end(error.message);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
api=createApiHandler({framework:x.core,resolveIdentity:()=>({...x.alice,role:'admin'}),allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
let browser;
const errors=[],checks=[];
try {
  await mkdir(output,{recursive:true});
  try {browser=await playwright[engine].launch({headless:true});}
  catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await playwright.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/harness');
  await page.waitForFunction(()=>window.ready);
  await page.screenshot({path:resolve(output,engine+'-overview.png'),fullPage:true});
  const labels=await page.locator('button').allTextContents();
  await writeFile(resolve(output,engine+'-controls.json'),JSON.stringify(labels,null,2));
  checks.push('Panel loads through authenticated public client and reference static serving');
  const save=async()=>{await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('.da-review').waitFor({state:'hidden'});};
  await page.locator('[data-admin-tab=lines]').click();
  await page.getByRole('button',{name:'Manage Sky Atlas',exact:true}).click();
  await page.getByRole('button',{name:'Edit common',exact:true}).click();
  await page.getByLabel('Regular price',{exact:true}).fill('20');
  await page.getByLabel('Discount (%)',{exact:true}).fill('25');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  assert.match(await page.locator('.da-review').innerText(),/25/);
  await save();assert.equal(x.core.quote(x.bob,{productId:'common',quantity:1}).price.amount,15);
  await page.getByRole('button',{name:'Advanced',exact:true}).click();
  await page.screenshot({path:resolve(output,engine+'-pack-settings.png'),fullPage:true});
  checks.push('Reviewed pack price and discount apply through the server; advanced controls render');
  await page.locator('[data-admin-tab=people]').click();
  await page.getByRole('button',{name:'Manage Bob',exact:true}).click();
  await page.getByLabel('Allow selling',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  assert.equal(x.core.adminUser({...x.alice,role:'admin'},{userId:x.bob.userId}).user.restrictions.sellingBlocked,true);
  await page.getByRole('button',{name:'Give cards',exact:true}).click();
  await page.getByLabel('Card to give',{exact:true}).selectOption('dawn.standard');
  await page.getByLabel('Reason for this inventory change',{exact:true}).fill('Community welcome');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  await page.getByRole('button',{name:'Back to person',exact:true}).click();
  await page.getByRole('button',{name:'Remove cards',exact:true}).click();
  await page.locator('.da-checkbox-row input:not(:disabled)').first().check();
  await page.getByLabel('Reason for this inventory change',{exact:true}).fill('Correct duplicate welcome gift');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.screenshot({path:resolve(output,engine+'-inventory-review.png'),fullPage:true});
  await save();
  assert.equal(x.core.adminUser({...x.alice,role:'admin'},{userId:x.bob.userId}).inventory.items.length,0);
  checks.push('Account selling restriction, card grant and exact-copy removal complete through reviewed forms');
  await page.locator('[data-admin-tab=website]').click();
  await page.getByLabel('Pack purchases',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await save();
  assert.equal(x.core.adminOverview({...x.alice,role:'admin'}).site.packPurchasesPaused,true);
  await page.locator('[data-admin-tab=activity]').click();
  await page.getByText('Community welcome',{exact:true}).waitFor();
  checks.push('Website pause persists and named administration history loads');
  await page.locator('[data-admin-tab=overview]').click();
  await page.getByRole('button',{name:'Basic',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile horizontal overflow');
  await page.screenshot({path:resolve(output,engine+'-mobile.png'),fullPage:true});
  checks.push('390 px mobile layout has no horizontal overflow');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.panel.dispose());
  assert.equal((await page.locator('#root').innerText()).trim(),'');
  checks.push('Disposal removes the panel');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/');
  await page.locator('[data-view=admin]').click();
  await page.getByRole('heading',{name:'A clear view of your community',exact:true}).waitFor();
  await page.screenshot({path:resolve(output,engine+'-default-website.png'),fullPage:true});
  await page.locator('[data-admin-tab=website]').click();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Default website mobile horizontal overflow');
  await page.screenshot({path:resolve(output,engine+'-default-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  checks.push('Default website mounts the panel with inherited styling on desktop and mobile');
  await writeFile(resolve(output,engine+'-results.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({engine,checks,errors}));
} finally {
  await browser?.close();x.core.close();
  await new Promise(done=>{server.close(done);server.closeAllConnections();});
}
