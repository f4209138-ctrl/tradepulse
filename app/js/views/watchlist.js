import { store, config, quote, saveLocal } from '../store.js';
import { $, esc, fmt, fmtPct, dir, sparkline, icon, toast, toastError, sheet, debounce } from '../ui.js';
import { baseSym, INSTRUMENTS, instrumentName } from '../market.js';
import { saveConfig, loadSymbols } from '../api.js';

export const title = 'Watchlist';

let editing = false;
let staged = null;

export function needGitHub(err) {
  if (err?.needsGitHub) toast('Connect GitHub to save changes', { action: 'Connect', onAction: () => { location.hash = '#/settings'; } });
  else toastError(err);
}

function sortedList(list) {
  const mode = store.local.wlSort || 'custom';
  const arr = [...list];
  if (mode === 'chg') arr.sort((a, b) => (quote(b.symbol)?.chgPct ?? -1e9) - (quote(a.symbol)?.chgPct ?? -1e9));
  if (mode === 'az') arr.sort((a, b) => baseSym(a.symbol).localeCompare(baseSym(b.symbol)));
  return arr;
}

function row(w) {
  const q = quote(w.symbol);
  const name = q?.name || w.name || instrumentName(w.symbol) || '';
  const pos = q && q.high > q.low ? Math.min(100, Math.max(0, ((q.price - q.low) / (q.high - q.low)) * 100)) : null;
  return `<a class="q" href="#/s/${encodeURIComponent(w.symbol)}">
    <div class="grow"><div class="s">${esc(baseSym(w.symbol))}</div><div class="nm">${esc(name)}</div>
      ${pos != null ? `<div class="range" title="Today's range"><i style="left:calc(${pos.toFixed(1)}% - 1px)"></i></div>` : ''}</div>
    ${q ? sparkline(q.spark?.c, { w: 64, h: 26, prev: q.prev, cls: dir(q.chgPct) }) : '<span></span>'}
    <div class="px num">${q ? `<b>${fmt(q.price, q.dp ?? 2)}</b><span class="pill ${dir(q.chgPct)}">${fmtPct(q.chgPct)}</span>` : '<span class="faint small">waiting…</span>'}</div></a>`;
}

function editRow(w, i, n) {
  return `<div class="q" data-i="${i}">
    <div class="grow"><div class="s">${esc(baseSym(w.symbol))}</div><div class="nm">${esc(w.name || instrumentName(w.symbol) || '')}</div></div>
    <span></span>
    <div class="edit-btns">
      <button class="icon-btn" data-mv="-1" type="button" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 20)}</button>
      <button class="icon-btn" data-mv="1" type="button" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('down', 20)}</button>
      <button class="icon-btn" data-rm type="button" aria-label="Remove" style="color:var(--down)">${icon('trash', 20)}</button>
    </div></div>`;
}

export function render(el) {
  el.innerHTML = `
    <div class="row between" style="margin:2px 0 12px">
      <div class="seg" id="w-sort">
        <button data-s="custom" type="button">My order</button><button data-s="chg" type="button">% Change</button><button data-s="az" type="button">A–Z</button>
      </div>
      <button class="btn sm" id="w-edit" type="button">${icon('edit', 16)} Edit</button>
    </div>
    <div class="card tight" id="w-list"></div>
    <button class="btn block" id="w-add" type="button" style="margin-top:12px">${icon('plus', 18)} Add stock or index</button>
    <p class="note">Stocks here are scanned for news every few minutes. Tap one for its chart, pivots, alerts and news.</p>`;

  $('#w-sort', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    store.local.wlSort = b.dataset.s;
    saveLocal();
    update(el);
  });
  $('#w-edit', el).addEventListener('click', async () => {
    if (!editing) {
      editing = true;
      staged = structuredClone(config()?.watchlist || []);
      update(el);
      return;
    }
    const before = JSON.stringify((config()?.watchlist || []).map((w) => w.symbol));
    const after = JSON.stringify(staged.map((w) => w.symbol));
    const next = staged;
    editing = false;
    staged = null;
    update(el);
    if (before === after) return;
    try {
      await saveConfig((cfg) => {
        const bySym = new Map((cfg.watchlist || []).map((w) => [w.symbol, w]));
        cfg.watchlist = next.map((w) => bySym.get(w.symbol) || w);
      }, 'Update watchlist from app');
      toast('Watchlist saved · scanning now');
    } catch (err) {
      needGitHub(err);
    }
  });
  $('#w-list', el).addEventListener('click', (e) => {
    if (!editing) return;
    const r = e.target.closest('[data-i]');
    if (!r) return;
    e.preventDefault();
    const i = +r.dataset.i;
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const j = i + +mv.dataset.mv;
      if (j < 0 || j >= staged.length) return;
      [staged[i], staged[j]] = [staged[j], staged[i]];
    } else if (e.target.closest('[data-rm]')) {
      staged.splice(i, 1);
    }
    update(el);
  });
  $('#w-add', el).addEventListener('click', () => openAddSheet());
  update(el);
}

