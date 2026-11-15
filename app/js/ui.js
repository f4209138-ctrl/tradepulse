// DOM helpers, formatters (Indian number format), icons, toast, bottom sheet, sparkline.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------- numbers
const nfCache = new Map();
function nf(dp) {
  let f = nfCache.get(dp);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    nfCache.set(dp, f);
  }
  return f;
}
export const num = (v) => (v === '' || v == null ? NaN : Number(String(v).replace(/,/g, '')));
export const fmt = (n, dp = 2) => (Number.isFinite(n) ? nf(dp).format(n) : '—');
export function fmtSigned(n, dp = 2) {
  if (!Number.isFinite(n)) return '—';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + nf(dp).format(Math.abs(n));
}
export function fmtPct(n, dp = 2) {
  if (!Number.isFinite(n)) return '—';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(dp) + '%';
}
/** 1.25 Cr · 45.2 L · 12.3K (Indian units) */
export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return a >= 1e10 ? `${nf(0).format(n / 1e7)} Cr` : `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
export const rupee = (n, dp = 2) => (Number.isFinite(n) ? `${n < 0 ? '−' : ''}₹${nf(dp).format(Math.abs(n))}` : '—');
export const dir = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

// ---------------------------------------------------------------- time
export function ago(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
const tf = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const df = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const wf = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });
export const clockTime = (ts) => (ts ? tf.format(ts) : '');
export const shortDate = (ts) => (ts ? df.format(ts) : '');
/** "14:05" today · "Thu 15:30" this week · "12 Nov" older */
export function when(ts, now = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return tf.format(d);
  if (now - ts < 6 * 86400e3) return `${wf.format(d)} ${tf.format(d)}`;
  return df.format(d);
}

// ---------------------------------------------------------------- icons
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2H6"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h3.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3.5 6h17M9 6V4h6v2M18.5 6l-.9 14a1 1 0 0 1-1 .9H7.4a1 1 0 0 1-1-.9L5.5 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  bookmark: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
  bookmarked: '<path d="M6 3.5h12v17l-6-4-6 4z" fill="currentColor"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  starred: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  book: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 19.5v-15M9 7h7"/>',
  rss: '<path d="M5 11a8 8 0 0 1 8 8M5 4.5a14.5 14.5 0 0 1 14.5 14.5"/><circle cx="6" cy="18" r="1.2" fill="currentColor"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.5v.8M12 17h.01"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="m7.5 15 4-4.5 3 3 5.5-6.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4"/>',
  zap: '<path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z"/>',
  building: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9.5 21v-5h5v5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4.5 20h15"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4.5 4h15"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-2.4-1.6M2 8.8a15 15 0 0 1 4.6-2.9M22 8.8A15 15 0 0 0 11 5M12 20h.01"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
};
export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(msg, { action, onAction, ms = 3200, error = false } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn" type="button">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('.toast-btn').onclick = () => { el.classList.remove('show'); onAction?.(); };
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? ms * 2 : ms);
}
export const toastError = (err) => toast(err?.message || String(err), { error: true, ms: 5000 });

// ---------------------------------------------------------------- bottom sheet
/** Opens a bottom sheet. Android back button closes it. Returns close(). */
export function sheet({ title, body, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close type="button" aria-label="Close">${icon('x')}</button></header>
    <div class="sheet-body">${body}</div></section>`;
  document.body.appendChild(wrap);
  let closed = false;
  const onPop = () => close(true);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  /** Resolves once the history entry pushed for the sheet has been popped. */
  function close(fromPop = false) {
    if (closed) return Promise.resolve();
    closed = true;
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
    if (fromPop) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { window.removeEventListener('popstate', done); resolve(); };
      window.addEventListener('popstate', done);
      setTimeout(done, 400);
      history.back();
    });
  }
  history.pushState({ sheet: true }, '');
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      close().then(() => { location.hash = link.getAttribute('href'); });
      return;
    }
    if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-close]')) close();
  });
  requestAnimationFrame(() => wrap.classList.add('open'));
  onMount?.(wrap.querySelector('.sheet'), close);
  return close;
}

export function confirmSheet(title, message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet({
      title,
      body: `<p class="muted" style="margin:0 0 16px">${esc(message)}</p>
        <div class="btn-row"><button class="btn grow" data-close type="button">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'} grow" data-ok type="button">${esc(ok)}</button></div>`,
      onMount(el, close) {
        el.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); close(); };
      },
      onClose() { if (!answered) resolve(false); },
    });
  });
}

// ---------------------------------------------------------------- sparkline
export function sparkline(values, { w = 72, h = 26, prev = null, cls = '' } = {}) {
  const v = (values || []).filter(Number.isFinite);
  if (v.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"></svg>`;
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (Number.isFinite(prev)) { min = Math.min(min, prev); max = Math.max(max, prev); }
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const pad = 2;
  const x = (i) => ((i / (v.length - 1)) * w).toFixed(1);
  const y = (n) => (pad + (1 - (n - min) / span) * (h - pad * 2)).toFixed(1);
  const pts = v.map((n, i) => `${x(i)},${y(n)}`).join(' ');
  const base = Number.isFinite(prev) ? `<line class="spark-base" x1="0" x2="${w}" y1="${y(prev)}" y2="${y(prev)}"/>` : '';
  return `<svg class="spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${base}<polyline points="${pts}"/></svg>`;
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export function switchHtml(name, checked, label = '') {
  return `<label class="switch"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} aria-label="${esc(label || name)}"><span></span></label>`;
}

// ---------------------------------------------------------------- browser-specific help
export function browserName() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/EdgA?\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/Chrome\//.test(ua)) return 'chrome';
  return 'other';
}
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** How to add the app to the home screen in this browser (HTML). */
export function installSteps() {
  return {
    firefox: 'In Firefox tap the <b>⋮</b> menu (bottom-right or top-right) › <b>Add app to Home screen</b> (older versions: <b>Install</b> or <b>Add to Home screen</b>) › <b>Add</b>.',
    chrome: 'In Chrome tap <b>⋮</b> › <b>Install app</b> (or <b>Add to Home screen</b>).',
    samsung: 'In Samsung Internet tap <b>≡</b> › <b>Add page to</b> › <b>Home screen</b>.',
    edge: 'In Edge tap <b>⋯</b> › <b>Add to phone</b> / <b>Add to Home screen</b>.',
    opera: 'In Opera tap <b>⋮</b> › <b>Add to</b> › <b>Home screen</b>.',
    other: 'Open your browser menu and choose <b>Add to Home screen</b> (or <b>Install</b>).',
  }[browserName()];
}

/** How to un-block notifications for this site in this browser (HTML). */
export function unblockSteps() {
  return {
    firefox: 'Tap the <b>lock icon</b> left of the address › <b>Notifications</b> › Allow — or Firefox <b>⋮</b> › Settings › Site permissions › Notifications. Also check Android Settings › Apps › Firefox › Notifications is on.',
    chrome: 'Chrome <b>⋮</b> › Settings › Site settings › Notifications › allow this site (or long-press the app icon › App info › Notifications).',
    samsung: 'Samsung Internet <b>≡</b> › Settings › Sites and downloads › Notifications › allow this site.',
  }[browserName()] || 'Open your browser\'s site settings and allow notifications for this site.';
}
