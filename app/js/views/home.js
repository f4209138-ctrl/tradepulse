import { store, config, quote, ghConnected, saveLocal } from '../store.js';
import { $, esc, fmt, fmtPct, dir, sparkline, icon, ago, when, isStandalone, installSteps } from '../ui.js';
import { nseStatus, usStatus, baseSym } from '../market.js';
import { pushSupported, permission } from '../push.js';

export const title = 'TradePulse';

export function render(el) {
  el.innerHTML = `
    <div id="h-callouts"></div>
    <div class="sec"><h2>Markets</h2></div>
    <div class="clock" id="h-clock"></div>
    <div class="mkt-strip" id="h-markets" style="margin-top:10px"></div>
    <div class="sec"><h2>NIFTY 50 today</h2><span class="small muted" id="h-asof"></span></div>
    <div class="card" id="h-breadth"></div>
    <div class="sec"><h2>Watchlist movers</h2><a href="#/watchlist">Watchlist ›</a></div>
    <div class="card tight" id="h-watch"></div>
    <div class="sec"><h2>Latest alerts</h2><a href="#/alerts">All ›</a></div>
    <div class="card tight" id="h-alerts"></div>
    <div class="sec"><h2>Top stories</h2><a href="#/news">All news ›</a></div>
    <div class="card tight" id="h-news"></div>`;
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-hide-install]')) {
      store.local.installHidden = true;
      saveLocal();
      update(el);
      return;
    }
    if (e.target.closest('[data-install]') && store.installPrompt) {
      store.installPrompt.prompt();
      await store.installPrompt.userChoice.catch(() => null);
      store.installPrompt = null;
      update(el);
    }
  });
  update(el);
}

function callouts() {
  const out = [];
  const s = store.status;
  if (s && Date.now() - s.updatedAt > 45 * 60e3) {
    out.push(`<a class="callout" href="#/help">${icon('info')}<div class="grow"><strong>Scanner hasn't run for ${esc(ago(s.updatedAt))}</strong><p>GitHub may be delaying scheduled runs. Data shown is from ${esc(when(s.updatedAt))}.</p></div></a>`);
  }
  if (store.installPrompt && !isStandalone()) {
    out.push(`<div class="callout">${icon('phone')}<div class="grow"><strong>Install TradePulse</strong><p>Adds it to your home screen like an app — light and fast.</p></div><button class="btn sm primary" data-install type="button">Install</button></div>`);
  } else if (!isStandalone() && !store.local.installHidden) {
    out.push(`<div class="callout" style="align-items:flex-start">${icon('phone')}<div class="grow"><strong>Add TradePulse to your home screen</strong><p>${installSteps()}</p></div><button class="icon-btn" data-hide-install type="button" aria-label="Hide">${icon('x', 18)}</button></div>`);
  }
  if (store.app?.vapidPublicKey && pushSupported() && (permission() !== 'granted' || !store.local.push?.registered)) {
    out.push(`<a class="callout" href="#/alerts">${icon('bell')}<div class="grow"><strong>Turn on push alerts</strong><p>Get notified when your stocks are in the news.</p></div>${icon('chev')}</a>`);
  } else if (!ghConnected()) {
    out.push(`<a class="callout" href="#/settings">${icon('key')}<div class="grow"><strong>Connect GitHub</strong><p>Needed to edit your watchlist, keywords and price alerts.</p></div>${icon('chev')}</a>`);
  }
  return out.join('');
}

function marketCard(sym) {
  const q = quote(sym);
  if (!q) return `<a class="mkt" href="#/s/${encodeURIComponent(sym)}"><div class="n">${esc(sym)}</div><div class="p faint">—</div></a>`;
  const d = dir(q.chgPct);
  return `<a class="mkt" href="#/s/${encodeURIComponent(sym)}">
    <div class="n">${esc(q.name || sym)}</div>
    <div class="p num">${fmt(q.price, q.dp ?? 2)}</div>
    <div class="c num ${d}">${fmtPct(q.chgPct)}</div>
    ${sparkline(q.spark?.c, { w: 126, h: 26, prev: q.prev, cls: d })}</a>`;
}

function moverRow(x) {
  return `<a class="mv" href="#/s/${encodeURIComponent(x.sym)}"><b>${esc(baseSym(x.sym))}</b><span class="num ${dir(x.q.chgPct)}">${fmtPct(x.q.chgPct)}</span></a>`;
}

