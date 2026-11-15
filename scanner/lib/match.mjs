import { escapeRegex } from './util.mjs';

const B = '(?<![\\p{L}\\p{N}])'; // left boundary (unicode-aware)
const E = '(?![\\p{L}\\p{N}])'; // right boundary

/** Words that are also tickers but would cause false matches. */
const AMBIGUOUS_TICKERS = new Set([
  'IT', 'ON', 'ALL', 'ANY', 'CAN', 'ONE', 'NEW', 'BIG', 'BEST', 'GOOD', 'TODAY', 'INDIA', 'GOLD', 'SILVER',
  'BANK', 'POWER', 'OIL', 'GAS', 'STEEL', 'CEMENT', 'AUTO', 'FUND', 'CASH', 'MARKET', 'STAR', 'SUN', 'MAX',
]);

const COMPANY_SUFFIX = /[,.]?\s+(limited|ltd\.?|incorporated|inc\.?|corporation|corp\.?|company|co\.|plc|llp|pvt\.?|private)\b\.?/gi;

export function cleanCompanyName(name) {
  if (!name) return '';
  return String(name).replace(/\s*\(the\)\s*/i, ' ').replace(COMPANY_SUFFIX, '').replace(/\s+/g, ' ').replace(/[,.\s]+$/, '').trim();
}

export function baseSymbol(sym) {
  return String(sym || '').replace(/\.(NS|BO)$/i, '').replace(/^\^/, '').toUpperCase();
}

/** ALL-CAPS and ≤5 letters: an acronym/ticker such as SBI, TCS, L&T, HUL. */
const isAcronym = (t) => t === t.toUpperCase() && /[A-Z]/.test(t) && t.replace(/[^A-Za-z]/g, '').length <= 5;

/** Acronyms and tickers match case-sensitively; names match case-insensitively. */
function termRegex(term, forceCase = false) {
  const t = String(term).trim();
  if (!t) return null;
  const caseSensitive = forceCase || isAcronym(t);
  const body = escapeRegex(t).replace(/\s+/g, '\\s+');
  return new RegExp(`${B}${body}${E}`, caseSensitive ? 'u' : 'iu');
}

/** Market vocabulary: an acronym hit from a global source only counts when one of these is present. */
const FINANCE_CONTEXT = new RegExp(
  `${B}(?:shares?|stocks?|share price|ltd|limited|q[1-4]|fy\\s?\\d{2}|profit|revenue|earnings|results|dividend|nse|bse|sensex|nifty|target|rating|brokerage|buy|sell|crore|m-?cap|market cap|ipo|block deal|stake)${E}|₹|${B}rs\\.?\\s?\\d`,
  'iu',
);

/**
 * Build matchers from config.
 * matchSymbols(text, {strict}) → watchlist symbols mentioned. With strict (global sources),
 *   a symbol matched only through a short acronym also needs market context in the text.
 * matchCompany(name) → exact listed-company match (exchange filings)
 * matchKeywords(text) → user keywords mentioned
 * isMuted(text) → true if a mute keyword appears
 */
