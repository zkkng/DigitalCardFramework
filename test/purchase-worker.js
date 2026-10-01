import {parentPort,workerData} from 'node:worker_threads';
import {CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
if(parentPort) {
  const framework=new CardFramework({store:new SQLiteStore(workerData.path),bindings:{'demo.code':()=>({code:'worker-code'})}});
  try {parentPort.postMessage({ok:true,result:framework.purchase(workerData.actor,{...workerData.quote,key:workerData.key})});}
  catch(error) {parentPort.postMessage({ok:false,code:error.code,message:error.message});}
  finally {framework.close();}
}