function breadth() {
  const list = store.quotes?.nifty50 || [];
  const rows = list.map((x) => ({ ...x, q: quote(x.sym) })).filter((x) => x.q && Number.isFinite(x.q.chgPct));
  if (!rows.length) return '<p class="muted small" style="margin:0">NIFTY 50 data will appear after the next scan.</p>';
  const adv = rows.filter((x) => x.q.chgPct > 0).length;
  const dec = rows.filter((x) => x.q.chgPct < 0).length;
  const unch = rows.length - adv - dec;
  const sorted = [...rows].sort((a, b) => b.q.chgPct - a.q.chgPct);
  const gain = sorted.slice(0, 5);
  const lose = sorted.slice(-5).reverse();
  const sectors = {};
  for (const r of rows) {
    const k = r.industry || 'Other';
    (sectors[k] ||= []).push(r.q.chgPct);
  }
  const sec = Object.entries(sectors)
    .map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length])
    .sort((a, b) => b[1] - a[1]);
  const shortSector = (s) => s.replace('Fast Moving Consumer Goods', 'FMCG').replace('Information Technology', 'IT').replace('Automobile and Auto Components', 'Auto').replace('Oil Gas & Consumable Fuels', 'Oil & Gas').replace('Financial Services', 'Financials').replace('Metals & Mining', 'Metals').replace('Construction Materials', 'Cement');
  return `
    <div class="row between small"><span class="up"><b>${adv}</b> advancing</span><span class="muted">${unch ? `${unch} unchanged` : ''}</span><span class="down"><b>${dec}</b> declining</span></div>
    <div class="breadth"><i class="a" style="width:${(adv / rows.length) * 100}%"></i><i style="width:${(unch / rows.length) * 100}%"></i><i class="d" style="width:${(dec / rows.length) * 100}%"></i></div>
    <div class="movers" style="margin-top:10px">
      <div><div class="small muted" style="margin-bottom:2px">Top gainers</div>${gain.map(moverRow).join('')}</div>
      <div><div class="small muted" style="margin-bottom:2px">Top losers</div>${lose.map(moverRow).join('')}</div>
    </div>
    <div class="small muted" style="margin:12px 0 6px">Sectors (avg move of NIFTY 50 stocks)</div>
    <div class="sectors">${sec.map(([k, v, n]) => `<span class="sector num ${dir(v)}" style="background:var(--${v > 0 ? 'up' : v < 0 ? 'down' : 'chip'}-bg, var(--chip))" title="${n} stocks">${esc(shortSector(k))} ${fmtPct(v, 1)}</span>`).join('')}</div>`;
}

function watchMovers() {
  const cfg = config();
  const rows = (cfg?.watchlist || []).map((w) => ({ w, q: quote(w.symbol) })).filter((x) => x.q && Number.isFinite(x.q.chgPct));
  if (!rows.length) return '<div class="empty small">Your watchlist will show here after the next scan.</div>';
  return rows
    .sort((a, b) => Math.abs(b.q.chgPct) - Math.abs(a.q.chgPct))
    .slice(0, 5)
    .map(({ w, q }) => `<a class="q" href="#/s/${encodeURIComponent(w.symbol)}">
      <div class="grow"><div class="s">${esc(baseSym(w.symbol))}</div><div class="nm">${esc(q.name || w.name || '')}</div></div>
      ${sparkline(q.spark?.c, { w: 64, h: 26, prev: q.prev, cls: dir(q.chgPct) })}
      <div class="px num"><b>${fmt(q.price, q.dp ?? 2)}</b><span class="pill ${dir(q.chgPct)}">${fmtPct(q.chgPct)}</span></div></a>`)
    .join('');
}

function latestAlerts() {
  const items = (store.alerts?.items || []).filter((a) => a.type !== 'test').slice(0, 3);
  if (!items.length) return '<div class="empty small">No alerts yet — they appear when your stocks or keywords hit the news, or a price alert triggers.</div>';
  return items.map((a) => `<a class="alert-li" href="${esc(a.route || '#/alerts')}"><div class="grow"><div class="t">${esc(a.title)}</div><div class="b">${esc(a.body)}</div><div class="w">${esc(when(a.ts))}</div></div></a>`).join('');
}

function topStories() {
  const items = store.news?.items || [];
  const since = Date.now() - 18 * 3600e3;
  const top = items
    .filter((i) => (i.pub || i.seen) > since && ((i.imp || 0) >= 2 || i.syms))
    .sort((a, b) => (b.imp || 0) - (a.imp || 0) || (b.pub || 0) - (a.pub || 0))
    .slice(0, 6);
  if (!top.length) return '<div class="empty small">No big stories in the last few hours.</div>';
  return top.map((i) => `<a class="alert-li" href="#/news/${esc(i.id)}"><div class="grow">
      <div class="ni-meta"><span class="src">${esc(i.via || store.news.sources?.[i.src] || i.src)}</span><span>${esc(ago(i.pub || i.seen))}</span>${(i.imp || 0) >= 3 ? '<span class="tag hot">High impact</span>' : ''}</div>
      <div class="t" style="font-weight:600;margin-top:3px">${esc(i.title)}</div>
      ${i.syms ? `<div class="chips" style="margin-top:6px">${i.syms.map((s) => `<span class="chip sym">${esc(baseSym(s))}</span>`).join('')}</div>` : ''}
    </div></a>`).join('');
}

export function update(el) {
  const cfg = config();
  $('#h-callouts', el).innerHTML = callouts();
  const nifty = quote('^NSEI');
  const nse = nseStatus(nifty);
  const us = usStatus();
  $('#h-clock', el).innerHTML = `
    <span class="status-pill"><i class="status-dot ${nse.state === 'open' ? 'live' : nse.state === 'pre' ? 'late' : ''}"></i>NSE ${esc(nse.label)} · ${esc(nse.detail)}</span>
    <span class="status-pill"><i class="status-dot ${us.state === 'open' ? 'live' : ''}"></i>US ${esc(us.label)}</span>`;
  const markets = cfg?.markets || [];
  $('#h-markets', el).innerHTML = markets.length ? markets.map(marketCard).join('') : '<div class="muted small">Waiting for first scan…</div>';
  $('#h-asof', el).textContent = nifty?.time ? `as of ${when(nifty.time)}` : '';
  $('#h-breadth', el).innerHTML = breadth();
  $('#h-watch', el).innerHTML = watchMovers();
  $('#h-alerts', el).innerHTML = latestAlerts();
  $('#h-news', el).innerHTML = topStories();
}
