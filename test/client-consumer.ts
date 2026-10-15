import {createClient,createCommandRunner,createRevealController} from '@digital-card/framework/client';
import {createAdminController} from '@digital-card/framework/admin-client';
const client=createClient();
const storage:Storage=globalThis.sessionStorage;
const runner=createCommandRunner({client,storage,namespace:'account'});
async function recoverPurchase(){
  const quote=await client.quote({productId:'sample'});
  const allocation=await client.allocationStatus({productId:'sample'});
  const resolved:boolean=await runner.confirmFailed('purchase',quote);
  if(allocation.attemptId&&allocation.state==='stale')await client.acknowledgeAllocation({attemptId:allocation.attemptId});
  void resolved;
  const purchase=await runner('purchase',quote);
  const packId:string=purchase.packs[0]!.id;
  const recovered=await runner.recover('purchase',quote);
  const paid:number=recovered.paid.amount;
  const copies=await client.inventoryPage({limit:50});
  const title:string=copies.items[0]!.definition.name;
  return {packId,paid,title};
}
void recoverPurchase;
const reveal=createRevealController({open:client.openPack});
reveal.subscribe(state=>{const cards:number=state.receipt?.cards.length??0;void cards;});
const admin=createAdminController({client,storage,namespace:'operator'});
admin.stage({input:{scope:'site',reason:'Configuration update',changes:{packPurchasesPaused:false}},title:'Site controls',changes:[{label:'Purchases',before:'Paused',after:'Allowed'}]});
admin.stage({command:'administerCards',input:{action:'give',userId:'account',variantId:'variant',quantity:1,reason:'Collection award'},title:'Award',changes:[{label:'Copies',before:'0',after:'1'}]});
admin.subscribe(state=>{const count:number=state.overview?.counts.cards??0;void count;});
// @ts-expect-error command input preserves the reviewed revision requirements
void runner('purchase',{productId:'sample',quantity:1});
// @ts-expect-error arbitrary SDK operation names cannot become durable commands
void runner('quote',{productId:'sample'});
// @ts-expect-error admin user detail requires an account ID
void client.adminUser({limit:50});
// @ts-expect-error card administration uses its own draft fields
admin.stage({command:'administerCards',input:{scope:'site',reason:'Configuration update',changes:{}},title:'Cards',changes:[]});
// @ts-expect-error receipts expose integer amounts as numbers
const amount:Promise<string>=client.purchase({key:'key',productId:'sample',quantity:1,productRevision:1,catalogVersion:1}).then(result=>result.paid.amount);
void amount;

async function createReviewedStock(shopId:string){
  const quote=await client.quoteMintPackStock({shopId,productId:'sample',quantity:2});
  const status=await client.stockAllocationStatus({shopId,productId:'sample'});
  const originatingCommand:'purchase'|'createListing'|'commitExternalPurchase'|null=status.command;
  void originatingCommand;
  return runner('createListing',{shopId,title:'Sealed packs',price:{currencyId:'credits',amount:10},items:{kind:'mint-pack',productId:quote.productId,quantity:quote.quantity},allocationDigest:quote.allocationDigest});
}
void createReviewedStock;

