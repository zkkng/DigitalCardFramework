import test from 'node:test';
import assert from 'node:assert/strict';
import { CardFramework, MemoryStore } from '../src/index.js';
import { auditState } from '../src/audit.js';
import { externalPurchaseDigest, externalPurchaseFingerprint } from '../src/external-purchases.js';
import { fixture, admin } from './helpers.js';

function setup(){
  const store=new MemoryStore(),x=fixture({store});
  const providerId='example.wallet',actor={...admin,settlementProviderId:providerId};
  const core=new CardFramework({store,random:()=>0,clock:()=> '2026-10-03T12:00:00.000Z',bindings:{'demo.code':()=>({code:'EXAMPLE-CODE'})},externalPurchaseProviders:{[providerId]:{validateIntent:()=>true,verifyProof:()=>true}}});
  let sequence=0;
  function prepare(productId='common'){
    const transactionId='payment-'+(++sequence),quote=core.quote(x.alice,{productId});
    const input={key:transactionId,providerId,transactionId,userId:x.alice.userId,externalCurrency:'POINTS',externalUnits:String(quote.price.amount),quote};
    return core.prepareExternalPurchase(actor,input);
  }
  function proof(row,kind){
    const {providerId,transactionId,userId,externalCurrency,externalUnits}=row.terms;
    return {kind,reference:transactionId+'-'+kind,providerId,transactionId,userId,externalCurrency,externalUnits,fingerprint:row.fingerprint,...(kind==='refund'?{compensationId:row.compensationId,debitReference:row.debitReference}:{})};
  }
  function commit(row){return core.commitExternalPurchase(actor,{preparationId:row.preparationId,fingerprint:row.fingerprint,debitReceipt:proof(row,'debit')});}
  function fails(mutate,expected){const state=store.read(s=>s);mutate(state);const report=auditState(state);assert.equal(report.ok,false);assert(report.issues.some(i=>i.code===expected),JSON.stringify(report.issues));}
  return {store,core,x,actor,prepare,proof,commit,fails};
}

test('audit checks prepared external identities, completion reservations and reciprocal key indexes',()=>{
  const t=setup();
  try{
    const row=t.prepare(),id=row.preparationId;assert.equal(t.core.audit(admin).ok,true);
    t.fails(s=>{s.externalPurchases[id].fingerprint='0'.repeat(64);},'EXTERNAL_IDENTITY_INVALID');
    t.fails(s=>{s.externalPurchases[id].completionBytes=0;},'EXTERNAL_RESERVATION_INVALID');
    t.fails(s=>{s.externalPurchases[id].snapshot.product.price.amount++;},'EXTERNAL_SNAPSHOT_INVALID');
    t.fails(s=>{s.externalPurchaseKeys={};},'EXTERNAL_KEY_MISSING');
    t.fails(s=>{Object.values(s.externalPurchaseKeys)[0].preparationId='missing';},'EXTERNAL_KEY_INVALID');
  }finally{t.core.close();}
});

test('audit accepts externally funded delivery without internal credits and rejects broken proof or delivery links',()=>{
  const t=setup();
  try{
    const row=t.commit(t.prepare()),id=row.preparationId;
    assert.equal(row.state,'fulfilled');assert.equal(t.core.wallet(t.x.alice).credits,10000);assert.equal(t.core.audit(admin).ok,true);
    t.fails(s=>{s.externalPurchaseProofs={};},'EXTERNAL_PROOF_MISSING');
    t.fails(s=>{s.externalPurchases[id].debitReference='another-receipt';},'EXTERNAL_DEBIT_INVALID');
    t.fails(s=>{s.externalPurchases[id].proofReferences.debit='different-proof';},'EXTERNAL_PROOF_REFERENCE_INVALID');
    t.fails(s=>{delete s.externalPurchases[id].purchase.paid;},'EXTERNAL_PURCHASE_INVALID');
    t.fails(s=>{s.externalPurchases[id].state='compensated';},'EXTERNAL_DELIVERY_STATE_INVALID');
    t.fails(s=>{delete s.packs[row.purchase.packs[0].id];},'EXTERNAL_PACK_INVALID');
    t.fails(s=>{Object.values(s.copies)[0].source.externalPreparationId='missing';},'EXTERNAL_COPY_INVALID');
    const second=t.commit(t.prepare());
    t.fails(s=>{s.externalPurchases[second.preparationId].purchase=s.externalPurchases[id].purchase;},'EXTERNAL_DELIVERY_DUPLICATE');
  }finally{t.core.close();}
});

test('audit distinguishes cancellation, refund-required and confirmed compensation without delivery',()=>{
  const t=setup();
  try{
    const cancelled=t.prepare();
    t.core.cancelExternalPurchase(t.actor,{preparationId:cancelled.preparationId,fingerprint:cancelled.fingerprint,noDebitReceipt:t.proof(cancelled,'no_debit')});
    assert.equal(t.core.audit(admin).ok,true);
    const pendingRefund=t.prepare('unique');
    t.x.buy('unique');
    const refund=t.commit(pendingRefund);
    assert.equal(refund.state,'refund_required');assert.equal(t.core.audit(admin).ok,true);
    t.fails(s=>{s.externalPurchases[refund.preparationId].compensationId='wrong';},'EXTERNAL_COMPENSATION_INVALID');
    t.core.confirmExternalCompensation(t.actor,{preparationId:refund.preparationId,fingerprint:refund.fingerprint,refundReceipt:t.proof(refund,'refund')});
    assert.equal(t.core.audit(admin).ok,true);
    t.fails(s=>{s.externalPurchases[refund.preparationId].proofReferences.refund='different-refund';},'EXTERNAL_PROOF_REFERENCE_INVALID');
    t.fails(s=>{const key=Object.keys(s.externalPurchaseProofs).find(k=>s.externalPurchaseProofs[k].kind==='refund');delete s.externalPurchaseProofs[key];},'EXTERNAL_PROOF_MISSING');
  }finally{t.core.close();}
});

