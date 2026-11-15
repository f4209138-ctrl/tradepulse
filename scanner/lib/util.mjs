import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const IST = 'Asia/Kolkata';
export const IST_OFFSET_MIN = 330;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hashId(input) {
  return createHash('sha1').update(String(input)).digest('base64url').slice(0, 12);
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const unique = (arr) => [...new Set(arr)];

/** Run async fn over items with limited concurrency, preserving order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', bull: '•', middot: '·', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', yen: '¥', cent: '¢', rupee: '₹', inr: '₹', deg: '°', times: '×', divide: '÷',
  minus: '−', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', percnt: '%', dollar: '$',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', oacute: 'ó', ograve: 'ò',
  uacute: 'ú', iacute: 'í', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

export function decodeEntities(s) {
  if (!s) return '';
  s = String(s);
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp < 0x110000) {
        try { return String.fromCodePoint(cp); } catch { return m; }
      }
      return m;
    }
    const v = NAMED[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

/** Strip HTML to plain text (handles entity-escaped HTML such as "&lt;a href=..."). */
export function stripHtml(input) {
  if (input == null) return '';
  let t = String(input);
  if (/&lt;\/?[a-z!]/i.test(t)) t = decodeEntities(t);
  t = t
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td|h\d|table)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t);
  // Some feeds double-escape entities ("&amp;#39;")
  if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(t)) t = decodeEntities(t);
  return t.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/** Clip text to n chars at a word boundary. */
export function clip(s, n) {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- time helpers ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function utcFromParts(y, mo, d, h, mi, s, offsetMin) {
  return Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60000;
}

function offsetToMin(str) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(str);
  if (!m) return null;
  const v = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  return m[1] === '-' ? -v : v;
}

function offsetString(min, colon = false) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${sign}${hh}${colon ? ':' : ''}${mm}`;
}

/**
 * Parse the zoo of feed date formats. Returns { ts, dateOnly } or null.
 * defaultOffsetMin is used when the string carries no zone (Indian sites → IST).
 */
export function parseFeedDate(raw, defaultOffsetMin = IST_OFFSET_MIN) {
  if (raw == null) return null;
  let s = String(raw).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  if (!s) return null;
  let m;

  // NSE: "14-Nov-2026 21:16:17" | "14-Nov-2026 21:16" | "14-Nov-2026"
  m = /^(\d{1,2})-([A-Za-z]{3,4})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const ts = utcFromParts(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), defaultOffsetMin);
    return { ts, dateOnly: m[4] === undefined };
  }

  // SEBI: "13 Nov, 2026 +0530" | "13 Nov 2026"
  m = /^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})(?:\s+([+-]\d{2}:?\d{2}))?$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    const off = m[4] ? offsetToMin(m[4]) : defaultOffsetMin;
    return { ts: utcFromParts(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1], 0, 0, 0, off ?? defaultOffsetMin), dateOnly: true };
  }

  // ISO 8601 without a zone → assume source zone
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
  if (m) {
    return { ts: utcFromParts(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), defaultOffsetMin), dateOnly: false };
  }

  // RFC 822 / ISO with zone. If there is a time but no zone, append the default offset.
  const hasZone = /(?:[+-]\d{2}:?\d{2}|\bZ|\bGMT|\bUTC|\bUT|\b[ECMP][SD]T|\bIST)\s*$/i.test(s);
  if (/\bIST\s*$/.test(s)) s = s.replace(/\bIST\s*$/, '+0530');
  if (!hasZone && /\d{1,2}:\d{2}/.test(s)) s = `${s} ${offsetString(defaultOffsetMin)}`;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return { ts: t, dateOnly: !/\d{1,2}:\d{2}/.test(s) };
  return null;
}

const partsCache = new Map();
function dtf(timeZone) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of ts in a time zone. */
export function zoned(ts, timeZone = IST) {
  const parts = {};
  for (const p of dtf(timeZone).formatToParts(new Date(ts))) parts[p.type] = p.value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  return {
    y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute, dow,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: +parts.hour * 60 + +parts.minute,
  };
}

export const dayKey = (ts, timeZone = IST) => zoned(ts, timeZone).date;

/** "HH:MM" → minutes after midnight */
export function hhmmToMin(s, fallback = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return fallback;
  return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
}

export function inWindow(minutes, startMin, endMin) {
  if (startMin === endMin) return false;
  return startMin < endMin ? minutes >= startMin && minutes < endMin : minutes >= startMin || minutes < endMin;
}

// ---------- fs helpers ----------

export function readJson(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`! could not read ${file}: ${err.message}`);
    return fallback;
  }
}

export function writeJson(file, data, pretty = false) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  renameSync(tmp, file);
}

export const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
