import { store } from '../store.js';
import { $, icon } from '../ui.js';

export const title = 'Help & setup';

const qa = (q, a) => `<details class="card" style="padding:0"><summary style="padding:14px;font-weight:600;cursor:pointer">${q}</summary><div style="padding:0 14px 14px;color:var(--text-2);font-size:14px">${a}</div></details>`;

export function render(el) {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  el.innerHTML = `
    <div class="sec"><h2>Get set up (2 minutes)</h2></div>
    <div class="card stack" style="font-size:14px">
      <div class="row" style="align-items:flex-start"><b class="num">1</b><div class="grow"><b>Install the app</b><br><span class="muted">${standalone ? 'Done — you are using the installed app.' : 'Chrome ⋮ menu › <b>Add to Home screen</b> / <b>Install app</b>.'}</span>
        ${store.installPrompt && !standalone ? '<div style="margin-top:8px"><button class="btn sm primary" id="hp-install" type="button">Install now</button></div>' : ''}</div></div>
      <div class="row" style="align-items:flex-start"><b class="num">2</b><div class="grow"><b>Connect GitHub</b><br><span class="muted">More › Settings › Create token, paste it, Connect. This lets the app save your watchlist and alerts.</span></div></div>
      <div class="row" style="align-items:flex-start"><b class="num">3</b><div class="grow"><b>Turn on push alerts</b><br><span class="muted">Alerts tab › Turn on push alerts › Allow. A test notification arrives in about a minute.</span></div></div>
      <div class="row" style="align-items:flex-start"><b class="num">4</b><div class="grow"><b>Make it yours</b><br><span class="muted">Add your stocks in Watchlist, set keywords and price alerts in Alerts.</span></div></div>
    </div>
    <div class="sec"><h2>Questions</h2></div>
    <div class="stack">
      ${qa('How fast do alerts arrive?', 'The scanner runs on GitHub\'s servers every ~5 minutes on weekdays and every 15 minutes at weekends. That is the fastest GitHub allows, and GitHub sometimes starts runs a few minutes late, so expect alerts 1–15 minutes after a story is published. Your phone does no scanning, so it costs almost no battery or data.')}
      ${qa('Why not every second?', 'GitHub Actions can\'t schedule jobs more often than every 5 minutes, and news sites block anyone requesting their feeds every second. Per-second data needs a paid real-time feed (for example your broker\'s API).')}
      ${qa('I\'m not getting notifications', 'Check: (1) Alerts tab says “Alerts are on for this phone”; (2) Send test alert works; (3) Android Settings › Apps › Chrome (or TradePulse) › Notifications are allowed; (4) Battery › allow background activity / no restrictions for Chrome — on Xiaomi, Oppo, Vivo, Realme also enable <b>Autostart</b>. Quiet hours deliver alerts silently.')}
      ${qa('Where does the data come from?', 'News: Economic Times, Mint, Business Standard, BusinessLine, NDTV Profit, CNBC, Google News, NSE announcements/board meetings/corporate actions, RBI and SEBI. Prices and company info (profile, valuation, financials, ownership, analyst targets, results dates): Yahoo Finance — quotes may be delayed a few minutes, company data refreshes daily. Sentiment and impact labels are automatic keyword-based estimates, not advice.')}
      ${qa('What does the token allow?', 'Only what you grant: read/write files and run workflows in your TradePulse repo. It is stored on this phone and sent only to api.github.com. Revoke it any time on github.com › Settings › Developer settings.')}
      ${qa('Is my data private?', 'The repo is public so GitHub Actions and Pages are free — your watchlist and keywords are visible there. Push addresses are encrypted. The journal and calculator inputs stay on this phone.')}
      ${qa('Something looks broken', 'More › News sources shows each feed\'s health; the status pill at the top shows when the last scan ran; the Run log link opens GitHub\'s log for that scan.')}
    </div>
    <p class="note">Not investment advice. Always verify news at the source before trading.</p>`;
  $('#hp-install', el)?.addEventListener('click', async () => {
    store.installPrompt?.prompt();
    await store.installPrompt?.userChoice.catch(() => null);
    store.installPrompt = null;
    render(el);
  });
}
