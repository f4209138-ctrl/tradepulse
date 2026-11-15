import { getJson, httpGet } from './http.mjs';
import { chunk, unique, round } from './util.mjs';
import { cleanCompanyName } from './match.mjs';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

/** Friendly names for non-equity symbols. */
export const FRIENDLY = {
  '^NSEI': 'NIFTY 50', '^BSESN': 'SENSEX', '^NSEBANK': 'BANK NIFTY', 'NIFTY_FIN_SERVICE.NS': 'FIN NIFTY',
  '^CNXIT': 'NIFTY IT', '^INDIAVIX': 'INDIA VIX', '^NSEMDCP50': 'MIDCAP 50', 'NIFTY_MIDCAP_100.NS': 'MIDCAP 100',
  '^CNXSC': 'SMALLCAP 100', '^NSMIDCP': 'NIFTY NEXT 50', '^CRSLDX': 'NIFTY 500', '^CNXAUTO': 'NIFTY AUTO',
  '^CNXPHARMA': 'NIFTY PHARMA', '^CNXFMCG': 'NIFTY FMCG', '^CNXMETAL': 'NIFTY METAL', '^CNXREALTY': 'NIFTY REALTY',
  '^CNXENERGY': 'NIFTY ENERGY', 'INR=X': 'USD/INR', 'BZ=F': 'Brent Crude', 'CL=F': 'WTI Crude', 'GC=F': 'Gold',
  'SI=F': 'Silver', '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^N225': 'Nikkei 225',
  '^HSI': 'Hang Seng', '^FTSE': 'FTSE 100', 'DX-Y.NYB': 'Dollar Index', '^TNX': 'US 10Y Yield', 'BTC-USD': 'Bitcoin',
};

function displayName(sym, meta) {
  if (FRIENDLY[sym]) return FRIENDLY[sym];
  if (meta.instrumentType === 'EQUITY' && meta.longName) return cleanCompanyName(meta.longName);
  return meta.shortName || meta.longName || sym;
}

function priceDecimals(meta, price) {
  const hint = Number.isFinite(meta.priceHint) ? meta.priceHint : 2;
  if (price != null && Math.abs(price) < 10) return Math.max(hint, 3);
  return Math.min(Math.max(hint, 2), 4);
}

function toQuote(sym, r) {
  const meta = r.meta || {};
  const price = meta.regularMarketPrice;
  if (!Number.isFinite(price)) return null;
  const prev = Number.isFinite(meta.previousClose) ? meta.previousClose : meta.chartPreviousClose;
  const dp = priceDecimals(meta, price);
  const chg = Number.isFinite(prev) ? price - prev : null;
  const chgPct = Number.isFinite(meta.regularMarketChangePercent)
    ? meta.regularMarketChangePercent
    : chg != null && prev ? (chg / prev) * 100 : null;

  // Intraday closes (spark). Drop nulls; encode times as minute offsets from t0.
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const t = [];
  const c = [];
  for (let i = 0; i < ts.length; i++) {
    if (Number.isFinite(closes[i])) { t.push(ts[i]); c.push(round(closes[i], dp)); }
  }
  const t0 = t[0] || null;
  const reg = meta.currentTradingPeriod?.regular;
  return {
    sym,
    name: displayName(sym, meta),
    type: meta.instrumentType || null,
    exch: meta.fullExchangeName || meta.exchangeName || null,
    cur: meta.currency || null,
    dp,
    price: round(price, dp),
    prev: round(prev, dp),
    chg: round(chg, dp),
    chgPct: round(chgPct, 2),
    high: round(meta.regularMarketDayHigh, dp),
    low: round(meta.regularMarketDayLow, dp),
    vol: Number.isFinite(meta.regularMarketVolume) && meta.regularMarketVolume > 0 ? meta.regularMarketVolume : null,
    w52h: round(meta.fiftyTwoWeekHigh, dp),
    w52l: round(meta.fiftyTwoWeekLow, dp),
    time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    session: reg ? { start: reg.start * 1000, end: reg.end * 1000 } : null,
    spark: t0 ? { t0: t0 * 1000, dt: t.map((x) => Math.round((x - t0) / 60)), c } : null,
  };
}

