import { store, config, quote } from '../store.js';
import { $, esc, fmt, fmtSigned, fmtPct, fmtCompact, dir, icon, ago, when, toast, sheet, confirmSheet } from '../ui.js';
import { baseSym, isEquity, instrumentName, tradingViewUrl, nseUrl, screenerUrl, pivots, pivotBasis } from '../market.js';
import { loadHistory, saveConfig } from '../api.js';
import { createChart } from '../chart.js';
import { needGitHub } from './watchlist.js';

export const title = (p) => instrumentName(p?.[0]) || baseSym(p?.[0] || '');

const RANGES = [['1D', 0], ['1M', 22], ['3M', 66], ['6M', 130], ['1Y', 0]];
const OPS = { above: 'Price ≥', below: 'Price ≤', pct_up: 'Day change ≥ +', pct_down: 'Day change ≤ −' };
let st = null;

const dayIST = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);

export function render(el, [sym]) {
  st = { el, sym, range: store.local.chartRange || '1D', type: 'candle', hist: null, histLoaded: false, pivMethod: 'classic', chart: null };
  const inMarkets = (config()?.markets || []).includes(sym);
  el.innerHTML = `
    <div class="quote-head">
      <div class="grow">
        <div class="muted small ellipsis" id="sy-name">${esc(instrumentName(sym) || '')}</div>
        <div class="big num" id="sy-price">—</div>
        <div class="chg num" id="sy-chg"></div>
        <div class="small faint" id="sy-time"></div>
      </div>
      <button class="btn sm" id="sy-star" type="button"></button>
    </div>
    <div class="chart-box" id="sy-chart"><div class="chart-legend num" id="sy-legend"></div></div>
    <div class="chart-tools">
      <div class="seg" id="sy-range">${RANGES.map(([r]) => `<button data-r="${r}" type="button">${r}</button>`).join('')}</div>
      <div class="seg" id="sy-type"><button data-t="line" type="button">Line</button><button data-t="candle" type="button">Candles</button></div>
    </div>
    <p class="note" id="sy-chartnote" hidden></p>
    <div class="sec"><h2>Key stats</h2></div>
    <div class="card"><div class="stats" id="sy-stats"></div></div>
    <div class="sec"><h2>Pivot levels</h2><span class="small muted" id="sy-pvbasis"></span></div>
    <div class="card" id="sy-pivots"></div>
    <div class="sec"><h2>Price alerts</h2><button class="link" id="sy-addalert" type="button">+ Add alert</button></div>
    <div class="card tight" id="sy-alerts"></div>
    <div class="sec"><h2>News</h2><a href="#/news">All news ›</a></div>
    <div class="card tight" id="sy-news"></div>
    <div class="sec"><h2>Research</h2></div>
    <div class="links">
      <a class="btn" href="${esc(tradingViewUrl(sym))}" target="_blank" rel="noopener">TradingView ${icon('external', 14)}</a>
      ${isEquity(sym) ? `<a class="btn" href="${esc(nseUrl(sym))}" target="_blank" rel="noopener">NSE ${icon('external', 14)}</a>
      <a class="btn" href="${esc(screenerUrl(sym))}" target="_blank" rel="noopener">Screener ${icon('external', 14)}</a>` : ''}
    </div>
    ${isEquity(sym) ? `<div class="sec"><h2>News matching</h2><button class="link" id="sy-aliases" type="button">Edit</button></div><p class="note" id="sy-match" style="margin-top:0"></p>` : ''}
    ${inMarkets ? '<p class="note">This is in your Markets strip (Settings › Markets strip).</p>' : ''}`;

  st.chart = createChart($('#sy-chart', el), { onHover: legend });
  $('#sy-range', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    st.range = b.dataset.r;
    store.local.chartRange = st.range;
    drawChart();
  });
  $('#sy-type', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    st.type = b.dataset.t;
    drawChart();
  });
  $('#sy-star', el).addEventListener('click', toggleWatch);
  $('#sy-addalert', el).addEventListener('click', () => openAlertSheet(sym));
  $('#sy-alerts', el).addEventListener('click', onAlertClick);
  $('#sy-pivots', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-pm]');
    if (!b) return;
    st.pivMethod = b.dataset.pm;
    drawPivots();
  });
  $('#sy-aliases', el)?.addEventListener('click', editAliases);

  loadHistory(sym).then((h) => {
    if (!st || st.sym !== sym) return;
    st.hist = h;
    st.histLoaded = true;
    drawChart();
    drawPivots();
  });
  update(el);
}

