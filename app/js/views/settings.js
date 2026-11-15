import { store, config, saveLocal, ghConnected, quote } from '../store.js';
import { $, esc, icon, toast, toastError, confirmSheet } from '../ui.js';
import { github } from '../github.js';
import { saveConfig } from '../api.js';
import { baseSym, instrumentName } from '../market.js';
import { needGitHub, openAddSheet } from './watchlist.js';

export const title = 'Settings';

function tokenUrl() {
  const a = store.app || {};
  const p = new URLSearchParams({
    name: 'TradePulse app',
    description: `Lets the TradePulse app on your phone save your watchlist, alerts and push registration to ${a.owner}/${a.repo}.`,
    target_name: a.owner || '',
    expires_in: '366',
    contents: 'write',
    actions: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

function ghCard() {
  const a = store.app || {};
  const repoLink = a.owner ? `<a href="https://github.com/${esc(a.owner)}/${esc(a.repo)}" target="_blank" rel="noopener">${esc(a.owner)}/${esc(a.repo)}</a>` : '<span class="muted">unknown (local build)</span>';
  if (ghConnected()) {
    return `<div class="row"><span class="ok">${icon('check')}</span><div class="grow"><b>Connected to GitHub</b><div class="small muted">Repo ${repoLink}</div></div></div>
      <p class="note">Watchlist, keywords, alert rules and price alerts are saved to <code>config.json</code> in your repo; each save starts a fresh scan.</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn sm" data-gh="test" type="button">Test connection</button><button class="btn sm danger" data-gh="disconnect" type="button">Disconnect</button></div>`;
  }
  return `<div class="row" style="align-items:flex-start">${icon('key')}<div class="grow"><b>Connect GitHub</b><div class="small muted">Repo ${repoLink}</div></div></div>
    <ol class="small" style="margin:10px 0 12px;padding-left:20px;color:var(--text-2)">
      <li>Tap <b>Create token</b> (opens GitHub, already filled in).</li>
      <li>Under <b>Repository access</b> pick <b>Only select repositories</b> → <b>${esc(a.repo || 'tradepulse')}</b>.</li>
      <li>Keep the permissions shown (Contents and Actions: read &amp; write), tap <b>Generate token</b>, copy it.</li>
      <li>Paste it below and tap <b>Connect</b>.</li>
    </ol>
    <a class="btn block" href="${esc(tokenUrl())}" target="_blank" rel="noopener">${icon('external', 16)} Create token on GitHub</a>
    <div class="row" style="margin-top:10px"><input class="input grow" id="gh-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"><button class="btn primary" data-gh="connect" type="button">Connect</button></div>
    <p class="note">The token is stored only on this phone and is sent only to api.github.com.</p>`;
}

function marketsHtml() {
  const list = config()?.markets || [];
  return `<div class="chips">${list.map((s) => `<button class="chip" data-mrm="${esc(s)}" type="button">${esc(quote(s)?.name || instrumentName(s) || baseSym(s))}<span class="x">✕</span></button>`).join('') || '<span class="muted small">Empty</span>'}</div>
    <button class="btn sm" id="mk-add" type="button" style="margin-top:10px">${icon('plus', 16)} Add index / commodity / stock</button>`;
}

export function render(el) {
  el.innerHTML = `
    <div class="sec"><h2>GitHub</h2></div>
    <div class="card" id="s-gh"></div>
    <div class="sec"><h2>Appearance</h2></div>
    <div class="card tight">
      <div class="opt"><div class="grow"><b>Theme</b></div><div class="seg" id="s-theme">
        <button data-th="dark" type="button">Dark</button><button data-th="light" type="button">Light</button><button data-th="system" type="button">Auto</button></div></div>
      <div class="opt"><div class="grow"><b>Refresh while open</b><small>Checks for a new scan this often (tiny download)</small></div><div class="seg" id="s-refresh">
        <button data-rf="15" type="button">15s</button><button data-rf="30" type="button">30s</button><button data-rf="60" type="button">60s</button></div></div>
    </div>
    <div class="sec"><h2>Markets strip</h2></div>
    <div class="card" id="s-markets"></div>
    <div class="sec"><h2>Data on this phone</h2></div>
    <div class="card tight">
      <button class="li" id="s-clear" type="button" style="width:100%;border:0;background:none;text-align:left">${icon('refresh')}<div class="grow"><b>Clear cached data</b><small>Reloads the app and market data</small></div></button>
      <button class="li" id="s-reset" type="button" style="width:100%;border:0;background:none;text-align:left">${icon('trash')}<div class="grow"><b class="bad">Reset app on this phone</b><small>Forgets token, settings & saved stories (journal is kept)</small></div></button>
    </div>
    <div class="sec"><h2>Privacy</h2></div>
    <p class="note" style="margin-top:0">Your repo is public (required for free GitHub Actions + Pages), so your watchlist and keywords are visible there. Push addresses are stored encrypted; only the scanner can read them. Your journal never leaves this phone.</p>`;

  const paint = () => {
    $('#s-gh', el).innerHTML = ghCard();
    el.querySelectorAll('[data-th]').forEach((b) => b.classList.toggle('on', b.dataset.th === (store.local.theme || 'dark')));
    el.querySelectorAll('[data-rf]').forEach((b) => b.classList.toggle('on', +b.dataset.rf === (store.local.refreshSec || 30)));
    $('#s-markets', el).innerHTML = marketsHtml();
  };

  $('#s-gh', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gh]');
    if (!b) return;
    const act = b.dataset.gh;
    if (act === 'disconnect') {
      if (!(await confirmSheet('Disconnect GitHub?', 'You can still read news and quotes, but edits and push registration need GitHub.', { ok: 'Disconnect', danger: true }))) return;
      store.local.gh = { token: '' };
      saveLocal();
      paint();
      return;
    }
    const token = act === 'connect' ? $('#gh-token', el).value.trim() : store.local.gh.token;
    if (!token) { toast('Paste your token first', { error: true }); return; }
    if (!store.app?.owner) { toast('This build does not know its repo (local test build).', { error: true }); return; }
    b.disabled = true;
    try {
      const info = await github({ owner: store.app.owner, repo: store.app.repo, token }).repoInfo();
      if (info.permissions && info.permissions.push === false) throw new Error('This GitHub account cannot write to the repo.');
      store.local.gh = { token };
      saveLocal();
      paint();
      toast(act === 'connect' ? 'GitHub connected' : 'Connection works');
      import('./alerts.js').then((m) => m.resync?.());
    } catch (err) {
      toastError(err);
    } finally {
      b.disabled = false;
    }
  });
  $('#s-theme', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-th]');
    if (!b) return;
    store.local.theme = b.dataset.th;
    saveLocal();
    document.documentElement.setAttribute('data-theme', store.local.theme);
    const light = store.local.theme === 'light' || (store.local.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f3f5f8' : '#0a0e14');
    paint();
  });
  $('#s-refresh', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-rf]');
    if (!b) return;
    store.local.refreshSec = +b.dataset.rf;
    saveLocal();
    paint();
  });
  $('#s-markets', el).addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-mrm]');
    if (rm) {
      const sym = rm.dataset.mrm;
      try {
        await saveConfig((cfg) => { cfg.markets = (cfg.markets || []).filter((s) => s !== sym); }, 'Update markets strip');
      } catch (err) { needGitHub(err); }
      return;
    }
    if (e.target.closest('#mk-add')) {
      openAddSheet({
        title: 'Add to Markets strip',
        exclude: config()?.markets || [],
        async onPick(sym) {
          try {
            await saveConfig((cfg) => { cfg.markets ||= []; if (!cfg.markets.includes(sym)) cfg.markets.push(sym); }, 'Update markets strip');
            toast('Added · scanning now');
          } catch (err) { needGitHub(err); }
        },
      });
    }
  });
  $('#s-clear', el).addEventListener('click', async () => {
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      for (const r of regs || []) await r.update();
    } catch { /* ignore */ }
    location.reload();
  });
  $('#s-reset', el).addEventListener('click', async () => {
    if (!(await confirmSheet('Reset TradePulse on this phone?', 'Removes your GitHub token, local settings and saved stories. Your trade journal is kept.', { ok: 'Reset', danger: true }))) return;
    try {
      localStorage.removeItem('tp:v1');
      localStorage.removeItem('tp:saved');
    } catch { /* ignore */ }
    location.replace('./#/home');
    location.reload();
  });
  paint();
}

export function update(el) {
  const box = $('#s-markets', el);
  if (box && !box.contains(document.activeElement)) box.innerHTML = marketsHtml();
}
