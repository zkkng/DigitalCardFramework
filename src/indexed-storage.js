import {ownedCardIds,importedCodeBounds} from './storage-query.js';
import {check} from './catalog.js';
import {projection, queryOptions} from './storage-query.js';

export const STORAGE_SCHEMA = 8;
export const schemaSqlV2 = `
CREATE TABLE framework_meta(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,codec_check TEXT NOT NULL) STRICT;
CREATE TABLE framework_fields(name TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('object','array','scalar')),payload TEXT) STRICT;
CREATE TABLE framework_entities(collection TEXT NOT NULL,entity_key TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL,
 identity_hash TEXT,owner_id TEXT,holder_id TEXT,state TEXT,status TEXT,card_id TEXT,variant_id TEXT,line_id TEXT,rarity_id TEXT,pool_id TEXT,provider_id TEXT,
 created_at TEXT NOT NULL,name_sort TEXT NOT NULL,search_text TEXT NOT NULL,card_type TEXT NOT NULL,PRIMARY KEY(collection,entity_key),
 FOREIGN KEY(collection) REFERENCES framework_fields(name) ON DELETE CASCADE) STRICT;
CREATE UNIQUE INDEX framework_identity ON framework_entities(collection,identity_hash) WHERE identity_hash IS NOT NULL;
CREATE INDEX framework_owner ON framework_entities(collection,owner_id,created_at DESC,entity_key);
CREATE INDEX framework_owner_state ON framework_entities(collection,owner_id,state,created_at DESC,entity_key);
CREATE INDEX framework_owner_status ON framework_entities(collection,owner_id,status,created_at DESC,entity_key);
CREATE INDEX framework_owner_name ON framework_entities(collection,owner_id,state,name_sort,entity_key);
CREATE INDEX framework_owner_variant ON framework_entities(collection,owner_id,state,variant_id,created_at DESC,entity_key);
CREATE INDEX framework_holder ON framework_entities(collection,holder_id,created_at DESC,entity_key);
CREATE INDEX framework_holder_status ON framework_entities(collection,holder_id,status,created_at DESC,entity_key);
CREATE INDEX framework_pool_status ON framework_entities(collection,pool_id,status,created_at DESC,entity_key);
CREATE INDEX framework_provider_state ON framework_entities(collection,provider_id,state,entity_key);
CREATE INDEX framework_provider_cursor ON framework_entities(collection,provider_id,entity_key,state);
CREATE INDEX framework_status ON framework_entities(collection,status,created_at DESC,entity_key);
CREATE INDEX framework_created ON framework_entities(collection,created_at DESC,entity_key);
CREATE INDEX framework_name ON framework_entities(collection,name_sort,entity_key);
CREATE INDEX framework_order ON framework_entities(collection,ordinal);
`;
export const codeHolderSchemaSql = `
CREATE TABLE framework_code_holders(collection TEXT NOT NULL CHECK(collection='codes'),code_id TEXT NOT NULL,holder_hash TEXT NOT NULL,copy_id TEXT,
 PRIMARY KEY(holder_hash,code_id),FOREIGN KEY(collection,code_id) REFERENCES framework_entities(collection,entity_key) ON DELETE CASCADE) STRICT;
CREATE INDEX framework_code_membership ON framework_code_holders(collection,code_id);
`;
export const schemaSqlV3 = schemaSqlV2 + codeHolderSchemaSql;
export const notificationSchemaSql = "CREATE INDEX framework_notification_owner_order ON framework_entities(collection,owner_id,ordinal,entity_key);";
export const schemaSqlV4 = schemaSqlV3 + notificationSchemaSql;
export const actionSchemaSql = `
CREATE TABLE framework_action_work(collection TEXT NOT NULL CHECK(collection='actionJobs'),job_key TEXT NOT NULL,ordinal INTEGER NOT NULL,due_at INTEGER,reservation_key TEXT,active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(job_key),FOREIGN KEY(collection,job_key) REFERENCES framework_entities(collection,entity_key) ON DELETE CASCADE) STRICT;
CREATE INDEX framework_action_due ON framework_action_work(due_at,ordinal,job_key) WHERE due_at IS NOT NULL;
CREATE INDEX framework_action_reservation ON framework_action_work(reservation_key,active);
`;
export const schemaSqlV5 = schemaSqlV4 + actionSchemaSql;
export const expirationSchemaSql = `
CREATE TABLE framework_expiration_work(collection TEXT NOT NULL CHECK(collection IN ('trades','listings')),entity_key TEXT NOT NULL,ordinal INTEGER NOT NULL,due_at INTEGER,
 PRIMARY KEY(collection,entity_key),FOREIGN KEY(collection,entity_key) REFERENCES framework_entities(collection,entity_key) ON DELETE CASCADE) STRICT;
CREATE INDEX framework_expiration_due ON framework_expiration_work(collection,due_at,ordinal,entity_key) WHERE due_at IS NOT NULL;
`;
export const schemaSqlV6 = schemaSqlV5 + expirationSchemaSql;
export const ownedCardSchemaSql = 'CREATE INDEX framework_owner_card_state ON framework_entities(collection,owner_id,card_id,state);';
export const schemaSqlV7 = schemaSqlV6 + ownedCardSchemaSql;
export const importedCodeSchemaSql = "CREATE INDEX framework_code_prefix_expiry ON framework_entities(collection,pool_id,status,created_at,name_sort,entity_key,variant_id); CREATE UNIQUE INDEX framework_code_order_unique ON framework_entities(name_sort) WHERE collection='_codeStock' AND name_sort!='';";
export const schemaSql = schemaSqlV7 + importedCodeSchemaSql;

