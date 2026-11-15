import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import * as webpush from 'web-push';
import { seal } from '../../app/js/seal.js';
import { openSealed, generateInboxKeys } from '../lib/inbox.mjs';
import { loadDevices, gitBlobSha } from '../lib/notify.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

test('browser seal (WebCrypto) ↔ scanner open (node:crypto)', async () => {
  const keys = generateInboxKeys();
  const secret = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } }, n: 'ünïcødé ₹' };
  const env = await seal(keys.publicKey, secret);
  assert.equal(env.v, 1);
  assert.deepEqual(openSealed(env, keys.privateKey), secret);
  // tampering is detected
  const bad = { ...env, ct: env.ct.slice(0, -2) + (env.ct.endsWith('A') ? 'B' : 'A') + env.ct.slice(-1) };
  assert.throws(() => openSealed(bad, keys.privateKey));
  // a different key cannot open it
  assert.throws(() => openSealed(env, generateInboxKeys().privateKey));
});

test('device files are decrypted and blob shas match git', async () => {
  const keys = generateInboxKeys();
  const dir = mkdtempSync(join(tmpdir(), 'tp-subs-'));
  try {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: 'p', auth: 'a' } };
    writeFileSync(join(dir, 'dev1.json'), JSON.stringify({ v: 1, label: 'Chrome on Android', sealed: await seal(keys.publicKey, { subscription: sub }) }));
    writeFileSync(join(dir, 'broken.json'), '{"v":1,"sealed":{"v":1,"epk":"AA","iv":"AA","ct":"AA"}}');
    const logs = [];
    const devices = loadDevices(dir, keys.privateKey, (m) => logs.push(m));
    assert.equal(devices.length, 1);
    assert.deepEqual(devices[0].sub, sub);
    assert.equal(devices[0].path, 'subscriptions/dev1.json');
    assert.equal(logs.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('web push payload decrypts on the "phone" and the VAPID JWT verifies', () => {
  const vapid = webpush.generateVAPIDKeys();
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-token',
    keys: { p256dh: phone.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
  const payload = { v: 1, type: 'news', title: '📈 TCS · High impact', body: 'TCS wins ₹8,000 crore deal\nMint', route: '#/news/x' };
  const req = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: 'https://example.github.io/tradepulse/', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 3600,
    urgency: 'high',
  });
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(req.headers.Urgency, 'high');

  const plain = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: phone, authSecret: auth.toString('base64url') });
  assert.deepEqual(JSON.parse(plain.toString('utf8')), payload);

  const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.Authorization);
  assert.ok(m, 'vapid authorization header');
  assert.equal(m[2], vapid.publicKey);
  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://example.github.io/tradepulse/');
  assert.ok(claims.exp * 1000 > Date.now());
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});
