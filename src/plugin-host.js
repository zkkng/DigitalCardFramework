import {createHash,randomBytes} from 'node:crypto';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {hasPermission} from './access.js';
import {pluginProtocol,pluginCommands,validatePluginMessage} from './plugin-contracts.js';
export {pluginProtocol,pluginCommands,pluginProtocolSchema,validatePluginMessage} from './plugin-contracts.js';

const fail=(code,message,status=403)=>{throw new FrameworkError(code,message,status);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const opaque=()=>randomBytes(32).toString('base64url');
const bounded=(value,max)=>Number.isSafeInteger(value)&&value>=1&&value<=max;
const credential=value=>typeof value==='string'&&value.length>=16&&value.length<=4096&&!/[\r\n]/.test(value);
const tokenHeader=(request,name)=>{const value=request.headers[name];return typeof value==='string'?value:null;};
const commandList=commands=>Array.isArray(commands)&&commands.length<=2&&new Set(commands).size===commands.length&&commands.every(command=>pluginCommands.includes(command));
function wireResult(value){
  let nodes=0;const seen=new WeakSet();
  const visit=(value,depth)=>{
    if(++nodes>100000||depth>32)fail('PLUGIN_CONTRACT','Plugin result exceeds structural bounds',502);
    if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return value;
    if(!value||typeof value!=='object'||seen.has(value)||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))fail('PLUGIN_CONTRACT','Framework returned non-JSON plugin data',502);
    seen.add(value);const result=Array.isArray(value)?value.map(child=>visit(child,depth+1)):Object.fromEntries(Object.entries(value).filter(([,child])=>child!==undefined).map(([key,child])=>[key,visit(child,depth+1)]));seen.delete(value);return result;
  };
  return visit(value,0);
}