import {createCodeRevealController,renderCodeReveal,renderCodeHistory,type CodeRevealState,type CodeHistoryView} from '@digital-card/framework/code-ui';
const codeController=createCodeRevealController({codeId:'code',reveal:client.revealCode,key:client.requestKey});
const codeSnapshot:CodeRevealState=codeController.getState();
const codeUnsubscribe=codeController.subscribe(state=>{
  if(state.phase==='revealed'){const secret:string=state.code;const error:null=state.error;void [secret,error];}
  else if(state.phase==='error'){const message:string=state.error;const diagnosticCode:string|undefined=state.diagnostic.code;const diagnosticName:string|undefined=state.diagnostic.name;void [message,diagnosticCode,diagnosticName];}
  else {const code:null=state.code;void code;}
});
const codeUnsubscribed:boolean=codeUnsubscribe();
const codeOpened:Promise<string|undefined>=codeController.open();
codeController.dispose();
createCodeRevealController({codeId:'code',reveal:input=>{const id:string=input.codeId;const key:string=input.key;void [id,key];return {code:'example'};}});
const codeReveal=renderCodeReveal({codeId:'code',mode:'scratch'},{reveal:client.revealCode,threshold:0.5,locale:'en',messages:{'codes.reveal':'Show code'},isCurrent:()=>true});
const codeRevealNode:HTMLElement=codeReveal.node;
const codeViewOpen:Promise<string|undefined>=codeReveal.controller.open();
document.body.append(codeRevealNode);codeReveal.dispose();
renderCodeReveal({codeId:'code',mode:'open'},{reveal:client.revealCode}).dispose();
renderCodeReveal({codeId:'code',mode:'peel'},{reveal:client.revealCode}).dispose();
const codeHistory:CodeHistoryView=renderCodeHistory({}, {client});
const codeHistoryReady:Promise<void>=codeHistory.ready;
document.body.append(codeHistory.node);codeHistory.dispose();
renderCodeHistory(null,{client:{codeHistory:client.codeHistory,revealCode:client.revealCode,reportCodeUsage:client.reportCodeUsage,requestKey:client.requestKey},getPrincipal:()=>null,isCurrentModel:captured=>{const model:null=captured;return model===null;},codeRevealRenderer:(input,options)=>{
  const id:string=input.codeId;const mode:'open'|'scratch'|'peel'|undefined=input.mode;const key:string=options.key();const locale:string=options.localization.locale;
  const response=options.reveal({codeId:id,key}),current:boolean=options.isCurrent?.()??true;void [mode,locale,response,current];
  return {node:document.createElement('output'),controller:createCodeRevealController({codeId:id,reveal:options.reveal}),dispose(){}};
}}).dispose();
renderCodeHistory(undefined,{client,codeRevealRenderer:()=>document.createElement('div')}).dispose();
renderCodeHistory({opaque:true},{client,getPrincipal:client.principal,isCurrentModel:captured=>captured.opaque}).dispose();
// @ts-expect-error Retry focus guards return booleans.
renderCodeReveal({codeId:'code'},{reveal:client.revealCode,isCurrent:()=> 'current'});
// @ts-expect-error Account callbacks identify a string principal or explicit logout.
renderCodeHistory(null,{client,getPrincipal:()=>42});
// @ts-expect-error Reveals require a host callback returning the code string.
createCodeRevealController({codeId:'code',reveal:()=>({code:42})});
// @ts-expect-error Reveal keys are generated as strings.
createCodeRevealController({codeId:'code',reveal:client.revealCode,key:()=>42});
// @ts-expect-error Reveal failures or disposal may produce no value.
const guaranteedCode:Promise<string>=codeController.open();
// @ts-expect-error Reveal values are asynchronous.
const immediateCode:string=codeController.open();
// @ts-expect-error Only the revealed phase guarantees a secret string.
const coveredCode:string=codeSnapshot.code;
// @ts-expect-error Cosmetic reveal mode is explicit.
renderCodeReveal({codeId:'code',mode:'flip'},{reveal:client.revealCode});
// @ts-expect-error Reveal thresholds are numeric fractions.
renderCodeReveal({codeId:'code'},{reveal:client.revealCode,threshold:'half'});
// @ts-expect-error Interactive reveal requires a host reveal callback.
renderCodeReveal({codeId:'code'},{});
// @ts-expect-error History needs its client callbacks.
renderCodeHistory({},{});
// @ts-expect-error Custom history reveal renderers return nodes or node wrappers.
renderCodeHistory({}, {client,codeRevealRenderer:()=> 'code'});
// @ts-expect-error History loading completes without exposing raw rows as the result.
const historyRows:Promise<unknown[]>=codeHistory.ready;
void [codeSnapshot,codeUnsubscribed,codeOpened,codeViewOpen,codeHistoryReady,guaranteedCode,immediateCode,coveredCode,historyRows];

