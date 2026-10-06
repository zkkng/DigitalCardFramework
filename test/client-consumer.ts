import {createClient,createCommandRunner,createRevealController} from '@digital-card/framework/client';
import {createAdminController} from '@digital-card/framework/admin-client';
const client=createClient();
const storage:Storage=globalThis.sessionStorage;
const runner=createCommandRunner({client,storage,namespace:'account'});
async function recoverPurchase(){
  const quote=await client.quote({productId:'sample'});
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
