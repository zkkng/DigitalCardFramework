import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { check } from './catalog.js';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

/** Server-only: keep the stable index key and rotating encryption keys outside the database. */
export function createCodeVault({ activeKeyId, keys, indexKey }) {
  check(typeof activeKeyId === 'string' && /^[\w.-]{1,80}$/.test(activeKeyId), 'CODE_KEYS', 'Invalid active code key ID');
  check(keys && Object.hasOwn(keys, activeKeyId), 'CODE_KEYS', 'Active code key is missing');
  const ring = Object.fromEntries(Object.entries(keys).map(([id, key]) => {
    check(Buffer.isBuffer(key) && key.length === 32, 'CODE_KEYS', 'Code encryption keys must be 32 bytes');
    return [id, Buffer.from(key)];
  }));
  check(Buffer.isBuffer(indexKey) && indexKey.length === 32, 'CODE_KEYS', 'Code index key must be 32 bytes');
  const index = Buffer.from(indexKey);
  return Object.freeze({
    fingerprint(value) { return createHmac('sha256', index).update(JSON.stringify(stable(value))).digest('hex'); },
    seal(code, context) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', ring[activeKeyId], iv);
      cipher.setAAD(Buffer.from('digital-card.code.v1:' + context));
      const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
      return { version: 1, keyId: activeKeyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
    open(envelope, context) {
      check(envelope?.version === 1 && Object.hasOwn(ring, envelope.keyId), 'CODE_KEYS', 'Code decryption key unavailable', 503);
      try {
        const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
        if(iv.length!==12||tag.length!==16)throw new Error('Invalid envelope');
        const cipher = createDecipheriv('aes-256-gcm', ring[envelope.keyId], iv, {authTagLength:16});
        cipher.setAAD(Buffer.from('digital-card.code.v1:' + context));
        cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString('utf8');
      } catch { check(false, 'CODE_INTEGRITY', 'Code could not be decrypted', 503); }
    },
  });
}
