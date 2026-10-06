import {createAdminController} from '@digital-card/framework/admin-client';
import type {Client,CommandStorage} from '@digital-card/framework/client';
declare const client:Client;
declare const storage:CommandStorage&Required<Pick<CommandStorage,'removeItem'>>;
const controller=createAdminController({client,storage,namespace:'operator'});
controller.stage({input:{scope:'site',reason:'Maintenance',changes:{packPurchasesPaused:true}},title:'Pause purchases',changes:[{label:'Purchases',before:'Allowed',after:'Paused'}]});
controller.stage({command:'administerCards',input:{action:'give',userId:'member',variantId:'standard',quantity:1,reason:'Award'},title:'Award a card',changes:[{label:'Copies',before:'0',after:'1'}]});
// @ts-expect-error Removal requires exact copy identities.
controller.stage({command:'administerCards',input:{action:'remove',userId:'member',quantity:1,reason:'Correction'},title:'Remove a card',changes:[]});
// @ts-expect-error Administrator revisions are captured by the controller.
controller.stage({input:{scope:'site',expectedRevision:3,reason:'Maintenance',changes:{}},title:'Review',changes:[]});
controller.subscribe(state=>{const revision:number|undefined=state.overview?.revision;const first:string|undefined=state.review?.changes[0]?.label;void revision;void first;});
async function confirm(){const receipt=await controller.confirm();const revision:number|undefined=receipt?.revision;void revision;}
void confirm;
controller.dispose();
