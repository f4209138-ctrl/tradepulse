import { store, saveLocal, loadSaved, saveSaved } from '../store.js';
import { $, esc, icon, ago, debounce, toast, copyText } from '../ui.js';
import { baseSym } from '../market.js';

export const title = 'News';

const PAGE = 60;
const FILTERS = [
  ['all', 'All'], ['watch', 'Watchlist'], ['filing', 'Filings'], ['hot', 'High impact'],
  ['bull', 'Bullish'], ['bear', 'Bearish'], ['saved', 'Saved'],
];
const st = { q: '', src: '', shown: PAGE, top: 0, saved: {}, read: new Set(), el: null };

export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const tsOf = (i) => i.pub || i.seen || 0;
const srcName = (i) => i.via || store.news?.sources?.[i.src] || i.src;

function filtered() {
  const f = store.local.newsFilter || 'all';
  let items = f === 'saved' ? Object.values(st.saved).sort((a, b) => tsOf(b) - tsOf(a)) : store.news?.items || [];
  if (f === 'watch') items = items.filter((i) => i.syms);
  else if (f === 'filing') items = items.filter((i) => i.kind === 'filing');
  else if (f === 'hot') items = items.filter((i) => (i.imp || 0) >= 3);
  else if (f === 'bull') items = items.filter((i) => i.sent > 0);
  else if (f === 'bear') items = items.filter((i) => i.sent < 0);
  if (st.src) items = items.filter((i) => i.src === st.src || i.also?.includes(st.src));
  const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) {
    items = items.filter((i) => {
      const hay = `${i.title} ${i.sum || ''} ${(i.syms || []).join(' ')} ${i.via || ''} ${(i.kws || []).join(' ')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  return items;
}

function itemHtml(i) {
  const ts = tsOf(i);
  const seenAt = store.local.newsSeenAt || Date.now() - 12 * 3600e3;
  const unread = ts > seenAt && !st.read.has(i.id);
  const tags = [
    ...(i.syms || []).map((s) => `<a class="chip sym" href="#/s/${encodeURIComponent(s)}">${esc(baseSym(s))}</a>`),
    ...(i.kws || []).map((k) => `<span class="chip kw">${esc(k)}</span>`),
    i.sent > 0 ? '<span class="pill up">▲ Bullish</span>' : i.sent < 0 ? '<span class="pill down">▼ Bearish</span>' : '',
  ].join('');
  return `<article class="ni${unread ? ' unread' : ''}" data-id="${esc(i.id)}">
    <div class="ni-meta"><span class="src">${esc(srcName(i))}</span><span>· ${esc(ago(ts))}</span>
      ${(i.imp || 0) >= 3 ? '<span class="tag hot">High impact</span>' : ''}${i.kind === 'filing' ? '<span class="tag filing">Filing</span>' : ''}
      ${st.saved[i.id] ? `<span class="muted">${icon('bookmarked', 13)}</span>` : ''}</div>
    <h3 class="ni-title">${esc(i.title)}</h3>
    <div class="ni-tags">${tags}</div>
  </article>`;
}

function bodyHtml(i) {
  const also = (i.also || []).map((id) => store.news?.sources?.[id] || id);
  const url = safeUrl(i.url);
  const saved = !!st.saved[i.id];
  const ts = tsOf(i);
  return `<div class="ni-body">
    ${i.sum ? `<p>${esc(i.sum)}</p>` : ''}
    ${also.length ? `<div class="ni-also">Also reported by: ${esc(also.join(', '))}</div>` : ''}
    ${i.ment?.length ? `<div class="ni-also">Also mentions: ${esc(i.ment.map(baseSym).join(', '))}</div>` : ''}
    <div class="ni-also">${esc(new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</div>
    <div class="btn-row">
      ${url ? `<a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('external', 16)} Read</a>` : ''}
      <button class="btn sm" data-act="save" type="button">${icon(saved ? 'bookmarked' : 'bookmark', 16)} ${saved ? 'Saved' : 'Save'}</button>
      <button class="btn sm" data-act="share" type="button">${icon('share', 16)} Share</button>
    </div></div>`;
}

function draw() {
  const el = st.el;
  if (!el) return;
  const items = filtered();
  st.top = Math.max(0, ...(store.news?.items || []).slice(0, 5).map(tsOf));
  const list = $('#n-list', el);
  if (!store.news) {
    list.innerHTML = '<div class="empty">Loading news…</div>';
  } else if (!items.length) {
    const f = store.local.newsFilter;
    list.innerHTML = `<div class="empty">${icon('news', 30)}<p>${f === 'saved' ? 'No saved stories yet. Tap a story, then Save.' : st.q ? 'Nothing matches your search.' : 'No stories in this view right now.'}</p></div>`;
  } else {
    list.innerHTML = items.slice(0, st.shown).map(itemHtml).join('');
  }
  $('#n-more', el).hidden = items.length <= st.shown;
  $('#n-new', el).hidden = true;
}

function toggle(article, forceOpen = false) {
  const id = article.dataset.id;
  const item = (store.news?.items || []).find((x) => x.id === id) || st.saved[id];
  if (!item) return;
  const open = article.classList.contains('open');
  if (open && !forceOpen) {
    article.classList.remove('open');
    article.querySelector('.ni-body')?.remove();
    return;
  }
  if (!open) {
    article.classList.add('open');
    article.insertAdjacentHTML('beforeend', bodyHtml(item));
  }
  article.classList.remove('unread');
  st.read.add(id);
}

async function act(kind, article) {
  const id = article.dataset.id;
  const item = (store.news?.items || []).find((x) => x.id === id) || st.saved[id];
  if (!item) return;
  if (kind === 'save') {
    if (st.saved[id]) delete st.saved[id];
    else st.saved[id] = item;
    saveSaved(st.saved);
    article.querySelector('.ni-body')?.remove();
    article.insertAdjacentHTML('beforeend', bodyHtml(item));
    toast(st.saved[id] ? 'Saved for later' : 'Removed from saved');
  } else if (kind === 'share') {
    const url = safeUrl(item.url) || location.href;
    try {
      if (navigator.share) await navigator.share({ title: item.title, text: item.title, url });
      else { await copyText(`${item.title}\n${url}`); toast('Link copied'); }
    } catch { /* share sheet dismissed */ }
  }
}

export function render(el, [focusId] = []) {
  st.el = el;
  st.saved = loadSaved();
  st.shown = PAGE;
  const f = store.local.newsFilter || 'all';
  const sources = Object.entries(store.news?.sources || {}).sort((a, b) => a[1].localeCompare(b[1]));
  el.innerHTML = `
    <div class="searchbar">${icon('search', 18)}<input class="input" id="n-q" type="search" placeholder="Search headlines or stocks" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>
    <div class="filters" id="n-filters">
      ${FILTERS.map(([id, l]) => `<button class="fchip${id === f ? ' on' : ''}" data-f="${id}" type="button">${l}</button>`).join('')}
      <select class="fchip" id="n-src" aria-label="Filter by source"><option value="">All sources</option>${sources.map(([id, n]) => `<option value="${esc(id)}"${id === st.src ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
    </div>
    <button class="new-pill" id="n-new" hidden type="button">${icon('up', 16)}<span></span></button>
    <div class="card tight" id="n-list"></div>
    <button class="btn ghost more-btn" id="n-more" hidden type="button">Show more</button>`;

  $('#n-q', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.shown = PAGE; draw(); }, 200));
  $('#n-filters', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    store.local.newsFilter = b.dataset.f;
    saveLocal();
    el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    st.shown = PAGE;
    draw();
  });
  $('#n-src', el).addEventListener('change', (e) => { st.src = e.target.value; st.shown = PAGE; draw(); });
  $('#n-more', el).addEventListener('click', () => { st.shown += PAGE; draw(); });
  $('#n-new', el).addEventListener('click', () => { draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#n-list', el).addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // chips & Read links navigate normally
    const article = e.target.closest('.ni');
    if (!article) return;
    const a = e.target.closest('[data-act]');
    if (a) act(a.dataset.act, article);
    else toggle(article);
  });

  draw();
  if (focusId) focus(focusId);
}

function focus(id) {
  const inData = (store.news?.items || []).some((i) => i.id === id);
  if (!inData) {
    if (store.news) toast('That story is no longer in the feed');
    return;
  }
  let article = st.el.querySelector(`.ni[data-id="${CSS.escape(id)}"]`);
  if (!article) {
    store.local.newsFilter = 'all';
    st.q = '';
    st.src = '';
    st.shown = 400;
    render(st.el, []);
    article = st.el.querySelector(`.ni[data-id="${CSS.escape(id)}"]`);
  }
  if (article) {
    toggle(article, true);
    article.scrollIntoView({ block: 'center' });
  }
}

export function update(el, [focusId] = []) {
  if (!st.el) return;
  const items = store.news?.items || [];
  if (!st.top || !$('#n-list', el).querySelector('.ni')) {
    draw();
    if (focusId) focus(focusId);
    return;
  }
  const fresh = items.filter((i) => tsOf(i) > st.top).length;
  if (fresh > 0) {
    const pill = $('#n-new', el);
    pill.hidden = false;
    pill.querySelector('span').textContent = `${fresh} new ${fresh === 1 ? 'story' : 'stories'}`;
  }
}

export function destroy() {
  const items = store.news?.items || [];
  if (items.length) {
    store.local.newsSeenAt = Math.max(store.local.newsSeenAt || 0, ...items.slice(0, 20).map(tsOf));
    saveLocal();
  }
  st.el = null;
}
