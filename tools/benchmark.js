import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,cpus,platform} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomBytes} from 'node:crypto';
import {CardFramework} from '../src/core.js';
import {SQLiteStore} from '../src/sqlite.js';
import {sampleCatalog} from '../examples/catalog.js';
// Reproducible, isolated benchmark. Never touches a collector database.
const dir=mkdtempSync(join(tmpdir(),'card-benchmark-')),store=new SQLiteStore(join(dir,'state.sqlite'),{encryptionKey:randomBytes(32)});
const core=new CardFramework({store,bindings:{'demo.code':()=>({code:'synthetic'})},limits:{users:500,copies:5000,packs:2000,requests:20000,albums:2000,trades:2000,copiesPerUser:1000,packsPerUser:500}}),admin={role:'admin'},metrics={};
function measure(name,fn){const start=performance.now(),result=fn();(metrics[name]??=[]).push(performance.now()-start);return result;}
try{const catalog=structuredClone(sampleCatalog);catalog.products.push({id:'benchmark',lineId:'sky',name:'Synthetic fifty-card pack',revision:1,price:{currencyId:'credits',amount:1},maxQuantity:20,slots:[{count:50,pool:[{variantId:'dawn.standard',weight:1}]}]});core.publishCatalog(admin,catalog);
  const actors=[];for(let u=0;u<5;u++){const user=core.registerUser(admin,{provider:'benchmark',subject:String(u),displayName:'Synthetic '+u}),actor={userId:user.id};actors.push(actor);core.grantCurrency(admin,{key:'fund',userId:user.id,currencyId:'credits',amount:10000,reason:'Synthetic benchmark'});const quote=core.quote(actor,{productId:'benchmark',quantity:20});const purchase=measure('purchase1000Copies',()=>core.purchase(actor,{...quote,key:'buy'}));for(const pack of purchase.packs)core.openPack(actor,{packId:pack.id,key:'open-'+pack.id});}
  for(let n=0;n<20;n++){measure('inventory1000Copies',()=>core.inventory(actors[n%5]));measure('tradeInventoryPage200',()=>core.tradeInventory(actors[0],actors[1].userId,{limit:200}));measure('preferencesWrite',()=>core.setPreferences(actors[0],{key:'preference-'+n,inventoryVisibility:n%2?'traders':'private'}));}
  core.setPreferences(actors[0],{key:'visible',inventoryVisibility:'traders'});const give=core.inventory(actors[0])[0].id,receive=core.inventory(actors[1])[0].id;
  for(let n=0;n<10;n++){const offer=measure('tradePropose',()=>core.proposeTrade(actors[0],{key:'offer-'+n,toUserId:actors[1].userId,give:{copyIds:[give],currencies:[]},receive:{copyIds:[receive],currencies:[]}}));measure('tradeCancel',()=>core.cancelTrade(actors[0],{key:'cancel-'+n,tradeId:offer.id}));}
  const audit=core.audit(admin);if(!audit.ok)throw new Error('Benchmark integrity audit failed');
  const summarize=values=>{const sorted=values.slice().sort((a,b)=>a-b);return {samples:sorted.length,p50Ms:+sorted[Math.floor((sorted.length-1)*.5)].toFixed(2),p95Ms:+sorted[Math.floor((sorted.length-1)*.95)].toFixed(2),maxMs:+sorted.at(-1).toFixed(2)};};
  console.log(JSON.stringify({at:new Date().toISOString(),node:process.version,platform:platform(),cpu:cpus()[0].model,profile:{users:5,copies:5000,copiesPerUser:1000,packs:100,encryption:'AES-256-GCM',stateBytes:store.read(s=>Buffer.byteLength(JSON.stringify(s)))},metrics:Object.fromEntries(Object.entries(metrics).map(([name,values])=>[name,summarize(values)])),audit:audit.ok},null,2));
}finally{core.close();rmSync(dir,{recursive:true,force:true});}