function legend(i, d) {
  const box = $('#sy-legend', st?.el);
  if (!box) return;
  if (i == null || !d) { box.textContent = ''; return; }
  const ts = d.t[i];
  const t = d.intraday ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const dp = d.dp ?? 2;
  box.textContent = d.o && d.type === 'candle'
    ? `${t}  O ${fmt(d.o[i], dp)}  H ${fmt(d.h[i], dp)}  L ${fmt(d.l[i], dp)}  C ${fmt(d.c[i], dp)}`
    : `${t}  ${fmt(d.c[i], dp)}`;
}

/** Daily history with today's live candle merged in. */
function dailySeries(q) {
  const h = st.hist;
  if (!h?.t?.length) return null;
  const s = { t: [...h.t], o: [...h.o], h: [...h.h], l: [...h.l], c: [...h.c], v: [...h.v], dp: h.dp ?? q?.dp ?? 2 };
  if (q?.time && Number.isFinite(q.price)) {
    const qd = dayIST(q.time);
    const ld = dayIST(s.t[s.t.length - 1]);
    const open = q.spark?.c?.[0] ?? q.prev ?? q.price;
    if (qd > ld) {
      s.t.push(q.time); s.o.push(open); s.h.push(q.high ?? q.price); s.l.push(q.low ?? q.price); s.c.push(q.price); s.v.push(q.vol || 0);
    } else if (qd === ld) {
      const k = s.t.length - 1;
      s.c[k] = q.price;
      if (Number.isFinite(q.high)) s.h[k] = Math.max(s.h[k], q.high);
      if (Number.isFinite(q.low)) s.l[k] = Math.min(s.l[k], q.low);
    }
  }
  return s;
}