export function buildMatcher(config) {
  const entries = [];
  for (const w of config.watchlist || []) {
    if (/^\^|=/.test(w.symbol)) continue; // indices / FX / futures don't appear in headlines by ticker
    const strong = [];
    const weak = [];
    const add = (term, forceCase = false) => {
      const re = termRegex(term, forceCase);
      if (re) (isAcronym(term) ? weak : strong).push(re);
    };
    const base = baseSymbol(w.symbol);
    if (base.length >= 3 && /^[A-Z][A-Z0-9&-]*$/.test(base) && !AMBIGUOUS_TICKERS.has(base)) add(base, true);
    const clean = cleanCompanyName(w.name);
    if (clean.length >= 2 && clean !== base) add(clean);
    for (const a of w.aliases || []) {
      const t = String(a || '').trim();
      if (t.length >= 2 && t !== base && t !== clean) add(t);
    }
    if (strong.length || weak.length) entries.push({ symbol: w.symbol, strong, weak, company: clean.toLowerCase() });
  }
  const keywords = (config.keywords || []).map((k) => ({ k, re: termRegex(k) })).filter((x) => x.re);
  const mutes = (config.muteKeywords || []).map((k) => termRegex(k)).filter(Boolean);

  return {
    matchSymbols(text, { strict = false } = {}) {
      if (!text) return [];
      const hits = [];
      for (const e of entries) {
        if (e.strong.some((re) => re.test(text))) hits.push(e.symbol);
        else if (e.weak.some((re) => re.test(text)) && (!strict || FINANCE_CONTEXT.test(text))) hits.push(e.symbol);
      }
      return hits;
    },
    /** Exact company match for exchange filings (title is the listed company name). */
    matchCompany(company) {
      const c = cleanCompanyName(company).toLowerCase();
      if (!c) return [];
      return entries.filter((e) => e.company && e.company === c).map((e) => e.symbol);
    },
    matchKeywords(text) {
      return keywords.filter((x) => x.re.test(text)).map((x) => x.k);
    },
    isMuted(text) {
      return mutes.some((re) => re.test(text));
    },
  };
}

// ---------------------------------------------------------------------------
// Sentiment: a small finance lexicon tuned for Indian market headlines.
// ---------------------------------------------------------------------------

const W = (src) => new RegExp(`${B}(?:${src})${E}`, 'iu');

const BULL = [
  [W('surge[sd]?|surging|soar(?:s|ed|ing)?|skyrocket\\w*|zoom(?:s|ed)?|rall(?:y|ies|ied|ying)|jump(?:s|ed)?|spurt(?:s|ed)?|climb(?:s|ed)?|rise[sn]?|rising|rose|gain(?:s|ed)?|advance[sd]?|up\\s?\\d+(?:\\.\\d+)?\\s?%|higher|extends? gains'), 1],
  [W('record high|all[- ]time high|52[- ]week high|lifetime high|fresh high|new high|upper circuit|multibagger|breakout'), 1.5],
  [W('upgrade[sd]?|outperform|overweight|buy rating|buy call|accumulate|top pick|target (?:raised|hiked)|raises? target|hikes? target|sees? \\d+% upside|upside'), 1.5],
  [W('beat[s]?(?: estimates)?|tops? estimates|above estimates|better[- ]than[- ]expected|strong|robust|stellar|bumper|blockbuster|record (?:profit|revenue|sales)'), 1],
  [W('(?:profit|earnings|revenue|sales|income|ebitda|margin|pat)s?\\s+(?:up|rise[sn]?|rose|jump(?:s|ed)?|grow(?:s|n)?|grew|surge[sd]?|soar(?:s|ed)?|climb(?:s|ed)?|double[sd]?|triple[sd]?|increase[sd]?|expand(?:s|ed)?)'), 2],
  [W('order win|wins? (?:an? )?(?:order|contract)|bags? (?:an? )?(?:order|contract)|secures? (?:an? )?(?:order|contract|deal)|order inflow|new orders?'), 1.5],
  [W('approv(?:al|es|ed)|nod|clearance|licen[cs]e granted|eir'), 0.5],
  [W('buyback|bonus issue|special dividend|stake (?:buy|hike|increase)|raises? stake'), 1],
  [W('bullish|optimistic|recovery|rebound(?:s|ed)?|bounce[sd]? back|turnaround|green'), 1],
  [W('(?:fii|fpi|dii)s? (?:buy|buying|inflows?)|net buyers?|inflows?'), 0.5],
  [W('rate cut|cuts? (?:repo |interest )?rates?'), 1],
];

