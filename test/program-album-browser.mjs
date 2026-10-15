import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {fixture as artworkFixture,build} from './presentation-fixtures.mjs';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {programHeaders} from '../src/presentation/program.js';

async function keyTo(page,target){
  await target.waitFor({state:'visible'});
  const deadline=Date.now()+15000;
  while(!await target.evaluate(node=>node===document.activeElement)){
    assert(Date.now()<deadline,'Keyboard traversal must reach the intended control');
    await page.keyboard.press('Tab');
  }
  assert(await target.evaluate(node=>{const r=node.getBoundingClientRect();return node.matches(':focus-visible')&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}),'Keyboard target must have visible focus in the viewport');
}
async function keyActivate(page,target,key='Enter'){await keyTo(page,target);await page.keyboard.press(key);}
async function keyText(page,target,value){await keyTo(page,target);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(value);}

const baseOutput=resolve(process.argv[2]??'test-results/program-album'),languages=(process.env.DC_PROGRAM_LANGUAGES??'python,go').split(',');
if(languages.some(language=>!['python','go'].includes(language)))throw Error('Unsupported program generator');
async function qualify(language){
const output=languages.length===1?baseOutput:resolve(baseOutput,language),engine=process.env.BROWSER_ENGINE??'chromium';
await mkdir(output,{recursive:true});
const temp=await mkdtemp(resolve(tmpdir(),'program-album-')),x=fixture(),pkg=await build(artworkFixture()),checks=[],errors=[],saves=[];
let browser,api,hostOrigin,actor=x.alice,gate=false,posterArrived,paused=[];
const posterPath=pkg.manifest.assets.find(asset=>asset.id===pkg.manifest.faces.front.poster).path;
const programServer=createServer(async(request,response)=>{
  try{
    for(const [key,value]of Object.entries(programHeaders(hostOrigin)))response.setHeader(key,value);response.setHeader('access-control-allow-origin','*');
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/'||path==='/index.html'){response.setHeader('content-type','text/html');response.end(await readFile(resolve(temp,'index.html')));return;}
    if(path==='/card.css'){response.setHeader('content-type','text/css');response.end(await readFile(resolve(temp,'card.css')));return;}
    if(['/program-album-bootstrap.js','/program.js','/editor-display.js','/collection-display.js','/shop-display.js','/trading-display.js','/marketplace-display.js','/album-display.js','/opener-display.js','/data.js','/media.js'].includes(path)){response.setHeader('content-type','text/javascript');response.end(await readFile(new URL('../src/presentation'+path,import.meta.url)));return;}
    response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
const hostServer=createServer(async(request,response)=>{
  try{
    if(await api?.(request,response))return;
    if(request.url==='/album-harness'){response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="en"><title>Reviewed album layouts</title><style>body{font:16px system-ui;margin:20px}main{min-height:100px}#probes{margin:20px}</style><main id="root"></main><section id="probes"></section></html>');return;}
    const path=new URL(request.url,'http://localhost').pathname,prefix='/pinned/';
    if(path.startsWith(prefix)){const asset=path.slice(prefix.length),bytes=pkg.files.get(asset);if(!bytes){response.writeHead(404);response.end();return;}response.setHeader('content-type',asset.endsWith('.png')?'image/png':'application/json');
      if(gate&&asset===posterPath){paused.push({response,bytes});posterArrived?.();return;}response.end(bytes);return;}
    if(await serveReference(request,response))return;response.writeHead(404);response.end();
  }catch(error){response.writeHead(500);response.end(error.message);}
});
try{
  let author=process.env.PYTHON??'python',authorArgs=[fileURLToPath(new URL('../examples/plugins/python-program-card.py',import.meta.url))];
  if(language==='go'){author=resolve(temp,process.platform==='win32'?'program-author.exe':'program-author');assert.equal(execFileSync(process.env.GO??'go',['build','-trimpath','-o',author,fileURLToPath(new URL('../examples/plugins/go-program-card/main.go',import.meta.url))],{windowsHide:true,timeout:60000,maxBuffer:16384,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'}}).length,0);authorArgs=[];}
  assert.equal(execFileSync(author,[...authorArgs,'--album',temp],{windowsHide:true,timeout:10000,maxBuffer:16384}).length,0);
  await new Promise(resolve=>hostServer.listen(0,'127.0.0.1',resolve));hostOrigin='http://127.0.0.1:'+hostServer.address().port;
  await new Promise(resolve=>programServer.listen(0,'127.0.0.1',resolve));const programOrigin='http://127.0.0.1:'+programServer.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:hostOrigin,requirePrincipal:true});
  await x.core.registerCardPresentation(admin,pkg.archive);const catalog=x.core.operatorCatalog(admin);catalog.version++;catalog.cards.find(card=>card.id==='dawn').presentation={contract:'digital-card@0.1',digest:pkg.digest,baseURL:hostOrigin+'/pinned/'};x.core.publishCatalog(admin,catalog);
  const copies=[...x.open(),...x.open('unique')],layout={id:'journal',pageSize:1,debugSecret:'PRIVATE-LAYOUT',artwork:{pages:[{id:'first',title:'First <page>'},{id:'second',title:'Second page'}]}},placements=copies.map((copy,index)=>({copyId:copy.id,position:index,data:{pageId:index?'second':'first',privateNote:'PRIVATE-PLACEMENT'}}));
  const privateAlbum=x.core.saveAlbum(x.alice,{key:'private-album',name:'Private <album>',visibility:'private',layout,placements}),publicAlbum=x.core.saveAlbum(x.alice,{key:'public-album',name:'Public album',visibility:'public',layout,placements});
  const save=x.core.saveAlbum.bind(x.core);x.core.saveAlbum=(actor,input)=>{const result=save(actor,input);saves.push({input:structuredClone(input),result:structuredClone(result)});return result;};
  const actual=x.core.viewAlbum(x.alice,privateAlbum.id);assert(JSON.stringify(actual).includes('PRIVATE-DEMO-CODE'));
  try{browser=await pw[engine].launch({headless:process.env.HEADED!=='1'});}catch(error){if(engine!=='chromium')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(hostOrigin+'/album-harness');
  await page.evaluate(async programOrigin=>{
    const [{createClient},{mountFramework},{render3DInspector},{createProgramAlbumRenderer}]=await Promise.all([import('/src/client.js'),import('/src/ui.js'),import('/src/inspector-ui.js'),import('/src/presentation/program-album-view.js')]);
    window.albumTest={createClient,mountFramework,render3DInspector,createProgramAlbumRenderer,payloads:[],channels:[],inspected:[],diagnostics:[]};
    const send=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(value,...transfer){if(value?.type==='content')window.albumTest.payloads.push(structuredClone(value.content));return send.call(this,value,...transfer);};
    const NativeChannel=MessageChannel;window.MessageChannel=class extends NativeChannel{constructor(){super();window.albumTest.channels.push(this);this.port1.addEventListener('message',event=>{this.received=event.data;this.nonce=event.data.nonce;});}};
    const fields=['albumName','cardName','rarity','pageName','preview'],registry=window.albumTest.registry=new Map([['example.album',{approved:true,version:'1.0.0',url:programOrigin+'/',title:'Celestial album',intents:['select-item'],albumDisplay:{profile:'dc.album-display@1',fields}}]]);
    const renderer=window.albumTest.renderer=createProgramAlbumRenderer({registry,programId:'example.album',displayFields:fields,onDiagnostic:value=>window.albumTest.diagnostics.push(value)});
    window.albumTest.mount=async()=>{const client=window.albumTest.client=createClient();window.albumTest.view=mountFramework(document.querySelector('#root'),{client,sections:['albums'],layouts:{journal:window.albumTest.renderer},inspectorRenderer(copy,options){window.albumTest.inspected.push(copy.id);return render3DInspector(copy,options);}});await window.albumTest.view.ready;};await window.albumTest.mount();
  },programOrigin);
  const album=page.locator('.dc-album-preview dc-program-album'),frameOf=async node=>(await node.locator('iframe').elementHandle()).contentFrame();
  await keyTo(page,page.getByLabel('Your albums',{exact:true}));await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Your albums',{exact:true}).inputValue(),privateAlbum.id);await album.scrollIntoViewIfNeeded();
  await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();assert.equal(await album.frameLocator('iframe').locator('.album-item').count(),2);
  assert.equal(await album.frameLocator('iframe').locator('[data-dc-album-name]').textContent(),'Private <album>');assert.equal(await album.frameLocator('iframe').locator('.album-page').first().locator('[data-dc-page-name]').textContent(),'First <page>');
  await(await frameOf(album)).waitForFunction(()=>{const image=document.querySelector('img[src]');return image?.complete&&image.naturalWidth===2;});
  const payloads=await page.evaluate(()=>window.albumTest.payloads),serialized=JSON.stringify(payloads);for(const secret of ['PRIVATE-DEMO-CODE','PRIVATE-LAYOUT','PRIVATE-PLACEMENT',privateAlbum.id,x.alice.userId,...copies.map(copy=>copy.id),hostOrigin+'/pinned/'])assert(!serialized.includes(secret));
  for(const key of ['copyId','ownerId','bindings','codes','source','provenance','metadata','baseURL'])assert(!serialized.includes('"'+key+'":'));
  await album.frameLocator('iframe').locator('.item-select').filter({hasText:'Dawn'}).click();await page.locator('.dc-inspector-dialog').waitFor();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  await page.evaluate(()=>{const channel=window.albumTest.channels.filter(channel=>channel.port1.onmessage&&channel.nonce).at(-1);window.albumTest.stale={handler:channel.port1.onmessage,nonce:channel.nonce,snapshot:window.albumTest.payloads.at(-1),inspections:window.albumTest.inspected.length};});
  await page.getByRole('button',{name:'Move Dawn later',exact:true}).click();await keyActivate(page,page.getByRole('button',{name:'Preview album',exact:true}));await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  const freshness=await page.evaluate(()=>{const old=window.albumTest.stale,current=window.albumTest.payloads.at(-1);old.handler({data:{version:1,type:'intent',intent:'select-item',nonce:old.nonce,snapshotId:old.snapshot.snapshotId,handle:old.snapshot.items[0].handle}});return {fresh:current.snapshotId!==old.snapshot.snapshotId&&current.items.every(item=>!old.snapshot.items.some(old=>old.handle===item.handle)),noSelection:window.albumTest.inspected.length===old.inspections,order:current.items.map(item=>item.name)};});assert(freshness.fresh&&freshness.noSelection);assert.deepEqual(freshness.order,['One Solstice','Dawn']);
  checks.push('Actual private album and unsaved reorder render current full contents/pages; granted pinned raster bytes display, private records/IDs/URLs stay parent-side, current handles inspect the correct copy and obsolete sessions cannot select');

  const artworkSummary=page.getByText('Cover, spine & pages',{exact:true});
  await artworkSummary.scrollIntoViewIfNeeded();
  await artworkSummary.click();
  assert.equal(await artworkSummary.evaluate(node=>node.parentElement.open),true,'Native album artwork disclosure must open after pointer activation');
  await page.getByLabel('Page 1 title',{exact:true}).fill('Edited first page');
  await page.getByRole('button',{name:'Move page 1 later',exact:true}).click();
  await page.locator('.dc-arrange-tile').filter({has:page.getByRole('button',{name:'Move Dawn earlier',exact:true})}).getByRole('combobox').selectOption('second');
  await keyText(page,page.getByLabel('Album name',{exact:true}),'Edited private album');await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Preview album',exact:true}).click();await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  await keyActivate(page,page.getByRole('button',{name:'Save album',exact:true}));await page.waitForFunction(()=>!document.querySelector('#root').hasAttribute('aria-busy'));assert.equal(saves.length,1,await page.locator('.dc-status').textContent());
  const saved=saves[0];assert.equal(saved.result.id,privateAlbum.id);assert.equal(saved.input.visibility,'private');assert.equal(saved.input.layout.id,'journal');
  assert.deepEqual(saved.input.layout.artwork.pages,[{id:'second',title:'Second page'},{id:'first',title:'Edited first page'}]);
  assert.deepEqual(saved.input.placements,[{copyId:copies[1].id,position:0,data:{pageId:'second',privateNote:'PRIVATE-PLACEMENT'}},{copyId:copies[0].id,position:1,data:{pageId:'second',privateNote:'PRIVATE-PLACEMENT'}}]);
  const reloaded=await page.evaluate(async id=>window.albumTest.client.viewAlbum(id),privateAlbum.id);assert.deepEqual(reloaded.layout,saved.input.layout);assert.deepEqual(reloaded.cards.map(card=>({copyId:card.copy.id,position:card.placement.position,data:card.placement.data})),saved.input.placements);assert.equal(reloaded.name,'Edited private album');assert.deepEqual(x.core.viewAlbum(x.alice,privateAlbum.id).layout,saved.input.layout);
  const beforeInvalid=structuredClone(x.core.albums(x.alice));
  const invalid=await page.evaluate(async ({id,copyId,version})=>{try{await window.albumTest.client.saveAlbum({key:'invalid-page-assignment',albumId:id,expectedVersion:version,name:'Invalid assignment',visibility:'private',layout:{pageSize:1,artwork:{pages:[]}},placements:[{copyId,position:0,data:{pageId:'missing'}}]});return false;}catch(error){return error.code==='INVALID_INPUT';}},{id:privateAlbum.id,copyId:copies[0].id,version:saved.result.version});assert(invalid);assert.deepEqual(x.core.albums(x.alice),beforeInvalid);
  await page.waitForFunction(()=>!document.querySelector('#root').hasAttribute('aria-busy'));await keyTo(page,page.getByLabel('Your albums',{exact:true}));await page.keyboard.press('End');await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Your albums',{exact:true}).inputValue(),publicAlbum.id);await keyTo(page,page.getByLabel('Your albums',{exact:true}));await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Your albums',{exact:true}).inputValue(),privateAlbum.id);
  assert.equal(await page.getByLabel('Album name',{exact:true}).inputValue(),'Edited private album');assert.equal(await page.getByLabel('Page 2 title',{exact:true}).inputValue(),'Edited first page');
  await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();assert.equal(await album.frameLocator('iframe').locator('[data-dc-album-name]').textContent(),'Edited private album');
  assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));assert(await album.frameLocator('iframe').locator('html').evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));checks.push('Keyboard album selection, name edit, preview/save and reload preserve the edited private album under reduced motion; artwork preparation remains separate');
  checks.push('Native card/page reorder and explicit assignment save through real HTTP; reload preserves exact layout/private placement data and current program display; invalid assignment rejects without mutation');

  await page.evaluate(()=>window.albumTest.renderer.setEnabled(false));assert.equal(await album.locator('iframe').count(),0);
  await album.getByRole('button',{name:/Dawn, common/}).click();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  await page.evaluate(()=>{window.albumTest.renderer.setEnabled(true);});await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  await page.evaluate(()=>{const entry=window.albumTest.registry.get('example.album');window.albumTest.registry.set('example.album',{...entry,albumDisplay:{profile:'dc.album-display@1',fields:[]}});window.albumTest.renderer.setEnabled(false);window.albumTest.renderer.setEnabled(true);});
  await page.waitForFunction(()=>window.albumTest.diagnostics.some(value=>value.code==='PROGRAM_UNAVAILABLE'));assert.equal(await album.locator('iframe').count(),0);
  await album.getByRole('button',{name:/Dawn, common/}).click();assert.equal(await page.evaluate(()=>window.albumTest.inspected.at(-1)),copies[0].id);await page.getByRole('button',{name:'Close inspection',exact:true}).click();
  const beforeDispose=structuredClone(x.core.albums(x.alice));await page.evaluate(()=>{window.albumTest.retainedSave=[...document.querySelectorAll('button')].find(button=>button.textContent==='Save album');window.albumTest.renderer.dispose();window.albumTest.view.dispose();window.albumTest.retainedSave.click();});assert.equal(await page.locator('#root iframe').count(),0);assert.deepEqual(x.core.albums(x.alice),beforeDispose);actor=x.bob;
  await page.evaluate(async()=>{const fields=['albumName','cardName','rarity','pageName','preview'],entry=window.albumTest.registry.get('example.album');window.albumTest.registry.set('example.album',{...entry,albumDisplay:{profile:'dc.album-display@1',fields}});window.albumTest.renderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:fields});await window.albumTest.mount();});
  const denied=await page.evaluate(async id=>{try{await window.albumTest.client.viewAlbum(id);return false;}catch(error){return error.code==='NOT_FOUND';}},privateAlbum.id);assert(denied);
  await page.getByText('Visit public albums',{exact:true}).click();await page.getByRole('button',{name:'Explore',exact:true}).click();await page.getByRole('button',{name:'Public album · Alice',exact:true}).click();await album.scrollIntoViewIfNeeded();await album.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();assert.equal(await album.frameLocator('iframe').locator('.album-item').count(),2);
  checks.push('Disabled and denied-profile native card clicks reach correct host inspection; actual public viewer can render public album while private album remains inaccessible');

  await page.evaluate(()=>{window.albumTest.view.dispose();window.albumTest.renderer.dispose();});actor=x.alice;
  await page.evaluate(async privateId=>{
    const client=window.albumTest.client=window.albumTest.createClient();await client.me();const model=await client.viewAlbum(privateId),previewCopy=model.cards.find(item=>item.copy.definition.presentation).copy,fields=['albumName','cardName','rarity','pageName','preview'];
    window.albumTest.largeRenderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:fields,fallbackRenderer(){const node=document.createElement('div');node.textContent='Native fallback';return node;}});
    window.albumTest.large=window.albumTest.largeRenderer({...model,layout:{},cards:Array.from({length:1000},(_,position)=>({placement:{position,data:{privateNote:'NEVER-SEND'}},copy:{...previewCopy,definition:{...previewCopy.definition,name:'Card '+position}}}))});document.querySelector('#probes').append(window.albumTest.large);
  },privateAlbum.id);
  const large=page.locator('#probes dc-program-album');await large.scrollIntoViewIfNeeded();await large.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();
  assert.equal(await large.frameLocator('iframe').locator('.album-item').count(),1000);await(await frameOf(large)).waitForFunction(()=>document.querySelectorAll('img[src]').length===1000);
  const batch=await page.evaluate(()=>{const snapshot=window.albumTest.payloads.findLast(value=>value.items.length===1000),messages=window.albumTest.payloads.filter(value=>value.snapshotId===snapshot.snapshotId);return {count:messages.length,initial:messages[0].previews.length,final:messages.at(-1).previews.length};});
  assert(batch.count===1||batch.count===2,'At most metadata plus one final preview batch');assert.equal(batch.final,1000);if(batch.count===2)assert.equal(batch.initial,0);
  await page.evaluate(()=>{window.albumTest.largeRenderer.dispose();document.querySelector('#probes').replaceChildren();});
  gate=true;const arrived=new Promise(resolve=>{posterArrived=resolve;});
  await page.evaluate(async privateId=>{const model=await window.albumTest.client.viewAlbum(privateId);window.albumTest.gateRenderer=window.albumTest.createProgramAlbumRenderer({registry:window.albumTest.registry,programId:'example.album',displayFields:['cardName','preview'],fallbackRenderer(){return document.createElement('div');}});window.albumTest.gateNode=window.albumTest.gateRenderer(model);document.querySelector('#probes').append(window.albumTest.gateNode);},privateAlbum.id);
  const gated=page.locator('#probes dc-program-album');await gated.scrollIntoViewIfNeeded();let timer;try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Preview request not observed')),10000);})]);}finally{clearTimeout(timer);}
  await page.evaluate(()=>{window.albumTest.gatedCount=window.albumTest.payloads.length;window.albumTest.gateRenderer.setEnabled(false);});gate=false;for(const item of paused)if(!item.response.destroyed)item.response.end(item.bytes);paused=[];
  await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});assert.equal(await page.evaluate(()=>window.albumTest.payloads.length),await page.evaluate(()=>window.albumTest.gatedCount));
  await page.evaluate(()=>window.albumTest.gateRenderer.setEnabled(true));await gated.frameLocator('iframe').locator('html[data-dc-album-state="ready"]').waitFor();await(await frameOf(gated)).waitForFunction(()=>{const image=document.querySelector('img[src]');return image?.complete&&image.naturalWidth>0;});
  await page.screenshot({path:resolve(output,'album-program.png'),fullPage:true});await page.evaluate(()=>{window.albumTest.gateRenderer.dispose();window.albumTest.gateRenderer.setEnabled(true);});assert.equal(await page.locator('#probes iframe').count(),0);
  checks.push('All 1000 projected placements render without truncation; optional previews arrive once per bounded batch; disabled late preview cannot update an obsolete session, fresh remount works and final disposal is terminal');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({engine,language,checks,errors},null,2));console.log(JSON.stringify({engine,language,checks,errors}));return {engine,language,checks,errors};
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await writeFile(resolve(output,'failure.json'),JSON.stringify({message:error.message,errors,status:await page.locator('.dc-status').allTextContents(),editorErrors:await page.locator('.dc-error').allTextContents()},null,2));throw error;
}finally{await browser?.close();for(const item of paused)if(!item.response.destroyed)item.response.end(item.bytes);for(const server of [hostServer,programServer]){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}x.core.close();await rm(temp,{recursive:true,force:true});}

}
const results=[];for(const language of languages)results.push(await qualify(language));
if(languages.length>1)await writeFile(resolve(baseOutput,'result.json'),JSON.stringify({engine:process.env.BROWSER_ENGINE??'chromium',languages,results},null,2));
