#!/usr/bin/env node
// TradePulse scanner: one pass = fetch news feeds + quotes, detect new stories,
// push alerts, and write the JSON files the web app reads. Runs every ~5 minutes on
// GitHub Actions; state is carried between runs in .state/ (Actions cache).

import { parseArgs } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';

import { readJson, writeJson, dayKey, unique, pool, IST, zoned } from './lib/util.mjs';
import { activeSources, BUILTIN_SOURCES } from './lib/sources.mjs';
import { httpGet } from './lib/http.mjs';
import { parseFeed, normalizeItems } from './lib/parse.mjs';
import { buildMatcher, sentiment, impact, titleTokens, isDuplicate } from './lib/match.mjs';
import { fetchQuotes, fetchHistory, fetchNifty50, fetchEquityList } from './lib/quotes.mjs';
import { normalizeConfig } from './lib/config.mjs';
import { loadDevices, deliverAll } from './lib/notify.mjs';
import {
  isQuiet, newsAlertCandidates, newsPayload, summaryPayload, evaluatePriceAlerts, pricePayload,
  evaluateBigMoves, bigMovePayload, testPayload,
} from './lib/alerts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const { values: args } = parseArgs({
  options: {
    state: { type: 'string', default: join(repoRoot, '.state') },
    out: { type: 'string', default: join(repoRoot, '_site', 'data') },
    config: { type: 'string', default: join(repoRoot, 'config.json') },
    subscriptions: { type: 'string', default: join(repoRoot, 'subscriptions') },
    'dry-run': { type: 'boolean', default: false },
    'test-push': { type: 'boolean', default: false },
    'no-quotes': { type: 'boolean', default: false },
  },
});

const env = process.env;
const log = (...a) => console.log(...a);
const MAX_STATE_ITEMS = 800;
const MAX_PUBLIC_ITEMS = 400;
const RETENTION_MS = 72 * 3600e3;
const SEEN_TTL_MS = 4 * 24 * 3600e3;
const HISTORY_PER_RUN = 8;

