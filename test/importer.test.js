import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContent,exportContent} from '../src/importer.js';
import {validateCatalog} from '../src/catalog.js';
import {fixture,admin,code} from './helpers.js';

test('JSON and YAML preserve nested stats, metadata, layers and scene relationships',()=>{
  const x=fixture(),manifest=x.core.operatorCatalog(admin);manifest.version++;
  manifest.cards[0].stats={attack:27,traits:['air','light'],nested:{level:2}};
  manifest.combinations=[{id:'dawn-cloud',name:'The horizon',rows:1,columns:2,pieces:[{cardId:'dawn',row:0,column:0},{cardId:'cloud',row:0,column:1}]}];
  for(const format of ['json','yaml']){const result=parseContent(exportContent(manifest,{format}),{format});assert.deepEqual(validateCatalog(result),validateCatalog(manifest));}
});
test('imports reject duplicate keys, alias expansion, tags, reserved keys and deep structures',()=>{
  assert.throws(()=>parseContent('{"cards":[],"cards":[]}'),code('INVALID_IMPORT'));
  assert.throws(()=>parseContent('cards: []\ncards: []',{format:'yaml'}),code('INVALID_IMPORT'));
  assert.throws(()=>parseContent('a: &x [1,2]\nb: *x',{format:'yaml'}),code('INVALID_IMPORT'));
  assert.throws(()=>parseContent('{"__proto__":{"evil":1}}'),code('INVALID_DATA'));
  let deep={};for(let i=0;i<30;i++)deep={next:deep};assert.throws(()=>parseContent(JSON.stringify(deep)),code('INVALID_DATA'));
  assert.throws(()=>parseContent('x: !!js/function "() => 1"',{format:'yaml'}));
});
test('bulk patch preview is atomic, preserves edition identity and detects changed or stale previews',()=>{
  const x=fixture(),original=x.open('unique')[0],base=x.core.operatorCatalog(admin),dawn=structuredClone(base.cards[0]);dawn.stats={attack:12};
  const preview=x.core.previewImport(admin,{source:{cards:[dawn]},mode:'merge',expectedVersion:base.version});
  assert(preview.changes.some(c=>c.id==='dawn'));assert.equal(x.core.catalog().version,base.version);
  const input={key:'import-1',manifest:preview.manifest,digest:preview.digest,expectedVersion:base.version};
  const changed=structuredClone(input);changed.manifest.cards[0].stats.attack=13;assert.throws(()=>x.core.commitImport(admin,changed),code('IMPORT_CHANGED'));
  const receipt=x.core.commitImport(admin,input);assert.deepEqual(x.core.commitImport(admin,input),receipt);
  assert.equal(x.core.catalog().cards[0].stats.attack,12);assert.deepEqual(x.core.inspectCard(x.alice,original.id).definition,original.definition);
  assert.throws(()=>x.core.commitImport(admin,{...input,key:'stale'}),code('STALE_IMPORT'));
  assert.throws(()=>x.core.previewImport(admin,{source:{variants:[{...base.variants.find(v=>v.supplyLimit===1),supplyLimit:2}]},expectedVersion:receipt.version}),code('CATALOG_CONFLICT'));
  assert.throws(()=>x.core.operatorCatalog(x.alice),code('FORBIDDEN'));
});
test('creator stat schemas and presentation bounds reject malformed content before publishing',()=>{
  const x=fixture(),manifest=x.core.operatorCatalog(admin);manifest.version++;manifest.metadataSchemas={stats:{type:'object',properties:{attack:{type:'integer',minimum:0,maximum:100}},additionalProperties:false}};
  manifest.cards.forEach(c=>c.stats={});manifest.cards[0].stats={attack:101};assert.throws(()=>validateCatalog(manifest),code('INVALID_CATALOG'));manifest.cards[0].stats={attack:42};validateCatalog(manifest);
  manifest.cards[0].layers[0].src='javascript:alert(1)';assert.throws(()=>validateCatalog(manifest),code('INVALID_CATALOG'));
  delete manifest.metadataSchemas;manifest.cards[0].layers=[];manifest.combinations=[{id:'bad',name:'Bad',columns:2,rows:1,pieces:[{cardId:'dawn',row:0,column:0},{cardId:'cloud',row:0,column:0}]}];assert.throws(()=>validateCatalog(manifest),code('INVALID_CATALOG'));
});
