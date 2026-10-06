import {randomUUID} from 'node:crypto';
import {check,text,FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {hasPermission} from './access.js';
import {completionCapacity,withCompletion,accountReservationMetadata} from './completion.js';
import {recordAccountingField,validRecordAccounting,summarizeRecords} from './record-accounting.js';
import {recordContexts} from './record-context.js';

export const durableCommands=Object.freeze(['purchase','openPack','convert','tradeUp','saveAlbum','proposeTrade','acceptTrade','cancelTrade','consumeBinding','counterTrade','preferences','readNotifications','commitImport','reportCodeUsage','createShop','createListing','buyListing','cancelListing','enterRaffle','openCard','configureAdmin','administerCards']);
const permissions={commitImport:'catalog.publish',configureAdmin:'admin.manage',administerCards:'admin.cards'};
const terminal=new Set(['completed','failed','acknowledged']);
const clone=value=>structuredClone(value);
function authorize(actor,command,{operators=true}={}){
  check(durableCommands.includes(command),'INVALID_INPUT','Unsupported durable command');
  if(permissions[command])check(operators&&hasPermission(actor,permissions[command]),'FORBIDDEN','Command authority is required',403);
}
function user(q,actor){check(actor?.disabled!==true&&typeof actor?.userId==='string'&&q.get('users',actor.userId),'UNAUTHENTICATED','A verified account is required',401);}

/** Server-owned recovery heads retain original commands until acknowledged. */
export class CommandIntentService{
  #store;#clock;#execute;#executeAsync;#admit;#limits;#completion;
  constructor({store,clock,execute,executeAsync=execute,admit,limits,completion}){this.#store=store;this.#clock=clock;this.#execute=execute;this.#executeAsync=executeAsync;this.#admit=admit;this.#limits=limits;this.#completion=completion;}
  #read(actor,id,options={}){
    text(id,'intent ID',100);
    return this.#store.query(q=>{user(q,actor);const row=q.get('commandIntents',id);check(row?.userId===actor.userId,'NOT_FOUND','Command intent not found',404);authorize(actor,row.command,options);return row;});
  }
  get(actor,{id,command},options={}){authorize(actor,command,options);const row=this.#read(actor,id,options);check(row.command===command,'NOT_FOUND','Command intent not found',404);return {id:row.id,userId:row.userId,command:row.command,state:row.state};}
  pending(actor,{command,...options}={}){
    if(command!==undefined)authorize(actor,command,options);
    return this.#store.query(q=>{
      user(q,actor);const heads=q.get('commandIntentHeads',actor.userId)??{},items=[];
      for(const name of command?[command]:durableCommands){const id=heads[name];if(!id)continue;const row=q.get('commandIntents',id);check(row?.userId===actor.userId,'INVALID_STATE','Command recovery head is invalid',500);try{authorize(actor,name,options);}catch(error){if(error.code==='FORBIDDEN')continue;throw error;}if(row.state!=='acknowledged')items.push(row);}
      return {items};
    });
  }
  register(actor,{command,input},options={}){
    authorize(actor,command,options);check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Command input must be an object');
    const reviewed=safeData(input,{maxBytes:1048576});if(reviewed.key!==undefined)text(reviewed.key,'idempotency key',128);
    return this.#records(tx=>{
      user(tx,actor);const heads=tx.get('commandIntentHeads',actor.userId)??{},old=heads[command]&&tx.get('commandIntents',heads[command]);if(old&&old.state!=='acknowledged')return old;
      const accounting=this.#accounting(tx),count=tx.value('commandIntentCount')??0;check(count<this.#limits.commandIntents,'INSTALLATION_CAPACITY','Command intent retention capacity reached',507);
      const token=actor.userId+':'+reviewed.key,probe={requests:{[token]:reviewed.key&&tx.get('requests',token)},operatorRequests:{[token]:reviewed.key&&tx.get('operatorRequests',token)},packs:Object.create(null),trades:Object.create(null),listings:Object.create(null)};
      for(const [field,key]of [['packs',reviewed.packId],['trades',reviewed.tradeId],['listings',reviewed.listingId]])if(typeof key==='string')probe[field][key]=tx.get(field,key);
      const completion=this.#completion(probe,actor,command,reviewed),id=randomUUID(),row={id,userId:actor.userId,command,input:{...reviewed,key:reviewed.key??randomUUID()},state:'pending',createdAt:this.#clock(),completedAt:null,error:null},obligationId='intent:'+id;
      const obligation={id:obligationId,kind:'intent',entityId:id,status:'reserved',events:0,jobs:0,bytes:8192+2*Buffer.byteLength(JSON.stringify(row)),usedBytes:0,subscriptions:[]};
      const state={copies:{},packs:{},requests:{},trades:{},events:[],completionObligations:{[obligationId]:obligation}};recordContexts.set(state,{accounting});
      try{this.#admit(state,completion);}finally{recordContexts.delete(state);}
      tx.put('commandIntents',id,row);heads[command]=id;tx.put('commandIntentHeads',actor.userId,heads);tx.setScalar('commandIntentCount',count+1);tx.put('completionObligations',obligationId,obligation);if(completion)tx.reserveIntentCompletion(obligationId,{admission:true});return row;
    },()=>this.#store.transact(s=>{
      check(actor?.disabled!==true&&actor?.userId&&s.users[actor.userId],'UNAUTHENTICATED','A verified account is required',401);
      const before=this.#store.measure(s).usedBytes,completion=this.#completion(s,actor,command,reviewed);
      s.commandIntents??={};s.commandIntentHeads??={};const heads=s.commandIntentHeads[actor.userId]??={},old=heads[command]&&s.commandIntents[heads[command]];
      if(old&&old.state!=='acknowledged')return old;
      check((s.commandIntentCount??0)<this.#limits.commandIntents,'INSTALLATION_CAPACITY','Command intent retention capacity reached',507);
      const id=randomUUID(),row={id,userId:actor.userId,command,input:{...reviewed,key:reviewed.key??randomUUID()},state:'pending',createdAt:this.#clock(),completedAt:null,error:null};
      s.commandIntents[id]=row;heads[command]=id;s.commandIntentCount=(s.commandIntentCount??0)+1;
      s.completionObligations??={};const obligationId='intent:'+id;
      s.completionObligations[obligationId]={id:obligationId,kind:'intent',entityId:id,status:'reserved',events:0,jobs:0,bytes:8192+2*Buffer.byteLength(JSON.stringify(row)),usedBytes:0,subscriptions:[]};
      if(completion)accountReservationMetadata(s,[s.completionObligations[obligationId]],state=>this.#store.measure(state),before);
      this.#admit(s,completion);return row;
    }));
  }
  #accounting(tx){let accounting;try{accounting=JSON.parse(tx.value(recordAccountingField));}catch{}check(validRecordAccounting(accounting,tx.value('revision')),'RECORD_MIGRATION_REQUIRED','Record accounting is not prepared',503);return accounting;}
  #records(fn,fallback){if(!this.#store.transactRecords)return fallback();try{return this.#store.transactRecords(fn,{intent:true});}catch(error){if(error.code==='RECORD_MIGRATION_REQUIRED')return fallback();throw error;}}
  #finish(actor,id,fn){
    return this.#records(tx=>{
      const accounting=this.#accounting(tx),row=tx.get('commandIntents',id);check(row?.userId===actor.userId,'NOT_FOUND','Command intent not found',404);
      const obligationId='intent:'+id,obligation=tx.get('completionObligations',obligationId);check(obligation,'INVALID_STATE','Command completion reservation is missing',500);
      const state={commandIntents:{[id]:row},commandIntentHeads:{[actor.userId]:tx.get('commandIntentHeads',actor.userId)??{}},completionObligations:{[obligationId]:obligation},events:[]},prior=summarizeRecords(state);
      for(const key of Object.keys(accounting.completion))accounting.completion[key]-=prior.completion[key];recordContexts.set(state,{accounting});
      try{obligation.status='completed';const result=fn(row,state);completionCapacity(state,this.#limits);tx.put('commandIntents',id,row);tx.put('commandIntentHeads',actor.userId,state.commandIntentHeads[actor.userId]);tx.put('completionObligations',obligationId,obligation);tx.reserveIntentCompletion(obligationId);return result;}finally{recordContexts.delete(state);}
    },()=>this.#store.transact(s=>{
      const row=s.commandIntents?.[id];check(row?.userId===actor.userId,'NOT_FOUND','Command intent not found',404);
      const obligation=s.completionObligations?.['intent:'+id];check(obligation,'INVALID_STATE','Command completion reservation is missing',500);
      const result=withCompletion(s,obligation,()=>fn(row,s),state=>this.#store.measure(state));completionCapacity(s,this.#limits);return result;
    }));
  }
  execute(actor,{id},options={}){
    const row=this.#read(actor,id,options);
    if(row.error)throw new FrameworkError(row.error.code,row.error.message,row.error.status);
    let result;
    try{
      this.#review(row,options);
      result=this.#execute(actor,row.command,clone(row.input));
      check(!result?.then,'INVALID_STATE','Durable command callbacks must be synchronous',500);
    }catch(error){
      this.#rejected(actor,row,error);
    }
    return this.#completed(actor,row,result);
  }
  async executeAsync(actor,{id},options={}){
    const principal=clone(actor),policy=clone(options),row=this.#read(principal,id,policy);
    if(row.error)throw new FrameworkError(row.error.code,row.error.message,row.error.status);
    let result;
    try{this.#review(row,policy);result=await this.#executeAsync(principal,row.command,clone(row.input));}
    catch(error){this.#rejected(principal,row,error);}
    return this.#completed(principal,row,result);
  }
  #review(row,options){
    if(options.requireTradeReview&&['acceptTrade','counterTrade'].includes(row.command))check(typeof row.input.expectedDigest==='string'&&/^[a-f0-9]{64}$/.test(row.input.expectedDigest),'TRADE_REVIEW_REQUIRED','Review the current offer before submitting this action',409);
  }
  #rejected(actor,row,error){
    if(row.state==='pending'&&Number.isInteger(error.status)&&(error.status>=400&&error.status<500||error.status===507)&&![401,403,429].includes(error.status))this.#finish(actor,row.id,current=>{if(current.state==='pending'){current.state='failed';current.completedAt=this.#clock();current.error={code:/^[A-Z][A-Z0-9_]{0,80}$/.test(error.code)?error.code:'COMMAND_REJECTED',message:String(error.message).slice(0,512),status:error.status};}});
    throw error;
  }
  #completed(actor,row,result){
    const intent=row.state==='pending'?this.#finish(actor,row.id,current=>{if(current.state==='pending'){current.state='completed';current.completedAt=this.#clock();}return current;}):row;
    return {intent,result};
  }
  acknowledge(actor,{id},options={}){
    const row=this.#read(actor,id,options);check(terminal.has(row.state),'COMMAND_PENDING','Recover the pending command before acknowledging it',409);
    if(row.state==='acknowledged')return {id,state:'acknowledged'};
    return this.#finish(actor,id,(current,s)=>{current.state='acknowledged';const heads=s.commandIntentHeads?.[actor.userId];if(heads?.[current.command]===id)delete heads[current.command];return {id,state:'acknowledged'};});
  }
}
