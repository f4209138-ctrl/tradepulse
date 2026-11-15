import { store, config, saveLocal, ghConnected, quote } from '../store.js';
import { $, esc, icon, when, toast, toastError, confirmSheet, switchHtml, unblockSteps } from '../ui.js';
import { baseSym } from '../market.js';
import { saveConfig, registerDevice, unregisterDevice, runScan } from '../api.js';
import { pushSupported, permission, currentSubscription, subscribe, deviceEnvelope, showLocalTest } from '../push.js';
import { needGitHub } from './watchlist.js';
import { openAlertSheet } from './symbol.js';

export const title = 'Alerts';

let st = null;

/** Make sure this device's current push subscription is the one stored in the repo. */
export async function resync() {
  try {
    if (!pushSupported() || permission() !== 'granted' || !store.app?.vapidPublicKey || !store.app?.inboxPublicKey) return;
    const sub = await currentSubscription();
    if (!sub) {
      if (store.local.push?.registered) { store.local.push = { registered: false, endpoint: '' }; saveLocal(); }
      return;
    }
    if (store.local.push?.registered && store.local.push.endpoint === sub.endpoint) return;
    if (!ghConnected()) return;
    await registerDevice(await deviceEnvelope(sub, store.app.inboxPublicKey, store.local.deviceId));
    store.local.push = { registered: true, endpoint: sub.endpoint };
    saveLocal();
  } catch (e) {
    console.warn('push resync failed', e);
  }
}

async function pushCard() {
  const box = $('#a-push', st.el);
  if (!box) return;
  const app = store.app || {};
  const devices = store.status?.push?.devices ?? 0;
  const onServer = (store.status?.push?.deviceIds || []).includes(store.local.deviceId);
  let html;
  if (!app.vapidPublicKey || !app.inboxPublicKey) {
    html = `<div class="row">${icon('info')}<div class="grow"><b>Push isn't configured on the server</b><p class="muted small" style="margin:2px 0 0">The repo is missing its VAPID / inbox keys (see README › Setup).</p></div></div>`;
  } else if (!pushSupported()) {
    html = `<div class="row">${icon('info')}<div class="grow"><b>This browser can't receive push alerts</b><p class="muted small" style="margin:2px 0 0">Use an up-to-date Firefox or Chrome on Android, and make sure the page is opened over https.</p></div></div>`;
  } else if (permission() === 'denied') {
    html = `<div class="row">${icon('bell')}<div class="grow"><b>Notifications are blocked</b><p class="muted small" style="margin:2px 0 0">${unblockSteps()} Then come back here.</p></div></div>`;
  } else {
    const sub = await currentSubscription().catch(() => null);
    const registered = !!sub && store.local.push?.registered && store.local.push.endpoint === sub.endpoint;
    if (!sub) {
      html = `<div class="row" style="align-items:flex-start">${icon('bell')}<div class="grow"><b>Push alerts are off on this phone</b>
        <p class="muted small" style="margin:2px 0 10px">The scanner runs on GitHub, so alerts arrive even when the app is closed. Uses almost no battery.</p>
        <button class="btn primary" data-push="enable" type="button">${icon('bell', 18)} Turn on push alerts</button></div></div>`;
    } else if (!registered) {
      html = `<div class="row" style="align-items:flex-start">${icon('phone')}<div class="grow"><b>One more step: register this phone</b>
        <p class="muted small" style="margin:2px 0 10px">${ghConnected() ? 'Saves this phone\'s (encrypted) push address in your repo so the scanner can reach it.' : 'Connect GitHub first — TradePulse stores this phone\'s encrypted push address in your repo.'}</p>
        ${ghConnected() ? `<button class="btn primary" data-push="register" type="button">Register this phone</button>` : `<a class="btn primary" href="#/settings">Connect GitHub</a>`}</div></div>`;
    } else {
      html = `<div class="row" style="align-items:flex-start"><span class="ok">${icon('check')}</span><div class="grow"><b>Alerts are on for this phone</b>
        <p class="muted small" style="margin:2px 0 10px">${onServer ? `Scanner sees ${devices} device${devices === 1 ? '' : 's'}.` : 'Registered — the scanner will pick it up on its next run (about a minute).'}</p>
        <div class="btn-row"><button class="btn sm primary" data-push="test" type="button">${icon('zap', 16)} Send test alert</button>
        <button class="btn sm" data-push="local" type="button">Preview</button>
        <button class="btn sm danger" data-push="off" type="button">Turn off</button></div></div></div>`;
    }
  }
  box.innerHTML = html;
}

