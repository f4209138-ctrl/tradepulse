// Small fetch wrapper: timeouts, conditional GET, charset detection, one retry.

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function charsetOf(contentType, bytes) {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
  if (m) return m[1].toLowerCase();
  // <?xml version="1.0" encoding="ISO-8859-1"?>
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const x = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  return x ? x[1].toLowerCase() : 'utf-8';
}

function decode(bytes, contentType) {
  let enc = charsetOf(contentType, bytes);
  if (enc === 'utf8') enc = 'utf-8';
  try {
    return new TextDecoder(enc, { fatal: true }).decode(bytes);
  } catch {
    // Mislabelled feeds: fall back to windows-1252 (superset of latin1)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }
}

/**
 * GET a URL. Returns { status, ok, notModified, text, etag, lastModified, ms, error }.
 * Never throws.
 */
export async function httpGet(url, opts = {}) {
  const { etag, lastModified, timeoutMs = 12000, accept, retries = 1, headers = {} } = opts;
  const started = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const h = {
        'User-Agent': BROWSER_UA,
        Accept: accept || 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
        'Accept-Language': 'en-IN,en;q=0.9',
        ...headers,
      };
      if (etag) h['If-None-Match'] = etag;
      if (lastModified) h['If-Modified-Since'] = lastModified;
      const res = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const base = {
        status: res.status,
        etag: res.headers.get('etag') || null,
        lastModified: res.headers.get('last-modified') || null,
      };
      if (res.status === 304) {
        return { ...base, ok: true, notModified: true, text: '', ms: Date.now() - started };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = decode(bytes, res.headers.get('content-type')).replace(/^﻿/, '');
      if (!res.ok) {
        // Retry once on 5xx / 429
        if ((res.status >= 500 || res.status === 429) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          lastError = `HTTP ${res.status}`;
          continue;
        }
        return { ...base, ok: false, text, ms: Date.now() - started, error: `HTTP ${res.status}` };
      }
      return { ...base, ok: true, notModified: false, text, bytes: bytes.length, ms: Date.now() - started };
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? `timeout after ${timeoutMs / 1000}s` : err.cause?.code || err.message;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  return { status: 0, ok: false, text: '', ms: Date.now() - started, error: lastError || 'network error' };
}

export async function getJson(url, opts = {}) {
  const r = await httpGet(url, { accept: 'application/json', ...opts });
  if (!r.ok) return { ...r, json: null };
  try {
    return { ...r, json: JSON.parse(r.text) };
  } catch (err) {
    return { ...r, ok: false, json: null, error: `bad JSON: ${err.message}` };
  }
}
