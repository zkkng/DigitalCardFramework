import {randomUUID} from 'node:crypto';
import {check,text,FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {hasPermission} from './access.js';
import {completionCapacity,withCompletion,accountReservationMetadata} from './completion.js';

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
  #store;#clock;#execute;#admit;#limits;#completion;
  constructor({store,clock,execute,admit,limits,completion}){this.#store=store;this.#clock=clock;this.#execute=execute;this.#admit=admit;this.#limits=limits;this.#completion=completion;}
  #read(actor,id,options={}){
    text(id,'intent ID',100);
    return this.#store.query(q=>{user(q,actor);const row=q.get('commandIntents',id);check(row?.userId===actor.userId,'NOT_FOUND','Command intent not found',404);authorize(actor,row.command,options);return row;});
  }
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
    return this.#store.transact(s=>{
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
    });
  }
  #finish(actor,id,fn){
    return this.#store.transact(s=>{
      const row=s.commandIntents?.[id];check(row?.userId===actor.userId,'NOT_FOUND','Command intent not found',404);
      const obligation=s.completionObligations?.['intent:'+id];check(obligation,'INVALID_STATE','Command completion reservation is missing',500);
      const result=withCompletion(s,obligation,()=>fn(row,s),state=>this.#store.measure(state));completionCapacity(s,this.#limits);return result;
    });
  }
  execute(actor,{id},options={}){
    const row=this.#read(actor,id,options);
    if(row.error)throw new FrameworkError(row.error.code,row.error.message,row.error.status);
    let result;
    try{
      if(options.requireTradeReview&&['acceptTrade','counterTrade'].includes(row.command))check(typeof row.input.expectedDigest==='string'&&/^[a-f0-9]{64}$/.test(row.input.expectedDigest),'TRADE_REVIEW_REQUIRED','Review the current offer before submitting this action',409);
      result=this.#execute(actor,row.command,clone(row.input));
      check(!result?.then,'INVALID_STATE','Durable command callbacks must be synchronous',500);
    }catch(error){
      if(row.state==='pending'&&Number.isInteger(error.status)&&(error.status>=400&&error.status<500||error.status===507)&&![401,403,429].includes(error.status))this.#finish(actor,id,current=>{if(current.state==='pending'){current.state='failed';current.completedAt=this.#clock();current.error={code:/^[A-Z][A-Z0-9_]{0,80}$/.test(error.code)?error.code:'COMMAND_REJECTED',message:String(error.message).slice(0,512),status:error.status};}});
      throw error;
    }
    const intent=row.state==='pending'?this.#finish(actor,id,current=>{if(current.state==='pending'){current.state='completed';current.completedAt=this.#clock();}return current;}):row;
    return {intent,result};
  }
  acknowledge(actor,{id},options={}){
    const row=this.#read(actor,id,options);check(terminal.has(row.state),'COMMAND_PENDING','Recover the pending command before acknowledging it',409);
    if(row.state==='acknowledged')return {id,state:'acknowledged'};
    return this.#finish(actor,id,(current,s)=>{current.state='acknowledged';const heads=s.commandIntentHeads?.[actor.userId];if(heads?.[current.command]===id)delete heads[current.command];return {id,state:'acknowledged'};});
  }
}
