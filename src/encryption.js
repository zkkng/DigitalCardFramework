import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export function createStateCodec(key){
  if(key!==undefined&&(!Buffer.isBuffer(key)||key.length!==32))throw new Error('State encryption requires a 32-byte key');
  return {
    encode(value){const plaintext=JSON.stringify(value);if(!key)return plaintext;const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('digital-card.state.v1'));const data=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);return JSON.stringify({encrypted:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});},
    decode(body){const value=JSON.parse(body);if(value.encrypted!==1){if(key)throw new Error('Refusing plaintext state with encryption enabled; migrate into a fresh encrypted database');return value;}if(!key)throw new Error('An encryption key is required for this database');try{const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));cipher.setAAD(Buffer.from('digital-card.state.v1'));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));}catch{throw new Error('Encrypted state authentication failed');}}
  };
}
export function keyFromHex(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))throw new Error('STATE_ENCRYPTION_KEY must be 64 hexadecimal characters');return Buffer.from(value,'hex');}
