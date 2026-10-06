import {FrameworkError} from './catalog.js';

/** Explicit durable purchase adapters; never dispatch a caller-selected core method. */
export async function dispatchPluginPurchase(framework,actor,command,input,fence,live){
  const options={operators:false,requireTradeReview:true};
  const owned=intent=>intent?.userId===actor.userId&&intent?.command==='purchase';
  const invalid=()=>{throw new FrameworkError('PLUGIN_CONTRACT','Purchase adapter returned an unrelated intent',502);};
  if(command==='purchase.quote')return framework.quote(actor,input);
  if(command==='purchase.pending'){const result=await framework.commandIntents(actor,{...options,command:'purchase'});if(!Array.isArray(result?.items)||result.items.some(intent=>!owned(intent)))invalid();return result;}
  if(command==='purchase.register'){const intent=await framework.registerCommandIntent(actor,{command:'purchase',input},options);if(!owned(intent))invalid();return intent;}
  if(command!=='purchase.execute'&&command!=='purchase.acknowledge')throw new FrameworkError('PLUGIN_GRANT','Unsupported plugin purchase command',403);
  const intent=await framework.commandIntent(actor,{id:input.id,command:'purchase'},options);
  fence();
  if(intent?.userId!==actor.userId||intent?.command!=='purchase'||intent?.id!==input.id)throw new FrameworkError('PLUGIN_GRANT','Purchase intent authority rejected',403);
  actor=await live();fence();
  if(command==='purchase.execute'){const result=await framework.executeCommandIntentAsync(actor,input,options);if(!owned(result?.intent)||result.intent.id!==input.id||!['completed','acknowledged'].includes(result.intent.state))invalid();return result;}
  const result=await framework.acknowledgeCommandIntent(actor,input,options);if(result?.id!==input.id||result?.state!=='acknowledged')invalid();return result;
}
