import {createClient} from '@digital-card/framework/client';
import {createWireTransport} from '@digital-card/framework/wire-client';
const client=createClient();
async function inspect(){
  const availability=await client.capabilities();
  const version:1=availability.version;
  const configured:boolean=availability.configured.trading;
  const available:boolean=availability.available.directSales;
  const draining:Array<'packs'|'directSales'|'trading'|'resale'>=availability.draining;
  const codeHistory:boolean=availability.history.codes;
  const rewardHistory:boolean=availability.history.rewards;
  const catalog=await client.catalog();const primitive:boolean|undefined=catalog.capabilities?.primitives.issuance;
  return {version,configured,available,draining,primitive,codeHistory,rewardHistory};
}
void inspect;
const call=createWireTransport({principal:()=>null});
void call('capabilities',undefined);
// @ts-expect-error capabilities is an authenticated read, not a mutation
void call('capabilities',{packs:true});
// @ts-expect-error public workflow flags remain booleans
const flag:Promise<string>=client.capabilities().then(value=>value.available.packs);
void flag;
