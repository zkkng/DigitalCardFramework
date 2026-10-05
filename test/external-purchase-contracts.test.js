import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {CardFramework,MemoryStore,externalPurchaseFingerprint,externalPurchaseId} from '../src/index.js';
import {externalPurchaseSchema} from '../src/external-purchase-contracts.js';
import {openapi} from '../src/contracts.js';
import {fixture,admin} from './helpers.js';

const ajv=new Ajv2020({strict:true,strictRequired:false});
ajv.addSchema(externalPurchaseSchema);
const validate=name=>ajv.compile({$ref:externalPurchaseSchema.$id+'#/$defs/'+name});
const matches=(name,value)=>assert.equal(validate(name)(value),true,JSON.stringify(validate(name).errors));
const providerId='host.wallet';
const provider={permissions:['currency.settle'],settlementProviderId:providerId};
function setup(){
  const store=new MemoryStore(),base=fixture({store});
  const framework=new CardFramework({store,random:()=>0,bindings:{'demo.code':()=>({value:'sample'})},externalPurchaseProviders:{[providerId]:{
    validateIntent:({intent})=>intent.externalCurrency==='points'&&intent.externalUnits===String(intent.quote.price.amount),
    verifyProof:()=>true
  }}});
  const input=(transactionId,actor=base.alice,productId='common')=>({key:transactionId,providerId,transactionId,userId:actor.userId,externalCurrency:'points',externalUnits:'10',quote:framework.quote(actor,{productId,quantity:1})});
  const proof=(row,kind)=>({kind,reference:kind+':'+row.terms.transactionId,providerId,transactionId:row.terms.transactionId,userId:row.terms.userId,externalCurrency:row.terms.externalCurrency,externalUnits:row.terms.externalUnits,fingerprint:row.fingerprint,...(kind==='refund'?{compensationId:row.compensationId,debitReference:row.debitReference}:{})});
  return {...base,framework,input,proof};
}

test('trusted host request schemas reject extra authority, altered money and incomplete proof fields',()=>{
  const x=setup(),request=x.input('request');matches('PrepareExternalPurchase',request);
  const check=validate('PrepareExternalPurchase');
  for(const change of [{...request,role:'admin'},{...request,externalUnits:10},{...request,externalUnits:'010'},{...request,externalUnits:'0'},{...request,quote:{...request.quote,quantity:0}},{...request,quote:{...request.quote,price:{currencyId:'credits',amount:1.5}}},{...request,quote:{...request.quote,price:{currencyId:'credits',amount:Number.MAX_SAFE_INTEGER+1}}}])assert.equal(check(change),false);
  const row=x.framework.prepareExternalPurchase(provider,request),receipt=x.proof(row,'debit');
  matches('ExternalDebitProof',receipt);assert.equal(validate('ExternalDebitProof')({...receipt,code:'unexpected'}),false);
  const incomplete={...receipt};delete incomplete.fingerprint;assert.equal(validate('ExternalDebitProof')(incomplete),false);
  matches('CommitExternalPurchase',{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:receipt});
});

test('schema projections match prepared, fulfilled, refund, compensated and cancelled results without private fields',()=>{
  const x=setup(),prepare=(id,actor=x.alice,productId='common')=>{
    const request=x.input(id,actor,productId);matches('PrepareExternalPurchase',request);
    const row=x.framework.prepareExternalPurchase(provider,request);matches('ExternalPurchaseProjection',row);return row;
  };
  const commit=row=>{
    const input={preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:x.proof(row,'debit')};matches('CommitExternalPurchase',input);
    const result=x.framework.commitExternalPurchase(provider,input);matches('ExternalPurchaseProjection',result);return result;
  };
  const one=prepare('one',x.alice,'unique'),two=prepare('two',x.bob,'unique');
  const delivered=commit(one);assert.equal(delivered.state,'fulfilled');
  const failed=commit(two);assert.equal(failed.state,'refund_required');
  const refund={preparationId:failed.preparationId,fingerprint:failed.fingerprint,refundReceipt:x.proof(failed,'refund')};matches('ConfirmExternalCompensation',refund);
  const compensated=x.framework.confirmExternalCompensation(provider,refund);matches('ExternalPurchaseProjection',compensated);assert.equal(compensated.state,'compensated');
  const cancelled=prepare('cancel');const cancel={preparationId:cancelled.preparationId,fingerprint:cancelled.fingerprint,noDebitReceipt:x.proof(cancelled,'no_debit')};matches('CancelExternalPurchase',cancel);
  matches('ExternalPurchaseProjection',x.framework.cancelExternalPurchase(provider,cancel));
  const pending=prepare('pending');
  matches('ExternalPurchasePage',x.framework.pendingExternalPurchases(provider,{providerId,limit:1}));
  for(const row of [pending,delivered,failed,compensated]){
    const owner=x.framework.externalPurchaseStatus({userId:row.terms.userId},{preparationId:row.preparationId});matches('ExternalPurchaseProjection',owner);
    assert.equal(owner.debitReference,undefined);
    for(const field of ['snapshot','completionBytes','proofHashes','proofReferences','code'])assert.equal(owner[field],undefined);
  }
  assert.equal(validate('ExternalPurchaseProjection')({...pending,snapshot:{catalog:{}}}),false);
  const broken={...delivered};delete broken.purchase;assert.equal(validate('ExternalPurchaseProjection')(broken),false);
  assert.equal(validate('ExternalPurchaseProjection')({...pending,purchase:delivered.purchase}),false);
  assert(x.framework.audit(admin).ok);
});

