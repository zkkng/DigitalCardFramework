import {hasPermission,publicPermissions} from './access.js';
import {createServer} from 'node:http';
import {FrameworkError} from './catalog.js';
import {safeData} from './data.js';
import {randomUUID} from 'node:crypto';
const adminRoutes = {
  'GET /api/operator/admin': 'admin.read',
  'GET /api/operator/admin/users': 'admin.read',
  'GET /api/operator/admin/user': 'admin.read',
  'GET /api/operator/admin/history': 'admin.read',
  'POST /api/operator/admin/settings': 'admin.manage',
  'POST /api/operator/admin/cards': 'admin.cards'
};
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
export function createApiHandler({framework,currencyGateway,codeGateway,resolveIdentity,allowedOrigin,exposeOperators=false,requireTradeReview=false,requirePrincipal=false,rateLimit,onRequest}={}) {
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
        if((request.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json') throw new FrameworkError('INVALID_CONTENT_TYPE','Use application/json',415);
      }
      const actor=await resolveIdentity(request);
      if(method==='POST'&&(requirePrincipal||request.headers['x-dc-principal'])&&request.headers['x-dc-principal']!==actor?.userId)throw new FrameworkError('PRINCIPAL_CHANGED','Signed-in account changed. Reload before continuing.',409);
      if(rateLimit&&!rateLimit({actor,request,mutation:method==='POST'}))throw new FrameworkError('RATE_LIMITED','Too many requests; try again shortly',429);
      const publicGet=method==='GET' && (path==='/api/catalog' || path==='/api/availability' || path==='/api/public-albums' || /^\/api\/albums\/[^/]+$/.test(path));
      if(!publicGet && !actor?.userId) throw new FrameworkError('UNAUTHENTICATED','Sign in to continue',401);
      if(path.startsWith('/api/operator/') && !adminRoutes[method+' '+path]){if(!exposeOperators||!hasPermission(actor,({'GET /api/operator/card-policies':'card-policies.read','POST /api/operator/card-policies/effective':'catalog.preview','POST /api/operator/card-policies/save':'card-policies.manage','POST /api/operator/card-policies/preview':'card-policies.manage','POST /api/operator/card-policies/activate':'card-policies.manage','POST /api/operator/card-policies/retire':'card-policies.manage','POST /api/operator/card-policies/restore':'card-policies.manage','POST /api/operator/card-resources/save':'card-policies.manage','POST /api/operator/card-resources/retire':'card-policies.manage','POST /api/operator/card-resources/restore':'card-policies.manage','POST /api/operator/copy-stats':'card-stats.provide','POST /api/operator/trading':'trading.manage','POST /api/operator/card-lock':'trading.manage','GET /api/operator/actions':'actions.manage','POST /api/operator/actions/retry':'actions.manage','POST /api/operator/commerce':'commerce.manage','POST /api/operator/shop-status':'commerce.manage','POST /api/operator/raffles/draw':'raffles.draw','GET /api/operator/catalog':'catalog.read','GET /api/operator/audit':'audit.read','POST /api/operator/import/preview':'catalog.preview','POST /api/operator/import/commit':'catalog.publish','GET /api/operator/codes':'codes.manage','GET /api/operator/code-pools':'codes.manage','POST /api/operator/code-pools':'codes.manage','POST /api/operator/codes/import':'codes.import','POST /api/operator/codes/confirm':'codes.confirm'})[method+' '+path]))throw new FrameworkError('FORBIDDEN','Operator authority required',403);}
      const adminPermission=adminRoutes[method+' '+path];
      if(adminPermission && (!exposeOperators || !hasPermission(actor,adminPermission)))throw new FrameworkError('FORBIDDEN','Administrator authority required',403);
      const input=method==='POST'?await body(request,path.startsWith('/api/operator/')?8*1024*1024:1048576):undefined;
      const options={};for(const key of ['limit','after','search','sort'])if(url.searchParams.has(key))options[key]=key==='limit'?Number(url.searchParams.get(key)):url.searchParams.get(key);
      let result;
      if(method==='GET') {
        const routes={
          '/api/operator/admin':()=>framework.adminOverview(actor),
          '/api/operator/admin/users':()=>framework.adminUsers(actor,options),
          '/api/operator/admin/user':()=>framework.adminUser(actor,{...options,userId:url.searchParams.get('userId')}),
          '/api/operator/admin/history':()=>framework.adminHistory(actor,options),
          '/api/trading-policy':()=>framework.tradingPolicy(),'/api/commerce-settings':()=>framework.commerceSettings(),'/api/shops':()=>framework.shops(actor,options),'/api/listings':()=>framework.listings(actor,{...options,...(url.searchParams.has('shopId')?{shopId:url.searchParams.get('shopId')}:{})}),'/api/orders':()=>framework.orders(actor,options),'/api/fulfillments':()=>framework.fulfillments(actor,options),'/api/operator/actions':()=>framework.actionJobs(actor,options),
          '/api/catalog':()=>framework.catalog(), '/api/me':()=>({...framework.me(actor),role:actor.role==='admin'?'admin':'player',permissions:publicPermissions(actor)}),
          '/api/availability':()=>framework.availability(),'/api/pity':()=>framework.pityProgress(actor),
          '/api/wallet':()=>framework.wallet(actor), '/api/history':()=>framework.history(actor),
          '/api/inventory':()=>url.searchParams.has('limit')?framework.inventoryPage(actor,options):framework.inventory(actor), '/api/packs':()=>framework.packs(actor),
          '/api/users':()=>framework.directory(actor,options),'/api/notifications':()=>framework.notifications(actor,options),
          '/api/operator/card-policies':()=>framework.cardPolicies(actor),
          '/api/operator/catalog':()=>framework.operatorCatalog(actor),
          '/api/operator/audit':()=>framework.audit(actor),
          '/api/operator/codes':()=>framework.codeInventory(actor,options),'/api/operator/code-pools':()=>framework.codePools(actor),'/api/codes':()=>framework.codeHistory(actor,options),
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
          '/api/operator/admin/settings':'configureAdmin',
          '/api/operator/admin/cards':'administerCards',
          '/api/operator/trading':'configureTrading','/api/operator/card-lock':'setCardTransferLock','/api/operator/actions/retry':'retryAction','/api/operator/commerce':'configureCommerce','/api/operator/shop-status':'setShopEnabled','/api/operator/raffles/draw':'drawRaffle','/api/shops':'createShop','/api/listings':'createListing','/api/listings/quote':'quoteListing','/api/listings/buy':'buyListing','/api/listings/cancel':'cancelListing','/api/raffles/enter':'enterRaffle','/api/raffles/status':'raffleStatus','/api/cards/open':'openCard',
          '/api/quote':'quote','/api/purchase':'purchase','/api/open':'openPack','/api/convert':'convert',
          '/api/trade-up':'tradeUp','/api/albums':'saveAlbum','/api/trades':'proposeTrade',
          '/api/trades/accept':'acceptTrade','/api/trades/cancel':'cancelTrade','/api/bindings/use':'consumeBinding'
          ,'/api/trades/counter':'counterTrade','/api/preferences':'setPreferences','/api/notifications/read':'readNotifications',
          '/api/codes/reveal':'revealCode','/api/codes/report':'reportCodeUsage','/api/operator/code-pools':'configureCodePool','/api/operator/codes/import':'importCodes','/api/operator/codes/confirm':'confirmCodeStatus',
          '/api/operator/import/preview':'previewImport','/api/operator/import/commit':'commitImport','/api/operator/card-policies/effective':'effectiveCardPolicy','/api/operator/card-policies/save':'saveCardPolicy','/api/operator/card-policies/preview':'previewCardPolicy','/api/operator/card-policies/activate':'activateCardPolicy','/api/operator/card-policies/retire':'retireCardPolicy','/api/operator/card-policies/restore':'restoreCardPolicy','/api/operator/card-resources/save':'saveCardResource','/api/operator/card-resources/retire':'retireCardResource','/api/operator/card-resources/restore':'restoreCardResource','/api/operator/copy-stats':'updateCopyStats'
        };
        if(path==='/api/currency/reconcile' && currencyGateway) result=await currencyGateway.reconcile(actor,input);
        else if(path==='/api/codes/reconcile' && codeGateway) result=await codeGateway.reconcile(actor,input);
        else {
        const command=routes[path]; if(!command) throw new FrameworkError('NOT_FOUND','Unknown API route',404);
        if(requireTradeReview&&['acceptTrade','counterTrade'].includes(command)&&typeof input.expectedDigest!=='string')throw new FrameworkError('REVIEW_REQUIRED','Review the immutable trade contents first',409);
        result=await framework[command](actor,input);
        }
      }
      response.end(JSON.stringify(result));
    } catch(error) {
      response.statusCode=error instanceof FrameworkError?error.status:error instanceof URIError?400:500;
      if(response.statusCode===429)response.setHeader('Retry-After','60');
      response.end(JSON.stringify({code:error instanceof FrameworkError?error.code:error instanceof URIError?'INVALID_PATH':'INTERNAL_ERROR',
        message:error instanceof FrameworkError?error.message:error instanceof URIError?'Malformed path encoding':'The server could not complete this request'}));
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
