import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {sampleCatalog} from '../examples/catalog.js';

const executable=process.argv[2];
if(!executable)throw Error('Usage: node test/oidc-host.test.mjs GO_OIDC_PROVIDER');
const root=fileURLToPath(new URL('../',import.meta.url)),hostPath=join(root,'host','server.js');
const clientId='synthetic-oidc-client',clientSecret='synthetic-oidc-client-secret',subject='synthetic-collector';
async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const result=server.address().port;await new Promise(resolve=>server.close(resolve));return result;}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Fixture shutdown timed out'));},10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});}
function start(command,args,env,ready){
 const child=spawn(command,args,{cwd:root,windowsHide:true,env,stdio:['ignore','pipe','pipe']});let output='',errors='';
 const promise=new Promise((resolve,reject)=>{let settled=false;const done=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);},timer=setTimeout(()=>done(reject,Error('Fixture readiness timed out')),15000);
  child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>16384){child.kill();done(reject,Error('Fixture output exceeded its bound'));return;}try{const value=ready(output);if(value!==undefined)done(resolve,value);}catch(error){done(reject,error);}});
  child.stderr.on('data',data=>{errors=(errors+data).slice(-8192);});child.once('error',error=>done(reject,error));child.once('exit',()=>done(reject,Error('Fixture exited before readiness: '+errors)));
 });return {child,promise,output:()=>output,errors:()=>errors};
}
function issuerRequest(url,ca){return new Promise((resolve,reject)=>{const req=httpsRequest(url,{ca,method:'GET',timeout:5000},res=>{const parts=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>16384)res.destroy(Error('Issuer response exceeded its bound'));else parts.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString('utf8')}));});req.on('timeout',()=>req.destroy(Error('Issuer request timed out')));req.on('error',reject);req.end();});}
function cookies(response,name){const value=response.headers.getSetCookie().find(value=>value.startsWith(name+'='));assert(value,'Expected authentication cookie');return value;}
async function fixture(mode='valid'){
 const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'dc-oidc-host-')),httpPort=await port(),origin='https://127.0.0.1:'+httpPort;
 const certificate=join(directory,'issuer.crt'),privateKey=join(directory,'issuer.key'),config=join(directory,'issuer.json'),database=join(directory,'state.sqlite'),catalog=join(directory,'catalog.json'),secretFile=join(directory,'client-secret.txt'),key=randomBytes(32).toString('hex'),processes=[],hosts=[];
 try{
  const clean=structuredClone(sampleCatalog);for(const variant of clean.variants)for(const binding of Object.values(variant.bindings??{}))delete binding.factory;
  await writeFile(catalog,JSON.stringify(clean));await writeFile(secretFile,clientSecret,{mode:0o600});
  await writeFile(config,JSON.stringify({clientId,clientSecret,redirectUri:origin+'/auth/callback',subject,displayName:'Synthetic collector',mode,roleClaims:true}),{mode:0o600});
  const provider=start(executable,['--config',config,'--cert',certificate,'--key',privateKey,'--port','0'],process.env,text=>text.includes('\n')?JSON.parse(text.trim()):undefined);processes.push(provider.child);const ready=await provider.promise;
  assert.equal(ready.issuer,'https://127.0.0.1:'+ready.port);const ca=await readFile(certificate);let host;
  const launch=async()=>{host=start(process.execPath,[hostPath],{...process.env,SITE_ORIGIN:origin,OIDC_ISSUER:ready.issuer,OIDC_CLIENT_ID:clientId,OIDC_CLIENT_SECRET:'',OIDC_CLIENT_SECRET_FILE:secretFile,STATE_ENCRYPTION_KEY:key,STATE_ENCRYPTION_KEY_FILE:'',OPERATOR_SUBJECTS:'[]',HOST_MODULE:'',CATALOG_FILE:catalog,DATABASE_PATH:database,PORT:String(httpPort),BIND_ADDRESS:'127.0.0.1',CODE_VAULT_KEYS:'',CODE_VAULT_KEYS_FILE:'',CODE_INDEX_KEY:'',CODE_INDEX_KEY_FILE:'',NODE_EXTRA_CA_CERTS:certificate,NODE_TLS_REJECT_UNAUTHORIZED:'1'},text=>text.includes('Framework production host ready')?true:undefined);processes.push(host.child);hosts.push(host);await host.promise;};await launch();
  const request=(path,options={})=>fetch('http://127.0.0.1:'+httpPort+path,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});
  const begin=async()=>{const response=await request('/auth/login');assert.equal(response.status,303);assert.equal(response.headers.get('cache-control'),'no-store');const cookie=cookies(response,'__Host-dc_flow');for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert(cookie.includes(flag));const url=new URL(response.headers.get('location'));assert.equal(url.origin,ready.issuer);assert.equal(url.pathname,'/authorize');assert.equal(url.searchParams.get('client_id'),clientId);assert.equal(url.searchParams.get('redirect_uri'),origin+'/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(url.searchParams.get('nonce'));assert(url.searchParams.get('state'));return {url,cookie:cookie.split(';')[0]};};
  const authorize=async flow=>{const response=await issuerRequest(flow.url,ca);assert.equal(response.status,303,response.body);const url=new URL(response.headers.location);assert.equal(url.origin,origin);assert.equal(url.pathname,'/auth/callback');assert.equal(url.searchParams.get('state'),flow.url.searchParams.get('state'));assert(url.searchParams.get('code'));return url;};
  const callback=(url,flow)=>request(url.pathname+url.search,{headers:{cookie:flow.cookie}});
  return {directory,database,origin,issuer:ready.issuer,request,begin,authorize,callback,restart:async()=>{await stop(host.child);await launch();},logs:()=>hosts.map(host=>host.output()+host.errors()).join(''),close:async()=>{for(const child of processes.reverse())await stop(child);assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});}};
 }catch(error){for(const child of processes.reverse())await stop(child);assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});throw error;}
}
function registeredUsers(filename){const db=new DatabaseSync(filename,{readOnly:true});try{return db.prepare("SELECT COUNT(*) AS total FROM framework_entities WHERE collection='users'").get().total;}finally{db.close();}}
function authenticationRows(filename){const db=new DatabaseSync(filename,{readOnly:true});try{return db.prepare('SELECT kind,payload FROM auth_sessions').all();}finally{db.close();}}