function drawChart() {
  if (!st) return;
  const el = st.el;
  const q = quote(st.sym);
  el.querySelectorAll('#sy-range [data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === st.range));
  el.querySelectorAll('#sy-type [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === st.type));
  $('#sy-type', el).hidden = st.range === '1D';
  const note = $('#sy-chartnote', el);
  note.hidden = true;
  if (st.range === '1D') {
    const sp = q?.spark;
    if (!sp?.c?.length) { st.chart.set(null); note.hidden = false; note.textContent = 'Intraday chart appears after the next scan.'; return; }
    st.chart.set({ t: sp.dt.map((m) => sp.t0 + m * 60000), c: sp.c, prev: q.prev, dp: q.dp, intraday: true, type: 'line' });
    return;
  }
  const s = dailySeries(q);
  if (!s) {
    st.chart.set(null);
    note.hidden = false;
    note.textContent = st.histLoaded
      ? 'Longer charts are kept for your watchlist and market symbols. Add this to your watchlist, or open it in TradingView.'
      : 'Loading chart…';
    return;
  }
  const n = RANGES.find(([r]) => r === st.range)[1] || s.t.length;
  const from = Math.max(0, s.t.length - n);
  const cut = (a) => a.slice(from);
  st.chart.set({ t: cut(s.t), o: cut(s.o), h: cut(s.h), l: cut(s.l), c: cut(s.c), v: cut(s.v), dp: s.dp, type: st.type, intraday: false });
}

function drawPivots() {
  if (!st) return;
  const el = st.el;
  const q = quote(st.sym);
  const basis = pivotBasis(st.hist, q);
  const box = $('#sy-pivots', el);
  if (!basis) {
    box.innerHTML = `<p class="muted small" style="margin:0">${st.histLoaded ? 'Pivots need daily history — available for watchlist and market symbols.' : 'Loading…'}</p>`;
    $('#sy-pvbasis', el).textContent = '';
    return;
  }
  const pv = pivots(basis.h, basis.l, basis.c);
  const dp = q?.dp ?? 2;
  $('#sy-pvbasis', el).textContent = `from ${basis.label}`;
  const rows = pv[st.pivMethod] || pv.classic;
  box.innerHTML = `
    <div class="seg full" style="margin-bottom:10px">${[['classic', 'Classic'], ['fibonacci', 'Fibonacci'], ['camarilla', 'Camarilla'], ['woodie', 'Woodie']]
      .map(([k, l]) => `<button data-pm="${k}" class="${k === st.pivMethod ? 'on' : ''}" type="button">${l}</button>`).join('')}</div>
    <table class="pivots num">${rows.map(([k, v]) => `<tr class="${k[0] === 'R' ? 'r' : k[0] === 'S' ? 's' : 'p'}"><td>${k}</td><td>${fmt(v, dp)}</td></tr>`).join('')}</table>
    <div class="kv" style="margin-top:8px"><span>CPR (TC / P / BC)</span><b class="num">${fmt(pv.cpr.tc, dp)} / ${fmt(pv.cpr.p, dp)} / ${fmt(pv.cpr.bc, dp)}</b></div>
    <div class="kv"><span>CPR width</span><b class="num">${pv.cpr.widthPct.toFixed(2)}% ${pv.cpr.widthPct < 0.25 ? '· narrow (trend day?)' : pv.cpr.widthPct > 0.75 ? '· wide (range day?)' : ''}</b></div>
    <div class="kv"><span>Based on H / L / C</span><b class="num">${fmt(basis.h, dp)} / ${fmt(basis.l, dp)} / ${fmt(basis.c, dp)}</b></div>`;
}

function stat(label, value, cls = '') {
  return `<div class="stat"><span>${label}</span><b class="num ${cls}">${value}</b></div>`;
}

function alertsHtml() {
  const list = (config()?.priceAlerts || []).filter((a) => a.symbol === st.sym);
  if (!list.length) return '<div class="empty small">No price alerts for this symbol.</div>';
  const states = store.alerts?.priceAlerts || {};
  const q = quote(st.sym);
  return list.map((a) => {
    const s = states[a.id];
    const val = a.op.startsWith('pct') ? `${Math.abs(a.value)}%` : fmt(a.value, q?.dp ?? 2);
    const status = s?.firedAt ? `Triggered ${when(s.firedAt)}${a.repeat ? ' · repeats' : ''}` : a.enabled === false ? 'Paused' : a.repeat ? 'Active · repeats' : 'Active · once';
    return `<div class="li" data-id="${esc(a.id)}"><div class="grow"><b>${esc(OPS[a.op])}${esc(val)}</b><small>${esc(status)}${a.note ? ` · ${esc(a.note)}` : ''}</small></div>
      <button class="icon-btn" data-del type="button" aria-label="Delete alert" style="color:var(--down)">${icon('trash', 20)}</button></div>`;
  }).join('');
}

function newsHtml() {
  const items = (store.news?.items || []).filter((i) => i.syms?.includes(st.sym) || i.ment?.includes(st.sym)).slice(0, 15);
  if (!items.length) return '<div class="empty small">No recent stories mention this stock.</div>';
  return items.map((i) => `<a class="alert-li" href="#/news/${esc(i.id)}"><div class="grow">
      <div class="ni-meta"><span class="src">${esc(i.via || store.news.sources?.[i.src] || i.src)}</span><span>· ${esc(ago(i.pub || i.seen))}</span>${i.syms?.includes(st.sym) ? '' : '<span class="tag med">mentioned</span>'}${i.kind === 'filing' ? '<span class="tag filing">Filing</span>' : ''}</div>
      <div style="font-weight:600;margin-top:3px">${esc(i.title)}</div></div></a>`).join('');
}

export function update(el) {
  if (!st) return;
  const q = quote(st.sym);
  const w = (config()?.watchlist || []).find((x) => x.symbol === st.sym);
  $('#sy-name', el).textContent = q?.name || w?.name || instrumentName(st.sym) || '';
  $('#sy-price', el).textContent = q ? fmt(q.price, q.dp ?? 2) : '—';
  const chg = $('#sy-chg', el);
  chg.className = `chg num ${dir(q?.chgPct)}`;
  chg.textContent = q ? `${fmtSigned(q.chg, q.dp ?? 2)} (${fmtPct(q.chgPct)})` : 'No quote yet — add to watchlist to track it';
  $('#sy-time', el).textContent = q?.time ? `${q.exch || ''} · as of ${when(q.time)}` : '';
  $('#sy-star', el).innerHTML = w ? `${icon('starred', 16)} Watching` : `${icon('star', 16)} Watch`;
  $('#sy-star', el).classList.toggle('primary', !!w);

  if (q) {
    const dp = q.dp ?? 2;
    const fromHigh = Number.isFinite(q.w52h) && q.w52h ? ((q.price - q.w52h) / q.w52h) * 100 : null;
    const range52 = q.w52h > q.w52l ? ((q.price - q.w52l) / (q.w52h - q.w52l)) * 100 : null;
    $('#sy-stats', el).innerHTML = [
      stat('Prev close', fmt(q.prev, dp)),
      stat('Day high', fmt(q.high, dp)),
      stat('Day low', fmt(q.low, dp)),
      stat('Volume', q.vol ? fmtCompact(q.vol) : '—'),
      stat('52W high', fmt(q.w52h, dp)),
      stat('52W low', fmt(q.w52l, dp)),
      stat('From 52W high', fromHigh != null ? fmtPct(fromHigh) : '—', dir(fromHigh)),
      stat('52W position', range52 != null ? `${range52.toFixed(0)}%` : '—'),
      stat('Exchange', esc(q.exch || '—')),
    ].join('');
  } else {
    $('#sy-stats', el).innerHTML = '<p class="muted small" style="margin:0">Quotes are fetched for your watchlist, Markets strip and NIFTY 50 stocks.</p>';
  }
  $('#sy-alerts', el).innerHTML = alertsHtml();
  $('#sy-news', el).innerHTML = newsHtml();
  const m = $('#sy-match', el);
  if (m) {
    const terms = [baseSym(st.sym), ...(w?.name ? [w.name.replace(/\s+(Limited|Ltd\.?)$/i, '')] : []), ...(w?.aliases || [])];
    m.textContent = w
      ? `Headlines are matched when they mention: ${[...new Set(terms)].join(' · ')}. NSE filings match the exact company name.`
      : 'Add this stock to your watchlist to get news alerts for it.';
  }
  drawChart();
  drawPivots();
}

export function destroy() {
  st?.chart?.destroy();
  st = null;
}

// ---------------------------------------------------------------- actions

async function toggleWatch() {
  const sym = st.sym;
  const inList = (config()?.watchlist || []).some((w) => w.symbol === sym);
  if (inList && !(await confirmSheet('Remove from watchlist?', `${baseSym(sym)} will no longer be scanned for news.`, { ok: 'Remove', danger: true }))) return;
  const q = quote(sym);
  try {
    await saveConfig((cfg) => {
      cfg.watchlist ||= [];
      if (inList) cfg.watchlist = cfg.watchlist.filter((w) => w.symbol !== sym);
      else if (!cfg.watchlist.some((w) => w.symbol === sym)) cfg.watchlist.push({ symbol: sym, name: q?.name || instrumentName(sym) || null, aliases: [] });
    }, `${inList ? 'Remove' : 'Add'} ${baseSym(sym)} ${inList ? 'from' : 'to'} watchlist`);
    toast(inList ? 'Removed from watchlist' : 'Added · scanning now');
  } catch (err) {
    needGitHub(err);
  }
}

async function onAlertClick(e) {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  const id = del.closest('[data-id]').dataset.id;
  try {
    await saveConfig((cfg) => { cfg.priceAlerts = (cfg.priceAlerts || []).filter((a) => a.id !== id); }, 'Delete price alert');
    toast('Alert deleted');
  } catch (err) {
    needGitHub(err);
  }
}

export function openAlertSheet(sym, { symbols } = {}) {
  const q = quote(sym);
  const dp = q?.dp ?? 2;
  sheet({
    title: 'New price alert',
    body: `
      ${symbols ? `<label class="field"><span>Symbol</span><select class="input" id="pa-sym">${symbols.map((s) => `<option value="${esc(s)}"${s === sym ? ' selected' : ''}>${esc(baseSym(s))}</option>`).join('')}</select></label>` : `<p class="muted" style="margin:0 0 12px">${esc(baseSym(sym))}${q ? ` · now <b class="num">${fmt(q.price, dp)}</b> (${fmtPct(q.chgPct)})` : ''}</p>`}
      <label class="field"><span>Condition</span><select class="input" id="pa-op">
        <option value="above">Price rises to or above</option><option value="below">Price falls to or below</option>
        <option value="pct_up">Day change is at least +%</option><option value="pct_down">Day change is at least −%</option></select></label>
      <label class="field"><span id="pa-vlabel">Price</span><input class="input num" id="pa-val" type="number" inputmode="decimal" step="any" value="${q ? (q.price * 1.02).toFixed(dp) : ''}"></label>
      <label class="field"><span>Note (optional)</span><input class="input" id="pa-note" maxlength="120" placeholder="e.g. breakout above resistance"></label>
      <div class="opt" style="padding:12px 0 4px"><div class="grow"><b>Repeat</b><small>Alert again each time it crosses (30-min cooldown)</small></div><label class="switch"><input type="checkbox" id="pa-rep"><span></span></label></div>
      <p class="note">Checked every scan (~5 min), so alerts can arrive a few minutes after the price is hit.</p>
      <button class="btn primary block" id="pa-save" type="button" style="margin-top:12px">Create alert</button>`,
    onMount(root, close) {
      const op = $('#pa-op', root);
      const val = $('#pa-val', root);
      const symSel = $('#pa-sym', root);
      const curPrice = () => quote(symSel ? symSel.value : sym);
      op.addEventListener('change', () => {
        const pct = op.value.startsWith('pct');
        $('#pa-vlabel', root).textContent = pct ? 'Percent' : 'Price';
        const qq = curPrice();
        val.value = pct ? '3' : qq ? (qq.price * (op.value === 'above' ? 1.02 : 0.98)).toFixed(qq.dp ?? 2) : '';
      });
      symSel?.addEventListener('change', () => op.dispatchEvent(new Event('change')));
      $('#pa-save', root).addEventListener('click', async () => {
        const v = Number(val.value);
        if (!Number.isFinite(v) || v <= 0) { toast('Enter a positive number', { error: true }); return; }
        const alert = {
          id: `pa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          symbol: symSel ? symSel.value : sym,
          op: op.value,
          value: v,
          note: $('#pa-note', root).value.trim(),
          repeat: $('#pa-rep', root).checked,
          enabled: true,
          createdAt: Date.now(),
        };
        close();
        try {
          await saveConfig((cfg) => { (cfg.priceAlerts ||= []).push(alert); }, `Add price alert for ${baseSym(alert.symbol)}`);
          toast('Price alert created');
        } catch (err) {
          needGitHub(err);
        }
      });
    },
  });
}

function editAliases() {
  const w = (config()?.watchlist || []).find((x) => x.symbol === st.sym);
  if (!w) { toast('Add the stock to your watchlist first'); return; }
  const sym = st.sym;
  sheet({
    title: `News matching · ${baseSym(sym)}`,
    body: `<p class="muted small" style="margin:0 0 12px">Headlines mentioning the ticker or company name already match. Add other names people use, e.g. a brand or short form (ALL-CAPS short forms match exactly).</p>
      <label class="field"><span>Extra names (comma separated)</span><input class="input" id="al-in" value="${esc((w.aliases || []).join(', '))}" placeholder="e.g. RIL, Jio Platforms"></label>
      <button class="btn primary block" id="al-save" type="button" style="margin-top:14px">Save</button>`,
    onMount(root, close) {
      $('#al-save', root).addEventListener('click', async () => {
        const aliases = [...new Set($('#al-in', root).value.split(',').map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 8);
        close();
        try {
          await saveConfig((cfg) => {
            const x = (cfg.watchlist || []).find((y) => y.symbol === sym);
            if (x) x.aliases = aliases;
          }, `Update news matching for ${baseSym(sym)}`);
          toast('Saved · applies from the next scan');
        } catch (err) {
          needGitHub(err);
        }
      });
    },
  });
}
