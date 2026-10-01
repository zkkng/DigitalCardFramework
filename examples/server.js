import {createServer} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CardFramework} from '../src/index.js';
import {SQLiteStore} from '../src/sqlite.js';
import {createApiHandler} from '../src/http.js';
import {sampleCatalog} from './catalog.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(resolve(root,'data'),{recursive:true});
const port=Number(process.env.PORT??4317), origin='http://127.0.0.1:'+port;
const framework=new CardFramework({store:new SQLiteStore(resolve(root,'data/demo.sqlite')),
  bindings:{'demo.code':()=>({code:'DEMO-'+randomUUID(),description:'Example attached data, not a game redemption code'})}});
const admin={role:'admin'};
try{if(framework.catalog().version<sampleCatalog.version)framework.publishCatalog(admin,sampleCatalog);}catch(error){if(error.code==='NO_CATALOG')framework.publishCatalog(admin,sampleCatalog);else throw error;}
const users=['Rowan','Morgan'].map(name=>{
  const user=framework.registerUser(admin,{provider:'local-demo',subject:name.toLowerCase(),displayName:name});
  for(const [currencyId,amount]of [['credits',2000],['gems',10],['stamps',20]])framework.grantCurrency(admin,{userId:user.id,currencyId,amount,key:'initial-'+currencyId,reason:'Fictional demo starting balance'});
  return {id:user.id,name};
});
const sessions=new Map();
function identity(request) {
  const token=(request.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dc_demo='))?.slice(8);
  const userId=token&&sessions.get(token);return userId?{userId}:null;
}
const api=createApiHandler({framework,resolveIdentity:identity,allowedOrigin:origin});
const allowedFiles=new Map([
  ['/','examples/index.html'],['/alternate','examples/alternate.html'],['/app.js','examples/app.js'],['/alternate.js','examples/alternate.js'],
  ...['ui','client','styles'].map(name=>['/src/'+name+'.js','src/'+name+'.js'])
]);
const server=createServer(async(request,response)=>{
  try {
    const url=new URL(request.url,origin);
    if(request.method==='GET' && ['/demo/layers/sky.svg','/demo/layers/orb.svg'].includes(url.pathname)) {
      const background=url.pathname.endsWith('sky.svg');
      const drawing=background
        ? '<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#eac48d"/><stop offset="1" stop-color="#273953"/></linearGradient></defs><rect width="500" height="700" fill="url(#sky)"/><path d="M-20 480 Q160 280 300 430 T530 400 V700 H-20Z" fill="#233647"/>'
        : '<circle cx="250" cy="240" r="85" fill="#f5d89b" opacity=".75"/><circle cx="250" cy="240" r="65" fill="none" stroke="#fff1cd" stroke-width="2"/>';
      response.setHeader('Content-Type','image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700">'+drawing+'</svg>');return;
    }
    if(url.pathname==='/demo/users' && request.method==='GET') {response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify(users));return;}
    if(url.pathname==='/demo/session' && request.method==='POST') {
      if(request.headers.origin!==origin || !(request.headers['content-type']??'').startsWith('application/json')) {response.statusCode=403;response.end('Invalid demo origin');return;}
      let input='';for await(const chunk of request){input+=chunk;if(input.length>4096){response.statusCode=413;response.end();return;}}
      const {userId}=JSON.parse(input);
      if(!users.some(u=>u.id===userId)){response.statusCode=400;response.end('Unknown demo user');return;}
      const token=randomUUID();sessions.set(token,userId);
      response.setHeader('Set-Cookie','dc_demo='+token+'; HttpOnly; SameSite=Strict; Path=/');
      response.setHeader('Content-Type','application/json');response.end('{"ok":true}');return;
    }
    if(await api(request,response))return;
    const file=allowedFiles.get(url.pathname);
    if(!file){response.statusCode=404;response.end('Not found');return;}
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    response.setHeader('X-Content-Type-Options','nosniff');response.end(readFileSync(resolve(root,file)));
  }catch{response.statusCode=500;response.end('Demo request failed');}
});
server.listen(port,'127.0.0.1',()=>console.log('Digital Card Framework demo: '+origin+' (fictional accounts, local only)'));
function shutdown(){server.close(()=>{framework.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