import {render3DInspector,renderComparison,type InspectorCopy,type InspectorCatalog,type InspectorRenderingOptions} from '@digital-card/framework/inspector-ui';
import {renderActivity,type ActivityView,type ActivityContext} from '@digital-card/framework/player-ui';
import type {Schemas as UIConsumerSchemas} from '@digital-card/framework/wire-types';
declare const inspectorWireCopy:UIConsumerSchemas['Copy'];
const inspectorPreview={id:'preview:card',cardId:'card',lineId:'sky',rarityId:'common',definition:{name:'Example',description:'Artwork',tags:['sky'],stats:{power:5}},variant:{finish:'foil'},preview:true};
const inspectorCatalog:InspectorCatalog={displayFields:[{path:'stats.power',label:'Power'}],combinations:[{id:'scene',name:'Scene',rows:1,columns:2,gap:0,pieces:[{cardId:'card',row:0,column:0}]}]};
const inspectorElement:HTMLElement=render3DInspector(inspectorPreview,{
  catalog:inspectorCatalog,labels:{line:'Sky',rarity:'Common'},locale:'en',messages:{'inspector.close':'Close'},
  cardRenderer(copy,options){const preview:boolean=copy.preview;const interactive:false=options.interactive;const mode:'interactive'|undefined=options.presentationMode;const locale:string=options.localization.locale;const back:Node|string|undefined=options.backRenderer?.(copy);void [preview,interactive,mode,locale,back];return document.createElement('article');},
  metadataRenderer(copy,options){const preview:boolean=copy.preview;const locale:string=options.localization.locale;void [preview,locale];return document.createElement('dl');},
  backRenderer:copy=>copy.definition.name,
  onClose:event=>{const target:EventTarget|null=event.currentTarget;void target;},
});
const simpleInspectorRenderer:InspectorRenderingOptions<InspectorCopy>['cardRenderer']=()=>document.createElement('article');
const wireInspector:HTMLElement=render3DInspector(inspectorWireCopy,{cardRenderer:simpleInspectorRenderer});
const comparison:HTMLElement=renderComparison([inspectorPreview],{catalog:inspectorCatalog,cardRenderer:simpleInspectorRenderer,onClose:()=>{},locale:'en'});
renderComparison([],{catalog:{},cardRenderer:simpleInspectorRenderer});
document.body.append(inspectorElement,wireInspector,comparison);
// @ts-expect-error Inspector rendering requires a card renderer.
render3DInspector(inspectorPreview,{});
// @ts-expect-error Inspector card renderers return elements directly.
render3DInspector(inspectorPreview,{cardRenderer:()=>({node:document.createElement('div')})});
// @ts-expect-error Comparison reads the host catalog.
renderComparison([inspectorPreview],{cardRenderer:simpleInspectorRenderer});
// @ts-expect-error Combination grid coordinates are numbers.
renderComparison([inspectorPreview],{catalog:{combinations:[{name:'Scene',rows:'1',columns:2,pieces:[]}]},cardRenderer:simpleInspectorRenderer});
// @ts-expect-error Inspector returns a DOM element without a disposal wrapper.
inspectorElement.dispose();
// @ts-expect-error Inspector rendering is synchronous.
const promisedInspector:Promise<HTMLElement>=render3DInspector(inspectorPreview,{cardRenderer:simpleInspectorRenderer});

