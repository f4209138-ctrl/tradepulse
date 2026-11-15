// Web Push: permission, subscription, and the sealed "device file" the scanner reads.

import { seal, unb64u } from './seal.js';

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function sameKey(buf, b64) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = unb64u(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export async function subscribe(vapidPublicKey) {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Notifications are blocked. In Chrome open ⋮ › Settings › Site settings › Notifications and allow this site.'
      : 'Notification permission was not granted.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, vapidPublicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(vapidPublicKey) });
  return sub;
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : 'Linux';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : 'Browser';
  return `${br} on ${os}`;
}

/** The file stored at subscriptions/<deviceId>.json — the subscription is encrypted. */
export async function deviceEnvelope(sub, inboxPublicKey, deviceId) {
  const sealed = await seal(inboxPublicKey, { subscription: sub.toJSON(), deviceId, createdAt: Date.now() });
  return { v: 1, label: deviceLabel(), createdAt: new Date().toISOString(), sealed };
}

export async function showLocalTest() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('📈 RELIANCE · Sample alert', {
    body: 'This is how TradePulse alerts will look on this phone.\nEconomic Times · Markets',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'local-test',
    data: { route: '#/alerts' },
  });
}