const fieldName = value => {
  check(typeof value === 'string' && value.length <= 200 && !['__proto__','constructor','prototype'].includes(value), 'INVALID_STATE', 'Invalid state field', 500);
  return value;
};
const wrapper = (collection, key, value) => ({collection, key, value});
const publicKeyCollections=new Set(['users','copies','packs','codes','externalPurchases']);
const recordKey=(collection,key,keyHash)=>publicKeyCollections.has(collection)?key:keyHash(collection,key);
export const storageRecordKey=recordKey;
const codecShapes = new WeakMap();
function encodedBytes(codec, value) {
  if (!codecShapes.has(codec)) {
    const sample=JSON.parse(codec.encode({}));
    codecShapes.set(codec,sample?.encrypted===1 ? Buffer.byteLength(JSON.stringify({...sample,data:''})) : null);
  }
  const bytes=Buffer.byteLength(JSON.stringify(value)),overhead=codecShapes.get(codec);
  return overhead===null?bytes:overhead+4*Math.ceil(bytes/3);
}
export const encodedRecordBytes=(codec,field,key,value)=>encodedBytes(codec,wrapper(field,key,value));
export const encodeRecordPayload=(codec,field,key,value)=>codec.encode(wrapper(field,key,value));
export function encodeEntity(collection,key,value,ordinal,codec,identityHash,keyHash){
  fieldName(collection);const item=JSON.parse(JSON.stringify(value));
  return {collection,key,storageKey:recordKey(collection,key,keyHash),value:item,ordinal,raw:JSON.stringify(item),
    bytes:encodedBytes(codec,wrapper(collection,key,item)),projected:projection(collection,key,item),
    identity:collection==='users'&&typeof item?.provider==='string'&&typeof item?.subject==='string'?identityHash(item.provider,item.subject):null,
    actionReservation:collection==='actionJobs'&&(item.completionId??item.deliveryCompletionId)?keyHash('completionObligations',item.completionId??item.deliveryCompletionId):null,
    holders:collection==='codes'?[...new Set([item.holderId,...(item.holderHistory??[])].filter(id=>typeof id==='string'))].map(id=>keyHash('code-holder',id)):[]};
}

function walkState(state, codec, field, entity) {
  check(state && typeof state === 'object' && !Array.isArray(state) && state.schemaVersion === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0, 'INVALID_STATE', 'Unsupported logical state', 500);
  const canonical = JSON.parse(JSON.stringify(state));
  let usedBytes = 0;
  for (const [name, value] of Object.entries(canonical)) {
    fieldName(name);
    const kind = Array.isArray(value) ? 'array' : value !== null && typeof value === 'object' ? 'object' : 'scalar';
    const bytes = kind === 'scalar' ? encodedBytes(codec,wrapper(name,null,value)) : 0;
    usedBytes += bytes;
    field?.(name,kind,value,bytes);
    if (kind === 'scalar') continue;
    const notificationKeys = name === 'notifications' ? new Set() : null;
    let ordinal = 0;
    for (const [position, item] of Object.entries(value)) {
      const key=name==='notifications'?item.id:position;
      check(typeof key==='string'&&!notificationKeys?.has(key),'INVALID_STATE','Duplicate or invalid stored record identity',500);
      notificationKeys?.add(key);
      // Retain the writer's structural checks even when its indexes are not needed.
      const reservation = name==='actionJobs' ? item.completionId??item.deliveryCompletionId : null;
      const holders = name==='codes' ? [item.holderId,...(item.holderHistory??[])] : null;
      const bytes = encodedBytes(codec,wrapper(name,key,item));
      usedBytes += bytes;
      entity?.(name,key,item,ordinal++,bytes,reservation,holders);
    }
  }
  return usedBytes;
}

