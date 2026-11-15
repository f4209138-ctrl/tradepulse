import { loadJournal, saveJournal, config } from '../store.js';
import { $, esc, icon, fmt, rupee, num, toast, sheet, confirmSheet, sparkline } from '../ui.js';
import { baseSym } from '../market.js';

export const title = 'Trade journal';

const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const pnlOf = (t) => (Number.isFinite(t.exit) ? (t.exit - t.entry) * t.qty * (t.side === 'short' ? -1 : 1) - (t.fees || 0) : null);
const rOf = (t) => {
  const p = pnlOf(t);
  if (p == null || !Number.isFinite(t.stop) || t.stop === t.entry) return null;
  return p / (Math.abs(t.entry - t.stop) * t.qty);
};

export function stats(trades) {
  const closed = trades.filter((t) => pnlOf(t) != null).sort((a, b) => a.date.localeCompare(b.date));
  const pnls = closed.map(pnlOf);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  let peak = 0;
  let eq = 0;
  let maxDD = 0;
  const curve = [0];
  for (const p of pnls) {
    eq += p;
    curve.push(eq);
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, peak - eq);
  }
  const rs = closed.map(rOf).filter((r) => r != null);
  const byTag = {};
  for (const t of closed) {
    const k = t.tag || 'Untagged';
    (byTag[k] ||= []).push(pnlOf(t));
  }
  return {
    closed: closed.length,
    open: trades.length - closed.length,
    net: sum(pnls),
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    avgWin: wins.length ? sum(wins) / wins.length : null,
    avgLoss: losses.length ? sum(losses) / losses.length : null,
    profitFactor: losses.length ? sum(wins) / Math.abs(sum(losses)) : wins.length ? Infinity : null,
    expectancy: closed.length ? sum(pnls) / closed.length : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    maxDD,
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    curve,
    byTag: Object.entries(byTag).map(([k, v]) => ({ tag: k, n: v.length, net: sum(v), win: (v.filter((p) => p > 0).length / v.length) * 100 })).sort((a, b) => b.net - a.net),
  };
}