const BEAR = [
  [W('plunge[sd]?|plummet\\w*|crash(?:es|ed)?|tank(?:s|ed)?|slump(?:s|ed)?|tumble[sd]?|sink(?:s)?|sank|slide[s]?|slid|fall(?:s|ing)?|fell|drop(?:s|ped)?|decline[sd]?|dip(?:s|ped)?|down\\s?\\d+(?:\\.\\d+)?\\s?%|shed[s]?|slip(?:s|ped)?|skid(?:s|ded)?|nosedive[sd]?|lower|extends? losses|wipe[sd]? out'), -1],
  [W('52[- ]week low|lower circuit|multi[- ]year low|record low|all[- ]time low|fresh low'), -1.5],
  [W('downgrade[sd]?|underperform|underweight|sell rating|sell call|reduce rating|target (?:cut|lowered|slashed)|cuts? target|lowers? target|downside'), -1.5],
  [W('miss(?:es|ed)? (?:estimates|expectations)|below estimates|weaker[- ]than[- ]expected|weak|disappoint\\w*|subdued|muted|tepid|dismal'), -1],
  [W('(?:profit|earnings|revenue|sales|income|ebitda|margin|pat)s?\\s+(?:fall(?:s)?|fell|drop(?:s|ped)?|decline[sd]?|slump(?:s|ed)?|plunge[sd]?|dip(?:s|ped)?|shrink(?:s)?|contract(?:s|ed)?|down|halve[sd]?)'), -2],
  [W('net loss|loss widens|losses widen|posts? (?:a )?loss|reports? (?:a )?loss|swings? to (?:a )?loss|turns? (?:to )?loss'), -1.5],
  [W('probe|raid(?:s|ed)?|fraud|scam|penalty|penali[sz]ed|fine[sd]?|ban(?:s|ned)?|default(?:s|ed)?|insolven\\w*|bankrupt\\w*|lawsuit|sue[sd]?|litigation|show[- ]cause|warning letter|import alert|recall(?:s|ed)?|resign(?:s|ed|ation)?|quits?|layoffs?|job cuts|strike|shutdown|halt(?:s|ed)?|suspend(?:s|ed)?|pledge[sd]?'), -1.5],
  [W('bearish|pessimistic|sell-?off|rout|bloodbath|panic|jitters|outflows?|net sellers?|(?:fii|fpi)s? (?:sell|selling|dump)|red'), -1],
  [W('rate hike|hikes? (?:repo |interest )?rates?'), -1],
];

export function sentiment(title, summary = '') {
  let score = 0;
  for (const [re, w] of BULL) {
    if (re.test(title)) score += w;
    else if (summary && re.test(summary)) score += w * 0.4;
  }
  for (const [re, w] of BEAR) {
    if (re.test(title)) score += w;
    else if (summary && re.test(summary)) score += w * 0.4;
  }
  score = Math.round(score * 10) / 10;
  return { score, label: score >= 1 ? 1 : score <= -1 ? -1 : 0 };
}

// ---------------------------------------------------------------------------
// Impact: how likely a story moves a stock / the market. 0 low · 2 medium · 3+ high
// ---------------------------------------------------------------------------

const HIGH = W([
  'q[1-4](?:\\s?fy\\s?\\d{2,4})?', '(?:quarterly|financial|annual|earnings|q[1-4]) results?', 'results? (?:today|preview|review|date|announcement)',
  'net profit', 'earnings', 'guidance', 'net loss',
  'merger', 'acquisitions?', 'acquires?', 'acquired', 'takeover', 'demerger', 'amalgamation', 'open offer',
  'buyback', 'bonus (?:issue|shares?)', 'stock split', 'block deals?', 'bulk deals?', 'stake sale', 'ofs', 'qip', 'rights issue',
  'ipo', 'listing', 'delisting', 'fund ?rais(?:e|ing)',
  'downgrade[sd]?', 'rating upgrade', 'upgrade[sd]? (?:\\S+ ){0,3}(?:to|at) (?:buy|outperform|overweight|accumulate|add|positive)', 'credit rating',
  'resign(?:s|ed|ation)?', 'steps? down', 'appoints? (?:new )?(?:ceo|md|managing director|chairman|cfo)',
  'fraud', 'raid(?:s|ed)?', 'probe', 'ban(?:s|ned)?', 'penalty', 'insolvency', 'default(?:s|ed)?',
  'usfda', 'fda', 'warning letter', 'import alert', 'eir',
  'orders? worth', 'wins? (?:an? )?order', 'bags? (?:an? )?order', 'contract worth',
  'repo rate', 'monetary policy', 'mpc', 'rate cut', 'rate hike', 'cpi', 'wpi', 'inflation', 'gdp', 'union budget', 'tariffs?', 'gst council',
  'upper circuit', 'lower circuit', 'circuit breaker', 'trading halt', 'suspension',
].join('|'));

