import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatcher, sentiment, impact, titleTokens, isDuplicate, cleanCompanyName, isRoutineFiling } from '../lib/match.mjs';
import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config.mjs';
import { watchlistSources } from '../lib/sources.mjs';

const m = buildMatcher(normalizeConfig(DEFAULT_CONFIG));

test('company names and tickers match; tickers are case-sensitive', () => {
  assert.deepEqual(m.matchSymbols('Reliance Industries shares rebound 15% in November'), ['RELIANCE.NS']);
  assert.deepEqual(m.matchSymbols('NSE:RELIANCE hits record'), ['RELIANCE.NS']);
  // regression: "reliance on oil" and other Reliance-group companies must not match
  assert.deepEqual(m.matchSymbols('Ecuador faces a key challenge: its reliance on oil'), []);
  assert.deepEqual(m.matchSymbols('Reliance Communications Limited: Outcome of Board Meeting'), []);
  assert.deepEqual(m.matchSymbols('HDFC Bank, ICICI Bank lead gains'), ['HDFCBANK.NS', 'ICICIBANK.NS']);
  assert.deepEqual(m.matchSymbols('L&T bags mega order'), ['LT.NS']);
});

test('strict mode: acronyms from global sources need market context', () => {
  assert.deepEqual(m.matchSymbols('SBI investigating after inmate dies at county jail', { strict: true }), []);
  assert.deepEqual(m.matchSymbols('2026 ISC and ITC Nationals bowling scores', { strict: true }), []);
  assert.deepEqual(m.matchSymbols('SBI shares hit record high after Q2 results', { strict: true }), ['SBIN.NS']);
  assert.deepEqual(m.matchSymbols('SBI cuts lending rates', { strict: false }), ['SBIN.NS']);
  // full names are never "weak"
  assert.deepEqual(m.matchSymbols('State Bank of India opens new branch', { strict: true }), ['SBIN.NS']);
});

test('exchange filings match only the exact listed company', () => {
  assert.deepEqual(m.matchCompany('Bharti Airtel Limited'), ['BHARTIARTL.NS']);
  assert.deepEqual(m.matchCompany('SBI Mutual Fund - SBI Gold ETF'), []);
  assert.deepEqual(m.matchCompany('L&T Finance Limited'), []);
  assert.deepEqual(m.matchCompany('Reliance Communications Limited'), []);
  assert.equal(cleanCompanyName('Larsen & Toubro Limited'), 'Larsen & Toubro');
  assert.equal(cleanCompanyName('Infosys Ltd.'), 'Infosys');
});

test('keywords and mutes', () => {
  assert.deepEqual(m.matchKeywords('RBI keeps repo rate unchanged'), ['RBI', 'repo rate']);
  assert.deepEqual(m.matchKeywords('Carbide maker rallies'), []);
  assert.equal(m.isMuted('SBI Clerk Admit Card 2026 out'), true);
  assert.equal(m.isMuted('Gold rate today: prices fall'), true);
  assert.equal(m.isMuted('HDFC Bank Q2 profit jumps'), false);
});

test('sentiment reads common headline language', () => {
  assert.equal(sentiment('HDFC Bank Q2 profit jumps 12%, beats estimates').label, 1);
  assert.equal(sentiment('Infosys shares slump 5% after Morgan Stanley downgrade').label, -1);
  assert.equal(sentiment('SEBI bans promoter over fraud').label, -1);
  assert.equal(sentiment('Company to hold board meeting on Friday').label, 0);
});

test('impact: results/earnings high, exam "result" not, market crash high', () => {
  assert.ok(impact({ title: 'TCS Q2 results: net profit rises 9%', kind: 'news' }, { symbols: ['TCS.NS'] }) >= 3);
  assert.equal(impact({ title: 'SBI Clerk Prelims Result 2026: check date', kind: 'news' }), 0);
  assert.ok(impact({ title: 'Sensex tanks 1,100 points as FIIs dump stocks', kind: 'news' }) >= 3);
  assert.ok(impact({ title: 'Nifty falls 2% in broad sell-off', kind: 'news' }) >= 3);
  assert.equal(impact({ title: 'Nifty ends flat', kind: 'news' }), 0);
  assert.equal(impact({ title: 'Ground stop followed contractor upgrade to telecom system', kind: 'news' }), 0);
  assert.ok(impact({ title: 'Morgan Stanley upgrades Infosys to overweight', kind: 'news' }) >= 2);
  const routine = { title: 'Bharti Airtel Limited: Copy of Newspaper Publication', subject: 'Copy of Newspaper Publication', kind: 'filing' };
  assert.equal(isRoutineFiling(routine), true);
  assert.equal(impact(routine, { symbols: ['BHARTIARTL.NS'] }), 0);
  assert.ok(impact({ title: 'Reliance Industries Limited: Acquisition', subject: 'Acquisition', kind: 'filing' }, { symbols: ['RELIANCE.NS'] }) >= 3);
});

test('keyword boost only applies to already-important stories', () => {
  const small = impact({ title: 'Bank holiday: are banks open? Check RBI calendar', kind: 'news' }, { symbols: ['SBIN.NS'], keywords: ['RBI'] });
  assert.ok(small <= 2, `expected ≤2, got ${small}`);
});

test('duplicate detection across outlets', () => {
  const a = titleTokens('Reliance Industries shares rebound 15% in November, add ₹2.38 lakh crore in market value');
  const b = titleTokens('Reliance Industries shares rebound 15% in November, add Rs 2.38 lakh crore in market value; what changed?');
  const c = titleTokens('HDFC Bank shares fall over 1% amid market weakness');
  assert.equal(isDuplicate(a, b), true);
  assert.equal(isDuplicate(a, c), false);
});

test('Google News watchlist queries use full names and market words', () => {
  const srcs = watchlistSources(normalizeConfig(DEFAULT_CONFIG).watchlist);
  assert.equal(srcs.length, 2);
  const q = decodeURIComponent(new URL(srcs[0].url).searchParams.get('q'));
  assert.match(q, /"Reliance Industries"/);
  assert.match(q, /"State Bank of India"/);
  assert.match(q, /\(share OR shares OR stock/);
  assert.ok(srcs.every((s) => s.strict && s.google));
});
