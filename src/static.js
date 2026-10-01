import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const presentationModules=['index','card-view','integration','player','webgl','resolver','package','data','motion','validate','media','advanced-media','extensions','project','authoring','performance','album-motion'];
const modules=['card-types','code-ui','ui','client','styles','atelier-styles','trade-client','trading-ui','collection-ui','studio-ui','inspector-ui','player-ui','ui-kit'];
export async function serveReference(req,res,{production=false,assetOrigins=[]}={}){
  const path=new URL(req.url,'http://localhost').pathname;
  const files=new Map([['/','examples/index.html'],['/app.js','examples/app.js'],['/site.css','examples/site.css'],...modules.map(x=>['/src/'+x+'.js','src/'+x+'.js']),...presentationModules.map(x=>['/src/presentation/'+x+'.js','src/presentation/'+x+'.js'])]);
  const file=files.get(path);if(!file||req.method!=='GET')return false;
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' ${assetOrigins.join(' ')} blob:; media-src 'self' blob: ${assetOrigins.join(' ')}; connect-src 'self' ${assetOrigins.join(' ')}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.setHeader('Cache-Control',production?'public, max-age=0, must-revalidate':'no-store');res.end(await readFile(resolve(root,file)));return true;
}
export function securityHeaders(res,{production=false}={}){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