const activityContext:ActivityContext={client,mutate:runner,action:async(fn,options)=>{const message:string=options.message;void message;return fn();}};
const activityModel={me:{preferences:{inventoryVisibility:'traders' as const,blockedUserIds:['collector']}},catalog:{currencies:[{id:'credits',name:'Credits'}]}};
const activityView:ActivityView=renderActivity(activityModel,activityContext);
const activityNode:HTMLElement=activityView.node;
document.body.append(activityNode);
const activityDisposed:void=activityView.dispose();
renderActivity({me:{},catalog:{currencies:[{id:'credits'}]}},activityContext).dispose();
const activityPreferences:Promise<UIConsumerSchemas['Preferences']>=activityContext.mutate('preferences',{inventoryVisibility:'private'});
const activityRead:Promise<UIConsumerSchemas['NotificationReadReceipt']>=activityContext.mutate('readNotifications',{ids:['notification']});
const activityBinding:Promise<UIConsumerSchemas['BindingUseReceipt']>=activityContext.mutate('consumeBinding',{copyId:'copy',namespace:'reward'});
// @ts-expect-error Activity requires its host callbacks.
renderActivity(activityModel,{client});
// @ts-expect-error The visibility preference has explicit values.
renderActivity({me:{preferences:{inventoryVisibility:'friends'}},catalog:activityModel.catalog},activityContext);
// @ts-expect-error Activity clients return checked ledger entries.
renderActivity(activityModel,{...activityContext,client:{...client,history:async()=>[{delta:'1'}]}});
// @ts-expect-error Activity loading has no exposed readiness promise.
activityView.ready;
// @ts-expect-error Activity returns a lifecycle object synchronously.
const promisedActivity:Promise<ActivityView>=renderActivity(activityModel,activityContext);
// @ts-expect-error Activity host mutations use only its three commands.
activityContext.mutate('purchase',{productId:'sample'});
// @ts-expect-error Binding copy IDs use strings.
activityContext.mutate('consumeBinding',{copyId:42,namespace:'reward'});
// @ts-expect-error Binding consumption identifies its namespace.
activityContext.mutate('consumeBinding',{copyId:'copy'});
void [inspectorElement,wireInspector,comparison,promisedInspector,activityNode,activityDisposed,activityPreferences,activityRead,activityBinding,promisedActivity];

import type {CommandInput as CheckedCommandInput} from '@digital-card/framework/client';
const indexedBindingWithoutKey:CheckedCommandInput<'consumeBinding'>={copyId:'copy',namespace:'reward'};
const indexedBindingWithKey:CheckedCommandInput<'consumeBinding'>={key:'binding-retry',copyId:'copy',namespace:'reward',extension:{source:'example'}};
const indexedRead:CheckedCommandInput<'readNotifications'>={ids:['notice'],extension:true};
const indexedUnion:CheckedCommandInput<'consumeBinding'|'readNotifications'>=indexedRead;
void runner('consumeBinding',indexedBindingWithoutKey);
void runner('consumeBinding',indexedBindingWithKey);
void runner.beginNew('readNotifications',indexedRead);
void runner.recover('consumeBinding',indexedBindingWithKey);
// @ts-expect-error Indexed binding commands retain their required namespace.
void runner('consumeBinding',{copyId:'copy'});
// @ts-expect-error Indexed binding commands retain their required copy ID.
void runner('consumeBinding',{namespace:'reward'});
// @ts-expect-error Known indexed fields retain their declared string types.
void runner('consumeBinding',{copyId:42,namespace:'reward'});
// @ts-expect-error Optionalized keys still require string values.
void runner('consumeBinding',{key:42,copyId:'copy',namespace:'reward'});
// @ts-expect-error Other indexed command schemas retain required fields too.
void runner('readNotifications',{extension:true});
// @ts-expect-error Indexed trade proposals retain both offer sides.
void runner('proposeTrade',{toUserId:'collector'});
// @ts-expect-error Recovery uses the same checked input shape.
void runner.recover('consumeBinding',{copyId:'copy'});
// @ts-expect-error Union inputs require one complete command member.
const incompleteIndexedUnion:CheckedCommandInput<'consumeBinding'|'readNotifications'>={copyId:'copy'};
void [indexedBindingWithoutKey,indexedBindingWithKey,indexedRead,indexedUnion,incompleteIndexedUnion];

