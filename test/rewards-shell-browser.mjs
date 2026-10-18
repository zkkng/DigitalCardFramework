import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as pw from 'playwright';
import {fixture,admin} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
import {validateApplicationShell} from '../src/application-shell.js';

const engine=process.env.BROWSER_ENGINE??'webkit',output=resolve(process.argv[2]??'test-results/rewards-shell'),manifests=new Map(),cases=[],errors=[];
let browser,x,actor,api,origin,dropRetry=false,lostReplies=0,holdHistoryPath,releaseHistory,capturedHistory;
const server=createServer(async(request,response)=>{
  try{
    const path=new URL(request.url,'http://localhost').pathname;
    if(path==='/api/operator/actions/retry'&&dropRetry){dropRetry=false;response.end=()=>{
      lostReplies++;
      // Deliver response bytes before truncation so transport retries cannot hide the lost result.
      response.flushHeaders();response.write('{"id":',()=>response.destroy());return response;
    };}
    if(path===holdHistoryPath){holdHistoryPath=undefined;const end=response.end.bind(response);response.end=(...args)=>{releaseHistory=()=>end(...args);capturedHistory?.();return response;};}
    if(await api?.(request,response))return;
    if(manifests.has(path)){response.setHeader('content-type','application/json');response.end(JSON.stringify(manifests.get(path)));return;}
    if(path==='/rewards-shell'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reward history</title></head><body><main id="root"></main></body></html>');return;}
    if(await serveReference(request,response,{production:true}))return;response.writeHead(404).end();
  }catch{response.writeHead(500).end();}
});
async function mount(page,manifestPath){
  await page.evaluate(async manifestPath=>{const [{mountFramework},{createClient},{loadApplicationShell},{createLocalization,localizeDiagnostic}]=await Promise.all([import('/src/ui.js'),import('/src/client.js'),import('/src/application-shell.js'),import('/src/localization.js')]);const localization=createLocalization(),test=window.rewardShell={client:createClient(),retrySuccesses:0,describeFailure:error=>localizeDiagnostic(localization,error)},retry=test.client.retryAction.bind(test.client);test.client.retryAction=async input=>{try{const receipt=await retry(input);test.retrySuccesses++;return receipt;}catch(error){test.retryFailure=error;throw error;}};test.app=mountFramework(document.querySelector('#root'),{client:test.client,sections:['rewards'],navigation:'tabs',shell:loadApplicationShell(manifestPath)});await test.app.ready;await test.app.shellReady;},manifestPath);
}
function captureHistory(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Expected held reward-history response')),15000);capturedHistory=()=>{clearTimeout(timer);capturedHistory=undefined;resolve();};});}
try{
  for(const language of ['python','go'])for(const topology of ['rail','header']){
    const source=fileURLToPath(new URL('../examples/application-shell/generate.'+(language==='python'?'py':'go'),import.meta.url));
    const bytes=execFileSync(language==='python'?process.env.PYTHON??'python':process.env.GO??'go',language==='python'?[source,topology]:['run',source,topology],{windowsHide:true,timeout:60000,env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off'}});
    manifests.set('/shell/'+language+'-'+topology+'.json',validateApplicationShell(JSON.parse(bytes)));
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  try{browser=await pw[engine].launch({headless:true});}catch(error){if(engine!=='chromium'||process.platform!=='win32')throw error;browser=await pw.chromium.launch({headless:true,channel:'msedge'});}
  for(const [manifestPath,manifest]of manifests){
    let succeed=false;const deliveries=[],retryCalls=[],privateResponses=[];
    x=fixture({change(c){c.variants.find(row=>row.id==='dawn.standard').onOpen=[{id:'reward',handler:'example.reward',params:{sku:'synthetic-reward',private:'PRIVATE-REWARD-PARAM'}}];},actionOptions:{maxAttempts:1},actionHandlers:{'example.reward':async job=>{deliveries.push({id:job.idempotencyKey,userId:job.userId});if(!succeed)throw new Error('PRIVATE-REWARD-FAILURE');return {private:'PRIVATE-REWARD-RESULT'};}}});
    x.open('common',x.alice);x.open('common',x.bob);await x.core.dispatchActions(admin);
    const aJob=x.core.fulfillments(x.alice).items[0],bJob=x.core.fulfillments(x.bob).items[0];assert.equal(aJob.status,'dead');assert.equal(bJob.status,'dead');assert.equal(deliveries.length,2);
    const retry=x.core.retryAction.bind(x.core);x.core.retryAction=(principal,input)=>{const result=retry(principal,input);retryCalls.push({userId:principal.userId,input:structuredClone(input),result:structuredClone(result)});return result;};
    actor=x.alice;api=createApiHandler({framework:x.core,resolveIdentity:()=>actor,allowedOrigin:origin,requirePrincipal:true,exposeOperators:true});
    const page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{const path=new URL(response.url()).pathname;if(path==='/api/fulfillments'||path.startsWith('/api/operator/actions'))privateResponses.push({path,status:response.status(),cache:response.headers()['cache-control']});if(response.status()>=400&&path.startsWith('/src/'))errors.push('Module '+response.status()+' '+path);});
    await page.goto(origin+'/rewards-shell');await mount(page,manifestPath);
    const content=page.locator('#root [data-dc-region="content"]'),articles=content.locator('article'),history=content.getByLabel('Reward history',{exact:true}),row=id=>articles.filter({hasText:'Reference: '+id});
    await row(aJob.id).waitFor();assert.equal(await articles.count(),1);assert.equal(await row(bJob.id).count(),0);assert.equal(await history.locator('option').count(),1);assert.equal(await content.getByRole('button',{name:'Retry delivery',exact:true}).count(),0);
    assert.equal(await page.locator('#root [data-dc-region="navigation"] [data-view="rewards"]').count(),1);const own=await page.evaluate(()=>rewardShell.client.fulfillments());assert.deepEqual(own.items.map(job=>job.id),[aJob.id]);
    for(const operation of ['all','retry']){
      const response=await fetch(origin+'/api/operator/actions'+(operation==='retry'?'/retry':''),{method:operation==='retry'?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-DC-Principal':x.alice.userId},...(operation==='retry'?{body:JSON.stringify({key:'forged-retry',jobId:bJob.id,role:'admin',permissions:['actions.manage']})}:{})});assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
    }
    assert.equal(retryCalls.length,0);const operator={...x.alice,permissions:['actions.manage']};actor=operator;await page.evaluate(()=>rewardShell.app.refresh());await row(aJob.id).waitFor();await history.selectOption('all');await row(bJob.id).waitFor();assert.equal(await articles.count(),2);assert.equal(await content.getByRole('button',{name:'Retry delivery',exact:true}).count(),2);
    dropRetry=true;await row(aJob.id).getByRole('button',{name:'Retry delivery',exact:true}).click();await page.waitForFunction(()=>rewardShell.retryFailure&&document.querySelector('.dc-content [role="status"]')?.textContent===rewardShell.describeFailure(rewardShell.retryFailure));const failure=await page.evaluate(()=>({name:rewardShell.retryFailure.name,code:rewardShell.retryFailure.code,successes:rewardShell.retrySuccesses}));assert(failure.code==='INVALID_WIRE_CONTRACT'||!failure.code&&failure.name==='TypeError');assert.equal(failure.successes,0);await row(aJob.id).getByText('failed',{exact:true}).waitFor();assert.equal(retryCalls.length,1);const original=retryCalls[0];assert.equal(original.input.jobId,aJob.id);assert.equal(original.result.status,'pending');assert.equal(x.core.actionJobs(operator).items.find(job=>job.id===bJob.id).status,'dead');
    await content.getByRole('button',{name:'Refresh rewards',exact:true}).click();await row(aJob.id).getByText('pending',{exact:true}).waitFor();assert.equal(await row(aJob.id).getByRole('button',{name:'Retry delivery',exact:true}).count(),0);
    const replay=await page.evaluate(input=>rewardShell.client.retryAction(input),original.input);assert.deepEqual(replay,original.result);assert.equal(retryCalls.length,2);assert.deepEqual(retryCalls[1].input,original.input);
    succeed=true;await x.core.dispatchActions(admin);const after=x.core.actionJobs(operator).items;assert.equal(after.find(job=>job.id===aJob.id).status,'succeeded');assert.equal(after.find(job=>job.id===bJob.id).status,'dead');assert.equal(after.find(job=>job.id===aJob.id).history.filter(entry=>entry.type==='retry-requested').length,1);assert.deepEqual(deliveries.filter(delivery=>delivery.userId===x.alice.userId).map(delivery=>delivery.id),[aJob.id,aJob.id]);assert.deepEqual(deliveries.filter(delivery=>delivery.userId===x.bob.userId).map(delivery=>delivery.id),[bJob.id]);
    await page.reload();await mount(page,manifestPath);await row(aJob.id).getByText('succeeded',{exact:true}).waitFor();assert.equal(await articles.count(),1);await history.selectOption('all');await row(bJob.id).getByText('failed',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(input=>rewardShell.client.retryAction(input),original.input),original.result);assert.equal(x.core.actionJobs(operator).items.find(job=>job.id===aJob.id).history.filter(entry=>entry.type==='retry-requested').length,1);
    await page.evaluate(()=>rewardShell.oldNode=document.querySelector('.dc-content > section'));holdHistoryPath='/api/operator/actions';const switchCaptured=captureHistory();await content.getByRole('button',{name:'Refresh rewards',exact:true}).click();await switchCaptured;actor=x.bob;await page.evaluate(()=>rewardShell.app.refresh());await row(bJob.id).waitFor();assert.equal(await row(aJob.id).count(),0);assert.equal(await history.locator('option').count(),1);const switchResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operator/actions');releaseHistory();releaseHistory=undefined;await (await switchResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await row(aJob.id).count(),0);assert(await page.evaluate(()=>rewardShell.oldNode.textContent===''));
    await page.evaluate(()=>rewardShell.disposedNode=document.querySelector('.dc-content > section'));holdHistoryPath='/api/fulfillments';const disposeCaptured=captureHistory();await content.getByRole('button',{name:'Refresh rewards',exact:true}).click();await disposeCaptured;await page.evaluate(()=>rewardShell.app.dispose());const disposeResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fulfillments');releaseHistory();releaseHistory=undefined;await (await disposeResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await content.count(),0);assert(await page.evaluate(()=>rewardShell.disposedNode.textContent===''));
    assert(privateResponses.length>0);assert(privateResponses.every(response=>response.cache==='no-store'));const publicData=JSON.stringify({own,all:after,manifest,storage:await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}))});for(const secret of ['PRIVATE-REWARD-PARAM','PRIVATE-REWARD-FAILURE','PRIVATE-REWARD-RESULT'])assert(!publicData.includes(secret));
    cases.push({manifest:manifestPath,playerJobs:1,operatorJobs:2,deniedOperations:2,selectedRetryCount:1,stableDeliveryAttempts:2,otherAccountAttempts:1,originalReceiptReplay:true,reload:true,accountSwitch:true,disposedLateReply:true});await page.close();x.core.close();x=undefined;
  }
  assert.equal(lostReplies,4);assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify({engine,cases,lostReplies,errors},null,2)+'\n');console.log(JSON.stringify({engine,cases,lostReplies,errors},null,2));
}finally{releaseHistory?.();await browser?.close();x?.core.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