async function onPush(action, btn) {
  btn.disabled = true;
  try {
    if (action === 'enable') {
      const sub = await subscribe(store.app.vapidPublicKey);
      if (ghConnected()) {
        await registerDevice(await deviceEnvelope(sub, store.app.inboxPublicKey, store.local.deviceId));
        store.local.push = { registered: true, endpoint: sub.endpoint };
        saveLocal();
        toast('Push alerts on · sending a test in ~1 min');
        runScan({ testPush: true }).catch(() => {});
      } else {
        toast('Notifications allowed — now connect GitHub to finish');
      }
    } else if (action === 'register') {
      const sub = await currentSubscription();
      await registerDevice(await deviceEnvelope(sub, store.app.inboxPublicKey, store.local.deviceId));
      store.local.push = { registered: true, endpoint: sub.endpoint };
      saveLocal();
      toast('Phone registered · sending a test in ~1 min');
      runScan({ testPush: true }).catch(() => {});
    } else if (action === 'test') {
      await runScan({ testPush: true });
      toast('Test requested — it arrives when the scan finishes (~1 min)');
    } else if (action === 'local') {
      await showLocalTest();
    } else if (action === 'off') {
      if (!(await confirmSheet('Turn off alerts on this phone?', 'This phone will stop receiving push alerts. Other devices are not affected.', { ok: 'Turn off', danger: true }))) return;
      const sub = await currentSubscription();
      await sub?.unsubscribe();
      if (ghConnected()) await unregisterDevice().catch(() => {});
      store.local.push = { registered: false, endpoint: '' };
      saveLocal();
      toast('Alerts turned off on this phone');
    }
  } catch (err) {
    if (err?.needsGitHub) needGitHub(err);
    else toastError(err);
  } finally {
    btn.disabled = false;
    pushCard();
  }
}

// ---------------------------------------------------------------- rules (staged, saved together)

function draftFromConfig() {
  const c = config() || {};
  return structuredClone({ alerts: c.alerts || {}, keywords: c.keywords || [], muteKeywords: c.muteKeywords || [] });
}

const RULES = [
  ['watchlistNews', 'Watchlist news', 'Headlines that mention your watchlist stocks'],
  ['filings', 'Exchange filings', 'NSE announcements, board meetings & corporate actions for your stocks (routine paperwork skipped)'],
  ['keywordNews', 'Keyword news', 'Headlines containing your keywords below'],
  ['breakingMarket', 'Big market news', 'High-impact stories even outside your watchlist — big Sensex/Nifty moves, RBI policy…'],
];

