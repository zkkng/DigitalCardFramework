import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRemoteActionHandler,validateActionAcknowledgment} from '@digital-card/framework/remote-actions';

const executable=process.argv[2];
if(!executable)throw Error('Usage: node test/action-receiver-conformance.mjs GO_RECEIVER|--python-only [PYTHON]');
const languages=executable==='--python-only'?['python']:['python','go'];
const python=process.argv[3]??process.env.PYTHON??(process.platform==='win32'?'python':'python3');
const token='public-action-conformance-credential';
const golden=JSON.parse(await readFile(new URL('./fixtures/action-delivery.json',import.meta.url),'utf8'));
const temporaryBase=resolve(tmpdir()),root=await mkdtemp(join(temporaryBase,'dc-action-conformance-'));
const processes=new Set();let assertions=0;
async function start(language,database,capacity=3){
  const command=language==='python'?python:executable;
  const args=language==='python'?[fileURLToPath(new URL('../examples/plugins/python-action-receiver.py',import.meta.url)),database]:[database];
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PLUGIN_TOKEN:token,PLUGIN_MAX_RECEIPTS:String(capacity),PYTHONDONTWRITEBYTECODE:'1'}});
  processes.add(child);let errors='';child.stderr.on('data',data=>{errors=(errors+data).slice(-4096);});
  const port=await new Promise((fulfill,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Receiver readiness timed out')),10000);let output='';
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Receiver exited before readiness: '+errors));});
    child.stdout.on('data',data=>{output+=data;if(output.length>4096){clearTimeout(timeout);reject(Error('Invalid receiver readiness'));}else if(output.includes('\n')){clearTimeout(timeout);fulfill(Number(output.split('\n')[0]));}});
  });
  assert(Number.isInteger(port)&&port>0);assertions++;
  return {child,url:'http://127.0.0.1:'+port+'/actions'};
}
async function stop(receiver){
  const child=receiver.child;
  if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}
  processes.delete(child);
}
async function post(receiver,value=golden,expected=200,options={}){
  const body=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value);
  const response=await fetch(receiver.url,{method:'POST',body,signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:'Bearer '+token,'idempotency-key':options.key??golden.jobId,...options.headers}});
  if(Array.isArray(expected))assert(expected.includes(response.status));else assert.equal(response.status,expected,'Receiver status for '+body.toString().slice(0,200));assertions++;
  const result=await response.json();
  if(response.status===200){validateActionAcknowledgment(result);assert.equal(result.jobId,options.key??golden.jobId);assertions++;}
  return {status:response.status,value:result};
}
function inspect(database,expected,digests=true){
  const result=spawnSync(python,['-c',"import sqlite3,sys,json,hashlib; db=sqlite3.connect(sys.argv[1]); rows=db.execute('SELECT digest,payload FROM deliveries').fetchall(); print(json.dumps({'count':len(rows),'integrity':db.execute('PRAGMA integrity_check').fetchone()[0],'digests':all(hashlib.sha256(p.encode()).hexdigest()==d for d,p in rows),'sqlite':sqlite3.sqlite_version}))",database],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0);const view=JSON.parse(result.stdout);assert.equal(view.count,expected);assert.equal(view.integrity,'ok');assert.equal(view.digests,digests);assertions+=4;return view;
}
function reordered(value){return Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,child])=>[key,reordered(child)])):value;}
try{
  for(const language of languages){
    const database=join(root,language+'.sqlite');let receiver=await start(language,database);
    await post(receiver);await post(receiver);
    const equivalent=JSON.stringify(reordered(golden)).replace('"fraction":1.25','"fraction":1.250').replace('"safeInteger":9007199254740991','"safeInteger":9007199254740991.0');
    await post(receiver,equivalent);
    await post(receiver,{...golden,params:{...golden.params,label:'Changed terms'}},409);
    await post(receiver,{...golden,params:{...golden.params,nested:[null,1,{'雪':'✓','𝄞':'♪'}]}},409);
    await post(receiver,golden,403,{headers:{authorization:'Bearer revoked-fixture-credential'}});
    await post(receiver,golden,400,{headers:{'idempotency-key':'forged-job'}});
    for(const patch of [{protocol:'digital-card-action@2'},{pluginId:'forged.receiver'},{handlerId:'other.handler'},{actor:{role:'admin'}},{beneficiaryId:12},{source:null},{params:[]}])await post(receiver,{...golden,...patch},400);
    for(const key of Object.keys(golden)){const value={...golden};delete value[key];await post(receiver,value,400);}
    await post(receiver,'{"pluginId":"example.receiver",'+JSON.stringify(golden).slice(1),400);
    await post(receiver,JSON.stringify(golden).replace('"fraction":1.25','"fraction":1e400'),400);
    await post(receiver,JSON.stringify(golden).replace('"fraction":1.25','"fraction":1e-1000000000'),400);
    await post(receiver,{...golden,params:{['__proto__']:{role:'admin'}}},400);
    await post(receiver,JSON.stringify(golden).replace('"fraction":1.25','"fraction":"\\ud800"'),400);
    await post(receiver,Buffer.from([0xff,0xfe,0x7b,0x7d]),400);
    let deep={};for(let i=0;i<17;i++)deep={child:deep};await post(receiver,{...golden,params:deep},400);
    await post(receiver,{...golden,params:{text:'x'.repeat(65536)}},413);
    await post(receiver,{...golden,jobId:'𝄞'.repeat(65)},400);
    const precision={...golden,jobId:'exact-numeric'},preciseBody=JSON.stringify(precision).replace('"safeInteger":9007199254740991','"safeInteger":9007199254740992');
    await post(receiver,preciseBody,200,{key:precision.jobId});
    await post(receiver,preciseBody.replace('9007199254740992','9007199254740993'),409,{key:precision.jobId});
    await post(receiver,{...golden,jobId:'no-beneficiary',beneficiaryId:null},200,{key:'no-beneficiary'});
    await Promise.all(Array.from({length:4},()=>post(receiver)));
    await post(receiver,{...golden,jobId:'capacity-refused'},507,{key:'capacity-refused'});
    inspect(database,3);await stop(receiver);
    receiver=await start(language,database,1);await post(receiver);await post(receiver,{...golden,jobId:'still-refused'},507,{key:'still-refused'});inspect(database,3);await stop(receiver);
  }
  const sharedDatabase=join(root,'interchange.sqlite');let receiver=await start('python',sharedDatabase);
  const job={idempotencyKey:golden.jobId,userId:golden.beneficiaryId,source:golden.source,params:golden.params};
  const options={url:receiver.url,pluginId:golden.pluginId,handlerId:golden.handlerId,token};
  await assert.rejects(createRemoteActionHandler({...options,fetchImpl:async(...args)=>{const response=await fetch(...args);assert.equal(response.status,200);await response.arrayBuffer();throw Error('Acknowledgment lost after receiver commit');}})(job),error=>error.code==='PLUGIN_UNAVAILABLE');assertions++;
  inspect(sharedDatabase,1);await stop(receiver);
  receiver=await start(languages.includes('go')?'go':'python',sharedDatabase,2);await post(receiver);inspect(sharedDatabase,1);
  const other=await start('python',sharedDatabase,2);
  await Promise.all([post(receiver),post(receiver),post(other),post(other)]);inspect(sharedDatabase,1);
  const competing=await Promise.all([post(receiver,{...golden,jobId:'race-one'},[200,507],{key:'race-one'}),post(other,{...golden,jobId:'race-two'},[200,507],{key:'race-two'})]);
  assert.deepEqual(competing.map(row=>row.status).sort(),[200,507]);assertions++;inspect(sharedDatabase,2);
  await stop(receiver);await stop(other);
  const corrupt=spawnSync(python,['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('UPDATE deliveries SET digest=? WHERE job_id=?', ('corrupt', 'golden-delivery')); db.commit(); db.close()",sharedDatabase],{windowsHide:true});assert.equal(corrupt.status,0);assertions++;
  for(const language of languages){const receiver=await start(language,sharedDatabase);await post(receiver,golden,503);inspect(sharedDatabase,2,false);await stop(receiver);}
  console.log(JSON.stringify({receivers:languages,assertions,scenarios:['golden Unicode/numbers','authenticated identity','malformed/unknown/duplicate fields','bounded JSON/UTF-8','numeric and boolean intent conflicts','concurrent duplicates and final receipt capacity','restart and reduced capacity','retained receipt digests and corruption refusal','committed acknowledgment loss',languages.includes('go')?'cross-language database replay':'same-language database replay'],status:'passed'},null,2));
}finally{
  for(const child of processes){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}
  if(!resolve(root).startsWith(temporaryBase+sep))throw Error('Unsafe conformance cleanup target');
  await rm(root,{recursive:true,force:true});
}
