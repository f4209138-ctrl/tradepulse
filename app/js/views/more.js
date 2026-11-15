import { store, ghConnected } from '../store.js';
import { $, esc, icon, ago, when, toast } from '../ui.js';
import { runScan } from '../api.js';
import { needGitHub } from './watchlist.js';

export const title = 'More';

const item = (href, ic, t, d) =>
  `<a class="li" href="${href}">${icon(ic)}<div class="grow"><b>${t}</b><small>${d}</small></div><span class="chev">${icon('chev', 18)}</span></a>`;

export function render(el) {
  el.innerHTML = `
    <div class="card tight">
      ${item('#/tools', 'tool', 'Trading tools', 'Position size, risk:reward, pivots & CPR, average price, P&amp;L')}
      ${item('#/journal', 'book', 'Trade journal', 'Log trades — win rate, expectancy, R-multiples, equity curve')}
      ${item('#/sources', 'rss', 'News sources', 'Health of every feed · turn sources on or off · add your own')}
      ${item('#/settings', 'sliders', 'Settings', 'GitHub connection, theme, Markets strip, data')}
      ${item('#/help', 'help', 'Help & setup', 'Install, notifications, why scans run every ~5 min')}
    </div>
    <div class="sec"><h2>Scanner</h2></div>
    <div class="card" id="m-scan"></div>
    <p class="note" style="text-align:center">TradePulse · build ${esc(store.app?.build || 'dev')}</p>`;
  $('#m-scan', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-run]');
    if (!b) return;
    b.disabled = true;
    try {
      await runScan();
      toast('Scan started — fresh data in about a minute');
    } catch (err) {
      needGitHub(err);
    } finally {
      b.disabled = false;
    }
  });
  update(el);
}

export function update(el) {
  const s = store.status;
  const box = $('#m-scan', el);
  if (!s) {
    box.innerHTML = `<p class="muted" style="margin:0">${store.error ? esc(store.error) : 'Waiting for the first scan…'}</p>`;
    return;
  }
  const ok = s.sources.filter((x) => x.ok).length;
  box.innerHTML = `
    <div class="kv"><span>Last scan</span><b>${esc(when(s.updatedAt))} · ${esc(ago(s.updatedAt))} ago</b></div>
    <div class="kv"><span>Next scheduled</span><b>${s.nextRunAt ? esc(when(s.nextRunAt)) : '—'}</b></div>
    <div class="kv"><span>Sources working</span><b class="${ok === s.sources.length ? 'ok' : 'warn'}">${ok} of ${s.sources.length}</b></div>
    <div class="kv"><span>Stories tracked</span><b>${s.counts?.items ?? 0}</b></div>
    <div class="kv"><span>Scan took</span><b>${((s.durationMs || 0) / 1000).toFixed(1)} s</b></div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn sm primary" data-run type="button" ${ghConnected() ? '' : 'title="Connect GitHub first"'}>${icon('play', 15)} Scan now</button>
      ${s.runUrl ? `<a class="btn sm" href="${esc(s.runUrl)}" target="_blank" rel="noopener">Run log ${icon('external', 14)}</a>` : ''}
    </div>`;
}
