// Encrypt a JSON value to the scanner's "inbox" public key so it can be stored in a
// public repo: ECDH P-256 → HKDF-SHA256 → AES-256-GCM. Only the scanner (which holds
// the private key as a GitHub secret) can decrypt it. Works in browsers and Node 20+.

const INFO = 'tradepulse-inbox-v1';

export function b64u(bytes) {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function seal(recipientPublicKey, value) {
  const subtle = globalThis.crypto.subtle;
  const recipient = await subtle.importKey('raw', unb64u(recipientPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: epk, info: new TextEncoder().encode(INFO) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return { v: 1, alg: 'ECDH-P256/HKDF-SHA256/A256GCM', epk: b64u(epk), iv: b64u(iv), ct: b64u(ct) };
}
