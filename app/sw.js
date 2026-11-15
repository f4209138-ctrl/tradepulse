/* TradePulse service worker: offline app shell, cached data fallback, push alerts. */
const VERSION = 'dev';
const SHELL_CACHE = `tp-shell-${VERSION}`;
const DATA_CACHE = 'tp-data';

const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/store.js', './js/api.js', './js/github.js', './js/push.js', './js/seal.js',
  './js/ui.js', './js/market.js', './js/chart.js',
  './js/views/home.js', './js/views/news.js', './js/views/watchlist.js', './js/views/symbol.js',
  './js/views/alerts.js', './js/views/more.js', './js/views/tools.js', './js/views/journal.js',
  './js/views/settings.js', './js/views/sources.js', './js/views/help.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tp-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function dataKey(url) {
  const u = new URL(url);
  u.search = '';
  return u.href;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(dataKey(request.url), res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(dataKey(request.url), { cacheName: DATA_CACHE });
    if (cached) return cached;
    throw err;
  }
}

async function shellFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  const rel = url.pathname.slice(scopePath.length);
  if (rel.startsWith('data/') || rel === 'app-config.json') {
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
  } else {
    event.respondWith(shellFirst(req));
  }
});

// ---------------------------------------------------------------- push alerts
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: 'TradePulse', body: event.data ? event.data.text() : '' };
  }
  const title = d.title || 'TradePulse';
  const options = {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag && !d.silent,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    timestamp: d.ts || Date.now(),
    silent: !!d.silent,
    data: { url: d.url || null, route: d.route || '#/alerts' },
    actions: d.url ? [{ action: 'read', title: 'Read article' }] : [],
  };
  if (!d.silent) options.vibrate = [70, 40, 70];
  event.waitUntil(
    self.registration.showNotification(title, options).then(() =>
      self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'push', payload: d })))),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    if (event.action === 'read' && data.url) return self.clients.openWindow(data.url);
    const target = new URL(`./${data.route || '#/alerts'}`, self.registration.scope).href;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        await c.focus();
        c.postMessage({ type: 'route', route: data.route });
        return null;
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription. The app re-registers it on next open
  // (it compares the current endpoint with the one it registered).
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'resubscribe' }))));
});
