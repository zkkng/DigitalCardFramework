import {createWireTransport} from '../src/wire-client.js';
import type {Schemas} from '../src/wire-types.js';
const call=createWireTransport({principal:()=>null});
async function acquisition(){
  const quote=await call('quote',{productId:'sample',quantity:1});
  const price:number=quote.price.amount;
  const purchase=await call('purchase',{...quote,key:'consumer-key'});
  const packId:string=purchase.packs[0]!.id;
  const receipt=await call('openPack',{key:'open-key',packId});
  const state:'sealed'|'owned'|'consumed'=receipt.cards[0]!.state;
  return {price,state};
}
void acquisition;
// Deliberate contract drift must continue to fail the strict consumer check.
// @ts-expect-error quantity is an integer JSON number, not a string
void call('quote',{productId:'sample',quantity:'1'});
// @ts-expect-error missing the required reviewed product revision
void call('purchase',{key:'key',productId:'sample',quantity:1,catalogVersion:1});
// @ts-expect-error quote does not accept an injected principal
void call('quote',{productId:'sample',userId:'other'});
// @ts-expect-error operation names are pinned by the contract
void call('purchaseUnchecked',{key:'key'});
// @ts-expect-error error envelope always requires a message
const error:Schemas['Error']={code:'INVALID_INPUT'};
void error;
// @ts-expect-error production trade acceptance requires the reviewed digest
void call('acceptTrade',{key:'key',tradeId:'trade'});
void call('acceptTrade',{key:'key',tradeId:'trade',expectedDigest:'a'.repeat(64)});
