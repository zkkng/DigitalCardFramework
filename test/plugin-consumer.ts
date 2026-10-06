import {createPluginHost,validatePluginMessage} from '@digital-card/framework/plugin-host';
import type {PluginFramework,PluginActor,PluginHttpRequest,PluginHttpResponse} from '@digital-card/framework/plugin-host';
declare const framework:PluginFramework;
declare const actor:PluginActor;
declare const request:PluginHttpRequest;
declare const response:PluginHttpResponse;
const host=createPluginHost({framework,plugins:[{id:'example.reader',version:'1.0.0',token:'operator-configured-credential',commands:['inventory.read'],userIds:['owner']}],resolveActor:async userId=>({...actor,userId})});
const delegation=host.issueDelegation({pluginId:'example.reader',actor,commands:['inventory.read']});
// @ts-expect-error Unrestricted core dispatch is absent from the scoped command profile.
host.setGrants('example.reader',['purchase']);
// @ts-expect-error Delegation requires a verified principal identity.
host.issueDelegation({pluginId:'example.reader',actor:{role:'admin'},commands:['inventory.read']});
const reply=validatePluginMessage('commandResponse',{} as unknown);
if(reply.command==='inventory.read'){const id:string|undefined=reply.result.items[0]?.id;void id;}
host.handle(request,response);host.revokeDelegation(delegation);host.disable('example.reader');host.dispose();

if(reply.command==='purchase.execute'){const id:string=reply.result.intent.id;const packs=reply.result.result.packs;void id;void packs;}
host.setGrants('example.reader',['purchase.quote','purchase.register','purchase.execute','purchase.pending','purchase.acknowledge']);
