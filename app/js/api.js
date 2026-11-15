// Data loading (published JSON files) and writes back to the repo (config, devices, scans).

import { store, emit, saveLocal, config, ghConnected } from './store.js';
import { github } from './github.js';
import { histKey } from './market.js';

const BASE = new URL('./', location.href);
const dataUrl = (file) => new URL(`data/${file}`, BASE).href;

async function getJson(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').pop()}`);
  return res.json();
}

export async function loadAppConfig() {
  try {
    store.app = await getJson(new URL('app-config.json', BASE).href);
  } catch {
    store.app = store.app || {};
  }
}

function applyServerConfig(cfg) {
  store.serverConfig = cfg;
  const p = store.local.pendingConfig;
  if (p && ((cfg.rev || 0) >= (p.cfg.rev || 0) || Date.now() - p.at > 20 * 60e3)) {
    store.local.pendingConfig = null;
    saveLocal();
  }
}

let inflight = null;
/** Cheap poll: fetch status.json; only when the scanner published something new, fetch the rest. */
export function refresh({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const status = await getJson(dataUrl('status.json'));
      const changed = force || !store.news || status.updatedAt !== store.status?.updatedAt;
      store.status = status;
      store.online = true;
      store.error = null;
      if (changed) {
        const [news, quotes, alerts, cfg] = await Promise.all(
          ['news.json', 'quotes.json', 'alerts.json', 'config.json'].map((f) => getJson(dataUrl(f)).catch(() => null)),
        );
        if (news) store.news = news;
        if (quotes) store.quotes = quotes;
        if (alerts) store.alerts = alerts;
        if (cfg) applyServerConfig(cfg);
        emit('data');
      } else {
        emit('status');
      }
    } catch (err) {
      store.online = navigator.onLine;
      store.error = err.message;
      emit('status');
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function loadSymbols() {
  if (store.symbols) return store.symbols;
  const j = await getJson(dataUrl('symbols.json'));
  store.symbols = j.list || [];
  return store.symbols;
}

export async function loadHistory(sym) {
  // The scanner only keeps daily history for watchlist + Markets-strip symbols.
  const cfg = config();
  if (cfg && !(cfg.watchlist || []).some((w) => w.symbol === sym) && !(cfg.markets || []).includes(sym)) return null;
  const cached = store.history.get(sym);
  if (cached && Date.now() - cached.at < 30 * 60e3) return cached.data;
  try {
    const data = await getJson(dataUrl(`history/${histKey(sym)}.json`));
    store.history.set(sym, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- GitHub writes

export class NeedsGitHub extends Error {
  constructor() {
    super('Connect GitHub in Settings to save changes.');
    this.needsGitHub = true;
  }
}

export function gh() {
  if (!ghConnected()) throw new NeedsGitHub();
  const { owner, repo, branch } = store.app;
  return github({ owner, repo, branch: branch || 'main', token: store.local.gh.token });
}

/**
 * Apply `mutate(cfg)` to config.json in the repo (with retry on conflicting edits).
 * The change shows immediately in the app; the scanner picks it up on its next run
 * (a run starts right away because the commit triggers the workflow).
 */
export async function saveConfig(mutate, message = 'Update settings from app') {
  const client = gh();
  const before = store.local.pendingConfig;
  const optimistic = structuredClone(config() || {});
  mutate(optimistic);
  optimistic.rev = Date.now();
  store.local.pendingConfig = { cfg: optimistic, at: Date.now() };
  emit('config');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = await client.getFile('config.json');
      const cfg = JSON.parse(file.text);
      mutate(cfg);
      cfg.rev = Date.now();
      try {
        await client.putFile('config.json', `${JSON.stringify(cfg, null, 2)}\n`, file.sha, message);
        store.local.pendingConfig = { cfg, at: Date.now() };
        saveLocal();
        emit('config');
        return cfg;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
        throw e;
      }
    }
    throw new Error('Could not save — the file kept changing. Try again.');
  } catch (err) {
    store.local.pendingConfig = before;
    saveLocal();
    emit('config');
    throw err;
  }
}

export async function registerDevice(envelope) {
  const client = gh();
  const path = `subscriptions/${store.local.deviceId}.json`;
  const sha = await client.fileSha(path);
  await client.putFile(path, `${JSON.stringify(envelope, null, 2)}\n`, sha, `Register device for push alerts (${envelope.label})`);
}

export async function unregisterDevice() {
  const client = gh();
  const path = `subscriptions/${store.local.deviceId}.json`;
  const sha = await client.fileSha(path);
  if (sha) await client.deleteFile(path, sha, 'Remove device from push alerts');
}

/** Start a scan now (optionally sending a test notification to every device). */
export async function runScan({ testPush = false } = {}) {
  const client = gh();
  return client.dispatch(store.app.workflow || 'scan.yml', testPush ? { test_push: 'true' } : {});
}
