// Config schema, India defaults and sanitisation. The same shape lives in /config.json
// and is edited from the app (via the GitHub API) or by hand on github.com.

export const DEFAULT_CONFIG = {
  version: 1,
  market: 'IN',
  timezone: 'Asia/Kolkata',
  watchlist: [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', aliases: ['Reliance Industries', 'RIL', 'Jio Platforms', 'Reliance Retail'] },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', aliases: ['HDFC Bank'] },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Limited', aliases: ['ICICI Bank'] },
    { symbol: 'INFY.NS', name: 'Infosys Limited', aliases: ['Infosys', 'Infy'] },
    { symbol: 'TCS.NS', name: 'Tata Consultancy Services Limited', aliases: ['TCS', 'Tata Consultancy'] },
    { symbol: 'SBIN.NS', name: 'State Bank of India', aliases: ['SBI', 'State Bank of India'] },
    { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', aliases: ['Bharti Airtel', 'Airtel'] },
    { symbol: 'ITC.NS', name: 'ITC Limited', aliases: ['ITC'] },
    { symbol: 'LT.NS', name: 'Larsen & Toubro Limited', aliases: ['Larsen & Toubro', 'L&T'] },
    { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever Limited', aliases: ['Hindustan Unilever', 'HUL'] },
  ],
  markets: ['^NSEI', '^BSESN', '^NSEBANK', 'NIFTY_FIN_SERVICE.NS', '^CNXIT', '^NSEMDCP50', '^INDIAVIX', 'INR=X', 'BZ=F', 'GC=F', '^GSPC', '^IXIC'],
  keywords: ['RBI', 'repo rate', 'monetary policy', 'rate cut', 'rate hike', 'F&O', 'Union Budget'],
  muteKeywords: [
    'box office', 'horoscope', 'lottery', 'gold rate today', 'silver rate today', 'gold price today', 'petrol price', 'diesel price',
    'admit card', 'recruitment', 'prelims', 'answer key', 'exam date', 'syllabus',
  ],
  alerts: {
    watchlistNews: true,
    keywordNews: true,
    filings: true,
    breakingMarket: true,
    minImpact: 'any',
    bigMove: { enabled: true, pct: 3 },
    quietHours: { enabled: true, start: '22:30', end: '07:30' },
    maxPerRun: 6,
  },
  priceAlerts: [],
  sources: { disabled: [], custom: [] },
  rev: 0,
};

const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.&=_^-]{0,29}$/;
const OPS = new Set(['above', 'below', 'pct_up', 'pct_down']);

const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v, maxItems, maxLen = 60) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, maxLen)).filter(Boolean))].slice(0, maxItems) : null;

export function normalizeSymbol(s) {
  const v = str(s, 30).toUpperCase().replace(/\s+/g, '');
  return SYMBOL_RE.test(v) ? v : null;
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hhmm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : d);

export function normalizeConfig(raw) {
  const d = DEFAULT_CONFIG;
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = { version: 1, market: 'IN' };

  out.timezone = typeof c.timezone === 'string' && validTimeZone(c.timezone) ? c.timezone : d.timezone;

  const seen = new Set();
  const wl = Array.isArray(c.watchlist) ? c.watchlist : d.watchlist;
  out.watchlist = [];
  for (const w of wl) {
    const symbol = normalizeSymbol(typeof w === 'string' ? w : w?.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.watchlist.push({
      symbol,
      name: str(w?.name, 100) || null,
      aliases: strList(w?.aliases, 8) || [],
    });
    if (out.watchlist.length >= 60) break;
  }

  const mk = Array.isArray(c.markets) ? c.markets : d.markets;
  out.markets = [...new Set(mk.map(normalizeSymbol).filter(Boolean))].slice(0, 24);

  out.keywords = strList(c.keywords, 60) ?? d.keywords;
  out.muteKeywords = strList(c.muteKeywords, 60) ?? d.muteKeywords;

  const a = c.alerts && typeof c.alerts === 'object' ? c.alerts : {};
  const da = d.alerts;
  out.alerts = {
    watchlistNews: bool(a.watchlistNews, da.watchlistNews),
    keywordNews: bool(a.keywordNews, da.keywordNews),
    filings: bool(a.filings, da.filings),
    breakingMarket: bool(a.breakingMarket, da.breakingMarket),
    minImpact: ['any', 'medium', 'high'].includes(a.minImpact) ? a.minImpact : da.minImpact,
    bigMove: {
      enabled: bool(a.bigMove?.enabled, da.bigMove.enabled),
      pct: Number(a.bigMove?.pct) > 0 ? Math.min(20, Math.max(0.5, Number(a.bigMove.pct))) : da.bigMove.pct,
    },
    quietHours: {
      enabled: bool(a.quietHours?.enabled, da.quietHours.enabled),
      start: hhmm(a.quietHours?.start, da.quietHours.start),
      end: hhmm(a.quietHours?.end, da.quietHours.end),
    },
    maxPerRun: Math.min(20, Math.max(1, Math.round(Number(a.maxPerRun) || da.maxPerRun))),
  };

  out.priceAlerts = [];
  const ids = new Set();
  for (const p of Array.isArray(c.priceAlerts) ? c.priceAlerts : []) {
    const symbol = normalizeSymbol(p?.symbol);
    const value = Number(p?.value);
    const id = str(p?.id, 40).replace(/[^\w-]/g, '');
    if (!symbol || !OPS.has(p?.op) || !Number.isFinite(value) || !id || ids.has(id)) continue;
    ids.add(id);
    out.priceAlerts.push({
      id, symbol, op: p.op, value,
      note: str(p?.note, 120),
      repeat: bool(p?.repeat, false),
      enabled: bool(p?.enabled, true),
      createdAt: Number(p?.createdAt) || null,
    });
    if (out.priceAlerts.length >= 100) break;
  }

  const s = c.sources && typeof c.sources === 'object' ? c.sources : {};
  out.sources = {
    disabled: strList(s.disabled, 50, 40) || [],
    custom: (Array.isArray(s.custom) ? s.custom : [])
      .map((x) => ({ name: str(x?.name, 40), url: str(x?.url, 400) }))
      .filter((x) => /^https:\/\/[^\s]+$/i.test(x.url))
      .slice(0, 15),
  };

  out.rev = Number(c.rev) || 0;
  return out;
}
