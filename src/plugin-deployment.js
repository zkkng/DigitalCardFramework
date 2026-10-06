import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {createPluginHost,pluginProtocol,pluginCommands} from './plugin-host.js';

const reject=(message,status=400)=>{throw new FrameworkError('PLUGIN_DEPLOYMENT',message,status);};
const credentialDigest=value=>typeof value==='string'?createHash('sha256').update(value).digest('hex'):null;
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'},version={type:'string',pattern:'^[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}$'};
export const pluginManifestSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  ...object({contract:{const:'digital-card-plugin-manifest@1'},id,version,protocol:{const:pluginProtocol},
    commands:{type:'array',maxItems:pluginCommands.length,uniqueItems:true,items:{enum:pluginCommands}},
    dependencies:{type:'array',maxItems:32,items:object({id,version})},
    configurationSchema:{type:'object'},
    runtime:object({kind:{const:'external-http'},language:{type:'string',minLength:1,maxLength:40},prerequisites:{type:'array',maxItems:16,items:{type:'string',minLength:1,maxLength:200}},migration:{enum:['none','operator-required']}}),
  }),
};
const ajv=new Ajv2020({strict:false,allErrors:false,validateFormats:false});
const manifestValidator=ajv.compile(pluginManifestSchema);
const configurationKeywords=new Set(['type','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','enum','const','description','title']);
function configurationSchema(value){
  if(typeof value==='boolean')return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!configurationKeywords.has(key)))reject('Unsupported configuration schema keyword');
  for(const child of Object.values(value.properties??{}))configurationSchema(child);
  if(value.items!==undefined)configurationSchema(value.items);
  if(typeof value.additionalProperties==='object')configurationSchema(value.additionalProperties);
}
export function validatePluginManifest(input){
  const value=safeData(input,{maxBytes:65536,maxDepth:24,maxNodes:10000});
  if(!manifestValidator(value))reject('Invalid plugin manifest');
  if(value.configurationSchema.type!=='object')reject('Configuration schema root must be an object');
  configurationSchema(value.configurationSchema);
  if(!ajv.validateSchema(value.configurationSchema))reject('Invalid configuration schema');
  if(new Set(value.dependencies.map(dependency=>dependency.id)).size!==value.dependencies.length||value.dependencies.some(dependency=>dependency.id===value.id))reject('Invalid plugin dependencies');
  return value;
}
function dependencyReadiness(definitions,statuses){
  const memo=new Map();
  const ready=id=>{if(memo.has(id))return memo.get(id);const result=definitions.get(id).dependencies.every(dependency=>{const status=statuses.get(dependency.id);return status?.enabled&&status.sessions>0&&ready(dependency.id);});memo.set(id,Boolean(result));return Boolean(result);};
  for(const id of definitions.keys())ready(id);
  return memo;
}