export const measureStateBytes = (state,codec) => walkState(state,codec);

/** One authoritative record per entity; configuration fields retain their logical shapes. */
export function encodeState(state, codec, identityHash, keyHash) {
  const fields = new Map(), entities = new Map();
  const usedBytes = walkState(state,codec,
    (name,kind,value,bytes)=>fields.set(name,{kind,value,raw:kind==='scalar'?JSON.stringify(value):null,bytes}),
    (name,key,item,ordinal,bytes,reservation,holders)=>{
      const projected = projection(name,key,item);
      const identity = name === 'users' && typeof item?.provider === 'string' && typeof item?.subject === 'string'
        ? identityHash(item.provider, item.subject) : null;
      entities.set(JSON.stringify([name,key]), {collection:name,key,storageKey:recordKey(name,key,keyHash),value:item,ordinal,raw:JSON.stringify(item),
        bytes,identity,projected,actionReservation:reservation?keyHash('completionObligations',reservation):null,
        holders:holders?[...new Set(holders.filter(id=>typeof id==='string'))].map(id=>keyHash('code-holder',id)):[]});
    });
  return {fields, entities, usedBytes, encode:(field,key,value)=>codec.encode(wrapper(field,key,value))};
}

function decodeEnvelope(codec, payload, collection, key, keyHash) {
  const value = codec.decode(payload);
  check(value && value.collection === collection && (key===null?value.key===null:typeof value.key==='string'&&recordKey(collection,value.key,keyHash)===key) && Object.hasOwn(value,'value'), 'INVALID_STATE', 'Stored record identity mismatch', 500);
  return value;
}
export const decodeRecordEnvelope=decodeEnvelope;
export const decodeRecord=(codec,payload,collection,key,keyHash)=>decodeEnvelope(codec,payload,collection,key,keyHash).value;

export function readState(db, codec, keyHash) {
  const state = {};
  for (const row of db.prepare('SELECT name,kind,payload FROM framework_fields ORDER BY name').all()) {
    fieldName(row.name);
    state[row.name] = row.kind === 'scalar' ? decodeRecord(codec,row.payload,row.name,null) : row.kind === 'array' ? [] : {};
  }
  for (const row of db.prepare('SELECT collection,entity_key,payload FROM framework_entities ORDER BY collection,ordinal').all()) {
    const envelope=decodeEnvelope(codec,row.payload,row.collection,row.entity_key,keyHash);
    check(Object.hasOwn(state,row.collection) && state[row.collection] !== null && typeof state[row.collection] === 'object', 'INVALID_STATE', 'Stored collection is missing', 500);
    if(row.collection==='notifications'&&Array.isArray(state[row.collection]))state[row.collection].push(envelope.value);else Object.defineProperty(state[row.collection],envelope.key,{value:envelope.value,writable:true,enumerable:true,configurable:true});
  }
  return state;
}

