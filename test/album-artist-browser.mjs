import {createServer} from 'node:http';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {pngRGBA} from './presentation-fixtures.mjs';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {createPresentationStore} from '../src/presentation/service.js';
import {createPresentationHandler} from '../src/presentation/node-http.js';
import {authorizePresentation} from '../src/access.js';

const output=resolve(process.argv[2]??'test-results/album-artist'),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'album-artist-')),x=fixture(),actor={...admin,userId:x.alice.userId};x.open();x.open('rare');
const artwork=pngRGBA(2,2,Buffer.from(Array(4).fill([40,90,160,255]).flat()));let api,presentationHTTP,browser;
const server=createServer(async(req,res)=>{try{
  if(await api?.(req,res)||await presentationHTTP?.(req,res))return;
  if(req.url==='/art.png'){res.setHeader('content-type','image/png');res.end(artwork);return;}
  if(req.url==='/harness'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><title>Album artist</title><style>body{font:16px system-ui}details{display:block}input,textarea,button{font:inherit}</style><main id="root"></main></html>');return;}
  if(await serveReference(req,res))return;res.writeHead(404);res.end();
}catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,exposeOperators:true,requirePrincipal:true});
const store=await createPresentationStore({root:temp,authorize:authorizePresentation,validatePublication:(a,{archive})=>x.core.registerCardPresentation(a,archive)});
presentationHTTP=createPresentationHandler({store,resolveIdentity:()=>actor,allowedOrigin:origin});
const checks=[],errors=[];
try{
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/harness');
  await page.evaluate(async()=>{
    const [{createClient},{renderAlbums},{renderAlbum,renderCard}]=await Promise.all([import('/src/client.js'),import('/src/collection-ui.js'),import('/src/ui.js')]);
    const client=createClient(),model={catalog:await client.catalog(),me:await client.me(),inventory:await client.inventory(),albums:await client.albums()},root=document.querySelector('#root');
    window.album={client,model,renderAlbum,renderCard,saves:[],mounted:renderAlbums(model,{client,cardRenderer:renderCard,albumRenderer:renderAlbum,inspect(){},action:async fn=>{try{return await fn();}catch(error){document.querySelector('.dc-error').textContent=error.message;}},mutate:async(name,input)=>{const result=await client[name]({...input,key:client.requestKey()});window.album.saves.push(result);return result;}})};
    root.append(window.album.mounted.node);for(const details of root.querySelectorAll('details'))details.open=true;
  });
  await page.getByLabel('Album name',{exact:true}).fill('Artist book');
  await page.getByLabel('Cards per album page',{exact:true}).fill('1');
  await page.getByLabel('Album cover image URL',{exact:true}).fill('/art.png');await page.getByLabel('Album spine image URL',{exact:true}).fill('/art.png');
  await page.getByRole('button',{name:'Add album page',exact:true}).click();await page.getByRole('button',{name:'Add album page',exact:true}).click();
  await page.getByLabel('Page 1 title',{exact:true}).fill('Dawn');await page.getByLabel('Page 2 title',{exact:true}).fill('Aurora');await page.getByLabel('Page 1 image URL',{exact:true}).fill('/art.png');
  await page.evaluate(()=>{for(const button of document.querySelector('.dc-album-picker').querySelectorAll('button'))button.click();});
  await page.getByRole('button',{name:'Move page 1 later',exact:true}).click();await page.getByRole('button',{name:'Remove page 1',exact:true}).click();assert.match(await page.locator('.dc-error').textContent(),/Move the 1 cards/);checks.push('occupied page deletion blocked; reordering preserves stable card assignments');
  await page.getByRole('button',{name:'Save album',exact:true}).click();await page.waitForFunction(()=>window.album.saves.length===1);
  const saved=await page.evaluate(()=>window.album.saves[0]);assert.deepEqual(saved.layout.artwork.pages.map(p=>p.title),['Aurora','Dawn']);assert.equal(saved.placements[0].data.pageId,saved.layout.artwork.pages[1].id);assert.equal(saved.placements[1].data.pageId,saved.layout.artwork.pages[0].id);
  const viewed=x.core.viewAlbum(actor,saved.id);assert.deepEqual(viewed.layout,saved.layout);assert.throws(()=>x.core.viewAlbum(x.bob,saved.id));checks.push('private album save and reload retain cover/spine/pages and card assignments');
  const negative=await page.evaluate(async()=>{try{await window.album.client.saveAlbum({key:'invalid-page',name:'Bad',layout:{pageSize:1,artwork:{pages:[]}},placements:[{copyId:window.album.model.inventory[0].id,data:{pageId:'missing'}}]});return false;}catch(error){return error.code==='INVALID_INPUT';}});assert(negative);assert.equal(x.core.albums(actor).length,1);checks.push('unknown page assignment rejects through actual HTTP without writing');
  await page.getByRole('button',{name:'Preview album',exact:true}).click();await page.getByRole('button',{name:'Next album page',exact:true}).click();assert.match(await page.locator('.dc-album-book h3').textContent(),/Dawn.*2 of 2/);
  const lifecycle=await page.evaluate(()=>{const {renderAlbum,renderCard}=window.album,model={name:'Independent',layout:{pageSize:1,artwork:{cover:{src:'/missing.png'},pages:[{id:'a'},{id:'b'}]}},cards:window.album.model.inventory.map(copy=>({copy,placement:{data:{}}}))},one=renderAlbum(model),two=renderAlbum(model);document.body.append(one,two);one.setPage(1);const independent=one.shadowRoot.querySelector('select').value==='1'&&two.shadowRoot.querySelector('select').value==='0';one.shadowRoot.querySelector('img').dispatchEvent(new Event('error'));const fallback=one.shadowRoot.textContent.includes('artwork unavailable');const retained=one.setPage;one.dispose();retained(0);const terminal=one.shadowRoot.childNodes.length===0&&two.shadowRoot.childNodes.length>0;two.dispose();return {independent,fallback,terminal};});assert.deepEqual(lifecycle,{independent:true,fallback:true,terminal:true});checks.push('independent book navigation, unavailable-image fallback and terminal disposal');
  await page.getByRole('button',{name:'Design album cover',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dcard-studio')?.getAttribute('aria-busy')!=='true'&&document.querySelector('.dcard-studio')?.querySelector('button'));
  await page.getByRole('button',{name:'Add text',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dcard-studio').getAttribute('aria-busy')!=='true');
  await page.getByLabel('Text content',{exact:true}).fill('Cover headline');await page.getByLabel('Text content',{exact:true}).press('Tab');await page.waitForFunction(()=>document.querySelector('.dcard-studio').getAttribute('aria-busy')!=='true');
  await page.getByRole('button',{name:'Capture posters',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dcard-studio').getAttribute('aria-busy')!=='true');
  assert.match(await page.locator('#root').textContent(),/Private album visibility does not make these asset URLs private/);
  await page.getByRole('button',{name:'Publish',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#root').textContent.includes('artwork added to the draft'));
  assert.equal(x.core.albums(actor)[0].layout.artwork.cover.design,undefined);checks.push('portable cover artwork publishes public assets into draft without saving album');
  await page.getByRole('button',{name:'Save album',exact:true}).click();await page.waitForFunction(()=>window.album.saves.length===2);assert.match(x.core.albums(actor)[0].layout.artwork.cover.design.digest,/^sha256:/);checks.push('explicit album save retains pinned editable artwork design');
  await page.getByRole('button',{name:'Close artwork editor',exact:true}).click();await page.getByRole('button',{name:'Design album cover',exact:true}).click();await page.getByRole('button',{name:'Text',exact:true}).click();assert.equal(await page.getByLabel('Text content',{exact:true}).inputValue(),'Cover headline');checks.push('published source package reopens in editable cover studio');
  await page.screenshot({path:resolve(output,'album.png'),fullPage:true});await page.evaluate(()=>window.album.mounted.dispose());assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'result.json'),JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks,errors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));x.core.close();await rm(temp,{recursive:true,force:true});}
