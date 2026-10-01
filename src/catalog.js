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
  let encoded;
  try { encoded=JSON.stringify(value); } catch { throw new FrameworkError('INVALID_INPUT', name+' must be JSON'); }
  check(encoded.length<=32768, 'INVALID_INPUT', name+' is too large');
  return JSON.parse(encoded);
}
function index(items, label) {
  check(Array.isArray(items), 'INVALID_CATALOG', label+' must be an array');
  const map = Object.create(null);
  for (const item of items) {
    text(item.id,label+' id',100);
    check(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(item.id) && !['__proto__','constructor','prototype'].includes(item.id),'INVALID_CATALOG','Invalid identifier '+item.id);
    check(!map[item.id],'INVALID_CATALOG','Duplicate '+label+' id '+item.id);
    map[item.id]=item;
  }
  return map;
}
export function validateCatalog(input) {
  check(input && typeof input==='object' && !Array.isArray(input),'INVALID_CATALOG','Catalog must be an object');
  const c=JSON.parse(JSON.stringify(input));
  integer(c.version,'catalog version');
  const currencies=index(c.currencies,'currencies'), lines=index(c.lines,'lines');
  const rarities=index(c.rarities,'rarities'), cards=index(c.cards,'cards');
  const variants=index(c.variants,'variants'), products=index(c.products,'products');
  index(c.recipes??=[],'recipes');
  c.features={cardTrading:false,currencyTrading:false,conversion:false,tradeUps:false,publicAlbums:false,...c.features};
  for (const [key,value] of Object.entries(c.features)) check(['cardTrading','currencyTrading','conversion','tradeUps','publicAlbums'].includes(key) && typeof value==='boolean','INVALID_CATALOG','Invalid feature '+key);
  for (const x of c.currencies) {
    text(x.name,'currency name');
    integer(x.value?.numerator,'currency value numerator');
    integer(x.value?.denominator,'currency value denominator');
    check(x.convertible===undefined || typeof x.convertible==='boolean','INVALID_CATALOG','Invalid convertible flag');
    check(x.tradable===undefined || typeof x.tradable==='boolean','INVALID_CATALOG','Invalid tradable flag');
  }
  for (const x of c.lines) text(x.name,'line name');
  for (const x of c.rarities) {text(x.name,'rarity name'); integer(x.rank,'rarity rank',0);}
  for (const x of c.cards) {
    check(lines[x.lineId],'INVALID_CATALOG','Unknown card line');
    text(x.name,'card name');
    jsonObject(x.metadata??={});
    check(Array.isArray(x.layers??=[]),'INVALID_CATALOG','layers must be an array');
    for (const layer of x.layers) {
      if(layer.opacity!==undefined) check(Number.isFinite(layer.opacity) && layer.opacity>=0 && layer.opacity<=1,'INVALID_CATALOG','Layer opacity must be within [0,1]');
      text(layer.id,'layer id'); text(layer.src,'layer asset',2000);
      check(Number.isFinite(layer.depth??0) && Math.abs(layer.depth??0)<=100,'INVALID_CATALOG','Layer depth outside supported range');
    }
  }
  for (const x of c.variants) {
    check(cards[x.cardId] && rarities[x.rarityId],'INVALID_CATALOG','Unknown variant card or rarity');
    if (x.enabled!==undefined) check(typeof x.enabled==='boolean','INVALID_CATALOG','enabled must be boolean');
    if (x.supplyLimit!==undefined) integer(x.supplyLimit,'supply limit');
    jsonObject(x.metadata??={});
    for (const [name,b] of Object.entries(x.bindings??={})) {
      check(/^[a-z0-9-]+\.[a-z0-9._-]+$/i.test(name),'INVALID_CATALOG','Binding names must be namespaced');
      check(['public','owner'].includes(b.visibility),'INVALID_CATALOG','Binding visibility must be public or owner');
      check(['follow','retain','block'].includes(b.transfer),'INVALID_CATALOG','Binding transfer must be follow, retain or block');
      jsonObject(b.data??={});
    }
  }
  for (const x of c.products) {
    check(lines[x.lineId] && currencies[x.price?.currencyId],'INVALID_CATALOG','Unknown product line/currency');
    text(x.name,'pack name'); integer(x.revision,'product revision');
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
  return c;
}
