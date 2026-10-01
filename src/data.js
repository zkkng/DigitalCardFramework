import {check,FrameworkError} from './catalog.js';

/** Reject executable/non-JSON data, dangerous keys and pathological nesting before cloning. */
export function safeData(value,{maxDepth=24,maxNodes=1000000,maxBytes=8*1024*1024}={}) {
  let nodes=0;const seen=new WeakSet();
  function visit(x,depth){
    check(++nodes<=maxNodes&&depth<=maxDepth,'INVALID_DATA','Data structure exceeds supported bounds');
    if(x===null||typeof x==='string'||typeof x==='boolean')return;
    if(typeof x==='number'){check(Number.isFinite(x),'INVALID_DATA','Numbers must be finite');return;}
    check(x&&typeof x==='object','INVALID_DATA','Only JSON-compatible values are supported');
    check(!seen.has(x),'INVALID_DATA','Cycles and aliased objects are unsupported');seen.add(x);
    check(Array.isArray(x)||Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null,'INVALID_DATA','Only plain objects are supported');
    for(const [key,item]of Object.entries(x)){
      check(!['__proto__','prototype','constructor'].includes(key),'INVALID_DATA','Reserved data key: '+key);
      visit(item,depth+1);
    }
    seen.delete(x);
  }
  visit(value,0);const encoded=JSON.stringify(value);
  check(Buffer.byteLength(encoded)<=maxBytes,'PAYLOAD_TOO_LARGE','Data exceeds supported size',413);
  return JSON.parse(encoded);
}

export function page(items,{limit=50,after='',search='',sort='newest'}={}) {
  check(Number.isInteger(limit)&&limit>=1&&limit<=200,'INVALID_INPUT','Page limit must be 1 to 200');
  check(typeof search==='string'&&search.length<=100,'INVALID_INPUT','Search is too long');
  const query=search.toLowerCase();let rows=items.filter(x=>!query||JSON.stringify(x).toLowerCase().includes(query));
  if(sort==='name')rows.sort((a,b)=>(a.definition?.name??a.name??'').localeCompare(b.definition?.name??b.name??'')||a.id.localeCompare(b.id));
  else if(sort==='newest')rows.sort((a,b)=>(b.createdAt??b.at??'').localeCompare(a.createdAt??a.at??'')||a.id.localeCompare(b.id));
  else throw new FrameworkError('INVALID_INPUT','Unsupported sort');
  const total=rows.length,start=after?rows.findIndex(x=>x.id===after)+1:0;
  check(!after||start>0,'INVALID_CURSOR','Cursor no longer exists; restart this view',409);
  const itemsOnPage=rows.slice(start,start+limit);
  return {items:itemsOnPage,total,next:start+limit<total?itemsOnPage.at(-1)?.id??null:null};
}
