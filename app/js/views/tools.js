import { store, config, quote, saveLocal } from '../store.js';
import { $, esc, fmt, rupee, num, icon } from '../ui.js';
import { pivots, pivotBasis, baseSym } from '../market.js';
import { loadHistory } from '../api.js';

export const title = 'Trading tools';

const TABS = [['position', 'Position size'], ['rr', 'Risk : Reward'], ['pivots', 'Pivots'], ['avg', 'Average'], ['pnl', 'P&L']];

const remember = (tab, form) => {
  const v = {};
  for (const i of form.querySelectorAll('input, select')) if (i.name) v[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  store.local.calc[tab] = v;
  saveLocal();
};
const saved = (tab, name, d = '') => esc(store.local.calc?.[tab]?.[name] ?? d);
const field = (tab, name, label, d = '', attrs = '') =>
  `<label class="field"><span>${label}</span><input class="input num" name="${name}" type="number" inputmode="decimal" step="any" value="${saved(tab, name, d)}" ${attrs}></label>`;
const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="num ${cls}">${v}</b></div>`;

// ---------------------------------------------------------------- calculators

const CALC = {
  position: {
    form: () => `
      <div class="grid2">${field('position', 'capital', 'Capital (₹)', '100000')}${field('position', 'risk', 'Risk per trade (%)', '1')}</div>
      <div class="grid2" style="margin-top:12px">${field('position', 'entry', 'Entry price')}${field('position', 'stop', 'Stop loss')}</div>
      <div class="grid2" style="margin-top:12px">${field('position', 'lot', 'Lot size (F&amp;O, else 1)', '1')}${field('position', 'lev', 'Leverage (1 = delivery)', '1')}</div>`,
    calc(f) {
      const capital = num(f.capital.value), riskPct = num(f.risk.value), entry = num(f.entry.value), stop = num(f.stop.value);
      const lot = Math.max(1, Math.round(num(f.lot.value) || 1)), lev = Math.max(0.1, num(f.lev.value) || 1);
      if (![capital, riskPct, entry, stop].every(Number.isFinite) || entry <= 0 || capital <= 0) return '<p class="muted small" style="margin:0">Enter capital, risk, entry and stop loss.</p>';
      const per = Math.abs(entry - stop);
      if (!per) return '<p class="bad small" style="margin:0">Stop loss must differ from entry.</p>';
      const long = stop < entry;
      const riskAmt = (capital * riskPct) / 100;
      const byRisk = Math.floor(riskAmt / per / lot) * lot;
      const byCap = Math.floor((capital * lev) / entry / lot) * lot;
      const qty = Math.max(0, Math.min(byRisk, byCap));
      const capped = byCap < byRisk;
      const value = qty * entry;
      const actual = qty * per;
      const t = (r) => (long ? entry + r * per : entry - r * per);
      return `<div class="muted small">${long ? 'Long' : 'Short'} · risking ${fmt(per)} per share</div>
        <div class="hero num">${qty.toLocaleString('en-IN')} <span class="muted" style="font-size:15px;font-weight:600">${lot > 1 ? `shares · ${qty / lot} lot${qty / lot === 1 ? '' : 's'}` : 'shares'}</span></div>
        ${capped ? '<p class="warn small" style="margin:4px 0 8px">Capped by your capital × leverage, not by risk.</p>' : ''}
        ${kv('Max risk allowed', rupee(riskAmt, 0))}
        ${kv('Actual risk at stop', `${rupee(actual, 0)} (${((actual / capital) * 100).toFixed(2)}%)`, 'down')}
        ${kv('Position value', `${rupee(value, 0)} (${((value / capital) * 100).toFixed(1)}% of capital)`)}
        <hr class="sep">
        ${[1, 1.5, 2, 3].map((r) => kv(`Target ${r}R`, `${fmt(t(r))} · +${rupee(qty * per * r, 0)}`, 'up')).join('')}`;
    },
  },
  rr: {
    form: () => `
      <div class="grid3">${field('rr', 'entry', 'Entry')}${field('rr', 'stop', 'Stop')}${field('rr', 'target', 'Target')}</div>
      <div style="margin-top:12px">${field('rr', 'qty', 'Quantity (optional)')}</div>`,
    calc(f) {
      const e = num(f.entry.value), s = num(f.stop.value), t = num(f.target.value), q = num(f.qty.value);
      if (![e, s, t].every(Number.isFinite)) return '<p class="muted small" style="margin:0">Enter entry, stop and target.</p>';
      const risk = Math.abs(e - s), reward = Math.abs(t - e);
      if (!risk) return '<p class="bad small" style="margin:0">Stop must differ from entry.</p>';
      if ((s < e) !== (t > e)) return '<p class="bad small" style="margin:0">Target and stop must be on opposite sides of entry.</p>';
      const rr = reward / risk;
      const be = 100 / (1 + rr);
      return `<div class="muted small">Reward : Risk</div><div class="hero num ${rr >= 2 ? 'up' : rr < 1 ? 'down' : ''}">1 : ${rr.toFixed(2)}</div>
        ${kv('Risk per share', fmt(risk), 'down')}${kv('Reward per share', fmt(reward), 'up')}
        ${kv('Break-even win rate', `${be.toFixed(1)}%`)}
        ${Number.isFinite(q) && q > 0 ? kv('Loss at stop', rupee(-risk * q, 0), 'down') + kv('Profit at target', rupee(reward * q, 0), 'up') : ''}
        <p class="note">With this R:R you need to win more than ${be.toFixed(0)}% of trades to make money (before costs).</p>`;
    },
  },
  pivots: {
    form: () => {
      const cfg = config() || {};
      const syms = [...new Set([...(cfg.markets || []).filter((s) => /NSEI|BSESN|NSEBANK/.test(s)), ...(cfg.watchlist || []).map((w) => w.symbol)])];
      return `<label class="field"><span>Fill from previous session</span><select class="input" name="fill"><option value="">— pick a symbol —</option>${syms.map((s) => `<option value="${esc(s)}">${esc(baseSym(s))}</option>`).join('')}</select></label>
        <div class="grid3" style="margin-top:12px">${field('pivots', 'h', 'High')}${field('pivots', 'l', 'Low')}${field('pivots', 'c', 'Close')}</div>`;
    },
    calc(f) {
      const p = pivots(num(f.h.value), num(f.l.value), num(f.c.value));
      if (!p) return '<p class="muted small" style="margin:0">Enter the previous session\'s high, low and close.</p>';
      const methods = [['Classic', p.classic], ['Fibonacci', p.fibonacci], ['Camarilla', p.camarilla], ['Woodie', p.woodie]];
      const levels = ['R4', 'R3', 'R2', 'R1', 'P', 'S1', 'S2', 'S3', 'S4'];
      const val = (rows, k) => { const r = rows.find(([x]) => x === k); return r ? fmt(r[1]) : ''; };
      return `<div style="overflow-x:auto"><table class="tbl num"><tr><th></th>${methods.map(([m]) => `<th class="r">${m}</th>`).join('')}</tr>
        ${levels.map((k) => `<tr><td class="${k[0] === 'R' ? 'down' : k[0] === 'S' ? 'up' : ''}"><b>${k}</b></td>${methods.map(([, rows]) => `<td class="r">${val(rows, k)}</td>`).join('')}</tr>`).join('')}</table></div>
        <hr class="sep">${kv('CPR top (TC)', fmt(p.cpr.tc))}${kv('Pivot', fmt(p.cpr.p))}${kv('CPR bottom (BC)', fmt(p.cpr.bc))}
        ${kv('CPR width', `${p.cpr.widthPct.toFixed(2)}%`)}<p class="note">Narrow CPR often precedes a trending day; wide CPR a range-bound one.</p>`;
    },
    async onChange(e, f, rerun) {
      if (e?.target?.name !== 'fill' || !e.target.value) return;
      const sym = e.target.value;
      const basis = pivotBasis(await loadHistory(sym), quote(sym));
      if (!basis) return;
      const dp = quote(sym)?.dp ?? 2;
      f.h.value = basis.h.toFixed(dp);
      f.l.value = basis.l.toFixed(dp);
      f.c.value = basis.c.toFixed(dp);
      rerun();
    },
  },
  avg: {
    form: () => {
      const rows = Math.max(2, Math.min(10, Number(store.local.calc?.avg?.rows) || 3));
      return `<input type="hidden" name="rows" value="${rows}">
        ${Array.from({ length: rows }, (_, i) => `<div class="grid2" style="margin-top:${i ? 10 : 0}px">${field('avg', `q${i}`, `Buy ${i + 1} · qty`)}${field('avg', `p${i}`, 'price')}</div>`).join('')}
        <button class="btn sm" type="button" data-addrow style="margin-top:10px">${icon('plus', 16)} Add buy</button>
        <hr class="sep"><div class="small muted" style="margin-bottom:8px">Averaging helper</div>
        <div class="grid2">${field('avg', 'cmp', 'Current price')}${field('avg', 'goal', 'Target average')}</div>`;
    },
    calc(f) {
      const rows = Number(f.rows.value) || 3;
      let qty = 0, cost = 0;
      for (let i = 0; i < rows; i++) {
        const q = num(f[`q${i}`]?.value), p = num(f[`p${i}`]?.value);
        if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0) { qty += q; cost += q * p; }
      }
      if (!qty) return '<p class="muted small" style="margin:0">Enter at least one buy (quantity and price).</p>';
      const avg = cost / qty;
      let help = '';
      const cmp = num(f.cmp.value), goal = num(f.goal.value);
      if ([cmp, goal].every(Number.isFinite)) {
        const n = (qty * (avg - goal)) / (goal - cmp);
        help = n > 0 && Number.isFinite(n)
          ? kv(`Buy at ${fmt(cmp)} to reach avg ${fmt(goal)}`, `${Math.ceil(n).toLocaleString('en-IN')} shares (${rupee(Math.ceil(n) * cmp, 0)})`)
          : '<p class="warn small" style="margin:6px 0 0">Target average must lie between the current price and your average.</p>';
      }
      return `<div class="muted small">Average price</div><div class="hero num">${fmt(avg)}</div>
        ${kv('Total quantity', qty.toLocaleString('en-IN'))}${kv('Total invested', rupee(cost))}
        ${Number.isFinite(cmp) ? kv('P&L at current price', rupee((cmp - avg) * qty), cmp >= avg ? 'up' : 'down') : ''}${help}`;
    },
  },
  pnl: {
    form: () => `
      <div class="seg full" style="margin-bottom:12px"><button type="button" data-side="long" class="${saved('pnl', 'side', 'long') === 'long' ? 'on' : ''}">Buy → Sell</button><button type="button" data-side="short" class="${saved('pnl', 'side', 'long') === 'short' ? 'on' : ''}">Sell → Buy</button></div>
      <input type="hidden" name="side" value="${saved('pnl', 'side', 'long')}">
      <div class="grid3">${field('pnl', 'qty', 'Quantity')}${field('pnl', 'entry', 'Entry')}${field('pnl', 'exit', 'Exit')}</div>
      <div style="margin-top:12px">${field('pnl', 'fees', 'Brokerage + taxes (₹, optional)', '0')}</div>`,
    calc(f) {
      const q = num(f.qty.value), e = num(f.entry.value), x = num(f.exit.value), fees = num(f.fees.value) || 0;
      if (![q, e, x].every(Number.isFinite) || q <= 0 || e <= 0) return '<p class="muted small" style="margin:0">Enter quantity, entry and exit.</p>';
      const sign = f.side.value === 'short' ? -1 : 1;
      const gross = (x - e) * q * sign;
      const net = gross - fees;
      return `<div class="muted small">Net P&amp;L</div><div class="hero num ${net >= 0 ? 'up' : 'down'}">${rupee(net)}</div>
        ${kv('Gross', rupee(gross), gross >= 0 ? 'up' : 'down')}${kv('Charges', rupee(-fees))}
        ${kv('Return on trade value', `${((net / (e * q)) * 100).toFixed(2)}%`, net >= 0 ? 'up' : 'down')}
        ${kv('Break-even exit', fmt(e + (sign * fees) / q))}`;
    },
  },
};

export function render(el, [tab] = []) {
  const active = CALC[tab] ? tab : 'position';
  el.innerHTML = `
    <div class="filters">${TABS.map(([id, l]) => `<a class="fchip${id === active ? ' on' : ''}" href="#/tools/${id}" style="display:inline-flex;align-items:center">${l}</a>`).join('')}</div>
    <form class="card" id="t-form" onsubmit="return false">${CALC[active].form()}<div class="result" id="t-out"></div></form>
    <p class="note">Inputs are remembered on this device. Results are estimates before brokerage, STT and other charges unless you include them.</p>`;
  const form = $('#t-form', el);
  const run = () => {
    remember(active, form);
    $('#t-out', el).innerHTML = CALC[active].calc(form.elements);
  };
  form.addEventListener('input', run);
  form.addEventListener('change', (e) => CALC[active].onChange?.(e, form.elements, run));
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-addrow]')) {
      remember(active, form);
      store.local.calc.avg.rows = Math.min(10, (Number(store.local.calc.avg.rows) || 3) + 1);
      saveLocal();
      render(el, [active]);
    }
    const side = e.target.closest('[data-side]');
    if (side) {
      form.elements.side.value = side.dataset.side;
      form.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b === side));
      run();
    }
  });
  run();
}