test('audit uses the same Unicode reference length as the external proof contract',()=>{
  const t=setup();
  try{
    const prepared=t.prepare();
    t.core.commitExternalPurchase(t.actor,{preparationId:prepared.preparationId,fingerprint:prepared.fingerprint,debitReceipt:{...t.proof(prepared,'debit'),reference:'\u{1f39f}'.repeat(128)}});
    assert.equal(t.core.audit(admin).ok,true);
    const another=t.prepare();
    assert.throws(()=>t.core.commitExternalPurchase(t.actor,{preparationId:another.preparationId,fingerprint:another.fingerprint,debitReceipt:{...t.proof(another,'debit'),reference:'\u{1f39f}'.repeat(129)}}),error=>error.code==='INVALID_INPUT');
  }finally{t.core.close();}
});

test('audit verifies attributed legacy resolution against its receipt, original funding and retained delivery',()=>{
  const t=setup();
  try{
    const user=t.core.registerUser(admin,{provider:'test',subject:'unfunded',displayName:'Collector'}),collector={userId:user.id};
    const providerId=t.actor.settlementProviderId,quote=t.core.quote(collector,{productId:'common'});
    const intent={key:'legacy-funded',providerId,transactionId:'legacy-funded',userId:user.id,externalCurrency:'POINTS',externalUnits:'10',quote};
    t.core.settleExternalCredit(admin,{providerId,transactionId:intent.transactionId,userId:user.id,currencyId:'credits',amount:10,externalCurrency:'POINTS',externalUnits:'10'});
    const alternate=t.core.purchase(collector,{...quote,key:'alternate'}),proof=t.proof({terms:intent,fingerprint:externalPurchaseFingerprint(intent)},'debit');
    const quarantined=t.core.reconcileLegacyExternalPurchase(t.actor,{...intent,purchaseKey:'original',debitReceipt:proof});
    assert.equal(t.core.audit(admin).ok,true);
    t.fails(s=>{s.externalPurchases[quarantined.preparationId].completionRequests=0;},'EXTERNAL_RESOLUTION_RESERVATION_INVALID');
    t.fails(s=>{s.externalPurchases[quarantined.preparationId].legacy.resolutionPurchaseKey='missing';},'EXTERNAL_RESOLUTION_PURCHASE_INVALID');
    t.fails(s=>{s.requests[user.id+':alternate'].result.packs=[];},'EXTERNAL_RESOLUTION_PURCHASE_INVALID');
    t.fails(s=>{s.externalPurchases[quarantined.preparationId].purchase=alternate;},'EXTERNAL_DELIVERY_STATE_INVALID');
    const operator={...t.actor,id:'operator-one',permissions:['currency.settle','maintenance.run']};
    const input={preparationId:quarantined.preparationId,fingerprint:quarantined.fingerprint,key:'resolve-one',reason:'Original payment funded the retained purchase',decision:{kind:'adopt_purchase',purchaseKey:'alternate'}};
    const resolved=t.core.resolveLegacyExternalPurchase(operator,input),id=resolved.preparationId;
    assert.equal(t.core.audit(admin).ok,true);
    const token='external-resolution:'+externalPurchaseDigest({providerId,actorId:operator.id,key:input.key});
    t.fails(s=>{s.externalPurchases[id].legacyResolution.actorId='other';},'EXTERNAL_RESOLUTION_RECEIPT_INVALID');
    t.fails(s=>{s.externalPurchases[id].legacyResolution.adoptedQuote.price.amount++;},'EXTERNAL_RESOLUTION_INVALID');
    t.fails(s=>{delete s.externalPurchases[id].legacyResolution;},'EXTERNAL_RESOLUTION_MISSING');
    t.fails(s=>{s.externalPurchases[id].completionRequests=1;},'EXTERNAL_RESOLUTION_RESERVATION_INVALID');
    t.fails(s=>{delete s.operatorRequests[token];},'EXTERNAL_RESOLUTION_RECEIPT_INVALID');
    t.fails(s=>{s.operatorRequests[token].hash='0'.repeat(64);},'EXTERNAL_RESOLUTION_RECEIPT_INVALID');
    t.fails(s=>{s.operatorRequests[token].result.purchase.packs=[];},'EXTERNAL_RESOLUTION_RECEIPT_INVALID');
    t.fails(s=>{s.requests[user.id+':alternate'].hash='0'.repeat(64);},'EXTERNAL_RESOLUTION_PURCHASE_INVALID');
    t.fails(s=>{s.requests[user.id+':duplicate']=s.requests[user.id+':alternate'];},'EXTERNAL_RESOLUTION_PURCHASE_INVALID');
    t.fails(s=>{s.ledger.find(row=>row.type==='external-credit'&&row.userId===user.id).balance++;},'EXTERNAL_RESOLUTION_FUNDING_INVALID');
    t.fails(s=>{Object.values(s.externalSettlements)[0].result.balance++;},'SETTLEMENT_LEDGER_MISMATCH');
    t.fails(s=>{s.packs[alternate.packs[0].id].product.price.amount++;},'EXTERNAL_RESOLUTION_DELIVERY_INVALID');
    t.fails(s=>{s.copies[s.packs[alternate.packs[0].id].copyIds[0]].source.purchaseId='missing';},'EXTERNAL_RESOLUTION_DELIVERY_INVALID');
    t.core.openPack(collector,{packId:alternate.packs[0].id,key:'open-retained'});
    assert.equal(t.core.audit(admin).ok,true,'An opened retained pack remains valid');
  }finally{t.core.close();}
});
