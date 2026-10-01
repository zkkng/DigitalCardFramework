import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CardFramework} from '../src/core.js';
import {SQLiteStore} from '../src/sqlite.js';
import {keyFromHex} from '../src/encryption.js';
import {parseContent} from '../src/importer.js';
import {SessionStore,createAuthHost,createOIDCProvider} from '../src/auth.js';
import {createApiHandler} from '../src/http.js';
import {createRateLimiter} from '../src/limits.js';
import {serveReference,securityHeaders} from '../src/static.js';

const secret=async name=>process.env[name+'_FILE']?(await readFile(process.env[name+'_FILE'],'utf8')).trim():process.env[name];
const origin=process.env.SITE_ORIGIN;
if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new Error('SITE_ORIGIN must be an exact HTTPS origin');
const encryptionKey=keyFromHex(await secret('STATE_ENCRYPTION_KEY'));if(!encryptionKey)throw new Error('STATE_ENCRYPTION_KEY is required');
const issuer=process.env.OIDC_ISSUER,clientId=process.env.OIDC_CLIENT_ID;if(!issuer?.startsWith('https://')||!clientId)throw new Error('OIDC_ISSUER and OIDC_CLIENT_ID are required');
const adminSubjects=JSON.parse(process.env.OPERATOR_SUBJECTS??'[]');if(!Array.isArray(adminSubjects)||adminSubjects.some(x=>typeof x!=='string'))throw new Error('OPERATOR_SUBJECTS must be a JSON string array');
const dbPath=resolve(process.env.DATABASE_PATH??'data/production.sqlite');await mkdir(dirname(dbPath),{recursive:true});
const extension=process.env.HOST_MODULE?await import(pathToFileURL(resolve(process.env.HOST_MODULE)).href):{};
const store=new SQLiteStore(dbPath,{encryptionKey}),framework=new CardFramework({store,bindings:extension.bindings,policies:extension.policies,
  limits:{users:500,copies:5000,packs:2000,requests:20000,albums:2000,trades:2000,copiesPerUser:1000,packsPerUser:500,...extension.limits}});
try{framework.catalog();}catch(error){if(error.code!=='NO_CATALOG')throw error;if(!process.env.CATALOG_FILE)throw new Error('CATALOG_FILE is required for first initialization');framework.publishCatalog({role:'admin'},parseContent(await readFile(process.env.CATALOG_FILE,'utf8'),{format:/\.ya?ml$/i.test(process.env.CATALOG_FILE)?'yaml':'json'}));}
const raw=framework.operatorCatalog({role:'admin'});
for(const variant of raw.variants)for(const binding of Object.values(variant.bindings))if(binding.factory&&!extension.bindings?.[binding.factory])throw new Error('Configure binding factory '+binding.factory+' in HOST_MODULE');
const audit=framework.audit({role:'admin'});if(!audit.ok||!store.integrity())throw new Error('Database verification failed; restore a verified backup');
const sessions=new SessionStore(dbPath,{encryptionKey,maxSessions:extension.sessionOptions?.maxSessions}),rateLimit=extension.rateLimiter??createRateLimiter(extension.rateLimits);
const provider=extension.identityProvider??await createOIDCProvider({issuer,clientId,clientSecret:await secret('OIDC_CLIENT_SECRET'),origin});
const auth=createAuthHost({framework,sessions,provider,origin,adminSubjects,rateLimit});
const api=createApiHandler({framework,resolveIdentity:auth.resolveIdentity,allowedOrigin:origin,exposeOperators:true,requireTradeReview:true,requirePrincipal:true,rateLimit,
  onRequest:event=>process.stdout.write(JSON.stringify({kind:'request',...event})+'\n')});
const assetOrigins=(process.env.ASSET_ORIGINS??'').split(',').filter(Boolean);for(const value of assetOrigins)if(new URL(value).origin!==value||!value.startsWith('https://'))throw new Error('ASSET_ORIGINS requires exact HTTPS origins');
const server=createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  securityHeaders(res,{production:true});
  try{
    const path=new URL(req.url,origin).pathname;
    if(path==='/healthz'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
    if(path==='/host/config'&&req.method==='GET'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode:'production',brand:process.env.SITE_NAME??'Card Atelier',loginUrl:'/auth/login'}));return;}
    if(await auth.handle(req,res)||await api(req,res)||await extension.handleStatic?.(req,res)||await serveReference(req,res,{production:true,assetOrigins}))return;
    res.statusCode=404;res.end('Not found');
  }catch{res.statusCode=500;res.end('Request could not be completed');}
});
server.maxRequestsPerSocket=1000;server.keepAliveTimeout=5000;
const maintenance=setInterval(()=>{try{framework.sweepExpiredTrades({role:'admin'});}catch{process.stderr.write('Trade expiry maintenance failed\n');}},60000);maintenance.unref();
server.listen(Number(process.env.PORT??8080),process.env.BIND_ADDRESS??'127.0.0.1',()=>console.log('Framework production host ready on '+origin));
let closing=false;function shutdown(){if(closing)return;closing=true;clearInterval(maintenance);server.close(()=>{sessions.close();framework.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
