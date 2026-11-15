import { dayKey, zoned, hhmmToMin, inWindow, clip } from './util.mjs';
import { baseSymbol } from './match.mjs';

const ALERT_MAX_AGE_MS = 3 * 3600e3; // never alert on stories older than 3h at first sight
const MIN_IMPACT = { any: 0, medium: 2, high: 3 };

const fmtNum = (n, dp = 2) =>
  Number.isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
const fmtPct = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '');

export function isQuiet(config, now) {
  const q = config.alerts?.quietHours;
  if (!q?.enabled) return false;
  const z = zoned(now, config.timezone);
  return inWindow(z.minutes, hhmmToMin(q.start, 22 * 60 + 30), hhmmToMin(q.end, 7 * 60 + 30));
}

/** Decide which brand-new items deserve a push. Sorted by priority. */
export function newsAlertCandidates(newItems, config, now = Date.now()) {
  const a = config.alerts || {};
  const minImp = MIN_IMPACT[a.minImpact] ?? 0;
  const out = [];
  for (const it of newItems) {
    const t = it.dateOnly ? it.seen : it.pub || it.seen;
    if (now - t > ALERT_MAX_AGE_MS) continue;
    let reason = null;
    if (it.kind === 'filing') {
      if (a.filings !== false && it.syms.length && it.imp > 0) reason = 'filing';
    } else if (a.watchlistNews !== false && it.syms.length) {
      if (it.imp >= minImp) reason = 'watchlist';
    } else if (a.keywordNews !== false && it.kws.length) {
      if (it.imp >= minImp) reason = 'keyword';
    } else if (a.breakingMarket && it.imp >= 3 && it.kind !== 'filing') {
      reason = 'breaking';
    }
    if (reason) out.push({ item: it, reason });
  }
  const rank = { filing: 3, watchlist: 3, keyword: 2, breaking: 1 };
  out.sort((x, y) => rank[y.reason] - rank[x.reason] || y.item.imp - x.item.imp || (y.item.pub || 0) - (x.item.pub || 0));
  return out;
}

export function newsPayload({ item: it, reason }, sourceName, silent) {
  const syms = it.syms.map(baseSymbol);
  const tag = syms.length ? syms.slice(0, 3).join(' · ') : reason === 'keyword' ? it.kws[0] : 'Market';
  const icon = it.kind === 'filing' ? '🏛️' : it.sent > 0 ? '📈' : it.sent < 0 ? '📉' : '📰';
  const imp = it.imp >= 3 ? ' · High impact' : '';
  const src = it.via ? `${it.via} via ${sourceName}` : sourceName;
  return {
    v: 1,
    type: 'news',
    id: it.id,
    title: `${icon} ${tag}${imp}`,
    body: `${clip(it.title, 180)}\n${src}`,
    url: it.url || null,
    route: `#/news/${it.id}`,
    tag: it.id,
    ts: it.pub || it.seen,
    syms: it.syms,
    reason,
    silent: !!silent,
  };
}

export function summaryPayload(rest, silent) {
  const lines = rest.slice(0, 4).map((c) => `• ${clip(c.item.title, 80)}`);
  return {
    v: 1,
    type: 'summary',
    id: `sum-${Date.now()}`,
    title: `+${rest.length} more alert${rest.length > 1 ? 's' : ''}`,
    body: lines.join('\n'),
    route: '#/alerts',
    tag: 'summary',
    ts: Date.now(),
    silent: !!silent,
  };
}

/**
 * Evaluate price alerts against fresh quotes. Mutates state.priceAlerts.
 * Ops: above | below (price level), pct_up | pct_down (day change, once per day).
 */
