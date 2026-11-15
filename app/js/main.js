// App shell: router, header status, tab bar, polling, service worker.

import { store, on, saveLocal, config, ghConnected } from './store.js';
import { loadAppConfig, refresh, runScan } from './api.js';
import { $, esc, icon, toast, ago, when, sheet } from './ui.js';

const TABS = [
  ['home', 'Home', 'home'],
  ['news', 'News', 'news'],
  ['watchlist', 'Watchlist', 'list'],
  ['alerts', 'Alerts', 'bell'],
  ['more', 'More', 'grid'],
];

const ROUTES = [
  { re: /^#\/news(?:\/([\w-]+))?$/, view: 'news', tab: 'news' },
  { re: /^#\/watchlist$/, view: 'watchlist', tab: 'watchlist' },
  { re: /^#\/s\/(.+)$/, view: 'symbol', tab: 'watchlist', back: true },
  { re: /^#\/alerts$/, view: 'alerts', tab: 'alerts' },
  { re: /^#\/more$/, view: 'more', tab: 'more' },
  { re: /^#\/tools(?:\/(\w+))?$/, view: 'tools', tab: 'more', back: true },
  { re: /^#\/journal$/, view: 'journal', tab: 'more', back: true },
  { re: /^#\/settings$/, view: 'settings', tab: 'more', back: true },
  { re: /^#\/sources$/, view: 'sources', tab: 'more', back: true },
  { re: /^#\/help$/, view: 'help', tab: 'more', back: true },
  { re: /^#?\/?(?:home)?$/, view: 'home', tab: 'home' },
];

let current = null;
let navToken = 0;

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, label, ic]) =>
    `<button class="tab" data-tab="${id}" type="button" aria-label="${label}">${icon(ic, 23)}<span>${label}</span><span class="badge" hidden></span></button>`).join('');
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const target = `#/${b.dataset.tab}`;
    if (location.hash === target) window.scrollTo({ top: 0, behavior: 'smooth' });
    else location.hash = target;
  });
}

function setBadge(tab, n) {
  const el = $(`[data-tab="${tab}"] .badge`);
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
}

export function updateBadges() {
  const seenNews = store.local.newsSeenAt || Date.now() - 12 * 3600e3;
  const items = store.news?.items || [];
  const hotNew = items.filter((i) => (i.pub || i.seen) > seenNews && (i.syms || (i.imp || 0) >= 3)).length;
  setBadge('news', current?.view === 'news' ? 0 : hotNew);
  const seenAlerts = store.local.alertsSeenAt || 0;
  const newAlerts = (store.alerts?.items || []).filter((a) => a.ts > seenAlerts && a.type !== 'test').length;
  setBadge('alerts', current?.view === 'alerts' ? 0 : newAlerts);
}

function renderStatus() {
  const pill = $('#scan-status');
  const dot = pill.querySelector('.status-dot');
  const label = pill.querySelector('span');
  const s = store.status;
  if (!s) {
    dot.className = 'status-dot';
    label.textContent = store.online ? 'Loading…' : 'Offline';
    return;
  }
  const age = Date.now() - s.updatedAt;
  const cls = age < 12 * 60e3 ? 'live' : age < 35 * 60e3 ? 'late' : 'stale';
  dot.className = `status-dot ${store.online ? cls : ''}`;
  const a = ago(s.updatedAt);
  label.textContent = !store.online ? 'Offline' : a === 'now' ? 'Just scanned' : `Scanned ${a} ago`;
}

function showScanInfo() {
  const s = store.status;
  const okSources = s ? s.sources.filter((x) => x.ok).length : 0;
  sheet({
    title: 'Scanner status',
    body: s ? `
      <div class="kv"><span>Last scan</span><b>${esc(when(s.updatedAt))} (${esc(ago(s.updatedAt))} ago)</b></div>
      <div class="kv"><span>Next scheduled</span><b>${s.nextRunAt ? esc(when(s.nextRunAt)) : '—'}</b></div>
      <div class="kv"><span>News sources OK</span><b class="${okSources === s.sources.length ? 'ok' : 'warn'}">${okSources}/${s.sources.length}</b></div>
      <div class="kv"><span>Quotes</span><b class="${s.quotes?.ok ? 'ok' : 'warn'}">${s.quotes?.count ?? 0} symbols</b></div>
      <div class="kv"><span>New stories last scan</span><b>${s.counts?.fresh ?? 0}</b></div>
      <div class="kv"><span>Alerts last scan</span><b>${s.counts?.alerts ?? 0}</b></div>
      <div class="kv"><span>Devices for push</span><b>${s.push?.devices ?? 0}</b></div>
      <p class="note">GitHub runs the scanner every ~5 minutes on weekdays (every 15 on weekends). GitHub's scheduler can't go faster and is sometimes a few minutes late.</p>
      <div class="btn-row" style="margin-top:12px">
        <a class="btn grow" href="#/sources" data-close>Sources</a>
        ${s.runUrl ? `<a class="btn grow" href="${esc(s.runUrl)}" target="_blank" rel="noopener">Run log ${icon('external', 16)}</a>` : ''}
      </div>` : `<p class="muted">${store.error ? esc(store.error) : 'No scan data yet.'}</p>`,
  });
}

async function route() {
  const token = ++navToken;
  const hash = location.hash || '#/home';
  const r = ROUTES.find((x) => x.re.test(hash)) || ROUTES[ROUTES.length - 1];
  const params = (hash.match(r.re) || []).slice(1).map((p) => (p ? decodeURIComponent(p) : p));
  let mod;
  try {
    mod = await import(`./views/${r.view}.js`);
  } catch (err) {
    console.error(err);
    toast('Could not load this screen. Check your connection.', { error: true });
    return;
  }
  if (token !== navToken) return;
  if (current?.mod?.destroy) {
    try { current.mod.destroy(); } catch (e) { console.error(e); }
  }
  current = { view: r.view, mod, params };
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === r.tab);
  const back = $('#back');
  back.hidden = !r.back;
  $('#title').textContent = typeof mod.title === 'function' ? mod.title(params) : mod.title || 'TradePulse';
  const view = $('#view');
  view.className = `view view-${r.view}`;
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    mod.render(view, params);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty">${icon('info', 28)}<p>Something went wrong showing this screen.</p><p class="small faint">${esc(err.message)}</p></div>`;
  }
  updateBadges();
}

function onData() {
  renderStatus();
  updateBadges();
  if (current?.mod?.update) {
    try { current.mod.update($('#view'), current.params); } catch (e) { console.error(e); }
  }
}

// ---------------------------------------------------------------- polling
let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => {
    await refresh();
    autoScan();
    schedulePoll();
  }, Math.max(15, store.local.refreshSec || 30) * 1000);
}

/**
 * Backup for GitHub's scheduler (which can lag or skip runs): if the app is open and the
 * last scan is over 12 minutes old, start one via the GitHub API (at most every 10 minutes).
 */
async function autoScan() {
  const s = store.status;
  if (document.hidden || !store.online || !ghConnected() || !s?.updatedAt) return;
  const now = Date.now();
  if (now - s.updatedAt < 12 * 60e3 || now - (store.local.lastAutoScan || 0) < 10 * 60e3) return;
  store.local.lastAutoScan = now;
  saveLocal();
  try {
    await runScan();
    toast('Data was getting old — started a fresh scan (≈1 min)');
  } catch (e) {
    console.warn('auto scan failed', e);
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  renderTabs();
  $('#back').innerHTML = icon('back');
  $('#back').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/home')));
  $('#refresh').innerHTML = icon('refresh');
  $('#refresh').addEventListener('click', async () => {
    const ic = $('#refresh .ic');
    ic.classList.add('spin');
    await refresh({ force: true });
    ic.classList.remove('spin');
    toast(store.online ? `Up to date · scanned ${ago(store.status?.updatedAt)} ago` : 'Offline — showing saved data');
  });
  $('#scan-status').addEventListener('click', showScanInfo);

  on('data', onData);
  on('status', () => { renderStatus(); });
  on('config', () => onData());
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { store.online = true; refresh(); });
  window.addEventListener('offline', () => { store.online = false; renderStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(pollTimer);
    else { refresh(); schedulePoll(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    store.installPrompt = e;
    onData();
  });
  setInterval(renderStatus, 30000);

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((e) => console.warn('SW registration failed', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'route' && m.route) location.hash = m.route;
      if (m.type === 'push') refresh({ force: true });
      if (m.type === 'resubscribe') import('./views/alerts.js').then((v) => v.resync?.());
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('TradePulse was updated', { action: 'Reload', onAction: () => location.reload() });
    });
  }

  await loadAppConfig();
  route();
  await refresh({ force: true });
  autoScan();
  if (!store.news && !store.online) toast('Offline — connect to load market data', { error: true });
  schedulePoll();
  // Re-register push if the browser rotated the subscription since last time.
  import('./views/alerts.js').then((v) => v.resync?.()).catch(() => {});
  saveLocal();
}

window.__tp = { store, config };
boot();