export function writeDifference(db, before, after) {
  const putField=db.prepare('INSERT INTO framework_fields(name,kind,payload) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,payload=excluded.payload');
  const putEntity=db.prepare(`INSERT INTO framework_entities VALUES(${Array(19).fill('?').join(',')}) ON CONFLICT(collection,entity_key) DO UPDATE SET
    ordinal=excluded.ordinal,payload=excluded.payload,identity_hash=excluded.identity_hash,owner_id=excluded.owner_id,holder_id=excluded.holder_id,state=excluded.state,status=excluded.status,
    card_id=excluded.card_id,variant_id=excluded.variant_id,line_id=excluded.line_id,rarity_id=excluded.rarity_id,pool_id=excluded.pool_id,provider_id=excluded.provider_id,created_at=excluded.created_at,name_sort=excluded.name_sort,search_text=excluded.search_text,card_type=excluded.card_type`);
  const retainedOrder=records=>[...records.entities].filter(([key,row])=>row.collection==='notifications'&&before.entities.has(key)&&after.entities.has(key)).sort((a,b)=>a[1].ordinal-b[1].ordinal).map(([key])=>key);
  const notificationOrder=[...after.entities].filter(([,row])=>row.collection==='notifications').sort((a,b)=>a[1].ordinal-b[1].ordinal).map(([key])=>key);
  const appendedOrder=retainedOrder(before).concat(notificationOrder.filter(key=>!before.entities.has(key)));
  const reorderedNotifications=JSON.stringify(appendedOrder)!==JSON.stringify(notificationOrder);
  let changed = 0;
  for (const name of before.fields.keys()) if (!after.fields.has(name)) { db.prepare('DELETE FROM framework_fields WHERE name=?').run(name); changed++; }
  for (const [name,row] of after.fields) {
    const old=before.fields.get(name);
    if (!old || old.kind!==row.kind || old.raw!==row.raw) {putField.run(name,row.kind,row.kind==='scalar'?after.encode(name,null,row.value):null);changed++;}
  }
  for (const [key,row] of before.entities) if (!after.entities.has(key)) {db.prepare('DELETE FROM framework_entities WHERE collection=? AND entity_key=?').run(row.collection,row.storageKey);changed++;}
  for (const [key,row] of after.entities) {
    const old=before.entities.get(key);
    if (old && old.raw===row.raw) {
      if(row.collection==='notifications'?reorderedNotifications:old.ordinal!==row.ordinal){db.prepare('UPDATE framework_entities SET ordinal=? WHERE collection=? AND entity_key=?').run(row.ordinal,row.collection,row.storageKey);if(row.collection==='actionJobs')writeActionWork(db,row);if(['trades','listings'].includes(row.collection))writeExpirationWork(db,row);changed++;}
      continue;
    }
    const p=row.projected;
    const ordinal=row.collection==='notifications'&&!reorderedNotifications?(db.prepare("SELECT ordinal FROM framework_entities WHERE collection='notifications' AND entity_key=?").get(row.storageKey)?.ordinal??db.prepare("SELECT COALESCE(MAX(ordinal)+1,0) AS n FROM framework_entities WHERE collection='notifications'").get().n):row.ordinal;
    putEntity.run(row.collection,row.storageKey,ordinal,after.encode(row.collection,row.key,row.value),row.identity,p.ownerId,p.holderId,p.state,p.status,p.cardId,p.variantId,p.lineId,p.rarityId,p.poolId,p.providerId,p.createdAt,p.name,p.search,p.cardType);
    if(row.collection==='codes')writeCodeHolders(db,row);
    if(row.collection==='actionJobs')writeActionWork(db,row);
    if(['trades','listings'].includes(row.collection))writeExpirationWork(db,row);
    changed++;
  }
  return changed;
}

function writeCodeHolders(db,row) {
  db.prepare("DELETE FROM framework_code_holders WHERE collection='codes' AND code_id=?").run(row.storageKey);
  const insert=db.prepare("INSERT INTO framework_code_holders VALUES('codes',?,?,?)");
  for(const holder of row.holders)insert.run(row.storageKey,holder,row.value.copyId??null);
}
export function migrateCodeHolders(db,encoded) {
  for(const row of encoded.entities.values())if(row.collection==='codes')writeCodeHolders(db,row);
}
function writeActionWork(db,row){
  const job=row.value,due=job.status==='pending'?Date.parse(job.nextAt):job.status==='running'?Date.parse(job.leaseUntil):NaN;
  db.prepare("INSERT INTO framework_action_work VALUES('actionJobs',?,?,?,?,?) ON CONFLICT(job_key) DO UPDATE SET ordinal=excluded.ordinal,due_at=excluded.due_at,reservation_key=excluded.reservation_key,active=excluded.active").run(row.storageKey,row.ordinal,Number.isFinite(due)?due:null,row.actionReservation,Number(['pending','running'].includes(job.status)));
}
export function migrateActionWork(db,encoded){for(const row of encoded.entities.values())if(row.collection==='actionJobs')writeActionWork(db,row);}
function writeExpirationWork(db,row){
  const value=row.value,times=row.collection==='trades'?(value.status==='pending'?[Date.parse(value.expiresAt)]:[]):value.status==='active'?[Date.parse(value.endsAt),Date.parse(value.draw?.claimUntil)]:[],finite=times.filter(Number.isFinite);
  db.prepare('INSERT INTO framework_expiration_work VALUES(?,?,?,?) ON CONFLICT(collection,entity_key) DO UPDATE SET ordinal=excluded.ordinal,due_at=excluded.due_at').run(row.collection,row.storageKey,row.ordinal,finite.length?Math.min(...finite):null);
}
export function migrateExpirationWork(db,encoded){for(const row of encoded.entities.values())if(['trades','listings'].includes(row.collection))writeExpirationWork(db,row);}

