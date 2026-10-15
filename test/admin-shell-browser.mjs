import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as pw from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {validateApplicationShell} from '../src/application-shell.js';

function captureAdminKeyboard(){
 const events=new AbortController(),trace={first:[],recent:[],keydown:0,keyup:0,preventedKeys:0,preventDefaultCalls:0,focusCalls:0,domMutations:0};
 const identify=node=>({tag:node?.tagName,label:node?.getAttribute?.('aria-label'),text:node?.tagName==='BUTTON'?node.textContent?.slice(0,60):undefined});
 const stack=()=>new Error().stack?.split('\n').slice(2,5).join('\n').slice(0,350);
 const record=(type,details={})=>{const entry={type,at:performance.now(),active:identify(document.activeElement),documentFocus:document.hasFocus(),...details};if(trace.first.length<8)trace.first.push(entry);trace.recent.push(entry);if(trace.recent.length>16)trace.recent.shift();};
 const focus=HTMLElement.prototype.focus,prevent=Event.prototype.preventDefault;
 function watchedFocus(...args){trace.focusCalls++;record('script-focus',{target:identify(this),stack:stack()});return Reflect.apply(focus,this,args);}
 function watchedPrevent(...args){if(this instanceof KeyboardEvent&&this.key==='Tab'){trace.preventDefaultCalls++;record('script-prevent',{shift:this.shiftKey,stack:stack()});}return Reflect.apply(prevent,this,args);}
 HTMLElement.prototype.focus=watchedFocus;Event.prototype.preventDefault=watchedPrevent;
 for(const capture of [true,false])window.addEventListener('keydown',event=>{if(event.key!=='Tab')return;if(capture)trace.keydown++;else if(event.defaultPrevented)trace.preventedKeys++;record(capture?'keydown-capture':'keydown-bubble',{shift:event.shiftKey,prevented:event.defaultPrevented,trusted:event.isTrusted,target:identify(event.target)});},{capture,passive:true,signal:events.signal});
 window.addEventListener('keyup',event=>{if(event.key==='Tab'){trace.keyup++;record('keyup',{shift:event.shiftKey,prevented:event.defaultPrevented,target:identify(event.target)});}},{capture:true,passive:true,signal:events.signal});
 for(const type of ['focusin','focusout'])document.addEventListener(type,event=>record(type,{target:identify(event.target)}),{capture:true,passive:true,signal:events.signal});
 const observer=new MutationObserver(records=>trace.domMutations+=records.length);observer.observe(document.querySelector('#root')??document.body,{childList:true,subtree:true});
 window.adminKeyboardProbe={trace,stop(){events.abort();observer.disconnect();if(HTMLElement.prototype.focus===watchedFocus)HTMLElement.prototype.focus=focus;if(Event.prototype.preventDefault===watchedPrevent)Event.prototype.preventDefault=prevent;}};record('installed');
}
async function compareAdminBlur(page){
 const setup=await page.evaluate(async()=>{
  window.adminKeyboardProbe?.stop();
  const original=document.querySelector('#root'),app=adminShell.app,parent=original.parentNode,next=original.nextSibling,previous=original.previousSibling,structure=original.outerHTML,scroll={x:scrollX,y:scrollY};
  const nodes=[original,...original.querySelectorAll('*')],positions=nodes.map(node=>({node,top:node.scrollTop,left:node.scrollLeft})),styles=[...document.querySelectorAll('style')],styleTexts=styles.map(node=>node.textContent);
  const enabled=()=>[...original.querySelectorAll('button,input,select,textarea,summary,a[href],iframe,[tabindex]')].filter(node=>!node.matches(':disabled')&&node.tabIndex>=0&&node.getClientRects().length),controls=enabled();
  const describe=()=>({documentFocus:document.hasFocus(),active:{tag:document.activeElement?.tagName,view:document.activeElement?.dataset.view},scroll:{x:scrollX,y:scrollY},controlCount:enabled().length,controls:enabled().slice(0,12).map(node=>({tag:node.tagName,view:node.dataset.view,text:['BUTTON','SUMMARY'].includes(node.tagName)?node.textContent.slice(0,60):undefined,disabled:node.matches(':disabled'),tabIndex:node.tabIndex,rect:node.getBoundingClientRect().toJSON()}))});
  const before=describe(),focused=document.activeElement,blurApplied=focused?.tagName==='BUTTON'&&focused.dataset.view==='admin'&&original.contains(focused);
  if(blurApplied)focused.blur();
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const afterNodes=[original,...original.querySelectorAll('*')],afterStyles=[...document.querySelectorAll('style')],afterControls=enabled();
  return {before,after:describe(),blurApplied,sameRoot:original.isConnected&&document.querySelector('#root')===original,sameApplication:adminShell.app===app,sameNodes:nodes.length===afterNodes.length&&nodes.every((node,index)=>node===afterNodes[index]),structurePreserved:original.outerHTML===structure,positionPreserved:original.parentNode===parent&&original.nextSibling===next&&original.previousSibling===previous,stylesPreserved:styles.length===afterStyles.length&&styles.every((node,index)=>node===afterStyles[index]&&node.textContent===styleTexts[index]),controlsPreserved:controls.length===4&&afterControls.length===controls.length&&controls.every((node,index)=>node===afterControls[index]),scrollPreserved:scrollX===scroll.x&&scrollY===scroll.y&&positions.every(({node,top,left})=>node.scrollTop===top&&node.scrollLeft===left),styleLengths:styleTexts.slice(0,32).map(text=>text.length),elementCount:nodes.length};
 });
 const result={setup,entry:[],reverse:[]};
 if(setup.blurApplied&&setup.sameRoot&&setup.sameApplication&&setup.sameNodes&&setup.structurePreserved&&setup.positionPreserved&&setup.stylesPreserved&&setup.controlsPreserved&&setup.scrollPreserved&&setup.after.documentFocus&&setup.after.active.tag==='BODY'){
  await page.evaluate(captureAdminKeyboard);
  const observe=()=>page.evaluate(()=>({tag:document.activeElement?.tagName,view:document.activeElement?.getAttribute('data-view'),text:['BUTTON','SUMMARY'].includes(document.activeElement?.tagName)?document.activeElement.textContent.slice(0,60):undefined,documentFocus:document.hasFocus()}));
  try{
   for(let step=0;step<4;step++){await page.keyboard.press('Tab');const state=await observe();result.entry.push(state);if(state.view==='admin')break;}
   for(let step=0;step<8;step++){await page.keyboard.press('Shift+Tab');result.reverse.push(await observe());}
   result.trace=await page.evaluate(()=>adminKeyboardProbe.trace);
  }finally{await page.evaluate(()=>adminKeyboardProbe.stop()).catch(()=>{});}
 }else result.skipped='Focused administration blur, unchanged live root/state or focused-document BODY entry could not be established';
 await writeFile(resolve(output,'admin-blur-comparison.json'),JSON.stringify({engine,result},null,2)+'\n');console.error('Blur-only administration keyboard comparison',JSON.stringify({engine,result}));
}

