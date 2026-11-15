import * as webpush from 'web-push';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openSealed } from './inbox.mjs';

/** git's blob id for a file's bytes (needed to delete it through the Contents API). */
export function gitBlobSha(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** Read and decrypt every subscriptions/*.json device file. */
export function loadDevices(dir, inboxPrivateKey, log = console.log) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const devices = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f));
      const doc = JSON.parse(raw.toString('utf8'));
      if (!inboxPrivateKey) throw new Error('INBOX_PRIVATE_KEY secret is not set');
      const data = openSealed(doc.sealed || doc, inboxPrivateKey);
      const sub = data.subscription || data;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('subscription is missing endpoint/keys');
      if (!/^https:\/\//.test(sub.endpoint)) throw new Error('subscription endpoint must be https');
      devices.push({ id: f.replace(/\.json$/, ''), path: `subscriptions/${f}`, sha: gitBlobSha(raw), label: doc.label || null, sub });
    } catch (err) {
      log(`! device ${f}: ${err.message}`);
    }
  }
  return devices;
}

export async function sendWebPush(device, payload, vapid) {
  try {
    const res = await webpush.sendNotification(device.sub, JSON.stringify(payload), {
      vapidDetails: vapid,
      TTL: payload.ttl ?? 6 * 3600,
      urgency: payload.silent ? 'normal' : 'high',
      timeout: 15000,
    });
    return { ok: true, status: res.statusCode };
  } catch (err) {
    const status = err.statusCode || 0;
    return { ok: false, status, gone: status === 404 || status === 410, error: String(err.body || err.message || err).slice(0, 200) };
  }
}

export async function sendNtfy(cfg, payload, appUrl) {
  try {
    const res = await fetch(cfg.server || 'https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
      body: JSON.stringify({
        topic: cfg.topic,
        title: payload.title,
        message: payload.body,
        click: payload.url || (appUrl && payload.route ? appUrl + payload.route : undefined),
        priority: payload.silent ? 2 : 4,
        tags: payload.type === 'price' ? ['dart'] : ['chart_with_upwards_trend'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendTelegram(cfg, payload, appUrl) {
  try {
    const link = payload.url || (appUrl && payload.route ? appUrl + payload.route : '');
    const text = `<b>${escHtml(payload.title)}</b>\n${escHtml(payload.body)}${link ? `\n<a href="${escHtml(link)}">Open</a>` : ''}`;
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: !!payload.silent }),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Deliver payloads to every channel. Returns stats and the list of expired devices.
 */
export async function deliverAll(payloads, { devices, vapid, ntfy, telegram, appUrl, log = console.log }) {
  const stats = { payloads: payloads.length, webpush: { sent: 0, failed: 0 }, ntfy: { sent: 0, failed: 0 }, telegram: { sent: 0, failed: 0 } };
  const gone = new Map();
  for (const p of payloads) {
    if (vapid) {
      for (const d of devices) {
        if (gone.has(d.id)) continue;
        const r = await sendWebPush(d, p, vapid);
        if (r.ok) stats.webpush.sent++;
        else {
          stats.webpush.failed++;
          log(`! push to ${d.id} failed: ${r.status} ${r.error}`);
          if (r.gone) gone.set(d.id, d);
        }
      }
    }
    if (ntfy?.topic) {
      const r = await sendNtfy(ntfy, p, appUrl);
      r.ok ? stats.ntfy.sent++ : stats.ntfy.failed++;
    }
    if (telegram?.token && telegram?.chatId) {
      const r = await sendTelegram(telegram, p, appUrl);
      r.ok ? stats.telegram.sent++ : stats.telegram.failed++;
    }
  }
  return { stats, gone: [...gone.values()] };
}
