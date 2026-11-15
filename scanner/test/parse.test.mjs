import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedDate, stripHtml, clip, inWindow, hhmmToMin } from '../lib/util.mjs';
import { parseFeed, normalizeItems, canonicalUrl } from '../lib/parse.mjs';
import { BUILTIN_SOURCES } from '../lib/sources.mjs';

const src = (id) => BUILTIN_SOURCES.find((s) => s.id === id);
const iso = (r) => new Date(r.ts).toISOString();

test('dates: RFC 822 with zone, GMT and +0530', () => {
  assert.equal(iso(parseFeedDate('Sat, 14 Nov 2026 11:10:38 GMT')), '2026-11-14T11:10:38.000Z');
  assert.equal(iso(parseFeedDate('Sat, 14 Nov 2026 20:46:36 +0530')), '2026-11-14T15:16:36.000Z');
});

test('dates: zone-less times are read as IST (RBI), and as UTC when the source says so', () => {
  assert.equal(iso(parseFeedDate('Fri, 13 Nov 2026 17:50:00')), '2026-11-13T12:20:00.000Z');
  assert.equal(iso(parseFeedDate('Fri, 13 Nov 2026 17:50:00', 0)), '2026-11-13T17:50:00.000Z');
  assert.equal(iso(parseFeedDate('2026-11-14T09:00:00')), '2026-11-14T03:30:00.000Z');
});

test('dates: NSE and SEBI formats', () => {
  const nse = parseFeedDate('14-Nov-2026 21:16:17');
  assert.equal(iso(nse), '2026-11-14T15:46:17.000Z');
  assert.equal(nse.dateOnly, false);
  assert.equal(iso(parseFeedDate('02-May-2026 16:46')), '2026-05-02T11:16:00.000Z');
  const sebi = parseFeedDate('13 Nov, 2026 +0530');
  assert.equal(iso(sebi), '2026-11-12T18:30:00.000Z');
  assert.equal(sebi.dateOnly, true);
  assert.equal(parseFeedDate('not a date'), null);
  assert.equal(parseFeedDate(''), null);
});

test('stripHtml handles escaped HTML, CDATA and entities', () => {
  assert.equal(stripHtml('&lt;a href="x"&gt;&lt;img src="y"/&gt;&lt;/a&gt;Yes Bank moves SC'), 'Yes Bank moves SC');
  assert.equal(stripHtml('<![CDATA[<p>Profit &amp; loss</p>]]>'), 'Profit & loss');
  assert.equal(stripHtml('Rs&nbsp;1,850 &#8377; &rsquo;'), 'Rs 1,850 ₹ ’');
  assert.equal(stripHtml('<script>alert(1)</script>Safe'), 'Safe');
});

test('clip cuts at a word boundary', () => {
  assert.equal(clip('alpha beta gamma delta', 12), 'alpha beta…');
  assert.equal(clip('short', 12), 'short');
});

test('quiet-hours window wraps midnight', () => {
  const s = hhmmToMin('22:30');
  const e = hhmmToMin('07:30');
  assert.equal(inWindow(hhmmToMin('23:00'), s, e), true);
  assert.equal(inWindow(hhmmToMin('03:00'), s, e), true);
  assert.equal(inWindow(hhmmToMin('12:00'), s, e), false);
  assert.equal(inWindow(hhmmToMin('10:00'), hhmmToMin('09:00'), hhmmToMin('17:00')), true);
});

test('canonicalUrl strips tracking and fragments', () => {
  assert.equal(canonicalUrl('http://m.example.com/a/b/?utm_source=x&id=3#top'), 'https://www.example.com/a/b/?id=3');
});

const RSS = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;

