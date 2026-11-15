import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsAlertCandidates, newsPayload, evaluatePriceAlerts, evaluateBigMoves, isQuiet, pricePayload } from '../lib/alerts.mjs';
import { normalizeConfig, DEFAULT_CONFIG } from '../lib/config.mjs';

const NOW = Date.parse('2026-11-16T05:00:00Z'); // Mon 10:30 IST
const cfg = (patch = {}) => normalizeConfig({ ...DEFAULT_CONFIG, ...patch, alerts: { ...DEFAULT_CONFIG.alerts, ...(patch.alerts || {}) } });
const item = (o) => ({ id: Math.random().toString(36).slice(2), kind: 'news', title: 'x', syms: [], kws: [], imp: 0, sent: 0, pub: NOW - 60e3, seen: NOW, ...o });

test('news alerts: watchlist, filings, keywords, breaking; old stories never alert', () => {
  const items = [
    item({ title: 'w', syms: ['TCS.NS'] }),
    item({ title: 'kw', kws: ['RBI'], imp: 1 }),
    item({ title: 'big', imp: 3 }),
    item({ title: 'meh', imp: 2 }),
    item({ title: 'filing-routine', kind: 'filing', syms: ['TCS.NS'], imp: 0 }),
    item({ title: 'filing', kind: 'filing', syms: ['TCS.NS'], imp: 2 }),
    item({ title: 'old', syms: ['TCS.NS'], pub: NOW - 5 * 3600e3 }),
  ];
  const got = newsAlertCandidates(items, cfg(), NOW).map((c) => c.item.title);
  assert.deepEqual(got.sort(), ['big', 'filing', 'kw', 'w']);
});

test('news alerts respect toggles and minimum impact', () => {
  const items = [item({ title: 'w0', syms: ['TCS.NS'], imp: 1 }), item({ title: 'w3', syms: ['TCS.NS'], imp: 3 }), item({ title: 'big', imp: 3 })];
  const got = newsAlertCandidates(items, cfg({ alerts: { minImpact: 'high', breakingMarket: false } }), NOW).map((c) => c.item.title);
  assert.deepEqual(got, ['w3']);
});

test('news payload is compact and routes back into the app', () => {
  const p = newsPayload({ item: item({ id: 'abc', title: 'TCS wins $1bn deal', syms: ['TCS.NS'], sent: 1, imp: 3, url: 'https://e.com/a' }), reason: 'watchlist' }, 'Mint · Markets', false);
  assert.equal(p.title, '📈 TCS · High impact');
  assert.match(p.body, /^TCS wins \$1bn deal\nMint · Markets$/);
  assert.equal(p.route, '#/news/abc');
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 3000);
});

test('price alerts: one-shot fires once; repeat re-arms after crossing back', () => {
  const state = {};
  const c = cfg({ priceAlerts: [
    { id: 'a1', symbol: 'TCS.NS', op: 'above', value: 4000 },
    { id: 'a2', symbol: 'TCS.NS', op: 'above', value: 4000, repeat: true },
  ] });
  const q = (price) => ({ 'TCS.NS': { price, chgPct: 0, time: NOW, dp: 2 } });
  assert.deepEqual(evaluatePriceAlerts(c, q(3990), state, NOW).map((f) => f.pa.id), []);
  assert.deepEqual(evaluatePriceAlerts(c, q(4005), state, NOW + 1).map((f) => f.pa.id), ['a1', 'a2']);
  assert.deepEqual(evaluatePriceAlerts(c, q(4010), state, NOW + 2).map((f) => f.pa.id), []);
  assert.deepEqual(evaluatePriceAlerts(c, q(3980), state, NOW + 3).map((f) => f.pa.id), []);
  // back above, but within the 30-minute cooldown
  assert.deepEqual(evaluatePriceAlerts(c, q(4001), state, NOW + 60e3).map((f) => f.pa.id), []);
  evaluatePriceAlerts(c, q(3970), state, NOW + 40 * 60e3);
  assert.deepEqual(evaluatePriceAlerts(c, q(4002), state, NOW + 41 * 60e3).map((f) => f.pa.id), ['a2']);
  // deleted alerts are forgotten
  evaluatePriceAlerts(cfg({ priceAlerts: [] }), q(4002), state, NOW);
  assert.deepEqual(Object.keys(state.priceAlerts), []);
});

test('percent alerts fire once per day, only on today\'s quotes', () => {
  const state = {};
  const c = cfg({ priceAlerts: [{ id: 'p', symbol: 'INFY.NS', op: 'pct_down', value: 3 }] });
  const stale = { 'INFY.NS': { price: 100, chgPct: -4, time: NOW - 3 * 86400e3 } };
  assert.equal(evaluatePriceAlerts(c, stale, state, NOW).length, 0);
  const live = { 'INFY.NS': { price: 100, chgPct: -4, time: NOW } };
  assert.equal(evaluatePriceAlerts(c, live, state, NOW).length, 1);
  assert.equal(evaluatePriceAlerts(c, live, state, NOW + 3600e3).length, 0);
  const p = pricePayload({ pa: c.priceAlerts[0], q: live['INFY.NS'] }, false);
  assert.equal(p.title, '🎯 INFY down 3%');
});

test('big-move alerts: once per stock, direction and day', () => {
  const state = {};
  const c = cfg();
  const quotes = { 'TCS.NS': { price: 1, chgPct: 3.4, time: NOW }, 'ITC.NS': { price: 1, chgPct: -1, time: NOW } };
  assert.deepEqual(evaluateBigMoves(c, quotes, state, NOW).map((x) => x.w.symbol), ['TCS.NS']);
  assert.equal(evaluateBigMoves(c, quotes, state, NOW + 60e3).length, 0);
});

test('quiet hours use the configured time zone', () => {
  const c = cfg();
  assert.equal(isQuiet(c, Date.parse('2026-11-16T18:00:00Z')), true); // 23:30 IST
  assert.equal(isQuiet(c, Date.parse('2026-11-16T05:00:00Z')), false); // 10:30 IST
  assert.equal(isQuiet(cfg({ alerts: { quietHours: { enabled: false } } }), Date.parse('2026-11-16T18:00:00Z')), false);
});

test('config normalisation drops junk safely', () => {
  const c = normalizeConfig({
    timezone: 'Not/AZone',
    watchlist: ['tcs.ns', { symbol: 'TCS.NS' }, { symbol: '<script>' }, { symbol: 'M&M.NS', aliases: ['M&M', '', 7] }],
    priceAlerts: [{ id: 'x', symbol: 'TCS.NS', op: 'nope', value: 1 }, { id: 'y', symbol: 'TCS.NS', op: 'below', value: '3500' }],
    alerts: { maxPerRun: 999, bigMove: { pct: -5 } },
    sources: { custom: [{ name: 'x', url: 'javascript:alert(1)' }, { name: 'ok', url: 'https://a.com/rss' }] },
  });
  assert.equal(c.timezone, 'Asia/Kolkata');
  assert.deepEqual(c.watchlist.map((w) => w.symbol), ['TCS.NS', 'M&M.NS']);
  assert.deepEqual(c.watchlist[1].aliases, ['M&M']);
  assert.deepEqual(c.priceAlerts.map((p) => [p.id, p.value]), [['y', 3500]]);
  assert.equal(c.alerts.maxPerRun, 20);
  assert.equal(c.alerts.bigMove.pct, 3);
  assert.deepEqual(c.sources.custom, [{ name: 'ok', url: 'https://a.com/rss' }]);
});
