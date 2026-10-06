import {check} from './catalog.js';

export const cloneResult = value => {
  if (value?.then) throw new Error('Async storage callbacks are unsupported');
  return structuredClone(value);
};
export function querySnapshot(queries,fn) {
  let active=true;
  const scoped=Object.fromEntries(Object.entries(queries).map(([name,method])=>[name,(...args)=>{if(!active)throw new Error('Query snapshot has ended');return method(...args);} ]));
  try{return cloneResult(fn(scoped));}finally{active=false;}
}

export function completionBytes(state) {
  let bytes = 0;
  for (const row of Object.values(state.externalPurchases ?? {})) {
    const amount = row.completionBytes ?? 0;
    check(Number.isSafeInteger(amount) && amount >= 0, 'INVALID_STATE', 'Invalid completion reservation', 500);
    bytes += amount;
    check(Number.isSafeInteger(bytes), 'INVALID_STATE', 'Completion reservations exceed the integer range', 500);
  }
  return bytes;
}

export function queryOptions(collection, input = {}) {
  const {limit = 50, after = '', sort = collection === 'externalPurchases' ? 'id' : 'newest', search = ''} = input;
  check(Number.isInteger(limit) && limit >= 1 && limit <= (collection === 'externalPurchases' ? 100 : 200), 'INVALID_INPUT', 'Invalid page limit');
  check(typeof after === 'string' && after.length <= 512, 'INVALID_INPUT', 'Invalid page cursor');
  check(typeof search === 'string' && search.length <= 100, 'INVALID_INPUT', 'Invalid page search');
  check(['id', 'name', 'newest', 'ordinal'].includes(sort), 'INVALID_INPUT', 'Unsupported sort');
  const filters = {};
  for (const name of ['ownerId', 'holderId', 'state', 'status', 'cardId', 'variantId', 'lineId', 'rarityId', 'poolId', 'providerId']) {
    if (input[name] !== undefined) {
      check(typeof input[name] === 'string' && input[name].length <= 2048, 'INVALID_INPUT', 'Invalid query filter');
      filters[name] = input[name];
    }
  }
  if (input.states !== undefined) {
    check(Array.isArray(input.states) && input.states.length >= 1 && input.states.length <= 20 && input.states.every(x => typeof x === 'string' && x.length <= 100), 'INVALID_INPUT', 'Invalid state filter');
    filters.states = [...new Set(input.states)];
  }
  return {collection, filters, limit, after, sort, search: search.toLowerCase()};
}

