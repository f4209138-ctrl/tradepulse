// Market hours (NSE / NYSE), symbol helpers, external links, pivot maths.

const IST = 'Asia/Kolkata';

function zonedNow(tz, ts = Date.now()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ts)) p[x.type] = x.value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dow, min: +p.hour * 60 + +p.minute };
}

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function sessionStatus(tz, open, close, preOpen, ts = Date.now()) {
  const { dow, min } = zonedNow(tz, ts);
  const weekday = dow >= 1 && dow <= 5;
  if (weekday && min >= open && min < close) return { state: 'open', label: 'Open', detail: `closes ${hm(close)} · ${dur(close - min)} left` };
  if (weekday && preOpen != null && min >= preOpen && min < open) return { state: 'pre', label: 'Pre-open', detail: `opens ${hm(open)}` };
  // next open
  let d = dow;
  let add = 0;
  if (weekday && min < (preOpen ?? open)) add = 0;
  else {
    do { d = (d + 1) % 7; add++; } while (d === 0 || d === 6);
  }
  const when = add === 0 ? `today ${hm(open)}` : add === 1 ? `tomorrow ${hm(open)}` : `${DAYS[d]} ${hm(open)}`;
  return { state: 'closed', label: 'Closed', detail: `opens ${when}` };
}

/**
 * NSE equity session 09:15–15:30 IST (pre-open 09:00). Holidays aren't in a calendar here,
 * so if NIFTY hasn't printed for 40 min during "open" hours we report it as closed.
 */
export function nseStatus(niftyQuote, ts = Date.now()) {
  const s = sessionStatus(IST, 555, 930, 540, ts);
  if (s.state === 'open' && niftyQuote?.time && ts - niftyQuote.time > 40 * 60e3) {
    return { state: 'closed', label: 'No trading', detail: 'market holiday?' };
  }
  return s;
}
export const usStatus = (ts = Date.now()) => sessionStatus('America/New_York', 570, 960, null, ts);

// ---------------------------------------------------------------- symbols
export const baseSym = (s) => String(s || '').replace(/\.(NS|BO)$/i, '');
export const isEquity = (s) => /\.(NS|BO)$/i.test(s);
export const histKey = (sym) => sym.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Non-equity instruments offered in symbol search. */
export const INSTRUMENTS = [
  ['^NSEI', 'NIFTY 50'], ['^BSESN', 'SENSEX'], ['^NSEBANK', 'BANK NIFTY'], ['NIFTY_FIN_SERVICE.NS', 'FIN NIFTY'],
  ['^CNXIT', 'NIFTY IT'], ['^NSEMDCP50', 'NIFTY MIDCAP 50'], ['NIFTY_MIDCAP_100.NS', 'NIFTY MIDCAP 100'],
  ['^CNXSC', 'NIFTY SMALLCAP 100'], ['^NSMIDCP', 'NIFTY NEXT 50'], ['^CRSLDX', 'NIFTY 500'], ['^CNXAUTO', 'NIFTY AUTO'],
  ['^CNXPHARMA', 'NIFTY PHARMA'], ['^CNXFMCG', 'NIFTY FMCG'], ['^CNXMETAL', 'NIFTY METAL'], ['^CNXREALTY', 'NIFTY REALTY'],
  ['^CNXENERGY', 'NIFTY ENERGY'], ['^INDIAVIX', 'INDIA VIX'], ['INR=X', 'USD/INR'], ['BZ=F', 'Brent Crude'],
  ['CL=F', 'WTI Crude'], ['GC=F', 'Gold'], ['SI=F', 'Silver'], ['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'],
  ['^DJI', 'Dow Jones'], ['^N225', 'Nikkei 225'], ['^HSI', 'Hang Seng'], ['^FTSE', 'FTSE 100'],
  ['DX-Y.NYB', 'Dollar Index'], ['^TNX', 'US 10Y Yield'], ['BTC-USD', 'Bitcoin'],
];
const INSTRUMENT_NAMES = Object.fromEntries(INSTRUMENTS);
export const instrumentName = (s) => INSTRUMENT_NAMES[s] || null;