import {renderCollection,renderAlbums,type CollectionModel,type CollectionContext,type AlbumsContext,type AlbumsView} from '@digital-card/framework/collection-ui';
import {renderShop,shopProductInformation,type ShopModel,type ShopProduct,type ShopContext,type ShopView} from '@digital-card/framework/shop-ui';
declare const collectionOwned:UIConsumerSchemas['InventoryCopy'] & {displayNote:string};
const collectionModel:CollectionModel<typeof collectionOwned>={me:{preferences:{favoriteCopyIds:['copy'],wishlistCardIds:['card']}},inventory:[collectionOwned],catalog:{version:1,features:{cardTrading:true,tradeUps:true},lines:[{id:'sky',name:'Sky'}],rarities:[{id:'common',name:'Common',rank:1}],cards:[collectionOwned.definition],variants:[{id:'variant',cardId:'card',rarityId:'common',finish:'foil'}],recipes:[{id:'recipe',name:'Combine'}]}};
const collectionContext:CollectionContext<typeof collectionOwned>={
  cardRenderer(copy,options){const id:string=copy.id;const locale:string=options.localization.locale;options.onSelect(copy);void [id,locale];return document.createElement('article');},
  inspect:copy=>{const name:string=copy.definition.name;void name;},
  inspectTogether:copies=>{const originalNote:string|undefined=copies[0]?.displayNote;void originalNote;},
  action:async(fn,options)=>{const message:string=options.message;void message;return fn();},mutate:runner,locale:'en',messages:{'collection.title':'Collection'},
};
const collectionNode:HTMLElement=renderCollection(collectionModel,collectionContext);
const albumState:{selectedAlbumId?:string|null}={selectedAlbumId:null};
const albumsContext:AlbumsContext<typeof collectionOwned>={
  client,mutate:runner,action:collectionContext.action,state:albumState,inspect:copy=>{const id:string=copy.id;void id;},
  cardRenderer:(copy,options)=>{const selected=options?.onSelect;selected?.(copy);return document.createElement('article');},
  albumRenderer:(model,options)=>{const name:string=model.name;const id:string|undefined=model.cards[0]?.copy.id;const locale:string=options.localization.locale;const columns:number|undefined=model.layout.columns;const pageSize:number|undefined=model.layout.pageSize;const publicOwner:string|undefined=model.ownerName;void [name,id,locale,columns,pageSize,publicOwner];return {node:document.createElement('section'),dispose(){}};},
  layouts:{custom:(model,options)=>{const count:number=model.cards.length;const locale:string=options.localization.locale;void [count,locale];return document.createElement('div');}},
};
const albumsModel={me:{userId:'collector',role:'player',permissions:[]},catalog:{features:{publicAlbums:true}},inventory:[collectionOwned],albums:[]};
const albumsView:AlbumsView=renderAlbums(albumsModel,albumsContext);
document.body.append(collectionNode,albumsView.node);albumsView.dispose();
const savedAlbum:Promise<UIConsumerSchemas['AlbumRecord']>=albumsContext.mutate('saveAlbum',{name:'Journal',placements:[{copyId:collectionOwned.id}],layout:{pageSize:12}});
// @ts-expect-error Collection card renderers return elements directly.
renderCollection(collectionModel,{...collectionContext,cardRenderer:()=>({node:document.createElement('div')})});
// @ts-expect-error Collection returns a raw element without a disposal wrapper.
collectionNode.dispose();
// @ts-expect-error Album UI requires the host album renderer.
renderAlbums(albumsModel,{client,cardRenderer:albumsContext.cardRenderer,inspect:albumsContext.inspect,action:albumsContext.action,mutate:runner});
// @ts-expect-error Album renderer results must contain DOM nodes.
renderAlbums(albumsModel,{...albumsContext,albumRenderer:()=> 'album'});
// @ts-expect-error Album save retains its required name.
albumsContext.mutate('saveAlbum',{placements:[]});
// @ts-expect-error Album editing exposes no readiness promise.
albumsView.ready;

