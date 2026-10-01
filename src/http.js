import {createServer} from 'node:http';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {randomUUID} from 'node:crypto';
async function body(request,maxBytes) {
  const chunks=[]; let size=0;
  for await(const chunk of request) {
    size+=chunk.length;
    if(size>maxBytes) throw new FrameworkError('PAYLOAD_TOO_LARGE','Request exceeds its byte limit',413);
    chunks.push(chunk);
  }
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return safeData(value,{maxBytes});}
  catch(error){if(error instanceof FrameworkError)throw error;throw new FrameworkError('INVALID_JSON','JSON request must be an object');}
}
export function createApiHandler({framework,resolveIdentity,allowedOrigin,exposeOperators=false,requireTradeReview=false,rateLimit,onRequest}={}) {
  if(typeof resolveIdentity!=='function') throw new Error('A trusted identity resolver is required');
  return async (request,response) => {
    const url=new URL(request.url,'http://localhost'), path=url.pathname;
    if(!path.startsWith('/api/')) return false;
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('X-Request-ID',randomUUID());
    try {
      const method=request.method;
      if(method!=='GET' && method!=='POST') throw new FrameworkError('METHOD_NOT_ALLOWED','Unsupported method',405);
      if(method==='POST') {
        if(!allowedOrigin || request.headers.origin!==allowedOrigin) throw new FrameworkError('ORIGIN_REJECTED','Mutation requires the configured host origin',403);
        if(!(request.headers['content-type']??'').startsWith('application/json')) throw new FrameworkError('INVALID_CONTENT_TYPE','Use application/json',415);
      }
      const actor=await resolveIdentity(request);
      if(rateLimit&&!rateLimit({actor,request,mutation:method==='POST'}))throw new FrameworkError('RATE_LIMITED','Too many requests; try again shortly',429);
      const publicGet=method==='GET' && (path==='/api/catalog' || path==='/api/availability' || path==='/api/public-albums' || /^\/api\/albums\/[^/]+$/.test(path));
      if(!publicGet && !actor?.userId) throw new FrameworkError('UNAUTHENTICATED','Sign in to continue',401);
      if(path.startsWith('/api/operator/')){if(!exposeOperators||actor?.role!=='admin')throw new FrameworkError('FORBIDDEN','Operator authority required',403);}
      const input=method==='POST'?await body(request,path.startsWith('/api/operator/')?8*1024*1024:1048576):undefined;
      const options={};for(const key of ['limit','after','search','sort'])if(url.searchParams.has(key))options[key]=key==='limit'?Number(url.searchParams.get(key)):url.searchParams.get(key);
      let result;
      if(method==='GET') {
        const routes={
          '/api/catalog':()=>framework.catalog(), '/api/me':()=>({...framework.me(actor),role:actor.role==='admin'?'admin':'player'}),
          '/api/availability':()=>framework.availability(),'/api/pity':()=>framework.pityProgress(actor),
          '/api/wallet':()=>framework.wallet(actor), '/api/history':()=>framework.history(actor),
          '/api/inventory':()=>url.searchParams.has('limit')?framework.inventoryPage(actor,options):framework.inventory(actor), '/api/packs':()=>framework.packs(actor),
          '/api/users':()=>framework.directory(actor,options),'/api/notifications':()=>framework.notifications(actor,options),
          '/api/operator/catalog':()=>framework.operatorCatalog(actor),
          '/api/operator/audit':()=>framework.audit(actor),
          '/api/albums':()=>framework.albums(actor), '/api/public-albums':()=>framework.publicAlbums(),
          '/api/trades':()=>framework.trades(actor), '/api/bindings':()=>framework.bindings(actor)
        };
        if(routes[path]) result=routes[path]();
        else if(/^\/api\/albums\/[^/]+$/.test(path)) result=framework.viewAlbum(actor,decodeURIComponent(path.split('/').at(-1)));
        else if(/^\/api\/cards\/[^/]+$/.test(path)) result=framework.inspectCard(actor,decodeURIComponent(path.split('/').at(-1)));
        else if(/^\/api\/users\/[^/]+\/inventory$/.test(path))result=framework.tradeInventory(actor,decodeURIComponent(path.split('/')[3]),options);
        else throw new FrameworkError('NOT_FOUND','Unknown API route',404);
      } else {
        const routes={
          '/api/quote':'quote','/api/purchase':'purchase','/api/open':'openPack','/api/convert':'convert',
          '/api/trade-up':'tradeUp','/api/albums':'saveAlbum','/api/trades':'proposeTrade',
          '/api/trades/accept':'acceptTrade','/api/trades/cancel':'cancelTrade','/api/bindings/use':'consumeBinding'
          ,'/api/trades/counter':'counterTrade','/api/preferences':'setPreferences','/api/notifications/read':'readNotifications',
          '/api/operator/import/preview':'previewImport','/api/operator/import/commit':'commitImport'
        };
        const command=routes[path]; if(!command) throw new FrameworkError('NOT_FOUND','Unknown API route',404);
        if(requireTradeReview&&['acceptTrade','counterTrade'].includes(command)&&typeof input.expectedDigest!=='string')throw new FrameworkError('REVIEW_REQUIRED','Review the immutable trade contents first',409);
        result=framework[command](actor,input);
      }
      response.end(JSON.stringify(result));
    } catch(error) {
      response.statusCode=error instanceof FrameworkError?error.status:500;
      if(response.statusCode===429)response.setHeader('Retry-After','60');
      response.end(JSON.stringify({code:error instanceof FrameworkError?error.code:'INTERNAL_ERROR',
        message:error instanceof FrameworkError?error.message:'The server could not complete this request'}));
    }
    try{onRequest?.({requestId:response.getHeader('X-Request-ID'),method:request.method,path,status:response.statusCode});}catch{}
    return true;
  };
}
export function createFrameworkServer(options) {
  const handler=createApiHandler(options);
  return createServer(async(req,res)=>{
    if(!(await handler(req,res))) {res.statusCode=404;res.end('Not found');}
  });
}
