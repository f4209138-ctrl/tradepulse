import { chunk, hashId, clip } from './util.mjs';
import { cleanCompanyName } from './match.mjs';

const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Rs|Re)\b/g, (m) => m)
    .replace(/\b(Eq|Nav|Ipo|Ofs|Ncd|Esop|Agm|Egm)\b/g, (m) => m.toUpperCase());

/** Split NSE "A |KEY:VALUE |KEY2:VALUE2" descriptions. */
function nseFields(desc) {
  const parts = String(desc || '').split('|').map((p) => p.trim()).filter(Boolean);
  const fields = {};
  let lead = '';
  for (const p of parts) {
    const m = /^([A-Z][A-Z /&.()-]{1,40}?)\s*:\s*(.*)$/i.exec(p);
    if (m && m[1] === m[1].toUpperCase()) fields[m[1].trim()] = m[2].trim();
    else if (/^meeting date\s*:/i.test(p)) fields['MEETING DATE'] = p.split(':').slice(1).join(':').trim();
    else lead = lead ? `${lead} ${p}` : p;
  }
  return { lead, fields };
}

const tidyCompany = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Built-in sources. kind: news | filing | regulator
 *  - watchlistOnly: keep an item only if it mentions a watchlist stock or keyword
 *  - noiseUnlessMatched: regex; matching items are dropped unless they mention a watchlist stock/keyword
 *  - transform(item): rewrite title/summary (runs before matching)
 */
