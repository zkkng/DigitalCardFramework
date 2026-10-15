import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as pw from 'playwright';
import {codesFixture} from './codes-fixtures.mjs';
import {createApiHandler} from '../src/http.js';
import {createCodeGateway} from '../src/code-gateway.js';
import {serveReference} from '../src/static.js';
import {validateApplicationShell} from '../src/application-shell.js';

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

const engine=process.env.BROWSER_ENGINE??'webkit',output=resolve(process.argv[2]??'test-results/codes-shell'),manifests=new Map(),cases=[],errors=[];
let browser,x,actor,api,origin,dropReveal=false,holdReveal=false,releaseReveal,capturedReveal;
const server=createServer(async(request,response)=>{
  try{
    if(request.url==='/api/codes/reveal'&&dropReveal){
      dropReveal=false;response.end=()=>{
        // Deliver response bytes before truncation so transport retries cannot hide the lost result.
        response.flushHeaders();response.write('{"result":',()=>response.destroy());return response;
      };
    }
    if(request.url==='/api/codes/reveal'&&holdReveal){holdReveal=false;const end=response.end.bind(response);response.end=(...args)=>{releaseReveal=()=>end(...args);capturedReveal?.();return response;};}
    if(await api?.(request,response))return;
    const path=new URL(request.url,'http://localhost').pathname;
    if(manifests.has(path)){response.setHeader('content-type','application/json');response.end(JSON.stringify(manifests.get(path)));return;}
    if(path==='/codes-shell'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private code history</title></head><body><main id="root"></main></body></html>');return;}
    if(await serveReference(request,response,{production:true}))return;response.writeHead(404).end();
  }catch{response.writeHead(500).end();}
});
try{
  for(const language of ['python','go'])for(const topology of ['rail','header']){
    const source=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,topology]:['run',source,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    const manifest=validateApplicationShell(JSON.parse(bytes));assert(!JSON.stringify(manifest).includes('SECRET-REWARD'));manifests.set('/shell/'+language+'-'+topology+'.json',manifest);
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  try{browser=await pw[engine].launch({headless:true});}catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  for(const [manifestPath,manifest]of manifests){
    x=codesFixture({stock:4});const aCopies=[x.openCode(),x.openCode(),x.openCode()],bCopy=x.open('bundle',x.bob).find(copy=>copy.cardId==='reward'),aIds=aCopies.map(copy=>copy.codes[0].id),bId=bCopy.codes[0].id,revealCalls=[],providerCalls=[],privateResponses=[];
    const reveal=x.core.revealCode.bind(x.core);x.core.revealCode=(principal,input)=>{revealCalls.push({userId:principal.userId,input:structuredClone(input)});return reveal(principal,input);};
    const gateway=createCodeGateway({framework:x.core,providers:{'example.game':{lookup:async material=>{providerCalls.push(material.codeId);return {codeId:material.codeId,status:'redeemed',eventId:'verified-'+material.codeId,occurredAt:'2026-09-30T12:01:00Z'};}}}});
    actor=x.alice;api=createApiHandler({framework:x.core,codeGateway:gateway,resolveIdentity:request=>request.headers.authorization==='bob'?x.bob:actor,allowedOrigin:origin,requirePrincipal:true});
    const page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/codes'))privateResponses.push({path,status:response.status(),cache:response.headers()['cache-control']});if(response.status()>=400&&path.startsWith('/src/'))errors.push('Module '+response.status()+' '+path);});
    await page.goto(origin+'/codes-shell');
    await page.evaluate(async manifestPath=>{const [{mountFramework},{createClient},{loadApplicationShell}]=await Promise.all([import('/src/ui.js'),import('/src/client.js'),import('/src/application-shell.js')]);const test=window.codeShell={mountFramework,client:createClient(),shell:loadApplicationShell(manifestPath)};test.options={client:test.client,sections:['codes'],navigation:'tabs',shell:test.shell};test.app=mountFramework(document.querySelector('#root'),test.options);await test.app.ready;await test.app.shellReady;},manifestPath);
    const content=page.locator('#root [data-dc-region="content"]'),articles=content.locator('.dc-code-history > article');await articles.nth(2).waitFor();assert.equal(await articles.count(),3);assert.equal(await page.locator('#root [data-dc-region="navigation"] [data-view="codes"]').count(),1);
    const ownHistory=await page.evaluate(()=>codeShell.client.codeHistory());assert.deepEqual(new Set(ownHistory.items.map(row=>row.id)),new Set(aIds));assert(!JSON.stringify(ownHistory).includes('SECRET-REWARD'));assert.equal(revealCalls.length,0);
    const rowFor=id=>articles.nth(ownHistory.items.findIndex(row=>row.id===id));
    const foreignHistory=await fetch(origin+'/api/codes',{headers:{Authorization:'bob'}});assert.equal(foreignHistory.headers.get('cache-control'),'no-store');const foreign=await foreignHistory.json();assert.deepEqual(foreign.items.map(row=>row.id),[bId]);assert(!JSON.stringify(foreign).includes('SECRET-REWARD'));
    for(const [path,input]of [['reveal',{key:'foreign-reveal',codeId:aIds[0]}],['report',{key:'foreign-report',codeId:aIds[0],used:true}],['reconcile',{codeId:aIds[0]}]]){
      const response=await fetch(origin+'/api/codes/'+path,{method:'POST',headers:{Authorization:'bob',Origin:origin,'Content-Type':'application/json','X-DC-Principal':x.bob.userId},body:JSON.stringify({...input,userId:x.alice.userId,role:'admin'})});assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');assert(!(await response.text()).includes('SECRET-REWARD'));
    }
    const first=rowFor(aIds[0]);dropReveal=true;await keyActivate(page,first.getByRole('button',{name:'Reveal code',exact:true}));await first.locator('.dc-code-reveal[data-state="error"]').waitFor();const attemptsBeforeRetry=revealCalls.filter(call=>call.userId===x.alice.userId&&call.input.codeId===aIds[0]);assert.equal(attemptsBeforeRetry.length,1);
    await keyActivate(page,first.getByRole('button',{name:'Reveal code',exact:true}));await first.locator('.dc-code-reveal[data-state="revealed"]').waitFor();assert.equal(await first.locator('.dc-code-value').textContent(),'SECRET-REWARD-0');const originalAttempts=revealCalls.filter(call=>call.userId===x.alice.userId&&call.input.codeId===aIds[0]);assert.equal(originalAttempts.length,2);assert.deepEqual(originalAttempts[0].input,originalAttempts[1].input);assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
    await first.getByRole('button',{name:'Mark used',exact:true}).click();await first.getByRole('button',{name:'Clear used marker',exact:true}).waitFor();assert.equal(x.core.codeHistory(x.alice).items.find(row=>row.id===aIds[0]).reportedUsed,true);assert.equal(x.core.codeHistory(x.bob).items[0].reportedUsed,false);
    await first.getByRole('button',{name:'Check provider status',exact:true}).click();await first.getByText('redeemed · You marked this used · example.game',{exact:true}).waitFor();assert.deepEqual(providerCalls,[aIds[0]]);assert.equal(x.core.codeHistory(x.bob).items[0].status,'allocated');
    await page.evaluate(()=>codeShell.revealedNode=document.querySelector('.dc-code-reveal[data-state="revealed"]'));
    const captured=new Promise(resolve=>capturedReveal=resolve);holdReveal=true;await rowFor(aIds[1]).getByRole('button',{name:'Reveal code',exact:true}).click();await captured;capturedReveal=undefined;
    await page.evaluate(()=>codeShell.pendingNode=document.querySelector('.dc-code-reveal[data-state="loading"]'));actor=x.bob;await page.evaluate(()=>codeShell.app.refresh());await page.waitForFunction(()=>document.querySelectorAll('.dc-code-history > article').length===1);assert.equal(await content.locator('.dc-code-value').textContent(),'Your code is kept private');assert(await page.evaluate(()=>codeShell.revealedNode.textContent===''&&codeShell.pendingNode.textContent===''));
    const switchedReply=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/codes/reveal');releaseReveal();releaseReveal=undefined;await switchedReply;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(!(await content.textContent()).includes('SECRET-REWARD'));assert(await page.evaluate(()=>codeShell.pendingNode.textContent===''));assert.deepEqual((await page.evaluate(()=>codeShell.client.codeHistory())).items.map(row=>row.id),[bId]);
    actor=x.alice;await page.evaluate(()=>codeShell.app.refresh());await articles.nth(2).waitFor();const refreshed=await page.evaluate(()=>codeShell.client.codeHistory()),disposeIndex=refreshed.items.findIndex(row=>row.id===aIds[2]),disposeRow=articles.nth(disposeIndex),disposeCaptured=new Promise(resolve=>capturedReveal=resolve);holdReveal=true;await disposeRow.getByRole('button',{name:'Reveal code',exact:true}).click();await disposeCaptured;capturedReveal=undefined;
    await page.evaluate(()=>{codeShell.disposedNode=document.querySelector('.dc-code-reveal[data-state="loading"]');codeShell.app.dispose();});assert.equal(await content.count(),0);const disposedReply=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/codes/reveal');releaseReveal();releaseReveal=undefined;await disposedReply;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await page.evaluate(()=>codeShell.disposedNode.textContent===''));assert(!(await page.locator('body').textContent()).includes('SECRET-REWARD'));
    assert(privateResponses.length>0);assert(privateResponses.every(response=>response.cache==='no-store'));const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!storage.includes('SECRET-REWARD'));assert(!JSON.stringify(manifest).includes('SECRET-REWARD'));
    cases.push({manifest:manifestPath,ownedCodes:3,foreignDenials:3,originalRevealAttempts:2,providerChecks:1,privateResponses:privateResponses.length,accountSwitch:true,disposedLateReply:true});await page.close();x.core.close();x=undefined;
  }
  assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify({engine,cases,errors},null,2)+'\n');console.log(JSON.stringify({engine,cases,errors},null,2));
}finally{releaseReveal?.();await browser?.close();x?.core.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
