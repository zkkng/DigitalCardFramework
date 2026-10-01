import { parentPort, workerData } from 'node:worker_threads';
import { CardFramework } from '../src/index.js';
import { SQLiteStore } from '../src/sqlite.js';
const core=new CardFramework({store:new SQLiteStore(workerData.db)});
parentPort.postMessage('ready');
parentPort.once('message',()=>{
  try{const quote=core.quote(workerData.actor,{productId:'bundle'});const result=core.purchase(workerData.actor,{...quote,key:workerData.key});parentPort.postMessage({ok:true,id:result.id});}
  catch(error){parentPort.postMessage({ok:false,code:error.code});}
  finally{core.close();parentPort.close();}
});