const columns={ownerId:'owner_id',holderId:'holder_id',state:'state',status:'status',cardId:'card_id',variantId:'variant_id',lineId:'line_id',rarityId:'rarity_id',poolId:'pool_id',providerId:'provider_id'};
export function sqliteQueries(db,codec,identityHash,keyHash,onDecode=()=>{}) {
  const decode=row=>{onDecode();return decodeRecord(codec,row.payload,row.collection,row.entity_key,keyHash);};
  const get=(field,id)=>{fieldName(field);check(typeof id==='string','INVALID_INPUT','Invalid record identifier');const row=db.prepare('SELECT collection,entity_key,payload FROM framework_entities WHERE collection=? AND entity_key=?').get(field,recordKey(field,id,keyHash));return row?decode(row):undefined;};
  const value=field=>{
    fieldName(field);const kind=db.prepare('SELECT kind,payload FROM framework_fields WHERE name=?').get(field);if(!kind)return undefined;
    if(kind.kind==='scalar'){onDecode();return decodeRecord(codec,kind.payload,field,null);}
    const result=kind.kind==='array'?[]:{};
    for(const row of db.prepare('SELECT collection,entity_key,payload FROM framework_entities WHERE collection=? ORDER BY ordinal').all(field)){onDecode();const envelope=decodeEnvelope(codec,row.payload,row.collection,row.entity_key,keyHash);if(field==='notifications')result.push(envelope.value);else Object.defineProperty(result,envelope.key,{value:envelope.value,writable:true,enumerable:true,configurable:true});}
    return result;
  };
  const page=(collection,input)=>{
    const options=queryOptions(collection,input),where=['collection=?'],args=[collection];
    for(const [name,filter]of Object.entries(options.filters)) {
      if(name==='states'){where.push(`state IN (${filter.map(()=>'?').join(',')})`);args.push(...filter);}
      else {where.push(columns[name]+'=?');args.push(filter);}
    }
    if(options.search){where.push('instr(search_text,?)>0');args.push(options.search);}
    const predicate=where.join(' AND '),total=db.prepare('SELECT COUNT(*) AS count FROM framework_entities WHERE '+predicate).get(...args).count;
    const order=options.sort==='newest'?'created_at DESC,entity_key':options.sort==='name'?'name_sort,entity_key':options.sort==='ordinal'?'ordinal,entity_key':'entity_key';
    if(options.after&&collection==='externalPurchases'&&options.sort==='id'){
      where.push('entity_key>?');args.push(options.after);
    }else if(options.after){
      const cursor=db.prepare('SELECT entity_key,created_at,name_sort,ordinal FROM framework_entities WHERE '+predicate+' AND entity_key=?').get(...args,options.after);
      check(cursor,'INVALID_CURSOR','Cursor no longer exists; restart this view',409);
      if(options.sort==='id'){where.push('entity_key>?');args.push(cursor.entity_key);}
      else {const name=options.sort==='newest'?'created_at':options.sort==='ordinal'?'ordinal':'name_sort',operator=options.sort==='newest'?'<':'>';
        where.push(`(${name}${operator}? OR (${name}=? AND entity_key>?))`);args.push(cursor[name],cursor[name],cursor.entity_key);}
    }
    const source=collection==='externalPurchases'&&options.filters.providerId!==undefined&&options.sort==='id'?'framework_entities INDEXED BY framework_provider_cursor':'framework_entities';
    const rows=db.prepare('SELECT collection,entity_key,payload FROM '+source+' WHERE '+where.join(' AND ')+' ORDER BY '+order+' LIMIT ?').all(...args,options.limit+1);
    const more=rows.length>options.limit,selected=rows.slice(0,options.limit);
    return {items:selected.map(decode),total,next:more?selected.at(-1).entity_key:null};
  };
  const count=(collection,column,id,extra='')=>db.prepare(`SELECT COUNT(*) AS count FROM framework_entities WHERE collection=? AND ${column}=?${extra}`).get(collection,id).count;
  return {get,value,
    importedCodePrefix(poolId,limit,at){check(value('_codeImportOrderReady')===true,'RECORD_MIGRATION_REQUIRED','Prepare imported code ordering',503);return sqliteImportedCodeRows(db,poolId,limit,at).map(item=>{const row=get('codes',item.codeId);verifyCodeProjection(row,item,at);check(get('_codeImportOrder',row.id)===item.ordinal,'CODE_INTEGRITY','Imported code ordering cannot be verified',500);return {row,ordinal:item.ordinal};});},
    ownedCardPresence(ownerId,cardIds){const ids=ownedCardIds(ownerId,cardIds),counts=sqliteOwnedCardCounts(db,ownerId,ids);return ids.map(cardId=>({cardId,owned:(counts.get(cardId)??0)>0}));},
    availableCodeStock(poolId,limit,at){
      check(typeof poolId==='string'&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000&&Number.isFinite(Date.parse(at)),'RECORD_PATH_UNAVAILABLE','Code stock scope requires bounded allocation',409);
      const rows=db.prepare("SELECT variant_id FROM framework_entities INDEXED BY framework_pool_status WHERE collection='_codeStock' AND pool_id=? AND status='available' AND (created_at='' OR created_at>?) ORDER BY ordinal LIMIT ?").all(poolId,new Date(at).toISOString(),limit);
      return rows.map(row=>{const result=get('codes',row.variant_id);check(result,'INVALID_STATE','Projected code stock is missing',500);return result;});
    },
    notifications(ownerId){
      if(db.prepare('PRAGMA user_version').get().user_version<4)return (value('notifications')??[]).filter(row=>row.userId===ownerId);
      return db.prepare("SELECT collection,entity_key,payload FROM framework_entities INDEXED BY framework_notification_owner_order WHERE collection='notifications' AND owner_id=? ORDER BY ordinal").all(ownerId).map(row=>{const item=decode(row);check(item.userId===ownerId,'INVALID_STATE','Notification owner index mismatch',500);return item;});
    },
    codeHistoryEntries(holderId) {
      check(typeof holderId==='string','INVALID_INPUT','Invalid holder identifier');
      return db.prepare(`SELECT e.collection,e.entity_key,e.payload,c.entity_key AS copy_key,c.payload AS copy_payload FROM framework_code_holders h
        JOIN framework_entities e ON e.collection=h.collection AND e.entity_key=h.code_id
        JOIN framework_entities c ON c.collection='copies' AND c.entity_key=h.copy_id
        WHERE h.holder_hash=? AND c.state!='sealed' ORDER BY e.ordinal`).all(keyHash('code-holder',holderId)).map(record=>{
          const code=decode(record),copy=decode({collection:'copies',entity_key:record.copy_key,payload:record.copy_payload});
          check(code.holderId===holderId||(code.holderHistory??[]).includes(holderId),'INVALID_STATE','Indexed code holder differs',500);
          check(code.copyId===copy.id&&copy.state!=='sealed','INVALID_STATE','Indexed code copy differs',500);
          return {code,copy};
        });
    },
    records(field,{ids}) {check(Array.isArray(ids)&&ids.length<=2000&&ids.every(id=>typeof id==='string'),'INVALID_INPUT','Invalid record identifiers');return Object.fromEntries([...new Set(ids)].flatMap(id=>{const result=get(field,id);return result===undefined?[]:[[id,result]];}));},
    userByIdentity(provider,subject){const row=db.prepare("SELECT collection,entity_key,payload FROM framework_entities WHERE collection='users' AND identity_hash=?").get(identityHash(provider,subject));if(!row)return undefined;const user=decode(row);check(user.provider===provider&&user.subject===subject,'INVALID_STATE','Indexed identity differs',500);return user;},
    providerIdentity(userId){const user=get('users',userId);return user?{provider:user.provider,subject:user.subject}:undefined;},
    collectionCounts(ownerId){return {copies:count('copies','owner_id',ownerId),ownedCopies:count('copies','owner_id',ownerId," AND state='owned'"),sealedCopies:count('copies','owner_id',ownerId," AND state='sealed'"),packs:count('packs','owner_id',ownerId),unopenedPacks:count('packs','owner_id',ownerId," AND status='unopened'"),codes:count('codes','holder_id',ownerId)};},
    variantCounts({ownerId,after='',limit=50,excludeTypes=[]}={}) {
      queryOptions('copies',{ownerId,after,limit});
      check(Array.isArray(excludeTypes)&&excludeTypes.length<=20&&excludeTypes.every(x=>typeof x==='string'),'INVALID_INPUT','Invalid excluded card types');
      const where="collection='copies' AND owner_id=? AND state='owned'"+(excludeTypes.length?` AND card_type NOT IN (${excludeTypes.map(()=>'?').join(',')})`:''),args=[ownerId,...excludeTypes];
      const totals=db.prepare('SELECT COUNT(*) AS totalCards,COUNT(DISTINCT variant_id) AS uniqueCards FROM framework_entities WHERE '+where).get(...args);
      if(after)check(db.prepare('SELECT 1 FROM framework_entities WHERE '+where+' AND variant_id=? LIMIT 1').get(...args,after),'INVALID_CURSOR','Cursor no longer exists; restart this view',409);
      const rows=db.prepare('SELECT variant_id AS variantId,COUNT(*) AS count FROM framework_entities WHERE '+where+(after?' AND variant_id>?':'')+' GROUP BY variant_id ORDER BY variant_id LIMIT ?').all(...args,...(after?[after]:[]),limit+1);
      const items=rows.slice(0,limit).map(row=>({...row,copyId:db.prepare('SELECT entity_key FROM framework_entities WHERE '+where+' AND variant_id=? ORDER BY created_at DESC,entity_key LIMIT 1').get(...args,row.variantId).entity_key}));
      return {items,totalCards:totals.totalCards,uniqueCards:totals.uniqueCards,total:totals.uniqueCards,next:rows.length>limit?items.at(-1).variantId:null};
    },
    pageCopies:input=>page('copies',{state:'owned',...input}),pagePacks:input=>page('packs',input),pageCodes:input=>page('codes',input),pageExternalPurchases:input=>page('externalPurchases',input),
  };
}