const shopProduct:ShopProduct & {displayNote:string}={id:'starter',name:'Starter',lineId:'sky',displayNote:'Example',maxQuantity:10,price:{currencyId:'credits',amount:10},slots:[{count:1,pool:[{variantId:'variant',weight:1}]}],duplicatePolicy:{scope:'none',fallback:'allow'},allocationStrategy:{algorithm:'weighted-deck@4',version:4,deckScope:'purchase-slot'}};
const shopModel:ShopModel<typeof shopProduct>={me:{userId:'collector'},wallet:{credits:100},pity:{starter:0},catalog:{products:[shopProduct],currencies:[{id:'credits',name:'Credits'}],lines:[{id:'sky',name:'Sky'}],rarities:[{id:'common',name:'Common'}],cards:[{id:'card',name:'Example'}],variants:[{id:'variant',cardId:'card',rarityId:'common'}]}};
const shopContext:ShopContext<typeof shopModel>={client,mutate:runner,refresh:async()=>{},action:async(fn,options)=>{const result=await fn();const message:string=typeof options.message==='function'?options.message(result):options.message;const refreshAfter:boolean|undefined=options.refreshAfter;void [message,refreshAfter];return result;},getPrincipal:()=> 'collector',isCurrentModel:model=>model.me.userId==='collector',onPurchased:()=>{},
  packArt(product,small,onSelect,preview,registerDispose){const note:string=product.displayNote;const compact:boolean=small;const absent:undefined=preview;registerDispose(()=>{});onSelect();void [note,compact,absent];return document.createElement('div');},
};
const nativeShop:ShopView=renderShop(shopModel,shopContext,{productId:'starter',quantity:2,forceReview:true});
document.body.append(nativeShop.node);const shopDisposed:void=nativeShop.dispose();
renderShop(shopModel,{...shopContext,client:{quote:client.quote}}).dispose();
const productInformation=shopProductInformation(shopModel,shopProduct);
const deckVersion:0|1|2|3|4=productInformation.deckVersion;
const cardCount:number=productInformation.count;
const rateSupply:number|null|undefined=productInformation.ratesGroups[0]?.rows[0]?.remaining;
const publicRateLabel:string|undefined=productInformation.ratesGroups[0]?.rows[0]?.publicLabel;
const rateNote:string=productInformation.explanation;
shopProductInformation({catalog:{cards:shopModel.catalog.cards,variants:shopModel.catalog.variants,rarities:shopModel.catalog.rarities},pity:{}},{id:'starter',slots:shopProduct.slots,duplicatePolicy:shopProduct.duplicatePolicy});
// @ts-expect-error Shop views return lifecycle objects synchronously.
const promisedShop:Promise<ShopView>=renderShop(shopModel,shopContext);
// @ts-expect-error Shop quantities use numbers.
renderShop(shopModel,shopContext,{quantity:'2'});
// @ts-expect-error Shop artwork adapters return appendable nodes or text.
renderShop(shopModel,{...shopContext,packArt:()=>({node:document.createElement('div')})});
// @ts-expect-error Native shop requires its host command path.
renderShop(shopModel,{client,refresh:()=>{},action:shopContext.action});
// @ts-expect-error Product disclosure needs slots and duplicate policy.
shopProductInformation(shopModel,{id:'starter'});
// @ts-expect-error Product rate weights remain numeric.
const invalidShopProduct:ShopProduct={...shopProduct,slots:[{count:1,pool:[{variantId:'variant',weight:'1'}]}]};
void [collectionNode,albumsView,savedAlbum,nativeShop,shopDisposed,deckVersion,cardCount,rateSupply,publicRateLabel,rateNote,promisedShop,invalidShopProduct];

