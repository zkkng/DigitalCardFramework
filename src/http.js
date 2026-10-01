import {createServer} from 'node:http';
import {FrameworkError} from './catalog.js';
async function body(request) {
  const chunks=[]; let size=0;
  for await(const chunk of request) {
    size+=chunk.length;
    if(size>1048576) throw new FrameworkError('PAYLOAD_TOO_LARGE','Request exceeds 1 MiB',413);
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
  catch {throw new FrameworkError('INVALID_JSON','Invalid JSON request');}
}
export function createApiHandler({framework,resolveIdentity,allowedOrigin}) {
  if(typeof resolveIdentity!=='function') throw new Error('A trusted identity resolver is required');
  return async (request,response) => {
    const url=new URL(request.url,'http://localhost'), path=url.pathname;
    if(!path.startsWith('/api/')) return false;
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    try {
      const method=request.method;
      if(method!=='GET' && method!=='POST') throw new FrameworkError('METHOD_NOT_ALLOWED','Unsupported method',405);
      if(method==='POST') {
        if(!allowedOrigin || request.headers.origin!==allowedOrigin) throw new FrameworkError('ORIGIN_REJECTED','Mutation requires the configured host origin',403);
        if(!(request.headers['content-type']??'').startsWith('application/json')) throw new FrameworkError('INVALID_CONTENT_TYPE','Use application/json',415);
      }
      const actor=await resolveIdentity(request);
      const publicGet=method==='GET' && (path==='/api/catalog' || path==='/api/public-albums' || /^\/api\/albums\/[^/]+$/.test(path));
      if(!publicGet && !actor?.userId) throw new FrameworkError('UNAUTHENTICATED','Sign in to continue',401);
      const input=method==='POST'?await body(request):undefined;
      let result;
      if(method==='GET') {
        const routes={
          '/api/catalog':()=>framework.catalog(), '/api/me':()=>({userId:actor.userId}),
          '/api/wallet':()=>framework.wallet(actor), '/api/history':()=>framework.history(actor),
          '/api/inventory':()=>framework.inventory(actor), '/api/packs':()=>framework.packs(actor),
          '/api/albums':()=>framework.albums(actor), '/api/public-albums':()=>framework.publicAlbums(),
          '/api/trades':()=>framework.trades(actor), '/api/bindings':()=>framework.bindings(actor)
        };
        if(routes[path]) result=routes[path]();
        else if(/^\/api\/albums\/[^/]+$/.test(path)) result=framework.viewAlbum(actor,decodeURIComponent(path.split('/').at(-1)));
        else if(/^\/api\/cards\/[^/]+$/.test(path)) result=framework.inspectCard(actor,decodeURIComponent(path.split('/').at(-1)));
        else throw new FrameworkError('NOT_FOUND','Unknown API route',404);
      } else {
        const routes={
          '/api/quote':'quote','/api/purchase':'purchase','/api/open':'openPack','/api/convert':'convert',
          '/api/trade-up':'tradeUp','/api/albums':'saveAlbum','/api/trades':'proposeTrade',
          '/api/trades/accept':'acceptTrade','/api/trades/cancel':'cancelTrade','/api/bindings/use':'consumeBinding'
        };
        const command=routes[path]; if(!command) throw new FrameworkError('NOT_FOUND','Unknown API route',404);
        result=framework[command](actor,input);
      }
      response.end(JSON.stringify(result));
    } catch(error) {
      response.statusCode=error instanceof FrameworkError?error.status:500;
      response.end(JSON.stringify({code:error instanceof FrameworkError?error.code:'INTERNAL_ERROR',
        message:error instanceof FrameworkError?error.message:'The server could not complete this request'}));
    }
    return true;
  };
}
export function createFrameworkServer(options) {
  const handler=createApiHandler(options);
  return createServer(async(req,res)=>{
    if(!(await handler(req,res))) {res.statusCode=404;res.end('Not found');}
  });
}