/** Trusted operator service; JSON claims never create principals or grants. */
export function createPluginHost({framework,plugins,resolveActor,authorize=()=>true,clock=Date.now,
  timeoutMs=10000,sessionTTL=60000,delegationTTL=300000,maxSessions=256,maxDelegations=256,
  concurrency=4,totalConcurrency=16,maxRequestBytes=65536,maxResponseBytes=1048576}={}){
  if(!framework||typeof framework.inventoryPage!=='function'||typeof framework.operatorCatalog!=='function'||typeof resolveActor!=='function'||typeof authorize!=='function'||typeof clock!=='function')fail('PLUGIN_CONFIG','Framework and live authority adapters are required',400);
  for(const [value,maximum]of [[timeoutMs,300000],[sessionTTL,300000],[delegationTTL,300000],[maxSessions,10000],[maxDelegations,10000],[concurrency,32],[totalConcurrency,256],[maxRequestBytes,1048576],[maxResponseBytes,33554432]])if(!bounded(value,maximum))fail('PLUGIN_CONFIG','Invalid plugin resource limit',400);
  if(!Array.isArray(plugins)||plugins.length>100)fail('PLUGIN_CONFIG','At most 100 installed plugin services',400);
  const services=new Map(),credentials=new Map(),sessions=new Map(),delegations=new Map(),active=new Set();let total=0,requests=0,disposed=false;
  for(const configuration of plugins){
    const {id,version,token,commands,userIds}=configuration;
    validatePluginMessage('handshakeRequest',{protocol:pluginProtocol,pluginId:id,version});
    if(services.has(id)||!credential(token)||credentials.has(hash(token))||!commandList(commands)||!Array.isArray(userIds)||!userIds.length||userIds.length>1000||new Set(userIds).size!==userIds.length||!userIds.every(id=>typeof id==='string'&&id.length>=1&&id.length<=128))fail('PLUGIN_CONFIG','Invalid installed plugin grant',400);
    const service={id,version,commands:new Set(commands),userIds:new Set(userIds),tokenHash:hash(token),generation:1,enabled:true,active:0,requests:0};services.set(id,service);credentials.set(service.tokenHash,service);
  }
  const cleanup=()=>{const now=clock();for(const [key,value]of sessions)if(value.expires<=now)sessions.delete(key);for(const [key,value]of delegations)if(value.expires<=now)delegations.delete(key);};
  const serviceFor=request=>{if(disposed)fail('PLUGIN_DISABLED','Plugin host is unavailable');const authorization=tokenHeader(request,'authorization');if(!authorization?.startsWith('Bearer ')||!credential(authorization.slice(7)))fail('PLUGIN_AUTH','Plugin credential rejected');const service=credentials.get(hash(authorization.slice(7)));if(!service?.enabled)fail('PLUGIN_AUTH','Plugin credential rejected');return service;};
  const sessionFor=(service,token)=>{const session=sessions.get(hash(token));if(!session||session.service!==service||session.generation!==service.generation||session.expires<=clock()||!service.enabled)fail('PLUGIN_SESSION','Plugin session is invalid or expired');return session;};
  function invalidate(service){service.generation++;for(const [key,value]of sessions)if(value.service===service)sessions.delete(key);for(const [key,value]of delegations)if(value.service===service)delegations.delete(key);for(const work of active)if(work.service===service)work.controller.abort();}
  function issueDelegation({pluginId,actor,commands,ttlMs=delegationTTL}){
    cleanup();const service=services.get(pluginId);
    if(disposed||!service?.enabled||actor?.disabled===true||typeof actor?.userId!=='string'||!service.userIds.has(actor.userId)||!commandList(commands)||!commands.length||commands.some(command=>!service.commands.has(command)))fail('PLUGIN_GRANT','Delegation exceeds installed service authority');
    if(!bounded(ttlMs,delegationTTL)||delegations.size>=maxDelegations)fail('PLUGIN_CAPACITY','Delegation capacity or lifetime exceeded',507);
    const token=opaque();delegations.set(hash(token),{service,generation:service.generation,userId:actor.userId,commands:new Set(commands),expires:clock()+ttlMs});return token;
  }
  function revokeDelegation(token){const key=hash(token);delegations.delete(key);for(const work of active)if(work.delegationKey===key)work.controller.abort();}
  function disable(id){const service=services.get(id);if(!service)fail('PLUGIN_NOT_FOUND','Plugin is not installed',404);credentials.delete(service.tokenHash);service.enabled=false;invalidate(service);}
  function enable(id,{token,commands}={}){const service=services.get(id);if(!service||service.enabled||!credential(token)||hash(token)===service.tokenHash||credentials.has(hash(token))||(commands!==undefined&&!commandList(commands)))fail('PLUGIN_CONFIG','Reenable requires a new unique credential',400);if(commands!==undefined)service.commands=new Set(commands);invalidate(service);service.tokenHash=hash(token);service.enabled=true;credentials.set(service.tokenHash,service);}
  function setGrants(id,commands){const service=services.get(id);if(!service||!commandList(commands))fail('PLUGIN_CONFIG','Invalid service grants',400);service.commands=new Set(commands);invalidate(service);}
  function status(){cleanup();return [...services.values()].map(service=>({pluginId:service.id,version:service.version,enabled:service.enabled,generation:service.generation,commands:[...service.commands],active:service.active,sessions:[...sessions.values()].filter(value=>value.service===service).length}));}
  async function readBody(request){
    const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>maxRequestBytes))fail('PLUGIN_LIMIT','Plugin request exceeds body limit',413);
    const chunks=[];let bytes=0;const timer=setTimeout(()=>request.destroy(),timeoutMs);
    try{for await(const chunk of request){bytes+=chunk.byteLength;if(bytes>maxRequestBytes)fail('PLUGIN_LIMIT','Plugin request exceeds body limit',413);chunks.push(chunk);}if(!bytes)fail('PLUGIN_CONTRACT','JSON body required',400);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch(error){if(error instanceof FrameworkError)throw error;fail('PLUGIN_CONTRACT','Invalid plugin JSON body',400);}finally{clearTimeout(timer);}
  }
  async function command(service,request,response,input){
    const session=sessionFor(service,input.sessionId),delegationToken=tokenHeader(request,'x-dc-delegation');
    if(!delegationToken||!/^[-\w]{43}$/.test(delegationToken))fail('PLUGIN_GRANT','A host-issued delegation is required');
    const delegationKey=hash(delegationToken),delegation=delegations.get(delegationKey);
    const controller=new AbortController(),generation=service.generation,deadline=clock()+timeoutMs;
    const fence=()=>{if(disposed||controller.signal.aborted||clock()>=deadline)fail('PLUGIN_DEADLINE','Plugin command expired or cancelled',504);if(!service.enabled||service.generation!==generation||sessions.get(hash(input.sessionId))!==session||session.expires<=clock()||delegations.get(delegationKey)!==delegation||!delegation||delegation.expires<=clock()||delegation.generation!==generation||delegation.service!==service||!delegation.commands.has(input.command)||!service.commands.has(input.command)||!service.userIds.has(delegation.userId))fail('PLUGIN_GRANT','Plugin authority was revoked or expired');};
    fence();if(service.active>=concurrency||total>=totalConcurrency)fail('PLUGIN_BUSY','Plugin concurrency limit reached',429);
    const work={service,controller,delegationKey,session};active.add(work);service.active++;total++;
    const onClose=()=>{if(!response.writableEnded)controller.abort();};response.once('close',onClose);
    const live=async()=>{fence();const actor=await resolveActor(delegation.userId,{signal:controller.signal});fence();if(!actor||actor.disabled===true||actor.userId!==delegation.userId||(input.command==='catalog.read'&&!hasPermission(actor,'catalog.read')))fail('PLUGIN_ACTOR','Current actor authority rejected the command');if(await authorize({pluginId:service.id,command:input.command,actor,input:structuredClone(input.input),signal:controller.signal})!==true)fail('PLUGIN_POLICY','Current resource policy rejected the command');fence();return actor;};
    let timer;
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new FrameworkError('PLUGIN_DEADLINE','Plugin command deadline exceeded',504));},timeoutMs);});
    const task=Promise.resolve().then(async()=>{
      const actor=await live();fence();
      const result=await(input.command==='inventory.read'?framework.inventoryPage(actor,{limit:10,...input.input}):framework.operatorCatalog(actor));
      fence();await live();fence();
      const output={protocol:pluginProtocol,requestId:input.requestId,command:input.command,result:wireResult(result)};
      safeData(output,{maxBytes:maxResponseBytes,maxDepth:32,maxNodes:100000});validatePluginMessage('commandResponse',output);return output;
    }).finally(()=>{response.removeListener('close',onClose);active.delete(work);service.active--;total--;});
    try{const output=await Promise.race([task,expired]);fence();return {output,fence};}finally{clearTimeout(timer);}
  }
  async function handle(request,response){
    const path=(request.url??'').split('?')[0];if(!['/plugins/handshake','/plugins/commands','/plugins/sessions/close'].includes(path))return false;
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');let requestId,admitted;
    try{
      if(request.method!=='POST')fail('PLUGIN_METHOD','POST required',405);
      if(request.socket?.encrypted!==true&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket?.remoteAddress))fail('PLUGIN_TRANSPORT','HTTPS or loopback transport required');
      if(request.headers.cookie||request.headers.origin)fail('PLUGIN_AUTH','Browser ambient credentials are not accepted');
      if(!/^application\/json(?:\s*;|$)/i.test(tokenHeader(request,'content-type')??''))fail('PLUGIN_MEDIA','JSON content type required',415);
      const service=serviceFor(request);if(service.requests>=concurrency||requests>=totalConcurrency)fail('PLUGIN_BUSY','Plugin admission limit reached',429);service.requests++;requests++;admitted=service;
      const input=await readBody(request);if(serviceFor(request)!==service)fail('PLUGIN_AUTH','Plugin credential rejected');cleanup();let output,beforeSend;
      if(path==='/plugins/handshake'){
        validatePluginMessage('handshakeRequest',input);if(input.pluginId!==service.id)fail('PLUGIN_AUTH','Plugin identity does not match credential');if(input.version!==service.version)fail('PLUGIN_VERSION','Installed plugin version does not match',409);
        if(sessions.size>=maxSessions||[...sessions.values()].filter(value=>value.service===service).length>=4)fail('PLUGIN_CAPACITY','Plugin session capacity reached',507);
        const sessionId=opaque(),expires=clock()+sessionTTL;sessions.set(hash(sessionId),{service,generation:service.generation,expires});
        output={protocol:pluginProtocol,pluginId:service.id,version:service.version,sessionId,expiresAt:new Date(expires).toISOString(),generation:service.generation,commands:[...service.commands],quotas:{maxRequestBytes,maxResponseBytes,concurrency,timeoutMs}};validatePluginMessage('handshakeResponse',output);
      }else if(path==='/plugins/sessions/close'){
        validatePluginMessage('closeRequest',input);const session=sessionFor(service,input.sessionId);sessions.delete(hash(input.sessionId));for(const work of active)if(work.session===session)work.controller.abort();output={protocol:pluginProtocol,sessionId:input.sessionId,status:'closed'};
      }else{validatePluginMessage('commandRequest',input);requestId=input.requestId;const completed=await command(service,request,response,input);output=completed.output;beforeSend=completed.fence;}
      const encoded=JSON.stringify(output);beforeSend?.();
      if(!response.destroyed&&!response.writableEnded)response.end(encoded);
    }catch(error){
      const known=error instanceof FrameworkError,status=known&&Number.isInteger(error.status)?error.status:503;
      response.statusCode=status;response.setHeader('Connection','close');
      const output={protocol:pluginProtocol,...(requestId?{requestId}:{}),error:{code:known?String(error.code).slice(0,64):'PLUGIN_UNAVAILABLE',message:known?String(error.message).slice(0,256):'Plugin command unavailable',retryable:status===429||status>=500}};
      if(!response.destroyed&&!response.writableEnded)response.end(JSON.stringify(output));
    }finally{if(admitted){admitted.requests--;requests--;}}
    return true;
  }
  function dispose(){disposed=true;for(const service of services.values()){service.enabled=false;invalidate(service);}credentials.clear();sessions.clear();delegations.clear();}
  return {handle,issueDelegation,revokeDelegation,disable,enable,setGrants,status,dispose};
}