export function sqliteOwnedCardCounts(db,ownerId,ids){check(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='framework_owner_card_state'").get(),'RECORD_MIGRATION_REQUIRED','Owned card queries require writable storage migration',503);const counts=new Map();for(let start=0;start<ids.length;start+=500){const chunk=ids.slice(start,start+500);for(const row of db.prepare("SELECT card_id AS cardId,COUNT(*) AS n FROM framework_entities INDEXED BY framework_owner_card_state WHERE collection='copies' AND owner_id=? AND state IN ('owned','sealed') AND card_id IN ("+chunk.map(()=>'?').join(',')+") GROUP BY card_id").all(ownerId,...chunk))counts.set(row.cardId,row.n);}return counts;}

export function sqliteImportedCodeRows(db,poolId,limit,at){
  importedCodeBounds(poolId,limit,at);check(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='framework_code_prefix_expiry'").get(),'RECORD_MIGRATION_REQUIRED','Imported code queries require writable storage migration',503);
  const select="SELECT variant_id AS codeId,name_sort AS importOrder,created_at AS expiry,pool_id AS poolId FROM framework_entities INDEXED BY framework_code_prefix_expiry WHERE collection='_codeStock' AND pool_id=? AND status='available' AND ";
  const future=db.prepare(select+"created_at>? ORDER BY created_at,name_sort,entity_key LIMIT ?").all(poolId,new Date(at).toISOString(),limit);
  if(future.length<limit)future.push(...db.prepare(select+"created_at='' ORDER BY name_sort,entity_key LIMIT ?").all(poolId,limit-future.length));return future.map(e=>({...e,ordinal:Number(e.importOrder)}));
}
export function verifyCodeProjection(row,item,at){check(row&&row.id===item.codeId&&row.poolId===item.poolId&&row.status==='available'&&(row.expiresAt===null?'':new Date(row.expiresAt).toISOString())===item.expiry&&(row.expiresAt===null||Date.parse(row.expiresAt)>Date.parse(at)),'CODE_INTEGRITY','Imported code stock cannot be verified',500);}