test('legacy quote permits only the historical missing administration revision and retains exact payment proof',()=>{
  const x=setup(),request=x.input('legacy');delete request.quote.adminRevision;
  const canonical={...request,quote:{...request.quote,adminRevision:0}};
  const row={preparationId:externalPurchaseId(providerId,'legacy'),fingerprint:externalPurchaseFingerprint(canonical),terms:canonical};
  const input={...request,purchaseKey:'old-command',debitReceipt:x.proof(row,'debit')};
  matches('ReconcileLegacyExternalPurchase',input);
  assert.equal(validate('PrepareExternalPurchase')(request),false);
  assert.equal(validate('ReconcileLegacyExternalPurchase')({...input,quote:{...input.quote,otherRevision:0}}),false);
  const result=x.framework.reconcileLegacyExternalPurchase(provider,input);matches('ExternalPurchaseProjection',result);assert.equal(result.state,'fulfilled');
});

test('Unicode identifiers and public canonical helpers match independently specified fingerprints',()=>{
  const intent={providerId:'wallet',transactionId:'order-1',userId:'collector',externalCurrency:'points',externalUnits:'25',quote:{productId:'starter',quantity:1,productRevision:2,catalogVersion:3,adminRevision:0,price:{currencyId:'credit',amount:25}}};
  assert.equal(externalPurchaseFingerprint(intent),'22dbe9a3bc27b6530c8937ad1075e265db09e9cdb74022cf88d0694df1f490c1');
  assert.equal(externalPurchaseId('wallet','order-1'),'ep_2c980abbe540231d94dc8489227c6561c7778b772c73b64b9c737720e796217d');
  const unicode={key:'unicode',...intent,transactionId:'🃏'.repeat(128)};
  matches('PrepareExternalPurchase',unicode);assert.equal(typeof externalPurchaseFingerprint(unicode),'string');
  const separated={...unicode,transactionId:'\u2028order'};matches('PrepareExternalPurchase',separated);assert.equal(typeof externalPurchaseFingerprint(separated),'string');
  assert.equal(validate('PrepareExternalPurchase')({...unicode,transactionId:'🃏'.repeat(129)}),false);
  assert.throws(()=>externalPurchaseFingerprint({...unicode,transactionId:'🃏'.repeat(129)}),error=>error.code==='INVALID_INPUT');
  assert.notEqual(externalPurchaseFingerprint({...intent,userId:'é'}),externalPurchaseFingerprint({...intent,userId:'e\u0301'}));
});

test('explicit legacy resolution schemas retain the original terms and recorded operator decision',()=>{
  const x=setup(),user=x.framework.registerUser(admin,{provider:'test',subject:'legacy-zero',displayName:'Legacy collector'}),player={userId:user.id};
  const intent=x.input('spent',player),row={fingerprint:externalPurchaseFingerprint(intent),terms:intent};
  x.framework.settleExternalCredit(provider,{providerId,transactionId:intent.transactionId,userId:user.id,currencyId:intent.quote.price.currencyId,amount:intent.quote.price.amount,externalCurrency:intent.externalCurrency,externalUnits:intent.externalUnits});
  const delivered=x.framework.purchase(player,{...intent.quote,key:'earlier-purchase'});
  const quarantined=x.framework.reconcileLegacyExternalPurchase(provider,{...intent,purchaseKey:'original-command',debitReceipt:x.proof(row,'debit')});
  matches('ExternalPurchaseProjection',quarantined);assert.equal(quarantined.state,'quarantined');
  const input={preparationId:quarantined.preparationId,fingerprint:quarantined.fingerprint,key:'record-decision',reason:'Adopt the verified earlier purchase',decision:{kind:'adopt_purchase',purchaseKey:'earlier-purchase'}};
  matches('ResolveLegacyExternalPurchase',input);
  assert.equal(validate('ResolveLegacyExternalPurchase')({...input,actor:{role:'admin'}}),false);
  const operator={...provider,id:'maintenance-operator',permissions:[...provider.permissions,'maintenance.run']};
  const resolved=x.framework.resolveLegacyExternalPurchase(operator,input);matches('ExternalPurchaseProjection',resolved);
  matches('ExternalLegacyResolution',resolved.legacyResolution);
  assert.deepEqual(resolved.terms,quarantined.terms);assert.deepEqual(resolved.legacyResolution.adoptedQuote,intent.quote);
  assert.equal(resolved.purchase.id,delivered.id);assert.equal(resolved.legacyResolution.actorId,operator.id);
  assert.deepEqual(x.framework.resolveLegacyExternalPurchase(operator,input),resolved);
  assert.equal(validate('ExternalPurchaseProjection')({...quarantined,legacyResolution:resolved.legacyResolution}),false);
});

test('OpenAPI provides external schemas without exposing trusted payment mutations as HTTP routes',()=>{
  for(const name of Object.keys(externalPurchaseSchema.$defs))assert(openapi.components.schemas[name]);
  const operations=Object.values(openapi.paths).flatMap(path=>Object.values(path).map(operation=>operation.operationId));
  for(const method of ['prepareExternalPurchase','commitExternalPurchase','cancelExternalPurchase','confirmExternalCompensation','reconcileLegacyExternalPurchase','resolveLegacyExternalPurchase'])assert.equal(operations.includes(method),false);
});