import {renderMarketplace,renderFulfillments,renderTradingControls,type MarketplaceUIModel,type MarketplaceUIContext,type MarketplaceUIClient,type MarketplaceUIView} from '@digital-card/framework/marketplace-ui';
import type {MarketplaceSession} from '@digital-card/framework/marketplace-session';
import {mountCardPolicyAdmin,type CardPolicyAdmin} from '@digital-card/framework/card-policy-ui';
declare const marketplaceUIModel:MarketplaceUIModel;
declare const sharedMarketplaceSession:MarketplaceSession;
const marketplaceUIContext:MarketplaceUIContext={client,mutate:runner,storage:sessionStorage,locale:'en',messages:{'marketplace.title':'Marketplace'},getPrincipal:()=> 'collector',isCurrentModel:model=>model.me.userId==='collector',isActionBusy:()=>false,refresh:async()=>{},
  listingRenderer:(listing,options)=>{const title:string=listing.title;const price:number=listing.price.amount;const locale:string=options.localization.locale;const clientKey:string|undefined=options.client?.requestKey();const purchase:Promise<unknown>=options.purchase(listing,{newPurchase:true});const fallback:HTMLElement=options.defaultRenderer(listing);void [title,price,locale,clientKey,purchase,fallback];return {node:document.createElement('article'),dispose(){}};},
  cardRenderer:(copy,options)=>{const id:string=copy.id;const interactive:false=options.interactive;const locale:string=options.localization.locale;void [id,interactive,locale];return {node:document.createElement('article'),dispose(){}};},
};
const nativeMarketplace:MarketplaceUIView=renderMarketplace(marketplaceUIModel,marketplaceUIContext);
const nativeMarketplaceReady:Promise<void>=nativeMarketplace.ready;
document.body.append(nativeMarketplace.node);nativeMarketplace.dispose();
const marketplaceClientSubset:MarketplaceUIClient=client;
renderMarketplace(marketplaceUIModel,{client:marketplaceClientSubset,mutate:runner}).dispose();
const sharedMarketplaceView=renderMarketplace({catalog:{currencies:[]}},{listingRenderer:(listing,options)=>options.defaultRenderer(listing)},sharedMarketplaceSession);
const sharedMarketplaceReady:Promise<unknown>=sharedMarketplaceView.ready;
sharedMarketplaceView.dispose();
const fulfillments:MarketplaceUIView=renderFulfillments({me:{role:'admin',permissions:['actions.manage']}},{client,locale:'en'});
const fulfillmentsReady:Promise<void>=fulfillments.ready;
document.body.append(fulfillments.node);fulfillments.dispose();
const tradingControls:MarketplaceUIView=renderTradingControls(null,{client,messages:{'tradingControls.apply':'Apply'}});
const tradingControlsReady:Promise<void>=tradingControls.ready;
tradingControls.dispose();
const cardPolicyRoot=document.createElement('div');
const policyAdmin:CardPolicyAdmin=mountCardPolicyAdmin(cardPolicyRoot,{client,locale:'en',messages:{'policyUI.working':'Working'}});
const policyAdminReady:Promise<void|string>=policyAdmin.ready;
policyAdmin.ready.then(result=>{if(typeof result==='string'){const errorMessage:string=result;void errorMessage;}});
policyAdmin.dispose();
// @ts-expect-error A read client alone does not supply the marketplace command path.
renderMarketplace(marketplaceUIModel,{client:marketplaceClientSubset});
// @ts-expect-error Marketplace listing renderers return DOM nodes or node wrappers.
renderMarketplace(marketplaceUIModel,{client,listingRenderer:()=> 'listing'});
const narrowedSharedMarketplaceReady:Promise<void>=sharedMarketplaceView.ready;
// @ts-expect-error Marketplace returns its lifecycle object synchronously.
const promisedMarketplace:Promise<MarketplaceUIView>=renderMarketplace(marketplaceUIModel,marketplaceUIContext);
// @ts-expect-error Fulfillments require the host client.
renderFulfillments({me:{}},{});
// @ts-expect-error Trading controls require checked trading policy operations.
renderTradingControls(null,{client:{requestKey:client.requestKey}});
// @ts-expect-error Policy administration mounts into an HTML root.
mountCardPolicyAdmin('root',{client});
// @ts-expect-error Policy administration requires all used policy/resource methods.
mountCardPolicyAdmin(cardPolicyRoot,{client:{cardPolicies:client.cardPolicies}});
// @ts-expect-error Policy mount returns a handle, without a node property.
policyAdmin.node;
// @ts-expect-error A handled initial policy error can resolve its displayed string.
const voidPolicyReady:Promise<void>=policyAdmin.ready;
void [nativeMarketplace,nativeMarketplaceReady,sharedMarketplaceReady,fulfillmentsReady,tradingControlsReady,policyAdminReady,narrowedSharedMarketplaceReady,promisedMarketplace,voidPolicyReady];