export function evaluatePriceAlerts(config, quotes, state, now = Date.now()) {
  const fired = [];
  const st = (state.priceAlerts ||= {});
  const today = dayKey(now, config.timezone);
  const live = new Set();
  for (const pa of config.priceAlerts || []) {
    live.add(pa.id);
    if (pa.enabled === false) continue;
    const q = quotes[pa.symbol];
    if (!q || !Number.isFinite(q.price)) continue;
    const s = (st[pa.id] ||= {});
    let cond = false;
    const v = Number(pa.value);
    if (pa.op === 'above') cond = q.price >= v;
    else if (pa.op === 'below') cond = q.price <= v;
    else if (pa.op === 'pct_up') cond = Number.isFinite(q.chgPct) && q.chgPct >= Math.abs(v);
    else if (pa.op === 'pct_down') cond = Number.isFinite(q.chgPct) && q.chgPct <= -Math.abs(v);
    else continue;

    let fire = false;
    if (cond) {
      if (pa.op.startsWith('pct')) fire = s.firedDay !== today && dayKey(q.time || now, config.timezone) === today;
      else if (!pa.repeat) fire = !s.firedAt;
      else fire = s.lastCond !== true && (!s.firedAt || now - s.firedAt > 30 * 60e3);
    }
    s.lastCond = cond;
    s.lastPrice = q.price;
    s.checkedAt = now;
    if (fire) {
      s.firedAt = now;
      s.firedDay = today;
      s.count = (s.count || 0) + 1;
      fired.push({ pa, q });
    }
  }
  for (const id of Object.keys(st)) if (!live.has(id)) delete st[id];
  return fired;
}

export function pricePayload({ pa, q }, silent) {
  const sym = baseSymbol(pa.symbol);
  const opText = { above: '≥', below: '≤', pct_up: 'up', pct_down: 'down' }[pa.op];
  const target = pa.op.startsWith('pct') ? `${Math.abs(pa.value)}%` : fmtNum(Number(pa.value), q.dp ?? 2);
  return {
    v: 1,
    type: 'price',
    id: `pa-${pa.id}-${Date.now()}`,
    title: `🎯 ${sym} ${opText} ${target}`,
    body: `Now ${fmtNum(q.price, q.dp ?? 2)} (${fmtPct(q.chgPct)})${pa.note ? ` · ${clip(pa.note, 80)}` : ''}`,
    route: `#/s/${encodeURIComponent(pa.symbol)}`,
    tag: `pa-${pa.id}`,
    ts: Date.now(),
    syms: [pa.symbol],
    silent: !!silent,
  };
}

/** Watchlist stocks moving more than ±N% today (once per stock/direction/day). */
export function evaluateBigMoves(config, quotes, state, now = Date.now()) {
  const bm = config.alerts?.bigMove;
  if (!bm?.enabled) return [];
  const pct = Math.max(0.5, Number(bm.pct) || 3);
  const today = dayKey(now, config.timezone);
  const st = (state.bigMoves ||= {});
  for (const k of Object.keys(st)) if (!k.endsWith(today)) delete st[k];
  const out = [];
  for (const w of config.watchlist || []) {
    const q = quotes[w.symbol];
    if (!q || !Number.isFinite(q.chgPct) || /^\^|=/.test(w.symbol)) continue;
    if (dayKey(q.time || 0, config.timezone) !== today) continue;
    const dir = q.chgPct >= pct ? 'up' : q.chgPct <= -pct ? 'down' : null;
    if (!dir) continue;
    const key = `${w.symbol}|${dir}|${today}`;
    if (st[key]) continue;
    st[key] = now;
    out.push({ w, q, dir });
  }
  return out;
}

export function bigMovePayload({ w, q, dir }, silent) {
  const sym = baseSymbol(w.symbol);
  return {
    v: 1,
    type: 'move',
    id: `mv-${sym}-${dir}-${Date.now()}`,
    title: `${dir === 'up' ? '🚀' : '🔻'} ${sym} ${fmtPct(q.chgPct)} today`,
    body: `${q.name || sym} at ${fmtNum(q.price, q.dp ?? 2)} · day range ${fmtNum(q.low, q.dp ?? 2)}–${fmtNum(q.high, q.dp ?? 2)}`,
    route: `#/s/${encodeURIComponent(w.symbol)}`,
    tag: `mv-${sym}`,
    ts: Date.now(),
    syms: [w.symbol],
    silent: !!silent,
  };
}

export function testPayload() {
  return {
    v: 1,
    type: 'test',
    id: `test-${Date.now()}`,
    title: '✅ TradePulse is connected',
    body: 'Push alerts are working on this device. You will get news and price alerts here.',
    route: '#/alerts',
    tag: 'test',
    ts: Date.now(),
    silent: false,
  };
}
