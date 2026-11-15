// Company profile, valuation, financials, analyst view and upcoming events (Yahoo quoteSummary).
// Needs a cookie + "crumb" session, fetched once per scan.
import { BROWSER_UA } from './http.mjs';
import { clip } from './util.mjs';

const MODULES = 'assetProfile,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,price';

export async function yahooSession() {
  try {
    const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': BROWSER_UA }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const cookie = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    if (!cookie) return null;
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': BROWSER_UA, Cookie: cookie }, signal: AbortSignal.timeout(10000) });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 40 || /[<{ ]/.test(crumb)) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

const v = (x) => (x && typeof x === 'object' ? (Number.isFinite(x.raw) ? x.raw : null) : Number.isFinite(x) ? x : null);
const t = (x) => { const s = v(x); return s ? s * 1000 : null; };

export async function fetchFundamentals(sym, sess) {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${MODULES}&crumb=${encodeURIComponent(sess.crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Cookie: sess.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const r = (await res.json())?.quoteSummary?.result?.[0];
    if (!r) return { error: 'no data' };
    const ap = r.assetProfile || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ce = r.calendarEvents || {}, pr = r.price || {};
    const earn = (ce.earnings?.earningsDate || []).map(t).filter(Boolean);
    return {
      data: {
        profile: {
          sector: ap.sectorDisp || ap.sector || null,
          industry: ap.industryDisp || ap.industry || null,
          summary: ap.longBusinessSummary ? clip(ap.longBusinessSummary, 900) : null,
          website: /^https?:\/\//.test(ap.website || '') ? ap.website : null,
          employees: ap.fullTimeEmployees || null,
          city: ap.city || null,
          people: (ap.companyOfficers || []).slice(0, 3).map((o) => ({ name: o.name, title: o.title })),
        },
        valuation: {
          marketCap: v(pr.marketCap) ?? v(sd.marketCap),
          pe: v(sd.trailingPE), forwardPE: v(sd.forwardPE) ?? v(ks.forwardPE), pb: v(ks.priceToBook),
          eps: v(ks.trailingEps), bookValue: v(ks.bookValue), dividendYield: v(sd.dividendYield) ?? v(sd.trailingAnnualDividendYield),
          dividendRate: v(sd.dividendRate) ?? v(sd.trailingAnnualDividendRate), beta: v(sd.beta),
          avgVolume: v(sd.averageVolume), avg50: v(sd.fiftyDayAverage), avg200: v(sd.twoHundredDayAverage),
          shares: v(ks.sharesOutstanding), evToEbitda: v(ks.enterpriseToEbitda),
        },
        financials: {
          revenue: v(fd.totalRevenue), revenueGrowth: v(fd.revenueGrowth), earningsGrowth: v(fd.earningsGrowth),
          profitMargin: v(fd.profitMargins), operatingMargin: v(fd.operatingMargins), roe: v(fd.returnOnEquity),
          roa: v(fd.returnOnAssets), debtToEquity: v(fd.debtToEquity), cash: v(fd.totalCash), debt: v(fd.totalDebt),
          currentRatio: v(fd.currentRatio), ebitda: v(fd.ebitda), freeCashflow: v(fd.freeCashflow),
        },
        ownership: { insiders: v(ks.heldPercentInsiders), institutions: v(ks.heldPercentInstitutions) },
        analysts: {
          rating: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
          mean: v(fd.recommendationMean), count: v(fd.numberOfAnalystOpinions),
          target: v(fd.targetMeanPrice), high: v(fd.targetHighPrice), low: v(fd.targetLowPrice),
        },
        events: {
          earnings: earn.length ? earn[0] : null,
          exDividend: t(ce.exDividendDate) || t(sd.exDividendDate),
          dividendDate: t(ce.dividendDate),
        },
      },
    };
  } catch (err) {
    return { error: err.message };
  }
}