export const BUILTIN_SOURCES = [
  { id: 'et-markets', name: 'Economic Times', section: 'Markets', kind: 'news', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { id: 'et-stocks', name: 'Economic Times', section: 'Stocks', kind: 'news', url: 'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146843.cms' },
  { id: 'et-economy', name: 'Economic Times', section: 'Economy', kind: 'news', url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms' },
  { id: 'mint-markets', name: 'Mint', section: 'Markets', kind: 'news', url: 'https://www.livemint.com/rss/markets' },
  { id: 'mint-companies', name: 'Mint', section: 'Companies', kind: 'news', url: 'https://www.livemint.com/rss/companies' },
  { id: 'bs-markets', name: 'Business Standard', section: 'Markets', kind: 'news', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { id: 'bs-companies', name: 'Business Standard', section: 'Companies', kind: 'news', url: 'https://www.business-standard.com/rss/companies-101.rss' },
  { id: 'hbl-markets', name: 'BusinessLine', section: 'Markets', kind: 'news', url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss' },
  { id: 'ndtv-profit', name: 'NDTV Profit', section: 'Latest', kind: 'news', url: 'https://feeds.feedburner.com/ndtvprofit-latest' },
  { id: 'cnbc-world', name: 'CNBC', section: 'World markets', kind: 'news', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', defaultOffsetMin: 0, strict: true },
  {
    id: 'gnews-market', name: 'Google News', section: 'Sensex & Nifty', kind: 'news',
    url: gnews('(sensex OR "nifty 50" OR "bank nifty" OR "dalal street" OR "indian stock market" OR "indian equities") when:2h'),
    google: true,
    strict: true,
  },
  {
    id: 'nse-announcements', name: 'NSE', section: 'Announcements', kind: 'filing', watchlistOnly: true,
    url: 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml',
    transform(it) {
      const company = tidyCompany(it.title);
      const { lead, fields } = nseFields(it.summary);
      const subject = fields.SUBJECT || '';
      it.company = company;
      it.subject = subject;
      it.title = subject ? `${company}: ${subject}` : company;
      it.summary = clip(lead || it.summary, 260);
      return it;
    },
  },
  {
    id: 'nse-board', name: 'NSE', section: 'Board meetings', kind: 'filing', watchlistOnly: true,
    url: 'https://nsearchives.nseindia.com/content/RSS/Board_Meetings.xml',
    transform(it) {
      const company = tidyCompany(it.title);
      const { lead, fields } = nseFields(it.summary);
      const date = fields['MEETING DATE'] || '';
      it.company = company;
      it.subject = 'Board Meeting Intimation';
      it.title = `${company}: Board meeting${date ? ` on ${date}` : ''}`;
      it.summary = clip(lead || it.summary, 260);
      return it;
    },
  },
  {
    id: 'nse-corpact', name: 'NSE', section: 'Corporate actions', kind: 'filing', watchlistOnly: true,
    url: 'https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml',
    transform(it) {
      const m = /^(.*?)\s+-\s+Ex-Date:\s*(.+)$/i.exec(it.title);
      const company = tidyCompany(m ? m[1] : it.title);
      const exDate = m ? m[2].trim() : '';
      const { fields } = nseFields(it.summary);
      const purpose = fields.PURPOSE ? titleCase(fields.PURPOSE) : 'Corporate action';
      it.company = company;
      it.subject = 'Corporate Action';
      it.title = `${company}: ${purpose}${exDate ? ` · ex-date ${exDate}` : ''}`;
      const bits = [];
      if (fields['RECORD DATE'] && fields['RECORD DATE'] !== '-') bits.push(`Record date ${fields['RECORD DATE']}`);
      if (fields['FACE VALUE']) bits.push(`Face value ₹${fields['FACE VALUE']}`);
      it.summary = bits.join(' · ');
      return it;
    },
  },
  {
    id: 'rbi', name: 'RBI', section: 'Press releases', kind: 'regulator',
    url: 'https://www.rbi.org.in/pressreleases_rss.xml',
    noiseUnlessMatched: /\b(money market operations|auction of|auction result|treasury bills?|state government securities|reserve money|underwriting|government stock|cut-?off|variable rate|vrrr?|repo auction|sale of|conversion|switch of|weekly statistical|lending and deposit rates|directions? under section|amalgamation of .*co-operative|co-operative bank)\b/i,
  },
  {
    id: 'sebi', name: 'SEBI', section: 'Updates', kind: 'regulator',
    url: 'https://www.sebi.gov.in/sebirss.xml',
    noiseUnlessMatched: /\b(order|recovery|remittance|attachment|notice of demand|demand notice|summons|corrigendum|adjudicat\w*|settlement|exemption|release of|certificate|show cause|ex-?parte)\b/i,
  },
];

// Items from Google News that are not news (price pages, quote widgets)
export const GOOGLE_NOISE = /(share|stock)\s+price\s*(live|today|target|forecast|history|chart|prediction)|price prediction|stock forecast|live\s+(nse|bse)\b|\bprice\s+chart\b|stock\s+price\s*(&|and)\s*chart|\bquote\b.*\bchart\b|share price.*\b(nse|bse):|investor relations|reports? (&|and) filings/i;

/** Search term for a watchlist entry: the full company name beats short aliases (SBI, TCS…). */
export function primaryTerm(w) {
  const clean = cleanCompanyName(w.name);
  if (clean && clean.length >= 3) return clean;
  if (w.aliases && w.aliases.length) return w.aliases[0];
  return w.symbol.replace(/\.(NS|BO)$/i, '');
}

const MARKET_WORDS = '(share OR shares OR stock OR stocks OR NSE OR BSE OR Sensex OR Nifty OR results OR dividend OR target OR brokerage)';

/** Google News queries covering the watchlist, ~6 companies per query, market news only. */
export function watchlistSources(watchlist) {
  const stocks = watchlist.filter((w) => !/^\^|=|-USD$/i.test(w.symbol));
  const terms = stocks.map((w) => `"${primaryTerm(w).replace(/"/g, '')}"`);
  return chunk(terms, 6).slice(0, 6).map((batch, i) => ({
    id: `gnews-watch-${i + 1}`,
    name: 'Google News',
    section: 'Watchlist',
    kind: 'news',
    google: true,
    strict: true,
    url: gnews(`(${batch.join(' OR ')}) ${MARKET_WORDS} when:1d`),
  }));
}

export function customSources(custom = []) {
  return custom
    .filter((c) => c && /^https:\/\//i.test(c.url || ''))
    .slice(0, 15)
    .map((c) => ({
      id: `custom-${hashId(c.url)}`,
      name: String(c.name || new URL(c.url).hostname).slice(0, 40),
      section: 'Custom',
      kind: 'news',
      url: c.url,
      custom: true,
    }));
}

export function activeSources(config) {
  const disabled = new Set(config.sources?.disabled || []);
  const all = [...BUILTIN_SOURCES, ...watchlistSources(config.watchlist), ...customSources(config.sources?.custom)];
  return all.filter((s) => !disabled.has(s.id) && !(s.id.startsWith('gnews-watch') && disabled.has('gnews-watch')));
}
