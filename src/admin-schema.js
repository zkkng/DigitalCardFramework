const id={type:'string',minLength:1,maxLength:100};
const revision={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const boolean={type:'boolean'};
const ref=name=>({$ref:'#/components/schemas/'+name});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const flags=names=>object(Object.fromEntries(names.map(name=>[name,boolean])),[]);
const base={key:{type:'string',minLength:1,maxLength:128},expectedRevision:revision,reason:{type:'string',minLength:1,maxLength:500}};
const scope=(name,changes)=>object({...base,scope:{const:name},...(name==='site'?{}:{targetId:id}),changes},[...Object.keys(base),'scope','changes',...(name==='site'?[]:['targetId'])]);
const cards=(action,fields)=>object({...base,userId:id,action:{const:action},...fields});
const site=flags(['packPurchasesPaused','tradingPaused','playerShopsPaused']);
site.properties.playerShopsEnabled={type:['boolean','null']};
const user=flags(['tradingBlocked','sellingBlocked','buyingBlocked']);
const product=object({
  priceAmount:{type:['integer','null'],minimum:1,maximum:1000000000},
  discountPercent:{type:'integer',minimum:0,maximum:99},
  rarityWeights:{type:['object','null'],maxProperties:100,additionalProperties:{type:'integer',minimum:0,maximum:1000}}
},[]);
export const adminDefinitions={
  AdminSiteChanges:site,
  AdminUserChanges:user,
  AdminProductChanges:product,
  AdminSettingsCommand:{oneOf:[scope('site',{...ref('AdminSiteChanges')}),scope('line',flags(['salesPaused'])),scope('product',ref('AdminProductChanges')),scope('user',ref('AdminUserChanges'))]},
  AdminCardsCommand:{oneOf:[cards('give',{variantId:id,quantity:{type:'integer',minimum:1,maximum:100}}),cards('remove',{copyIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id}})]},
  AdminChange:{type:'object',required:['id','at','scope','reason','before','after'],properties:{id,at:{type:'string'},actorId:{type:['string','null']},scope:{type:'string'},targetId:{type:['string','null']},reason:base.reason,before:{},after:{}}},
  AdminMutation:{type:'object',required:['revision','change'],properties:{revision,change:ref('AdminChange'),cards:{type:'array',items:{type:'object'}}}},
  AdminUser:{type:'object',required:['id','name'],properties:{id,name:{type:'string'},createdAt:{type:'string'},restrictions:ref('AdminUserChanges')}},
  AdminOverview:{type:'object',required:['revision','site','lines','variants','currencies','counts'],properties:{revision,site:ref('AdminSiteChanges'),lines:{type:'array',items:{type:'object'}},variants:{type:'array',items:{type:'object'}},currencies:{type:'array',items:{type:'object'}},counts:{type:'object'},permissions:{type:'object'}}},
  AdminUserDetail:{type:'object',required:['revision','user','inventory'],properties:{revision,user:ref('AdminUser'),inventory:ref('Page')}}
};
