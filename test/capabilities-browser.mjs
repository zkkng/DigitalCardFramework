import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,firefox,webkit} from 'playwright';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {serveReference} from '../src/static.js';

const engine=process.env.BROWSER_ENGINE??'chromium',browserType={chromium,firefox,webkit}[engine];
if(!browserType)throw new Error('Unsupported browser engine');
const x=fixture({change:catalog=>{delete catalog.capabilities;catalog.features={};}});
let api,browser;
const server=createServer(async(request,response)=>{
  try{
    if(await api?.(request,response))return;
    if(request.url==='/harness'){
      response.setHeader('content-type','text/html');
      response.end('<!doctype html><html lang="en"><title>Collection capabilities</title><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main></html>');
      return;
    }
    if(await serveReference(request,response))return;
    response.writeHead(404);response.end();
  }catch{response.writeHead(500);response.end();}
});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  api=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});
  browser=await browserType.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  for(const width of [1360,380]){
    const page=await browser.newPage({viewport:{width,height:850}}),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))requests.push(path);});
    page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
    await page.goto(origin+'/harness');
    await page.evaluate(async()=>{
      const {createClient}=await import('/src/client.js'),{mountFramework}=await import('/src/ui.js');
      window.app=mountFramework(document.querySelector('#root'),{client:createClient(),navigation:'tabs'});
      await window.app.ready;
    });
    assert.deepEqual(await page.locator('[data-view]').evaluateAll(nodes=>nodes.map(node=>node.dataset.view)),['collection']);
    assert.deepEqual([...new Set(requests)].sort(),['/api/capabilities','/api/catalog','/api/command-intents','/api/inventory','/api/me']);
    assert.doesNotMatch(await page.locator('#root').innerText(),/sealed packs|Trade lounge|Marketplace|Account rewards/);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.app.dispose());await page.close();
  }
  console.log(JSON.stringify({ok:true,engine,viewports:2,collectionOnlyNetwork:true}));
}finally{
  await browser?.close();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  x.core.close();
}
