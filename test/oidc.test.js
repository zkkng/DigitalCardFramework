import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {customFetch} from 'openid-client';
import {createOIDCProvider} from '../src/auth.js';

test('real OIDC client binds PKCE, state and nonce and rejects a mismatched issuer or nonce',async()=>{
  const issuer='https://issuer.example',origin='https://cards.example',clientId='test-client',pair=generateKeyPairSync('rsa',{modulusLength:2048});let started,wrongNonce=false,wrongIssuer=false,tokenCalls=0;
  const jwk={...pair.publicKey.export({format:'jwk'}),kid:'one',use:'sig',alg:'RS256'},json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const jwt=claims=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'one',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),text=header+'.'+payload;return text+'.'+sign('RSA-SHA256',Buffer.from(text),pair.privateKey).toString('base64url');};
  const provider=await createOIDCProvider({issuer,origin,clientId,discoveryOptions:{[customFetch]:async(input,options)=>{
    const url=new URL(input);if(url.pathname.includes('.well-known'))return json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['none']});
    if(url.pathname==='/jwks')return json({keys:[jwk]});if(url.pathname==='/token'){tokenCalls++;const body=new URLSearchParams(options.body);assert.equal(body.get('redirect_uri'),origin+'/auth/callback');assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),new URL(started.url).searchParams.get('code_challenge'));
      return json({access_token:'access',token_type:'Bearer',expires_in:300,id_token:jwt({iss:wrongIssuer?'https://other.example':issuer,sub:'subject',aud:clientId,exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),nonce:wrongNonce?'wrong':started.data.nonce,name:'Collector'})});}throw new Error('Unexpected OIDC request');
  }}});
  started=await provider.begin();assert.equal(new URL(started.url).searchParams.get('code_challenge_method'),'S256');
  const url=new URL(origin+'/auth/callback?code=code&state='+started.data.state);const verified=await provider.finish(url,started.data);assert.equal(verified.subject,'subject');assert.equal(verified.issuer,issuer);
  await assert.rejects(()=>provider.finish(new URL(origin+'/auth/callback?code=code&state=wrong'),started.data));assert.equal(tokenCalls,1);
  wrongNonce=true;await assert.rejects(()=>provider.finish(url,started.data));wrongNonce=false;wrongIssuer=true;await assert.rejects(()=>provider.finish(url,started.data));
});
