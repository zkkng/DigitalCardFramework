import Ajv from 'ajv';
import {safeData} from './data.js';
const ajv=new Ajv({allErrors:true,strict:true,validateFormats:false});
export class FrameworkError extends Error {
  constructor(code, message, status = 400) { super(message); this.name='FrameworkError'; this.code=code; this.status=status; }
}
export function check(condition, code, message, status) {
  if (!condition) throw new FrameworkError(code, message, status);
}
export function integer(value, name, min=1, max=Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value>=min && value<=max, 'INVALID_INPUT', name+' must be an integer from '+min+' to '+max);
  return value;
}
export function text(value, name, max=200) {
  check(typeof value==='string' && value.trim().length>0 && value.length<=max, 'INVALID_INPUT', name+' must be a nonempty string');
  return value;
}
export function jsonObject(value, name='metadata') {
  check(value && typeof value==='object' && !Array.isArray(value), 'INVALID_INPUT', name+' must be an object');
  return safeData(value,{maxBytes:32768,maxNodes:10000,maxDepth:16});
}
function index(items, label) {
  check(Array.isArray(items)&&items.length<=20000, 'INVALID_CATALOG', label+' must be an array of at most 20000 entries');
  const map = Object.create(null);
  for (const item of items) {
    check(item&&typeof item==='object'&&!Array.isArray(item),'INVALID_CATALOG',label+' entries must be objects');
    text(item.id,label+' id',100);
    check(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(item.id) && !['__proto__','constructor','prototype'].includes(item.id),'INVALID_CATALOG','Invalid identifier '+item.id);
    check(!map[item.id],'INVALID_CATALOG','Duplicate '+label+' id '+item.id);
    map[item.id]=item;
  }
  return map;
}
export function assetReference(value,name='asset') {
  text(value,name,2000);check(!/[\u0000-\u0020\\]/.test(value),'INVALID_CATALOG','Invalid '+name+' reference');
  let url;try{url=new URL(value,'https://content.invalid/');}catch{throw new FrameworkError('INVALID_CATALOG','Invalid '+name+' URL');}
  check(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'INVALID_CATALOG',name+' must reference an HTTP(S) or relative asset');return value;
}
function validateSchema(schema,label) {
  safeData(schema,{maxBytes:16384,maxDepth:12,maxNodes:2000});
  const allowed=new Set(['type','properties','additionalProperties','required','items','enum','minimum','maximum','minLength','maxLength','minItems','maxItems','description','title']);
  function walk(x){check(x&&typeof x==='object'&&!Array.isArray(x),'INVALID_CATALOG','Invalid '+label+' schema');for(const key of Object.keys(x))check(allowed.has(key),'INVALID_CATALOG','Unsupported schema keyword '+key);if(x.properties)for(const sub of Object.values(x.properties))walk(sub);if(x.items)walk(x.items);if(x.additionalProperties&&typeof x.additionalProperties==='object')walk(x.additionalProperties);}
  walk(schema);try{return ajv.compile(schema);}catch(error){throw new FrameworkError('INVALID_CATALOG','Invalid '+label+' schema: '+error.message);}
}
export function validateCatalog(input) {
  check(input && typeof input==='object' && !Array.isArray(input),'INVALID_CATALOG','Catalog must be an object');
  const c=safeData(input);
  integer(c.version,'catalog version');
  const currencies=index(c.currencies,'currencies'), lines=index(c.lines,'lines');
  const rarities=index(c.rarities,'rarities'), cards=index(c.cards,'cards');
  const variants=index(c.variants,'variants'), products=index(c.products,'products');
  index(c.recipes??=[],'recipes');
  index(c.combinations??=[],'combinations');index(c.displayFields??=[],'display fields');
  c.features={cardTrading:false,currencyTrading:false,conversion:false,tradeUps:false,publicAlbums:false,inventoryBrowsing:true,...c.features};
  for (const [key,value] of Object.entries(c.features)) check(['cardTrading','currencyTrading','conversion','tradeUps','publicAlbums','inventoryBrowsing'].includes(key) && typeof value==='boolean','INVALID_CATALOG','Invalid feature '+key);
  const schemaValidators={};for(const [name,schema]of Object.entries(c.metadataSchemas??={})){check(['card','variant','stats'].includes(name),'INVALID_CATALOG','Unknown metadata schema target');schemaValidators[name]=validateSchema(schema,name);}
  const validateMetadata=(target,value,id)=>{const validate=schemaValidators[target];if(validate)check(validate(value),'INVALID_CATALOG',id+' '+target+': '+ajv.errorsText(validate.errors));};
  for (const x of c.currencies) {
    text(x.name,'currency name');
    integer(x.value?.numerator,'currency value numerator');
    integer(x.value?.denominator,'currency value denominator');
    check(x.convertible===undefined || typeof x.convertible==='boolean','INVALID_CATALOG','Invalid convertible flag');
    check(x.tradable===undefined || typeof x.tradable==='boolean','INVALID_CATALOG','Invalid tradable flag');
  }
  for (const x of c.lines) {text(x.name,'line name');if(x.description!==undefined)text(x.description,'line description',2000);}
  for (const x of c.rarities) {text(x.name,'rarity name'); integer(x.rank,'rarity rank',0);}
  for (const x of c.cards) {
    check(lines[x.lineId],'INVALID_CATALOG','Unknown card line');
    text(x.name,'card name');
    jsonObject(x.metadata??={});
    jsonObject(x.stats??={});validateMetadata('card',x.metadata,x.id);validateMetadata('stats',x.stats,x.id);
    check(Array.isArray(x.tags??=[])&&x.tags.length<=50&&x.tags.every(tag=>typeof tag==='string'&&tag.length<=80),'INVALID_CATALOG','Invalid card tags');
    if(x.description!==undefined)text(x.description,'card description',4000);
    if(x.back!==undefined)assetReference(x.back,'card back');
    if(x.appearance!==undefined)jsonObject(x.appearance,'appearance');
    check(Array.isArray(x.layers??=[])&&x.layers.length<=24,'INVALID_CATALOG','layers must have at most 24 entries');
    const layerIds=new Set();
    for (const layer of x.layers) {
      check(layer&&typeof layer==='object','INVALID_CATALOG','Invalid layer');
      if(layer.opacity!==undefined) check(Number.isFinite(layer.opacity) && layer.opacity>=0 && layer.opacity<=1,'INVALID_CATALOG','Layer opacity must be within [0,1]');
      text(layer.id,'layer id');assetReference(layer.src,'layer asset');check(!layerIds.has(layer.id),'INVALID_CATALOG','Duplicate layer ID');layerIds.add(layer.id);
      check(Number.isFinite(layer.depth??0) && Math.abs(layer.depth??0)<=100,'INVALID_CATALOG','Layer depth outside supported range');
      if(layer.blend!==undefined)check(['normal','screen','multiply','overlay'].includes(layer.blend),'INVALID_CATALOG','Invalid layer blend');
      if(layer.effect!==undefined)check(['emissive','none'].includes(layer.effect),'INVALID_CATALOG','Invalid layer effect');
      if(layer.crop!==undefined){const p=layer.crop;check(p&&['x','y','width','height'].every(key=>Number.isFinite(p[key]))&&p.x>=0&&p.y>=0&&p.width>0&&p.height>0&&p.x+p.width<=1&&p.y+p.height<=1,'INVALID_CATALOG','Layer crop must fit within normalized image coordinates');}
    }
  }
  for (const x of c.variants) {
    check(cards[x.cardId] && rarities[x.rarityId],'INVALID_CATALOG','Unknown variant card or rarity');
    if (x.enabled!==undefined) check(typeof x.enabled==='boolean','INVALID_CATALOG','enabled must be boolean');
    if (x.supplyLimit!==undefined) integer(x.supplyLimit,'supply limit');
    jsonObject(x.metadata??={});
    validateMetadata('variant',x.metadata,x.id);
    if(x.back!==undefined)assetReference(x.back,'variant back');if(x.effectMask!==undefined)assetReference(x.effectMask,'effect mask');
    if(x.finish!==undefined)check(['standard','gloss','holo','foil'].includes(x.finish),'INVALID_CATALOG','Invalid card finish');
    for (const [name,b] of Object.entries(x.bindings??={})) {
      check(/^[a-z0-9-]+\.[a-z0-9._-]+$/i.test(name),'INVALID_CATALOG','Binding names must be namespaced');
      check(['public','owner'].includes(b.visibility),'INVALID_CATALOG','Binding visibility must be public or owner');
      check(['follow','retain','block'].includes(b.transfer),'INVALID_CATALOG','Binding transfer must be follow, retain or block');
      jsonObject(b.data??={});
      if(b.factory!==undefined)text(b.factory,'binding factory',100);
    }
  }
  for (const x of c.products) {
    check(lines[x.lineId] && currencies[x.price?.currencyId],'INVALID_CATALOG','Unknown product line/currency');
    text(x.name,'pack name'); integer(x.revision,'product revision');
    if(x.enabled!==undefined)check(typeof x.enabled==='boolean','INVALID_CATALOG','Invalid product enabled flag');
    for(const key of ['availableFrom','availableUntil'])if(x[key]!==undefined)check(typeof x[key]==='string'&&Number.isFinite(Date.parse(x[key])),'INVALID_CATALOG','Invalid product availability time');
    if(x.availableFrom&&x.availableUntil)check(Date.parse(x.availableUntil)>Date.parse(x.availableFrom),'INVALID_CATALOG','Product availability must have positive duration');
    integer(x.price.amount,'price',1); integer(x.maxQuantity??=20,'max quantity',1,100);
    x.duplicatePolicy={scope:'none',fallback:'allow',...x.duplicatePolicy};
    check(['none','pack','inventory'].includes(x.duplicatePolicy.scope) && ['allow','reject'].includes(x.duplicatePolicy.fallback),'INVALID_CATALOG','Invalid duplicate policy');
    check(Array.isArray(x.slots) && x.slots.length>0,'INVALID_CATALOG','Pack slots required');
    let count=0;
    for (const slot of x.slots) {
      count+=integer(slot.count,'slot count',1,100);
      check(Array.isArray(slot.pool) && slot.pool.length>0,'INVALID_CATALOG','Pool required');
      const seen=new Set(); let total=0;
      for (const e of slot.pool) {
        const v=variants[e.variantId];
        check(v && cards[v.cardId].lineId===x.lineId,'INVALID_CATALOG','Pool variant outside line');
        check(!seen.has(e.variantId),'INVALID_CATALOG','Duplicate pool entry');
        seen.add(e.variantId); total+=integer(e.weight,'weight',1,2147483647);
      }
      integer(total,'weight sum',1,2147483647);
    }
    integer(count,'pack size',1,100);
    if(x.pity){integer(x.pity.after,'pity threshold',1,1000);check(rarities[x.pity.rarityId],'INVALID_CATALOG','Unknown pity rarity');check(x.slots[0].pool.some(e=>rarities[variants[e.variantId].rarityId].rank>=rarities[x.pity.rarityId].rank),'INVALID_CATALOG','First slot must contain an eligible pity outcome');}
  }
  for (const x of c.recipes) {
    text(x.name,'recipe name'); check(lines[x.lineId] && rarities[x.inputRarityId],'INVALID_CATALOG','Unknown recipe line/rarity');
    integer(x.inputCount,'trade-up count',2,100);
    check(typeof x.duplicatesOnly==='boolean','INVALID_CATALOG','duplicatesOnly must be explicit');
    check(Array.isArray(x.outputPool) && x.outputPool.length>0,'INVALID_CATALOG','Recipe output pool required');
    let total=0; const seen=new Set();
    for (const e of x.outputPool) {
      const v=variants[e.variantId];
      check(v && cards[v.cardId].lineId===x.lineId,'INVALID_CATALOG','Recipe output outside line');
      check(!seen.has(e.variantId),'INVALID_CATALOG','Duplicate recipe output'); seen.add(e.variantId);
      check(rarities[v.rarityId].rank>rarities[x.inputRarityId].rank,'INVALID_CATALOG','Trade-up output must have higher rank');
      total+=integer(e.weight,'weight',1,2147483647);
    }
    integer(total,'weight sum',1,2147483647);
  }
  for(const x of c.displayFields){text(x.label,'display field label');text(x.path,'display field path');check(/^(stats|metadata)\.[a-zA-Z0-9_.-]+$/.test(x.path),'INVALID_CATALOG','Display fields use stats.* or metadata.*');check(['number','text','json'].includes(x.type??='text'),'INVALID_CATALOG','Invalid display field type');}
  for(const x of c.combinations){text(x.name,'combination name');integer(x.columns,'combination columns',1,12);integer(x.rows,'combination rows',1,12);check(Array.isArray(x.pieces)&&x.pieces.length>=2&&x.pieces.length<=36,'INVALID_CATALOG','Combination needs 2 to 36 pieces');const positions=new Set(),pieces=new Set();for(const p of x.pieces){check(cards[p.cardId],'INVALID_CATALOG','Unknown combination card');integer(p.column,'piece column',0,x.columns-1);integer(p.row,'piece row',0,x.rows-1);const position=p.column+':'+p.row;check(!positions.has(position)&&!pieces.has(p.cardId),'INVALID_CATALOG','Duplicate combination piece/position');positions.add(position);pieces.add(p.cardId);}if(x.gap!==undefined)integer(x.gap,'combination gap',0,100);}
  return c;
}
