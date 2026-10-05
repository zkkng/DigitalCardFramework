/** JSON Schema definitions for trusted host methods; these are not public HTTP endpoints. */
export function externalPurchaseDefinitions(prefix = '#/$defs/') {
  const ref = name => ({$ref: prefix + name});
  const id = {type:'string',minLength:1,maxLength:128,pattern:'^(?=[\\s\\S]*\\S)[^\\u0000-\\u001f\\u007f]+$'};
  const integer = minimum => ({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER});
  const hash = {type:'string',pattern:'^[a-f0-9]{64}$'};
  const preparationId = {type:'string',pattern:'^ep_[a-f0-9]{64}$'};
  const compensationId = {type:'string',pattern:'^ec_[a-f0-9]{64}$'};
  const object = (properties, required = Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
  const terms = {providerId:id,transactionId:id,userId:id,externalCurrency:id,externalUnits:{type:'string',pattern:'^[1-9][0-9]{0,39}$'},quote:ref('ExternalPurchaseQuote')};
  const proof = {reference:id,providerId:id,transactionId:id,userId:id,externalCurrency:id,externalUnits:terms.externalUnits,fingerprint:hash};
  const command = {preparationId,fingerprint:hash};
  const timestamp = {type:'string',maxLength:32,description:'Parseable timestamp returned by the trusted host clock.'};
  return {
    ExternalPurchasePrice:object({currencyId:id,amount:integer(1)}),
    ExternalPurchaseQuote:object({productId:id,quantity:{type:'integer',minimum:1,maximum:100},productRevision:integer(0),catalogVersion:integer(0),adminRevision:integer(0),price:ref('ExternalPurchasePrice')}),
    ExternalPurchaseIntent:object({version:{const:1},...terms}),
    PrepareExternalPurchase:object({key:id,...terms}),
    ExternalDebitProof:object({kind:{const:'debit'},...proof}),
    ExternalNoDebitProof:object({kind:{const:'no_debit'},...proof}),
    ExternalRefundProof:object({kind:{const:'refund'},...proof,compensationId,debitReference:id}),
    CommitExternalPurchase:object({...command,debitReceipt:ref('ExternalDebitProof')}),
    CancelExternalPurchase:object({...command,noDebitReceipt:ref('ExternalNoDebitProof')}),
    ConfirmExternalCompensation:object({...command,refundReceipt:ref('ExternalRefundProof')}),
    ExternalPurchaseStatus:object({preparationId}),
    LookupExternalPurchase:object({providerId:id,transactionId:id}),
    PendingExternalPurchases:object({providerId:id,after:{oneOf:[preparationId,{type:'null'},{const:''}]},limit:{type:'integer',minimum:1,maximum:100}},['providerId']),
    ReconcileLegacyExternalPurchase:object({key:id,...terms,quote:object({productId:id,quantity:{type:'integer',minimum:1,maximum:100},productRevision:integer(0),catalogVersion:integer(0),adminRevision:integer(0),price:ref('ExternalPurchasePrice')},['productId','quantity','productRevision','catalogVersion','price']),purchaseKey:id,debitReceipt:ref('ExternalDebitProof')}),
    ExternalLegacyDecision:object({kind:{const:'adopt_purchase'},purchaseKey:id}),
    ResolveLegacyExternalPurchase:object({...command,key:id,reason:{...id,maxLength:500},decision:ref('ExternalLegacyDecision')}),
    ExternalLegacyResolution:object({key:id,actorId:id,reason:{...id,maxLength:500},decision:ref('ExternalLegacyDecision'),purchaseId:id,adoptedQuote:ref('ExternalPurchaseQuote'),at:timestamp}),
    ExternalPurchaseReceipt:object({id,packs:{type:'array',minItems:1,maxItems:100,items:ref('ExternalPurchasePack')},paid:ref('ExternalPurchasePrice')}),
    ExternalPurchasePack:object({id,ownerId:id,productId:id,productRevision:integer(0),lineId:id,catalogVersion:integer(0),product:{type:'object'},purchaseId:{oneOf:[id,{type:'null'}]},batchIndex:integer(0),metadata:{type:'object'},createdAt:timestamp,openedAt:{oneOf:[timestamp,{type:'null'}]},cardCount:integer(0)}),
    ExternalPurchaseProjection:{
      ...object({preparationId,fingerprint:hash,state:{enum:['prepared','fulfilled','refund_required','cancelled','compensated','quarantined']},terms:ref('ExternalPurchaseIntent'),preparedAt:timestamp,fulfilledAt:timestamp,purchase:ref('ExternalPurchaseReceipt'),failureCode:{type:'string',pattern:'^[A-Z0-9_]{1,64}$'},compensationId,refundRequiredAt:timestamp,cancelledAt:timestamp,compensatedAt:timestamp,quarantinedAt:timestamp,legacyResolution:ref('ExternalLegacyResolution'),debitReference:id},['preparationId','fingerprint','state','terms','preparedAt']),
      allOf:[
        {if:{properties:{state:{const:'fulfilled'}}},then:{required:['fulfilledAt','purchase']},else:{not:{required:['purchase']}}},
        {if:{properties:{state:{enum:['refund_required','compensated']}}},then:{required:['failureCode','compensationId','refundRequiredAt']}},
        {if:{required:['legacyResolution']},then:{properties:{state:{const:'fulfilled'}},required:['quarantinedAt','failureCode']}},
        ...[['cancelled','cancelledAt'],['compensated','compensatedAt'],['quarantined','quarantinedAt']].map(([state,field])=>({if:{properties:{state:{const:state}}},then:{required:[field]}}))
      ]
    },
    ExternalPurchasePage:object({items:{type:'array',maxItems:100,items:ref('ExternalPurchaseProjection')},nextCursor:{oneOf:[preparationId,{type:'null'}]}})
  };
}

export const externalPurchaseSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'urn:digital-card:external-purchases:v1',
  $defs:externalPurchaseDefinitions()
};
