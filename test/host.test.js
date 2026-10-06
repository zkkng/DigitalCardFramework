import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {sampleCatalog} from '../examples/catalog.js';

test('actual production entrypoint initializes encrypted state, serves authenticated UI/API and excludes demo login',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-host-')),portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
  const extension=join(dir,'identity.mjs'),catalog=join(dir,'catalog.json'),database=join(dir,'state.sqlite');writeFileSync(catalog,JSON.stringify(sampleCatalog));
  // Trusted adapter fixture exercises host wiring. Maintained OIDC token verification has separate tests.
  writeFileSync(extension,`import {SQLiteStore} from ${JSON.stringify(pathToFileURL(resolve('src/sqlite.js')).href)};let observed;for(const name of ['read','query','transact','transactRecords']){const original=SQLiteStore.prototype[name];SQLiteStore.prototype[name]=function(...args){observed=this;return original.apply(this,args);};}export function handleStatic(req,res){if(req.url!=='/fixture/storage-diagnostics')return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(observed.diagnostics()));return true;}export const bindings={'demo.code':()=>({code:'SYNTHETIC'})}; export const identityProvider={begin:async()=>({url:'https://issuer.test/authorize',data:{challenge:'fixture'}}),finish:async(url,flow)=>{if(flow.challenge!=='fixture')throw new Error();return {issuer:'https://issuer.test',subject:'operator',displayName:'Fixture operator'};}};`);
  const child=spawn(process.execPath,[resolve('host/server.js')],{env:{...process.env,SITE_ORIGIN:'https://cards.test',OIDC_ISSUER:'https://issuer.test',OIDC_CLIENT_ID:'fixture',STATE_ENCRYPTION_KEY:randomBytes(32).toString('hex'),STATE_ENCRYPTION_KEY_FILE:'',OIDC_CLIENT_SECRET_FILE:'',CATALOG_FILE:catalog,DATABASE_PATH:database,HOST_MODULE:extension,OPERATOR_SUBJECTS:'["operator"]',PORT:String(port),BIND_ADDRESS:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  try{await new Promise((ready,reject)=>{const timeout=setTimeout(()=>reject(new Error('Host did not start: '+output)),10000);const onData=()=>{if(output.includes('production host ready')){clearTimeout(timeout);child.stdout.off('data',onData);ready();}};child.stdout.on('data',onData);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Host exited '+code+': '+output));});});
    const base='http://127.0.0.1:'+port,request=(path,options={})=>fetch(base+path,{...options,redirect:'manual'});
    const home=await request('/');assert.equal(home.status,200);assert.match(home.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal((await request('/healthz')).status,200);assert.equal((await request('/demo/session',{method:'POST'})).status,404);assert.equal((await request('/api/me')).status,401);
    const login=await request('/auth/login');assert.equal(login.status,303);const flow=login.headers.getSetCookie()[0];assert.match(flow,/Secure/);assert.match(flow,/HttpOnly/);const callback=await request('/auth/callback?state=fixture',{headers:{cookie:flow.split(';')[0]}});assert.equal(callback.status,303);const session=callback.headers.getSetCookie().find(c=>c.startsWith('__Host-dc_session=')).split(';')[0];
    const me=await (await request('/api/me',{headers:{cookie:session}})).json();assert.equal(me.role,'admin');assert.equal(me.displayName,'Fixture operator');
    const before=await (await request('/fixture/storage-diagnostics')).json();
    const write={method:'POST',headers:{cookie:session,origin:'https://cards.test','Content-Type':'application/json','X-DC-Principal':me.userId},body:JSON.stringify({key:'private',inventoryVisibility:'private'})};assert.equal((await request('/api/preferences',write)).status,200);
    const after=await (await request('/fixture/storage-diagnostics')).json();assert.equal(after.compatibilityMaterializations,before.compatibilityMaterializations);assert(after.decodedQueryRecords-before.decodedQueryRecords<20);assert.equal((await request('/api/operator/audit',{headers:{cookie:session}})).status,200);assert(!output.includes('SYNTHETIC'));
  }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});}
});
