import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,firefox,webkit} from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';
const engine=process.env.BROWSER_ENGINE??'chromium',browserType={chromium,firefox,webkit}[engine];
if(!browserType)throw new Error('Unsupported browser engine');
const x=fixture();let api,browser;
const server=createServer(async(req,res)=>{
 try{if(await api?.(req,res))return;if(req.url==='/harness'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><title>Command recovery</title><main id="root"></main></html>');return;}if(req.url.startsWith('/demo/')){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="navy"/></svg>');return;}if(await serveReference(req,res))return;res.writeHead(404);res.end();}catch{res.writeHead(500);res.end();}
});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 api=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});
 const intent=x.core.registerCommandIntent(x.alice,{command:'purchase',input:x.core.quote(x.alice,{productId:'common',quantity:1})});x.core.executeCommandIntent(x.alice,{id:intent.id});
 browser=await browserType.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});await page.goto(origin+'/harness');
 for(let mount=0;mount<2;mount++){
  await page.evaluate(async()=>{window.app?.dispose();sessionStorage.clear();const {createClient}=await import('/src/client.js'),{mountFramework}=await import('/src/ui.js');window.app=mountFramework(document.querySelector('#root'),{client:createClient(),sections:['packs']});await window.app.ready;});
  const recovery=page.getByRole('region',{name:'Unconfirmed changes'});await recovery.waitFor();await recovery.getByRole('button',{name:'Recover pack purchase',exact:true}).click();await recovery.waitFor({state:'detached'});await page.getByRole('status').filter({hasText:'Original result recovered.'}).waitFor();assert.equal(x.core.wallet(x.alice).credits,9990);assert.equal(x.core.packs(x.alice).length,1);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,engine,freshMounts:2,oneDebit:true,oneIssuance:true,referenceModulesLoaded:true}));
}finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});x.core.close();}