/** Trusted operator deployment; no executable installation or durable ledger ownership. */
export function createPluginDeployment({manifests,installations,...hostOptions}={}){
  let current,disposed=false;const credentialHistory=new Set();
  function prepare(manifests,installations){
    if(!Array.isArray(manifests)||manifests.length>100||!Array.isArray(installations)||installations.length!==manifests.length)reject('Bounded matching manifests and installations are required');
    if(credentialHistory.size+installations.length>4096)reject('Retained credential history capacity reached',507);
    const reviewed=manifests.map(validatePluginManifest),definitions=new Map(reviewed.map(manifest=>[manifest.id,manifest]));
    if(definitions.size!==reviewed.length)reject('Duplicate manifest identity');
    const installs=new Map(),plugins=[];
    for(const input of installations){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','token','commands','userIds','configuration'].includes(key)))reject('Invalid installation');
      const manifest=definitions.get(input.id);if(!manifest||installs.has(input.id))reject('Installation does not match a unique manifest');
      const configuration=safeData(input.configuration===undefined?{}:input.configuration,{maxBytes:65536,maxDepth:24,maxNodes:10000});
      if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))reject('Installation configuration must be an object');
      if(!new Ajv2020({strict:false,validateFormats:false}).compile(manifest.configurationSchema)(configuration))reject('Installation configuration does not match manifest');
      if(!Array.isArray(input.commands)||input.commands.some(command=>!manifest.commands.includes(command)))reject('Installed grants exceed declared capabilities');
      if(credentialHistory.has(credentialDigest(input.token)))reject('Replacement requires fresh service credentials');
      installs.set(input.id,{commands:[...input.commands],configuration});plugins.push({id:input.id,version:manifest.version,token:input.token,commands:input.commands,userIds:input.userIds});
    }
    const ordered=[],visiting=new Set(),visited=new Set();
    function visit(id){if(visited.has(id))return;if(visiting.has(id))reject('Plugin dependency cycle');visiting.add(id);const manifest=definitions.get(id);for(const dependency of manifest.dependencies){const found=definitions.get(dependency.id);if(!found||found.version!==dependency.version)reject('Missing or incompatible plugin dependency');visit(dependency.id);}visiting.delete(id);visited.add(id);ordered.push(id);}
    for(const id of definitions.keys())visit(id);
    const state={definitions,installs,ordered,draining:new Set(),host:null};
    state.host=createPluginHost({...hostOptions,plugins,authorize:async context=>{
      if(state.draining.has(context.pluginId)&&context.command==='purchase.register')return false;
      const statuses=new Map(state.host.status().map(status=>[status.pluginId,status]));
      if(!dependencyReadiness(definitions,statuses).get(context.pluginId))return false;
      return hostOptions.authorize?await hostOptions.authorize({...context,configuration:structuredClone(installs.get(context.pluginId).configuration)}):true;
    }});
    return state;
  }
  current=prepare(manifests,installations);for(const install of installations)credentialHistory.add(credentialDigest(install.token));
  const alive=()=>{if(disposed)reject('Plugin deployment is disposed',503);};
  function closure(id){if(!current.definitions.has(id))reject('Plugin is not installed',404);const selected=new Set([id]);let changed=true;while(changed){changed=false;for(const manifest of current.definitions.values())if(!selected.has(manifest.id)&&manifest.dependencies.some(dependency=>selected.has(dependency.id))){selected.add(manifest.id);changed=true;}}return [...selected];}
  function drain(id){alive();for(const selected of closure(id))current.draining.add(selected);}
  function disable(id){alive();for(const selected of closure(id).reverse())current.host.disable(selected);}
  function enable(id,{token,commands}={}){alive();const manifest=current.definitions.get(id),install=current.installs.get(id);if(!manifest||!install)reject('Plugin is not installed',404);const grants=commands??install.commands;if(!Array.isArray(grants)||grants.some(command=>!manifest.commands.includes(command)))reject('Installed grants exceed declared capabilities');if(credentialHistory.size>=4096)reject('Retained credential history capacity reached',507);if(credentialHistory.has(credentialDigest(token)))reject('Enable requires fresh service credentials');current.host.enable(id,{token,commands:grants});credentialHistory.add(credentialDigest(token));install.commands=[...grants];}
  function replace({manifests,installations,migrationApproved=[]}){
    alive();if(current.draining.size!==current.definitions.size||current.host.status().some(status=>status.active>0))reject('Drain every service and wait for active callbacks before replacement',409);
    if(!Array.isArray(migrationApproved)||migrationApproved.length>100||migrationApproved.some(id=>typeof id!=='string'))reject('Invalid migration approvals');
    const candidate=prepare(manifests,installations);
    for(const manifest of candidate.definitions.values())if(current.definitions.get(manifest.id)?.version!==manifest.version&&manifest.runtime.migration==='operator-required'&&!migrationApproved.includes(manifest.id)){candidate.host.dispose();reject('Operator migration approval is required',409);}
    current.host.dispose();current=candidate;for(const install of installations)credentialHistory.add(credentialDigest(install.token));
  }
  function status(){const statuses=new Map(current.host.status().map(service=>[service.pluginId,service])),readiness=dependencyReadiness(current.definitions,statuses);return [...statuses.values()].map(service=>({...service,draining:current.draining.has(service.pluginId),dependenciesReady:readiness.get(service.pluginId),configurationValid:true}));}
  return {handle:(request,response)=>current.host.handle(request,response),issueDelegation:input=>{alive();return current.host.issueDelegation(input);},revokeDelegation:token=>current.host.revokeDelegation(token),drain,disable,enable,replace,status,dispose(){if(!disposed){disposed=true;current.host.dispose();}}};
}
