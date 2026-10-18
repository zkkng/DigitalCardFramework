import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateEditorContribution} from '../src/presentation/editor-contributions.js';

const expected={protocol:'digital-card-editor-contribution@1',id:'example.print-layout',version:'1.0.0',title:'Layer position and rotation',controls:[
  {id:'position-x',label:'Horizontal position',field:'x',minimum:-1000,maximum:1000,step:1},
  {id:'position-y',label:'Vertical position',field:'y',minimum:-1000,maximum:1000,step:1},
  {id:'rotation',label:'Rotation',field:'rotation',minimum:-180,maximum:180,step:1},
]};
const python=process.env.PYTHON??'python',go=process.env.GO??'go';
const pythonSource=fileURLToPath(new URL('../examples/plugins/python-editor-panel.py',import.meta.url));
const goSource=fileURLToPath(new URL('../examples/plugins/go-editor-panel/main.go',import.meta.url));
function run(executable,args,environment={}){
  return new Promise((fulfill,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',...environment}});let stdout='',stderr='',settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value);};
    const timer=setTimeout(()=>{child.kill();finish(reject,Error('Panel generator process timed out'));},60000);
    const collect=(name,data)=>{if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>65536){child.kill();finish(reject,Error('Panel generator output exceeded its bound'));}};
    child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.once('error',error=>finish(reject,error));child.once('close',code=>{if(code!==0)finish(reject,Error('Panel generator process failed: '+stderr));else finish(fulfill,{stdout,stderr});});
  });
}
function check(result){
  assert.equal(result.stderr,'');assert(Buffer.byteLength(result.stdout)<=16384);assert(result.stdout.endsWith('\n'));const parsed=JSON.parse(result.stdout);assert.deepEqual(parsed,expected);
  const validated=validateEditorContribution(parsed);assert.deepEqual(validated,expected);assert.notEqual(validated,parsed);assert(Object.isFrozen(validated));assert(Object.isFrozen(validated.controls));assert(validated.controls.every(Object.isFrozen));
  parsed.controls[0].maximum=1;assert.equal(validated.controls[0].maximum,1000);return validated;
}

test('Python standard-library generator prints an installable detached panel manifest',async()=>{
  const first=await run(python,[pythonSource]),second=await run(python,[pythonSource]);check(first);check(second);assert.equal(first.stdout,second.stdout);
});

test('Go standard-library generator matches the Python panel without browser glue',async t=>{
  const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'editor-panel-example-'));t.after(async()=>{assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true,force:true});});const executable=join(directory,process.platform==='win32'?'editor-panel.exe':'editor-panel');
  const built=await run(go,['build','-trimpath','-o',executable,goSource],{GOCACHE:join(directory,'go-cache')});assert.deepEqual(built,{stdout:'',stderr:''});const output=await run(executable,[]),pythonOutput=await run(python,[pythonSource]);assert.deepEqual(check(output),check(pythonOutput));
});