async function keyTo(page,target,direction='Tab'){
 const visited=[];let steps=0;
 try{
  await target.waitFor({state:'visible'});
  const deadline=Date.now()+15000;
  const inspect=node=>({focused:node===document.activeElement,active:document.activeElement?.getAttribute('aria-label')??(document.activeElement?.tagName==='BUTTON'?document.activeElement.textContent?.slice(0,60):document.activeElement?.tagName)});
  let state=await target.evaluate(inspect);
  while(!state.focused){
    assert(Date.now()<deadline,'Keyboard traversal must reach the intended control');
    await page.keyboard.press(direction);steps++;state=await target.evaluate(inspect);visited.push(state.active);if(visited.length>12)visited.shift();
  }
  assert(await target.evaluate(node=>{const r=node.getBoundingClientRect();return node.matches(':focus-visible')&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}),'Keyboard target must have visible focus in the viewport');
 }catch(error){
  const state=await target.evaluate(node=>{const controls=[...document.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(item=>!item.disabled&&item.tabIndex>=0&&item.getClientRects().length),identify=item=>({tag:item?.tagName,label:item?.getAttribute('aria-label'),text:item?.tagName==='BUTTON'?item.textContent?.slice(0,60):undefined});return {target:{...identify(node),disabled:node.disabled,connected:node.isConnected,inert:!!node.closest('[inert]'),focused:node===document.activeElement,focusVisible:node.matches(':focus-visible'),rect:node.getBoundingClientRect().toJSON()},active:identify(document.activeElement),documentFocus:document.hasFocus(),visibility:document.visibilityState,viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},controlCount:controls.length,targetPosition:controls.indexOf(node),activePosition:controls.indexOf(document.activeElement),navigation:[...document.querySelectorAll('#root [data-dc-region="navigation"] button')].map(button=>({view:button.dataset.view,current:button.getAttribute('aria-current'),disabled:button.disabled})),review:!!document.querySelector('.da-review'),status:[...document.querySelectorAll('.da-status')].map(status=>({kind:status.dataset.kind,text:status.textContent?.slice(0,100)}))};}).catch(()=>null);
  const trace=await page.evaluate(()=>window.adminKeyboardProbe?.trace).catch(()=>null);
  console.error('Administration keyboard failure',JSON.stringify({profile:[...manifests.keys()][cases.length],direction,steps,visited,lostReplies,state,trace}));await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'admin-keyboard-failure.png'),fullPage:true}).catch(()=>{});
  if(trace)try{await compareAdminBlur(page);}catch(probeError){console.error('Blur-only administration keyboard comparison failed',probeError.message);}throw error;
 }
}
async function keyActivate(page,target,key='Enter',direction='Tab'){await keyTo(page,target,direction);await page.keyboard.press(key);}
async function keyText(page,target,value){await keyTo(page,target);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(value);}