const histKey = (sym) => sym.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase()}`);

function pagesUrl() {
  if (env.APP_URL) return env.APP_URL.endsWith('/') ? env.APP_URL : `${env.APP_URL}/`;
  const full = env.GITHUB_REPOSITORY;
  if (!full) return 'https://example.github.io/tradepulse/';
  const [owner, repo] = full.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

// Next scheduled run per the workflow crons (UTC): weekdays every 5 min from :01, weekends every 15 min from :03.
function nextScheduledRun(now) {
  for (let t = Math.ceil((now + 1) / 60000) * 60000; t < now + 2 * 3600e3; t += 60000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const m = d.getUTCMinutes();
    if (dow >= 1 && dow <= 5 ? m % 5 === 1 : m % 15 === 3) return t;
  }
  return null;
}

async function githubApi(method, path, body) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) return null;
  try {
    return await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'tradepulse-scanner',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    log(`! GitHub API ${method} ${path}: ${err.message}`);
    return null;
  }
}

function publicItem(it) {
  const o = {
    id: it.id, src: it.src, kind: it.kind, title: it.title, url: it.url, sum: it.sum || undefined,
    pub: it.pub, seen: Math.abs((it.seen || 0) - (it.pub || 0)) > 120000 ? it.seen : undefined,
    syms: it.syms?.length ? it.syms : undefined, ment: it.ment?.length ? it.ment : undefined,
    kws: it.kws?.length ? it.kws : undefined, sent: it.sent || undefined, imp: it.imp || undefined,
    via: it.via || undefined, also: it.also?.length ? it.also : undefined, subj: it.subject || undefined,
  };
  return JSON.parse(JSON.stringify(o));
}

/**
 * Which watchlist stocks / keywords a story is about.
 *  - exchange filings: exact listed-company match only (avoids "SBI Mutual Fund …" → SBIN)
 *  - news: headline mentions tag the story (syms); summary-only mentions are "also mentioned" (ment)
 *  - global sources (strict): short acronyms need market context ("SBI" the US agency ≠ SBIN)
 */
function classify(it, src, matcher) {
  if (it.kind === 'filing') return { syms: it.company ? matcher.matchCompany(it.company) : [], kws: [], ment: [] };
  const strict = src ? !!src.strict : String(it.src).startsWith('gnews');
  const syms = matcher.matchSymbols(it.title, { strict });
  const ment = matcher.matchSymbols(it.sum || '', { strict: true }).filter((s) => !syms.includes(s));
  return { syms, kws: matcher.matchKeywords(it.title), ment };
}

async function main() {
  const now = Date.now();
  const today = dayKey(now, IST);
  const config = normalizeConfig(readJson(args.config, {}));
  const statePath = join(args.state, 'state.json');
  const state = readJson(statePath, null) || { v: 1, createdAt: now };
  const bootstrap = !state.lastRunAt;
  const testPush = args['test-push'] || env.TEST_PUSH === 'true';
  const appUrl = pagesUrl();
  mkdirSync(args.out, { recursive: true });

  log(`TradePulse scan @ ${new Date(now).toISOString()} (${zoned(now, IST).date} ${String(zoned(now, IST).hh).padStart(2, '0')}:${String(zoned(now, IST).mm).padStart(2, '0')} IST)`);
  log(`• ${config.watchlist.length} watchlist symbols, ${config.keywords.length} keywords, ${config.priceAlerts.length} price alerts`);
  if (bootstrap) log('• First run: no previous state, so nothing is alerted this time (everything is marked as seen).');

  // ---------------------------------------------------------------- daily lists
  const lists = (state.lists ||= {});
  if (lists.nifty50?.day !== today || !lists.nifty50?.items?.length) {
    const r = await fetchNifty50();
    if (r.list) lists.nifty50 = { day: today, items: r.list };
    else log(`! NIFTY 50 list: ${r.error}`);
  }
  const symbolsPath = join(args.state, 'symbols.json');
  if (lists.equitiesDay !== today || !existsSync(symbolsPath)) {
    const r = await fetchEquityList();
    if (r.list) {
      writeJson(symbolsPath, { updatedAt: now, list: r.list });
      lists.equitiesDay = today;
    } else log(`! NSE equity list: ${r.error}`);
  }

  // ---------------------------------------------------------------- news
  const matcher = buildMatcher(config);
  const sources = activeSources(config);
  const feedState = (state.feeds ||= {});
  const seen = (state.seen ||= {});
  let items = (state.items || []).filter((i) => i && i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const tokens = new Map(items.map((i) => [i.id, titleTokens(i.title)]));
  const newItems = [];
  const reports = [];

  // Re-match stored items against the current watchlist/keywords (config may have changed),
  // and drop items whose source was disabled or that only qualified through a removed symbol.
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const disabled = new Set(config.sources.disabled);
  items = items.filter((it) => {
    if (disabled.has(it.src)) return false;
    const src = sourceById.get(it.src);
    Object.assign(it, classify(it, src, matcher));
    it.imp = impact(it, { symbols: it.syms, keywords: it.kws });
    if (it.kind === 'filing') return it.syms.length > 0;
    if (it.syms.length || it.kws.length) return true;
    return !(src?.noiseUnlessMatched && src.noiseUnlessMatched.test(it.title)) && !matcher.isMuted(it.title);
  });
  for (const id of [...byId.keys()]) if (!items.some((i) => i.id === id)) byId.delete(id);

  const fetched = await pool(sources, 8, async (src) => {
    const fs = (feedState[src.id] ||= {});
    const r = await httpGet(src.url, { etag: fs.etag, lastModified: fs.lastModified, timeoutMs: 12000 });
    return { src, r };
  });

  for (const { src, r } of fetched) {
    const fs = feedState[src.id];
    const rep = { id: src.id, name: src.name, section: src.section, kind: src.kind, ok: r.ok, status: r.status, ms: r.ms, items: 0, fresh: 0 };
    reports.push(rep);
    if (!r.ok) {
      rep.error = r.error;
      fs.fails = (fs.fails || 0) + 1;
      fs.lastError = r.error;
      fs.lastErrorAt = now;
      continue;
    }
    let parsed;
    if (r.notModified) {
      rep.unchanged = true;
      rep.items = fs.count || 0;
    } else {
      try {
        parsed = normalizeItems(parseFeed(r.text), src, now).items;
      } catch (err) {
        rep.ok = false;
        rep.error = err.message;
        fs.fails = (fs.fails || 0) + 1;
        fs.lastError = err.message;
        fs.lastErrorAt = now;
        continue;
      }
      fs.etag = r.etag;
      fs.lastModified = r.lastModified;
      fs.count = parsed.length;
      rep.items = parsed.length;
    }
    fs.fails = 0;
    fs.lastOk = now;
    rep.lastOk = now;
    if (!parsed) continue;

    for (const it of parsed) {
      if (byId.has(it.id)) continue;
      const wasSeen = !!seen[it.id];
      if (matcher.isMuted(it.title)) { seen[it.id] ||= now; continue; }
      const { syms, kws, ment } = classify(it, src, matcher);
      const matched = syms.length > 0 || kws.length > 0;
      if ((src.watchlistOnly && !syms.length) || (src.noiseUnlessMatched && !matched && src.noiseUnlessMatched.test(it.title))) {
        seen[it.id] ||= now;
        continue;
      }
      const s = sentiment(it.title, it.sum);
      it.syms = syms;
      it.kws = kws;
      it.ment = ment;
      it.sent = s.label;
      it.imp = impact(it, { symbols: syms, keywords: kws });
      it.seen = seen[it.id] || now;
      if (!it.pub) it.pub = it.seen;
      else if (it.dateOnly) it.pub = dayKey(it.pub, IST) === dayKey(it.seen, IST) ? it.seen : it.pub;

      // Same story from another outlet? Merge instead of duplicating.
      const tok = titleTokens(it.title);
      let dup = null;
      for (const ex of items) {
        if (Math.abs((ex.pub || ex.seen) - it.pub) > 36 * 3600e3) continue;
        if (isDuplicate(tok, tokens.get(ex.id) || titleTokens(ex.title))) { dup = ex; break; }
      }
      seen[it.id] ||= now;
      if (dup) {
        dup.also ||= [];
        if (dup.src !== src.id && !dup.also.includes(src.id)) dup.also.push(src.id);
        continue;
      }
      items.push(it);
      byId.set(it.id, it);
      tokens.set(it.id, tok);
      if (!wasSeen) {
        newItems.push(it);
        rep.fresh++;
      }
    }
  }

  items = items
    .filter((i) => (i.pub || i.seen) >= now - RETENTION_MS)
    .sort((a, b) => (b.pub || b.seen) - (a.pub || a.seen))
    .slice(0, MAX_STATE_ITEMS);
  for (const [id, ts] of Object.entries(seen)) if (ts < now - SEEN_TTL_MS) delete seen[id];

  const okCount = reports.filter((r) => r.ok).length;
  log(`• Sources: ${okCount}/${reports.length} OK, ${newItems.length} new stories, ${items.length} kept`);
  for (const r of reports.filter((x) => !x.ok)) log(`  ✗ ${r.id}: ${r.error}`);

  // ---------------------------------------------------------------- quotes
  const nifty50 = lists.nifty50?.items || [];
  const watchSyms = config.watchlist.map((w) => w.symbol);
  const wanted = unique([...config.markets, ...watchSyms, ...nifty50.map((x) => x.sym)]);
  const quotes = {};
  for (const s of wanted) if (state.quotes?.[s]) quotes[s] = state.quotes[s];
  let quoteReport = { ok: false, count: 0, missing: [], errors: [] };
  if (!args['no-quotes']) {
    const qr = await fetchQuotes(wanted);
    Object.assign(quotes, qr.quotes);
    quoteReport = { ok: qr.errors.length === 0, count: Object.keys(qr.quotes).length, missing: qr.missing, errors: qr.errors };
    log(`• Quotes: ${quoteReport.count}/${wanted.length}${qr.missing.length ? ` (missing: ${qr.missing.slice(0, 8).join(', ')})` : ''}${qr.errors.length ? ` errors: ${qr.errors.join('; ')}` : ''}`);
  }
  // Fill blank watchlist names from quote data (shown in app; also used for matching next run)
  for (const w of config.watchlist) if (!w.name && quotes[w.symbol]?.name) w.name = quotes[w.symbol].name;

  // Daily OHLC history for charts (a few symbols per run so Yahoo is never hammered)
  const histDir = join(args.state, 'history');
  mkdirSync(histDir, { recursive: true });
  const hist = (state.history ||= {});
  const histSyms = unique([...watchSyms, ...config.markets]);
  if (!args['no-quotes']) {
    const due = histSyms.filter((s) => {
      const h = hist[s];
      if (!h || !existsSync(join(histDir, `${histKey(s)}.json`))) return !(h?.errDay === today && h.errCount >= 3);
      return h.day !== today && !(h.errDay === today && h.errCount >= 3);
    });
    for (const s of due.slice(0, HISTORY_PER_RUN)) {
      const r = await fetchHistory(s);
      if (r.data) {
        writeJson(join(histDir, `${histKey(s)}.json`), r.data);
        hist[s] = { day: today, at: now, n: r.data.t.length };
      } else {
        const h = (hist[s] ||= {});
        h.errCount = h.errDay === today ? (h.errCount || 0) + 1 : 1;
        h.errDay = today;
        h.err = r.error;
      }
    }
    if (due.length) log(`• History: refreshed ${Math.min(due.length, HISTORY_PER_RUN)} of ${due.length} due`);
  }
  for (const f of readdirSync(histDir)) {
    const sym = Object.keys(hist).find((s) => `${histKey(s)}.json` === f);
    if (!sym || !histSyms.includes(sym)) rmSync(join(histDir, f), { force: true });
  }
  for (const s of Object.keys(hist)) if (!histSyms.includes(s)) delete hist[s];

  // ---------------------------------------------------------------- alerts
  const quiet = isQuiet(config, now);
  const srcName = (id) => {
    const s = sources.find((x) => x.id === id);
    return s ? `${s.name}${s.section && s.section !== 'Latest' ? ` · ${s.section}` : ''}` : id;
  };
  const payloads = [];
  if (testPush) payloads.push(testPayload());

  const candidates = newsAlertCandidates(newItems, config, now);
  const priceFired = evaluatePriceAlerts(config, quotes, state, now);
  const moves = evaluateBigMoves(config, quotes, state, now);
  if (!bootstrap) {
    const max = config.alerts.maxPerRun;
    for (const f of priceFired) payloads.push(pricePayload(f, quiet));
    for (const m of moves) payloads.push(bigMovePayload(m, quiet));
    const room = Math.max(1, max - payloads.length);
    candidates.slice(0, room).forEach((c) => payloads.push(newsPayload(c, srcName(c.item.src), quiet)));
    const rest = candidates.slice(room);
    if (rest.length) payloads.push(summaryPayload(rest, quiet));
  }
  log(`• Alerts: ${payloads.length} to send${quiet ? ' (quiet hours: silent)' : ''} — ${candidates.length} news, ${priceFired.length} price, ${moves.length} big-move`);

  // ---------------------------------------------------------------- delivery
  const devices = loadDevices(args.subscriptions, env.INBOX_PRIVATE_KEY, log);
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { subject: appUrl, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
    : null;
  const ntfy = env.NTFY_TOPIC ? { topic: env.NTFY_TOPIC, server: env.NTFY_SERVER, token: env.NTFY_TOKEN } : null;
  const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID } : null;
  let delivery = null;
  if (payloads.length && !args['dry-run']) {
    delivery = await deliverAll(payloads, { devices, vapid, ntfy, telegram, appUrl, log });
    log(`• Delivered: web push ${delivery.stats.webpush.sent} ok / ${delivery.stats.webpush.failed} failed to ${devices.length} device(s)`);
    for (const d of delivery.gone) {
      const res = await githubApi('DELETE', `/contents/${d.path}`, { message: `Remove expired push subscription (${d.id})`, sha: d.sha });
      log(`• Expired device ${d.id} ${res?.ok ? 'removed' : `could not be removed (${res?.status})`}`);
    }
  } else if (payloads.length) {
    log('• Dry run: not sending.');
  }

  const delivered = delivery ? delivery.stats.webpush.sent + delivery.stats.ntfy.sent + delivery.stats.telegram.sent : 0;
  const records = (state.alerts || []).filter((a) => now - a.ts < 7 * 24 * 3600e3);
  for (const p of payloads) {
    records.unshift({ id: p.id, ts: now, type: p.type, title: p.title, body: p.body, url: p.url || undefined, route: p.route, syms: p.syms, silent: p.silent || undefined, delivered: delivered > 0 });
  }
  state.alerts = records.slice(0, 200);

  // ---------------------------------------------------------------- keep schedule alive
  if (env.GITHUB_EVENT_NAME === 'schedule' && state.keepaliveDay !== today) {
    const wf = env.WORKFLOW_FILE || 'scan.yml';
    const res = await githubApi('PUT', `/actions/workflows/${wf}/enable`);
    if (res && (res.ok || res.status === 204)) state.keepaliveDay = today;
  }

  // ---------------------------------------------------------------- outputs
  const srcNames = {};
  for (const s of sources) srcNames[s.id] = srcName(s.id);
  for (const it of items) if (!srcNames[it.src]) srcNames[it.src] = it.src;

  writeJson(join(args.out, 'news.json'), {
    v: 1,
    updatedAt: now,
    sources: srcNames,
    items: items.slice(0, MAX_PUBLIC_ITEMS).map(publicItem),
  });
  writeJson(join(args.out, 'quotes.json'), { v: 1, updatedAt: now, quotes, nifty50, missing: quoteReport.missing });
  writeJson(join(args.out, 'alerts.json'), {
    v: 1,
    updatedAt: now,
    items: state.alerts,
    priceAlerts: Object.fromEntries(Object.entries(state.priceAlerts || {}).map(([id, s]) => [id, { firedAt: s.firedAt || null, count: s.count || 0, lastPrice: s.lastPrice ?? null }])),
  });
  writeJson(join(args.out, 'config.json'), config);
  const outHist = join(args.out, 'history');
  mkdirSync(outHist, { recursive: true });
  for (const f of readdirSync(histDir)) copyFileSync(join(histDir, f), join(outHist, f));
  if (existsSync(symbolsPath)) copyFileSync(symbolsPath, join(args.out, 'symbols.json'));

  const status = {
    v: 1,
    updatedAt: now,
    durationMs: Date.now() - now,
    trigger: env.GITHUB_EVENT_NAME || 'local',
    runUrl: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    nextRunAt: nextScheduledRun(now),
    bootstrap,
    quiet,
    counts: { items: items.length, fresh: newItems.length, alerts: payloads.length },
    sources: reports.map((r) => ({ ...r, lastOk: feedState[r.id]?.lastOk || null, fails: feedState[r.id]?.fails || 0 })),
    catalog: [
      ...BUILTIN_SOURCES.map(({ id, name, section, kind }) => ({ id, name, section, kind })),
      { id: 'gnews-watch', name: 'Google News', section: 'Watchlist stocks', kind: 'news' },
    ],
    quotes: quoteReport,
    history: Object.keys(hist).length,
    push: {
      devices: devices.length,
      deviceIds: devices.map((d) => d.id),
      webpush: !!vapid,
      ntfy: !!ntfy,
      telegram: !!telegram,
      sent: delivery?.stats.webpush.sent || 0,
      failed: delivery?.stats.webpush.failed || 0,
      test: testPush || undefined,
    },
  };
  status.durationMs = Date.now() - now;
  writeJson(join(args.out, 'status.json'), status);

  state.lastRunAt = now;
  state.items = items;
  state.quotes = quotes;
  writeJson(statePath, state);
  log(`✓ Done in ${(status.durationMs / 1000).toFixed(1)}s → ${args.out}`);
}

main().catch((err) => {
  console.error('✗ Scan failed:', err);
  process.exit(1);
});
