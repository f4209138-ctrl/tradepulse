// Counterpart of app/js/seal.js: decrypts envelopes sealed to the inbox public key.
import { createECDH, hkdfSync, createDecipheriv } from 'node:crypto';

const INFO = Buffer.from('tradepulse-inbox-v1');

export function openSealed(envelope, privateKeyB64u) {
  if (!envelope || envelope.v !== 1 || !envelope.epk || !envelope.iv || !envelope.ct) {
    throw new Error('not a sealed envelope (v1)');
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKeyB64u, 'base64url'));
  const epk = Buffer.from(envelope.epk, 'base64url');
  const shared = ecdh.computeSecret(epk);
  const key = Buffer.from(hkdfSync('sha256', shared, epk, INFO, 32));
  const buf = Buffer.from(envelope.ct, 'base64url');
  if (buf.length < 17) throw new Error('ciphertext too short');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  const plain = Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

export function generateInboxKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = ecdh.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(Math.max(0, 32 - priv.length)), priv]);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: padded.toString('base64url') };
}
