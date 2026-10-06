import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './helpers.js';
import {createApiHandler} from '../src/http.js';
import {createClient} from '../src/client.js';
import {validateWireRequest,WireContractError} from '../src/wire-contracts.js';
import {validateAlbumArtwork,validateAlbumPageSize} from '../src/album-appearance.js';
const artwork={cover:{src:'/cover.png',alt:'雪 cover'},spine:{src:'https://assets.example/spine.png'},pages:[{id:'blank',title:'Blank page'},{id:'decorated',src:'./page.png',design:{contract:'digital-card@0.1',digest:'sha256:'+'a'.repeat(64),baseURL:'/design/'}}]};
test('checked HTTP album save and views retain precise artwork and layout extensions',async()=>{
  const x=fixture();let handler;const copy=x.open()[0],server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  handler=createApiHandler({framework:x.core,resolveIdentity:()=>x.alice,allowedOrigin:origin,requirePrincipal:true});const client=createClient({baseUrl:origin+'/api',fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
  try{await client.me();const layout={pageSize:9,artwork,customLayout:{spacing:2}},placements=[{copyId:copy.id,data:{pageId:'decorated',custom:true}}];const saved=await client.saveAlbum({key:'album-artwork',name:'Album',layout,placements});assert.deepEqual(saved.layout,layout);assert.deepEqual((await client.albums())[0],saved);const view=await client.viewAlbum(saved.id);assert.deepEqual(view.layout,layout);assert.equal(view.cards[0].placement.data.pageId,'decorated');assert.equal(view.cards[0].copy.id,copy.id);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));x.core.close();}
});
test('album artwork wire boundaries match runtime including unique IDs and UTF16 bounds',()=>{
  const save=layout=>validateWireRequest('saveAlbum',{key:'boundary',name:'Album',layout});
  for(const value of [{},artwork,{pages:[{id:'blank'}]},{cover:{src:'/cover.png',alt:'𝄞'.repeat(100)}}]){validateAlbumArtwork(value);assert.doesNotThrow(()=>save({artwork:value}));}
  for(const value of [{cover:{}},{extra:true},{cover:{src:'javascript:bad'}},{cover:{src:'bad path.png'}},{cover:{src:'/cover.png',alt:'𝄞'.repeat(101)}},{pages:[{id:'a',title:'𝄞'.repeat(51)}]},{pages:[{id:'same',title:'A'},{id:'same',title:'B'}]},{pages:[null]},{pages:[{id:'with space'}]},{pages:Array.from({length:101},(_,i)=>({id:'p'+i}))}]){assert.throws(()=>validateAlbumArtwork(value));assert.throws(()=>save({artwork:value}),error=>error instanceof WireContractError);}
  for(const pageSize of [1,100]){validateAlbumPageSize(pageSize);assert.doesNotThrow(()=>save({pageSize}));}for(const pageSize of [0,101,1.5,'9']){assert.throws(()=>validateAlbumPageSize(pageSize));assert.throws(()=>save({pageSize}),error=>error instanceof WireContractError);}
  for(const pageId of [null,'decorated'])assert.doesNotThrow(()=>validateWireRequest('saveAlbum',{key:'assignment',name:'Album',layout:{artwork},placements:[{copyId:'copy',data:{pageId,custom:true}}]}));
  assert.throws(()=>validateWireRequest('saveAlbum',{key:'assignment',name:'Album',layout:{pageSize:9},placements:[{copyId:'copy',data:{pageId:42}}]}),error=>error instanceof WireContractError);
  assert.doesNotThrow(()=>validateWireRequest('saveAlbum',{key:'legacy',name:'Album',layout:{custom:true},placements:[{copyId:'copy',data:{pageId:42,extension:{arbitrary:true}}}]}));
});
