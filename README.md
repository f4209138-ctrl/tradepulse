# TradePulse

Indian stock-market news alerts and a light trading dashboard for your phone.

- **Push alerts** when your watchlist stocks are in the news, NSE posts a filing for them, your keywords appear, a price level is hit, or a stock makes a big move.
- **Dashboard**: NIFTY / SENSEX / BANK NIFTY and global cues, NIFTY 50 breadth, top gainers and losers, sector moves.
- **News feed** from Economic Times, Mint, Business Standard, BusinessLine, NDTV Profit, CNBC, Google News, NSE (announcements, board meetings, corporate actions), RBI and SEBI. Each story is tagged with stocks, sentiment and impact.
- **Watchlist** with intraday sparklines and the day's range. Each stock has a page with a chart (1D–1Y, candles and volume), key stats, pivot levels and CPR, price alerts, and its own news.
- **Tools**: position sizing, risk:reward, pivots, average price, P&L, plus a trade journal (win rate, expectancy, R-multiples, equity curve, CSV export).

## How it works

```
GitHub Actions (every ~5 min)                     Your phone
┌──────────────────────────────┐   Web Push      ┌──────────────────────────┐
│ scanner/scan.mjs             │ ──────────────▶ │ notification             │
│  • fetch ~20 RSS feeds       │                 │                          │
│  • match watchlist/keywords  │   GitHub Pages  │ TradePulse web app (PWA) │
│  • quotes (Yahoo Finance)    │ ──────────────▶ │  reads data/*.json       │
│  • write data/*.json, deploy │                 │  edits config.json via   │
└──────────────────────────────┘ ◀────────────── │  the GitHub API          │
                                    config.json  └──────────────────────────┘
```

The phone does no scanning, so it uses very little battery and data. The installed app is tiny (well under 1 MB).

**Scan frequency:** every 5 minutes on weekdays and every 15 minutes at weekends. Five minutes is GitHub's minimum, and GitHub sometimes starts scheduled runs a few minutes late. Scanning every second isn't possible on GitHub, and news sites block clients that poll that fast.

## Setup

1. Push this repo to GitHub as a **public** repo. Free Actions minutes and Pages need a public repo.
2. Run `node tools/setup.mjs` with the GitHub CLI logged in. It creates the push keys, stores them as secrets and variables, and enables Pages.
3. Run the workflow once: Actions › Scan & deploy › Run workflow. The app goes live at `https://<user>.github.io/<repo>/`.
4. On your phone, open that URL in Chrome and use ⋮ › **Install app**.
5. In the app, go to More › Settings › **Create token**. GitHub opens with the token form already filled in. Under **Repository access** choose *Only select repositories* › this repo, then generate the token, copy it, paste it into the app and tap **Connect**.
6. Go to the Alerts tab › **Turn on push alerts**. A test notification arrives in about a minute.

### Optional extra channels

Add these repo secrets to also send each alert to:

| Channel  | Secrets |
|----------|---------|
| [ntfy](https://ntfy.sh) app | `NTFY_TOPIC` (use a long random name); optionally `NTFY_TOKEN` |
| Telegram bot | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

## Configuration

Everything the scanner uses lives in [`config.json`](config.json). The app edits it for you, but you can also edit it on github.com:

- `watchlist`: `{ symbol, name, aliases }`, using Yahoo symbols (`TCS.NS`, `^NSEI`, `INR=X`). Headlines match the ticker, the company name or an alias. NSE filings match the exact listed company name.
- `markets`: the symbols shown in the Home screen's market strip.
- `keywords` / `muteKeywords`: alert on, or hide, headlines containing these words.
- `alerts`: which kinds of alerts to send, minimum impact, the big-move %, quiet hours (alerts still arrive, but silently) and the maximum number of alerts per scan.
- `priceAlerts`: `above` / `below` a price, or `pct_up` / `pct_down` for the day's change.
- `sources.disabled` / `sources.custom`: turn feeds off, or add your own RSS feeds.

Every change to `config.json` starts a scan straight away.

## Privacy & security

- Because the repo is public, your watchlist and keywords are visible on GitHub. Don't put anything private in them.
- Each phone's push subscription is encrypted (ECDH P-256 + AES-GCM) before it's committed to `subscriptions/`. Only the scanner, which holds `INBOX_PRIVATE_KEY`, can read it.
- The GitHub token lives only on your phone. It needs **Contents** and **Actions** read & write on this one repo. You can revoke it any time.
- Feed content is treated as untrusted. It's rendered as text, and only `http(s)` links are opened.
- Sentiment and impact labels are keyword heuristics, not investment advice. Prices come from Yahoo Finance and may be delayed.

## Development

```bash
cd scanner && npm ci && npm test              # unit tests (parsing, matching, alerts, crypto, push)
node scanner/build.mjs --out _site             # assemble the app
node scanner/scan.mjs --state .state --out _site/data --dry-run   # scan without sending
node tools/make-icons.mjs                      # regenerate icons
```

`app/` is plain HTML, CSS and ES modules with no build step and no framework. `scanner/` is Node 22+ with two dependencies: `fast-xml-parser` and `web-push`.
