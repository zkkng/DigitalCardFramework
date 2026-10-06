import {actionProtocol,validateActionDelivery,validateActionAcknowledgment,createRemoteActionHandler} from '@digital-card/framework/remote-actions';
import type {ActionDelivery} from '@digital-card/framework/remote-actions';
declare const incoming:unknown;
const delivery:ActionDelivery=validateActionDelivery(incoming);
const protocol:'digital-card-action@1'=actionProtocol;
const handler=createRemoteActionHandler({url:'https://receiver.example/actions',pluginId:'example.receiver',handlerId:'example.record',token:'operator-configured-credential'});
handler({idempotencyKey:delivery.jobId,userId:delivery.beneficiaryId,source:delivery.source,params:delivery.params});
// @ts-expect-error Executable values cannot enter portable delivery metadata.
handler({idempotencyKey:'job',userId:null,source:{},params:{callback:()=>1}});
const reply=validateActionAcknowledgment(incoming);
const completed:'completed'=reply.status;
void protocol;void completed;