const engine=process.env.BROWSER_ENGINE??'webkit',output=resolve(process.argv[2]??'test-results/admin-shell'),manifests=new Map(),cases=[],errors=[];
let browser,x,actor,api,origin,dropExecute=false,lostReplies=0,holdOverview=false,releaseOverview,capturedOverview;
const server=createServer(async(request,response)=>{
  try{
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/api/command-intents/execute'&&dropExecute){dropExecute=false;response.end=()=>{
      lostReplies++;
      // Deliver response bytes before truncation so transport retries cannot hide the lost result.
      response.flushHeaders();response.write('{"intent":',()=>response.destroy());return response;
    };}
    if(path==='/api/operator/admin'&&holdOverview){holdOverview=false;const end=response.end.bind(response);response.end=(...args)=>{releaseOverview=()=>end(...args);capturedOverview?.();return response;};}
    if(await api?.(request,response))return;
    if(manifests.has(path)){response.setHeader('content-type','application/json');response.end(JSON.stringify(manifests.get(path)));return;}
    if(path==='/admin-shell'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administration shell</title></head><body><main id="root"></main></body></html>');return;}
    if(await serveReference(request,response,{production:true}))return;response.writeHead(404).end();
  }catch{response.writeHead(500).end();}
});
async function mount(page,manifestPath){
  await page.evaluate(async manifestPath=>{const [{mountFramework},{createClient},{loadApplicationShell}]=await Promise.all([import('/src/ui.js'),import('/src/client.js'),import('/src/application-shell.js')]);const test=window.adminShell={client:createClient()};test.app=mountFramework(document.querySelector('#root'),{client:test.client,sections:['collection','admin'],navigation:'tabs',shell:loadApplicationShell(manifestPath)});await test.app.ready;await test.app.shellReady;},manifestPath);
}
try{
  for(const language of ['python','go'])for(const topology of ['rail','header']){
    const source=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,topology]:['run',source,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    manifests.set('/shell/'+language+'-'+topology+'.json',validateApplicationShell(JSON.parse(bytes)));
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  try{browser=await pw[engine].launch({headless:true});}catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  for(const [manifestPath]of manifests){
    x=fixture();const manager={...x.alice,permissions:['admin.read','admin.manage']},executions=[],mutations=[],privateResponses=[];let discoveries=0;
    const execute=x.core.executeCommandIntentAsync.bind(x.core);x.core.executeCommandIntentAsync=async(principal,input,...options)=>{executions.push({userId:principal.userId,input:structuredClone(input)});return execute(principal,input,...options);};
    const configure=x.core.configureAdmin.bind(x.core);x.core.configureAdmin=(principal,input)=>{const result=configure(principal,input);mutations.push(structuredClone(input));return result;};
    actor=manager;api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
    const page=await browser.newPage({viewport:{width:1200,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname==='/api/command-intents')discoveries++;});
    page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/operator/admin')||path.startsWith('/api/command-intents'))privateResponses.push({path,cache:response.headers()['cache-control']});if(response.status()>=400&&path.startsWith('/src/'))errors.push('Module '+response.status()+' '+path);});
    await page.goto(origin+'/admin-shell');await mount(page,manifestPath);
    const nav=page.locator('#root [data-dc-region="navigation"]'),panel=page.locator('#root .dc-admin');
    await nav.locator('[data-view="admin"]').click();await panel.getByRole('heading',{name:'A clear view of your community',exact:true}).waitFor();await panel.locator('[data-admin-tab="website"]').click();
    await panel.getByLabel('Pack purchases',{exact:true}).uncheck();await nav.locator('[data-view="collection"]').click();await panel.locator('.da-leave').waitFor();await panel.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await nav.locator('[data-view="admin"]').getAttribute('aria-current'),'page');assert.equal(await panel.getByLabel('Pack purchases',{exact:true}).isChecked(),false);
    await nav.locator('[data-view="collection"]').click();await panel.getByRole('button',{name:'Discard draft and continue',exact:true}).click();assert.equal(await nav.locator('[data-view="collection"]').getAttribute('aria-current'),'page');await page.evaluate(()=>adminShell.app.refresh());assert.equal(x.core.adminOverview(manager).revision,0);assert.equal(mutations.length,0);
    await page.evaluate(captureAdminKeyboard);
    await keyActivate(page,nav.locator('[data-view="admin"]'),'Enter',manifestPath.endsWith('-rail.json')?'Shift+Tab':'Tab');await keyActivate(page,panel.locator('[data-admin-tab="website"]'));await panel.getByLabel('Pack purchases',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Pack purchases',{exact:true}).isChecked(),true);
    const reason='Scheduled event <literal> 0007';await keyActivate(page,panel.getByLabel('Trading',{exact:true}),'Space');await keyText(page,panel.getByLabel('Reason (optional)',{exact:true}),reason);await keyActivate(page,panel.getByRole('button',{name:'Review changes',exact:true}));await panel.locator('.da-review').waitFor();assert((await panel.locator('.da-review').textContent()).includes(reason));assert.equal(await panel.locator('literal').count(),0);assert.equal(x.core.adminOverview(manager).revision,0);
    const lostBefore=lostReplies;dropExecute=true;await keyActivate(page,panel.getByRole('button',{name:'Save changes',exact:true}));await panel.locator('.da-status[data-kind="error"]').waitFor();await panel.getByRole('button',{name:'Retry same change',exact:true}).waitFor();assert.equal(lostReplies,lostBefore+1);assert.equal(executions.length,1);assert.equal(x.core.adminOverview(manager).revision,1);assert.equal(x.core.adminOverview(manager).site.tradingPaused,true);
    const intents=x.core.commandIntents(manager,{command:'configureAdmin'}).items;assert.equal(intents.length,1);const original=intents[0];assert.equal(original.state,'completed');assert.equal(executions[0].input.id,original.id);const {key,...terms}=original.input;assert.equal(typeof key,'string');assert.deepEqual(terms,{scope:'site',changes:{tradingPaused:true},reason,expectedRevision:0});
    const discoveryBefore=discoveries;assert(await page.evaluate(()=>localStorage.length+sessionStorage.length>0));await page.evaluate(()=>{adminShell.app.dispose();localStorage.clear();sessionStorage.clear();});assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);await mount(page,manifestPath);await nav.locator('[data-view="admin"]').click();await panel.getByRole('button',{name:'Retry same change',exact:true}).waitFor();assert(discoveries>discoveryBefore);assert.equal(executions.length,1);
    await page.evaluate(()=>window.adminKeyboardProbe?.stop());await page.evaluate(captureAdminKeyboard);
    await keyActivate(page,panel.getByRole('button',{name:'Retry same change',exact:true}),'Enter','Shift+Tab');await panel.locator('.da-review').waitFor({state:'detached'});await panel.getByRole('heading',{name:'A clear view of your community',exact:true}).waitFor();assert.equal(executions.length,2);assert.deepEqual(executions[0],executions[1]);assert(mutations.length>=1);for(const input of mutations)assert.deepEqual(input,original.input);assert.equal(x.core.adminOverview(manager).revision,1);const history=x.core.adminHistory(manager,{limit:10});assert.equal(history.items.length,1);assert.equal(history.items[0].reason,reason);assert.equal(history.items[0].after.tradingPaused,true);await page.evaluate(()=>adminKeyboardProbe.stop());assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
    actor={...x.alice,permissions:['admin.read']};await page.evaluate(()=>adminShell.app.refresh());await panel.getByRole('heading',{name:'A clear view of your community',exact:true}).waitFor();await panel.locator('[data-admin-tab="website"]').click();const trading=panel.getByLabel('Trading',{exact:true});await trading.waitFor();assert.equal(await trading.isChecked(),false);assert.equal(await trading.isDisabled(),true);assert.equal(await panel.getByRole('button',{name:'Review changes',exact:true}).isDisabled(),true);
    const deniedInput={key:'read-only-denied',scope:'site',expectedRevision:1,changes:{tradingPaused:false},reason:'Synthetic denied change'};for(const [path,input]of [['/api/operator/admin/settings',deniedInput],['/api/command-intents',{command:'configureAdmin',input:deniedInput}]]){
      const response=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-DC-Principal':x.alice.userId},body:JSON.stringify({...input,role:'admin'})});assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
    }
    assert.equal(x.core.adminOverview(manager).revision,1);assert.equal(executions.length,2);
    const captured=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Expected held administration overview')),15000);capturedOverview=()=>{clearTimeout(timer);capturedOverview=undefined;resolve();};});holdOverview=true;await page.evaluate(()=>adminShell.app.refresh());await captured;await page.evaluate(()=>{adminShell.detached=document.querySelector('.dc-admin');adminShell.app.dispose();adminShell.detachedText=adminShell.detached.textContent;});assert.equal(await page.locator('#root .dc-admin').count(),0);const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operator/admin');releaseOverview();releaseOverview=undefined;await (await lateResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('#root').textContent(),'');assert(await page.evaluate(()=>!adminShell.detached.isConnected&&adminShell.detached.textContent===adminShell.detachedText));assert.equal(x.core.adminHistory(manager,{limit:10}).items.length,1);
    assert(privateResponses.length>0);assert(privateResponses.every(response=>response.cache==='no-store'));cases.push({manifest:manifestPath,reviewedChanges:1,keyboardReviewSave:true,keyboardRecovery:"Shift+Tab then Enter",reducedMotion:true,lostReplies:1,erasedStorageRecovery:true,originalIntentExecutions:2,revision:1,historyEntries:1,readOnlyDenials:2,leaveGuard:true,disposedLateLoad:true});await page.close();x.core.close();x=undefined;
  }
  assert.equal(lostReplies,4);assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify({engine,cases,lostReplies,errors},null,2)+'\n');console.log(JSON.stringify({engine,cases,lostReplies,errors},null,2));
}finally{releaseOverview?.();await browser?.close();x?.core.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
