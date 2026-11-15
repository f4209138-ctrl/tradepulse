// Pure logic from the web app, run under Node (no DOM needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivots, pivotBasis, nseStatus, histKey, tradingViewUrl, baseSym } from '../../app/js/market.js';
import { stats } from '../../app/js/views/journal.js';
import { fmt, fmtCompact, fmtPct } from '../../app/js/ui.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('classic pivots and CPR', () => {
  const p = pivots(110, 100, 105);
  const get = (rows, k) => rows.find(([x]) => x === k)[1];
  assert.ok(close(get(p.classic, 'P'), 105));
  assert.ok(close(get(p.classic, 'R1'), 110));
  assert.ok(close(get(p.classic, 'S1'), 100));
  assert.ok(close(get(p.classic, 'R2'), 115));
  assert.ok(close(get(p.camarilla, 'R4'), 105 + 5.5));
  assert.ok(close(p.cpr.p, 105));
  assert.ok(close(p.cpr.bc, 105) && close(p.cpr.tc, 105));
  assert.equal(pivots(100, 110, 105), null);
});

test('pivot basis: previous session during the day, today after the close', () => {
  const hist = { t: [Date.parse('2026-11-12T03:45:00Z'), Date.parse('2026-11-13T03:45:00Z'), Date.parse('2026-11-16T03:45:00Z')], h: [10, 20, 30], l: [1, 2, 3], c: [5, 15, 25] };
  const midday = Date.parse('2026-11-16T06:00:00Z'); // Mon 11:30 IST
  const b1 = pivotBasis(hist, { time: midday, high: 31, low: 3, price: 28 }, midday);
  assert.deepEqual([b1.h, b1.l, b1.c], [20, 2, 15]);
  const evening = Date.parse('2026-11-16T12:00:00Z'); // Mon 17:30 IST
  const b2 = pivotBasis(hist, { time: Date.parse('2026-11-16T10:00:00Z'), high: 31, low: 3, price: 28 }, evening);
  assert.deepEqual([b2.h, b2.l, b2.c], [31, 3, 28]);
});

test('NSE session status', () => {
  const at = (iso, q) => nseStatus(q, Date.parse(iso)).state;
  assert.equal(at('2026-11-16T05:00:00Z', { time: Date.parse('2026-11-16T04:58:00Z') }), 'open'); // Mon 10:30
  assert.equal(at('2026-11-16T03:35:00Z'), 'pre'); // 09:05
  assert.equal(at('2026-11-16T11:00:00Z'), 'closed'); // 16:30
  assert.equal(at('2026-11-15T05:00:00Z'), 'closed'); // Sunday
  // holiday heuristic: "open" hours but no fresh prints
  assert.equal(nseStatus({ time: Date.parse('2026-11-13T10:00:00Z') }, Date.parse('2026-11-16T05:00:00Z')).label, 'No trading');
});

test('symbol helpers', () => {
  assert.equal(histKey('^NSEI'), '_5ENSEI');
  assert.equal(histKey('M&M.NS'), 'M_26M.NS');
  assert.equal(histKey('INR=X'), 'INR_3DX');
  assert.equal(baseSym('RELIANCE.NS'), 'RELIANCE');
  assert.match(tradingViewUrl('M&M.NS'), /symbol=NSE%3AM_M$/);
  assert.match(tradingViewUrl('^NSEBANK'), /NSE%3ABANKNIFTY/);
});

test('Indian number formatting', () => {
  assert.equal(fmt(1234567.891), '12,34,567.89');
  assert.equal(fmtCompact(25000000), '2.50 Cr');
  assert.equal(fmtCompact(450000), '4.50 L');
  assert.equal(fmtPct(-1.234), '−1.23%');
});

test('journal stats', () => {
  const s = stats([
    { date: '2026-11-01', side: 'long', qty: 10, entry: 100, exit: 110, stop: 95, fees: 0 },
    { date: '2026-11-02', side: 'short', qty: 10, entry: 100, exit: 105, stop: 105, fees: 0 },
    { date: '2026-11-03', side: 'long', qty: 10, entry: 100, exit: 120, stop: 90, fees: 20 },
    { date: '2026-11-04', side: 'long', qty: 5, entry: 100, exit: null },
  ]);
  assert.equal(s.closed, 3);
  assert.equal(s.open, 1);
  assert.equal(s.net, 100 - 50 + 180);
  assert.ok(close(s.winRate, (2 / 3) * 100));
  assert.ok(close(s.profitFactor, 280 / 50));
  assert.equal(s.maxDD, 50);
  assert.ok(close(s.avgR, (2 + -1 + 1.8) / 3));
});