test('parses RSS 2.0 with CDATA and Atom', () => {
  const rss = RSS(`<item><title><![CDATA[Nifty jumps 1% & Sensex rallies]]></title><link><![CDATA[https://x.com/a]]></link>
    <pubDate>Sat, 14 Nov 2026 20:46:36 +0530</pubDate><description><![CDATA[<p>Markets rose.</p>]]></description></item>`);
  const [it] = parseFeed(rss);
  assert.equal(it.title, 'Nifty jumps 1% & Sensex rallies');
  assert.equal(it.link, 'https://x.com/a');
  assert.equal(it.summary, 'Markets rose.');

  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>f</title>
    <entry><title>Atom story</title><link rel="alternate" href="https://y.com/1"/><updated>2026-11-14T10:00:00Z</updated><summary>S</summary></entry></feed>`;
  const [a] = parseFeed(atom);
  assert.equal(a.title, 'Atom story');
  assert.equal(a.link, 'https://y.com/1');
  assert.equal(a.date, '2026-11-14T10:00:00Z');

  assert.throws(() => parseFeed('<html><body>Not a feed</body></html>'), /not an RSS/);
});

test('NSE announcement transform builds "Company: Subject" titles', () => {
  const xml = RSS(`<item><title>Bharti Airtel Limited</title><link>https://nsearchives.nseindia.com/corporate/BHARTIARTL_1.pdf</link>
    <description>Bharti Airtel Limited has informed the Exchange about Press Release |SUBJECT: Press Release</description><pubDate>14-Nov-2026 21:16:17</pubDate></item>`);
  const { items } = normalizeItems(parseFeed(xml), src('nse-announcements'));
  assert.equal(items[0].title, 'Bharti Airtel Limited: Press Release');
  assert.equal(items[0].company, 'Bharti Airtel Limited');
  assert.equal(items[0].subject, 'Press Release');
  assert.equal(items[0].kind, 'filing');
  assert.equal(new Date(items[0].pub).toISOString(), '2026-11-14T15:46:17.000Z');
});

test('NSE corporate actions: generic links get content-based ids', () => {
  const xml = RSS(`
    <item><title>Star Cement Limited - Ex-Date: 13-Nov-2026</title><link>https://www.nseindia.com/companies-listing/corporate-filings-actions</link>
      <description>SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RE 1 PER SHARE |FACE VALUE:1 |RECORD DATE:13-Nov-2026</description><pubDate>13-Nov-2026 06:11:45</pubDate></item>
    <item><title>BN Agrochem Limited - Ex-Date: 16-Nov-2026</title><link>https://www.nseindia.com/companies-listing/corporate-filings-actions</link>
      <description>SERIES:EQ |PURPOSE:FACE VALUE SPLIT |FACE VALUE:10 |RECORD DATE:16-Nov-2026</description><pubDate>13-Nov-2026 06:11:45</pubDate></item>`);
  const { items } = normalizeItems(parseFeed(xml), src('nse-corpact'));
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);
  assert.match(items[0].title, /^Star Cement Limited: Interim Dividend - Re 1 Per Share · ex-date 13-Nov-2026$/);
  assert.equal(items[0].company, 'Star Cement Limited');
});

test('Google News: publisher suffix removed, price pages dropped', () => {
  const xml = RSS(`
    <item><title>HDFC Bank shares rally 2% - Mint</title><link>https://news.google.com/rss/articles/abc</link><source url="https://livemint.com">Mint</source><pubDate>Fri, 13 Nov 2026 17:54:55 GMT</pubDate><description>&lt;a href="x"&gt;HDFC Bank shares rally 2%&lt;/a&gt;</description></item>
    <item><title>Infosys Share Price Today - Live NSE/BSE - Broker</title><link>https://news.google.com/rss/articles/def</link><source url="https://b.com">Broker</source></item>`);
  const { items, dropped } = normalizeItems(parseFeed(xml), src('gnews-market'));
  assert.equal(items.length, 1);
  assert.equal(dropped, 1);
  assert.equal(items[0].title, 'HDFC Bank shares rally 2%');
  assert.equal(items[0].via, 'Mint');
  assert.equal(items[0].sum, '');
});
