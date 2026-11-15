import { store, config } from '../store.js';
import { $, esc, icon, ago, toast, switchHtml } from '../ui.js';
import { saveConfig } from '../api.js';
import { needGitHub } from './watchlist.js';

export const title = 'News sources';

function rows() {
  const s = store.status;
  const cfg = config() || {};
  const disabled = new Set(cfg.sources?.disabled || []);
  const live = new Map((s?.sources || []).map((x) => [x.id, x]));
  const catalog = s?.catalog || [];
  const list = [];
  for (const c of catalog) {
    if (c.id === 'gnews-watch') {
      const parts = [...live.values()].filter((x) => x.id.startsWith('gnews-watch-'));
      const ok = parts.length ? parts.every((x) => x.ok) : null;
      list.push({ ...c, ok, items: parts.reduce((a, x) => a + (x.items || 0), 0), ms: parts.length ? Math.max(...parts.map((x) => x.ms || 0)) : null, error: parts.find((x) => !x.ok)?.error, lastOk: Math.max(0, ...parts.map((x) => x.lastOk || 0)) || null, enabled: !disabled.has('gnews-watch') });
      continue;
    }
    const r = live.get(c.id);
    list.push({ ...c, ok: r ? r.ok : null, items: r?.items, ms: r?.ms, error: r?.error, lastOk: r?.lastOk, unchanged: r?.unchanged, enabled: !disabled.has(c.id) });
  }
  for (const r of live.values()) {
    if (r.id.startsWith('custom-')) list.push({ ...r, custom: true, enabled: true });
  }
  return list;
}

function rowHtml(r) {
  const health = !r.enabled
    ? '<span class="faint">off</span>'
    : r.ok == null
      ? '<span class="faint">not checked yet</span>'
      : r.ok
        ? `<span class="ok">● OK</span> · ${r.items ?? 0} items${r.unchanged ? ' (unchanged)' : ''}${r.ms ? ` · ${r.ms} ms` : ''}`
        : `<span class="bad">● ${esc(r.error || 'error')}</span>${r.lastOk ? ` · last OK ${esc(ago(r.lastOk))} ago` : ''}`;
  return `<div class="opt" data-id="${esc(r.id)}"><div class="grow"><b>${esc(r.name)}${r.section ? ` · ${esc(r.section)}` : ''}</b>
    <small>${health}</small><small class="faint">${esc({ news: 'News', filing: 'Exchange filings', regulator: 'Regulator' }[r.kind] || '')}</small></div>
    ${r.custom ? `<button class="icon-btn" data-delcustom="${esc(r.id)}" type="button" aria-label="Remove" style="color:var(--down)">${icon('trash', 20)}</button>` : switchHtml('src-on', r.enabled, 'Enabled')}</div>`;
}

export function render(el) {
  el.innerHTML = `
    <p class="note" style="margin-top:0">Every scan reads these feeds. NSE filings and Google News queries are filtered to your watchlist. Turning a source off applies from the next scan.</p>
    <div class="card tight" id="src-list"></div>
    <div class="sec"><h2>Add your own RSS feed</h2></div>
    <div class="card">
      <label class="field"><span>Name</span><input class="input" id="cf-name" maxlength="40" placeholder="e.g. My blog"></label>
      <label class="field"><span>Feed URL (https)</span><input class="input" id="cf-url" type="url" placeholder="https://example.com/rss.xml" autocapitalize="off"></label>
      <button class="btn primary block" id="cf-add" type="button" style="margin-top:12px">Add feed</button>
    </div>`;
  $('#src-list', el).addEventListener('change', async (e) => {
    if (e.target.name !== 'src-on') return;
    const id = e.target.closest('[data-id]').dataset.id;
    const on = e.target.checked;
    try {
      await saveConfig((cfg) => {
        cfg.sources ||= { disabled: [], custom: [] };
        const d = new Set(cfg.sources.disabled || []);
        if (on) d.delete(id); else d.add(id);
        cfg.sources.disabled = [...d];
      }, `${on ? 'Enable' : 'Disable'} source ${id}`);
    } catch (err) {
      e.target.checked = !on;
      needGitHub(err);
    }
  });
  $('#src-list', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delcustom]');
    if (!b) return;
    const row = (store.status?.sources || []).find((x) => x.id === b.dataset.delcustom);
    try {
      await saveConfig((cfg) => {
        cfg.sources ||= { disabled: [], custom: [] };
        cfg.sources.custom = (cfg.sources.custom || []).filter((c) => c.name !== row?.name);
      }, 'Remove custom feed');
      toast('Feed removed');
    } catch (err) { needGitHub(err); }
  });
  $('#cf-add', el).addEventListener('click', async () => {
    const name = $('#cf-name', el).value.trim();
    const url = $('#cf-url', el).value.trim();
    if (!/^https:\/\/\S+$/i.test(url)) { toast('Enter an https:// feed URL', { error: true }); return; }
    try {
      await saveConfig((cfg) => {
        cfg.sources ||= { disabled: [], custom: [] };
        cfg.sources.custom ||= [];
        if (!cfg.sources.custom.some((c) => c.url === url)) cfg.sources.custom.push({ name: name || new URL(url).hostname, url });
      }, 'Add custom feed');
      $('#cf-name', el).value = '';
      $('#cf-url', el).value = '';
      toast('Feed added · it is checked on the next scan');
    } catch (err) { needGitHub(err); }
  });
  update(el);
}

export function update(el) {
  const box = $('#src-list', el);
  if (!store.status) { box.innerHTML = '<div class="empty small">Waiting for the first scan…</div>'; return; }
  box.innerHTML = rows().map(rowHtml).join('');
}