test('Go OIDC through ordinary production configuration preserves encrypted flow, principal and session across restart',async()=>{
 const x=await fixture();try{
  assert.equal((await x.request('/api/me')).status,401);assert.equal((await x.request('/demo/session',{method:'POST'})).status,404);
  const flow=await x.begin(),url=await x.authorize(flow),rows=authenticationRows(x.database);assert.equal(rows.length,1);assert.equal(rows[0].kind,'flow');assert.equal(JSON.parse(rows[0].payload).encrypted,1);assert(!rows[0].payload.includes(flow.url.searchParams.get('nonce')));assert(!rows[0].payload.includes(flow.url.searchParams.get('state')));
  await x.restart();const response=await x.callback(url,flow);assert.equal(response.status,303);const raw=cookies(response,'__Host-dc_session');for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert(raw.includes(flag));const session=raw.split(';')[0];
  const me=await (await x.request('/api/me',{headers:{cookie:session}})).json();assert.equal(me.displayName,'Synthetic collector');assert.equal(me.role,'player');assert(!me.permissions.includes('codes.manage'));assert(!me.permissions.includes('commerce.manage'));assert.equal((await x.request('/api/operator/audit',{headers:{cookie:session}})).status,403);
  assert.equal((await x.callback(url,flow)).status,400);assert.equal((await x.request('/api/me',{headers:{cookie:session}})).status,200);
  const input={key:'oidc-preferences',inventoryVisibility:'private'},headers={cookie:session,origin:x.origin,'content-type':'application/json','x-dc-principal':me.userId};assert.equal((await x.request('/api/preferences',{method:'POST',headers:{...headers,origin:'https://foreign.example'},body:JSON.stringify(input)})).status,403);assert.equal((await x.request('/api/preferences',{method:'POST',headers:{...headers,'x-dc-principal':'other-user'},body:JSON.stringify(input)})).status,409);assert.equal((await x.request('/api/preferences',{method:'POST',headers,body:JSON.stringify(input)})).status,200);
  await x.restart();const resumed=await (await x.request('/api/me',{headers:{cookie:session}})).json();assert.equal(resumed.userId,me.userId);assert.equal(resumed.preferences.inventoryVisibility,'private');assert(authenticationRows(x.database).every(row=>row.kind==='session'&&JSON.parse(row.payload).encrypted===1));
  assert.equal((await x.request('/auth/logout',{method:'POST',headers:{cookie:session,origin:'https://foreign.example'}})).status,403);assert.equal((await x.request('/api/me',{headers:{cookie:session}})).status,200);assert.equal((await x.request('/auth/logout',{method:'POST',headers:{cookie:session,origin:x.origin}})).status,204);assert.equal((await x.request('/api/me',{headers:{cookie:session}})).status,401);
  const second=await x.begin(),signed=await x.callback(await x.authorize(second),second);assert.equal(signed.status,303);const again=await (await x.request('/api/me',{headers:{cookie:cookies(signed,'__Host-dc_session').split(';')[0]}})).json();assert.equal(again.userId,me.userId);assert.equal(registeredUsers(x.database),1);assert(!x.logs().includes(clientSecret));assert(!x.logs().includes(flow.url.searchParams.get('nonce')));
 }finally{await x.close();}
});

test('Go authorization and identity-claim failures cannot create a production session',async()=>{
 for(const mode of ['wrong-issuer','wrong-audience','wrong-nonce','missing-sub','malformed-claims','expired']){const x=await fixture(mode);try{const flow=await x.begin(),url=await x.authorize(flow),response=await x.callback(url,flow);assert.equal(response.status,400,mode);assert.equal(await response.text(),'Sign-in failed. Return to the application and try again.');assert(!response.headers.getSetCookie().some(value=>value.startsWith('__Host-dc_session=')));assert.equal((await x.request('/api/me')).status,401);assert.equal(authenticationRows(x.database).length,0);assert.equal(registeredUsers(x.database),0);assert.equal((await x.callback(url,flow)).status,400);}finally{await x.close();}}
 const x=await fixture();try{for(const mode of ['state','pkce']){const flow=await x.begin();if(mode==='pkce')flow.url.searchParams.set('code_challenge','A'.repeat(43));const url=await x.authorize(flow);if(mode==='state')url.searchParams.set('state','wrong-state');assert.equal((await x.callback(url,flow)).status,400,mode);assert.equal(authenticationRows(x.database).length,0);assert.equal(registeredUsers(x.database),0);assert.equal((await x.callback(url,flow)).status,400);assert.equal((await x.request('/api/me')).status,401);}}finally{await x.close();}
});