export function update(el) {
  const list = editing ? staged : config()?.watchlist || [];
  el.querySelectorAll('#w-sort [data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === (store.local.wlSort || 'custom')));
  $('#w-edit', el).innerHTML = editing ? `${icon('check', 16)} Done` : `${icon('edit', 16)} Edit`;
  $('#w-edit', el).classList.toggle('primary', editing);
  $('#w-sort', el).hidden = editing;
  const box = $('#w-list', el);
  if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('list', 30)}<p>${config() ? 'Your watchlist is empty.' : 'Loading…'}</p></div>`;
    return;
  }
  box.innerHTML = editing ? list.map((w, i) => editRow(w, i, list.length)).join('') : sortedList(list).map(row).join('');
}

export function destroy() {
  editing = false;
  staged = null;
}

// ---------------------------------------------------------------- add sheet

function score(sym, name, q) {
  const s = sym.toLowerCase();
  const n = name.toLowerCase();
  if (s === q) return 100;
  if (s.startsWith(q)) return 80 - s.length;
  if (n.startsWith(q)) return 60;
  if (n.includes(` ${q}`)) return 40;
  if (s.includes(q) || n.includes(q)) return 20;
  return 0;
}

export async function openAddSheet({ onPick, title = 'Add to watchlist', exclude } = {}) {
  const inList = new Set(exclude || (config()?.watchlist || []).map((w) => w.symbol));
  sheet({
    title,
    body: `<div class="searchbar">${icon('search', 18)}<input class="input" id="s-q" type="search" placeholder="Company, NSE symbol or index" autocomplete="off" enterkeyhint="search"></div>
      <div class="card tight results-list" id="s-res"><div class="empty small">Loading symbol list…</div></div>`,
    async onMount(root, close) {
      const input = $('#s-q', root);
      const res = $('#s-res', root);
      let all = [];
      try {
        const eq = await loadSymbols();
        all = [...INSTRUMENTS.map(([s, n]) => ({ sym: s, name: n, kind: 'Index / FX / Commodity' })), ...eq.map(([s, n]) => ({ sym: `${s}.NS`, name: n, kind: 'NSE' }))];
      } catch {
        all = INSTRUMENTS.map(([s, n]) => ({ sym: s, name: n, kind: 'Index / FX / Commodity' }));
        res.innerHTML = '<div class="empty small">Symbol list unavailable offline — type an exact Yahoo symbol, e.g. TATASTEEL.NS</div>';
      }
      const show = () => {
        const q = input.value.trim().toLowerCase();
        let hits;
        if (!q) hits = all.slice(0, 12);
        else {
          hits = all.map((x) => ({ x, s: score(baseSym(x.sym), x.name, q) })).filter((h) => h.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((h) => h.x);
          const raw = input.value.trim().toUpperCase();
          if (!hits.length && /^[A-Z0-9^][A-Z0-9.&=_^-]{0,29}$/.test(raw)) hits = [{ sym: raw, name: 'Use this exact symbol', kind: 'Custom' }];
        }
        res.innerHTML = hits.length ? hits.map((h) => `<button class="li" type="button" data-sym="${esc(h.sym)}" data-name="${esc(h.name)}" style="width:100%;border:0;background:none;text-align:left" ${inList.has(h.sym) ? 'disabled' : ''}>
            <div class="grow"><b>${esc(baseSym(h.sym))}</b> <span class="faint small">${esc(h.kind)}</span><small>${esc(h.name)}</small></div>
            ${inList.has(h.sym) ? icon('check', 18) : icon('plus', 18)}</button>`).join('') : '<div class="empty small">No match</div>';
      };
      input.addEventListener('input', debounce(show, 120));
      res.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-sym]');
        if (!b || b.disabled) return;
        const sym = b.dataset.sym;
        const name = b.dataset.name === 'Use this exact symbol' ? null : b.dataset.name;
        close();
        if (onPick) return onPick(sym, name);
        try {
          await saveConfig((cfg) => {
            cfg.watchlist ||= [];
            if (!cfg.watchlist.some((w) => w.symbol === sym)) cfg.watchlist.push({ symbol: sym, name, aliases: [] });
          }, `Add ${baseSym(sym)} to watchlist`);
          toast(`${baseSym(sym)} added · scanning now`);
        } catch (err) {
          needGitHub(err);
        }
      });
      show();
      setTimeout(() => input.focus(), 250);
    },
  });
}