const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="num ${cls}">${v}</b></div>`;
const signCls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

function summaryHtml(s) {
  if (!s.closed) return `<p class="muted" style="margin:0">No closed trades yet. Log trades to see your win rate, expectancy and equity curve.${s.open ? ` (${s.open} open)` : ''}</p>`;
  return `<div class="row between"><div><div class="muted small">Net P&amp;L · ${s.closed} closed${s.open ? ` · ${s.open} open` : ''}</div>
      <div class="hero num ${signCls(s.net)}" style="font-size:26px;font-weight:800">${rupee(s.net, 0)}</div></div>
      ${sparkline(s.curve, { w: 120, h: 40, cls: s.net >= 0 ? 'up' : 'down' })}</div>
    <hr class="sep">
    <div class="grid2" style="gap:0 16px">
      ${kv('Win rate', s.winRate != null ? `${s.winRate.toFixed(0)}%` : '—')}
      ${kv('Profit factor', s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2), s.profitFactor >= 1 ? 'up' : 'down')}
      ${kv('Avg win', s.avgWin != null ? rupee(s.avgWin, 0) : '—', 'up')}
      ${kv('Avg loss', s.avgLoss != null ? rupee(s.avgLoss, 0) : '—', 'down')}
      ${kv('Expectancy', s.expectancy != null ? rupee(s.expectancy, 0) : '—', signCls(s.expectancy))}
      ${kv('Avg R', s.avgR != null ? `${s.avgR.toFixed(2)}R` : '—', signCls(s.avgR))}
      ${kv('Max drawdown', rupee(-s.maxDD, 0), s.maxDD ? 'down' : '')}
      ${kv('Best / worst', `${rupee(s.best, 0)} / ${rupee(s.worst, 0)}`)}
    </div>
    ${s.byTag.length > 1 ? `<hr class="sep"><div class="small muted" style="margin-bottom:4px">By setup</div>${s.byTag.map((b) => kv(`${esc(b.tag)} · ${b.n} · ${b.win.toFixed(0)}% win`, rupee(b.net, 0), signCls(b.net))).join('')}` : ''}`;
}

function tradeHtml(t) {
  const p = pnlOf(t);
  const r = rOf(t);
  return `<button class="trade" data-id="${esc(t.id)}" type="button" style="width:100%;border:0;background:none;text-align:left">
    <div><b>${esc(baseSym(t.sym))}</b> <span class="small ${t.side === 'short' ? 'down' : 'up'}">${t.side === 'short' ? 'SHORT' : 'LONG'}</span></div>
    <div class="r num"><b class="${p == null ? 'muted' : signCls(p)}">${p == null ? 'open' : rupee(p, 0)}</b></div>
    <small>${esc(t.date)} · ${t.qty.toLocaleString('en-IN')} @ ${fmt(t.entry)}${Number.isFinite(t.exit) ? ` → ${fmt(t.exit)}` : ''}${t.tag ? ` · ${esc(t.tag)}` : ''}</small>
    <small class="r num">${r != null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : ''}</small></button>`;
}

function draw(el) {
  const trades = loadJournal().sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  $('#j-sum', el).innerHTML = summaryHtml(stats(trades));
  $('#j-list', el).innerHTML = trades.length ? trades.map(tradeHtml).join('') : `<div class="empty">${icon('book', 30)}<p>Your trades will appear here.</p></div>`;
}

function openTrade(el, existing) {
  const t = existing || { date: today(), side: 'long', fees: 0 };
  const watch = (config()?.watchlist || []).map((w) => baseSym(w.symbol));
  sheet({
    title: existing ? 'Edit trade' : 'Log a trade',
    body: `<form id="tr-form" onsubmit="return false">
      <div class="grid2"><label class="field"><span>Date</span><input class="input" name="date" type="date" value="${esc(t.date)}"></label>
        <label class="field"><span>Symbol</span><input class="input" name="sym" list="tr-syms" value="${esc(t.sym ? baseSym(t.sym) : '')}" placeholder="RELIANCE" autocapitalize="characters"></label></div>
      <datalist id="tr-syms">${watch.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <div class="seg full" style="margin:12px 0"><button type="button" data-side="long" class="${t.side !== 'short' ? 'on' : ''}">Long</button><button type="button" data-side="short" class="${t.side === 'short' ? 'on' : ''}">Short</button></div>
      <div class="grid3"><label class="field"><span>Qty</span><input class="input num" name="qty" type="number" inputmode="decimal" value="${esc(t.qty ?? '')}"></label>
        <label class="field"><span>Entry</span><input class="input num" name="entry" type="number" inputmode="decimal" step="any" value="${esc(t.entry ?? '')}"></label>
        <label class="field"><span>Exit</span><input class="input num" name="exit" type="number" inputmode="decimal" step="any" value="${esc(t.exit ?? '')}" placeholder="open"></label></div>
      <div class="grid3" style="margin-top:12px"><label class="field"><span>Stop</span><input class="input num" name="stop" type="number" inputmode="decimal" step="any" value="${esc(t.stop ?? '')}"></label>
        <label class="field"><span>Charges ₹</span><input class="input num" name="fees" type="number" inputmode="decimal" step="any" value="${esc(t.fees ?? 0)}"></label>
        <label class="field"><span>Setup</span><input class="input" name="tag" value="${esc(t.tag || '')}" placeholder="breakout" maxlength="30"></label></div>
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea class="input" name="notes" maxlength="1000" placeholder="Why you took it, what you learned">${esc(t.notes || '')}</textarea></label>
      <div class="btn-row" style="margin-top:14px">${existing ? '<button class="btn danger" type="button" data-del>Delete</button>' : ''}<button class="btn primary grow" type="button" data-save>${existing ? 'Save' : 'Add trade'}</button></div>
    </form>`,
    onMount(root, close) {
      const f = $('#tr-form', root);
      let side = t.side || 'long';
      f.addEventListener('click', async (e) => {
        const s = e.target.closest('[data-side]');
        if (s) { side = s.dataset.side; f.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b === s)); }
        if (e.target.closest('[data-del]')) {
          if (!(await confirmSheet('Delete trade?', 'This cannot be undone.', { ok: 'Delete', danger: true }))) return;
          saveJournal(loadJournal().filter((x) => x.id !== existing.id));
          close();
          draw(el);
        }
        if (e.target.closest('[data-save]')) {
          const v = (n) => f.elements[n].value.trim();
          const trade = {
            id: existing?.id || `t${Date.now().toString(36)}`,
            created: existing?.created || Date.now(),
            date: v('date') || today(),
            sym: v('sym').toUpperCase().replace(/\s+/g, ''),
            side,
            qty: num(v('qty')),
            entry: num(v('entry')),
            exit: v('exit') === '' ? null : num(v('exit')),
            stop: v('stop') === '' ? null : num(v('stop')),
            fees: num(v('fees')) || 0,
            tag: v('tag'),
            notes: f.elements.notes.value.trim(),
          };
          if (!trade.sym || !(trade.qty > 0) || !(trade.entry > 0)) { toast('Symbol, quantity and entry are required', { error: true }); return; }
          const all = loadJournal().filter((x) => x.id !== trade.id);
          all.push(trade);
          saveJournal(all);
          close();
          draw(el);
          toast(existing ? 'Trade updated' : 'Trade logged');
        }
      });
    },
  });
}

const CSV_COLS = ['date', 'sym', 'side', 'qty', 'entry', 'exit', 'stop', 'fees', 'tag', 'notes'];
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv() {
  const trades = loadJournal();
  if (!trades.length) { toast('Nothing to export yet'); return; }
  const csv = [CSV_COLS.join(','), ...trades.map((t) => CSV_COLS.map((c) => csvCell(t[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `tradepulse-journal-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

async function importCsv(file, el) {
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  if (!CSV_COLS.every((c) => head.includes(c))) { toast('CSV needs columns: date,sym,side,qty,entry,exit,stop,fees,tag,notes', { error: true, ms: 6000 }); return; }
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const added = rows.map((r, k) => ({
    id: `t${Date.now().toString(36)}${k}`,
    created: Date.now() + k,
    date: r[idx.date] || today(),
    sym: (r[idx.sym] || '').toUpperCase(),
    side: r[idx.side] === 'short' ? 'short' : 'long',
    qty: num(r[idx.qty]),
    entry: num(r[idx.entry]),
    exit: r[idx.exit] === '' ? null : num(r[idx.exit]),
    stop: r[idx.stop] === '' ? null : num(r[idx.stop]),
    fees: num(r[idx.fees]) || 0,
    tag: r[idx.tag] || '',
    notes: r[idx.notes] || '',
  })).filter((t) => t.sym && t.qty > 0 && t.entry > 0);
  saveJournal([...loadJournal(), ...added]);
  draw(el);
  toast(`Imported ${added.length} trade${added.length === 1 ? '' : 's'}`);
}

export function render(el) {
  el.innerHTML = `
    <div class="card" id="j-sum"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary grow" id="j-add" type="button">${icon('plus', 18)} Log trade</button>
      <button class="btn" id="j-exp" type="button">${icon('download', 18)} CSV</button>
      <label class="btn" style="position:relative">${icon('upload', 18)} Import<input id="j-imp" type="file" accept=".csv,text/csv" style="position:absolute;inset:0;opacity:0"></label>
    </div>
    <div class="sec"><h2>Trades</h2></div>
    <div class="card tight" id="j-list"></div>
    <p class="note">Your journal is stored only on this phone. Export a CSV now and then as a backup.</p>`;
  $('#j-add', el).addEventListener('click', () => openTrade(el));
  $('#j-exp', el).addEventListener('click', exportCsv);
  $('#j-imp', el).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importCsv(f, el); e.target.value = ''; });
  $('#j-list', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const t = loadJournal().find((x) => x.id === b.dataset.id);
    if (t) openTrade(el, t);
  });
  draw(el);
}
