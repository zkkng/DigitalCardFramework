const id={type:'string',minLength:1};
const boolean={type:'boolean'};
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const time={type:'string',format:'date-time'};
const ref=name=>({$ref:'#/components/schemas/'+name});
const object=(properties,required=Object.keys(properties),additionalProperties=false)=>({type:'object',required,properties,additionalProperties});
const list=items=>({type:'array',items});
const page=items=>object({items:{...list(items),maxItems:200},total:integer,next:{type:['string','null']}});
const flags=keys=>object(Object.fromEntries(keys.map(key=>[key,boolean])));
const tradeOffer=object({copyIds:{...list(id),maxItems:1000,uniqueItems:true},currencies:{...list(ref('Money')),maxItems:100}});
const adminSite=object({packPurchasesPaused:boolean,tradingPaused:boolean,playerShopsPaused:boolean,playerShopsEnabled:{type:['boolean','null']}});
const adminRestrictions=flags(['tradingBlocked','sellingBlocked','buyingBlocked']);
const productChanges=object({priceAmount:{type:['integer','null'],minimum:1,maximum:Number.MAX_SAFE_INTEGER},discountPercent:{type:'integer',minimum:0,maximum:99},rarityWeights:{type:['object','null'],additionalProperties:integer}});
const changeBase={id,at:time,createdAt:time,actorId:id,targetId:{type:['string','null']},reason:{type:'string',minLength:1,maxLength:500},actorName:{type:'string'},targetName:{type:'string'}};
const change=(scope,before,after=before)=>{const properties={...changeBase,scope:{const:scope},before,after};return object(properties,Object.keys(properties).filter(key=>!['actorName','targetName'].includes(key)));};

export const readModelDefinitions={
  CardDefinitionView:object({id,lineId:id,name:{type:'string'},type:id,tags:list({type:'string'}),behavior:flags(['collectionDefault','albumDefault','albumEligible','tradable','tradeUp']),metadata:{type:'object'},stats:{type:'object'},presentation:{type:'object'}},['id','lineId','name','type','tags','behavior','metadata'],true),
  CardVariantView:object({id,cardId:id,rarityId:id,enabled:boolean,supplyLimit:{...integer,minimum:1},metadata:{type:'object'},stats:{type:'object'},codes:list(ref('CodeAttachment')),onOpen:list(ref('OpeningAction')),presentation:{type:'object'}},['id','cardId','rarityId','metadata'],true),
  CardBindingView:object({visibility:{enum:['public','owner']},transfer:{enum:['follow','retain','block']},holderId:id,state:{enum:['active','used']},data:{type:'object'},usedAt:time},['visibility','transfer','holderId','state','data']),
  InventoryCopy:{allOf:[ref('Copy'),object({state:{const:'owned'},version:{...integer,minimum:1},createdAt:time,acquiredAt:time,tradable:boolean,untradableReason:{type:['string','null']}},undefined,true)]},
  InventoryPage:page(ref('InventoryCopy')),
  TradeInventoryPage:object({items:{...list(ref('InventoryCopy')),maxItems:200},total:integer,next:{type:['string','null']},owner:object({id,name:{type:'string'}})}),
  TradeOffer:tradeOffer,
  Trade:object({id,fromUserId:id,toUserId:id,give:ref('TradeOffer'),receive:ref('TradeOffer'),status:{enum:['pending','accepted','cancelled','declined','expired','countered']},createdAt:time,expiresAt:time,message:{type:'string',maxLength:500},snapshots:{type:'object',additionalProperties:ref('Copy')},parentTradeId:{type:['string','null']},digest:{type:'string',pattern:'^[a-f0-9]{64}$'},completedAt:time,counterTradeId:id,fromName:{type:'string'},toName:{type:'string'}},['id','fromUserId','toUserId','give','receive','status','createdAt','expiresAt','message','snapshots','parentTradeId','digest']),
  AdminUser:object({id,name:{type:'string'},displayName:{type:'string'},createdAt:time,restrictions:adminRestrictions,cardCount:integer,packCount:integer}),
  AdminUsersPage:page(ref('AdminUser')),
  AdminCopy:object({id,copyId:id,name:{type:'string'},cardId:id,variantId:id,lineId:id,rarityId:id,state:{enum:['sealed','owned','consumed']},createdAt:time,version:{...integer,minimum:1},serialNumber:{type:['integer','null'],minimum:1,maximum:Number.MAX_SAFE_INTEGER},locked:boolean,removable:boolean,canRemove:boolean,blockedReason:{type:['string','null']}}),
  AdminInventoryPage:page(ref('AdminCopy')),
  AdminUserDetail:object({revision:integer,user:ref('AdminUser'),inventory:ref('AdminInventoryPage')}),
  AdminChange:{oneOf:[change('site',adminSite),change('line',flags(['salesPaused'])),change('product',productChanges),change('user',adminRestrictions),change('cards',object({action:{enum:['give','remove']},quantity:{...integer,minimum:1}}),object({action:{enum:['give','remove']},copyIds:list(id),variantId:{type:['string','null']}}))]},
  AdminHistoryPage:page(ref('AdminChange')),
  AdminMutation:object({revision:integer,change:ref('AdminChange'),cards:list(ref('AdminCopy'))},['revision','change']),
  AdminVariant:object({id,cardId:id,name:{type:'string'},lineId:id,rarityId:id,enabled:boolean,remaining:{type:['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER}}),
  AdminSlotOdds:object({slotId:id,count:{...integer,minimum:1},rarities:list(object({rarityId:id,weight:integer,percent:{type:'number',minimum:0,maximum:100}}))}),
  AdminProduct:object({id,lineId:id,name:{type:'string'},revision:{...integer,minimum:1},price:ref('Money'),enabled:boolean,adminRevision:integer,...productChanges.properties,basePrice:ref('Money'),baseSlots:list(ref('PackSlot')),catalogEnabled:boolean,slotOdds:list(ref('AdminSlotOdds'))},undefined,true),
  AdminLine:object({id,name:{type:'string'},salesPaused:boolean,products:list(ref('AdminProduct'))},undefined,true),
  AdminCurrency:object({id,name:{type:'string'},tradable:boolean},['id','name'],true),
  AdminRarity:object({id,name:{type:'string'},rank:integer},undefined,true),
  AdminOverview:object({revision:integer,permissions:flags(['read','manage','cards']),site:adminSite,baseFeatures:{type:'object',additionalProperties:boolean},effective:flags(['directTrading','playerShops','commerceEnabled','tradingPolicyEnabled']),lines:list(ref('AdminLine')),variants:list(ref('AdminVariant')),rarities:list(ref('AdminRarity')),currencies:list(ref('AdminCurrency')),counts:object(Object.fromEntries(['users','cards','packs','activeTrades','activeListings'].map(key=>[key,integer])))}),
};