export function projection(collection, key, value) {
  // Only queried domain entities contribute plaintext operational indexes. Identity,
  // arbitrary extension records and private metadata remain inside their payloads.
  const row = ['copies','packs','codes','externalPurchases','notifications'].includes(collection) && value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const name = collection === 'copies' ? row.definition?.name ?? '' : '';
  return {
    key, ownerId: (collection==='notifications'?row.userId:row.ownerId) ?? null, holderId: row.holderId ?? null,
    state: row.state ?? null,
    status: collection === 'packs' ? (row.openedAt ? 'opened' : 'unopened') : row.status ?? row.state ?? null,
    cardId: row.cardId ?? null, variantId: row.variantId ?? row.variant?.id ?? null,
    lineId: row.definition?.lineId ?? row.lineId ?? null,
    rarityId: row.variant?.rarityId ?? row.rarityId ?? null,
    cardType: row.definition?.type ?? 'collectible',
    poolId: row.poolId ?? null, providerId: row.providerId ?? row.terms?.providerId ?? null,
    createdAt: row.createdAt ?? row.allocatedAt ?? row.importedAt ?? row.at ?? '',
    name: typeof name === 'string' ? name : '',
    search: [name, row.cardId, row.variantId, row.variant?.id, row.definition?.lineId, row.variant?.rarityId].filter(x => typeof x === 'string').join('\n').toLowerCase(),
  };
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function compareRows(a, b, sort) {
  return (sort === 'newest' ? compare(b.createdAt, a.createdAt) : sort === 'name' ? compare(a.name, b.name) : sort === 'ordinal' ? compare(a.ordinal,b.ordinal) : 0) || compare(a.key, b.key);
}
export function matches(row, options) {
  return Object.entries(options.filters).every(([field, value]) => field === 'states' ? value.includes(row.state ?? row.status) : row[field] === value)
    && (!options.search || row.search.includes(options.search));
}

/** Detached query view for the in-memory adapter. Persistent adapters implement the same selectors. */
export function memoryQueries(state) {
  const get = (field, id) => structuredClone(Object.hasOwn(state[field]??{},id)?state[field][id]:undefined);
  const page = (collection, input) => {
    const options = queryOptions(collection, input);
    const rows = Object.entries(state[collection] ?? {}).map(([key, value],ordinal) => ({value,ordinal,...projection(collection, key, value)})).filter(row => matches(row, options)).sort((a, b) => compareRows(a, b, options.sort));
    const idBoundary = collection === 'externalPurchases' && options.sort === 'id';
    let start = 0;
    if (options.after && idBoundary) {
      const boundaryIndex = rows.findIndex(row => row.key > options.after);
      start = boundaryIndex < 0 ? rows.length : boundaryIndex;
    } else if (options.after) start = rows.findIndex(row => row.key === options.after) + 1;
    check(!options.after || idBoundary || start > 0, 'INVALID_CURSOR', 'Cursor no longer exists; restart this view', 409);
    const selected = rows.slice(start, start + options.limit);
    return {items: structuredClone(selected.map(row => row.value)), total: rows.length, next: start + selected.length < rows.length ? selected.at(-1).key : null};
  };
  return {
    get,
    notifications:ownerId=>structuredClone((state.notifications??[]).filter(row=>row.userId===ownerId)),
    codeHistoryEntries(holderId) {
      check(typeof holderId==='string','INVALID_INPUT','Invalid holder identifier');
      return Object.values(state.codes??{}).filter(row=>row.holderId===holderId||(row.holderHistory??[]).includes(holderId)).flatMap(code=>{
        const copy=state.copies[code.copyId];
        return copy&&copy.state!=='sealed'?structuredClone([{code,copy}]):[];
      });
    },
    value: field => structuredClone(state[field]),
    records(field, {ids}) {
      check(Array.isArray(ids) && ids.length <= 2000 && ids.every(id => typeof id === 'string'), 'INVALID_INPUT', 'Invalid record identifiers');
      return Object.fromEntries([...new Set(ids)].filter(id => Object.hasOwn(state[field] ?? {}, id)).map(id => [id, get(field, id)]));
    },
    userByIdentity: (provider, subject) => structuredClone(Object.values(state.users).find(user => user.provider === provider && user.subject === subject)),
    providerIdentity(userId) { const user = state.users[userId]; return user ? {provider: user.provider, subject: user.subject} : undefined; },
    collectionCounts(ownerId) {
      const copies = Object.values(state.copies).filter(row => row.ownerId === ownerId), packs = Object.values(state.packs).filter(row => row.ownerId === ownerId);
      return {copies: copies.length, ownedCopies: copies.filter(row => row.state === 'owned').length, sealedCopies: copies.filter(row => row.state === 'sealed').length,
        packs: packs.length, unopenedPacks: packs.filter(row => !row.openedAt).length, codes: Object.values(state.codes ?? {}).filter(row => row.holderId === ownerId).length};
    },
    variantCounts({ownerId,after='',limit=50,excludeTypes=[]}={}) {
      queryOptions('copies',{ownerId,after,limit});
      check(Array.isArray(excludeTypes)&&excludeTypes.length<=20&&excludeTypes.every(x=>typeof x==='string'),'INVALID_INPUT','Invalid excluded card types');
      const groups=new Map();
      for(const row of Object.values(state.copies).filter(row=>row.ownerId===ownerId&&row.state==='owned'&&!excludeTypes.includes(row.definition?.type??'collectible'))){
        const current=groups.get(row.variantId);
        if(current){current.count++;if(compareRows(projection('copies',row.id,row),projection('copies',current.copyId,state.copies[current.copyId]),'newest')<0)current.copyId=row.id;}
        else groups.set(row.variantId,{variantId:row.variantId,count:1,copyId:row.id});
      }
      const rows=[...groups.values()].sort((a,b)=>compare(a.variantId,b.variantId)),start=after?rows.findIndex(row=>row.variantId===after)+1:0;
      check(!after||start>0,'INVALID_CURSOR','Cursor no longer exists; restart this view',409);
      const items=rows.slice(start,start+limit);return {items,totalCards:rows.reduce((n,row)=>n+row.count,0),uniqueCards:rows.length,total:rows.length,next:start+items.length<rows.length?items.at(-1).variantId:null};
    },
    pageCopies: input => page('copies', {state: 'owned', ...input}),
    pagePacks: input => page('packs', input),
    pageCodes: input => page('codes', input),
    pageExternalPurchases: input => page('externalPurchases', input),
  };
}
