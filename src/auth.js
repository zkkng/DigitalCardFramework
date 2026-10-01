import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import * as oidc from 'openid-client';
import {createStateCodec} from './encryption.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const cookie=(req,name)=>(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);

/** Durable opaque sessions; secrets are encrypted and only token hashes are indexed. */
export class SessionStore {
  #db;#codec;#clock;
  constructor(path,{encryptionKey,clock=Date.now}={}){
    this.#codec=createStateCodec(encryptionKey);this.#clock=clock;this.#db=new DatabaseSync(path,{timeout:5000});
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS auth_sessions (digest TEXT PRIMARY KEY, kind TEXT NOT NULL, expires INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;');
  }
  create(kind,data,ttl){const secret=token();this.#db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(this.#clock());this.#db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(hash(secret),kind,this.#clock()+ttl,this.#codec.encode(data));return secret;}
  get(secret,kind,{consume=false}={}){
    if(typeof secret!=='string'||!/^[\w-]{43}$/.test(secret))return null;
    this.#db.exec('BEGIN IMMEDIATE');try{const row=this.#db.prepare('SELECT * FROM auth_sessions WHERE digest=? AND kind=?').get(hash(secret),kind);
      if(consume||row?.expires<=this.#clock())this.#db.prepare('DELETE FROM auth_sessions WHERE digest=?').run(hash(secret));
      const result=row&&row.expires>this.#clock()?this.#codec.decode(row.payload):null;this.#db.exec('COMMIT');return result;
    }catch(error){this.#db.exec('ROLLBACK');throw error;}
  }
  revoke(secret){if(secret)this.#db.prepare('DELETE FROM auth_sessions WHERE digest=?').run(hash(secret));}
  close(){this.#db.close();}
}

/** Adapter can be replaced by a host. The default uses maintained OIDC code + PKCE validation. */
export async function createOIDCProvider({issuer,clientId,clientSecret,origin,discoveryOptions}){
  const config=await oidc.discovery(new URL(issuer),clientId,clientSecret,undefined,discoveryOptions),redirectUri=origin+'/auth/callback';
  return {
    async begin(){const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
      const url=oidc.buildAuthorizationUrl(config,{redirect_uri:redirectUri,scope:'openid profile',response_type:'code',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce});
      return {url:url.href,data:{verifier,state,nonce}};
    },
    async finish(url,data){const tokens=await oidc.authorizationCodeGrant(config,url,{pkceCodeVerifier:data.verifier,expectedState:data.state,expectedNonce:data.nonce,idTokenExpected:true});
      const claims=tokens.claims();if(!claims?.sub||claims.iss!==config.serverMetadata().issuer)throw new Error('Identity claims missing');
      return {issuer:claims.iss,subject:claims.sub,displayName:String(claims.name??claims.preferred_username??'Collector').slice(0,100)||'Collector'};
    }
  };
}

export function createAuthHost({framework,sessions,provider,origin,adminSubjects=[],sessionTTL=7*86400000,secure=true,rateLimit=()=>true}){
  if(secure&&new URL(origin).protocol!=='https:')throw new Error('Authentication requires an HTTPS origin');
  const sessionName=secure?'__Host-dc_session':'dc_session',flowName=secure?'__Host-dc_flow':'dc_flow';
  const admins=new Set(adminSubjects),setCookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
  return {
    resolveIdentity(request){const session=sessions.get(cookie(request,sessionName),'session');return session?{userId:session.userId,role:admins.has(session.subject)?'admin':'player'}:null;},
    async handle(req,res){const url=new URL(req.url,origin);if(!url.pathname.startsWith('/auth/'))return false;
      res.setHeader('Cache-Control','no-store');
      try{
        if(!rateLimit({request:req,mutation:true})) {res.statusCode=429;res.end('Try again shortly');return true;}
        if(url.pathname==='/auth/login'&&req.method==='GET'){
          const started=await provider.begin(),flow=sessions.create('flow',started.data,10*60000);
          res.setHeader('Set-Cookie',setCookie(flowName,flow,600));res.statusCode=303;res.setHeader('Location',started.url);res.end();
        }else if(url.pathname==='/auth/callback'&&req.method==='GET'){
          const flow=sessions.get(cookie(req,flowName),'flow',{consume:true});if(!flow)throw new Error('Login expired');
          const identity=await provider.finish(url,flow);if(!identity?.issuer||!identity?.subject)throw new Error('Invalid identity');
          const user=framework.registerUser({role:'admin'},{provider:identity.issuer,subject:identity.subject,displayName:identity.displayName});
          sessions.revoke(cookie(req,sessionName));const secret=sessions.create('session',{userId:user.id,subject:identity.subject},sessionTTL);
          res.setHeader('Set-Cookie',[setCookie(flowName,'',0),setCookie(sessionName,secret,Math.floor(sessionTTL/1000))]);res.statusCode=303;res.setHeader('Location','/');res.end();
        }else if(url.pathname==='/auth/logout'&&req.method==='POST'){
          if(req.headers.origin!==origin){res.statusCode=403;res.end('Origin rejected');return true;}
          sessions.revoke(cookie(req,sessionName));res.setHeader('Set-Cookie',setCookie(sessionName,'',0));res.statusCode=204;res.end();
        }else {res.statusCode=404;res.end('Not found');}
      }catch {res.statusCode=400;res.setHeader('Set-Cookie',setCookie(flowName,'',0));res.end('Sign-in could not be completed. Start a new login.');}
      return true;
    }
  };
}
