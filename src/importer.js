import {parseDocument,stringify} from 'yaml';
import {createHash} from 'node:crypto';
import {check,validateCatalog,FrameworkError} from './catalog.js';
import {safeData} from './data.js';

export function contentDigest(value){const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
export function parseContent(source,{format='json',maxBytes=8*1024*1024}={}) {
  check(typeof source==='string'&&Buffer.byteLength(source)<=maxBytes,'PAYLOAD_TOO_LARGE','Import exceeds its byte limit',413);
  let data;
  try {
    if(format==='json'){data=JSON.parse(source);const document=parseDocument(source,{uniqueKeys:true,strict:true,schema:'json'});if(document.errors.length)throw new Error(document.errors.map(e=>e.message).join('\n'));}
    else if(format==='yaml'||format==='yml'){
      const document=parseDocument(source,{uniqueKeys:true,strict:true,schema:'core'});
      if(document.errors.length||document.warnings.length)throw new Error([...document.errors,...document.warnings].map(e=>e.message).join('\n'));
      data=document.toJS({maxAliasCount:0});
    }else throw new Error('Use json or yaml');
  }catch(error){throw new FrameworkError('INVALID_IMPORT',error.message.slice(0,2000));}
  return safeData(data,{maxBytes});
}
export function prepareImport({source,format='json',mode='merge',base,expectedVersion}) {
  check(['merge','replace'].includes(mode),'INVALID_IMPORT','Import mode must be merge or replace');
  check((base?.version??0)===expectedVersion,'STALE_IMPORT','Catalog changed; preview the import again',409);
  const incoming=typeof source==='string'?parseContent(source,{format}):safeData(source);
  check(incoming&&typeof incoming==='object'&&!Array.isArray(incoming),'INVALID_IMPORT','Import must be an object containing catalog sections');
  check(!base||base.capabilities||Object.hasOwn(incoming,'capabilities'),'CAPABILITY_MIGRATION_REQUIRED','Include an explicit version 1 capability profile when migrating an installed catalog',503);
  let merged;
  if(mode==='replace')merged=incoming;
  else {
    check(base,'INVALID_IMPORT','Use replace for the first full catalog');merged=structuredClone(base);
    const allowed=['cards','variants','products','recipes','lines','rarities','currencies','combinations','displayFields','cardTypes'];
    for(const key of Object.keys(incoming))check([...allowed,'features','metadataSchemas','version','capabilities'].includes(key),'INVALID_IMPORT','Unknown import section '+key);
    for(const key of allowed)if(incoming[key]!==undefined){
      check(Array.isArray(incoming[key]),'INVALID_IMPORT',key+' must be an array');
      const duplicate=new Set();
      for(const row of incoming[key]){check(row&&typeof row.id==='string'&&!duplicate.has(row.id),'INVALID_IMPORT','Duplicate/missing '+key+' ID');duplicate.add(row.id);}
      const replacements=new Map(incoming[key].map(row=>[row.id,row]));
      merged[key]=(base[key]??[]).map(row=>replacements.get(row.id)??row);
      const previous=new Set((base[key]??[]).map(row=>row.id));merged[key].push(...incoming[key].filter(row=>!previous.has(row.id)));
    }
    if(incoming.features)merged.features={...base.features,...incoming.features};
    if(Object.hasOwn(incoming,'capabilities'))merged.capabilities=incoming.capabilities;
    if(incoming.metadataSchemas)merged.metadataSchemas={...base.metadataSchemas,...incoming.metadataSchemas};
    merged.version=incoming.version??base.version+1;
  }
  const manifest=validateCatalog(merged),changes=[];
  if(contentDigest(base?.capabilities??null)!==contentDigest(manifest.capabilities))changes.push({section:'capabilities',id:'capabilities',action:base?.capabilities?'update':'add'});
  for(const key of ['currencies','lines','rarities','cards','variants','products','recipes','combinations','cardTypes']){
    const old=new Map((base?.[key]??[]).map(row=>[row.id,row]));
    for(const row of manifest[key]??[]){const previous=old.get(row.id);if(!previous||contentDigest(previous)!==contentDigest(row))changes.push({section:key,id:row.id,action:previous?'update':'add'});old.delete(row.id);}
    for(const id of old.keys())changes.push({section:key,id,action:'remove'});
  }
  return {manifest,digest:contentDigest(manifest),expectedVersion,changes,counts:Object.fromEntries(['cards','variants','products','combinations'].map(key=>[key,(manifest[key]??[]).length])),warnings:manifest.cards.flatMap(card=>card.layers.length?[]:[{path:'cards.'+card.id+'.layers',message:'No image layers; the default procedural face will be used.'}])};
}
export function exportContent(manifest,{format='json'}={}){return format==='yaml'?stringify(manifest,{aliasDuplicateObjects:false}):JSON.stringify(manifest,null,2)+'\n';}
