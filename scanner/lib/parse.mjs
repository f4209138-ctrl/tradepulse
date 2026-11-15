import { XMLParser } from 'fast-xml-parser';
import { stripHtml, parseFeedDate, clip, hashId, IST_OFFSET_MIN } from './util.mjs';
import { GOOGLE_NOISE } from './sources.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  cdataPropName: false,
  isArray: (tagName) => tagName === 'item' || tagName === 'entry',
});

function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object' && node['#text'] != null) return String(node['#text']);
  return '';
}

function linkOf(it) {
  const pick = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (typeof x === 'object') return x['@_href'] || x['#text'] || '';
    return '';
  };
  let v = '';
  if (Array.isArray(it.link)) {
    const alt = it.link.find((x) => typeof x === 'object' && x !== null && (!x['@_rel'] || x['@_rel'] === 'alternate'));
    v = pick(alt || it.link[0]);
  } else {
    v = pick(it.link);
  }
  if (!v && it['feedburner:origLink']) v = text(it['feedburner:origLink']);
  if (!v) {
    const g = text(it.guid) || text(it.id);
    if (/^https?:\/\//i.test(g)) v = g;
  }
  return String(v).trim();
}

/** Parse RSS 2.0 / RSS 1.0 (RDF) / Atom into raw items. Throws on non-feeds. */
export function parseFeed(xml) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) {
    throw new Error('response is not an RSS/Atom feed');
  }
  const doc = parser.parse(xml);
  let items;
  if (doc?.rss?.channel) items = doc.rss.channel.item || [];
  else if (doc?.feed) items = doc.feed.entry || [];
  else if (doc?.['rdf:RDF']) items = doc['rdf:RDF'].item || [];
  else throw new Error('feed has no channel/entries');
  return items.map((it) => ({
    title: stripHtml(text(it.title)),
    link: linkOf(it),
    guid: text(it.guid) || text(it.id),
    date: text(it.pubDate) || text(it.published) || text(it.updated) || text(it['dc:date']) || text(it.date),
    summary: stripHtml(text(it.description) || text(it.summary) || text(it['content:encoded']) || text(it.content)),
    sourceName: text(it.source),
  }));
}

/** Canonical form of a URL for identity: https, no tracking params, no fragment. */
export function canonicalUrl(u) {
  try {
    const url = new URL(u);
    url.protocol = 'https:';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^m\./, 'www.');
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|src$|from$|oc$)/i.test(k)) url.searchParams.delete(k);
    }
    let s = url.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return String(u || '').trim();
  }
}

/**
 * Turn raw feed entries into normalized items for one source.
 * Returns { items, dropped } where dropped counts unusable entries.
 */
export function normalizeItems(rawItems, source, now = Date.now()) {
  const linkCounts = new Map();
  for (const r of rawItems) if (r.link) linkCounts.set(r.link, (linkCounts.get(r.link) || 0) + 1);

  const out = [];
  let dropped = 0;
  for (const r of rawItems) {
    let it = { title: r.title, summary: r.summary, link: r.link, via: null };
    if (!it.title) { dropped++; continue; }

    if (source.google) {
      const via = r.sourceName && r.sourceName.trim();
      if (via) {
        it.via = via;
        const suffix = ` - ${via}`;
        if (it.title.endsWith(suffix)) it.title = it.title.slice(0, -suffix.length).trim();
      } else {
        const m = / - ([^-]{2,40})$/.exec(it.title);
        if (m) { it.via = m[1].trim(); it.title = it.title.slice(0, m.index).trim(); }
      }
      it.summary = ''; // Google's description just repeats the title + link
      if (GOOGLE_NOISE.test(it.title)) { dropped++; continue; }
    }

    if (source.transform) it = source.transform(it) || it;

    // Summary that merely repeats the title is noise
    if (it.summary) {
      const a = it.summary.toLowerCase().replace(/\W+/g, ' ').trim();
      const b = it.title.toLowerCase().replace(/\W+/g, ' ').trim();
      if (a === b || a.startsWith(b)) it.summary = a.length > b.length + 40 ? it.summary.slice(it.title.length).replace(/^[\s:.\-–—]+/, '') : '';
    }
    it.summary = clip(it.summary || '', 260);

    const d = parseFeedDate(r.date, source.defaultOffsetMin ?? IST_OFFSET_MIN);
    let ts = d ? d.ts : null;
    const dateOnly = d ? d.dateOnly : true;
    if (ts && ts > now + 10 * 60000) ts = now; // future-dated → clamp

    // Identity: specific link → link; generic/shared link → content
    const generic = !r.link || (linkCounts.get(r.link) || 0) > 1;
    const key = generic
      ? `${source.id}|${it.title}|${r.summary}|${r.date}`
      : canonicalUrl(r.link);
    out.push({
      id: hashId(key),
      src: source.id,
      kind: source.kind,
      title: clip(it.title, 300),
      url: it.link || '',
      sum: it.summary,
      pub: ts,
      dateOnly,
      via: it.via || null,
      company: it.company || null,
      subject: it.subject || null,
    });
  }
  return { items: out, dropped };
}