const MEDIUM = W([
  'target price', 'buy rating', 'sell rating', 'buy call', 'sell call', 'stocks? to buy', 'top picks?', 'rating', 'dividend',
  'board meeting', 'record date', 'ex-date', 'fii', 'fpi', 'dii', 'crude', 'rupee', 'bond yields?', 'fed', 'rbi', 'sebi',
  'f&o', 'expiry', 'stake', 'promoter', 'pledge', 'shares? (?:rise|fall|jump|surge|plunge|tank|rally|slump|soar)',
].join('|'));

const ROUTINE_FILING = /newspaper|publication|trading window|loss of share|duplicate share|certificate under|regulation 74|reg\.?\s*74|compliance certificate|investor (?:meet|presentation)|analysts?\s*\/?\s*institutional|con\.?\s*call|earnings call|call recording|transcript|audio|statement of investor complaints|shareholding pattern|esops?|esos|change in registered office|book closure|record date|postal ballot|e-?voting|scrutini[sz]er|general meeting|agm|egm|updates?$|intimation of closure|reconciliation of share capital|annual report|business responsibility|copy of|disclosure under sebi \(sast\)|sast|regulation 31|monitoring agency|utili[sz]ation of funds/i;

/** Market-wide moves like "Sensex tanks 1,100 pts" or "Nifty falls 2%". */
function bigMarketMove(title) {
  if (!/\b(sensex|nifty|bank nifty|dalal street|markets?|stocks)\b/i.test(title)) return false;
  const pts = [...title.matchAll(/(\d{1,2},?\d{3}|\d{3,4})(?:\.\d+)?\s*(?:pts|points)/gi)].map((m) => +m[1].replace(/,/g, ''));
  if (pts.some((p) => p >= 700)) return true;
  const pct = [...title.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per ?cent\b|pc\b)/gi)].map((m) => +m[1]);
  if (pct.some((p) => p >= 1.5) && /\b(sensex|nifty)\b/i.test(title)) return true;
  return /\b(market crash|bloodbath|black (?:monday|tuesday|wednesday|thursday|friday)|circuit breaker)\b/i.test(title);
}

export function isRoutineFiling(item) {
  return item.kind === 'filing' && ROUTINE_FILING.test(`${item.subject || ''} ${item.title}`);
}

export function impact(item, { symbols = [], keywords = [] } = {}) {
  const text = `${item.title} ${item.subject || ''}`;
  let score = 0;
  if (HIGH.test(text)) score = 2;
  else if (MEDIUM.test(text)) score = 1;
  if (bigMarketMove(item.title)) score = Math.max(score, 3);
  if (item.kind === 'filing') score = isRoutineFiling(item) ? 0 : Math.max(score, 1);
  if (item.kind === 'regulator' && /monetary policy|repo rate|circular|framework|f&o|derivatives?/i.test(text)) score = Math.max(score, 2);
  const base = score;
  if (base >= 1 && symbols.length) score += 1; // about a stock you hold/watch
  if (base >= 2 && keywords.length) score += 1; // a topic you flagged, and already a big story
  return Math.min(score, 4);
}

// ---------------------------------------------------------------------------
// Duplicate detection across sources (same story, different outlet)
// ---------------------------------------------------------------------------

const STOP = new Set(('a an the of to in on for and or with as at by from is are was were be been its it this that these those ' +
  'after amid over says said say report reports shares share stock stocks check details here why what how today live ' +
  'updates update news latest know all about you your should will may can could new vs per cent pc rs crore cr lakh').split(' '));

export function titleTokens(title) {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/[’'`]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function isDuplicate(tokensA, tokensB) {
  if (Math.min(tokensA.size, tokensB.size) < 4) return false;
  return similarity(tokensA, tokensB) >= 0.7;
}