/**
 * Batched quotes via Yahoo's spark endpoint (≤20 symbols per request).
 * Returns { quotes: {sym: quote}, missing: [sym], errors: [msg] }
 */
export async function fetchQuotes(symbols, { range = '1d', interval = '5m' } = {}) {
  const quotes = {};
  const errors = [];
  const list = unique(symbols.filter(Boolean));
  for (const batch of chunk(list, 20)) {
    const qs = `symbols=${batch.map(encodeURIComponent).join(',')}&range=${range}&interval=${interval}&includePrePost=false`;
    let res = null;
    for (const host of HOSTS) {
      res = await getJson(`${host}/v7/finance/spark?${qs}`, { timeoutMs: 15000 });
      if (res.ok && res.json?.spark) break;
    }
    if (!res?.ok || !res.json?.spark) {
      errors.push(res?.error || 'quote request failed');
      continue;
    }
    for (const r of res.json.spark.result || []) {
      const resp = r.response?.[0];
      if (!resp) continue;
      const q = toQuote(r.symbol, resp);
      if (q) quotes[r.symbol] = q;
    }
  }
  const missing = list.filter((s) => !quotes[s]);
  return { quotes, missing, errors };
}

/** Daily OHLCV history (1y) for one symbol. Returns { t:[ms], o,h,l,c,v } or null. */
export async function fetchHistory(sym, { range = '1y', interval = '1d' } = {}) {
  let res = null;
  for (const host of HOSTS) {
    res = await getJson(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`, { timeoutMs: 15000 });
    if (res.ok && res.json?.chart?.result?.[0]) break;
  }
  const r = res?.json?.chart?.result?.[0];
  if (!r) return { data: null, error: res?.json?.chart?.error?.description || res?.error || 'no data' };
  const q = r.indicators?.quote?.[0] || {};
  const dp = priceDecimals(r.meta || {}, r.meta?.regularMarketPrice);
  const out = { sym, dp, t: [], o: [], h: [], l: [], c: [], v: [] };
  (r.timestamp || []).forEach((ts, i) => {
    if (![q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]].every(Number.isFinite)) return;
    out.t.push(ts * 1000);
    out.o.push(round(q.open[i], dp));
    out.h.push(round(q.high[i], dp));
    out.l.push(round(q.low[i], dp));
    out.c.push(round(q.close[i], dp));
    out.v.push(Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0);
  });
  return out.t.length ? { data: out } : { data: null, error: 'empty history' };
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

/** NIFTY 50 constituents from NSE: [{ sym:'RELIANCE.NS', name, industry }] */
export async function fetchNifty50() {
  const r = await httpGet('https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv', { accept: 'text/csv,*/*', timeoutMs: 15000 });
  if (!r.ok) return { list: null, error: r.error };
  const rows = parseCsv(r.text);
  const head = rows.shift()?.map((h) => h.toLowerCase()) || [];
  const iName = head.findIndex((h) => h.includes('company'));
  const iInd = head.findIndex((h) => h.includes('industry'));
  const iSym = head.findIndex((h) => h === 'symbol');
  if (iSym < 0) return { list: null, error: 'unexpected CSV header' };
  const list = rows
    .filter((c) => c[iSym])
    .map((c) => ({ sym: `${c[iSym].toUpperCase()}.NS`, name: cleanCompanyName(c[iName] || c[iSym]), industry: c[iInd] || '' }));
  return list.length >= 40 ? { list } : { list: null, error: `only ${list.length} rows` };
}

/** All NSE-listed equities: [[SYMBOL, name], ...] for the in-app symbol search. */
export async function fetchEquityList() {
  const r = await httpGet('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', { accept: 'text/csv,*/*', timeoutMs: 20000 });
  if (!r.ok) return { list: null, error: r.error };
  const rows = parseCsv(r.text);
  rows.shift();
  const list = rows
    .filter((c) => c[0] && c[1] && /^(EQ|BE|BZ|SM|ST)$/i.test(c[2] || 'EQ'))
    .map((c) => [c[0].toUpperCase(), cleanCompanyName(c[1])]);
  return list.length > 500 ? { list } : { list: null, error: `only ${list.length} rows` };
}
