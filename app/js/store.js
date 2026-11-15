// App state + tiny event bus + per-device persistence (localStorage, always guarded).

const KEY = 'tp:v1';
const JOURNAL_KEY = 'tp:journal';
const SAVED_KEY = 'tp:saved';

function rid(n = 10) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function defaults() {
  return {
    theme: 'dark',
    refreshSec: 30,
    deviceId: rid(10),
    newsSeenAt: 0,
    alertsSeenAt: 0,
    newsFilter: 'all',
    wlSort: 'custom',
    chartRange: '1D',
    gh: { token: '' },
    push: { registered: false, endpoint: '' },
    pendingConfig: null,
    calc: {},
  };
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

export const store = {
  app: {},           // app-config.json (repo, public keys, build)
  status: null,      // data/status.json
  news: null,        // data/news.json
  quotes: null,      // data/quotes.json
  alerts: null,      // data/alerts.json
  serverConfig: null, // data/config.json (what the scanner is using)
  symbols: null,     // data/symbols.json (lazy)
  history: new Map(),
  online: true,
  installPrompt: null,
  local: { ...defaults(), ...read(KEY, {}) },
};
if (!store.local.deviceId) store.local.deviceId = rid(10);

export const saveLocal = () => write(KEY, store.local);

export const loadJournal = () => read(JOURNAL_KEY, []);
export const saveJournal = (trades) => write(JOURNAL_KEY, trades);
export const loadSaved = () => read(SAVED_KEY, {});
export const saveSaved = (m) => write(SAVED_KEY, m);

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

/** Effective config: an unsaved/just-saved local edit wins until the scanner catches up. */
export function config() {
  return store.local.pendingConfig?.cfg || store.serverConfig || null;
}

export const quote = (sym) => store.quotes?.quotes?.[sym] || null;
export const ghConnected = () => !!(store.local.gh?.token && store.app?.owner && store.app?.repo);
