import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {CardFramework} from '../src/core.js';
import {SQLiteStore} from '../src/sqlite.js';
import {fixture,admin} from './helpers.js';
import {serveReference,securityHeaders} from '../src/static.js';

test('installation quotas reject invalid configuration and roll back copy allocation, debit and receipt',()=>{
  for(const limits of [{copies:0},{users:1.5},{unknown:2},[]])assert.throws(()=>new CardFramework({limits}),e=>e.code==='INVALID_INPUT');
  const store=new SQLiteStore(':memory:'),seed=fixture({store}),core=new CardFramework({store,limits:{copies:1}}),quote=core.quote(seed.alice,{productId:'common',quantity:2}),before=store.read(s=>s);
  assert.throws(()=>core.purchase(seed.alice,{...quote,key:'over-capacity'}),e=>e.code==='INSTALLATION_CAPACITY');assert.deepEqual(store.read(s=>s),before);
  const result=core.purchase(seed.alice,{...core.quote(seed.alice,{productId:'common',quantity:1}),key:'under-capacity'});assert.equal(result.packs.length,1);core.close();
});

test('reviewed YAML CLI import, encryption migration and online backup retain verified state and preserve source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'card-ops-')),source=join(dir,'source.sqlite'),encrypted=join(dir,'encrypted.sqlite'),backup=join(dir,'backup.sqlite'),patch=join(dir,'patch.yaml'),key=randomBytes(32).toString('hex');
  try{const x=fixture({store:new SQLiteStore(source)});x.open('unique');const originalCard=x.c.cards.find(c=>c.id==='dawn');x.core.close();writeFileSync(patch,'cards:\n  - '+JSON.stringify({...originalCard,description:'Imported with reviewed YAML'})+'\n');
    const run=(tool,args,env={})=>execFileSync(process.execPath,[resolve('tools/'+tool),...args],{encoding:'utf8',env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    const args=['--database',source,'--file',patch],preview=JSON.parse(run('content.js',['preview',...args]));
    assert.throws(()=>run('content.js',['apply',...args,'--digest','wrong']));assert.equal(JSON.parse(run('content.js',['apply',...args,'--digest',preview.digest])).version,2);
    const original=new SQLiteStore(source),state=original.read(s=>s);original.close();run('migrate-encryption.js',[source,encrypted],{STATE_ENCRYPTION_KEY:key});
    assert(!readFileSync(encrypted).includes(Buffer.from('PRIVATE-DEMO-CODE')));run('backup.js',[encrypted,backup],{STATE_ENCRYPTION_KEY:key});
    const restored=new SQLiteStore(backup,{encryptionKey:Buffer.from(key,'hex')});const actual=restored.read(s=>s);assert.equal(actual.revision,state.revision+1);delete actual.revision;delete state.revision;assert.deepEqual(actual,state);restored.close();assert(readFileSync(source).includes(Buffer.from('PRIVATE-DEMO-CODE')));
    assert.throws(()=>run('migrate-encryption.js',[source,encrypted],{STATE_ENCRYPTION_KEY:key}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('production static allowlist serves every transitive browser module with restrictive headers',async()=>{
  const modules=['ui','client','styles','atelier-styles','trade-client','trading-ui','collection-ui','studio-ui','inspector-ui','player-ui','ui-kit'];
  for(const path of ['/', '/app.js','/site.css',...modules.map(name=>'/src/'+name+'.js')]){const headers={},res={setHeader:(key,value)=>headers[key]=value,end:value=>res.body=value};securityHeaders(res,{production:true});assert(await serveReference({url:path,method:'GET'},res,{production:true,assetOrigins:['https://assets.example.test']}));assert.match(headers['Content-Security-Policy'],/script-src 'self'/);assert.match(headers['Content-Security-Policy'],/img-src 'self' https:\/\/assets.example.test/);assert.equal(headers['X-Frame-Options'],'DENY');assert(res.body.length);}
  assert.equal(await serveReference({url:'/data/production.sqlite',method:'GET'},{}),false);assert.equal(await serveReference({url:'/src/core.js',method:'GET'},{}),false);
});