function rulesHtml() {
  const a = st.draft.alerts;
  return `
    ${RULES.map(([k, t, d]) => `<div class="opt"><div class="grow"><b>${t}</b><small>${d}</small></div>${switchHtml(`r-${k}`, a[k] !== false, t)}</div>`).join('')}
    <div class="opt"><div class="grow"><b>Big price moves</b><small>When a watchlist stock moves this much in a day</small></div>
      <input class="input num" style="width:76px;height:36px" name="r-bigpct" type="number" step="0.5" min="0.5" max="20" value="${esc(a.bigMove?.pct ?? 3)}" aria-label="Percent"><span class="muted">%</span>${switchHtml('r-bigMove', a.bigMove?.enabled !== false, 'Big price moves')}</div>
    <div class="opt"><div class="grow"><b>Minimum impact</b><small>For watchlist & keyword news</small></div>
      <select class="input" name="r-minImpact" style="width:auto;height:36px">
        ${[['any', 'Any'], ['medium', 'Medium +'], ['high', 'High only']].map(([v, l]) => `<option value="${v}"${(a.minImpact || 'any') === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select></div>
    <div class="opt" style="flex-wrap:wrap"><div class="grow"><b>Quiet hours</b><small>Alerts still arrive, but silently</small></div>
      ${switchHtml('r-quiet', a.quietHours?.enabled !== false, 'Quiet hours')}
      <div class="row" style="width:100%;gap:8px"><span class="small muted">From</span>
        <input class="input num grow" type="time" name="r-qstart" value="${esc(a.quietHours?.start || '22:30')}" style="height:36px" aria-label="Quiet from">
        <span class="small muted">to</span>
        <input class="input num grow" type="time" name="r-qend" value="${esc(a.quietHours?.end || '07:30')}" style="height:36px" aria-label="Quiet until"></div></div>
    <div class="opt"><div class="grow"><b>Max alerts per scan</b><small>Extra stories are bundled into one summary alert</small></div>
      <input class="input num" style="width:76px;height:36px" name="r-max" type="number" min="1" max="20" value="${esc(a.maxPerRun ?? 6)}" aria-label="Max alerts per scan"></div>`;
}

function chipsHtml(list, field) {
  return `<div class="chips" style="margin-bottom:10px">${list.length ? list.map((k, i) => `<button class="chip ${field === 'keywords' ? 'kw' : ''}" data-rm="${field}:${i}" type="button">${esc(k)}<span class="x">✕</span></button>`).join('') : '<span class="muted small">None</span>'}</div>
    <div class="row"><input class="input grow" data-add-input="${field}" placeholder="${field === 'keywords' ? 'e.g. Adani, crude oil, GST' : 'e.g. horoscope'}" maxlength="60" enterkeyhint="done"><button class="btn" data-add="${field}" type="button">Add</button></div>`;
}

function kwHtml() {
  return `<div class="small muted" style="margin-bottom:8px">Alert on headlines containing:</div>${chipsHtml(st.draft.keywords, 'keywords')}
    <hr class="sep"><div class="small muted" style="margin-bottom:8px">Hide stories containing (muted):</div>${chipsHtml(st.draft.muteKeywords, 'muteKeywords')}`;
}

function readRules(form) {
  const a = st.draft.alerts;
  const val = (n) => form.querySelector(`[name="${n}"]`);
  for (const [k] of RULES) a[k] = val(`r-${k}`).checked;
  a.bigMove = { enabled: val('r-bigMove').checked, pct: Math.min(20, Math.max(0.5, Number(val('r-bigpct').value) || 3)) };
  a.minImpact = val('r-minImpact').value;
  a.quietHours = { enabled: val('r-quiet').checked, start: val('r-qstart').value || '22:30', end: val('r-qend').value || '07:30' };
  a.maxPerRun = Math.min(20, Math.max(1, Math.round(Number(val('r-max').value) || 6)));
}

/** Unsaved edits = draft differs from the snapshot it was taken from. */
const dirty = () => JSON.stringify(st.draft) !== JSON.stringify(st.base);

function showSaveBar() {
  if (st) $('#a-savebar', st.el).hidden = !dirty();
}

async function saveRules() {
  const d = structuredClone(st.draft);
  try {
    await saveConfig((cfg) => {
      cfg.alerts = { ...(cfg.alerts || {}), ...d.alerts };
      cfg.keywords = d.keywords;
      cfg.muteKeywords = d.muteKeywords;
    }, 'Update alert rules from app');
    if (st) st.base = d;
    toast('Alert settings saved');
  } catch (err) {
    needGitHub(err);
  }
  showSaveBar();
}

// ---------------------------------------------------------------- price alerts & history

function priceHtml() {
  const list = config()?.priceAlerts || [];
  if (!list.length) return '<div class="empty small">No price alerts. Add one here or from any stock\'s page.</div>';
  const states = store.alerts?.priceAlerts || {};
  const opText = { above: '≥', below: '≤', pct_up: 'day ≥ +', pct_down: 'day ≤ −' };
  return list.map((a) => {
    const q = quote(a.symbol);
    const s = states[a.id];
    const val = a.op.startsWith('pct') ? `${Math.abs(a.value)}%` : a.value.toLocaleString('en-IN');
    const status = s?.firedAt ? `triggered ${when(s.firedAt)}` : a.enabled === false ? 'paused' : 'active';
    return `<div class="li" data-id="${esc(a.id)}"><a class="grow" href="#/s/${encodeURIComponent(a.symbol)}" style="color:inherit">
        <b>${esc(baseSym(a.symbol))} ${esc(opText[a.op])}${esc(val)}</b>
        <small>${q ? `now ${q.price.toLocaleString('en-IN')} · ` : ''}${esc(status)}${a.repeat ? ' · repeats' : ''}${a.note ? ` · ${esc(a.note)}` : ''}</small></a>
        ${switchHtml('pa-on', a.enabled !== false, 'Enabled')}
        <button class="icon-btn" data-del type="button" aria-label="Delete" style="color:var(--down)">${icon('trash', 20)}</button></div>`;
  }).join('');
}

const TYPE_ICON = { news: 'news', price: 'target', move: 'chart', summary: 'list', test: 'check' };
function historyHtml() {
  const items = store.alerts?.items || [];
  if (!items.length) return '<div class="empty small">No alerts in the last 7 days.</div>';
  return items.slice(0, 60).map((a) => `<a class="alert-li" href="${esc(a.route || '#/alerts')}">
      <span class="muted">${icon(TYPE_ICON[a.type] || 'bell', 20)}</span>
      <div class="grow"><div class="t">${esc(a.title)}</div><div class="b">${esc(a.body)}</div>
      <div class="w">${esc(when(a.ts))}${a.silent ? ' · silent (quiet hours)' : ''}${a.delivered === false ? ' · not delivered (no devices)' : ''}</div></div></a>`).join('');
}

export function render(el) {
  st = { el, base: draftFromConfig(), draft: draftFromConfig() };
  el.innerHTML = `
    <div class="card" id="a-push"></div>
    <div class="sec"><h2>Notify me about</h2></div>
    <form class="card tight" id="a-rules" onsubmit="return false"></form>
    <div class="sec"><h2>Keywords</h2></div>
    <div class="card" id="a-kw"></div>
    <div class="callout" id="a-savebar" hidden style="position:sticky;bottom:calc(var(--tab-h) + 12px + env(safe-area-inset-bottom));margin-top:12px;z-index:4">
      <div class="grow"><strong>Unsaved changes</strong><p>Saved to your repo; the scanner uses them on its next run.</p></div>
      <button class="btn" id="a-discard" type="button">Discard</button><button class="btn primary" id="a-save" type="button">Save</button></div>
    <div class="sec"><h2>Price alerts</h2><button class="link" id="a-addprice" type="button">+ Add</button></div>
    <div class="card tight" id="a-price"></div>
    <div class="sec"><h2>Recent alerts</h2><span class="small muted">last 7 days</span></div>
    <div class="card tight" id="a-history"></div>`;

  $('#a-push', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-push]');
    if (b) onPush(b.dataset.push, b);
  });
  const form = $('#a-rules', el);
  form.addEventListener('change', () => { readRules(form); showSaveBar(); });
  form.addEventListener('input', () => { readRules(form); showSaveBar(); });
  const kw = $('#a-kw', el);
  const addKw = (field) => {
    const input = kw.querySelector(`[data-add-input="${field}"]`);
    const v = input.value.trim();
    if (v.length < 2) return;
    if (!st.draft[field].some((x) => x.toLowerCase() === v.toLowerCase())) st.draft[field].push(v);
    kw.innerHTML = kwHtml();
    showSaveBar();
  };
  kw.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const [field, i] = rm.dataset.rm.split(':');
      st.draft[field].splice(+i, 1);
      kw.innerHTML = kwHtml();
      showSaveBar();
    }
    const add = e.target.closest('[data-add]');
    if (add) addKw(add.dataset.add);
  });
  kw.addEventListener('keydown', (e) => {
    const f = e.target.dataset?.addInput;
    if (f && e.key === 'Enter') { e.preventDefault(); addKw(f); }
  });
  $('#a-save', el).addEventListener('click', saveRules);
  $('#a-discard', el).addEventListener('click', () => {
    st.draft = structuredClone(st.base);
    form.innerHTML = rulesHtml();
    kw.innerHTML = kwHtml();
    showSaveBar();
  });
  $('#a-addprice', el).addEventListener('click', () => {
    const cfg = config() || {};
    const syms = [...new Set([...(cfg.watchlist || []).map((w) => w.symbol), ...(cfg.markets || [])])];
    if (!syms.length) { toast('Add stocks to your watchlist first'); return; }
    openAlertSheet(syms[0], { symbols: syms });
  });
  $('#a-price', el).addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const id = del.closest('[data-id]').dataset.id;
    try {
      await saveConfig((cfg) => { cfg.priceAlerts = (cfg.priceAlerts || []).filter((a) => a.id !== id); }, 'Delete price alert');
      toast('Alert deleted');
    } catch (err) { needGitHub(err); }
  });
  $('#a-price', el).addEventListener('change', async (e) => {
    if (e.target.name !== 'pa-on') return;
    const id = e.target.closest('[data-id]').dataset.id;
    const on = e.target.checked;
    try {
      await saveConfig((cfg) => {
        const a = (cfg.priceAlerts || []).find((x) => x.id === id);
        if (a) a.enabled = on;
      }, `${on ? 'Resume' : 'Pause'} price alert`);
    } catch (err) {
      e.target.checked = !on;
      needGitHub(err);
    }
  });

  form.innerHTML = rulesHtml();
  kw.innerHTML = kwHtml();
  update(el);
  store.local.alertsSeenAt = Date.now();
  saveLocal();
}

export function update(el) {
  if (!st) return;
  pushCard();
  // Pick up config changes (from another device or the first load) unless the user is mid-edit.
  const fresh = draftFromConfig();
  if (!dirty() && JSON.stringify(fresh) !== JSON.stringify(st.base)) {
    st.base = fresh;
    st.draft = structuredClone(fresh);
    $('#a-rules', el).innerHTML = rulesHtml();
    $('#a-kw', el).innerHTML = kwHtml();
  }
  $('#a-price', el).innerHTML = priceHtml();
  $('#a-history', el).innerHTML = historyHtml();
}

export function destroy() {
  store.local.alertsSeenAt = Date.now();
  saveLocal();
  st = null;
}