import {renderStudio,type StudioModel,type StudioContext,type StudioView} from '@digital-card/framework/studio-ui';
const studioModel:StudioModel={me:{userId:'creator',role:'player',permissions:['catalog.read','catalog.preview']},catalog:{version:1,lines:[{id:'sky',name:'Sky'}],rarities:[{id:'common',name:'Common'}],currencies:[{id:'credits',name:'Credits'}],cards:collectionModel.catalog.cards,variants:collectionModel.catalog.variants,products:[{id:'starter',name:'Starter',lineId:'sky'}]}};
const studioContext:StudioContext={client,mutate:runner,action:async(fn,options)=>{const message:string=options.message;const refreshAfter:boolean|undefined=options.refreshAfter;void [message,refreshAfter];return fn();},locale:'en',messages:{'studioShell.creatorStudio':'Studio'},
  cardRenderer(copy,options){const name:string=copy.definition.name;const serial:null=copy.serialNumber;const edition:number|null=copy.editionTotal;const rarity:string=copy.rarityId;const finish:string|undefined=copy.variant.finish;const locale:string=options.localization.locale;options.onSelect(copy);void [name,serial,edition,rarity,finish,locale];return document.createElement('article');},
  inspect:copy=>{const id:string=copy.cardId;void id;},
};
const studioResult:HTMLElement|StudioView=renderStudio(studioModel,studioContext);
if('node' in studioResult){document.body.append(studioResult.node);const studioDisposed:void=studioResult.dispose();void studioDisposed;}
else {const explanation:HTMLElement=studioResult;document.body.append(explanation);}
const deniedStudioResult=renderStudio({...studioModel,me:{userId:'viewer',role:'player',permissions:[]}},studioContext);
if(!('node' in deniedStudioResult)){const explanation:HTMLElement=deniedStudioResult;void explanation;}
declare const studioImportManifest:UIConsumerSchemas['CatalogManifest'];
const committedStudio:Promise<UIConsumerSchemas['ImportReceipt']>=studioContext.mutate('commitImport',{manifest:studioImportManifest,digest:'sha256:example',expectedVersion:1});
// @ts-expect-error Permission checks can return an explanatory element without a disposable view.
const alwaysDisposableStudio:StudioView=renderStudio(studioModel,studioContext);
// @ts-expect-error Studio shell exposes no readiness promise on either return shape.
studioResult.ready;
// @ts-expect-error Studio shell returns synchronously.
const promisedStudio:Promise<HTMLElement|StudioView>=renderStudio(studioModel,studioContext);
// @ts-expect-error Preview card renderers return elements directly.
renderStudio(studioModel,{...studioContext,cardRenderer:()=>({node:document.createElement('article')})});
// @ts-expect-error Embedded visual studio needs policy and library client methods too.
renderStudio(studioModel,{...studioContext,client:{operatorCatalog:client.operatorCatalog,previewImport:client.previewImport,commitImport:client.commitImport}});
// @ts-expect-error Catalog publication retains the checked expected revision.
studioContext.mutate('commitImport',{manifest:studioImportManifest,digest:'sha256:example'});
void [studioResult,deniedStudioResult,committedStudio,alwaysDisposableStudio,promisedStudio];