const TV = {
  '^NSEI': 'NSE:NIFTY', '^BSESN': 'BSE:SENSEX', '^NSEBANK': 'NSE:BANKNIFTY', 'NIFTY_FIN_SERVICE.NS': 'NSE:CNXFINANCE',
  '^CNXIT': 'NSE:CNXIT', '^INDIAVIX': 'NSE:INDIAVIX', '^NSEMDCP50': 'NSE:NIFTYMIDCAP50', 'NIFTY_MIDCAP_100.NS': 'NSE:CNXMIDCAP',
  '^CNXSC': 'NSE:CNXSMALLCAP', '^NSMIDCP': 'NSE:NIFTYJR', '^CRSLDX': 'NSE:CNX500', '^CNXAUTO': 'NSE:CNXAUTO',
  '^CNXPHARMA': 'NSE:CNXPHARMA', '^CNXFMCG': 'NSE:CNXFMCG', '^CNXMETAL': 'NSE:CNXMETAL', '^CNXREALTY': 'NSE:CNXREALTY',
  '^CNXENERGY': 'NSE:CNXENERGY', 'INR=X': 'FX_IDC:USDINR', 'BZ=F': 'TVC:UKOIL', 'CL=F': 'TVC:USOIL', 'GC=F': 'TVC:GOLD',
  'SI=F': 'TVC:SILVER', '^GSPC': 'SP:SPX', '^IXIC': 'NASDAQ:IXIC', '^DJI': 'DJ:DJI', '^N225': 'TVC:NI225', '^HSI': 'TVC:HSI',
  '^FTSE': 'TVC:UKX', 'DX-Y.NYB': 'TVC:DXY', '^TNX': 'TVC:US10Y', 'BTC-USD': 'BITSTAMP:BTCUSD',
};
export function tradingViewUrl(sym) {
  let tv = TV[sym];
  if (!tv && /\.NS$/i.test(sym)) tv = `NSE:${baseSym(sym).replace(/[&-]/g, '_')}`;
  if (!tv && /\.BO$/i.test(sym)) tv = `BSE:${baseSym(sym).replace(/[&-]/g, '_')}`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv || sym)}`;
}
export const nseUrl = (sym) => `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(baseSym(sym))}`;
export const screenerUrl = (sym) => `https://www.screener.in/company/${encodeURIComponent(baseSym(sym))}/`;

// ---------------------------------------------------------------- pivots
export function pivots(h, l, c) {
  if (![h, l, c].every(Number.isFinite) || h < l) return null;
  const P = (h + l + c) / 3;
  const R = h - l;
  const bc = (h + l) / 2;
  const tc = 2 * P - bc;
  const wP = (h + l + 2 * c) / 4;
  return {
    classic: [['R3', h + 2 * (P - l)], ['R2', P + R], ['R1', 2 * P - l], ['P', P], ['S1', 2 * P - h], ['S2', P - R], ['S3', l - 2 * (h - P)]],
    fibonacci: [['R3', P + R], ['R2', P + 0.618 * R], ['R1', P + 0.382 * R], ['P', P], ['S1', P - 0.382 * R], ['S2', P - 0.618 * R], ['S3', P - R]],
    camarilla: [['R4', c + (R * 1.1) / 2], ['R3', c + (R * 1.1) / 4], ['R2', c + (R * 1.1) / 6], ['R1', c + (R * 1.1) / 12],
      ['S1', c - (R * 1.1) / 12], ['S2', c - (R * 1.1) / 6], ['S3', c - (R * 1.1) / 4], ['S4', c - (R * 1.1) / 2]],
    woodie: [['R2', wP + R], ['R1', 2 * wP - l], ['P', wP], ['S1', 2 * wP - h], ['S2', wP - R]],
    cpr: { tc: Math.max(tc, bc), p: P, bc: Math.min(tc, bc), widthPct: (Math.abs(tc - bc) / P) * 100 },
  };
}

/**
 * The session to base pivots on: before/during market hours use the previous session
 * (from daily history); after the close use today's range from the live quote.
 */
export function pivotBasis(hist, q, ts = Date.now()) {
  const { min, dow } = zonedNow(IST, ts);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(ts);
  const dayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(t);
  const afterClose = dow >= 1 && dow <= 5 && min >= 930;
  if (q && afterClose && q.time && dayOf(q.time) === today && [q.high, q.low, q.price].every(Number.isFinite)) {
    return { h: q.high, l: q.low, c: q.price, label: `today (${today.slice(8)}) — for next session` };
  }
  if (hist?.t?.length) {
    for (let i = hist.t.length - 1; i >= 0; i--) {
      if (dayOf(hist.t[i]) >= today) continue; // skip today's unfinished candle
      return { h: hist.h[i], l: hist.l[i], c: hist.c[i], label: `${new Date(hist.t[i]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} session` };
    }
  }
  return null;
}
